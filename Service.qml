import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import "Actions.js" as Actions

// Gesture service: runs bin/gesture-daemon, turns its JSON lines into actions.
//
// The daemon grabs the mouse exclusively. Its stdin is the leash: when the shell
// dies the pipe closes, the daemon exits and the kernel releases the grab. So the
// daemon is only ever started from here, never detached.
Item {
  id: root

  readonly property string statePath: Quickshell.env("HOME") + "/.local/state/omarchy/settings/more-gestures.json"
  readonly property string daemonPath: decodeURIComponent(Qt.resolvedUrl("bin/gesture-daemon").toString().replace(/^file:\/\//, ""))
  readonly property string lang: Qt.locale().name

  // Settings come from the state file (written by the settings UI in a later step).
  // Broken or missing JSON yields the defaults instead of an error.
  property var config: parseConfig("")
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

  function parseConfig(text) {
    var raw = {}
    try { raw = JSON.parse(text) } catch (e) { raw = {} }
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) raw = {}
    function num(v, lo, hi, fallback) {
      var n = Number(v)
      return isFinite(n) && n >= lo && n <= hi ? n : fallback
    }
    var buttons = ["right", "middle", "side", "extra"]
    return {
      enabled: raw.enabled !== false,
      button: buttons.indexOf(raw.button) >= 0 ? raw.button : "right",
      threshold: num(raw.threshold, 1, 5000, 20),
      holdMs: num(raw.holdMs, 0, 5000, 350),
      rocker: raw.rocker === true,
      exclude: Array.isArray(raw.exclude) ? raw.exclude : Actions.DEFAULT_EXCLUDES,
      bindings: raw.bindings
    }
  }

  FileView {
    id: stateFile
    path: root.statePath
    watchChanges: true
    atomicWrites: true
    printErrors: false
    onLoaded: { root.applyConfig(root.parseConfig(text())); root.configLoaded = true }
    onLoadFailed: { root.applyConfig(root.parseConfig("")); root.configLoaded = true }
    onFileChanged: reload()
  }

  // The trigger button is a daemon start argument, so only a change of it (or of the
  // other start values) needs a restart; bindings and exclusions apply at once.
  function applyConfig(next) {
    var restart = next.button !== root.config.button
      || next.threshold !== root.config.threshold
      || next.holdMs !== root.config.holdMs
      || next.rocker !== root.config.rocker
    root.config = next
    root.syncPass(true)
    if (restart && daemon.running) {
      root.restarts = 0
      daemon.running = false  // onExited starts it again
    }
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
      return
    }
    var gesture = Actions.eventGesture(event)
    if (gesture === "") return
    root.fire(event, gesture)
  }

  function fire(event, gesture) {
    var ev = { source: event.source || "mouse", fingers: event.fingers, gesture: gesture }
    root.lastGesture = Actions.gestureKey(ev)
    var hit = Actions.resolve(ev, root.activeWindow, root.config)
    if (!hit) { root.lastAction = ""; return }
    root.lastAction = Actions.actionName(hit.action, root.lang)
    var cmd = Actions.buildCommand(hit.action)
    if (cmd) Quickshell.execDetached(cmd.argv)
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
      readyTimer.restart()
    }
    onExited: function(exitCode) {
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
