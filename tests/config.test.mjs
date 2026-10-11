import { test } from "node:test"
import assert from "node:assert/strict"
import { load } from "./load.mjs"
const Config = load("Config.js")
const Actions = load("Actions.js")

test("broken, empty and foreign JSON give the defaults", () => {
  const d = Config.defaults()
  for (const text of ["", "{", "null", "[]", "42", '"x"', '{"enabled":', undefined])
    assert.deepEqual(Config.parse(text), d, String(text))
})

test("defaults", () => {
  const d = Config.defaults()
  assert.equal(d.enabled, true)
  assert.equal(d.button, "right")
  assert.equal(d.threshold, 20)
  assert.equal(d.holdMs, 350)
  assert.equal(d.rocker, false)
  assert.equal(d.wheel, true)
  assert.equal(d.indicator, "full")
  assert.equal(d.animations, true)
  assert.deepEqual(d.exclude, ["steam_app_*", "retroarch", "qemu*", "virt-manager", "gamescope"])
  assert.deepEqual(d.bindings, { default: {}, browser: {}, terminal: {} })
})

test("valid values survive a round trip", () => {
  const raw = { enabled: false, button: "extra", threshold: 35, holdMs: 500, rocker: true, wheel: false,
    indicator: "minimal", animations: false, exclude: ["foo", "bar*"] }
  const c = Config.parse(JSON.stringify(raw))
  for (const k of Object.keys(raw)) assert.deepEqual(c[k], raw[k], k)
  assert.deepEqual(Config.parse(Config.serialize(c)), c)
})

test("invalid scalars fall back or clamp", () => {
  const c = Config.parse(JSON.stringify({ button: "left", threshold: "abc", holdMs: -5,
    rocker: "yes", wheel: 0, indicator: "loud", animations: null, enabled: "no" }))
  assert.equal(c.button, "right")
  assert.equal(c.threshold, 20)
  assert.equal(c.holdMs, 0)
  assert.equal(c.rocker, false)
  assert.equal(c.wheel, true)
  assert.equal(c.indicator, "full")
  assert.equal(c.animations, true)
  assert.equal(c.enabled, true)
  assert.equal(Config.parse('{"threshold":99999}').threshold, 5000)
  assert.equal(Config.parse('{"threshold":0}').threshold, 1)
  assert.equal(Config.parse('{"threshold":12.6}').threshold, 13)
  assert.equal(Config.parse('{"threshold":null}').threshold, 20)
  assert.equal(Config.parse('{"threshold":true}').threshold, 20)
  assert.equal(Config.parse('{"holdMs":""}').holdMs, 350)
})

test("every trigger button is accepted", () => {
  for (const b of ["right", "middle", "side", "extra"])
    assert.equal(Config.parse(JSON.stringify({ button: b })).button, b)
})

test("exclusions: cleaned, de-duplicated, empty list stays empty, non-array means defaults", () => {
  const c = Config.parse(JSON.stringify({ exclude: ["  a ", "A", "", 5, null, "b\nc", "x".repeat(200)] }))
  assert.equal(c.exclude[0], "a")
  assert.equal(c.exclude[1], "b c")
  assert.equal(c.exclude[2].length, 64)
  assert.equal(c.exclude.length, 3)
  assert.deepEqual(Config.parse('{"exclude":[]}').exclude, [])
  assert.deepEqual(Config.parse('{"exclude":"nope"}').exclude, Actions.DEFAULT_EXCLUDES)
  const many = Array.from({ length: 300 }, (_, i) => "c" + i)
  assert.equal(Config.parse(JSON.stringify({ exclude: many })).exclude.length, 100)
})

test("exclusion add/remove", () => {
  assert.deepEqual(Config.addExclude(["a"], " b "), ["a", "b"])
  assert.deepEqual(Config.addExclude(["a"], "A"), ["a"])
  assert.deepEqual(Config.addExclude(["a"], "  "), ["a"])
  assert.deepEqual(Config.removeExclude(["a", "b", "c"], 1), ["a", "c"])
  assert.deepEqual(Config.removeExclude(["a"], 5), ["a"])
})

