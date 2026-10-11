import QtQuick
import Quickshell
import Quickshell.Io
import "Actions.js" as Actions

// Whether the Exposé plugin (expose.window-overview) can be used: installed and not
// disabled in shell.json. The same rule as Actions.EXPOSE_AVAILABLE_LUA, which decides
// when an action runs; this copy is for what the shell shows (the ring's label, the
// settings hint). check() reads both files again.
QtObject {
  id: check
  readonly property string configHome: Quickshell.env("XDG_CONFIG_HOME") || (Quickshell.env("HOME") + "/.config")
  property bool manifestFound: false
  property string shellText: ""
  readonly property bool available: Actions.exposeAvailable(manifestFound, shellText)

  function refresh() {
    manifest.reload()
    shell.reload()
  }

  property FileView manifest: FileView {
    path: check.configHome + "/omarchy/plugins/expose.window-overview/manifest.json"
    printErrors: false
    onLoaded: check.manifestFound = true
    onLoadFailed: check.manifestFound = false
  }
  property FileView shell: FileView {
    path: check.configHome + "/omarchy/shell.json"
    printErrors: false
    watchChanges: true
    onFileChanged: reload()
    onLoaded: check.shellText = text()
    onLoadFailed: check.shellText = ""
  }
}
