import QtQuick
import Quickshell
import Quickshell.Io
import "Actions.js" as Actions
import "Config.js" as Config

// Export and import of the settings (Settings › General), as in More Time and More
// Weather: everything in one JSON file. An import is checked like the settings file
// itself (Config.sanitize), preceded by a backup of the settings it replaces, and then
// saved like any other change. Importing the backup itself undoes the last import.
QtObject {
  id: transfer
  required property var owner   // the Settings root: working, applyImported()

  readonly property string home: Quickshell.env("HOME")
  readonly property string backupPath: home + "/.local/state/omarchy/settings/more-gestures-settings-backup.json"
  // The downloads folder from user-dirs.dirs, else ~/Downloads.
  property string downloadsDirectory: home + "/Downloads"
  readonly property string defaultPath: downloadsDirectory + "/more-gestures-settings.json"

  // The outcome of the last export or import: { key: string key, path, error: bool }.
  property var status: null
  property bool busy: false

  property FileView userDirs: FileView {
    path: transfer.home + "/.config/user-dirs.dirs"
    printErrors: false
    onLoaded: {
      var match = String(text()).match(/^XDG_DOWNLOAD_DIR="([^"]+)"/m)
      if (match) transfer.downloadsDirectory = match[1].replace(/^\$HOME/, transfer.home)
    }
  }

  function snapshot() {
    return {
      app: "more-gestures",
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: Config.sanitize(owner.working, Actions)
    }
  }

  // A path as shown: the home folder as ~.
  function shown(path) {
    var text = String(path || "")
    return text.indexOf(home + "/") === 0 ? "~" + text.slice(home.length) : text
  }

  // A leading ~ stands for the home folder, as in a shell.
  function expanded(path) {
    var text = String(path || "").replace(/^\s+|\s+$/g, "")
    return text.indexOf("~/") === 0 ? home + text.slice(1) : text
  }

  property FileView writer: FileView {
    printErrors: false
    atomicWrites: true
    property string purpose: ""
    onSaved: {
      if (purpose === "backup") {
        transfer.startImport()
        return
      }
      transfer.finish({ key: "settingsExported", path: path, error: false })
    }
    onSaveFailed: {
      // Without a backup nothing is replaced.
      transfer.finish({ key: purpose === "export" ? "settingsExportFailed" : "settingsBackupFailed",
        path: path, error: true })
    }
  }

  function finish(result) {
    status = result
    busy = false
  }

  function exportTo(path) {
    var target = expanded(path)
    if (!target || busy) return
    busy = true
    writer.purpose = "export"
    writer.path = target
    writer.setText(JSON.stringify(snapshot(), null, 2) + "\n")
  }

  property string importPath: ""

  function importFrom(path) {
    var source = expanded(path)
    if (!source || busy) return
    busy = true
    importPath = source
    // Importing the backup must not overwrite it with the settings it is meant to replace.
    if (source === backupPath) {
      startImport()
      return
    }
    writer.purpose = "backup"
    writer.path = backupPath
    writer.setText(JSON.stringify(snapshot(), null, 2) + "\n")
  }

  property FileView reader: FileView {
    printErrors: false
    blockAllReads: true
    onLoaded: transfer.apply(text())
    onLoadFailed: transfer.finish({ key: "settingsImportMissing", path: path, error: true })
  }

  function startImport() {
    // The same path set again would not read the file anew.
    reader.path = ""
    reader.path = importPath
  }

  function apply(raw) {
    var data = null
    try { data = JSON.parse(String(raw || "")) } catch (e) { data = null }
    if (!data || typeof data !== "object" || data.app !== "more-gestures" || typeof data.settings !== "object") {
      finish({ key: "settingsImportInvalid", path: importPath, error: true })
      return
    }
    owner.applyImported(Config.sanitize(data.settings, Actions))
    finish({ key: importPath === backupPath ? "settingsRestored" : "settingsImported", path: importPath, error: false })
  }
}
