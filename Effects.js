.pragma library

// Looks for the ring menu and the gesture trail ("Style" in Settings › Ring menu). Each
// style draws onto a Canvas 2D context: drawRing() behind the ring's slots, drawTrail()
// instead of the plain line. Pure functions of their state: no timers, no randomness
// that is not derived from an index (rand), so a frame depends only on the time `t` and
// the geometry, and the same file runs under `node --test` with a recording context.
//
// Ring state:  { t, still, cx, cy, rings: [{ radius, count, offset }], slot, deadzone,
//                outer, selected: { x, y } | null (relative to the centre),
//                selectedAge, openAge, clock (seconds in the minute), colors }
// Trail state: { t, still, points: [{ x, y }], times: [seconds], lineWidth, colors }
// colors: { accent, fg, bg } as { r, g, b } in 0..1 (QML colors have these fields).
//
// `still` (Settings › General › Animations off): one calm frame, nothing moves.

var STYLES = ["plain", "comets", "clouds", "radar", "orbits", "ink", "neon", "pulse",
              "clockwork", "aurora", "fireflies"]

var NAMES = {
  plain:     { en: "Plain", de: "Schlicht" },
  comets:    { en: "Comets", de: "Kometen" },
  clouds:    { en: "Drifting clouds", de: "Wandernde Wolken" },
  radar:     { en: "Radar", de: "Radar" },
  orbits:    { en: "Orbits", de: "Umlaufbahnen" },
  ink:       { en: "Ink in water", de: "Tinte im Wasser" },
  neon:      { en: "Neon", de: "Neon" },
  pulse:     { en: "Pulse", de: "Puls" },
  clockwork: { en: "Clockwork", de: "Uhrwerk" },
  aurora:    { en: "Aurora", de: "Polarlicht" },
  fireflies: { en: "Fireflies", de: "Glühwürmchen" }
}

function normalize(style) { return STYLES.indexOf(style) >= 0 ? style : "plain" }
function name(style, lang) {
  var n = NAMES[normalize(style)]
  return String(lang || "en").toLowerCase().indexOf("de") === 0 ? n.de : n.en
}
// Whether a style moves at all (the overlay only runs its frame timer then).
function animated(style) { return normalize(style) !== "plain" }

// ------------------------------------------------------------------- helpers

// Deterministic pseudo-random number in [0, 1) for an index and a salt.
function rand(i, salt) {
  var x = Math.sin((i + 1) * 12.9898 + (salt || 0) * 78.233) * 43758.5453
  return x - Math.floor(x)
}

function rgba(c, a) {
  var r = Math.round(clamp01(c && c.r) * 255), g = Math.round(clamp01(c && c.g) * 255), b = Math.round(clamp01(c && c.b) * 255)
  return "rgba(" + r + "," + g + "," + b + "," + Math.max(0, Math.min(1, a)).toFixed(3) + ")"
}
function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)) }
function mix(a, b, f) { return { r: a.r + (b.r - a.r) * f, g: a.g + (b.g - a.g) * f, b: a.b + (b.b - a.b) * f } }

// Clock angle (0 = 12 o'clock, clockwise) and radius -> point.
function polar(cx, cy, r, a) { return { x: cx + Math.sin(a) * r, y: cy - Math.cos(a) * r } }

// Circles the effects run on: halfway between two rings, and the outer edge.
function tracks(s) {
  var out = []
  for (var i = 0; i + 1 < s.rings.length; i++) out.push((s.rings[i].radius + s.rings[i + 1].radius) / 2)
  if (s.rings.length) out.push(s.rings[s.rings.length - 1].radius + s.slot * 0.62)
  return out
}

// Slot angles of a ring.
function slotAngle(ring, i) { return (i + (ring.offset || 0)) * 2 * Math.PI / ring.count }

function circle(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, Math.max(0.1, r), 0, 2 * Math.PI) }

function glow(ctx, x, y, r, c, a) {
  var g = ctx.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, rgba(c, a))
  g.addColorStop(1, rgba(c, 0))
  ctx.fillStyle = g
  circle(ctx, x, y, r)
  ctx.fill()
}

function angleDiff(a, b) {
  var d = (a - b) % (2 * Math.PI)
  return d < 0 ? d + 2 * Math.PI : d
}

