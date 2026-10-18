#!/usr/bin/env node
/**
 * Break the plugin on purpose, one defect at a time, and require the suite to
 * notice each one.
 *
 * A green suite proves nothing about what the suite can see: an assertion that
 * never fails is indistinguishable from one that always passes. Each arm below
 * rewrites one decision the plugin makes, rebuilds, runs the whole suite and
 * expects a failure. An arm that survives means the suite has a hole where the
 * claim it protects should be.
 *
 * Builds use `--noEmitOnError` so a mutation that does not typecheck fails loud
 * rather than leaving the previous `lib/` in place — a mutant running on stale
 * output is the way a mutation run reports 8/8 while measuring nothing.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const backup = join(root, '.mutant-backup')

/** One defect: which file to rewrite, and what the rewrite says. */
const arms = [
  {
    name: 'whitespace counted as empty',
    file: 'src/representable.ts',
    from: "if (block.type === 'text') return block.text.length > 0",
    to: "if (block.type === 'text') return block.text.trim().length > 0",
  },
  {
    name: 'unknown block type counted as empty',
    file: 'src/representable.ts',
    from: '  if (block.type === \'reasoning\' || block.type === \'tool-call\') return false\n  return true',
    to: '  if (block.type === \'reasoning\' || block.type === \'tool-call\') return false\n  return false',
  },
  {
    name: 'reasoning counted as surviving',
    file: 'src/representable.ts',
    from: "if (block.type === 'reasoning' || block.type === 'tool-call') return false",
    to: "if (block.type === 'tool-call') return false",
  },
  {
    name: 'an empty content list read as carrying something',
    file: 'src/representable.ts',
    from: "  if (message.content.length === 0) return 'no-blocks'",
    to: "  if (message.content.length === 0) return 'none'",
  },
  {
    name: 'the placeholder appended instead of prepended',
    file: 'src/substitute.ts',
    from: 'return { ...message, content: [block, ...message.content] } as T',
    to: 'return { ...message, content: [...message.content, block] } as T',
  },
  {
    name: 'the substitution mutates the request it was given',
    file: 'src/substitute.ts',
    from: '  return { options: { ...options, messages }, callIds }',
    to: '  options.messages = messages\n  return { options, callIds }',
  },
  {
    name: 'the repair reaches the wire twice',
    file: 'src/guard.ts',
    from: '      dispatched.add(repair.options)',
    to: '      void dispatched',
  },
  {
    name: 'observe mode repairs anyway',
    file: 'src/guard.ts',
    from: '      if (policy.observe) return next()',
    to: '      if (policy.observe && false) return next()',
  },
  {
    name: 'the listener registers without prepend',
    file: 'src/guard.ts',
    from: '  }, { global: true, prepend: true })',
    to: '  }, { global: true })',
  },
  {
    name: 'a failing predicate is rethrown instead of failed open',
    file: 'src/guard.ts',
    from: '    } catch (error) {\n      policy.onFailure(error)\n      return next()\n    }\n    if (repair === undefined) return next()',
    to: '    } catch (error) {\n      throw error\n    }\n    if (repair === undefined) return next()',
  },
  {
    name: 'the provider filter ignored',
    file: 'src/guard.ts',
    from: '  const applies = (options: GenerateOptions): boolean =>\n    policy.providers.length === 0 || policy.providers.includes(options.provider)',
    to: '  const applies = (_options: GenerateOptions): boolean => true',
  },
  {
    name: 'the counters move per result instead of per request',
    file: 'src/index.ts',
    from: '      counters.emptyResults += 1',
    to: '      counters.emptyResults += callIds.length',
  },
  {
    name: 'an empty placeholder accepted by the configuration',
    file: 'src/config.ts',
    from: "  if (text.length === 0) throw new Error('empty-tool-result-guard: text must not be empty')",
    to: "  if (text.length < 0) throw new Error('empty-tool-result-guard: text must not be empty')",
  },
  {
    name: 'the off mode installs the listener anyway',
    file: 'src/index.ts',
    from: "  if (settings.mode === 'off') {",
    to: "  if (settings.mode === 'off' && false) {",
  },
]

/** Run a command, returning `{ ok, output }` instead of throwing. */
function run(command, args) {
  try {
    const stdout = execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: 'pipe' })
    return { ok: true, output: stdout }
  } catch (error) {
    return { ok: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

/** Restore `src` and rebuild, whatever happened. */
function restore() {
  rmSync(join(root, 'src'), { recursive: true, force: true })
  cpSync(join(backup, 'src'), join(root, 'src'), { recursive: true })
  const built = run('npx', ['tsc'])
  if (!built.ok) console.error(`restore: rebuild failed\n${built.output}`)
}

rmSync(backup, { recursive: true, force: true })
cpSync(join(root, 'src'), join(backup, 'src'), { recursive: true })

const results = []
try {
  for (const arm of arms) {
    const path = join(root, arm.file)
    const original = readFileSync(path, 'utf8')
    if (!original.includes(arm.from)) {
      results.push({ arm, verdict: 'ARM DOES NOT APPLY' })
      continue
    }
    writeFileSync(path, original.replace(arm.from, arm.to))
    try {
      const built = run('npx', ['tsc', '--noEmitOnError'])
      if (!built.ok) {
        results.push({ arm, verdict: 'CAUGHT (typecheck)' })
        continue
      }
      const tested = run('node', ['--test', 'test/'])
      results.push({ arm, verdict: tested.ok ? 'SURVIVED' : 'CAUGHT' })
    } finally {
      writeFileSync(path, original)
    }
  }
} finally {
  restore()
  rmSync(backup, { recursive: true, force: true })
}

let caught = 0
for (const { arm, verdict } of results) {
  if (verdict.startsWith('CAUGHT')) caught += 1
  console.log(`${verdict.padEnd(20)} ${arm.name}`)
}
console.log('')
console.log(`${caught}/${arms.length} arms caught`)
if (caught !== arms.length) {
  console.error('a surviving arm means the suite cannot see that defect')
  process.exit(1)
}
