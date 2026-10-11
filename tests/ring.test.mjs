import { test } from "node:test"
import assert from "node:assert/strict"
import { load } from "./load.mjs"
const R = load("Ring.js")
const S = load("Actions.js").RING_SLOTS

test("clock face: 12 Exposé, 1-5 right, 6 show desktop, 6-0 left", () => {
  assert.equal(S.length, 12)
  assert.equal(S[0].id, "expose")
  assert.equal(S[6].id, "show-desktop")
  assert.deepEqual(S.map(R.workspaceOf), [0, 1, 2, 3, 4, 5, 0, 6, 7, 8, 9, 10])
  assert.equal(R.workspaceLabel(10), "0")
})

test("directions map to slots clockwise from 12 o'clock", () => {
  assert.equal(R.sectorFor(0, -100, 30, 12), 0)   // up: Exposé
  assert.equal(R.sectorFor(100, 0, 30, 12), 3)   // right: 3 o'clock
  assert.equal(R.sectorFor(0, 100, 30, 12), 6)   // down: show desktop
  assert.equal(R.sectorFor(-100, 0, 30, 12), 9)  // left: 9 o'clock
  assert.equal(R.sectorFor(5, 5, 30, 12), -1)    // dead zone
})

test("positions sit on the circle and round-trip", () => {
  for (let i = 0; i < 12; i++) {
    const p = R.position(i, 100, 12)
    assert.ok(Math.abs(Math.hypot(p.x, p.y) - 100) < 1e-9)
    assert.equal(R.sectorFor(p.x, p.y, 30, 12), i)
  }
})

test("1-5 always emphasized, 6-10 only when occupied, other actions always", () => {
  assert.equal(R.emphasized(S[5], []), true)    // ws 5
  assert.equal(R.emphasized(S[7], []), false)   // ws 6
  assert.equal(R.emphasized(S[7], [6]), true)
  assert.equal(R.emphasized(S[0], []), true)    // Exposé
})

test("occupied workspaces from hyprctl", () => {
  const text = JSON.stringify([{ id: 1, windows: 2 }, { id: 6, windows: 0 }, { id: 7, windows: 1 },
                               { id: -98, windows: 1 }])
  assert.deepEqual(R.occupiedFrom(text), [1, 7])
  assert.deepEqual(R.occupiedFrom("nope"), [])
})

test("offset rings: slot 0 half a step after 12", () => {
  assert.equal(R.sectorFor(0, -100, 30, 12, 0.5), 0)        // 12:00 rounds to slot 0 (12:30)…
  const p = R.position(0, 100, 12, 0.5)
  assert.ok(p.x > 0 && p.y < 0)                              // …which sits right of the top
  for (let i = 0; i < 12; i++) {
    const q = R.position(i, 100, 12, 0.5)
    assert.equal(R.sectorFor(q.x, q.y, 30, 12, 0.5), i)
  }
})

test("layout: rings grow outwards and fit their slots", () => {
  const L = R.layout([12, 12, 24], 66, 165)
  assert.equal(L[0].radius, 165)
  assert.ok(L[1].radius >= L[0].radius + 66)
  assert.ok(L[2].radius >= L[1].radius + 66)
  // 24 slots of 66 px with a gap: circumference at least 24 × 66.
  assert.ok(2 * Math.PI * L[2].radius >= 24 * 66)
  assert.deepEqual(L.map(r => r.offset), [0, 0.5, 0])
  assert.equal(R.outerRadius(L, 66), L[2].radius + 33)
})

test("pick: distance chooses the ring, direction the slot", () => {
  const L = R.layout([12, 12], 76, 165)
  assert.equal(R.pick(0, -20, L, 50), null)                         // dead zone
  assert.deepEqual(R.pick(0, -165, L, 50), { ring: 0, index: 0 })   // ring 1 at 12
  const mid = (L[0].radius + L[1].radius) / 2
  assert.equal(R.pick(mid - 1, 0, L, 50).ring, 0)
  assert.equal(R.pick(mid + 1, 0, L, 50).ring, 1)
  const p = R.position(4, L[1].radius, 12, 0.5)
  assert.deepEqual(R.pick(p.x, p.y, L, 50), { ring: 1, index: 4 })
  assert.equal(R.pick(0, -2000, L, 50).ring, 1)                     // far out: still the outer ring
})

test("move slots name their target workspace, others none", () => {
  assert.equal(R.moveTargetOf({ type: "dispatch", id: "window-to-workspace-silent-10" }), 10)
  assert.equal(R.moveTargetOf({ type: "dispatch", id: "workspace-1" }), 0)
  assert.equal(R.moveTargetOf({ type: "none" }), 0)
})
