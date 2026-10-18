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

import type { ContentBlock, GenerateOptions, RequestMessage } from '@deepseek-ai/dsh-llm'
import { emptinessOf } from './representable.ts'

/**
 * The text one repaired result carries.
 *
 * It states the fact the empty content already stated, in the form every
 * Messages-compatible endpoint accepts: the tool produced no output. It is a
 * sentence rather than an empty string because an empty block is dropped by the
 * same serializer rule that produced the emptiness in the first place.
 */
export const EMPTY_RESULT_TEXT = 'The tool returned no output.'

/** What one substitution changed. */
export interface Repair {
  /** The request to dispatch instead; a new object, never a mutation. */
  readonly options: GenerateOptions
  /** Call ids whose result gained the placeholder, in request order. */
  readonly callIds: readonly string[]
}

/**
 * Replace one tool result's content with the same content plus the placeholder.
 * @param message - the empty tool result.
 * @param text - the block text to prepend.
 * @returns a new message; the original is untouched.
 */
function withText<T extends RequestMessage & { readonly role: 'tool' }>(message: T, text: string): T {
  const block: ContentBlock = { type: 'text', text }
  return { ...message, content: [block, ...message.content] } as T
}

/**
 * Decide and build, in one pass.
 * @param options - the request as it reaches the waterfall.
 * @param text - the block text to prepend to each empty result.
 * @returns the repaired request, or `undefined` when nothing was empty.
 */
export function substitution(options: GenerateOptions, text: string): Repair | undefined {
  const callIds: string[] = []
  let changed = false
  const messages = options.messages.map((message) => {
    if (message.role !== 'tool') return message
    if (emptinessOf(message) === 'none') return message
    changed = true
    callIds.push(message.toolCallId)
    return withText(message, text)
  })
  if (!changed) return undefined
  return { options: { ...options, messages }, callIds }
}