// Path length up to each point.
function lengths(points) {
  var out = [0]
  for (var i = 1; i < points.length; i++)
    out.push(out[i - 1] + Math.sqrt(Math.pow(points[i].x - points[i - 1].x, 2) + Math.pow(points[i].y - points[i - 1].y, 2)))
  return out
}

function polyline(ctx, points, from, to) {
  ctx.beginPath()
  ctx.moveTo(points[from].x, points[from].y)
  for (var i = from + 1; i <= to; i++) ctx.lineTo(points[i].x, points[i].y)
}

// ------------------------------------------------------------------ the ring

function drawRing(ctx, style, s) {
  var st = normalize(style)
  if (st === "plain" || !s || !s.rings || !s.rings.length) return
  var t = s.still ? 1.3 : s.t
  ctx.save()
  RING[st](ctx, s, t)
  ctx.restore()
}

var RING = {
  // A bright dot runs clockwise on every track with a fading tail, each track at its own
  // speed; a slot it passes flashes.
  comets: function (ctx, s, t) {
    var tr = tracks(s)
    ctx.lineCap = "round"
    for (var k = 0; k < tr.length; k++) {
      ctx.strokeStyle = rgba(s.colors.fg, 0.08)
      ctx.lineWidth = 1
      circle(ctx, s.cx, s.cy, tr[k]); ctx.stroke()
      var speed = 0.32 - 0.07 * k                         // revolutions per second
      var head = rand(k, 3) * 2 * Math.PI + t * speed * 2 * Math.PI
      var tail = 1.6
      for (var j = 0; j < 28; j++) {
        var f = j / 28
        ctx.strokeStyle = rgba(s.colors.accent, f * 0.7)
        ctx.lineWidth = 1 + f * 3
        ctx.beginPath()
        var a0 = head - tail * (1 - f), a1 = head - tail * (1 - (j + 1) / 28)
        ctx.arc(s.cx, s.cy, tr[k], a0 - Math.PI / 2, a1 - Math.PI / 2)
        ctx.stroke()
      }
      var p = polar(s.cx, s.cy, tr[k], head)
      glow(ctx, p.x, p.y, 12, s.colors.accent, 0.9)
      glow(ctx, p.x, p.y, 4, s.colors.fg, 1)
      // Flash on the slots of the ring inside this track.
      var ring = s.rings[Math.min(k, s.rings.length - 1)]
      for (var i = 0; i < ring.count; i++) {
        var d = angleDiff(head, slotAngle(ring, i))
        if (d < 0.5) {
          var q = polar(s.cx, s.cy, ring.radius, slotAngle(ring, i))
          glow(ctx, q.x, q.y, s.slot * 0.6, s.colors.accent, 0.35 * (1 - d / 0.5))
        }
      }
    }
  },

  // Soft blobs drift slowly behind the slots; the slot under the pointer gets a light patch.
  clouds: function (ctx, s, t) {
    var span = s.outer - s.deadzone
    for (var i = 0; i < 8; i++) {
      var a = rand(i, 1) * 2 * Math.PI + t * (0.04 + rand(i, 2) * 0.05) * (i % 2 ? 1 : -1)
      var r = s.deadzone + span * (0.25 + 0.7 * rand(i, 4)) + Math.sin(t * 0.3 + i) * span * 0.06
      var p = polar(s.cx, s.cy, r, a)
      glow(ctx, p.x, p.y, s.slot * (1.4 + rand(i, 5)), i % 3 ? s.colors.accent : s.colors.fg, 0.16)
    }
    if (s.selected)
      glow(ctx, s.cx + s.selected.x, s.cy + s.selected.y, s.slot * 1.1, s.colors.fg, 0.22 * Math.min(1, s.selectedAge * 4))
  },

  // A beam sweeps around; slots light up as it passes and fade behind it.
  radar: function (ctx, s, t) {
    var sweep = t * 0.45 * 2 * Math.PI
    ctx.lineWidth = 1
    var rs = tracks(s)
    for (var k = 0; k < s.rings.length; k++) rs.push(s.rings[k].radius)
    for (var c = 0; c < rs.length; c++) {
      ctx.strokeStyle = rgba(s.colors.accent, 0.12)
      circle(ctx, s.cx, s.cy, rs[c]); ctx.stroke()
    }
    for (var w = 0; w < 30; w++) {
      var a1 = sweep - w * 0.035, a0 = a1 - 0.035
      ctx.fillStyle = rgba(s.colors.accent, 0.22 * (1 - w / 30))
      ctx.beginPath()
      ctx.moveTo(s.cx, s.cy)
      ctx.arc(s.cx, s.cy, s.outer, a0 - Math.PI / 2, a1 - Math.PI / 2)
      ctx.closePath()
      ctx.fill()
    }
    var e = polar(s.cx, s.cy, s.outer, sweep)
    ctx.strokeStyle = rgba(s.colors.accent, 0.8)
    ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.moveTo(s.cx, s.cy); ctx.lineTo(e.x, e.y); ctx.stroke()
    for (var k2 = 0; k2 < s.rings.length; k2++) {
      var ring = s.rings[k2]
      for (var i = 0; i < ring.count; i++) {
        var d = angleDiff(sweep, slotAngle(ring, i))
        if (d < 1.2) {
          var q = polar(s.cx, s.cy, ring.radius, slotAngle(ring, i))
          glow(ctx, q.x, q.y, s.slot * 0.55, s.colors.accent, 0.4 * (1 - d / 1.2))
        }
      }
    }
  },

  // Small planets circle on every track, one per slot, neighbouring tracks in opposite
  // directions; stars twinkle behind them.
  orbits: function (ctx, s, t) {
    for (var i = 0; i < 46; i++) {
      var a = rand(i, 7) * 2 * Math.PI
      var r = s.deadzone + (s.outer - s.deadzone) * rand(i, 8)
      var p = polar(s.cx, s.cy, r, a)
      ctx.fillStyle = rgba(s.colors.fg, 0.15 + 0.3 * (0.5 + 0.5 * Math.sin(t * 2 + i * 1.7)))
      circle(ctx, p.x, p.y, 0.8 + rand(i, 9)); ctx.fill()
    }
    var tr = tracks(s)
    for (var k = 0; k < tr.length; k++) {
      ctx.strokeStyle = rgba(s.colors.fg, 0.07)
      ctx.lineWidth = 1
      circle(ctx, s.cx, s.cy, tr[k]); ctx.stroke()
      var ring = s.rings[Math.min(k, s.rings.length - 1)]
      var dir = k % 2 ? -1 : 1
      for (var j = 0; j < ring.count; j++) {
        var b = slotAngle(ring, j + 0.5) + dir * t * 0.12
        var q = polar(s.cx, s.cy, tr[k], b)
        glow(ctx, q.x, q.y, 7, s.colors.accent, 0.5)
        ctx.fillStyle = rgba(j % 3 ? s.colors.accent : s.colors.fg, 0.95)
        circle(ctx, q.x, q.y, 2.2 + (j % 3 === 0 ? 0.8 : 0)); ctx.fill()
      }
    }
  },

  // The colour seeps out from the centre like ink in water when the ring opens; the slot
  // under the pointer spreads a drop.
  ink: function (ctx, s, t) {
    var open = s.still ? 1 : Math.min(1, s.openAge / 0.6)
    var ease = 1 - Math.pow(1 - open, 3)
    var R = s.outer * 1.02 * ease
    ctx.beginPath()
    for (var i = 0; i <= 72; i++) {
      var a = i / 72 * 2 * Math.PI
      var r = R * (1 + 0.05 * Math.sin(5 * a + t * 0.8) + 0.035 * Math.sin(9 * a - t * 1.3))
      var p = polar(s.cx, s.cy, r, a)
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y)
    }
    ctx.closePath()
    var g = ctx.createRadialGradient(s.cx, s.cy, 0, s.cx, s.cy, Math.max(1, R))
    g.addColorStop(0, rgba(s.colors.accent, 0.05))
    g.addColorStop(0.75, rgba(s.colors.accent, 0.16))
    g.addColorStop(1, rgba(s.colors.accent, 0.04))
    ctx.fillStyle = g
    ctx.fill()
    if (s.selected) {
      var grow = s.still ? 1 : Math.min(1, s.selectedAge / 0.35)
      glow(ctx, s.cx + s.selected.x, s.cy + s.selected.y, s.slot * (0.4 + 0.8 * grow), s.colors.accent, 0.45)
    }
  },

  // Neon tubes on the tracks and rings, flickering on one after the other; the slot under
  // the pointer gets a neon frame.
  neon: function (ctx, s, t) {
    var tr = tracks(s)
    for (var k = 0; k < tr.length; k++) {
      var on = s.still || s.openAge > 0.12 + k * 0.12
      var flicker = !s.still && s.openAge < 0.5 + k * 0.12 && rand(Math.floor(t * 25), k) < 0.4
      var a = on && !flicker ? 1 : 0.15
      tube(ctx, s.cx, s.cy, tr[k], s.colors, a, t)
    }
    if (s.selected) tube(ctx, s.cx + s.selected.x, s.cy + s.selected.y, s.slot * 0.56, s.colors, 1, t)
  },

  // Rings of light run outwards from the centre; the slot under the pointer beats along.
  pulse: function (ctx, s, t) {
    for (var j = 0; j < 3; j++) {
      var f = ((t * 0.7 + j / 3) % 1 + 1) % 1
      ctx.strokeStyle = rgba(s.colors.accent, 0.4 * (1 - f))
      ctx.lineWidth = 2 + 4 * (1 - f)
      circle(ctx, s.cx, s.cy, s.deadzone + (s.outer - s.deadzone) * f); ctx.stroke()
    }
    if (s.selected) {
      var beat = 1 + 0.18 * Math.max(0, Math.sin(t * 2 * Math.PI * 1.2))
      ctx.strokeStyle = rgba(s.colors.accent, 0.8)
      ctx.lineWidth = 2
      circle(ctx, s.cx + s.selected.x, s.cy + s.selected.y, s.slot * 0.55 * beat); ctx.stroke()
    }
  },

  // A watch face: rows of ticks turning slowly against each other, and a second hand.
  clockwork: function (ctx, s, t) {
    var tr = tracks(s)
    for (var k = 0; k < tr.length; k++) {
      var turn = (k % 2 ? -1 : 1) * t * 0.05
      for (var i = 0; i < 60; i++) {
        var a = i / 60 * 2 * Math.PI + turn
        var long = i % 5 === 0
        var p0 = polar(s.cx, s.cy, tr[k] - (long ? 6 : 3), a), p1 = polar(s.cx, s.cy, tr[k] + (long ? 6 : 3), a)
        ctx.strokeStyle = rgba(s.colors.fg, long ? 0.35 : 0.18)
        ctx.lineWidth = long ? 1.6 : 1
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke()
      }
    }
    var sec = s.still ? 10 : (s.clock || 0)
    var h = sec / 60 * 2 * Math.PI
    var tip = polar(s.cx, s.cy, s.outer, h), tailEnd = polar(s.cx, s.cy, s.deadzone * 0.9, h + Math.PI)
    ctx.strokeStyle = rgba(s.colors.accent, 0.75)
    ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.moveTo(tailEnd.x, tailEnd.y); ctx.lineTo(tip.x, tip.y); ctx.stroke()
    ctx.fillStyle = rgba(s.colors.accent, 0.9)
    circle(ctx, s.cx, s.cy, 3); ctx.fill()
  },

  // A wavy band of colour flows along every track, shading from the accent into the
  // foreground; a faint glow behind everything.
  aurora: function (ctx, s, t) {
    glow(ctx, s.cx, s.cy, s.outer * 1.05, s.colors.accent, 0.08)
    var tr = tracks(s)
    // Flat ends: round caps of the overlapping short pieces showed as beads.
    ctx.lineCap = "butt"
    for (var k = 0; k < tr.length; k++) {
      var n = 90
      for (var i = 0; i < n; i++) {
        var a0 = i / n * 2 * Math.PI, a1 = (i + 1) / n * 2 * Math.PI
        var w0 = Math.sin(4 * a0 + t * 0.9 + k) * 6, w1 = Math.sin(4 * a1 + t * 0.9 + k) * 6
        var p0 = polar(s.cx, s.cy, tr[k] + w0, a0), p1 = polar(s.cx, s.cy, tr[k] + w1, a1)
        var f = 0.5 + 0.5 * Math.sin(2 * a0 - t * 0.6 + k * 2)
        ctx.strokeStyle = rgba(mix(s.colors.accent, s.colors.fg, f * 0.6), 0.1 + 0.12 * f)
        ctx.lineWidth = 5 + 7 * (0.5 + 0.5 * Math.sin(3 * a0 + t * 0.7))
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke()
      }
    }
  },

  // Points of light float between the rings and swarm around the slot under the pointer.
  fireflies: function (ctx, s, t) {
    var pull = s.selected ? Math.min(1, s.selectedAge * 2.5) : 0
    for (var i = 0; i < 40; i++) {
      var a = rand(i, 11) * 2 * Math.PI + t * 0.05 * (rand(i, 12) - 0.5)
      var r = s.deadzone + (s.outer - s.deadzone) * rand(i, 13)
      var p = polar(s.cx, s.cy, r, a)
      p.x += Math.sin(t * (0.6 + rand(i, 14)) + i) * 14
      p.y += Math.cos(t * (0.5 + rand(i, 15)) + i * 2) * 14
      if (s.selected) {
        var sx = s.cx + s.selected.x, sy = s.cy + s.selected.y
        var near = Math.sqrt(Math.pow(p.x - sx, 2) + Math.pow(p.y - sy, 2)) < s.slot * 2.6
        if (near) {
          var o = t * 2.2 + i
          var tx = sx + Math.cos(o) * s.slot * 0.65, ty = sy + Math.sin(o) * s.slot * 0.65
          p.x += (tx - p.x) * pull
          p.y += (ty - p.y) * pull
        }
      }
      var lit = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 3 + i * 2.3))
      glow(ctx, p.x, p.y, 9, s.colors.accent, 0.45 * lit)
      ctx.fillStyle = rgba(s.colors.fg, 0.9 * lit)
      circle(ctx, p.x, p.y, 1.6); ctx.fill()
    }
  }
}

