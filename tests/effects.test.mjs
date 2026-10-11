import { test } from "node:test"
import assert from "node:assert/strict"
import { load } from "./load.mjs"
const E = load("Effects.js")

// A Canvas 2D context that records what is drawn and rejects bad values.
function mockCtx() {
  const calls = []
  const check = (name, args) => {
    for (const a of args) if (typeof a === "number") assert.ok(Number.isFinite(a), `${name}: ${args}`)
    calls.push(name)
  }
  const gradient = () => ({ addColorStop: (o, c) => { assert.ok(o >= 0 && o <= 1); assert.match(c, /^rgba\(\d+,\d+,\d+,[0-9.]+\)$/) } })
  const ctx = { calls }
  for (const m of ["save", "restore", "beginPath", "closePath", "moveTo", "lineTo", "arc", "stroke", "fill"])
    ctx[m] = (...a) => check(m, a)
  ctx.createRadialGradient = (...a) => { check("radial", a); return gradient() }
  ctx.createLinearGradient = (...a) => { check("linear", a); return gradient() }
  return ctx
}

const colors = { accent: { r: 0.48, g: 0.64, b: 0.97 }, fg: { r: 0.75, g: 0.79, b: 0.96 }, bg: { r: 0.1, g: 0.1, b: 0.15 } }
const ringState = (over = {}) => ({
  t: 2.7, still: false, cx: 300, cy: 300, slot: 66, deadzone: 50, outer: 420,
  rings: [{ radius: 165, count: 12, offset: 0 }, { radius: 241, count: 12, offset: 0 }, { radius: 317, count: 16, offset: 0 }],
  selected: { x: 0, y: -165 }, selectedAge: 0.4, openAge: 0.3, clock: 17, colors, ...over
})
const path = Array.from({ length: 60 }, (_, i) => ({ x: 100 + (i < 30 ? 0 : (i - 30) * 6), y: 100 + Math.min(i, 30) * 6 }))
const trailState = (over = {}) => ({
  t: 1.5, still: false, points: path, times: path.map((_, i) => 0.5 + i * 0.015), lineWidth: 4, colors, ...over
})

test("every style has names and draws ring and trail with finite numbers", () => {
  assert.equal(E.STYLES[0], "plain")
  assert.equal(E.STYLES.length, 11)
  for (const style of E.STYLES) {
    assert.ok(E.NAMES[style].en && E.NAMES[style].de, style)
    for (const over of [{}, { still: true }, { selected: null }, { rings: [{ radius: 165, count: 8, offset: 0 }] }]) {
      const ctx = mockCtx()
      E.drawRing(ctx, style, ringState(over))
      if (style === "plain") assert.equal(ctx.calls.length, 0)
      else assert.ok(ctx.calls.includes("stroke") || ctx.calls.includes("fill"), style)
    }
    for (const over of [{}, { still: true }, { times: [] }]) {
      const ctx = mockCtx()
      E.drawTrail(ctx, style, trailState(over))
      if (style === "plain") assert.equal(ctx.calls.length, 0)
      else assert.ok(ctx.calls.includes("stroke") || ctx.calls.includes("fill"), style)
    }
  }
})

test("unknown styles are plain; too little to draw draws nothing", () => {
  assert.equal(E.normalize("sparkle"), "plain")
  assert.equal(E.animated("plain"), false)
  assert.equal(E.animated("comets"), true)
  assert.equal(E.name("ink", "de_DE"), "Tinte im Wasser")
  const ctx = mockCtx()
  E.drawTrail(ctx, "comets", trailState({ points: [{ x: 1, y: 1 }] }))
  E.drawRing(ctx, "comets", ringState({ rings: [] }))
  assert.equal(ctx.calls.length, 0)
})

test("a still frame does not depend on the time", () => {
  for (const style of E.STYLES) {
    const a = mockCtx(), b = mockCtx()
    E.drawRing(a, style, ringState({ still: true, t: 1 }))
    E.drawRing(b, style, ringState({ still: true, t: 9 }))
    assert.deepEqual(a.calls, b.calls, style)
  }
})

test("helpers: deterministic randomness, rgba, tracks, turns", () => {
  assert.equal(E.rand(3, 1), E.rand(3, 1))
  assert.ok(E.rand(3, 1) >= 0 && E.rand(3, 1) < 1)
  assert.equal(E.rgba({ r: 1, g: 0, b: 0.5 }, 2), "rgba(255,0,128,1.000)")
  assert.deepEqual(E.tracks(ringState()).length, 3)
  // The L-shaped test path turns once.
  assert.equal(E.turnPoints(path, E.lengths(path)).length, 1)
})
