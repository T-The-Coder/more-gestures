.pragma library

// Key combination conversion for the settings UI. Pure functions (no QML, no I/O) so the
// same file runs in the shell and under `node --test`.
//
// Two inputs end in the same { mods: [...], key } shape that Actions.js validates:
//  - a Qt key event (modifier bits + Qt.Key code) from the recording field,
//  - text typed by hand: "Strg+Umschalt+T", "CTRL+SHIFT+T", "ctrl shift t".
// Nothing here is trusted by the Lua builder; Actions.validateAction checks again.

var MODIFIERS = ["SUPER", "CTRL", "ALT", "SHIFT"]  // canonical order, as in Actions.js

var MODIFIER_ALIASES = {
  strg: "CTRL", ctrl: "CTRL", control: "CTRL", ctl: "CTRL",
  umschalt: "SHIFT", shift: "SHIFT", "⇧": "SHIFT",
  alt: "ALT", option: "ALT",
  super: "SUPER", meta: "SUPER", win: "SUPER", windows: "SUPER", logo: "SUPER", mod4: "SUPER"
}

// Lower-case spelling -> xkb keysym name. Covers what the plan allows: arrows, Tab, Return,
// Escape, space, Prior/Next, Home/End, Delete, BackSpace, plus punctuation keys.
var KEY_ALIASES = {
  left: "Left", right: "Right", up: "Up", down: "Down",
  "←": "Left", "→": "Right", "↑": "Up", "↓": "Down",
  tab: "Tab", return: "Return", enter: "Return", escape: "Escape", esc: "Escape",
  space: "space", leertaste: "space",
  prior: "Prior", pageup: "Prior", pgup: "Prior", bildhoch: "Prior",
  next: "Next", pagedown: "Next", pgdn: "Next", bildrunter: "Next",
  home: "Home", pos1: "Home", end: "End", ende: "End",
  delete: "Delete", del: "Delete", entf: "Delete",
  insert: "Insert", ins: "Insert", einfg: "Insert",
  backspace: "BackSpace", rückschritt: "BackSpace", rueckschritt: "BackSpace",
  comma: "comma", period: "period", slash: "slash", semicolon: "semicolon",
  apostrophe: "apostrophe", bracketleft: "bracketleft", bracketright: "bracketright",
  minus: "minus", equal: "equal", grave: "grave", backslash: "backslash", plus: "plus",
  ",": "comma", ".": "period", "/": "slash", ";": "semicolon", "'": "apostrophe",
  "[": "bracketleft", "]": "bracketright", "-": "minus", "=": "equal", "`": "grave", "\\": "backslash"
}

// Qt::Key values (QtCore/qnamespace.h), hard-coded because a .pragma library has no Qt.*.
var MOD_SHIFT = 0x02000000
var MOD_CTRL = 0x04000000
var MOD_ALT = 0x08000000
var MOD_META = 0x10000000

var MODIFIER_KEYS = [0x01000020, 0x01000021, 0x01000022, 0x01000023, 0x01001103]  // Shift Ctrl Meta Alt, AltGr
var KEY_BACKTAB = 0x01000002  // Shift+Tab arrives as Backtab, not Tab
var KEY_F1 = 0x01000030

var QT_KEYS = {
  0x20: "space", 0x27: "apostrophe", 0x2c: "comma", 0x2d: "minus", 0x2e: "period", 0x2f: "slash",
  0x3b: "semicolon", 0x3d: "equal", 0x5b: "bracketleft", 0x5c: "backslash", 0x5d: "bracketright",
  0x60: "grave",
  0x01000000: "Escape", 0x01000001: "Tab", 0x01000003: "BackSpace",
  0x01000004: "Return", 0x01000005: "Return",  // main Enter and keypad Enter
  0x01000006: "Insert", 0x01000007: "Delete",
  0x01000010: "Home", 0x01000011: "End",
  0x01000012: "Left", 0x01000013: "Up", 0x01000014: "Right", 0x01000015: "Down",
  0x01000016: "Prior", 0x01000017: "Next",
  0x01000070: "XF86AudioLowerVolume", 0x01000071: "XF86AudioMute", 0x01000072: "XF86AudioRaiseVolume",
  0x01000080: "XF86AudioPlay", 0x01000081: "XF86AudioStop",
  0x01000082: "XF86AudioPrev", 0x01000083: "XF86AudioNext"
}

