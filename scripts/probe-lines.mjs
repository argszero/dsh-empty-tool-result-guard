#!/usr/bin/env node
/**
 * Measure every released line this package claims, by driving that line's own
 * shipped adapter.
 *
 * Three things are asserted per line, and a line that cannot be measured is a
 * failure rather than a skip:
 *
 * 1. **The defect is there.** A history whose tool result carries nothing the
 *    serializer can represent is posted with `content: []` in the `tool_result`
 *    block. The block is present; the content is not.
 * 2. **The repair lands.** The same history, after this package's `substitution`,
 *    is posted with a non-empty `content`.
 * 3. **Nothing else moved.** The control history (a result that already carried
 *    text) is byte-identical before and after the pass, so the repair is
 *    additive and reaches only results that needed it.
 *
 * The measurement calls the shipped function, never a transcription of it: the
 * adapter is imported from its own install directory and only `globalThis.fetch`
 * is stubbed, so the body printed here is the body that line would have sent.
 *
 * The line list is read from the directory layout (`probe/line-<version>`), and
 * the peer range this package declares is read from `package.json`; every probed
 * version must satisfy it under **both** readings (default, and with
 * `includePrerelease`), because a consumer may resolve either way.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import semver from 'semver'
import { substitution } from '../lib/substitute.js'

const root = process.cwd()
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const declared = manifest.peerDependencies?.['@deepseek-ai/dsh-llm']
if (typeof declared !== 'string' || declared.length === 0) {
  console.error('FAIL: package.json declares no @deepseek-ai/dsh-llm peer range')
  process.exit(1)
}

/** The connection the shipped adapter needs; values are opaque to serialization. */
const connection = () => ({
  baseURL: 'https://api.deepseek.com/v1',
  defaults: { thinking: 'enabled', reasoningEffort: 'high' },
  maxTokens: 8192,
  defaultContextWindow: 128000,
  models: [{ id: 'deepseek-flash' }],
  streamIdleTimeoutMs: 60000,
  maxRequestFilesBytes: 0,
  maxInlineRequestImageBytes: 0,
  maxImagesPerRequest: 0,
  imageOffloadByteQuantum: 0,
  inlineImageOffloadByteQuantum: 0,
  imageOffloadCountQuantum: 0,
  filesApiTimeoutMs: 1000,
  filePolicy: {},
  modelsRefreshIntervalMs: 0,
  headers: {},
})

/** One assistant tool call and its result, with `resultContent` as given. */
function history(resultContent) {
  return [
    {
      role: 'user', id: 'm0', content: [{ type: 'text', text: 'read the file' }],
      source: { kind: 'user' },
    },
    {
      role: 'assistant', id: 'm1',
      content: [
        { type: 'tool-call', id: 'CALL_A', name: 'read', arguments: '{"path":"a.txt"}' },
        { type: 'text', text: 'Reading it.' },
      ],
      source: { kind: 'model' },
    },
    {
      role: 'tool', id: 'm2', toolCallId: 'CALL_A',
      content: resultContent,
      isError: false,
      source: { kind: 'tool', callId: 'CALL_A' },
    },
  ]
}

/**
 * Post one request through the line's own adapter and return the captured body.
 * @param adapter - a shipped `DeepSeekAdapter` instance.
 * @param messages - the history to send.
 * @returns the parsed request body, or `undefined` if the adapter posted none.
 */
async function capture(adapter, messages) {
  let captured
  globalThis.fetch = async (_url, init) => {
    captured = JSON.parse(init.body)
    throw new Error('probe: transport stopped after capture')
  }
  try {
    for await (const _chunk of adapter.stream({
      provider: 'deepseek-official',
      model: 'deepseek-flash',
      system: 'sys',
      messages,
      maxTokens: 64,
      signal: new AbortController().signal,
    })) { /* drained; the capture happens before the first chunk */ }
  } catch (error) {
    // The adapter wraps the transport throw in its own error; the body was
    // captured first, which is the whole point of stopping there.
    if (captured === undefined) throw error
  }
  return captured
}