test("bindings: invalid profile, key and action are dropped, valid ones canonicalised", () => {
  const c = Config.parse(JSON.stringify({ bindings: {
    browser: { "*:DR": { type: "keys", combo: ["ctrl", "W"] }, "bogus": { type: "none" },
               "*:UD": { type: "keys", combo: ["CTRL", 'T"}) os.execute("x'] },
               "*:LR": { type: "dispatch", id: "no-such" } },
    weird: { "*:D": { type: "none" } },
    default: "oops"
  } }))
  assert.deepEqual(Object.keys(c.bindings), ["default", "browser", "terminal"])
  assert.deepEqual(c.bindings.browser, { "*:DR": { type: "keys", sequence: [{ mods: ["CTRL"], key: "W" }], label: "" } })
  assert.deepEqual(c.bindings.default, {})
})

test("serialize sanitizes, so the file never contains unvalidated data", () => {
  const dirty = Config.defaults()
  dirty.button = "nope"
  dirty.bindings.default["*:D"] = { type: "exec", command: "" }
  const back = JSON.parse(Config.serialize(dirty))
  assert.equal(back.button, "right")
  assert.deepEqual(back.bindings.default, {})
  assert.ok(Config.serialize(dirty).endsWith("\n"))
})

test("listBindings: defaults, sorted, flags", () => {
  const rows = Config.listBindings(Config.defaults(), "default")
  assert.deepEqual(rows.map(r => r.gesture).slice(0, 4), ["D", "L", "R", "U"])
  assert.ok(rows.every(r => r.hasDefault && !r.overridden))
  const wheel = rows.findIndex(r => r.gesture === "wheel-up")
  assert.ok(wheel > rows.findIndex(r => r.gesture === "DLU"))
  // The browser lists only what differs: the wheel switches tabs.
  assert.deepEqual(Config.listBindings(Config.defaults(), "browser").map(r => r.gesture), ["wheel-down", "wheel-up"])
  assert.equal(Config.listBindings(Config.defaults(), "nope").length, 0)
})

test("setBinding: override, add, and drop when equal to the built-in", () => {
  let c = Config.defaults()
  let r = Config.setBinding(c, "default", "*:DR", { type: "none" })
  assert.ok(r.ok)
  c = r.config
  assert.deepEqual(c.bindings.default["*:DR"], { type: "none" })
  const row = Config.listBindings(c, "default").find(x => x.key === "*:DR")
  assert.ok(row.overridden && row.hasDefault)
  assert.equal(row.action.type, "none")
  // putting the built-in action back removes the override again
  r = Config.setBinding(c, "default", "*:DR", { type: "keys", combo: ["CTRL", "W"], label: "close-tab" })
  assert.deepEqual(r.config.bindings.default, {})
  // new gesture
  r = Config.setBinding(c, "terminal", "*:UDU", { type: "exec", command: "echo hi", label: "Hi" })
  const added = Config.listBindings(r.config, "terminal").find(x => x.key === "*:UDU")
  assert.ok(added.overridden && !added.hasDefault)
  // input is not modified
  assert.deepEqual(c.bindings.terminal, {})
  assert.ok(Config.listBindings(Config.defaults(), "terminal").every(x => !x.overridden))
})

test("setBinding rejects bad input", () => {
  const c = Config.defaults()
  assert.equal(Config.setBinding(c, "nope", "*:D", { type: "none" }).ok, false)
  assert.equal(Config.setBinding(c, "default", "*:DDDDDD", { type: "none" }).ok, false)
  assert.equal(Config.setBinding(c, "default", "*:D", { type: "exec", command: " " }).ok, false)
  assert.equal(Config.setBinding(c, "default", "*:D", { type: "keys", combo: ["CTRL", "a b"] }).ok, false)
})

