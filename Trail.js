.pragma library

// Geometry of the gesture trail. Pure functions only, so the same file runs in the
// shell and under `node --test`.
//
// The trail starts on the ring's outer edge instead of its centre (the line used to
// run through the middle of the ring and cover the finger count / check mark) and
// ends in an open arrowhead pointing along the last stretch of movement.

// Points within this distance of the tip are too jittery to give the arrow a direction.
var HEAD_DIRECTION_MIN = 8

// Cuts the part of `points` that lies inside the circle (cx, cy, r) and starts the
// path exactly on the circle. Returns [] while the pointer has not left the circle.
function clipStart(points, cx, cy, r) {
  if (!points || points.length === 0) return []
  var i = 0
  while (i < points.length && dist(points[i].x - cx, points[i].y - cy) <= r) i++
  if (i >= points.length) return []
  var out = []
  if (i > 0) {
    out.push(circleExit(points[i - 1], points[i], cx, cy, r))
  } else {
    // The first point is already outside (pointer started outside the ring): begin on
    // the circle along the ray from the centre so the line still touches the ring.
    var p = points[0]
    var d = dist(p.x - cx, p.y - cy)
    out.push({ x: cx + (p.x - cx) / d * r, y: cy + (p.y - cy) / d * r })
  }
  for (; i < points.length; i++) out.push({ x: points[i].x, y: points[i].y })
  return out
}

// Where the segment a (inside) -> b (outside) crosses the circle.
function circleExit(a, b, cx, cy, r) {
  var dx = b.x - a.x, dy = b.y - a.y
  var fx = a.x - cx, fy = a.y - cy
  var qa = dx * dx + dy * dy
  if (qa === 0) return { x: b.x, y: b.y }
  var qb = 2 * (fx * dx + fy * dy)
  var qc = fx * fx + fy * fy - r * r
  var disc = Math.max(0, qb * qb - 4 * qa * qc)
  var t = (-qb + Math.sqrt(disc)) / (2 * qa)
  t = Math.max(0, Math.min(1, t))
  return { x: a.x + dx * t, y: a.y + dy * t }
}

// Open arrowhead at the end of `path`: [left wing, tip, right wing], or [] when the
// path is too short to know where it points. `len` is the wing length in px.
function arrowHead(path, len) {
  if (!path || path.length < 2) return []
  var tip = path[path.length - 1]
  for (var i = path.length - 2; i >= 0; i--) {
    var dx = tip.x - path[i].x, dy = tip.y - path[i].y
    var d = dist(dx, dy)
    if (d >= HEAD_DIRECTION_MIN || i === 0) {
      if (d === 0) return []
      var ux = dx / d, uy = dy / d
      // Wings at ±30° behind the tip.
      var c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6)
      return [
        { x: tip.x - len * (ux * c - uy * s), y: tip.y - len * (uy * c + ux * s) },
        { x: tip.x, y: tip.y },
        { x: tip.x - len * (ux * c + uy * s), y: tip.y - len * (uy * c - ux * s) }
      ]
    }
  }
  return []
}

function dist(dx, dy) { return Math.sqrt(dx * dx + dy * dy) }

if (typeof module !== "undefined") module.exports = {
  clipStart: clipStart, circleExit: circleExit, arrowHead: arrowHead
}