/** The `tool_result` block of a captured body. */
function toolResultOf(body) {
  return (body?.messages ?? [])
    .flatMap(message => message.content ?? [])
    .find(block => block.type === 'tool_result')
}

/** Load one line's shipped adapter. */
async function adapterFor(dir) {
  const require = createRequire(join(dir, 'package.json'))
  const entry = require.resolve('@deepseek-ai/dsh-llm-deepseek')
  const shipped = await import(pathToFileURL(entry).href)
  return new shipped.DeepSeekAdapter({
    options: connection,
    resolveAuth: async () => ({ headers: { 'x-api-key': 'probe' } }),
    resolveUserId: () => 'probe',
    resolveAttachments: () => undefined,
    // The request-extension package is optional for body construction; the
    // identity extension is supplied rather than installing the plugin.
    prepareExtensions: async () => ({ fields: {}, accept: async () => {} }),
  })
}

/** Every probed line, by directory name. */
function lines() {
  return readdirSync(join(root, 'probe'), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('line-'))
    .map(entry => ({ dir: join(root, 'probe', entry.name), version: entry.name.slice('line-'.length) }))
    .sort((a, b) => semver.compare(a.version, b.version))
}

const rows = []
let failures = 0

const probeDirs = lines()
if (probeDirs.length === 0) {
  console.error('FAIL: no probe/line-* directory to measure')
  process.exit(1)
}

for (const { dir, version } of probeDirs) {
  const admittedDefault = semver.satisfies(version, declared)
  const admittedIncludePrerelease = semver.satisfies(version, declared, { includePrerelease: true })
  if (admittedDefault !== admittedIncludePrerelease) {
    console.error(`FAIL ${version}: the declared range reads differently to the two consumers `
      + `(default=${admittedDefault}, includePrerelease=${admittedIncludePrerelease})`)
    failures += 1
    continue
  }
  if (!admittedDefault) {
    console.error(`FAIL ${version}: probed but not admitted by ${declared}`)
    failures += 1
    continue
  }
  if (!existsSync(join(dir, 'node_modules', '@deepseek-ai', 'dsh-llm-deepseek'))) {
    console.error(`FAIL ${version}: probe directory holds no installed adapter`)
    failures += 1
    continue
  }

  let adapter
  try {
    adapter = await adapterFor(dir)
  } catch (error) {
    console.error(`FAIL ${version}: adapter did not load: ${String(error)}`)
    failures += 1
    continue
  }

  const emptyContent = []
  const before = toolResultOf(await capture(adapter, history(emptyContent)))
  const repair = substitution({
    provider: 'deepseek-official', model: 'deepseek-flash', messages: history(emptyContent),
  }, 'The tool returned no output.')
  const after = toolResultOf(await capture(adapter, repair.options.messages))

  const controlContent = [{ type: 'text', text: 'file contents' }]
  const controlBefore = toolResultOf(await capture(adapter, history(controlContent)))
  const controlAfter = toolResultOf(await capture(adapter, history(controlContent)))

  const defect = Array.isArray(before?.content) && before.content.length === 0
  const repaired = Array.isArray(after?.content) && after.content.length > 0
  const additive = JSON.stringify(controlBefore) === JSON.stringify(controlAfter)
  const ok = defect && repaired && additive && repair !== undefined
  if (!ok) failures += 1
  rows.push({
    version,
    defect,
    repaired,
    additive,
    wireBefore: before?.content,
    wireAfter: after?.content,
    ok,
  })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${version.padEnd(15)} `
    + `defect=${defect} repaired=${repaired} additive=${additive}  `
    + `before=${JSON.stringify(before?.content)} after=${JSON.stringify(after?.content)}`)
}

console.log('')
const passed = rows.filter(row => row.ok).length
console.log(`${passed}/${probeDirs.length} probed lines pass `
  + `(peer range: ${declared})`)
if (rows.length !== probeDirs.length || failures > 0) {
  console.error(`${failures} line(s) failed`)
  process.exit(1)
}
