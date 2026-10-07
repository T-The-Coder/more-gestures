import { test } from "node:test"
import assert from "node:assert/strict"
import { load } from "./load.mjs"
const Keys = load("Keys.js")
const Actions = load("Actions.js")
const I18n = load("I18n.js")

const SHIFT = 0x02000000, CTRL = 0x04000000, ALT = 0x08000000, META = 0x10000000

test("Qt event: modifiers and letter", () => {
  const r = Keys.comboFromQt(CTRL | SHIFT, 0x54)
  assert.deepEqual(r, { ok: true, combo: { mods: ["CTRL", "SHIFT"], key: "T" } })
})

test("Qt event: canonical modifier order regardless of bit order", () => {
  const r = Keys.comboFromQt(ALT | META | CTRL | SHIFT, 0x31)
  assert.deepEqual(r.combo, { mods: ["SUPER", "CTRL", "ALT", "SHIFT"], key: "1" })
})

test("Qt event: modifier-only presses are not a combination", () => {
  for (const k of [0x01000020, 0x01000021, 0x01000022, 0x01000023])
    assert.deepEqual(Keys.comboFromQt(CTRL, k), { ok: false, error: "modifier" })
})

test("Qt event: function, arrow, page and media keys", () => {
  assert.equal(Keys.comboFromQt(0, 0x01000034).combo.key, "F5")
  assert.equal(Keys.comboFromQt(0, 0x01000047).combo.key, "F24")
  assert.equal(Keys.comboFromQt(ALT, 0x01000012).combo.key, "Left")
  assert.equal(Keys.comboFromQt(0, 0x01000016).combo.key, "Prior")
  assert.equal(Keys.comboFromQt(0, 0x01000017).combo.key, "Next")
  assert.equal(Keys.comboFromQt(0, 0x01000005).combo.key, "Return")
  assert.equal(Keys.comboFromQt(0, 0x01000003).combo.key, "BackSpace")
  assert.equal(Keys.comboFromQt(0, 0x20).combo.key, "space")
  assert.equal(Keys.comboFromQt(0, 0x01000080).combo.key, "XF86AudioPlay")
})

test("Qt event: Shift+Tab arrives as Backtab and is reported as Shift+Tab", () => {
  assert.deepEqual(Keys.comboFromQt(CTRL, 0x01000002).combo, { mods: ["CTRL", "SHIFT"], key: "Tab" })
})

test("Qt event: unknown keys are refused", () => {
  assert.deepEqual(Keys.comboFromQt(0, 0x01000055), { ok: false, error: "key" })  // F38
  assert.deepEqual(Keys.comboFromQt(0, 0xe4), { ok: false, error: "key" })
})

test("text: German, English and loose spellings give the same combo", () => {
  const want = { mods: ["CTRL", "SHIFT"], key: "T" }
  for (const t of ["Strg+Umschalt+T", "CTRL+SHIFT+T", "ctrl + shift + t", "shift ctrl t", "  Ctrl+Shift+T "])
    assert.deepEqual(Keys.comboFromText(t), { ok: true, combo: want }, t)
})

test("text: bare keys, F keys, named keys", () => {
  assert.deepEqual(Keys.comboFromText("F5").combo, { mods: [], key: "F5" })
  assert.equal(Keys.comboFromText("alt+enter").combo.key, "Return")
  assert.equal(Keys.comboFromText("Alt+Left").combo.key, "Left")
  assert.equal(Keys.comboFromText("super+pageup").combo.key, "Prior")
  assert.equal(Keys.comboFromText("Strg+Entf").combo.key, "Delete")
  assert.equal(Keys.comboFromText("Ctrl+,").combo.key, "comma")
  assert.equal(Keys.comboFromText("XF86AudioMute").combo.key, "XF86AudioMute")
  assert.equal(Keys.comboFromText("xf86AudioMute").combo.key, "XF86AudioMute")
  assert.equal(Keys.comboFromText("f24").combo.key, "F24")
})

test("text: errors", () => {
  assert.equal(Keys.comboFromText("").error, "empty")
  assert.equal(Keys.comboFromText("   ").error, "empty")
  assert.equal(Keys.comboFromText(undefined).error, "empty")
  assert.equal(Keys.comboFromText("Ctrl+Shift").error, "missing-key")
  assert.equal(Keys.comboFromText("Hyper+T").error, "modifier")
  assert.equal(Keys.comboFromText("Ctrl+Ctrl+T").error, "duplicate")
  assert.equal(Keys.comboFromText("Ctrl+F25").error, "key")
  assert.equal(Keys.comboFromText("Ctrl+Nonsense").error, "key")
})

test("text: injection attempts never yield a combo", () => {
  for (const t of ['T"}) os.execute("x', "T'; rm -rf ~", 'Ctrl+"; x', "a;b", "Ctrl+T\nF5"]) {
    const r = Keys.comboFromText(t)
    assert.equal(r.ok, false, t)
  }
})

test("every combo from text or Qt passes Actions.validateAction", () => {
  for (const t of ["Strg+Umschalt+T", "F5", "Alt+Return", "Ctrl+,", "Super+space", "XF86AudioPlay"]) {
    const c = Keys.comboFromText(t).combo
    assert.ok(Actions.validateAction({ type: "keys", combo: [c.mods, c.key] }).ok, t)
  }
  const q = Keys.comboFromQt(CTRL | ALT, 0x01000013).combo
  assert.ok(Actions.validateAction({ type: "keys", sequence: [q] }).ok)
})

test("round trip: combo -> localized text -> combo", () => {
  const combo = { mods: ["SUPER", "CTRL", "ALT", "SHIFT"], key: "Prior" }
  for (const l of ["en", "de"]) {
    const text = Actions.keysText([combo], l)
    assert.deepEqual(Keys.comboFromText(text).combo, combo, text)
  }
  assert.equal(Actions.keysText([combo], "de"), "Super+Strg+Alt+Umschalt+Prior")
})

test("I18n: both languages have the same keys, no empty strings", () => {
  const en = Object.keys(I18n.STRINGS.en).sort()
  const de = Object.keys(I18n.STRINGS.de).sort()
  assert.deepEqual(de, en)
  for (const l of ["en", "de"]) for (const k of en) assert.ok(I18n.STRINGS[l][k] !== "", `${l}.${k}`)
})

test("I18n: language pick and fallbacks", () => {
  assert.equal(I18n.tr("de_DE", "save"), "Speichern")
  assert.equal(I18n.tr("en_US", "save"), "Save")
  assert.equal(I18n.tr("fr_FR", "save"), "Save")
  assert.equal(I18n.tr("de", "no-such-key"), "no-such-key")
  assert.equal(I18n.keyError("en", "key"), I18n.STRINGS.en.err_key)
  assert.equal(I18n.keyError("de", "weird"), I18n.STRINGS.de.err_action)
})
