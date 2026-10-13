import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

// The plugin's .js files start with the QML-only `.pragma library` line, a syntax error
// under node. Strip it and evaluate the rest like a CommonJS module; `require("./X.js")`
// inside them resolves through this loader too.
export const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const cache = {}

export function load(name) {
  const file = name.replace(/^\.\//, "")
  if (cache[file]) return cache[file]
  // `.import "x.js" as Name` (QML) becomes `var Name = require("x.js")`, paths from the
  // plugin root as in QML (every importing file sits there).
  const source = readFileSync(join(root, file), "utf8").replace(/^\.pragma library\s*$/m, "")
    .replace(/^\.import "([^"]+)" as (\w+)\s*$/gm, 'var $2 = require("$1")')
  const mod = { exports: {} }
  new Function("module", "require", source)(mod, load)
  return (cache[file] = mod.exports)
}
