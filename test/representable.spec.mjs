import assert from 'node:assert/strict'
import test from 'node:test'
import { emptinessOf, representable } from '../lib/representable.js'

/** One tool result message whose content is as given. */
function result(content) {
  return {
    id: 'm2',
    role: 'tool',
    toolCallId: 'CALL_A',
    content,
    source: { kind: 'tool', callId: 'CALL_A' },
  }
}

test('a text block survives when it carries something', () => {
  assert.equal(representable({ type: 'text', text: 'file contents' }), true)
  assert.equal(emptinessOf(result([{ type: 'text', text: 'file contents' }])), 'none')
})

test('an empty text block does not survive', () => {
  assert.equal(representable({ type: 'text', text: '' }), false)
  assert.equal(emptinessOf(result([{ type: 'text', text: '' }])), 'nothing-representable')
})

test('whitespace is content: the serializer keeps it', () => {
  // Measured on every released line: a single space is posted as text, so the
  // predicate must not treat it as empty or the repair would add a sentence
  // nothing needed.
  assert.equal(representable({ type: 'text', text: ' ' }), true)
  assert.equal(emptinessOf(result([{ type: 'text', text: ' ' }])), 'none')
})

test('reasoning and tool-call blocks never survive at this position', () => {
  assert.equal(representable({ type: 'reasoning', text: 'internal' }), false)
  assert.equal(representable({ type: 'tool-call', id: 'x', name: 'read', arguments: '{}' }), false)
  assert.equal(emptinessOf(result([
    { type: 'reasoning', text: 'internal' },
    { type: 'tool-call', id: 'x', name: 'read', arguments: '{}' },
  ])), 'nothing-representable')
})

test('an image survives', () => {
  const image = { type: 'image', attachmentId: 'att-1' }
  assert.equal(representable(image), true)
  assert.equal(emptinessOf(result([image])), 'none')
})

test('a block type this module does not know counts as surviving', () => {
  // `ContentBlock` is merge-extensible, so an unknown type is a block some
  // adapter added and may well send; calling it empty would insert text into a
  // request that was already legal.
  assert.equal(representable({ type: 'plugin-block', payload: 1 }), true)
})

test('no blocks at all is its own reading', () => {
  assert.equal(emptinessOf(result([])), 'no-blocks')
})

test('one surviving block is enough to call the result non-empty', () => {
  assert.equal(emptinessOf(result([
    { type: 'text', text: '' },
    { type: 'text', text: 'used 3 of 5' },
  ])), 'none')
})

test('the reading is over the whole list, not the first block', () => {
  assert.equal(emptinessOf(result([
    { type: 'reasoning', text: 'internal' },
    { type: 'text', text: 'ok' },
  ])), 'none')
})