test("removeBinding: restores the built-in or deletes a custom entry", () => {
  let c = Config.setBinding(Config.defaults(), "default", "*:L", { type: "none" }).config
  c = Config.setBinding(c, "default", "*:ULD", { type: "none" }).config
  c = Config.removeBinding(c, "default", "*:L")
  assert.equal(Config.listBindings(c, "default").find(x => x.key === "*:L").action.type, "keys")
  c = Config.removeBinding(c, "default", "*:ULD")
  assert.equal(Config.listBindings(c, "default").find(x => x.key === "*:ULD"), undefined)
})

test("edited bindings take effect in Actions.resolve", () => {
  const c = Config.setBinding(Config.defaults(), "browser", "*:DR",
    { type: "keys", sequence: [{ mods: ["CTRL", "SHIFT"], key: "W" }], label: "" }).config
  const hit = Actions.resolve({ source: "mouse", gesture: "DR" }, { class: "x", tags: ["chromium-based-browser"] }, c)
  assert.deepEqual(hit.action.sequence, [{ mods: ["CTRL", "SHIFT"], key: "W" }])
})

test("gestureKeyFor", () => {
  assert.equal(Config.gestureKeyFor("*", "UD"), "*:UD")
  assert.equal(Config.gestureKeyFor("*", ""), "")
  assert.equal(Config.gestureKeyFor("*", "UDLRU"), "*:UDLRU")
  assert.equal(Config.gestureKeyFor("*", "UDLRUD"), "")
  assert.equal(Config.gestureKeyFor("tp3", "L"), "tp3:L")
  assert.equal(Config.gestureKeyFor("pen", "L"), "")
})

test("live apply: only the button restarts, the rest goes to the daemon", () => {
  const a = Config.defaults()
  const b = Config.clone(a)
  assert.equal(Config.needsRestart(a, b), false)
  assert.equal(Config.daemonConfigChanged(a, b), false)
  b.threshold = 40
  assert.equal(Config.needsRestart(a, b), false)
  assert.equal(Config.daemonConfigChanged(a, b), true)
  assert.equal(Config.daemonConfigLine(b), 'config {"threshold":40,"hold_ms":350,"rocker":false,'
    + '"ring":false,"double_ms":250,'
    + '"touchpad":{"enabled":true,"threshold_mm":8,"fingers":[3,4],"native":{"3":[],"4":["L","R"]}},'
    + '"taps":{"enabled":false,"corner_mm":14,"bound":[]}}')
  b.button = "middle"
  assert.equal(Config.needsRestart(a, b), true)
  // indicator, exclusions, bindings, wheel never touch the daemon
  const c = Config.clone(a)
  c.indicator = "off"; c.exclude = []; c.wheel = false
  assert.equal(Config.daemonConfigChanged(a, c), false)
  assert.equal(Config.needsRestart(a, c), false)
})

test("touchpad settings are cleaned and drive the native swipe file", () => {
  const c = Config.sanitize({ touchpad: { thresholdMm: 999, swipe: { tp3: true, tp4: "yes" }, fingers: { tp3: false } } })
  assert.equal(c.touchpad.thresholdMm, Config.LIMITS.thresholdMm.max)
  assert.deepEqual(c.touchpad.swipe, { tp3: true, tp4: true })
  assert.deepEqual(c.touchpad.fingers, { tp3: false, tp4: true })
  const lua = Config.hyprLua(c)
  assert.match(lua, /fingers = 3, direction = "horizontal", action = "workspace"/)
  assert.match(lua, /fingers = 4, direction = "horizontal"/)
  const off = Config.sanitize({ touchpad: { enabled: false } })
  assert.doesNotMatch(Config.hyprLua(off), /hl\.gesture/)
  assert.deepEqual(Config.daemonConfig(c).touchpad.fingers, [4])
  assert.deepEqual(Config.daemonConfig(c).touchpad.native, { 3: ["L", "R"], 4: ["L", "R"] })
})

