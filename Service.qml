import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import "Actions.js" as Actions
import "Config.js" as Config

// Gesture service: runs bin/gesture-daemon, turns its JSON lines into actions.
//
// The daemon grabs the mouse exclusively. Its stdin is the leash: when the shell
// dies the pipe closes, the daemon exits and the kernel releases the grab. So the
// daemon is only ever started from here, never detached.
Item {
  id: root

  readonly property string statePath: Quickshell.env("HOME") + "/.local/state/omarchy/settings/more-gestures.json"
  readonly property string daemonPath: decodeURIComponent(Qt.resolvedUrl("bin/gesture-daemon").toString().replace(/^file:\/\//, ""))
  // Settings › General › Language, else the system locale.
  readonly property string lang: Config.uiLanguage(root.config, Qt.locale().name)

  // Settings come from the state file, written by Settings.qml (shared contract: Config.js).
  // Broken or missing JSON yields the defaults instead of an error.
  property var config: Config.defaults(Actions)
  // Runtime switch from IPC; deliberately not persisted.
  property bool enabled: true

  property var activeWindow: ({ class: "", tags: [] })
  property bool passWanted: false
  property bool daemonReady: false
  property string lastGesture: ""
  property string lastAction: ""
  property int restarts: 0
  property int lastExitCode: -1
  property bool activeProbeAgain: false

  // Start only after the state file was read (or found missing), otherwise the daemon
  // would first start with the default button and restart a moment later.
  property bool configLoaded: false

  readonly property bool shouldRun: enabled && configLoaded && config.enabled

  FileView {
    id: stateFile
    path: root.statePath
    watchChanges: true
    atomicWrites: true
    printErrors: false
    onLoaded: { root.applyConfig(Config.parse(text(), Actions)); root.configLoaded = true; root.syncHyprFile() }
    onLoadFailed: { root.applyConfig(Config.defaults(Actions)); root.configLoaded = true; root.syncHyprFile() }
    onFileChanged: reload()
  }

  // The trigger button decides which devices the daemon grabs, so only a change of it
  // restarts the daemon. Threshold, hold time and rocker go to the running daemon as
  // `config {json}`; bindings, exclusions, indicator and wheel apply at once here.
  function applyConfig(next) {
    var prev = root.config
    root.config = next
    root.syncPass(true)
    root.syncHyprFile()
    if (Config.needsRestart(prev, next)) {
      if (daemon.running) {
        root.restarts = 0
        daemon.running = false  // onExited starts it again with the new arguments
      }
    } else if (Config.daemonConfigChanged(prev, next, Actions)) {
      root.sendLine(Config.daemonConfigLine(next, Actions))
    }
  }

  // ------------------------------------------------- native Hyprland gestures

  // Hyprland's workspace swipe follows the fingers, which the plugin cannot do, so it
  // stays native: Config.hyprLua writes the hl.gesture lines into a file that
  // ~/.config/hypr/input.lua loads with dofile. Rewritten (and Hyprland reloaded) only
  // when its content changes, so an ordinary start never reloads Hyprland.
  readonly property string hyprPath: Quickshell.env("HOME") + Config.HYPR_FILE_SUFFIX
  property bool hyprLoaded: false
  property bool hyprReloadPending: false

  FileView {
    id: hyprFile
    path: root.hyprPath
    blockAllReads: true
    atomicWrites: true
    printErrors: false
    onLoaded: { root.hyprLoaded = true; root.syncHyprFile() }
    onLoadFailed: { root.hyprLoaded = true; root.syncHyprFile() }
    onSaved: {
      if (!root.hyprReloadPending) return
      root.hyprReloadPending = false
      Quickshell.execDetached(["hyprctl", "reload"])
    }
  }

  function syncHyprFile() {
    if (!root.hyprLoaded || !root.configLoaded) return
    var wanted = Config.hyprLua(root.config, Actions)
    var current = ""
    try { current = hyprFile.text() } catch (e) { current = "" }
    if (current === wanted) return
    root.hyprReloadPending = true
    hyprFile.setText(wanted)
  }

  // ------------------------------------------------------------ active window

  // hyprctl activewindow -j is read-only. Tags are only there, not in the raw events.
  Process {
    id: activeProbe
    command: ["hyprctl", "activewindow", "-j"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        root.activeWindow = Actions.parseActiveWindow(text)
        root.syncPass(false)
        if (root.activeProbeAgain) {
          root.activeProbeAgain = false
          root.probeActiveWindow()
        }
      }
    }
  }

  function probeActiveWindow() {
    // A second request while one runs would be dropped by `running = true`, and the
    // answer in flight may predate the focus change.
    if (activeProbe.running) { root.activeProbeAgain = true; return }
    activeProbe.running = true
  }

  Timer {
    id: probeDebounce
    interval: 30
    onTriggered: root.probeActiveWindow()
  }

  Connections {
    target: Hyprland
    function onRawEvent(event) {
      var name = String(event && event.name ? event.name : "")
      if (name === "activewindowv2" || name === "activewindow" || name === "closewindow")
        probeDebounce.restart()
    }
  }

  // ------------------------------------------------------------------- daemon

  property var pendingLines: []

  function sendLine(line) {
    // Process.write before the child runs is lost silently, so queue until ready.
    if (!root.daemonReady || !daemon.running) { pendingLines.push(line); return }
    daemon.write(line + "\n")
  }

  property string sentPass: ""

  // `force` repeats the current state, needed after a daemon restart.
  function syncPass(force) {
    var wanted = Actions.isExcluded(root.activeWindow, root.config.exclude)
    root.passWanted = wanted
    var line = "pass " + (wanted ? "on" : "off")
    if (!force && line === root.sentPass) return
    root.sentPass = line
    root.sendLine(line)
  }

  function handleLine(line) {
    var event
    try { event = JSON.parse(line) } catch (e) { return }
    if (!event || typeof event.type !== "string") return
    if (event.type === "start") {
      // The window can have changed without an event we saw; look again before the
      // gesture ends (a drag takes far longer than hyprctl).
      root.probeActiveWindow()
      overlay.begin(event.source === "touchpad" ? "touchpad" : "mouse", event.fingers)
      return
    }
    if (event.type === "segment" && typeof event.dirs === "string") {
      var p = Actions.preview({ source: event.source || "mouse", fingers: event.fingers, gesture: event.dirs },
                              root.activeWindow, root.config, root.lang)
      overlay.update(event.dirs, p.name, p.valid)
      return
    }
    if (event.type === "progress") {
      overlay.setProgress(String(event.dir || ""), Number(event.ratio) || 0)
      return
    }
    if (event.type === "cancel") {
      overlay.cancel()
      return
    }
    if (event.type === "ring") {
      if (event.phase === "open") { root.probeActiveWindow(); ring.open() }
      else if (event.phase === "close") ring.release()
      else ring.cancel()
      return
    }
    // Recording for the settings' gesture editor: the next gesture is handed over
    // instead of acting (mouse line, wheel, rocker, 3/4 fingers, corner tap).
    if (Date.now() < root.recordUntil && (event.type === "end" || event.type === "wheel" || event.type === "rocker")) {
      var rec = Actions.recordedGesture(event)
      if (rec) {
        root.recordUntil = 0
        recordFile.setText(JSON.stringify({ source: rec.source, gesture: rec.gesture, at: Date.now() }) + "\n")
      }
      if (event.type === "end") overlay.finish(rec !== null)
      return
    }
    // The daemon swallows the wheel while the trigger is held; with the wheel setting off
    // the step is simply dropped instead of acting.
    if (event.type === "wheel" && !root.config.wheel) return
    var gesture = Actions.eventGesture(event)
    if (gesture === "") return
    var fired = root.fire(event, gesture)
    if (event.type === "end") overlay.finish(fired)
  }

  // Until when the next gesture is recorded instead of run (ms since epoch, 0 = not).
  property real recordUntil: 0
  // Where a recorded gesture goes; Settings.qml watches it. In the runtime dir: it only
  // matters while the settings are open.
  FileView {
    id: recordFile
    path: (Quickshell.env("XDG_RUNTIME_DIR") || "/tmp") + "/more-gestures-recorded.json"
    atomicWrites: true
    printErrors: false
  }

  // Returns true when an action was started.
  function fire(event, gesture) {
    var ev = { source: event.source || "mouse", fingers: event.fingers, gesture: gesture }
    root.lastGesture = Actions.gestureKey(ev)
    var hit = Actions.resolve(ev, root.activeWindow, root.config)
    if (!hit) { root.lastAction = ""; return false }
    root.lastAction = Actions.actionName(hit.action, root.lang)
    if (Actions.internalOf(hit.action) === "ring") {
      // Opened to stay (no button held on a trackpad): pick a slot with a tap or click.
      ring.open()
      ring.release()
      return true
    }
    var cmd = Actions.buildCommand(hit.action)
    if (cmd) Quickshell.execDetached(cmd.argv)
    return cmd !== null
  }

  function runRingSlot(action, point) {
    if (!action) return
    root.lastGesture = "ring"
    root.lastAction = Actions.actionName(action, root.lang)
    // Revalidates (the slot came from the settings file); `point` is where the ring was
    // opened, for actions on the window under the pointer.
    var cmd = Actions.buildCommand(action, point)
    if (cmd) Quickshell.execDetached(cmd.argv)
  }

  // "Show desktop" ends when another workspace is shown: the stashed windows go back to
  // their workspace (the Lua skips the active one). Debounced, a switch can come as
  // several property changes.
  Connections {
    target: Hyprland
    function onFocusedWorkspaceChanged() { restoreTimer.restart() }
  }
  Timer {
    id: restoreTimer
    interval: 150
    onTriggered: Quickshell.execDetached(["hyprctl", "eval", Actions.RESTORE_DESKTOPS_LUA])
  }

  RingOverlay {
    id: ring
    lang: root.lang
    rings: Config.activeRings(root.config.ring)
    dividers: root.config.ring.dividers
    onChosen: function(action, point) { root.runRingSlot(action, point) }
  }

  GestureOverlay {
    id: overlay
    indicator: root.config.indicator
    animations: root.config.animations
    lang: root.lang
  }

  function daemonCommand() {
    var c = root.config
    var cmd = ["python3", root.daemonPath, "--button", c.button,
               "--threshold", String(c.threshold), "--hold-ms", String(c.holdMs)]
    if (c.rocker) cmd.push("--rocker")
    return cmd
  }

  Process {
    id: daemon
    command: root.daemonCommand()
    stdinEnabled: true
    stdout: SplitParser { onRead: function(line) { root.handleLine(line) } }
    stderr: SplitParser { onRead: function(line) { console.warn("more-gestures daemon:", line) } }
    onStarted: {
      root.daemonReady = false
      overlay.cancel()
      ring.cancel()
      readyTimer.restart()
    }
    onExited: function(exitCode) {
      // A dead daemon will never send `end`; the input surfaces must not stay up.
      overlay.cancel()
      ring.cancel()
      root.daemonReady = false
      root.lastExitCode = exitCode
      readyTimer.stop()
      stableTimer.stop()
      if (!root.shouldRun) return
      // A daemon that dies at once (missing permission, bad device) must not spin:
      // wait 1 s, 2 s, 4 s ... up to 30 s.
      root.restarts++
      restartTimer.interval = Math.min(30000, 1000 * Math.pow(2, Math.min(root.restarts - 1, 5)))
      restartTimer.restart()
    }
  }

  // The daemon prints nothing on startup, so "ready" is a short delay after launch.
  Timer {
    id: readyTimer
    interval: 400
    onTriggered: {
      root.daemonReady = true
      stableTimer.restart()
      root.syncPass(true)
      // The command line only carries button, threshold and hold time; everything else
      // (touchpad, rocker) reaches a fresh daemon this way.
      root.sendLine(Config.daemonConfigLine(root.config, Actions))
      var queued = root.pendingLines
      root.pendingLines = []
      // syncPass above already covers queued pass lines; replay anything else.
      for (var i = 0; i < queued.length; i++) {
        if (queued[i].indexOf("pass ") !== 0) root.sendLine(queued[i])
      }
    }
  }

  // Ten seconds of uptime count as a healthy start and reset the backoff.
  Timer {
    id: stableTimer
    interval: 10000
    onTriggered: root.restarts = 0
  }

  Timer {
    id: restartTimer
    onTriggered: if (root.shouldRun && !daemon.running) daemon.running = true
  }

  onShouldRunChanged: {
    if (shouldRun) {
      restartTimer.stop()
      if (!daemon.running) daemon.running = true
    } else {
      restartTimer.stop()
      daemon.running = false
    }
  }

  Component.onCompleted: probeActiveWindow()

  // ---------------------------------------------------------------------- IPC

  IpcHandler {
    target: "more-gestures"

    function enable(): string { root.enabled = true; return "enabled" }
    function disable(): string { root.enabled = false; return "disabled" }
    function toggle(): string { root.enabled = !root.enabled; return root.enabled ? "enabled" : "disabled" }

    // Persistent on/off (bar icon, middle click): written to the settings file, which
    // this service watches and applies like any other change.
    function toggleSaved(): string {
      var next = Config.clone(root.config)
      next.enabled = !next.enabled
      stateFile.setText(Config.serialize(next, Actions))
      return next.enabled ? "enabled" : "disabled"
    }

    // Opens the ring to stay (bar icon or a keybinding): pick a slot with a click.
    function openRing(): string { ring.open(); ring.release(); return "ok" }
    // The settings' "Record" button: the next gesture is written to the runtime file
    // instead of acting, for at most 15 seconds.
    function recordGesture(): string { root.recordUntil = Date.now() + 15000; return "recording" }
    function stopRecording(): string { root.recordUntil = 0; return "stopped" }

    // A short summary as a desktop notification (bar icon, right click).
    function notifyStatus(): string {
      var c = root.config
      var de = Actions.lang(root.lang) === "de"
      var on = function (b) { return b ? (de ? "an" : "on") : (de ? "aus" : "off") }
      var title = "More Gestures: " + on(c.enabled && root.enabled)
      var lines = [
        (de ? "Maus: " : "Mouse: ") + (c.enabled ? (de ? "Taste " : "button ") + c.button : on(false)),
        (de ? "Trackpad: " : "Trackpad: ") + on(c.touchpad.enabled),
        (de ? "Ecken-Tipps: " : "Corner taps: ") + on(c.taps.enabled),
        (de ? "Kreismenü: " : "Ring menu: ") + on(c.ring.enabled)
      ]
      if (root.lastGesture) lines.push((de ? "Zuletzt: " : "Last: ") + root.lastGesture + (root.lastAction ? " → " + root.lastAction : ""))
      if (root.passWanted) lines.push(de ? "Pausiert für dieses Fenster (Ausschlussliste)" : "Paused for this window (exclusions)")
      Quickshell.execDetached(["omarchy-notification-send", title, lines.join("\n")])
      return "ok"
    }
    // Opens the settings overlay (same as the launcher entry from bin/install-app-entry).
    function settings(): string {
      Quickshell.execDetached(["omarchy-shell", "shell", "toggle", "more-gestures"])
      return "ok"
    }

    // JSON for diagnosis: daemon state, active window, last gesture.
    function status(): string {
      return JSON.stringify({
        enabled: root.enabled,
        configEnabled: root.config.enabled,
        daemonRunning: daemon.running,
        daemonReady: root.daemonReady,
        restarts: root.restarts,
        lastExitCode: root.lastExitCode,
        button: root.config.button,
        activeWindow: root.activeWindow,
        profiles: Actions.profilesFor(root.activeWindow),
        pass: root.passWanted,
        lastGesture: root.lastGesture,
        lastAction: root.lastAction
      })
    }
  }
}
