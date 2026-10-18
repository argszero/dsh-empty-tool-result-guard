/**
 * Build the request this guard would rather send.
 *
 * The substitution is additive and nothing else: a tool result that carries
 * nothing gets one non-empty text block in front of whatever it already held,
 * and every other message, field, block and array identity is left exactly as
 * the caller sent it. The call id is untouched — the conversation already
 * answered that call, and the repair supplies content, not identity.
 *
 * @module @argszero/dsh-empty-tool-result-guard/substitute
 */
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
/**
 * The text one repaired result carries.
 *
 * It states the fact the empty content already stated, in the form every
 * Messages-compatible endpoint accepts: the tool produced no output. It is a
 * sentence rather than an empty string because an empty block is dropped by the
 * same serializer rule that produced the emptiness in the first place.
 */
export declare const EMPTY_RESULT_TEXT = "The tool returned no output.";
/** What one substitution changed. */
export interface Repair {
    /** The request to dispatch instead; a new object, never a mutation. */
    readonly options: GenerateOptions;
    /** Call ids whose result gained the placeholder, in request order. */
    readonly callIds: readonly string[];
}
/**
 * Decide and build, in one pass.
 * @param options - the request as it reaches the waterfall.
 * @param text - the block text to prepend to each empty result.
 * @returns the repaired request, or `undefined` when nothing was empty.
 */
export declare function substitution(options: GenerateOptions, text: string): Repair | undefined;
//# sourceMappingURL=substitute.d.ts.map