function isModifierKey(key) { return MODIFIER_KEYS.indexOf(key) >= 0 }

// Qt key code -> xkb name, or "" for keys the plugin cannot send.
function keyName(key) {
  if (key >= 0x41 && key <= 0x5a) return String.fromCharCode(key)
  if (key >= 0x30 && key <= 0x39) return String.fromCharCode(key)
  if (key >= KEY_F1 && key < KEY_F1 + 24) return "F" + (key - KEY_F1 + 1)
  return Object.prototype.hasOwnProperty.call(QT_KEYS, key) ? QT_KEYS[key] : ""
}

function canonicalMods(set) { return MODIFIERS.filter(function (m) { return set[m] }) }

// Qt key event -> { ok: true, combo: { mods, key } } or { ok: false, error }.
// Modifier-only presses answer error "modifier" so the recorder can keep waiting.
function comboFromQt(modifiers, key) {
  if (isModifierKey(key)) return { ok: false, error: "modifier" }
  var set = {}
  if (modifiers & MOD_META) set.SUPER = true
  if (modifiers & MOD_CTRL) set.CTRL = true
  if (modifiers & MOD_ALT) set.ALT = true
  if (modifiers & MOD_SHIFT) set.SHIFT = true
  if (key === KEY_BACKTAB) { key = 0x01000001; set.SHIFT = true }
  var name = keyName(key)
  if (name === "") return { ok: false, error: "key" }
  return { ok: true, combo: { mods: canonicalMods(set), key: name } }
}

// One key token as typed -> xkb name, or "" when unknown.
function keyFromToken(token) {
  var lower = token.toLowerCase()
  if (/^[a-z0-9]$/.test(lower)) return token.toUpperCase()
  var f = /^f([1-9]|1[0-9]|2[0-4])$/.exec(lower)
  if (f) return "F" + f[1]
  if (/^xf86[a-z0-9_]+$/i.test(token)) return "XF86" + token.slice(4)
  return Object.prototype.hasOwnProperty.call(KEY_ALIASES, lower) ? KEY_ALIASES[lower] : ""
}

// "Strg+Umschalt+T" / "CTRL SHIFT T" -> { ok: true, combo } or { ok: false, error }.
// error: "empty", "modifier" (unknown word before the key), "missing-key", "key" (unknown key),
// "duplicate" (same modifier twice).
function comboFromText(text) {
  var parts = String(text === undefined || text === null ? "" : text).trim().split(/\s*\+\s*|\s+/)
    .filter(function (p) { return p !== "" })
  if (parts.length === 0) return { ok: false, error: "empty" }
  var set = {}
  for (var i = 0; i < parts.length - 1; i++) {
    var lower = parts[i].toLowerCase()
    if (!Object.prototype.hasOwnProperty.call(MODIFIER_ALIASES, lower)) return { ok: false, error: "modifier" }
    var mod = MODIFIER_ALIASES[lower]
    if (set[mod]) return { ok: false, error: "duplicate" }
    set[mod] = true
  }
  var last = parts[parts.length - 1]
  if (Object.prototype.hasOwnProperty.call(MODIFIER_ALIASES, last.toLowerCase()))
    return { ok: false, error: "missing-key" }
  var key = keyFromToken(last)
  if (key === "") return { ok: false, error: "key" }
  return { ok: true, combo: { mods: canonicalMods(set), key: key } }
}

if (typeof module !== "undefined") module.exports = {
  isModifierKey: isModifierKey, keyName: keyName, comboFromQt: comboFromQt,
  comboFromText: comboFromText, keyFromToken: keyFromToken
}