test("corner taps: opt-in, bound list from all profiles", () => {
  const A = load("Actions.js")
  const off = Config.defaults(A)
  assert.equal(off.taps.enabled, false)
  assert.deepEqual(Config.daemonConfig(off, A).taps.bound, [])
  const on = Config.sanitize({ taps: { enabled: true, cornerMm: 99 } }, A)
  assert.equal(on.taps.cornerMm, Config.LIMITS.cornerMm.max)
  assert.deepEqual(Config.daemonConfig(on, A).taps.bound,
    ["bl2", "bl3", "br2", "br3", "tl2", "tl3", "tr2", "tr3"])
  const r = Config.setBinding(on, "default", "tap:tl3", { type: "none" }, A)
  assert.ok(!Config.daemonConfig(r.config, A).taps.bound.includes("tl3"))
})

test("ring settings: off by default, clamped, three rings", () => {
  const d = Config.defaults().ring
  assert.equal(d.enabled, false)
  assert.equal(d.doubleMs, 250)
  assert.equal(d.rings.length, 3)
  assert.deepEqual(d.rings.map(r => r.enabled), [true, false, false])
  assert.deepEqual(d.rings.map(r => r.count), [12, 12, 12])
  assert.equal(d.rings[0].slots[0].id, "expose")
  // Ring 2: "move the window there" next to each workspace of ring 1; ring 3 the
  // window and program actions.
  assert.equal(d.rings[1].slots[0].type, "none")
  assert.equal(d.rings[1].slots[1].id, "window-to-workspace-silent-1")
  assert.equal(d.rings[1].slots[6].type, "none")
  assert.equal(d.rings[1].slots[11].id, "window-to-workspace-silent-10")
  assert.equal(d.rings[2].slots[0].id, "window-close")
  d.rings.forEach(r => { assert.equal(r.slots.length, r.count); assert.equal(r.keys.length, r.count) })
  const c = Config.sanitize({ ring: { enabled: true, doubleMs: 5 } })
  assert.equal(c.ring.enabled, true)
  assert.equal(c.ring.doubleMs, 100)
  // A broken slot becomes empty, a valid one is kept; ring 1 cannot be switched off.
  const rings = JSON.parse(JSON.stringify(d.rings))
  rings[0].enabled = false
  rings[0].slots[0] = { type: "dispatch", id: "nope" }
  rings[2].enabled = true
  rings[2].slots[3] = { type: "dispatch", id: "workspace-7" }
  const e = Config.sanitize({ ring: { rings } })
  assert.equal(e.ring.rings[0].enabled, true)
  assert.deepEqual(e.ring.rings[0].slots[0], { type: "none" })
  assert.equal(e.ring.rings[2].slots[3].id, "workspace-7")
  assert.deepEqual(Config.activeRings(e.ring).map(r => r.index), [0, 2])
  assert.equal(Config.daemonConfig(c).ring, true)
  assert.equal(Config.daemonConfig(c).double_ms, 100)
})

test("ring: counts per ring, resizing cuts or fills", () => {
  const d = Config.defaults().ring
  // Ring 1 allows 8/12/16 only; 24 falls back to the default.
  const bad = Config.sanitize({ ring: { rings: [{ count: 24 }, { count: 7 }, { count: 24 }] } })
  assert.deepEqual(bad.ring.rings.map(r => r.count), [12, 12, 24])
  const small = Config.setRingCount(d, 2, 8)
  assert.equal(small.rings[2].slots.length, 8)
  assert.deepEqual(small.rings[2].keys, ["q", "f", "s", "a", "d", "n", "t", "o"])
  const big = Config.setRingCount(d, 0, 16)
  assert.equal(big.rings[0].slots.length, 16)
  assert.deepEqual(big.rings[0].slots[15], { type: "none" })
  assert.equal(big.rings[0].keys[15], "")
})

