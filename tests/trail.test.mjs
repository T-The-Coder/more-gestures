import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

// Trail.js starts with the QML-only `.pragma library` line; strip it for node.
const file = join(dirname(fileURLToPath(import.meta.url)), "..", "Trail.js")
const source = readFileSync(file, "utf8").replace(/^\.pragma library\s*$/m, "")
const mod = { exports: {} }
new Function("module", source)(mod)
const T = mod.exports

const close = (a, b) => Math.abs(a - b) < 1e-6

test("path inside the ring is dropped entirely", () => {
  assert.deepEqual(T.clipStart([{ x: 0, y: 0 }, { x: 5, y: 0 }], 0, 0, 18), [])
})

test("path starts exactly on the ring edge", () => {
  const out = T.clipStart([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 40, y: 0 }], 0, 0, 18)
  assert.equal(out.length, 2)
  assert.ok(close(out[0].x, 18) && close(out[0].y, 0))
  assert.deepEqual(out[1], { x: 40, y: 0 })
})

test("diagonal exit lands on the circle", () => {
  const out = T.clipStart([{ x: 0, y: 0 }, { x: 30, y: 30 }], 0, 0, 18)
  assert.ok(close(Math.hypot(out[0].x, out[0].y), 18))
})

test("first point outside the ring is projected onto it", () => {
  const out = T.clipStart([{ x: 0, y: -50 }, { x: 0, y: -80 }], 0, 0, 18)
  assert.ok(close(out[0].x, 0) && close(out[0].y, -18))
  assert.equal(out.length, 3)
})

test("empty or missing input gives an empty path", () => {
  assert.deepEqual(T.clipStart([], 0, 0, 18), [])
  assert.deepEqual(T.clipStart(null, 0, 0, 18), [])
})

test("arrowhead points along the last stretch", () => {
  const head = T.arrowHead([{ x: 0, y: 0 }, { x: 100, y: 0 }], 10)
  assert.equal(head.length, 3)
  assert.deepEqual(head[1], { x: 100, y: 0 })
  // Both wings sit behind the tip (smaller x) and mirror each other across the line.
  assert.ok(head[0].x < 100 && head[2].x < 100)
  assert.ok(close(head[0].y, -head[2].y))
  assert.ok(close(Math.hypot(head[0].x - 100, head[0].y), 10))
})

test("arrowhead skips jitter right at the tip", () => {
  // Last step is a 1 px sideways wobble; direction must still come from the long leg.
  const head = T.arrowHead([{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 1, y: 100 }], 10)
  assert.ok(head[0].y < 100 && head[2].y < 100)
})

test("no arrowhead for a path that is too short", () => {
  assert.deepEqual(T.arrowHead([{ x: 3, y: 3 }], 10), [])
  assert.deepEqual(T.arrowHead([{ x: 3, y: 3 }, { x: 3, y: 3 }], 10), [])
})
