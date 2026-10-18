#!/usr/bin/env node
/**
 * Mount the plugin on a real cordis context, the way a loader entry would.
 *
 * The unit tests call the listener directly; this proves the module a loader
 * receives is the module that mounts: a default export carrying `name`,
 * `inject` and `apply`, an `apply` that registers on the real context without
 * throwing, and a read-only view that answers afterward.
 */
import { Context } from '@deepseek-ai/cordis'
import plugin from '../lib/index.js'

const ctx = new Context()
ctx.provide('llm', {
  stream: () => (async function* () { yield { kind: 'terminal' } })(),
})

const listener = []
ctx.on = new Proxy(ctx.on, {
  apply(target, thisArg, args) {
    listener.push({ event: args[0], options: args[2] })
    return Reflect.apply(target, thisArg, args)
  },
})

if (typeof plugin.apply !== 'function') throw new Error('the default export carries no apply')
plugin.apply(ctx, {})

if (listener.length !== 1) throw new Error(`expected one listener, got ${listener.length}`)
if (listener[0].event !== 'llm/stream') throw new Error(`listener registered on ${listener[0].event}`)
if (JSON.stringify(listener[0].options) !== JSON.stringify({ global: true, prepend: true })) {
  throw new Error(`listener options are ${JSON.stringify(listener[0].options)}`)
}

const service = ctx.get('emptyToolResultGuard')
const snapshot = service.snapshot()
console.log(`mounted: ${plugin.name} inject: ${JSON.stringify(plugin.inject)}`)
console.log(`listener: ${JSON.stringify(listener[0])}`)
console.log(`snapshot: ${JSON.stringify({ ...snapshot, blindSpots: snapshot.blindSpots.length })}`)
