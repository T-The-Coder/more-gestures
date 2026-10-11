import { test } from "node:test"
import assert from "node:assert/strict"
import { load } from "./load.mjs"
const I = load("I18n.js")
const A = load("Actions.js")

const en = I.catalogs.en
const placeholders = text => (String(text).match(/\{[a-z]+\}|%1/g) || []).sort()

test("30 languages, each complete, with the same placeholders as English", () => {
  assert.equal(I.LANGUAGES.length, 30)
  for (const code of I.LANGUAGES) {
    const cat = I.catalogs[code]
    for (const key of Object.keys(en)) {
      assert.ok(Object.prototype.hasOwnProperty.call(cat, key), `${code}: ${key}`)
      assert.ok(String(cat[key]).trim() !== "", `${code}: ${key} empty`)
      assert.deepEqual(placeholders(cat[key]), placeholders(en[key]), `${code}: ${key}`)
    }
    for (const key of Object.keys(cat)) assert.ok(key in en, `${code}: stray ${key}`)
  }
})

test("every desktop action has a name, the numbered ones a template", () => {
  for (const id of Object.keys(A.DISPATCH)) {
    const name = A.dispatchName(id, "en")
    assert.ok(name && !name.startsWith("act_"), id)
  }
  assert.ok(en["act_workspace-n"].includes("%1"))
  assert.ok(en["act_window-to-workspace-silent-n"].includes("%1"))
})

test("locale names map to catalogues; names in other languages come from them", () => {
  assert.equal(I.lang("fr_FR.UTF-8"), "fr")
  assert.equal(I.lang("pt-BR"), "pt")
  assert.equal(I.lang("zh_TW"), "zh_TW")
  assert.equal(I.lang("zh_HK"), "zh_TW")
  assert.equal(I.lang("zh_SG"), "zh_CN")
  assert.equal(I.lang("nn_NO"), "nb")
  assert.equal(I.lang("xx_YY"), "en")
  assert.equal(A.dispatchName("workspace-3", "fr"), I.catalogs.fr["act_workspace-n"].replace("%1", "3"))
  assert.equal(A.dispatchName("workspace-3", "de"), "Arbeitsfläche 3")
  assert.equal(A.actionName({ type: "dispatch", id: "files" }, "ja"), I.catalogs.ja.act_files)
  assert.equal(A.actionName({ type: "keys", combo: ["ALT", "Left"], label: "back" }, "es"), I.catalogs.es.label_back + " (Alt+Left)")
})
