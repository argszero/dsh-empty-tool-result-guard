/**
 * Capture the real DeepSeek Messages request body for a history whose tool
 * result carries no representable content.
 *
 * The question: the shipped serializer keeps the `tool_result` block but drops
 * every block inside it that Messages cannot represent (`input()` in
 * serialize.ts removes empty text, and never passes reasoning or tool-call
 * blocks). Nothing in the serializer's id-only pairing invariant notices, and
 * its own doc comment says empty tool results "retain their call ids". So a
 * result whose content is entirely dropped reaches the wire as
 * `{"type":"tool_result","tool_use_id":X,"content":[]}`.
 *
 * This script drives the *shipped adapter* — not a transcription — stubs only
 * `globalThis.fetch`, and prints the body it would have posted.
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const line = process.argv[2] ?? 'line-0.2.1-rc.2'
const dir = join(process.cwd(), 'probe', line)
const require = createRequire(join(dir, 'package.json'))
const adapterPath = require.resolve('@deepseek-ai/dsh-llm-deepseek')
const shipped = await import(pathToFileURL(adapterPath).href)

const connection = {
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
}

const adapter = new shipped.DeepSeekAdapter({
  options: () => connection,
  resolveAuth: async () => ({ headers: { 'x-api-key': 'probe' } }),
  resolveUserId: () => 'probe',
  resolveAttachments: () => undefined,
  // The request-extension plugin is a separate package; without it the shipped
  // adapter still builds and posts the same body, so the probe supplies the
  // identity extension rather than installing the plugin.
  prepareExtensions: async () => ({ fields: {}, accept: async () => {} }),
})

/** One assistant tool call and its result, with `resultContent` as given. */
function history(resultContent) {
  return [
    { role: 'user', id: 'm0', content: [{ type: 'text', text: 'read the file' }], source: { kind: 'user' } },
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

const cases = {
  'non-empty text': [{ type: 'text', text: 'file contents' }],
  'empty array': [],
  'one empty text block': [{ type: 'text', text: '' }],
  'only non-representable blocks': [
    { type: 'reasoning', text: 'internal' },
    { type: 'tool-call', id: 'inner', name: 'x', arguments: '{}' },
  ],
  'whitespace-only text': [{ type: 'text', text: ' ' }],
}

let captured
let capturedCase
globalThis.fetch = async (_url, init) => {
  captured = JSON.parse(init.body)
  throw new Error('probe: transport stopped after capture')
}

for (const [label, content] of Object.entries(cases)) {
  captured = undefined
  capturedCase = label
  const options = {
    provider: 'deepseek-official',
    model: 'deepseek-flash',
    system: 'sys',
    messages: history(content),
    maxTokens: 64,
    signal: new AbortController().signal,
  }
  try {
    for await (const _chunk of adapter.stream(options)) { /* drained below */ }
  } catch (error) {
    // The adapter wraps a transport throw in its own LlmError; the capture has
    // already happened, which is the whole point of stopping there.
    if (captured === undefined) throw error
  }
  if (captured === undefined) {
    console.log(`${label.padEnd(32)} NO REQUEST BUILT`)
    continue
  }
  const toolResult = captured.messages
    .flatMap(message => message.content)
    .find(block => block.type === 'tool_result')
  console.log(`${label.padEnd(32)} ${JSON.stringify(toolResult)}`)
}

console.log('')
console.log('--- full wire for "empty array" ---')
captured = undefined
try {
  for await (const _chunk of adapter.stream({
    provider: 'deepseek-official', model: 'deepseek-flash', system: 'sys',
    messages: history([]), maxTokens: 64, signal: new AbortController().signal,
  })) { /* drained */ }
} catch (error) {
  if (captured === undefined) throw error
}
console.log(JSON.stringify(captured.messages, null, 2))
