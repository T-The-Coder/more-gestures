.pragma library

// Layout of the ring menu. Pure functions, tested under node.
//
// A clock face: slot 0 at 12 o'clock, then clockwise. Each slot holds an action (as in
// Actions.validateAction) or "none". Default: Exposé at 12, workspaces 1-5 at 1-5
// o'clock, "show desktop" at 6, workspaces 6-9 and 10 ("0", like the key) at 7-11.
// Directions stay the same every time, so the hand learns them.

// The default slots live in Actions.RING_SLOTS (with the other default bindings).

// Sector index 0..count-1 for a pointer offset from the centre, or -1 inside the dead
// zone (releasing there cancels). `offset` (in slots) turns the ring: 0.5 puts slot 0
// half a step after 12 o'clock.
function sectorFor(dx, dy, deadzone, count, offset) {
  if (Math.sqrt(dx * dx + dy * dy) < deadzone) return -1
  var deg = Math.atan2(dx, -dy) * 180 / Math.PI  // 0° = up, clockwise
  deg -= (offset || 0) * 360 / count
  deg = ((deg % 360) + 360) % 360
  return Math.round(deg / (360 / count)) % count
}

// Centre of a slot at radius r, relative to the ring centre.
function position(index, r, count, offset) {
  var rad = (index + (offset || 0)) * (2 * Math.PI / count)
  return { x: Math.sin(rad) * r, y: -Math.cos(rad) * r }
}

// Radii for the rings that are on, inner first: [{ count, radius, offset }].
// A ring is wide enough that its slots (diameter `slot`) keep a gap on the circle, and
// at least one slot plus a gap outside the ring before it. Every second ring is turned
// by half a step, so with equal counts its slots sit between those of the inner ring.
function layout(counts, slot, innerRadius) {
  var out = []
  for (var i = 0; i < counts.length; i++) {
    var fit = counts[i] * slot * 1.15 / (2 * Math.PI)
    var radius = i === 0 ? Math.max(innerRadius, fit) : Math.max(out[i - 1].radius + slot * 1.15, fit)
    out.push({ count: counts[i], radius: radius, offset: i % 2 === 1 ? 0.5 : 0 })
  }
  return out
}

// Outer edge of the whole menu (for the backdrop and for keeping it on screen).
function outerRadius(rings, slot) {
  return rings.length ? rings[rings.length - 1].radius + slot / 2 : 0
}

// Pointer offset -> { ring, index } while dragging: the distance picks the ring (the
// border lies halfway between two radii, beyond the outer ring still counts as outer),
// the direction picks the slot. null inside the dead zone or with no rings.
function pick(dx, dy, rings, deadzone) {
  var d = Math.sqrt(dx * dx + dy * dy)
  if (d < deadzone || !rings.length) return null
  var r = 0
  while (r + 1 < rings.length && d > (rings[r].radius + rings[r + 1].radius) / 2) r++
  return { ring: r, index: sectorFor(dx, dy, 0, rings[r].count, rings[r].offset) }
}

// Workspace number of a slot action, or 0 when it is something else.
function workspaceOf(action) {
  var m = action && action.type === "dispatch" ? /^workspace-(\d+)$/.exec(action.id || "") : null
  return m ? Number(m[1]) : 0
}

// Target workspace of "move the window under the pointer to workspace n", else 0. The
// ring draws such a slot as an arrow into a small monitor with the number.
function moveTargetOf(action) {
  var m = action && action.type === "dispatch" ? /^window-to-workspace-silent-(\d+)$/.exec(action.id || "") : null
  return m ? Number(m[1]) : 0
}

// What a slot shows: "1" … "9", "0" for 10; other actions use their name (caller).
function workspaceLabel(ws) { return ws === 10 ? "0" : String(ws) }

// Workspaces 1-5 always look normal; 6-10 are faded unless something is on them.
// Other actions always look normal, empty slots are not drawn.
function emphasized(action, occupied) {
  var ws = workspaceOf(action)
  if (!ws) return true
  return ws <= 5 || (occupied && occupied.indexOf(ws) >= 0)
}

// `hyprctl workspaces -j` text -> ids of workspaces with at least one window.
function occupiedFrom(text) {
  var list
  try { list = JSON.parse(text) } catch (e) { return [] }
  if (!Array.isArray(list)) return []
  return list.filter(function (w) { return w && w.id > 0 && w.windows > 0 })
    .map(function (w) { return w.id })
}

if (typeof module !== "undefined") module.exports = {
  sectorFor: sectorFor, position: position, layout: layout, outerRadius: outerRadius, pick: pick,
  workspaceOf: workspaceOf, workspaceLabel: workspaceLabel, emphasized: emphasized,
  occupiedFrom: occupiedFrom, moveTargetOf: moveTargetOf
}
