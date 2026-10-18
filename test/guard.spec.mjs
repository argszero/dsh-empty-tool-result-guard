import assert from 'node:assert/strict'
import test from 'node:test'
import { installGuard } from '../lib/guard.js'

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

/** A request with one tool result carrying `content`. */
function request(content, provider = 'deepseek-official') {
  return { provider, model: 'deepseek-flash', messages: [result(content)] }
}

/** An async iterable that records nothing and ends immediately. */
const terminal = (label) => (async function* () { yield { kind: 'terminal', label } })()

/** Collect a whole stream. */
async function drain(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

/**
 * A context that records the registration and runs the waterfall by hand, so a
 * re-dispatch is observable: `next` is the tail, `stream` re-enters the
 * registered listener exactly as the runtime would.
 */
function harness(overrides = {}) {
  const registrations = []
  const nextCalls = []
  const streamCalls = []
  const policyCalls = { empty: [], repair: [], failure: [] }
  let listener
  const ctx = {
    logger: { info: () => {}, debug: () => {}, warn: () => {} },
    on(name, fn, options) {
      registrations.push({ name, options })
      listener = fn
    },
    llm: {
      stream(options) {
        streamCalls.push(options)
        return run(options)
      },
    },
  }
  const run = (options) => listener(options, () => {
    nextCalls.push(options)
    return terminal('upstream')
  })
  installGuard(ctx, {
    observe: false,
    providers: [],
    text: 'placeholder',
    onEmpty: (provider, callIds) => policyCalls.empty.push({ provider, callIds }),
    onRepair: (provider, callIds) => policyCalls.repair.push({ provider, callIds }),
    onFailure: (error) => policyCalls.failure.push(error),
    ...overrides,
  })
  return { registrations, nextCalls, streamCalls, policyCalls, run }
}

test('the listener registers globally and first', () => {
  const { registrations } = harness()
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].name, 'llm/stream')
  assert.deepEqual(registrations[0].options, { global: true, prepend: true })
})

test('a request whose results carry something goes straight through', async () => {
  const h = harness()
  const options = request([{ type: 'text', text: 'file contents' }])
  const chunks = await drain(h.run(options))
  assert.deepEqual(chunks, [{ kind: 'terminal', label: 'upstream' }])
  assert.equal(h.nextCalls.length, 1)
  assert.equal(h.streamCalls.length, 0)
  assert.deepEqual(h.policyCalls.empty, [])
  assert.deepEqual(h.policyCalls.repair, [])
})

test('an empty result is replaced, and the replacement is dispatched once', async () => {
  const h = harness()
  const chunks = await drain(h.run(request([])))
  assert.deepEqual(chunks, [{ kind: 'terminal', label: 'upstream' }])
  assert.equal(h.streamCalls.length, 1, 'exactly one re-dispatch')
  assert.equal(h.nextCalls.length, 1, 'the replacement reaches the tail exactly once')
  const dispatched = h.nextCalls[0]
  assert.deepEqual(dispatched.messages[0].content, [{ type: 'text', text: 'placeholder' }])
  assert.deepEqual(h.policyCalls.empty, [{ provider: 'deepseek-official', callIds: ['CALL_A'] }])
  assert.deepEqual(h.policyCalls.repair, [{ provider: 'deepseek-official', callIds: ['CALL_A'] }])
  assert.deepEqual(h.policyCalls.failure, [])
})

test('the re-dispatch is not itself repaired again', async () => {
  const h = harness()
  await drain(h.run(request([])))
  // One entry for the incoming request, one for the replacement: the guard
  // must recognise its own substitution, or the second pass would repair the
  // repaired request forever.
  assert.equal(h.nextCalls.length, 1)
  assert.equal(h.streamCalls.length, 1)
})

test('observe mode counts the emptiness and changes nothing', async () => {
  const h = harness({ observe: true })
  const options = request([])
  await drain(h.run(options))
  assert.equal(h.nextCalls.length, 1)
  assert.equal(h.nextCalls[0], options, 'the original request is what the tail receives')
  assert.equal(h.streamCalls.length, 0)
  assert.deepEqual(h.policyCalls.empty, [{ provider: 'deepseek-official', callIds: ['CALL_A'] }])
  assert.deepEqual(h.policyCalls.repair, [])
})

test('only the named providers are covered', async () => {
  const h = harness({ providers: ['deepseek-official'] })
  const options = request([], 'some-other-route')
  await drain(h.run(options))
  assert.equal(h.streamCalls.length, 0)
  assert.equal(h.nextCalls[0], options)
  assert.deepEqual(h.policyCalls.empty, [])
})

test('an empty provider list covers every route', async () => {
  const h = harness()
  await drain(h.run(request([], 'whatever')))
  assert.equal(h.streamCalls.length, 1)
})

test('a predicate that throws leaves the request alone', async () => {
  const h = harness()
  const options = { provider: 'deepseek-official', model: 'm' }
  Object.defineProperty(options, 'messages', {
    get() { throw new Error('unreadable') },
  })
  await drain(h.run(options))
  assert.equal(h.nextCalls.length, 1)
  assert.equal(h.streamCalls.length, 0)
  assert.equal(h.policyCalls.failure.length, 1)
  assert.match(String(h.policyCalls.failure[0]), /unreadable/)
})

test('a dispatch that throws leaves the original request to the tail', async () => {
  // The re-dispatch is the one step this guard cannot police, so a context
  // whose `stream` throws stands in for a runtime that refused the call.
  const registrations = []
  let listener
  const nextCalls = []
  const failures = []
  const ctx = {
    logger: { info: () => {}, debug: () => {}, warn: () => {} },
    on(name, fn, options) { registrations.push({ name, options }); listener = fn },
    llm: { stream() { throw new Error('dispatch refused') } },
  }
  installGuard(ctx, {
    observe: false,
    providers: [],
    text: 'placeholder',
    onEmpty: () => {},
    onRepair: () => {},
    onFailure: (error) => failures.push(error),
  })
  const options = request([])
  const chunks = await drain(listener(options, () => {
    nextCalls.push(options)
    return terminal('upstream')
  }))
  assert.deepEqual(chunks, [{ kind: 'terminal', label: 'upstream' }])
  assert.equal(nextCalls.length, 1)
  assert.equal(failures.length, 1)
  assert.match(String(failures[0]), /dispatch refused/)
})
