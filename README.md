# dsh-empty-tool-result-guard

Keeps a `deepseek-harness` request legal when a tool result carries nothing the
Messages serializer can represent.

A [discussion #10186](https://github.com/deepseek-ai/deepseek-harness/discussions/10186)
report describes a session that switches from a custom `llm-pi-ai` route to
`deepseek-official` and is then answered with

```
messages.61.1: tool_use ids were found without tool_result blocks immediately after: CALL_A
```

while the reporter's own offline rebuild of the same persisted log shows the call
and its result adjacent, with matching ids. Both observations are correct, and
this plugin is the reason they can both be: the two checks count different things.

## What actually happens

`@deepseek-ai/dsh-llm-deepseek` builds each tool-role message into exactly one
`tool_result` block, whose `content` comes from the serializer's own `input()`:

```ts
const input = (blocks) => blocks.flatMap((block) => {
  if (block.type === 'text') return block.text ? [{ type: 'text', text: block.text }] : []
  if (block.type === 'reasoning' || block.type === 'tool-call') return []
  if (block.type !== 'image') return unsupported(`user/tool-result content ${block.type}`)
  // ...
})
```

An empty text block is dropped. `reasoning` and `tool-call` blocks never pass at
this position. An image becomes a handle plus payload. So a result whose every
block is dropped is serialized as

```json
{"type": "tool_result", "tool_use_id": "CALL_A", "content": []}
```

The serializer's pairing invariant — the `pending` set an assistant tool call
fills and a tool result empties — works on **ids only**, and the file documents
the retention on purpose: empty tool results *retain their call ids*. The local
check therefore declares the pair answered, and the block it declared is one the
endpoint does not count as a result.

This is why an offline reconciliation of the same log cannot find it. Rebuilding
walks the same messages through the same rules and asks the same id-shaped
question, so it answers "paired" — it agrees with the serializer because it
borrowed the serializer's question. The fact that differs is on the wire, not in
the log.

Measured against every released line this package claims, driving each line's own
shipped adapter and capturing the body it would have posted:

| result content | posted `tool_result` |
|---|---|
| `[{type:'text', text:'file contents'}]` | `{"content":[{"type":"text","text":"file contents"}]}` |
| `[]` | `{"content":[]}` |
| `[{type:'text', text:''}]` | `{"content":[]}` |
| `[{type:'reasoning',...},{type:'tool-call',...}]` | `{"content":[]}` |
| `[{type:'text', text:' '}]` | `{"content":[{"type":"text","text":" "}]}` — whitespace survives |

## What the plugin does

`llm/stream` is a waterfall, so a plugin can put a different request in front of
the dispatch. A loop-built request arrives deep-frozen and `next()` takes no
argument, so the replacement is dispatched with `ctx.llm.stream(replacement)`,
which re-enters the same waterfall; a `WeakSet` of the objects this plugin builds
is what stops the recursion.

The decision is made from the request alone — does any tool result hold a block
this position can represent? — and the repair is additive: the empty result gains
one non-empty text block **in front**, every block it already had stays, and the
call id is untouched. The conversation already answered that call; the repair
supplies content, not identity.

Nothing is written to the session log or to disk. The placeholder is a sentence
(`The tool returned no output.` by default) because an empty block would be
dropped by the same rule that emptied the result.

Every step is fail-open: a predicate, substitution or dispatch that throws leaves
the original request to the next listener, increments `errors`, and logs a
warning.

## Install

```sh
# from git, while the npm package is not published
npm install github:argszero/dsh-empty-tool-result-guard

# when published
npm install @argszero/dsh-empty-tool-result-guard
```

Mount it from a dsh profile, or let the bundle patch do it:

```yaml
# cordis.yml / profile patch
- insert:
    - id: empty-tool-result-guard
      name: '@argszero/dsh-empty-tool-result-guard'
      config:
        mode: guard
```

## Configuration

| key | default | meaning |
|---|---|---|
| `mode` | `guard` | `guard` repairs; `observe` decides and counts exactly as `guard` does and changes nothing; `off` installs no listener |
| `providers` | `[]` (every route) | provider route keys to cover |
| `text` | `The tool returned no output.` | the block text prepended to each empty result |
| `logRepairs` | `true` | emit one `debug` line per decision and one `warn` per failure |

`{{emptyToolResultGuard}}` serves a read-only view:

```ts
{
  mode: 'guard',
  providers: [],
  emptyResults: 0,   // requests in which at least one tool result carried nothing
  repaired: 0,       // requests actually replaced
  errors: 0,         // failures that were failed open
  blindSpots: [ /* ... */ ],
}
```

## What it does not claim

- It repairs the **request**, not the producer. A tool that keeps returning
  nothing keeps producing empty results, and each one is repaired on its way out;
  making the history non-empty would be a core change.
- The placeholder is model-visible text — one sentence the session did not
  previously contain.
- It cannot tell *why* a result is empty: a tool that legitimately produced
  nothing and a projection that dropped every block look identical from here.
- It knows block types, not adapters. A route that represents a block type this
  plugin counts as unrepresentable receives a sentence nothing needed. An unknown
  block type counts as **surviving** on purpose: `ContentBlock` is merge-extensible
  and a false "empty" would edit a request that was already legal.

## Verification

- **44 tests** (`npm test`): the predicate, the substitution (prepend, preserve,
  no mutation), the listener (registration options, exactly one re-dispatch,
  observe mode, provider filter, both failure paths), the plugin entry point and
  the configuration.
- **14 mutation arms** (`npm run test:inject`), every one caught: a green suite
  that cannot fail proves nothing, so each claimed decision is broken on purpose
  and rebuilt with `--noEmitOnError`.
- **10/10 probed lines** (`npm run test:probe`): every released
  `@deepseek-ai/dsh-llm-deepseek` version this package claims is installed, its
  own adapter is driven with an empty tool result, and the captured body must show
  the defect (empty `content`), then show the repair (non-empty `content`) after
  the substitution, with the control history byte-identical. A line that cannot be
  measured is a failure, never a skip.
- **The peer range reads the same to both consumers**: `semver` with and without
  `includePrerelease` admit exactly the same versions, asserted across a generated
  sweep. `>=0.1.7-rc.2 <0.1.8-0 || >=0.2.0-rc.1 <0.2.1-0 || >=0.2.1-alpha.1 <0.2.2-0`

## License

MIT
