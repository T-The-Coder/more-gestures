.pragma library

// Layout of the ring menu. Pure functions, tested under node.
//
// A clock face: slot 0 at 12 o'clock, then clockwise. Each slot holds an action (as in
// Actions.validateAction) or "none". Default: Exposé at 12, workspaces 1-5 at 1-5
// o'clock, "show desktop" at 6, workspaces 6-9 and 10 ("0", like the key) at 7-11.
// Directions stay the same every time, so the hand learns them.

// The default slots live in Actions.RING_SLOTS (with the other default bindings).

// Sector index 0..count-1 for a pointer offset from the centre, or -1 inside the dead
// zone (releasing there cancels).
function sectorFor(dx, dy, deadzone, count) {
  if (Math.sqrt(dx * dx + dy * dy) < deadzone) return -1
  var deg = Math.atan2(dx, -dy) * 180 / Math.PI  // 0° = up, clockwise
  if (deg < 0) deg += 360
  return Math.round(deg / (360 / count)) % count
}

// Centre of a slot at radius r, relative to the ring centre.
function position(index, r, count) {
  var rad = index * (2 * Math.PI / count)
  return { x: Math.sin(rad) * r, y: -Math.cos(rad) * r }
}

// Workspace number of a slot action, or 0 when it is something else.
function workspaceOf(action) {
  var m = action && action.type === "dispatch" ? /^workspace-(\d+)$/.exec(action.id || "") : null
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
  sectorFor: sectorFor, position: position,
  workspaceOf: workspaceOf, workspaceLabel: workspaceLabel, emphasized: emphasized,
  occupiedFrom: occupiedFrom
}
