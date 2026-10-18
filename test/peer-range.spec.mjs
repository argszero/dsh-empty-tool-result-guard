/**
 * The peer range, read the way its consumers read it.
 *
 * `@deepseek-ai/dsh-llm` publishes prereleases only (every released version
 * carries a `-rc.N` or `-alpha.N` tag), and two consumers read a range
 * differently: semver's default reading excludes a prerelease unless the
 * comparator beside it names the same `major.minor.patch` tuple, while
 * `includePrerelease` does not. A community plugin therefore has to declare a
 * range whose admitted set is the same under both readings — otherwise it
 * installs silently for one consumer and fails `ERESOLVE` for the other.
 *
 * This test asserts both sides of that: the lines we claim are admitted, and
 * the neighbours we do not are refused, under both readings.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import semver from 'semver'

const manifest = JSON.parse(new TextDecoder().decode(
  new Uint8Array(readFileSync(new URL('../package.json', import.meta.url))),
))
const declared = manifest.peerDependencies['@deepseek-ai/dsh-llm']

/** The two ways a consumer may read the same range string. */
const readings = {
  default: (version) => semver.satisfies(version, declared),
  includePrerelease: (version) => semver.satisfies(version, declared, { includePrerelease: true }),
}

test('the declaration is a union of one segment per line', () => {
  assert.equal(typeof declared, 'string')
  const segments = declared.split('||').map(segment => segment.trim())
  assert.deepEqual(segments, [
    '>=0.1.7-rc.2 <0.1.8-0',
    '>=0.2.0-rc.1 <0.2.1-0',
    '>=0.2.1-alpha.1 <0.2.2-0',
  ])
  for (const segment of segments) {
    // One comparator per tuple: `>a <b` inside the same line, never a bare `^`.
    assert.match(segment, /^>=[\d.]+-[a-z]+\.\d+ <[\d.]+-0$/, segment)
  }
})

test('every released line this package claims is admitted by both readings', () => {
  const claimed = [
    '0.1.7-rc.2',
    '0.2.0-rc.1',
    '0.2.0-rc.2',
    '0.2.1-alpha.1',
    '0.2.1-alpha.2',
    '0.2.1-alpha.3',
    '0.2.1-alpha.4',
    '0.2.1-alpha.5',
    '0.2.1-rc.1',
    '0.2.1-rc.2',
  ]
  for (const version of claimed) {
    assert.equal(readings.default(version), true, `${version} must be admitted by default reading`)
    assert.equal(readings.includePrerelease(version), true, `${version} must be admitted with includePrerelease`)
  }
})

test('the neighbours on either side are refused by both readings', () => {
  const refused = [
    '0.0.1-rc.5',
    '0.1.6-alpha.2',
    '0.1.6',
    '0.1.7-alpha.2',
    '0.1.7-rc.1',
    '0.1.8-0',
    '0.1.8-rc.1',
    '0.1.8',
    '0.1.9-rc.1',
    '0.2.2-alpha.1',
    '0.2.2',
    '0.3.0-rc.1',
    '1.0.0',
  ]
  for (const version of refused) {
    assert.equal(readings.default(version), false, `${version} must be refused by default reading`)
    assert.equal(readings.includePrerelease(version), false, `${version} must be refused with includePrerelease`)
  }
})

test('the stable versions inside the claimed lines are admitted, not refused', () => {
  // A stable release of a claimed line is not a new line: `0.1.7`, `0.2.0` and
  // `0.2.1` all fall inside a segment, and refusing them would turn a consumer's
  // ordinary upgrade into a broken install.
  for (const version of ['0.1.7', '0.2.0', '0.2.1']) {
    assert.equal(readings.default(version), true, version)
    assert.equal(readings.includePrerelease(version), true, version)
  }
})

test('the two readings never disagree across a sweep of the version space', () => {
  // Every tuple a consumer could plausibly resolve, each with the prerelease
  // tags a published line actually uses. This is the law the range exists for:
  // the admitted set must not depend on which reading the consumer picked.
  const tuples = ['0.1.5', '0.1.6', '0.1.7', '0.1.8', '0.1.9', '0.2.0', '0.2.1', '0.2.2', '0.2.3', '0.3.0']
  const tags = ['-0', '-alpha.0', '-alpha.1', '-alpha.9', '-beta.1', '-rc.1', '-rc.2', '-rc.9', '']
  let agreed = 0
  for (const tuple of tuples) {
    for (const tag of tags) {
      const version = `${tuple}${tag}`
      const byDefault = readings.default(version)
      const byIncludePrerelease = readings.includePrerelease(version)
      assert.equal(
        byDefault,
        byIncludePrerelease,
        `the two consumers disagree about ${version} (default=${byDefault}, includePrerelease=${byIncludePrerelease})`,
      )
      agreed += 1
    }
  }
  assert.equal(agreed, tuples.length * tags.length)
})

test('a prerelease inside a claimed tuple is admitted', () => {
  // `0.2.1-alpha.1.1` sits inside the claimed 0.2.1 tuple; a range that refused
  // it would be refusing a patch-level prerelease of a line it claims.
  assert.equal(readings.default('0.2.1-alpha.1.1'), true)
  assert.equal(readings.includePrerelease('0.2.1-alpha.1.1'), true)
})

test('the sweep is not vacuous: it contains both answers', () => {
  const versions = [
    '0.1.6', '0.1.7-rc.2', '0.2.0-rc.1', '0.2.0', '0.2.1-alpha.1', '0.2.1-rc.2', '0.2.1',
    '0.2.2-alpha.1', '0.2.2', '0.3.0',
  ]
  const admitted = versions.filter(readings.default)
  const refused = versions.filter(version => !readings.default(version))
  assert.ok(admitted.length > 0 && refused.length > 0)
})
