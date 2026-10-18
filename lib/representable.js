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
export function representable(block) {
    if (block.type === 'text')
        return block.text.length > 0;
    if (block.type === 'reasoning' || block.type === 'tool-call')
        return false;
    return true;
}
/**
 * Read one tool result without changing it.
 * @param message - the tool-role message about to be sent.
 * @returns `'none'` when the result carries something, otherwise which reading found it empty.
 */
export function emptinessOf(message) {
    if (message.content.length === 0)
        return 'no-blocks';
    for (const block of message.content)
        if (representable(block))
            return 'none';
    return 'nothing-representable';
}
