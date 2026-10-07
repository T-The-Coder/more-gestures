.pragma library

// Geometry of the workspace ring. Pure functions, tested under node.
//
// Ten sectors clockwise from the top: 1 at 12 o'clock, then 2 … 9, and 10 (shown as
// "0", like the key) just left of the top. Directions stay the same every time, so the
// hand learns them and the ring can be used without looking.

var COUNT = 10
var STEP = 360 / COUNT

// Sector index 0..9 for a pointer offset from the centre, or -1 inside the dead zone
// (releasing there cancels).
function sectorFor(dx, dy, deadzone) {
  if (Math.sqrt(dx * dx + dy * dy) < deadzone) return -1
  // 0° = up, clockwise (screen y grows downwards).
  var deg = Math.atan2(dx, -dy) * 180 / Math.PI
  if (deg < 0) deg += 360
  return Math.round(deg / STEP) % COUNT
}

function workspaceFor(index) { return index + 1 }
function labelFor(index) { return index === COUNT - 1 ? "0" : String(index + 1) }

// Centre of a sector's label at radius r, relative to the ring centre.
function position(index, r) {
  var rad = (index * STEP) * Math.PI / 180
  return { x: Math.sin(rad) * r, y: -Math.cos(rad) * r }
}

// Workspaces 1-5 always look normal; 6-10 are faded unless something is on them.
function emphasized(index, occupied) {
  var ws = workspaceFor(index)
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
  COUNT: COUNT, sectorFor: sectorFor, workspaceFor: workspaceFor, labelFor: labelFor,
  position: position, emphasized: emphasized, occupiedFrom: occupiedFrom
}
