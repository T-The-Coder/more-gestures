.pragma library

// Settings file contract shared by Service.qml (reads, applies live) and Settings.qml
// (edits, writes). Pure functions (no QML, no I/O) so the same file runs in the shell and
// under `node --test`.
//
// The file is user-editable and may be half written or hand-broken: parse() never throws
// and yields defaults for anything missing or malformed, so a bad edit degrades to the
// default behaviour instead of a dead service. `bindings` holds only the user's overrides
// (profile -> gesture key -> action); Actions.mergeBindings layers them over the defaults.
//
// Actions.js is passed in by the caller (`Config.parse(text, Actions)`): a .pragma library
// cannot `.import` and still load under node. Without the argument node falls back to require.

var PATH_SUFFIX = "/.local/state/omarchy/settings/more-gestures.json"
var VERSION = 1

var BUTTONS = ["right", "middle", "side", "extra"]
var PROFILES = ["default", "browser", "terminal"]

var LIMITS = {
  threshold: { min: 1, max: 5000, def: 20 },
  holdMs: { min: 0, max: 5000, def: 350 },
  thresholdMm: { min: 4, max: 60, def: 8 },
  cornerMm: { min: 4, max: 40, def: 14 },
  doubleMs: { min: 100, max: 800, def: 250 }
}

// Menu bar icon: what each mouse button does on it, and the tooltip.
var BAR_ACTIONS = ["settings", "toggle", "status", "ring", "none"]
function barDefaults() { return { show: true, left: "settings", middle: "toggle", right: "status", tooltip: true } }

function cleanBar(raw) {
  var d = barDefaults()
  if (!isPlainObject(raw)) return d
  var pick = function (v, def) { return BAR_ACTIONS.indexOf(v) >= 0 ? v : def }
  return { show: raw.show !== false, left: pick(raw.left, d.left), middle: pick(raw.middle, d.middle),
           right: pick(raw.right, d.right), tooltip: raw.tooltip !== false }
}

// Workspace ring (double click with the trigger, second press held). Off by default:
// it delays every ordinary click of the trigger button by doubleMs.
// `slots`: 12 actions, slot 0 at 12 o'clock, clockwise; {type: "none"} leaves it empty.
function ringDefaults(actions) {
  var A = actionsModule(actions)
  return { enabled: false, doubleMs: LIMITS.doubleMs.def, slots: clone(A.RING_SLOTS), keys: A.RING_KEYS.slice() }
}

// One lowercase letter or digit per slot, "" for none; a key used twice keeps its first slot.
function cleanRingKeys(raw, defaults) {
  if (!Array.isArray(raw) || raw.length !== defaults.length) return defaults.slice()
  var seen = {}
  return raw.map(function (k) {
    var key = typeof k === "string" ? k.toLowerCase().trim() : ""
    if (!/^[a-z0-9]$/.test(key) || seen[key]) return ""
    seen[key] = true
    return key
  })
}

function cleanRing(raw, actions) {
  var A = actionsModule(actions)
  var d = ringDefaults(A)
  if (!isPlainObject(raw)) return d
  var slots = d.slots
  if (Array.isArray(raw.slots) && raw.slots.length === d.slots.length) {
    slots = raw.slots.map(function (s, i) {
      var v = A.validateAction(s)
      return v.ok ? v.action : d.slots[i]
    })
  }
  return { enabled: raw.enabled === true, doubleMs: clampInt(raw.doubleMs, LIMITS.doubleMs), slots: slots,
           keys: cleanRingKeys(raw.keys, d.keys) }
}

// Corner taps need the touchpad grabbed (to swallow the taps' clicks), so they are
// opt-in: off unless switched on in the settings.
function tapsDefaults() { return { enabled: false, cornerMm: LIMITS.cornerMm.def } }

function cleanTaps(raw) {
  if (!isPlainObject(raw)) return tapsDefaults()
  return { enabled: raw.enabled === true, cornerMm: clampInt(raw.cornerMm, LIMITS.cornerMm) }
}

