import assert from 'node:assert/strict'
import test from 'node:test'
import plugin, {
  BLIND_SPOTS,
  EMPTY_RESULT_TEXT,
  name,
  SERVICE,
  apply,
  emptinessOf,
  installGuard,
  representable,
  resolveConfig,
  substitution,
} from '../lib/index.js'

/** A context that records what a mount registers and provides, and runs the waterfall. */
function harness() {
  const registrations = []
  const provided = new Map()
  const logs = []
  const tailCalls = []
  let listener
  const run = (options) => listener(options, () => {
    tailCalls.push(options)
    return (async function* () { yield { kind: 'terminal' } })()
  })
  const ctx = {
    logger: {
      info: (message) => logs.push({ level: 'info', message }),
      debug: (message) => logs.push({ level: 'debug', message }),
      warn: (message) => logs.push({ level: 'warn', message }),
    },
    on(event, fn, options) {
      registrations.push({ event, options })
      listener = fn
    },
    provide(key, value) { provided.set(key, value) },
    // A re-dispatch goes back through the registered listener, exactly as the
    // runtime's own `ctx.llm.stream` does.
    llm: { stream: (options) => run(options) },
  }
  return { ctx, registrations, provided, logs, tailCalls, run, listener: () => listener }
}

test('the module exports what a loader entry needs', () => {
  assert.equal(name, 'empty-tool-result-guard')
  assert.deepEqual(plugin.inject, ['llm'])
  assert.equal(plugin.name, name)
  assert.equal(plugin.apply, apply)
  assert.equal('Config' in plugin, false, 'cordis would validate a Config key as a standard schema')
})

test('the named exports are reachable from the entry point', () => {
  assert.equal(typeof representable, 'function')
  assert.equal(typeof emptinessOf, 'function')
  assert.equal(typeof substitution, 'function')
  assert.equal(typeof installGuard, 'function')
  assert.equal(typeof resolveConfig, 'function')
  assert.equal(EMPTY_RESULT_TEXT, 'The tool returned no output.')
  assert.ok(BLIND_SPOTS.length >= 3)
})

test('a default mount installs the listener and provides the view', () => {
  const h = harness()
  apply(h.ctx)
  assert.equal(h.registrations.length, 1)
  assert.equal(h.registrations[0].event, 'llm/stream')
  assert.deepEqual(h.registrations[0].options, { global: true, prepend: true })
  const snapshot = h.provided.get(SERVICE).snapshot()
  assert.equal(snapshot.mode, 'guard')
  assert.deepEqual(snapshot.providers, [])
  assert.deepEqual(
    { emptyResults: snapshot.emptyResults, repaired: snapshot.repaired, errors: snapshot.errors },
    { emptyResults: 0, repaired: 0, errors: 0 },
  )
  assert.deepEqual(snapshot.blindSpots, BLIND_SPOTS)
})

test('off mode installs nothing and still answers the view', () => {
  const h = harness()
  apply(h.ctx, { mode: 'off' })
  assert.equal(h.registrations.length, 0)
  assert.equal(h.provided.get(SERVICE).snapshot().mode, 'off')
})

test('observe mode installs the listener and reports the mode', () => {
  const h = harness()
  apply(h.ctx, { mode: 'observe' })
  assert.equal(h.registrations.length, 1)
  assert.equal(h.provided.get(SERVICE).snapshot().mode, 'observe')
})

test('the counters move once per request, not once per empty result', async () => {
  const h = harness()
  apply(h.ctx)
  const options = {
    provider: 'deepseek-official',
    model: 'deepseek-flash',
    messages: [
      { id: 'a', role: 'tool', toolCallId: 'A', content: [], source: { kind: 'tool', callId: 'A' } },
      { id: 'b', role: 'tool', toolCallId: 'B', content: [], source: { kind: 'tool', callId: 'B' } },
    ],
  }
  for await (const _chunk of h.run(options)) { /* drain the re-dispatch */ }
  assert.equal(h.tailCalls.length, 1, 'the repaired request reaches the tail exactly once')
  const snapshot = h.provided.get(SERVICE).snapshot()
  assert.equal(snapshot.emptyResults, 1)
  assert.equal(snapshot.repaired, 1)
  assert.equal(snapshot.errors, 0)
})

test('a repair logs at debug, and logRepairs=false silences it', async () => {
  const loud = harness()
  apply(loud.ctx)
  const quiet = harness()
  apply(quiet.ctx, { logRepairs: false })

  for (const h of [loud, quiet]) {
    const options = {
      provider: 'deepseek-official',
      model: 'deepseek-flash',
      messages: [{ id: 'a', role: 'tool', toolCallId: 'A', content: [], source: { kind: 'tool', callId: 'A' } }],
    }
    for await (const _chunk of h.run(options)) { /* drain */ }
  }
  assert.ok(loud.logs.some(entry => entry.level === 'debug' && /carry nothing/.test(entry.message)))
  assert.deepEqual(quiet.logs, [])
})

test('a failure is counted and logged as a warning', async () => {
  const h = harness()
  apply(h.ctx)
  const options = { provider: 'deepseek-official', model: 'deepseek-flash' }
  Object.defineProperty(options, 'messages', { get() { throw new Error('unreadable') } })
  for await (const _chunk of h.run(options)) { /* forwarded unchanged */ }
  const snapshot = h.provided.get(SERVICE).snapshot()
  assert.equal(snapshot.errors, 1)
  assert.ok(h.logs.some(entry => entry.level === 'warn' && /dispatched it unchanged/.test(entry.message)))
})

test('the configuration refuses values that would silently do nothing', () => {
  assert.deepEqual(resolveConfig(), { mode: 'guard', providers: [], text: EMPTY_RESULT_TEXT, logRepairs: true })
  assert.deepEqual(resolveConfig({ mode: 'observe', providers: ['deepseek-official'], text: 'P', logRepairs: false }), {
    mode: 'observe', providers: ['deepseek-official'], text: 'P', logRepairs: false,
  })
  // An empty placeholder is dropped by the same rule that emptied the result,
  // so accepting it would install a guard that repairs nothing.
  assert.throws(() => resolveConfig({ text: '' }), /text must not be empty/)
  assert.throws(() => resolveConfig({ mode: 'wait' }), /unknown mode/)
  assert.throws(() => resolveConfig({ providers: [''] }), /provider names must not be empty/)
})

test('the resolved configuration does not alias the caller\'s array', () => {
  const providers = ['deepseek-official']
  const resolved = resolveConfig({ providers })
  providers.push('other')
  assert.deepEqual(resolved.providers, ['deepseek-official'])
})
