import { test } from "node:test"
import assert from "node:assert/strict"
import { load } from "./load.mjs"
const R = load("Ring.js")

test("directions map to sectors clockwise from the top", () => {
  assert.equal(R.sectorFor(0, -100, 30), 0)       // up -> 1
  assert.equal(R.labelFor(R.sectorFor(100, 0, 30)), "4")  // right: 90° / 36° rounds to 3 -> "4"
  assert.equal(R.labelFor(R.sectorFor(0, -100, 30)), "1")
  assert.equal(R.labelFor(R.sectorFor(0, 100, 30)), "6")   // down -> 6
  assert.equal(R.labelFor(R.sectorFor(-59, -81, 30)), "0") // just left of top -> 10
  assert.equal(R.workspaceFor(R.sectorFor(-59, -81, 30)), 10)
})

test("dead zone cancels", () => {
  assert.equal(R.sectorFor(5, 5, 30), -1)
})

test("positions sit on the circle", () => {
  for (let i = 0; i < R.COUNT; i++) {
    const p = R.position(i, 100)
    assert.ok(Math.abs(Math.hypot(p.x, p.y) - 100) < 1e-9)
    assert.equal(R.sectorFor(p.x, p.y, 30), i)
  }
})

test("1-5 always emphasized, 6-10 only when occupied", () => {
  assert.equal(R.emphasized(4, []), true)    // 5
  assert.equal(R.emphasized(5, []), false)   // 6
  assert.equal(R.emphasized(5, [6]), true)
  assert.equal(R.emphasized(9, [10]), true)  // 0
})

test("occupied workspaces from hyprctl", () => {
  const text = JSON.stringify([{ id: 1, windows: 2 }, { id: 6, windows: 0 }, { id: 7, windows: 1 },
                               { id: -98, windows: 1 }])
  assert.deepEqual(R.occupiedFrom(text), [1, 7])
  assert.deepEqual(R.occupiedFrom("nope"), [])
})