// Tap gestures with an action in any profile: only those corners are held back.
function boundTaps(config, actions) {
  var A = actionsModule(actions)
  var merged = A.mergeBindings(config.bindings)
  var out = {}
  Object.keys(merged).forEach(function (profile) {
    Object.keys(merged[profile]).forEach(function (key) {
      if (key.indexOf("tap:") === 0 && merged[profile][key].type !== "none") out[key.slice(4)] = true
    })
  })
  return Object.keys(out).sort()
}

var FINGERS = ["tp3", "tp4"]

// Trackpad part of the settings. `fingers`: which counts the plugin reads at all.
// `swipe`: counts whose left/right Hyprland swipes natively (workspace follows the
// fingers); the plugin never sees those directions for that count.
function touchpadDefaults() {
  return { enabled: true, thresholdMm: LIMITS.thresholdMm.def,
           fingers: { tp3: true, tp4: true }, swipe: { tp3: false, tp4: true } }
}

function cleanTouchpad(raw) {
  var d = touchpadDefaults()
  if (!isPlainObject(raw)) return d
  var out = { enabled: raw.enabled !== false, thresholdMm: clampInt(raw.thresholdMm, LIMITS.thresholdMm),
              fingers: {}, swipe: {} }
  FINGERS.forEach(function (f) {
    var fingers = isPlainObject(raw.fingers) ? raw.fingers[f] : undefined
    var swipe = isPlainObject(raw.swipe) ? raw.swipe[f] : undefined
    out.fingers[f] = typeof fingers === "boolean" ? fingers : d.fingers[f]
    out.swipe[f] = typeof swipe === "boolean" ? swipe : d.swipe[f]
  })
  return out
}

// The Lua file input.lua loads (dofile) for Hyprland's native workspace swipe.
var HYPR_FILE_SUFFIX = "/.local/state/omarchy/settings/more-gestures-hypr.lua"

function hyprLua(config) {
  var t = config.touchpad || touchpadDefaults()
  var lines = ["-- Generated by More Gestures from its settings (trackpad: workspace swipe).",
               "-- Do not edit: changes are overwritten. Loaded from ~/.config/hypr/input.lua."]
  FINGERS.forEach(function (f) {
    if (t.enabled && t.swipe[f])
      lines.push('hl.gesture({ fingers = ' + f.slice(2) + ', direction = "horizontal", action = "workspace" })')
  })
  return lines.join("\n") + "\n"
}

var MAX_EXCLUDES = 100
var MAX_EXCLUDE_LENGTH = 64

function actionsModule(actions) {
  if (actions) return actions
  if (typeof require === "function") return require("./Actions.js")
  throw new Error("Config: Actions module missing")
}

function isPlainObject(v) { return v !== null && typeof v === "object" && !Array.isArray(v) }

function clone(v) { return JSON.parse(JSON.stringify(v)) }

// Out of range clamps, non-numbers fall back; integers only (units are whole numbers).
function clampInt(value, limit) {
  var n = Number(value)
  if (value === null || value === "" || typeof value === "boolean" || !isFinite(n)) return limit.def
  return Math.max(limit.min, Math.min(limit.max, Math.round(n)))
}

function cleanExclude(value) {
  if (typeof value !== "string") return ""
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, MAX_EXCLUDE_LENGTH)
}

// Class names or tags; a trailing "*" is a prefix match (see Actions.isExcluded).
// Trimmed, de-duplicated case-insensitively, order kept.
function cleanExcludes(list) {
  var out = []
  var seen = {}
  for (var i = 0; i < list.length && out.length < MAX_EXCLUDES; i++) {
    var e = cleanExclude(list[i])
    if (e === "" || seen[e.toLowerCase()]) continue
    seen[e.toLowerCase()] = true
    out.push(e)
  }
  return out
}

// Keeps known profiles and valid gesture keys with valid actions, as canonical copies.
function cleanBindings(raw, actions) {
  var A = actionsModule(actions)
  var out = {}
  PROFILES.forEach(function (p) { out[p] = {} })
  if (!isPlainObject(raw)) return out
  PROFILES.forEach(function (profile) {
    if (!isPlainObject(raw[profile])) return
    Object.keys(raw[profile]).forEach(function (key) {
      if (!A.GESTURE_KEY_PATTERN.test(key)) return
      var v = A.validateAction(raw[profile][key])
      if (v.ok) out[profile][key] = v.action
    })
  })
  return out
}

