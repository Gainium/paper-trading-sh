import assert from 'assert'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Spec 006 §1.1: every copy of these packages that package-lock.json
 * resolves (the tree `npm ci` installs) must be at or above the first
 * patched version of its security advisory.
 *
 * Run: `npm test` (mocha).
 */
const FLOORS: Record<string, string> = {
  'body-parser': '2.4.0',
  multer: '2.5.0',
  'fast-uri': '3.1.9',
}

const cmp = (a: string, b: string) => {
  const pa = a.split('.').map((n) => parseInt(n, 10))
  const pb = b.split('.').map((n) => parseInt(n, 10))
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i]
  }
  return 0
}

describe('§1.1 lockfile dependency floors', () => {
  const lock = JSON.parse(
    readFileSync(join(__dirname, '..', 'package-lock.json'), 'utf8'),
  ) as { packages: Record<string, { version?: string }> }

  for (const [name, floor] of Object.entries(FLOORS)) {
    it(`every resolved ${name} is >= ${floor}`, () => {
      const copies = Object.entries(lock.packages).filter(([path]) =>
        path.endsWith(`node_modules/${name}`),
      )
      assert.ok(copies.length > 0, `${name} not in lockfile`)
      for (const [path, entry] of copies) {
        assert.ok(
          cmp(entry.version ?? '0.0.0', floor) >= 0,
          `${path}@${entry.version} is below ${floor}`,
        )
      }
    })
  }
})