function tube(ctx, x, y, r, colors, a, t) {
  ctx.strokeStyle = rgba(colors.accent, 0.07 * a); ctx.lineWidth = 12
  circle(ctx, x, y, r); ctx.stroke()
  ctx.strokeStyle = rgba(colors.accent, 0.22 * a); ctx.lineWidth = 5
  circle(ctx, x, y, r); ctx.stroke()
  ctx.strokeStyle = rgba(mix(colors.accent, colors.fg, 0.55), 0.95 * a); ctx.lineWidth = 1.6
  circle(ctx, x, y, r); ctx.stroke()
}

// ----------------------------------------------------------------- the trail

function drawTrail(ctx, style, s) {
  var st = normalize(style)
  if (st === "plain" || !s || !s.points || s.points.length < 2) return
  var t = s.still ? 0 : s.t
  ctx.save()
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  TRAIL[st](ctx, s, t)
  ctx.restore()
}

// Seconds since point i was drawn (0 when still or unknown).
function age(s, i) {
  if (s.still || !s.times || s.times[i] === undefined) return 0
  return Math.max(0, s.t - s.times[i])
}

var TRAIL = {
  // The line is a comet: a bright head at the pointer, the tail fading back along the path.
  comets: function (ctx, s) {
    var P = s.points, L = lengths(P), total = L[L.length - 1], tail = Math.min(total, 700)
    for (var i = 1; i < P.length; i++) {
      var f = 1 - (total - L[i]) / Math.max(1, tail)
      if (f <= 0) continue
      ctx.strokeStyle = rgba(s.colors.accent, f * 0.9)
      ctx.lineWidth = s.lineWidth * (0.3 + f)
      polyline(ctx, P, i - 1, i); ctx.stroke()
    }
    var h = P[P.length - 1]
    glow(ctx, h.x, h.y, s.lineWidth * 5, s.colors.accent, 0.9)
    glow(ctx, h.x, h.y, s.lineWidth * 1.6, s.colors.fg, 1)
  },

  // A vapour trail that widens and dissolves into puffs.
  clouds: function (ctx, s) {
    var P = s.points, L = lengths(P), next = 0
    for (var i = 0; i < P.length; i++) {
      if (L[i] < next) continue
      next = L[i] + 7
      var a = age(s, i)
      var alpha = s.still ? 0.25 : Math.max(0, 0.32 - a * 0.22)
      if (alpha <= 0) continue
      var r = s.lineWidth * (1.1 + a * 3.5)
      var ox = (rand(i, 21) - 0.5) * a * 18, oy = (rand(i, 22) - 0.5) * a * 18
      glow(ctx, P[i].x + ox, P[i].y + oy, r, s.colors.fg, alpha)
    }
    ctx.strokeStyle = rgba(s.colors.accent, 0.8)
    ctx.lineWidth = s.lineWidth * 0.6
    polyline(ctx, P, Math.max(0, P.length - 6), P.length - 1); ctx.stroke()
  },

  // Blips every few pixels that fade one after the other; the newest rings out.
  radar: function (ctx, s, t) {
    var P = s.points, L = lengths(P), next = 0
    for (var i = 0; i < P.length; i++) {
      if (L[i] < next) continue
      next = L[i] + 14
      var a = age(s, i)
      var alpha = s.still ? 0.8 : Math.max(0.12, 1 - a / 1.4)
      ctx.fillStyle = rgba(s.colors.accent, alpha)
      circle(ctx, P[i].x, P[i].y, s.lineWidth * 0.75); ctx.fill()
    }
    var h = P[P.length - 1], ping = s.still ? 0.5 : (t * 1.5) % 1
    ctx.strokeStyle = rgba(s.colors.accent, 0.6 * (1 - ping))
    ctx.lineWidth = 1.5
    circle(ctx, h.x, h.y, s.lineWidth * (1 + ping * 6)); ctx.stroke()
  },

  // A thin line with stardust scattering off it.
  orbits: function (ctx, s) {
    var P = s.points
    ctx.strokeStyle = rgba(s.colors.accent, 0.85)
    ctx.lineWidth = s.lineWidth * 0.5
    polyline(ctx, P, 0, P.length - 1); ctx.stroke()
    for (var i = 0; i < P.length; i += 2) {
      for (var k = 0; k < 2; k++) {
        var a = age(s, i)
        var life = s.still ? 0.4 : a
        var alpha = Math.max(0, 1 - life / 0.9)
        if (alpha <= 0) continue
        var dir = rand(i, 31 + k) * 2 * Math.PI, dist = life * (14 + rand(i, 33 + k) * 22)
        ctx.fillStyle = rgba(k ? s.colors.fg : s.colors.accent, alpha * 0.9)
        circle(ctx, P[i].x + Math.cos(dir) * dist, P[i].y + Math.sin(dir) * dist, 1 + rand(i, 35 + k)); ctx.fill()
      }
    }
  },

  // A brush line, thick at the start and thin at the end, with a bleeding edge.
  ink: function (ctx, s) {
    var P = s.points, L = lengths(P), total = Math.max(1, L[L.length - 1])
    for (var i = 1; i < P.length; i++) {
      var f = 1 - L[i] / total
      var j = (rand(i, 41) - 0.5) * 2
      ctx.lineCap = "butt"
      ctx.strokeStyle = rgba(s.colors.accent, 0.12)
      ctx.lineWidth = s.lineWidth * (1.2 + 2.2 * f) + 3 + j
      polyline(ctx, P, i - 1, i); ctx.stroke()
      ctx.lineCap = "round"
      ctx.strokeStyle = rgba(s.colors.accent, 0.95)
      ctx.lineWidth = s.lineWidth * (0.35 + 1.4 * f)
      polyline(ctx, P, i - 1, i); ctx.stroke()
    }
  },

  // A glowing tube with a faint buzz.
  neon: function (ctx, s, t) {
    var P = s.points
    var buzz = s.still ? [] : P.map(function (p, i) {
      return { x: p.x + (rand(i, Math.floor(t * 20)) - 0.5) * 1.2, y: p.y + (rand(i, Math.floor(t * 20) + 7) - 0.5) * 1.2 }
    })
    var Q = s.still ? P : buzz
    var layers = [[s.lineWidth * 4, 0.08], [s.lineWidth * 2, 0.22], [s.lineWidth * 0.6, 0.95]]
    for (var l = 0; l < layers.length; l++) {
      ctx.strokeStyle = l === 2 ? rgba(mix(s.colors.accent, s.colors.fg, 0.55), layers[l][1]) : rgba(s.colors.accent, layers[l][1])
      ctx.lineWidth = layers[l][0]
      polyline(ctx, Q, 0, Q.length - 1); ctx.stroke()
    }
  },

  // The line beats: bright, thicker pulses run from the start to the pointer.
  pulse: function (ctx, s, t) {
    var P = s.points, L = lengths(P)
    for (var i = 1; i < P.length; i++) {
      var phase = ((L[i] - t * 420) % 260 + 260) % 260
      var beat = Math.max(0, 1 - Math.abs(phase - 130) / 45)
      ctx.strokeStyle = rgba(s.colors.accent, 0.55 + 0.45 * beat)
      ctx.lineWidth = s.lineWidth * (0.8 + 1.1 * beat)
      polyline(ctx, P, i - 1, i); ctx.stroke()
    }
  },

  // A technical line of dashes with a small mark where the direction turns.
  clockwork: function (ctx, s) {
    var P = s.points, L = lengths(P)
    ctx.strokeStyle = rgba(s.colors.accent, 0.95)
    ctx.lineWidth = s.lineWidth * 0.6
    for (var i = 1; i < P.length; i++) {
      if (Math.floor(L[i] / 9) % 2 === 1) continue
      polyline(ctx, P, i - 1, i); ctx.stroke()
    }
    var turns = turnPoints(P, L)
    for (var k = 0; k < turns.length; k++) {
      ctx.strokeStyle = rgba(s.colors.fg, 0.7)
      ctx.lineWidth = 1.2
      circle(ctx, turns[k].x, turns[k].y, s.lineWidth * 1.6); ctx.stroke()
    }
  },

  // A wide ribbon of light whose colour runs along it, with a thin core.
  aurora: function (ctx, s, t) {
    var P = s.points, L = lengths(P)
    ctx.lineCap = "butt"
    for (var i = 1; i < P.length; i++) {
      var f = 0.5 + 0.5 * Math.sin(L[i] / 60 - t * 2)
      ctx.strokeStyle = rgba(mix(s.colors.accent, s.colors.fg, f * 0.6), 0.2)
      ctx.lineWidth = s.lineWidth * 3.5
      polyline(ctx, P, i - 1, i); ctx.stroke()
    }
    ctx.lineCap = "round"
    ctx.strokeStyle = rgba(s.colors.accent, 0.9)
    ctx.lineWidth = s.lineWidth * 0.5
    polyline(ctx, P, 0, P.length - 1); ctx.stroke()
  },

  // A thin line throwing sparks that fall and go out.
  fireflies: function (ctx, s) {
    var P = s.points
    ctx.strokeStyle = rgba(s.colors.accent, 0.8)
    ctx.lineWidth = s.lineWidth * 0.45
    polyline(ctx, P, 0, P.length - 1); ctx.stroke()
    for (var i = 0; i < P.length; i += 2) {
      var a = age(s, i)
      var life = s.still ? 0.25 : a
      var alpha = Math.max(0, 1 - life / 0.75)
      if (alpha <= 0) continue
      var dir = rand(i, 51) * 2 * Math.PI, speed = 40 + rand(i, 52) * 70
      var x = P[i].x + Math.cos(dir) * speed * life
      var y = P[i].y + Math.sin(dir) * speed * life + 260 * life * life
      glow(ctx, x, y, 5, s.colors.accent, 0.6 * alpha)
      ctx.fillStyle = rgba(s.colors.fg, alpha)
      circle(ctx, x, y, 1.3); ctx.fill()
    }
  }
}