function defaults(actions) {
  var A = actionsModule(actions)
  return {
    version: VERSION,
    enabled: true,
    button: "right",
    threshold: LIMITS.threshold.def,
    holdMs: LIMITS.holdMs.def,
    rocker: false,
    wheel: true,
    indicator: "full",
    animations: true,
    touchpad: touchpadDefaults(),
    taps: tapsDefaults(),
    ring: ringDefaults(A),
    bar: barDefaults(),
    exclude: A.DEFAULT_EXCLUDES.slice(),
    bindings: cleanBindings({}, A)
  }
}

// Any object -> complete, valid settings.
function sanitize(raw, actions) {
  var A = actionsModule(actions)
  if (!isPlainObject(raw)) raw = {}
  return {
    version: VERSION,
    enabled: raw.enabled !== false,
    button: BUTTONS.indexOf(raw.button) >= 0 ? raw.button : "right",
    threshold: clampInt(raw.threshold, LIMITS.threshold),
    holdMs: clampInt(raw.holdMs, LIMITS.holdMs),
    rocker: raw.rocker === true,
    wheel: raw.wheel !== false,
    indicator: A.normalizeIndicator(raw.indicator),
    animations: raw.animations !== false,
    touchpad: cleanTouchpad(raw.touchpad),
    taps: cleanTaps(raw.taps),
    ring: cleanRing(raw.ring, A),
    bar: cleanBar(raw.bar),
    exclude: Array.isArray(raw.exclude) ? cleanExcludes(raw.exclude) : A.DEFAULT_EXCLUDES.slice(),
    bindings: cleanBindings(raw.bindings, A)
  }
}

// File text -> settings. Empty, missing or broken JSON gives the defaults.
function parse(text, actions) {
  var raw = null
  try { raw = JSON.parse(text) } catch (e) { raw = null }
  return sanitize(raw, actions)
}

function serialize(config, actions) {
  return JSON.stringify(sanitize(config, actions), null, 2) + "\n"
}

// ---------------------------------------------------------------- live apply

// Changing the trigger button needs a new daemon (it picks devices by that button);
// everything else goes to the running daemon as `config {json}`.
function needsRestart(prev, next) { return prev.button !== next.button }

function daemonConfig(config, actions) {
  var t = config.touchpad || touchpadDefaults()
  var native = {}
  var fingers = []
  FINGERS.forEach(function (f) {
    native[f.slice(2)] = t.swipe[f] ? ["L", "R"] : []
    if (t.fingers[f]) fingers.push(Number(f.slice(2)))
  })
  var ring = config.ring || { enabled: false, doubleMs: LIMITS.doubleMs.def }
  return { threshold: config.threshold, hold_ms: config.holdMs, rocker: config.rocker,
           ring: ring.enabled, double_ms: ring.doubleMs,
           touchpad: { enabled: t.enabled && fingers.length > 0, threshold_mm: t.thresholdMm,
                       fingers: fingers, native: native },
           taps: tapsDaemon(config, actions) }
}

function tapsDaemon(config, actions) {
  var t = config.taps || tapsDefaults()
  var bound = []
  try { bound = t.enabled ? boundTaps(config, actions) : [] } catch (e) { bound = [] }
  return { enabled: t.enabled, corner_mm: t.cornerMm, bound: bound }
}

function daemonConfigChanged(prev, next, actions) {
  return JSON.stringify(daemonConfig(prev, actions)) !== JSON.stringify(daemonConfig(next, actions))
}

function daemonConfigLine(config, actions) { return "config " + JSON.stringify(daemonConfig(config, actions)) }

// ------------------------------------------------------------ binding editing

function splitKey(key) {
  var i = String(key).indexOf(":")
  return { source: key.slice(0, i), gesture: key.slice(i + 1) }
}

function gestureOrder(gesture) {
  if (/^[UDLR]+$/.test(gesture)) return [0, gesture.length, gesture]
  return [1, 0, gesture]  // wheel-*, rocker-* after the line gestures
}

