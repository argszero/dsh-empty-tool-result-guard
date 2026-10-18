/**
 * The listener: replace a request in which a tool result carries nothing.
 *
 * ## Why a listener at all
 *
 * The emptiness is created by the serializer, one layer below this one: the
 * waterfall hands the adapter a request whose tool results are content block
 * lists, and `input()` inside `serialize()` decides which of those blocks reach
 * the wire. A plugin cannot reach inside that function, and it does not need to:
 * `llm/stream` is a waterfall whose listener sees the whole request and may
 * return a stream of its own.
 *
 * ## Why it re-dispatches
 *
 * A loop-built request arrives deep-frozen — the waterfall's contract is that its
 * content is a pure function of the session log — and `next()` takes no argument.
 * The only way to hand the adapter a different request is to ask the runtime for
 * a stream of that request (`ctx.llm.stream(replacement)`), which re-enters this
 * same waterfall. Identity is what stops the recursion: every replacement this
 * plugin builds is recorded in a `WeakSet`, and a recorded request goes straight
 * to `next()`.
 *
 * There is no second trigger and no provider feedback here. The condition is
 * decidable from the request alone — a tool result whose blocks nothing can
 * represent — so a refusal-driven backstop would only add a way to react to
 * messages this plugin never claimed to classify.
 *
 * ## Fail-open, always
 *
 * A guard that swallowed a working model call would be a worse failure than the
 * one it prevents. The predicate, the substitution and the re-dispatch each run
 * behind a `try`: on a throw the original request goes to `next()`, a counter
 * moves, and a warning is logged.
 *
 * @module @argszero/dsh-empty-tool-result-guard/guard
 */
import type { Context } from '@deepseek-ai/cordis';
/** Where the listener reports what it did. */
export interface GuardPolicy {
    /** When true, everything is decided and counted, and nothing is changed. */
    readonly observe: boolean;
    /** Provider routes the guard applies to; empty means every route. */
    readonly providers: readonly string[];
    /** The block text prepended to each empty result. */
    readonly text: string;
    /** One request in which at least one tool result carried nothing. */
    readonly onEmpty: (provider: string, callIds: readonly string[]) => void;
    /** One request that was actually replaced. */
    readonly onRepair: (provider: string, callIds: readonly string[]) => void;
    /** One predicate, substitution or dispatch failure that was failed open. */
    readonly onFailure: (error: unknown) => void;
}
/**
 * Install the guard on the `llm/stream` waterfall.
 *
 * `global` because the stream is dispatched with the registry instance as the
 * listener's `this`, so a mount scoped to a profile must still cover it;
 * `prepend` so this sees the request before any listener that would forward it
 * unchanged.
 * @param ctx - the context to register on.
 * @param policy - where to report.
 */
export declare function installGuard(ctx: Context, policy: GuardPolicy): void;
//# sourceMappingURL=guard.d.ts.map