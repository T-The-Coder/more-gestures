.pragma library
.import "I18n.js" as I18n
.import "Ring.js" as Ring
.import "Keys.js" as Keys

// Settings file contract shared by Service.qml (reads, applies live) and Settings.qml
// (edits, writes). Pure functions (no QML, no I/O) so the same file runs in the shell and
// under `node --test`.
//
// The file is user-editable and may be half written or hand-broken: parse() never throws
// and yields defaults for anything missing or malformed, so a bad edit degrades to the
// default behaviour instead of a dead service. `bindings` holds only the user's overrides
// (profile -> gesture key -> action); Actions.mergeBindings layers them over the defaults.
//
// Actions.js is passed in by the caller (`Config.parse(text, Actions)`); without the
// argument node falls back to require.

var PATH_SUFFIX = "/.local/state/omarchy/settings/more-gestures.json"
var VERSION = 1

var BUTTONS = ["right", "middle", "side", "extra"]
var PROFILES = ["default", "browser", "terminal"]
// Interface language: "auto" follows the system locale; More Time and More Weather have
// the same setting, so all three can show German on an English system.
var LANGUAGES = ["auto"].concat(I18n.LANGUAGES)

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

// Ring menu. `enabled` is the mouse way in (double click with the trigger, second press
// held), off by default: it delays every ordinary click of the trigger button by doubleMs.
// The four-finger double tap and `hotkey` open it regardless.
// `rings`: three rings, inner first. Ring 1 is always on; 2 and 3 can be switched on.
// Each has `count` slots (slot 0 at the top, clockwise; {type: "none"} leaves one empty)
// and one key per slot.
// `hotkey`: { mods, key } bound in Hyprland (via the generated Lua file), or null for none.
var RING_HOTKEY = { mods: ["SUPER", "ALT"], key: "R" }

function ringDefaults(actions) {
  var A = actionsModule(actions)
  return { enabled: false, doubleMs: LIMITS.doubleMs.def, hotkey: clone(RING_HOTKEY),
           dividers: true, style: "plain", rings: clone(A.ringDefaultsList()) }
}

// The ring's looks; the same list as Effects.STYLES (a test keeps them equal).
var RING_STYLES = ["plain", "comets", "clouds", "radar", "orbits", "ink", "neon", "pulse",
                   "clockwork", "aurora", "fireflies"]

// Look of the gesture trail (Settings › Mouse; Effects.drawTrail), for mouse and trackpad.
// Before it had its own setting the trail followed the ring's style unless
// ring.styleTrail was false: that choice is carried over.
function cleanTrailStyle(raw) {
  if (RING_STYLES.indexOf(raw.trailStyle) >= 0) return raw.trailStyle
  var ring = isPlainObject(raw.ring) ? raw.ring : null
  if (ring && ring.styleTrail !== false && RING_STYLES.indexOf(ring.style) >= 0) return ring.style
  return "plain"
}

// Letters and digits; upper case means Shift+letter, so "a" and "A" are two keys.
// "⇧1" … "⇧0": Shift with a key of the digit row, matched by its position (scan code),
// since the character Shift+digit gives depends on the keyboard layout.
var RING_KEY_PATTERN = /^([a-zA-Z0-9]|⇧[0-9])$/

// A typed key as stored: "S3", "shift+3", "Shift 3", "⇧ 3" all become "⇧3".
function ringKeyFrom(text) {
  var t = String(text || "").trim()
  var m = /^(\S+?)\s*\+?\s*([0-9])$/.exec(t)
  var mod = m ? m[1].toLowerCase() : ""
  // Keys.js's Shift spellings (Shift, Umschalt, ⇧), plus the short "S".
  return m && (mod === "s" || Keys.MODIFIER_ALIASES[mod] === "SHIFT") ? "⇧" + m[2] : t
}

// Keys of all rings at once: a key used twice keeps its first slot (inner ring first),
// anything that is not one letter or digit becomes "" (no key).
function cleanRingKeys(rings) {
  var seen = {}
  return rings.map(function (r) {
    return r.keys.map(function (k) {
      var key = typeof k === "string" ? ringKeyFrom(k) : ""
      if (!RING_KEY_PATTERN.test(key) || seen[key]) return ""
      seen[key] = true
      return key
    })
  })
}

