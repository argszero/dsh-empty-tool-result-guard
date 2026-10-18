/**
 * Decide, from one content block list, whether a tool result reaches the wire
 * carrying nothing.
 *
 * ## What the wire keeps
 *
 * `packages/llm/llm-deepseek/src/serialize.ts` turns a tool-role message into
 * exactly one `tool_result` block, whose `content` is built by that file's own
 * `input()`:
 *
 * ```ts
 * const input = (blocks) => blocks.flatMap((block) => {
 *   if (block.type === 'text') return block.text ? [{ type: 'text', text: block.text }] : []
 *   if (block.type === 'reasoning' || block.type === 'tool-call') return []
 *   if (block.type !== 'image') return unsupported(`user/tool-result content ${block.type}`)
 *   ...
 * })
 * ```
 *
 * So three shapes carry nothing: no blocks at all, only empty text blocks, or
 * only blocks that role cannot represent. The serializer documents the outcome
 * deliberately — "empty tool results retain their call ids" — and its pairing
 * invariant checks ids only, so the request goes out with
 * `{"type":"tool_result","tool_use_id":X,"content":[]}`.
 *
 * ## Why that matters
 *
 * A `tool_result` block whose content is empty is present in the array and
 * absent from the conversation: the endpoint answers
 * `tool_use ids were found without tool_result blocks immediately after`. The
 * call *is* answered, and the answer carries nothing, which is the one shape the
 * id-only check upstream cannot see and an offline rebuild of the same log
 * cannot distinguish either.
 *
 * @module @argszero/dsh-empty-tool-result-guard/representable
 */
import type { ContentBlock, ToolResultMessage } from '@deepseek-ai/dsh-llm';
/** Which reading found the result empty. */
export type Emptiness = 
/** Something in the list survives serialization. */
'none'
/** The message carries no content blocks at all. */
 | 'no-blocks'
/** Every block is one this position cannot represent. */
 | 'nothing-representable';
/**
 * Whether the block survives `serialize()`'s `input()` for a tool result.
 *
 * The rule is the serializer's, restated: a text block survives when its text is
 * not empty; `reasoning` and `tool-call` never survive in this position; an image
 * survives (it becomes a text handle plus image payload).
 *
 * A block type this module does not know counts as surviving. That is the
 * fail-open direction that matters here: a false "empty" would insert text into
 * a request that was already legal, while a false "carries something" is exactly
 * the status quo. `ContentBlock` is merge-extensible, so an unknown type is a
 * block some adapter added and may well send.
 * @param block - one content block of a tool result.
 * @returns whether the block reaches the wire.
 */
export declare function representable(block: ContentBlock): boolean;
/**
 * Read one tool result without changing it.
 * @param message - the tool-role message about to be sent.
 * @returns `'none'` when the result carries something, otherwise which reading found it empty.
 */
export declare function emptinessOf(message: ToolResultMessage): Emptiness;
//# sourceMappingURL=representable.d.ts.map