// Rows for one profile: its own entries only (defaults plus overrides), sorted by gesture
// length then name. `overridden` = the user changed or added it, `hasDefault` = a built-in
// entry exists under that key (so "reset" restores it rather than deleting the row).
function listBindings(config, profile, actions) {
  var A = actionsModule(actions)
  var merged = A.mergeBindings(config.bindings)[profile] || {}
  var defaultsTable = A.mergeBindings({})[profile] || {}
  var own = (config.bindings && config.bindings[profile]) || {}
  return Object.keys(merged).map(function (key) {
    var parts = splitKey(key)
    return {
      key: key, source: parts.source, gesture: parts.gesture, action: merged[key],
      overridden: Object.prototype.hasOwnProperty.call(own, key),
      hasDefault: Object.prototype.hasOwnProperty.call(defaultsTable, key)
    }
  }).sort(function (a, b) {
    var x = gestureOrder(a.gesture), y = gestureOrder(b.gesture)
    if (x[0] !== y[0]) return x[0] - y[0]
    if (x[1] !== y[1]) return x[1] - y[1]
    if (x[2] !== y[2]) return x[2] < y[2] ? -1 : 1
    return a.source < b.source ? -1 : a.source > b.source ? 1 : 0
  })
}

// Returns { ok: true, config } with the action stored for profile/key, or { ok: false, error }.
// An action identical to the built-in one drops the override, so the file stays a diff.
function setBinding(config, profile, key, action, actions) {
  var A = actionsModule(actions)
  if (PROFILES.indexOf(profile) < 0) return { ok: false, error: "profile" }
  if (!A.GESTURE_KEY_PATTERN.test(key)) return { ok: false, error: "gesture" }
  var v = A.validateAction(action)
  if (!v.ok) return { ok: false, error: v.error }
  var next = clone(config)
  var builtin = (A.mergeBindings({})[profile] || {})[key]
  if (builtin && JSON.stringify(builtin) === JSON.stringify(v.action)) delete next.bindings[profile][key]
  else next.bindings[profile][key] = v.action
  return { ok: true, config: next }
}

// Back to the built-in entry, or gone when there is none.
function removeBinding(config, profile, key) {
  var next = clone(config)
  if (next.bindings[profile]) delete next.bindings[profile][key]
  return next
}

// "UD" + source "*" -> "*:UD"; "" for a gesture that is empty or has no valid shape.
function gestureKeyFor(source, gesture, actions) {
  var A = actionsModule(actions)
  var key = source + ":" + gesture
  return A.GESTURE_KEY_PATTERN.test(key) ? key : ""
}

// ------------------------------------------------------------------- exclusions

// Returns the list with `value` appended, or the same list when empty/duplicate/full.
function addExclude(list, value) {
  return cleanExcludes(list.concat([value]))
}

function removeExclude(list, index) {
  return list.filter(function (_, i) { return i !== index })
}

if (typeof module !== "undefined") module.exports = {
  PATH_SUFFIX: PATH_SUFFIX, VERSION: VERSION, HYPR_FILE_SUFFIX: HYPR_FILE_SUFFIX, FINGERS: FINGERS,
  touchpadDefaults: touchpadDefaults, ringDefaults: ringDefaults, cleanRing: cleanRing,
  BAR_ACTIONS: BAR_ACTIONS, barDefaults: barDefaults, cleanBar: cleanBar, tapsDefaults: tapsDefaults, cleanTaps: cleanTaps, boundTaps: boundTaps, cleanTouchpad: cleanTouchpad, hyprLua: hyprLua, BUTTONS: BUTTONS, PROFILES: PROFILES, LIMITS: LIMITS,
  clone: clone, clampInt: clampInt, defaults: defaults, sanitize: sanitize, parse: parse,
  serialize: serialize, needsRestart: needsRestart, daemonConfig: daemonConfig,
  daemonConfigChanged: daemonConfigChanged, daemonConfigLine: daemonConfigLine,
  listBindings: listBindings, setBinding: setBinding, removeBinding: removeBinding,
  gestureKeyFor: gestureKeyFor, cleanExcludes: cleanExcludes, addExclude: addExclude,
  removeExclude: removeExclude
}
