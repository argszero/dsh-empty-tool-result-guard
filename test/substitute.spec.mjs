import assert from 'node:assert/strict'
import test from 'node:test'
import { EMPTY_RESULT_TEXT, substitution } from '../lib/substitute.js'

/** A request whose conversation holds one assistant tool call and one result. */
function request(resultContent) {
  return {
    provider: 'deepseek-official',
    model: 'deepseek-flash',
    system: 'sys',
    messages: [
      { id: 'm0', role: 'user', content: [{ type: 'text', text: 'read the file' }], source: { kind: 'user' } },
      {
        id: 'm1', role: 'assistant',
        content: [{ type: 'tool-call', id: 'CALL_A', name: 'read', arguments: '{"path":"a.txt"}' }],
        source: { kind: 'model' },
      },
      {
        id: 'm2', role: 'tool', toolCallId: 'CALL_A',
        content: resultContent, isError: false,
        source: { kind: 'tool', callId: 'CALL_A' },
      },
    ],
  }
}

test('a result that carries something is left alone', () => {
  const options = request([{ type: 'text', text: 'file contents' }])
  assert.equal(substitution(options, EMPTY_RESULT_TEXT), undefined)
})

test('a whitespace-only result is left alone', () => {
  assert.equal(substitution(request([{ type: 'text', text: ' ' }]), EMPTY_RESULT_TEXT), undefined)
})

test('an empty result gains one text block in front', () => {
  const repair = substitution(request([]), EMPTY_RESULT_TEXT)
  assert.notEqual(repair, undefined)
  assert.deepEqual(repair.callIds, ['CALL_A'])
  const repaired = repair.options.messages[2]
  assert.deepEqual(repaired.content, [{ type: 'text', text: EMPTY_RESULT_TEXT }])
})

test('the placeholder comes first, and the original blocks stay behind it', () => {
  const original = [
    { type: 'reasoning', text: 'internal' },
    { type: 'text', text: '' },
  ]
  const repair = substitution(request(original), 'placeholder here')
  const repaired = repair.options.messages[2]
  assert.deepEqual(repaired.content, [
    { type: 'text', text: 'placeholder here' },
    ...original,
  ])
})

test('the call id and every other field are preserved', () => {
  const options = request([])
  const repaired = substitution(options, EMPTY_RESULT_TEXT).options.messages[2]
  assert.equal(repaired.id, 'm2')
  assert.equal(repaired.role, 'tool')
  assert.equal(repaired.toolCallId, 'CALL_A')
  assert.equal(repaired.isError, false)
  assert.deepEqual(repaired.source, { kind: 'tool', callId: 'CALL_A' })
})

test('the input is not mutated', () => {
  const options = request([])
  const before = JSON.stringify(options)
  const repair = substitution(options, EMPTY_RESULT_TEXT)
  assert.equal(JSON.stringify(options), before, 'the request handed in must not change')
  assert.notEqual(repair.options, options)
  assert.notEqual(repair.options.messages, options.messages)
  assert.notEqual(repair.options.messages[2], options.messages[2])
})

test('every empty result is repaired, and only those are', () => {
  const options = request([{ type: 'text', text: 'kept' }])
  options.messages = [
    options.messages[0],
    {
      id: 'm1', role: 'assistant',
      content: [
        { type: 'tool-call', id: 'CALL_A', name: 'read', arguments: '{}' },
        { type: 'tool-call', id: 'CALL_B', name: 'read', arguments: '{}' },
      ],
      source: { kind: 'model' },
    },
    { id: 'm2', role: 'tool', toolCallId: 'CALL_A', content: [], source: { kind: 'tool', callId: 'CALL_A' } },
    { id: 'm3', role: 'tool', toolCallId: 'CALL_B', content: [{ type: 'text', text: 'kept' }], source: { kind: 'tool', callId: 'CALL_B' } },
  ]
  const repair = substitution(options, 'P')
  assert.deepEqual(repair.callIds, ['CALL_A'])
  assert.deepEqual(repair.options.messages[2].content, [{ type: 'text', text: 'P' }])
  assert.deepEqual(repair.options.messages[3].content, [{ type: 'text', text: 'kept' }])
})

test('messages of other roles are the same objects, untouched', () => {
  const options = request([])
  const repair = substitution(options, EMPTY_RESULT_TEXT)
  assert.equal(repair.options.messages[0], options.messages[0])
  assert.equal(repair.options.messages[1], options.messages[1])
  assert.equal(repair.options.system, options.system)
  assert.equal(repair.options.model, options.model)
})

test('a request with no tool messages is left alone', () => {
  const options = {
    provider: 'deepseek-official',
    model: 'deepseek-flash',
    messages: [{ id: 'm0', role: 'user', content: [], source: { kind: 'user' } }],
  }
  assert.equal(substitution(options, EMPTY_RESULT_TEXT), undefined)
})
