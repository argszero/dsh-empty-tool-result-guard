/**
 * Keep a session legal when a tool result carries nothing the wire can show.
 *
 * ## The failure
 *
 * `@deepseek-ai/dsh-llm-deepseek` serializes a request for the Messages
 * endpoint, and that endpoint answers
 *
 * ```
 * messages.61.1: tool_use ids were found without tool_result blocks
 * immediately after: CALL_A
 * ```
 *
 * while the conversation plainly holds that call and its result, adjacent, with
 * the same id. Both statements are true because they count different things.
 *
 * The serializer ends with a pairing invariant — a `pending` set that an
 * assistant tool call fills and a tool result empties — and it is exact about
 * **ids**: an unmatched call, a duplicate id or a dangling tail all throw before
 * anything leaves the process. What it never looks at is what a `tool_result`
 * block *carries*. That block's content comes from the file's own `input()`,
 * which drops an empty text block, never passes `reasoning` or `tool-call`
 * blocks at that position, and turns images into handles. So a result whose
 * every block is dropped is serialized as
 *
 * ```json
 * {"type": "tool_result", "tool_use_id": "CALL_A", "content": []}
 * ```
 *
 * — a block the local invariant just declared paired, and one the endpoint does
 * not count as a result. The file documents the retention on purpose ("empty
 * tool results retain their call ids"), so this is not a crash: it is a shape
 * that satisfies the local rule and fails the remote one.
 *
 * That is also why an offline rebuild of the same session log cannot find it.
 * Rebuilding walks the same messages with the same rules and asks the same
 * id-shaped question, so it answers "paired" — the reconciliation agrees with
 * the serializer because it is the serializer's question. The information that
 * differs is on the wire, not in the log.
 *
 * ## Why it is a plugin
 *
 * A plugin cannot reach inside `input()` and does not need to. `llm/stream` is a
 * waterfall: a listener sees the whole request before the adapter does, and may
 * answer with a stream of its own. This one answers with a request in which
 * every empty tool result gained one non-empty text block, so the block the
 * conversation already had stays exactly where it was and the content it lacked
 * is supplied. Nothing is written to the session log, nothing is written to
 * disk, and the next request in that session is legal.
 *
 * ## What it does not claim
 *
 * - It repairs the **request**, not the producer. A tool that keeps returning
 *   nothing keeps producing empty results, and each one is repaired on its way
 *   out; making the history non-empty would be a core change.
 * - The placeholder is model-visible text. It says the truth — the tool returned
 *   no output — and it is one sentence, but it is a sentence the session did not
 *   previously contain (see `substitute.ts`).
 * - A provider that rejects an empty `content` array differently, or accepts it,
 *   is unaffected in substance: it receives the placeholder and ignores the
 *   distinction, which is what the repair is for.
 * - It cannot tell *why* a result is empty. A tool that legitimately produced
 *   nothing and a projection that dropped everything look identical here.
 *
 * @module @argszero/dsh-empty-tool-result-guard
 */
import { DEFAULT_TEXT, resolveConfig } from "./config.js";
import { installGuard } from "./guard.js";
/** Cordis plugin name used by loader diagnostics. */
export const name = 'empty-tool-result-guard';
/** The service whose dispatch this plugin stands in front of. */
export const inject = ['llm'];
/** The name under which the read-only view is provided. */
export const SERVICE = 'emptyToolResultGuard';
/** The properties this plugin is honest about not having. */
export const BLIND_SPOTS = [
    'It repairs the request, not the producer: a tool that returns nothing keeps producing empty results, and each one is repaired on its way out.',
    'The placeholder is model-visible text, one sentence longer than the conversation it replaces.',
    'It cannot tell why a result is empty: a tool that legitimately produced nothing and a projection that dropped every block look identical from here.',
    'It knows the blocks, not the adapter: if a route represents a block type this plugin counts as unrepresentable, the repair adds a sentence nothing needed.',
];
/**
 * Mount the plugin.
 * @param ctx - the context this plugin is mounted on.
 * @param config - what the operator wrote.
 */
export function apply(ctx, config = {}) {
    const settings = resolveConfig(config);
    const counters = { emptyResults: 0, repaired: 0, errors: 0 };
    const say = (level, message) => {
        if (!settings.logRepairs)
            return;
        if (level === 'warn')
            ctx.logger.warn(`empty-tool-result-guard: ${message}`);
        else if (level === 'info')
            ctx.logger.info(`empty-tool-result-guard: ${message}`);
        else
            ctx.logger.debug(`empty-tool-result-guard: ${message}`);
    };
    const service = {
        snapshot: () => ({
            mode: settings.mode,
            providers: settings.providers,
            emptyResults: counters.emptyResults,
            repaired: counters.repaired,
            errors: counters.errors,
            blindSpots: BLIND_SPOTS,
        }),
    };
    if (settings.mode === 'off') {
        say('info', 'mode is off: no listener is installed');
        ctx.provide(SERVICE, service);
        return;
    }
    installGuard(ctx, {
        observe: settings.mode === 'observe',
        providers: settings.providers,
        text: settings.text,
        onEmpty: (provider, callIds) => {
            counters.emptyResults += 1;
            say('debug', `${provider}: ${callIds.length} tool result(s) carry nothing `
                + `(${callIds.join(', ')})`);
        },
        onRepair: (provider, callIds) => {
            counters.repaired += 1;
            say('debug', `${provider}: dispatched with a placeholder for ${callIds.length} empty result(s)`);
        },
        onFailure: (error) => {
            counters.errors += 1;
            say('warn', `failed to inspect or repair one request and dispatched it unchanged: ${String(error)}`);
        },
    });
    say('info', `mounted in ${settings.mode} mode `
        + `(${settings.providers.length === 0 ? 'every provider route' : settings.providers.join(', ')}; `
        + 'seam: llm/stream)');
    ctx.provide(SERVICE, service);
}
export { DEFAULT_TEXT, resolveConfig } from "./config.js";
export { installGuard } from "./guard.js";
export { emptinessOf, representable } from "./representable.js";
export { EMPTY_RESULT_TEXT, substitution } from "./substitute.js";
/**
 * The object a loader entry mounts: the loader normalises a plugin module with
 * `exports.default ?? exports` and hands this to `ctx.plugin`.
 *
 * Deliberately no `Config` key — see the note in `config.ts`.
 */
export default { name, inject, apply };