// Points where the path turns by more than ~50°, judged over ~20 px on either side.
function turnPoints(P, L) {
  var out = []
  var last = -1e9
  for (var i = 1; i < P.length - 1; i++) {
    var a = back(P, L, i, 20), b = ahead(P, L, i, 20)
    if (a < 0 || b < 0) continue
    var v1x = P[i].x - P[a].x, v1y = P[i].y - P[a].y, v2x = P[b].x - P[i].x, v2y = P[b].y - P[i].y
    var n1 = Math.sqrt(v1x * v1x + v1y * v1y), n2 = Math.sqrt(v2x * v2x + v2y * v2y)
    if (!n1 || !n2) continue
    var cos = (v1x * v2x + v1y * v2y) / (n1 * n2)
    if (cos < 0.64 && L[i] - last > 30) { out.push(P[i]); last = L[i] }
  }
  return out
}
function back(P, L, i, d) { for (var j = i - 1; j >= 0; j--) if (L[i] - L[j] >= d) return j; return -1 }
function ahead(P, L, i, d) { for (var j = i + 1; j < P.length; j++) if (L[j] - L[i] >= d) return j; return -1 }

if (typeof module !== "undefined") module.exports = {
  STYLES: STYLES, NAMES: NAMES, normalize: normalize, name: name, animated: animated,
  drawRing: drawRing, drawTrail: drawTrail, rand: rand, rgba: rgba, tracks: tracks,
  turnPoints: turnPoints, lengths: lengths
}
