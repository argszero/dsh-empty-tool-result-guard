Both of your observations are true, and that is the interesting part: the local check and the endpoint are counting different things.

## What the wire actually carries

I drove the shipped `DeepSeekAdapter` from `@deepseek-ai/dsh-llm-deepseek` (every released line, only `fetch` stubbed) with a history whose tool result content varies, and captured the body it posts. The `tool_result` block always survives; its content does not:

| tool result content in the session | `tool_result` posted |
|---|---|
| `[{type:'text', text:'file contents'}]` | `{"type":"tool_result","tool_use_id":"CALL_A","content":[{"type":"text","text":"file contents"}]}` |
| `[]` | `{"type":"tool_result","tool_use_id":"CALL_A","content":[]}` |
| `[{type:'text', text:''}]` | `{"type":"tool_result","tool_use_id":"CALL_A","content":[]}` |
| `[{type:'reasoning',...},{type:'tool-call',...}]` | `{"type":"tool_result","tool_use_id":"CALL_A","content":[]}` |
| `[{type:'text', text:' '}]` | `{"type":"tool_result","tool_use_id":"CALL_A","content":[{"type":"text","text":" "}]}` |

Same table on `0.1.7-rc.2`, `0.2.0-rc.1`, `0.2.0-rc.2`, `0.2.1-alpha.1` … `0.2.1-alpha.5`, `0.2.1-rc.1` and `0.2.1-rc.2`.

## Why the local pairing check passes

`packages/llm/llm-deepseek/src/serialize.ts` ends with a pairing invariant built on a `pending` set: an assistant tool call adds its id, a tool result removes it. It is exact about **ids** — an unmatched call, a duplicate id, a dangling tail all throw before anything leaves the process. What it never inspects is what a `tool_result` block *carries*.

That content is produced by the same file's own `input()`, which

- drops an empty text block,
- never passes `reasoning` or `tool-call` blocks at this position,
- turns images into handles.

So a result whose every block is dropped is serialized as `{"type":"tool_result","tool_use_id":X,"content":[]}` — a block the local invariant just declared paired, and one the endpoint does not count as a result. The file documents the retention deliberately: empty tool results "retain their call ids". Nothing crashes locally, because nothing is wrong locally.

## Why your offline rebuild cannot find it

Your rebuild walks the same messages through the same rules and asks the same id-shaped question, so it answers "paired". It agrees with the serializer because it borrowed the serializer's question — reconciling the same data on the same dimension is a tautology, not evidence. The fact that differs is on the wire, not in the log.

## What produced the emptiness in your case

Two shapes reach it, and both are ordinary:

1. A tool really returned nothing (or only whitespace-free empty text), so its result content is `[]`.
2. The result carried blocks and the projection dropped them — a result holding `reasoning`/`tool-call` blocks, or empty text, reaches the wire empty. Switching the route's capability from `[text, image]` to text-only does not create that, but it is the moment a different projection path starts running, which is why the switch is where it surfaced.

Looking at the tool calls immediately before the failing message in your session log should show which one it was.

## Mitigation and the real fix

The real fix belongs in the adapter: a `tool_result` whose content serializes to `[]` should either carry a placeholder or be reported rather than sent, since the endpoint's rule and the local invariant must not disagree about what "answered" means.

Until then, I published a plugin that makes the request legal without touching the session log: **[@argszero/dsh-empty-tool-result-guard](https://github.com/argszero/dsh-empty-tool-result-guard)**.

```sh
npm install github:argszero/dsh-empty-tool-result-guard#ac14655
```

It listens on the `llm/stream` waterfall (a plugin cannot patch the adapter — `registerAdapter` is all-or-nothing per route) and, when a request holds a tool result whose blocks nothing can represent, re-dispatches the same request with one non-empty text block prepended to that result's content. The call id, the existing blocks and every other message are untouched; nothing is written to the session log or to disk; every step fails open, so a request it cannot classify goes through unchanged.

Verified against all ten released `dsh-llm-deepseek` lines above by driving each line's own shipped adapter: the defect is present on every one, the repaired body has non-empty content on every one, and the control history (a result that already had text) is byte-identical before and after. `mode: observe` counts without changing anything, if you want to confirm your session produces this shape before letting it rewrite a request.

If it turns out your failing message is not this shape — for example the result was there and the call id differed by a normalization step — the plugin will stay silent on it and the `snapshot()` counters will stay at zero, which is itself a useful result: it would move the question back to id identity, where the local check does have something to say.