// Cut to `count` or filled up with empty slots / no key.
function fitList(list, count, filler) {
  var out = list.slice(0, count)
  while (out.length < count) out.push(filler())
  return out
}

function cleanOneRing(raw, def, index, A) {
  if (!isPlainObject(raw)) return clone(def)
  var counts = A.RING_COUNTS[index]
  var count = counts.indexOf(raw.count) >= 0 ? raw.count : def.count
  var slots = Array.isArray(raw.slots) ? raw.slots.map(function (s) {
    var v = A.validateAction(s)
    return v.ok ? v.action : { type: "none" }
  }) : clone(def.slots)
  var keys = Array.isArray(raw.keys) ? raw.keys.slice() : def.keys.slice()
  return {
    enabled: index === 0 ? true : raw.enabled === true,
    count: count,
    slots: fitList(slots, count, function () { return { type: "none" } }),
    keys: fitList(keys, count, function () { return "" })
  }
}

function cleanHotkey(raw, A) {
  if (raw === null || raw === false || raw === "") return null
  if (!isPlainObject(raw)) return clone(RING_HOTKEY)
  var c = A.parseCombo([raw.mods, raw.key])
  // A bare letter would fire while typing: at least one modifier.
  return c && c.mods.length > 0 ? c : clone(RING_HOTKEY)
}

function cleanRing(raw, actions) {
  var A = actionsModule(actions)
  var d = ringDefaults(A)
  if (!isPlainObject(raw)) return d
  var rawRings = Array.isArray(raw.rings) ? raw.rings : []
  // Before there were three rings: `slots`/`keys` (12 each) were the only ring.
  if (!Array.isArray(raw.rings) && (Array.isArray(raw.slots) || Array.isArray(raw.keys)))
    rawRings = [{ enabled: true, count: 12,
                  slots: Array.isArray(raw.slots) ? raw.slots : d.rings[0].slots,
                  keys: Array.isArray(raw.keys) ? raw.keys : d.rings[0].keys }]
  var rings = d.rings.map(function (def, i) { return cleanOneRing(rawRings[i], def, i, A) })
  var keys = cleanRingKeys(rings)
  rings.forEach(function (r, i) { r.keys = keys[i] })
  return { enabled: raw.enabled === true, doubleMs: clampInt(raw.doubleMs, LIMITS.doubleMs),
           hotkey: Object.prototype.hasOwnProperty.call(raw, "hotkey") ? cleanHotkey(raw.hotkey, A) : clone(RING_HOTKEY),
           // Soft lines between the rings and their slots.
           dividers: raw.dividers !== false,
           // Look of the ring (Effects.js); the gesture trail has its own (trailStyle).
           style: RING_STYLES.indexOf(raw.style) >= 0 ? raw.style : "plain",
           rings: rings }
}

// Rings that are switched on, inner first, with their position in the settings.
function activeRings(ring) {
  var out = []
  ;(ring && Array.isArray(ring.rings) ? ring.rings : []).forEach(function (r, i) {
    if (r.enabled) out.push({ index: i, count: r.count, slots: r.slots, keys: r.keys })
  })
  return out
}

// Change the slot count of one ring: slots and keys are cut or filled up.
function setRingCount(ring, index, count, actions) {
  var next = clone(ring)
  next.rings[index].count = count
  return cleanRing(next, actions)
}

