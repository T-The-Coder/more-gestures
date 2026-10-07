import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

// The plugin's .js files start with the QML-only `.pragma library` line, a syntax error
// under node. Strip it and evaluate the rest like a CommonJS module; `require("./X.js")`
// inside them resolves through this loader too.
const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const cache = {}

export function load(name) {
  const file = name.replace(/^\.\//, "")
  if (cache[file]) return cache[file]
  const source = readFileSync(join(root, file), "utf8").replace(/^\.pragma library\s*$/m, "")
  const mod = { exports: {} }
  new Function("module", "require", source)(mod, load)
  return (cache[file] = mod.exports)
}