test("ring: old single-ring settings become ring 1", () => {
  const old = Config.defaults().ring.rings[0]
  const slots = JSON.parse(JSON.stringify(old.slots))
  slots[6] = { type: "none" }
  const c = Config.sanitize({ ring: { enabled: true, slots, keys: old.keys } })
  assert.deepEqual(c.ring.rings[0].slots[6], { type: "none" })
  assert.deepEqual(c.ring.rings[0].keys, old.keys)
  assert.equal(c.ring.rings[1].enabled, false)
})

test("ring hotkey: default, off, invalid, Lua line", () => {
  const A = load("Actions.js")
  const d = Config.defaults(A)
  assert.deepEqual(d.ring.hotkey, { mods: ["SUPER", "ALT"], key: "R" })
  assert.match(Config.hyprLua(d, A), /hl\.bind\("SUPER \+ ALT \+ R", function\(\) hl\.exec_cmd\("omarchy-shell -q more-gestures openRing"\) end, \{ description = "More Gestures: ring menu" \}\)/)
  const off = Config.sanitize({ ring: { hotkey: null } }, A)
  assert.equal(off.ring.hotkey, null)
  assert.doesNotMatch(Config.hyprLua(off, A), /hl\.bind/)
  // No modifier, or anything that could break out of the Lua string: back to the default.
  assert.deepEqual(Config.sanitize({ ring: { hotkey: { mods: [], key: "R" } } }, A).ring.hotkey, d.ring.hotkey)
  assert.deepEqual(Config.sanitize({ ring: { hotkey: { mods: ["CTRL"], key: 'R") os.exit() --' } } }, A).ring.hotkey, d.ring.hotkey)
  assert.equal(Config.hotkeyText({ mods: ["CTRL", "SHIFT"], key: "space" }), "CTRL + SHIFT + space")
})

test("bar icon settings", () => {
  assert.deepEqual(Config.defaults().bar, { show: true, left: "settings", middle: "toggle", right: "status", tooltip: true })
  const c = Config.sanitize({ bar: { left: "ring", middle: "bogus", tooltip: false, show: false } })
  assert.deepEqual(c.bar, { show: false, left: "ring", middle: "toggle", right: "status", tooltip: false })
})

test("ring keys: defaults, case, duplicates across rings", () => {
  const d = Config.defaults().ring
  assert.deepEqual(d.rings[0].keys, ["e", "1", "2", "3", "4", "5", "w", "6", "7", "8", "9", "0"])
  const rings = JSON.parse(JSON.stringify(d.rings))
  rings[0].keys[2] = "X"     // Shift+x: kept as upper case
  rings[0].keys[11] = "ab"   // not one key
  rings[1].keys[0] = "e"     // taken by ring 1
  rings[1].keys[1] = "x"     // lower x is another key than X
  const c = Config.sanitize({ ring: { rings } })
  assert.equal(c.ring.rings[0].keys[2], "X")
  assert.equal(c.ring.rings[0].keys[11], "")
  assert.equal(c.ring.rings[1].keys[0], "")
  assert.equal(c.ring.rings[1].keys[1], "x")
})

test("settings pages list the gesture rows of their device", () => {
  const rows = Config.listBindings(Config.defaults(), "default", Actions)
  const mouse = Config.rowsForPage(rows, "mouse")
  const pad = Config.rowsForPage(rows, "trackpad")
  const keys = (list) => list.map((r) => r.key)
  // The shared language shows on both pages.
  assert.ok(keys(mouse).includes("*:DR") && keys(pad).includes("*:DR"))
  assert.ok(keys(mouse).includes("*:wheel-up"))
  assert.ok(!keys(pad).some((k) => /wheel|rocker/.test(k)))
  assert.ok(keys(pad).includes("tp4:tap2") && !keys(mouse).includes("tp4:tap2"))
  assert.ok(!mouse.some((r) => /^(tp3|tp4|tap)$/.test(r.source)))
  assert.deepEqual(Config.rowsForPage(rows, "ring"), [])
  assert.deepEqual(Config.SETTINGS_PAGES, ["general", "mouse", "trackpad", "ring", "changes"])
})