// "SUPER + ALT + R", the way Hyprland binds are written (also in Omarchy's bindings).
function hotkeyText(hotkey) {
  if (!hotkey) return ""
  return hotkey.mods.concat([hotkey.key]).join(" + ")
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
// Hyprland's native swipe is a gesture now ("tp3:swipe" / "tp4:swipe" in the bindings);
// the old `swipe` switches are moved there by sanitize.
function touchpadDefaults() {
  return { enabled: true, thresholdMm: LIMITS.thresholdMm.def, fingers: { tp3: true, tp4: true } }
}

// Whether Hyprland swipes workspaces natively with `f` ("tp3" / "tp4") fingers: the swipe
// gesture of the desktop profile carries the Hyprland swipe. The plugin then never sees
// left/right for that count.
function swipeOn(config, f, actions) {
  var A = actionsModule(actions)
  var t = config.touchpad || touchpadDefaults()
  if (!t.enabled) return false
  var a = (A.mergeBindings(config.bindings).default || {})[f + ":swipe"]
  return !!a && a.type === "dispatch" && a.id === A.SWIPE_ACTION
}

// Settings from before the swipe was a gesture: { tp3: true, tp4: false } becomes the
// bindings "tp3:swipe" = Hyprland swipe and "tp4:swipe" = none, unless set already.
function migrateSwipe(raw, A) {
  var swipe = isPlainObject(raw.touchpad) && isPlainObject(raw.touchpad.swipe) ? raw.touchpad.swipe : null
  if (!swipe) return raw.bindings
  var bindings = isPlainObject(raw.bindings) ? clone(raw.bindings) : {}
  if (!isPlainObject(bindings.default)) bindings.default = {}
  var builtin = A.mergeBindings({}).default || {}
  FINGERS.forEach(function (f) {
    var key = f + ":swipe"
    if (typeof swipe[f] !== "boolean" || Object.prototype.hasOwnProperty.call(bindings.default, key)) return
    var action = swipe[f] ? { type: "dispatch", id: A.SWIPE_ACTION } : { type: "none" }
    // Same as the built-in entry: nothing to store, the row is not "custom".
    if (JSON.stringify(builtin[key]) !== JSON.stringify(action)) bindings.default[key] = action
  })
  return bindings
}

function cleanTouchpad(raw) {
  var d = touchpadDefaults()
  if (!isPlainObject(raw)) return d
  var out = { enabled: raw.enabled !== false, thresholdMm: clampInt(raw.thresholdMm, LIMITS.thresholdMm),
              fingers: {} }
  FINGERS.forEach(function (f) {
    var fingers = isPlainObject(raw.fingers) ? raw.fingers[f] : undefined
    out.fingers[f] = typeof fingers === "boolean" ? fingers : d.fingers[f]
  })
  return out
}

// The Lua file input.lua loads (dofile) for Hyprland's native workspace swipe.
var HYPR_FILE_SUFFIX = "/.local/state/omarchy/settings/more-gestures-hypr.lua"

function hyprLua(config, actions) {
  var lines = ["-- Generated by More Gestures from its settings (trackpad: workspace swipe, ring hotkey).",
               "-- Do not edit: changes are overwritten. Loaded from ~/.config/hypr/input.lua."]
  FINGERS.forEach(function (f) {
    if (swipeOn(config, f, actions))
      lines.push('hl.gesture({ fingers = ' + f.slice(2) + ', direction = "horizontal", action = "workspace" })')
  })
  // Super+1…0 (Omarchy binds them by key code, code:10 … code:19) switch workspaces;
  // picking the workspace already shown changes nothing, so its hidden windows stayed
  // hidden. Rebound to the plugin's workspace action, which shows them again. Omarchy's
  // bindings load before input.lua, so the unbind finds them; ~/.config/hypr/bindings.lua
  // loads later and still wins.
  if (config.superDigits !== false) {
    var A2 = actionsModule(actions)
    for (var n = 1; n <= 10; n++) {
      var key = "SUPER + code:" + Ring.digitKeycode(n)
      lines.push('hl.unbind("' + key + '")')
      lines.push('hl.bind("' + key + '", function()\n' + A2.DISPATCH["workspace-" + n].chunk
        + '\nend, { description = "Switch to workspace ' + n + ' (More Gestures: shows hidden windows)" })')
    }
  }
  // The hotkey reaches Lua text: only a combo that passes Actions.parseCombo again
  // (allow-listed modifiers, key name [A-Za-z0-9_]) is written.
  var hk = config.ring && config.ring.hotkey ? actionsModule(actions).parseCombo([config.ring.hotkey.mods, config.ring.hotkey.key]) : null
  if (hk && hk.mods.length > 0)
    lines.push('hl.bind("' + hotkeyText(hk) + '", function() hl.exec_cmd("omarchy-shell -q more-gestures openRing") end, { description = "More Gestures: ring menu" })')
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
// The swipe gesture is Hyprland's, for every program at once: only in the desktop
// profile, and only with the Hyprland swipe or none (Actions.fitsGesture).
function swipeKeyFits(profile, key, action, A) {
  var gesture = splitKey(key).gesture
  if (gesture === "swipe" && profile !== "default") return false
  return A.fitsGesture(gesture, action)
}

function cleanBindings(raw, actions) {
  var A = actionsModule(actions)
  var out = {}
  PROFILES.forEach(function (p) { out[p] = {} })
  if (!isPlainObject(raw)) return out
  PROFILES.forEach(function (profile) {
    if (!isPlainObject(raw[profile])) return
    Object.keys(raw[profile]).forEach(function (key) {
      if (!A.GESTURE_KEY_PATTERN.test(key)) return
      if (!swipeKeyFits(profile, key, raw[profile][key], A)) return
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
    language: "auto",
    superDigits: true,
    trailStyle: "plain",
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
    language: LANGUAGES.indexOf(raw.language) >= 0 ? raw.language : "auto",
    // Super+1…0 run the plugin's workspace action (hyprLua), so they bring back windows
    // the wallpaper layer hid and close Exposé, like the ring's workspace slots.
    superDigits: raw.superDigits !== false,
    trailStyle: cleanTrailStyle(raw),
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
    bindings: cleanBindings(migrateSwipe(raw, A), A)
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
    native[f.slice(2)] = swipeOn(config, f, actions) ? ["L", "R"] : []
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

// The catalogue the interface uses: the chosen language, or with "auto" the one
// the locale maps to ("de_DE" -> "de", unknown -> "en"). Always a catalogue code, so
// the rest can compare it directly.
function uiLanguage(config, localeName) {
  var chosen = config && LANGUAGES.indexOf(config.language) > 0 ? config.language : ""
  return I18n.lang(chosen || localeName)
}

// The settings pages, in the order of the tab strip.
var SETTINGS_PAGES = ["general", "mouse", "trackpad", "ring", "setup", "changes"]

// One-time setup (the settings' Setup page and the README show the same text). The
// daemon reads mice, touchpads and keyboards from /dev/input and forwards the mouse
// through a copy made with /dev/uinput; Omarchy grants neither to the user. One udev
// rule tags both "uaccess", so systemd gives the person logged in at this computer
// access (not other users, not SSH sessions); the trigger applies it to the devices
// already plugged in, so no logout is needed. printf | tee works in bash, zsh and fish.
var SETUP_RULE_PATH = "/etc/udev/rules.d/70-more-gestures.rules"
var SETUP_RULES = [
  'KERNEL=="uinput", SUBSYSTEM=="misc", TAG+="uaccess", OPTIONS+="static_node=uinput"',
  'SUBSYSTEM=="input", KERNEL=="event*", TAG+="uaccess"'
]
var SETUP_COMMAND = "printf '%s\\n' " + SETUP_RULES.map(function(r) { return "'" + r + "'" }).join(" ") +
  " | sudo tee " + SETUP_RULE_PATH + " >/dev/null" +
  " && sudo udevadm control --reload" +
  " && sudo udevadm trigger --action=change --subsystem-match=input --subsystem-match=misc"
// Removing the rule takes effect with the next restart (granted access stays until then).
var SETUP_UNDO_COMMAND = "sudo rm " + SETUP_RULE_PATH

// What `gesture-daemon --check` printed, as { input, uinput, devices }; null when the
// output is not that (old daemon, Python missing). ready: both granted.
function parseAccess(text) {
  var a
  try { a = JSON.parse(String(text || "").trim()) } catch (e) { return null }
  if (!a || typeof a.input !== "boolean" || typeof a.uinput !== "boolean") return null
  return { input: a.input, uinput: a.uinput, devices: Number(a.devices) || 0, ready: a.input && a.uinput }
}

// The gesture rows a settings page lists. Shared "*" rows show on both device pages:
// the mouse and three fingers speak one gesture language, so editing one edits both.
// The mouse page leaves out trackpad-only rows, the trackpad page wheel and rocker.
// The trackpad page groups its rows: taps (corner taps and the 4-finger double tap),
// two fingers, three fingers (with the shared "*" shapes), four fingers. Each row gets
// `group` and, for the first of a group, `groupFirst`; the order inside a group stays.
var TRACKPAD_GROUPS = ["tap", "tp2", "tp3", "tp4"]

function trackpadGroup(row) {
  if (row.source === "tap" || row.gesture === "tap2") return "tap"
  if (row.source === "tp4") return "tp4"
  if (row.source === "tp2") return "tp2"
  return "tp3"
}

function rowsForPage(rows, page) {
  var list = rows.filter(function (r) {
    if (page === "mouse") return r.source === "*" || r.source === "mouse"
    if (page === "trackpad") return r.source !== "mouse" && !/^(wheel|rocker)-/.test(r.gesture)
    return false
  })
  if (page !== "trackpad") return list
  var tagged = list.map(function (r, i) {
    var out = {}
    for (var k in r) out[k] = r[k]
    out.group = trackpadGroup(r)
    out.order = i
    return out
  })
  // Taps by corner (top-left, top-right, bottom-left, bottom-right), then by count; the
  // 4-finger double tap last.
  function tapRank(g) {
    var m = /^(tl|tr|bl|br)([1-4])$/.exec(g)
    return m ? ["tl", "tr", "bl", "br"].indexOf(m[1]) * 10 + Number(m[2]) : 99
  }
  tagged.sort(function (a, b) {
    var x = TRACKPAD_GROUPS.indexOf(a.group), y = TRACKPAD_GROUPS.indexOf(b.group)
    if (x !== y) return x - y
    if (a.group === "tap") return tapRank(a.gesture) - tapRank(b.gesture) || a.order - b.order
    return a.order - b.order
  })
  return tagged.map(function (r, i) {
    r.groupFirst = i === 0 || tagged[i - 1].group !== r.group
    delete r.order
    return r
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
  if (!swipeKeyFits(profile, key, v.action, A)) return { ok: false, error: "swipe" }
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
  touchpadDefaults: touchpadDefaults, ringDefaults: ringDefaults, cleanRing: cleanRing, activeRings: activeRings,
  setRingCount: setRingCount, hotkeyText: hotkeyText, RING_HOTKEY: RING_HOTKEY,
  BAR_ACTIONS: BAR_ACTIONS, barDefaults: barDefaults, cleanBar: cleanBar, tapsDefaults: tapsDefaults, cleanTaps: cleanTaps, boundTaps: boundTaps, cleanTouchpad: cleanTouchpad, hyprLua: hyprLua, swipeOn: swipeOn, BUTTONS: BUTTONS, PROFILES: PROFILES, LIMITS: LIMITS,
  clone: clone, clampInt: clampInt, defaults: defaults, sanitize: sanitize, parse: parse,
  serialize: serialize, needsRestart: needsRestart, daemonConfig: daemonConfig,
  daemonConfigChanged: daemonConfigChanged, daemonConfigLine: daemonConfigLine,
  listBindings: listBindings, setBinding: setBinding, removeBinding: removeBinding,
  gestureKeyFor: gestureKeyFor, cleanExcludes: cleanExcludes, addExclude: addExclude,
  removeExclude: removeExclude, SETTINGS_PAGES: SETTINGS_PAGES,
  SETUP_RULE_PATH: SETUP_RULE_PATH, SETUP_RULES: SETUP_RULES, SETUP_COMMAND: SETUP_COMMAND,
  SETUP_UNDO_COMMAND: SETUP_UNDO_COMMAND, parseAccess: parseAccess, rowsForPage: rowsForPage,
  LANGUAGES: LANGUAGES, uiLanguage: uiLanguage, ringKeyFrom: ringKeyFrom, TRACKPAD_GROUPS: TRACKPAD_GROUPS, RING_STYLES: RING_STYLES
}
