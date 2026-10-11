import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons
import qs.Ui
import "Actions.js" as Actions
import "Config.js" as Config
import "Keys.js" as KeyCombo
import "I18n.js" as I18n
import "Effects.js" as Effects

// Settings overlay for More Gestures, in pages like More Time and More Weather: General
// (on/off, indicator, menu bar, app launcher, exclusions), Mouse, Trackpad, Ring menu and
// Update log. Tab / Shift+Tab switch pages. The gesture list shows on the Mouse and the
// Trackpad page, each with its device's rows (the shared ones on both).
//
// Edits a working copy and writes ~/.local/state/omarchy/settings/more-gestures.json only
// on Save. Service.qml watches that file and applies it live: a new trigger button
// restarts the daemon, everything else goes to the running daemon or applies at once.
// Opened with `omarchy-shell shell toggle more-gestures`.
Item {
  id: root

  // Injected by omarchy-shell.
  property var shell: null
  property var service: null
  property var manifest: null

  property bool opened: false
  property var working: Config.defaults(Actions)
  property string profile: "default"
  // Follows the working copy, so a new language shows before Save.
  readonly property string lang: Config.uiLanguage(root.working, Qt.locale().name)
  function tr(key) { return I18n.tr(root.lang, key) }

  // Editor state. editKey === "" with editorOpen means "new gesture".
  property bool editorOpen: false
  property string editKey: ""
  property string editGesture: ""
  property string editSource: "*"       // "*", "mouse", "tp3", "tp4", "tap"
  property string editCorner: "tl"      // tap source: corner and count make the gesture
  property int editCount: 2
  property string editType: "dispatch"
  property string editDispatch: "workspace-prev"
  property var editSteps: [""]          // keys: one text per combination
  property string editCommand: ""
  property string editLabel: ""
  property string editError: ""
  property int recordingStep: -1        // index of the step being recorded, -1 = none

  readonly property string statePath: Quickshell.env("HOME") + Config.PATH_SUFFIX
  // Exposé is an action here, but it needs the expose.window-overview plugin.
  property bool exposeInstalled: true

  // Shares the [menu] surface tokens like the other Omarchy overlays.
  readonly property color background: Color.menu.background
  readonly property color foreground: Color.menu.text
  readonly property color accent: Color.accent
  readonly property color muted: Qt.darker(root.foreground, 1.6)
  readonly property var borderSpec: Border.surfaceSpec("menu", "border", Color.menu.border, Math.max(1, Style.space(2)))
  readonly property string fontFamily: Style.font.menuFamily

  readonly property var rows: Config.listBindings(root.working, root.profile, Actions)
  // The rows the current page lists (mouse or trackpad; the shared ones on both).
  readonly property var pageRows: Config.rowsForPage(root.rows, root.page)

  // The open settings page; kept while the shell runs, so reopening returns to it.
  property string page: "general"

  function showPage(name) {
    if (Config.SETTINGS_PAGES.indexOf(name) < 0) return
    root.recordingStep = -1
    // The editor belongs to the gesture list of the page it was opened on.
    if (root.editorOpen && !((root.page === "mouse" || root.page === "trackpad") && (name === "mouse" || name === "trackpad")))
      root.closeEditor()
    root.page = name
    scroller.contentY = 0
    keyCatcher.forceActiveFocus()
  }

  function stepPage(delta) {
    var pages = Config.SETTINGS_PAGES
    var i = pages.indexOf(root.page)
    root.showPage(pages[(i + delta + pages.length) % pages.length])
  }

  // Wheel and touchpad as in More Time and More Weather (Panel.wheelPixels): Omarchy
  // scales touchpad scrolling down to 0.4, which made the page crawl, so pixel deltas are
  // scaled back up; a mouse wheel scrolls a fixed step per notch. Flickable's own wheel
  // handling is not used.
  readonly property real touchpadScrollFactor: 2.5
  function wheelPixels(wheel) {
    if (wheel.pixelDelta.y !== 0) return wheel.pixelDelta.y * root.touchpadScrollFactor
    return wheel.angleDelta.y / 120 * Style.space(60)
  }

  function scrollBy(dy) {
    scroller.contentY = Math.max(0, Math.min(scroller.contentHeight - scroller.height, scroller.contentY + dy))
  }

  // ---------------------------------------------------------- app launcher entry
  // bin/install-app-entry adds or removes the launcher entry (and the theme hook that
  // recolors its icon) at once, not on Save: it is a file outside the settings.
  readonly property string desktopPath: Quickshell.env("HOME") + "/.local/share/applications/more-gestures.desktop"
  property bool launcherInstalled: false

  function setLauncher(on) {
    if (launcherProc.running || on === root.launcherInstalled) return
    root.launcherInstalled = on   // shown at once; the file check confirms or reverts it
    var script = String(Qt.resolvedUrl("bin/install-app-entry")).replace(/^file:\/\//, "")
    launcherProc.command = on ? [script] : [script, "--remove"]
    launcherProc.running = true
  }

  Process {
    id: launcherProc
    onExited: function(code) {
      if (code !== 0) console.warn("more-gestures: app launcher entry command failed with exit code", code)
      desktopFile.reload()
    }
  }

  FileView {
    id: desktopFile
    path: root.desktopPath
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: root.launcherInstalled = true
    onLoadFailed: root.launcherInstalled = false
  }

  // ------------------------------------------------------------------ lifecycle

  function open(payloadJson) {
    exposeProbe.running = true
    desktopFile.reload()
    stateFile.reload()
    root.loading = true
    root.working = Config.parse(stateFile.text(), Actions)
    root.loading = false
    root.importArmed = false
    root.profile = "default"
    root.closeEditor()
    scroller.contentY = 0
    root.syncControls()
    root.opened = true
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function close() {
    root.flush()
    root.recordingStep = -1
    root.editorOpen = false
    root.opened = false
  }
  function toggle() { if (root.opened) root.close(); else root.open("{}") }

  // NumberField/Dropdown/TextField keep their own value once touched, so the working
  // state is pushed into them by hand after loading.
  function syncControls() {
    thresholdField.field.value = root.working.threshold
    holdField.field.value = root.working.holdMs
    mmField.field.value = root.working.touchpad.thresholdMm
    languagePicker.value = root.working.language
    stylePicker.value = root.working.ring.style
    cornerField.field.value = root.working.taps.cornerMm
    doubleField.field.value = root.working.ring.doubleMs
  }

  // Every change is saved at once, as in More Time and More Weather (no Save button):
  // a short delay gathers the steps of a number field or a quick series of clicks into
  // one write. Service.qml watches the file and applies it live.
  property bool loading: false
  property string lastWritten: ""
  onWorkingChanged: if (root.opened && !root.loading) saveTimer.restart()

  Timer {
    id: saveTimer
    interval: 300
    onTriggered: root.writeNow()
  }

  function writeNow() {
    var text = Config.serialize(root.working, Actions)
    if (text === root.lastWritten) return
    root.lastWritten = text
    stateFile.setText(text)
  }

  function flush() {
    if (!saveTimer.running) return
    saveTimer.stop()
    root.writeNow()
  }

  // An import (SettingsTransfer): replaces the working copy, which then saves itself.
  function applyImported(config) {
    root.working = config
    root.closeEditor()
    root.syncControls()
  }

  // Import replaces everything: the first click arms it, a second within four seconds
  // imports (as in More Time).
  property bool importArmed: false
  Timer { id: importDisarm; interval: 4000; onTriggered: root.importArmed = false }

  SettingsTransfer { id: transfer; owner: root }

  // "{path}" style placeholders, as in the siblings' strings.
  function trp(key, params) {
    var text = root.tr(key)
    for (var k in params) text = text.split("{" + k + "}").join(params[k])
    return text
  }

  function set(key, value) {
    var next = Config.clone(root.working)
    next[key] = value
    root.working = Config.sanitize(next, Actions)
  }

  // --------------------------------------------------------------------- editor

  // The actions to pick from: the Hyprland swipe only for the swipe gesture (and there
  // only it), everywhere else everything but it (Actions.fitsGesture).
  function dispatchOptions(forSwipe) {
    var code = I18n.lang(root.lang)
    return Object.keys(Actions.DISPATCH).filter(function(id) {
      return (id === Actions.SWIPE_ACTION) === !!forSwipe
    }).map(function(id) {
      return { value: id, label: Actions.DISPATCH[id][code] }
    })
  }

  // The swipe gesture can only swipe (Hyprland) or do nothing.
  function setSwipeGesture() {
    root.editGesture = "swipe"
    if (root.editType !== "none") root.editType = "dispatch"
    root.editDispatch = Actions.SWIPE_ACTION
    dispatchPicker.value = Actions.SWIPE_ACTION
  }

  // ------------------------------------------------------------------ recording
  // "Record": the service hands the next gesture over (Service.recordGesture) through a
  // file in the runtime dir instead of running it; it fills the editor's gesture and
  // device. Esc or 15 s without a gesture stop it.
  property bool recordingGesture: false
  property real recordStarted: 0
  property string recordInfo: ""
  readonly property string recordPath: (Quickshell.env("XDG_RUNTIME_DIR") || "/tmp") + "/more-gestures-recorded.json"

  function startRecord() {
    root.recordingStep = -1
    root.recordInfo = ""
    root.recordingGesture = true
    root.recordStarted = Date.now()
    recordTimeout.restart()
    Quickshell.execDetached(["omarchy-shell", "-q", "more-gestures", "recordGesture"])
  }

  function stopRecord() {
    if (!root.recordingGesture) return
    root.recordingGesture = false
    recordTimeout.stop()
    Quickshell.execDetached(["omarchy-shell", "-q", "more-gestures", "stopRecording"])
  }

  Timer { id: recordTimeout; interval: 15000; onTriggered: root.stopRecord() }

  FileView {
    id: recordFile
    path: root.recordPath
    watchChanges: true
    blockAllReads: true
    printErrors: false
    onFileChanged: {
      reload()
      if (!root.recordingGesture) return
      var rec = null
      try { rec = JSON.parse(recordFile.text()) } catch (e) { rec = null }
      if (!rec || Number(rec.at) < root.recordStarted) return
      root.recordingGesture = false
      recordTimeout.stop()
      root.applyRecorded(rec)
    }
  }

  // A recorded gesture into the editor. A line drawn with the mouse or three fingers
  // keeps "All" (one gesture language) if that was chosen; anything else takes the device
  // it came from.
  function applyRecorded(rec) {
    var source = String(rec.source || "")
    var gesture = String(rec.gesture || "")
    var shared = /^[UDLR]+$|^(wheel|rocker)-/.test(gesture) && (source === "mouse" || source === "tp3")
    var next = root.editSource === "*" && shared ? "*" : source
    if (next === "tap") { root.editCorner = gesture.slice(0, 2); root.editCount = Number(gesture.slice(2)) }
    if (Config.gestureKeyFor(next, gesture, Actions) === "") {
      root.recordInfo = root.tr("recordUnknown")
      return
    }
    root.editSource = next
    root.editGesture = gesture
    // Already bound? Say with what, so a new action does not silently replace it.
    var key = next + ":" + gesture
    var hit = null
    for (var i = 0; i < root.rows.length; i++) if (root.rows[i].key === key) hit = root.rows[i]
    root.recordInfo = hit && !(hit.action && hit.action.type === "none") && key !== root.editKey
      ? root.tr("recordTaken").replace("%1", Actions.actionName(hit.action, root.lang)) : ""
  }

  function openEditor(row) {
    root.recordingStep = -1
    root.editError = ""
    if (!row) {
      root.editKey = ""
      root.editGesture = ""
      root.editSource = "*"
      root.editType = "dispatch"
      root.editDispatch = "workspace-prev"
      root.editSteps = [""]
      root.editCommand = ""
      root.editLabel = ""
    } else {
      var a = Actions.validateAction(row.action)
      var action = a.ok ? a.action : { type: "none" }
      root.editKey = row.key
      root.editGesture = row.gesture
      root.editSource = row.source
      if (row.source === "tap") {
        root.editCorner = row.gesture.slice(0, 2)
        root.editCount = Number(row.gesture.slice(2))
      }
      root.editType = action.type
      root.editDispatch = action.type === "dispatch" ? action.id : "workspace-prev"
      root.editSteps = action.type === "keys"
        ? action.sequence.map(function(c) { return Actions.keysText([c], root.lang) })
        : [""]
      root.editCommand = action.type === "exec" ? action.command : ""
      root.editLabel = action.label || ""
    }
    root.editorOpen = true
    dispatchPicker.value = root.editDispatch
    commandField.text = root.editCommand
    labelField.text = root.editLabel
  }

  // Leaving the swipe gesture: its action fits no other gesture.
  onEditGestureChanged: {
    if (root.editGesture !== "swipe" && root.editDispatch === Actions.SWIPE_ACTION) {
      root.editDispatch = "workspace-prev"
      dispatchPicker.value = "workspace-prev"
    }
    if (root.editGesture === "swipe" && (root.editType === "keys" || root.editType === "exec")) root.editType = "dispatch"
  }

  function closeEditor() {
    root.stopRecord()
    root.recordInfo = ""
    root.recordingStep = -1
    root.editorOpen = false
    root.editError = ""
  }

  function setTap(corner, count) {
    root.editCorner = corner
    root.editCount = count
    root.editGesture = corner + count
  }

  function addDir(d) {
    if (/^(wheel|rocker|pinch|tap|swipe)/.test(root.editGesture)) root.editGesture = ""
    if (root.editGesture.length >= 5) return
    // Equal neighbours merge in the recogniser, so "LL" could never be drawn.
    if (root.editGesture.slice(-1) === d) return
    root.editGesture += d
  }

  function setStep(i, text) {
    var next = root.editSteps.slice()
    next[i] = text
    root.editSteps = next
  }

  function addStep() {
    if (root.editSteps.length >= Actions.MAX_SEQUENCE) return
    root.editSteps = root.editSteps.concat([""])
  }

  function removeStep(i) {
    if (root.editSteps.length <= 1) return
    root.editSteps = root.editSteps.filter(function(_, j) { return j !== i })
  }

  // Builds the action from the editor; { ok, action } or { ok: false, error: text }.
  function editorAction() {
    if (root.editType === "none") return { ok: true, action: { type: "none" } }
    if (root.editType === "dispatch") return { ok: true, action: { type: "dispatch", id: root.editDispatch } }
    if (root.editType === "exec") {
      if (root.editCommand.trim() === "") return { ok: false, error: root.tr("err_command") }
      return { ok: true, action: { type: "exec", command: root.editCommand.trim(), label: root.editLabel.trim() } }
    }
    var sequence = []
    for (var i = 0; i < root.editSteps.length; i++) {
      var c = KeyCombo.comboFromText(root.editSteps[i])
      if (!c.ok) return { ok: false, error: I18n.keyError(root.lang, c.error) + " (" + (i + 1) + ")" }
      sequence.push([c.combo.mods.join(" "), c.combo.key])
    }
    return { ok: true, action: { type: "keys", sequence: sequence, label: root.editLabel.trim() } }
  }

  function applyEditor() {
    var key = Config.gestureKeyFor(root.editSource, root.editGesture, Actions)
    if (key === "") { root.editError = root.tr("err_gesture"); return }
    var built = root.editorAction()
    if (!built.ok) { root.editError = built.error; return }
    var res = Config.setBinding(root.working, root.profile, key, built.action, Actions)
    if (!res.ok) { root.editError = root.tr(res.error === "swipe" ? "err_swipe" : "err_action"); return }
    var next = res.config
    // Renamed gesture: the old key goes, otherwise both would act.
    if (root.editKey !== "" && root.editKey !== key) next = Config.removeBinding(next, root.profile, root.editKey)
    root.working = next
    root.closeEditor()
  }

  function resetRow(row) {
    root.working = Config.removeBinding(root.working, root.profile, row.key)
  }

  // Overriding a built-in entry with "none" is how a default gesture is switched off.
  function disableRow(row) {
    var res = Config.setBinding(root.working, root.profile, row.key, { type: "none" }, Actions)
    if (res.ok) root.working = res.config
  }

  // wheel-up / rocker-left read as "Wheel ↑" / "Rocker ←" instead of internal ids.
  function gestureText(g) {
    if (g === "tap2") return root.tr("tap2")
    if (g === "swipe") return "← → " + root.tr("swipeWord")
    if (/^(tl|tr|bl|br)[1-4]$/.test(g)) return Actions.tapText(g)
    if (/^[UDLR]+$/.test(g) || /^pinch/.test(g)) return Actions.arrowText(g)
    var m = /^(wheel|rocker)-(up|down|left|right)$/.exec(g)
    if (!m) return g
    var arrow = { up: "↑", down: "↓", left: "←", right: "→" }[m[2]]
    return root.tr("gesture_" + m[1]) + " " + arrow
  }

  function setTouchpad(key, sub, value) {
    var next = Config.clone(root.working)
    if (sub) next.touchpad[key][sub] = value
    else next.touchpad[key] = value
    root.working = Config.sanitize(next, Actions)
  }

  function setBar(key, value) {
    var next = Config.clone(root.working.bar)
    next[key] = value
    root.set("bar", next)
  }

  function setRing(key, value) {
    var next = Config.clone(root.working.ring)
    next[key] = Config.clone(value)
    root.set("ring", next)
  }

  // Dropdown value of a ring slot: the dispatch id, "none", or "custom" for an action
  // only editable in the file (key combo, command).
  function slotValue(action) {
    if (!action || action.type === "none") return "none"
    return action.type === "dispatch" ? action.id : "custom"
  }

  function slotOptions(action) {
    var opts = [{ value: "none", label: root.tr("ringEmpty") }].concat(root.dispatchOptions())
    if (root.slotValue(action) === "custom")
      opts.push({ value: "custom", label: Actions.actionName(action, root.lang) })
    return opts
  }

  // One ring (0 = inner) changed through `edit(ringCopy)`; Config.cleanRing then drops
  // invalid and duplicate keys and fits slots to the count.
  function editRing(ringIndex, edit) {
    var rings = Config.clone(root.working.ring.rings)
    edit(rings[ringIndex])
    root.setRing("rings", rings)
  }

  function setRingKey(ringIndex, index, value) {
    root.editRing(ringIndex, function(r) { r.keys[index] = String(value || "").trim() })
  }

  function setSlot(ringIndex, index, value) {
    if (value === "custom") return
    root.editRing(ringIndex, function(r) {
      r.slots[index] = value === "none" ? { type: "none" } : { type: "dispatch", id: value }
    })
  }

  function setRingCount(ringIndex, count) {
    root.set("ring", Config.setRingCount(root.working.ring, ringIndex, count, Actions))
  }

  function resetRing(ringIndex) {
    var def = Actions.ringDefaultsList()[ringIndex]
    root.editRing(ringIndex, function(r) { r.count = def.count; r.slots = Config.clone(def.slots); r.keys = def.keys.slice() })
  }

  // Clock position of a slot: "12", "1" … for twelve (every ring starts at 12 o'clock);
  // other counts just number the slots.
  function slotName(ringIndex, index, count) {
    if (count === 12) return (index === 0 ? 12 : index) + " " + root.tr("oclock")
    return "#" + (index + 1)
  }

  property string hotkeyError: ""

  function setHotkey(text) {
    var t = String(text || "").trim()
    if (t === "") { root.hotkeyError = ""; root.setRing("hotkey", null); return }
    var r = KeyCombo.comboFromText(t)
    if (!r.ok || r.combo.mods.length === 0) { root.hotkeyError = root.tr("hotkeyInvalid"); return }
    root.hotkeyError = ""
    root.setRing("hotkey", r.combo)
  }

  function resetAllBindings() {
    var b = {}
    Config.PROFILES.forEach(function(p) { b[p] = {} })
    root.set("bindings", b)
    root.closeEditor()
  }

  function sourceText(source) {
    return source === "mouse" ? root.tr("source_mouse")
      : source === "tp3" ? root.tr("source_tp3")
      : source === "tp4" ? root.tr("source_tp4")
      : source === "tap" ? root.tr("source_tap") : ""
  }

  Process {
    id: exposeProbe
    command: ["test", "-d", Quickshell.env("HOME") + "/.config/omarchy/plugins/expose.window-overview"]
    onExited: function(code) { root.exposeInstalled = code === 0 }
  }

  // ------------------------------------------------------------------- storage

  // blockAllReads: open() must see what is on disk, not a stale cache.
  FileView {
    id: stateFile
    path: root.statePath
    watchChanges: true
    blockAllReads: true
    atomicWrites: true
    printErrors: false
    // A change from elsewhere while the window is open (the bar's middle click switching
    // gestures on/off) is taken into the working copy, so the next save keeps it.
    onFileChanged: {
      reload()
      if (!root.opened || saveTimer.running) return
      var text = stateFile.text()
      if (text === root.lastWritten) return
      root.lastWritten = text
      root.loading = true
      root.working = Config.parse(text, Actions)
      root.loading = false
      root.syncControls()
    }
  }

  // ----------------------------------------------------------------- components

  component Label: Text {
    color: root.muted
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
    font.bold: true
  }

  component Hint: Text {
    color: Qt.darker(root.foreground, 1.8)
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
    wrapMode: Text.WordWrap
  }

  component SmallButton: Button {
    bordered: true
    foreground: root.foreground
    accent: root.accent
    fontFamily: root.fontFamily
  }

  // ---------------------------------------------------------------------- window

  PanelWindow {
    id: panel
    visible: root.opened
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "more-gestures-settings"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive
    exclusionMode: ExclusionMode.Ignore

    Rectangle { anchors.fill: parent; color: Color.menu.scrim }
    MouseArea { anchors.fill: parent; onClicked: root.close() }

    Item {
      id: keyCatcher
      anchors.fill: parent
      focus: true
      Keys.onEscapePressed: function(event) {
        if (root.recordingGesture) root.stopRecord()
        else if (root.editorOpen) root.closeEditor(); else root.close()
        event.accepted = true
      }
      // Tab / Shift+Tab: next / previous page, as in More Time and More Weather. Text
      // fields keep Tab for themselves while they have the focus.
      // Shift+Tab usually comes as Backtab, but synthetic input sends Tab with Shift held.
      Keys.onTabPressed: function(event) { root.stepPage(event.modifiers & Qt.ShiftModifier ? -1 : 1); event.accepted = true }
      Keys.onBacktabPressed: function(event) { root.stepPage(-1); event.accepted = true }
      Keys.onReturnPressed: function(event) { event.accepted = root.page === "changes" && changesPage.activate() }
      Keys.onPressed: function(event) {
        if (event.key === Qt.Key_PageDown || event.key === Qt.Key_PageUp) {
          root.scrollBy((event.key === Qt.Key_PageDown ? 1 : -1) * scroller.height * 0.9)
          event.accepted = true
        } else if (event.key === Qt.Key_Down || event.key === Qt.Key_Up) {
          root.scrollBy((event.key === Qt.Key_Down ? 1 : -1) * Style.space(48))
          event.accepted = true
        }
      }

      BorderSurface {
        id: card
        // A fixed height, so switching pages does not make the card jump.
        width: Math.min(Style.space(820), panel.width - Style.gapsOut * 2)
        height: Math.min(Style.space(860), panel.height - Style.gapsOut * 2)
        radius: Style.cornerRadius
        anchors.centerIn: parent
        color: root.background
        borderSpec: root.borderSpec
        padding: Style.spacing.panelPadding

        MouseArea { anchors.fill: parent; onClicked: keyCatcher.forceActiveFocus() }

        // Takes every key while recording a combination, so it cannot also act on the
        // controls underneath (Esc cancels, modifiers alone wait for the real key).
        Item {
          id: comboCatcher
          anchors.fill: parent
          z: 10
          enabled: root.recordingStep >= 0
          focus: root.recordingStep >= 0
          Keys.priority: Keys.BeforeItem
          Keys.onPressed: function(event) {
            event.accepted = true
            if (event.key === Qt.Key_Escape) { root.recordingStep = -1; return }
            var c = KeyCombo.comboFromQt(event.modifiers, event.key)
            if (!c.ok) {
              if (c.error !== "modifier") root.editError = root.tr("recordUnsupported")
              return
            }
            root.setStep(root.recordingStep, Actions.keysText([c.combo], root.lang))
            root.editError = ""
            root.recordingStep = -1
            Qt.callLater(function() { keyCatcher.forceActiveFocus() })
          }
        }

        // ------------------------------------------------- header and pages
        Column {
          id: top
          anchors.top: parent.top
          anchors.left: parent.left
          anchors.right: parent.right
          anchors.topMargin: card.contentTopInset
          anchors.leftMargin: card.contentLeftInset
          anchors.rightMargin: card.contentRightInset
          spacing: Style.space(12)

          Item {
            width: parent.width
            height: Math.max(Style.space(48), titleRow.implicitHeight)

            Row {
              id: titleRow
              anchors.left: parent.left
              anchors.verticalCenter: parent.verticalCenter
              spacing: Style.spacing.lg
              MouseGlyph {
                width: Style.space(36)
                height: width
                color: root.foreground
                anchors.verticalCenter: parent.verticalCenter
              }
              Column {
                spacing: Style.space(2)
                anchors.verticalCenter: parent.verticalCenter
                Text {
                  text: root.tr("title")
                  color: root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.title
                  font.bold: true
                }
                Hint { text: root.tr("subtitle_" + root.page) }
              }
            }

            SmallButton {
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              bordered: false
              text: "✕"
              tooltipText: root.tr("closeWindow")
              onClicked: root.close()
            }
          }

          // Pages, styled like the tabs of More Time and More Weather: upper case, the
          // picked one and the hovered one on the accent's hover fill.
          Row {
            id: pageStrip
            anchors.horizontalCenter: parent.horizontalCenter
            spacing: Style.space(5)
            readonly property real tabWidth: Math.min(Style.space(140),
              (top.width - spacing * (Config.SETTINGS_PAGES.length - 1)) / Config.SETTINGS_PAGES.length)

            Repeater {
              model: Config.SETTINGS_PAGES
              delegate: Rectangle {
                required property string modelData
                readonly property bool selected: root.page === modelData
                width: Math.max(pageStrip.tabWidth, pageLabel.implicitWidth + Style.space(16))
                height: Style.space(28)
                radius: Style.cornerRadius
                color: selected || pageMouse.containsMouse ? Style.hoverFillFor(root.foreground, Color.accent) : "transparent"

                Text {
                  id: pageLabel
                  anchors.centerIn: parent
                  text: root.tr("page_" + parent.modelData).toLocaleUpperCase()
                  color: parent.selected ? Style.hoverStateColor(root.foreground, Color.accent) : root.muted
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption
                  font.bold: parent.selected
                  font.letterSpacing: 1
                }

                MouseArea {
                  id: pageMouse
                  anchors.fill: parent
                  hoverEnabled: true
                  cursorShape: Qt.PointingHandCursor
                  onClicked: root.showPage(parent.modelData)
                }
              }
            }
          }

          Hint {
            width: parent.width
            horizontalAlignment: Text.AlignHCenter
            text: root.tr("pagesKeysHint")
          }

          Rectangle {
            width: parent.width
            height: Style.spacing.hairline
            color: root.foreground
            opacity: 0.12
          }
        }

        MouseArea {
          anchors.fill: scroller
          z: 2
          acceptedButtons: Qt.NoButton
          onWheel: function(wheel) {
            root.scrollBy(-root.wheelPixels(wheel))
            wheel.accepted = true
          }
        }

        Flickable {
          id: scroller
          anchors.top: top.bottom
          anchors.bottom: parent.bottom
          anchors.left: parent.left
          anchors.right: parent.right
          anchors.topMargin: Style.space(12)
          anchors.bottomMargin: card.contentBottomInset
          anchors.leftMargin: card.contentLeftInset
          anchors.rightMargin: card.contentRightInset
          contentHeight: content.implicitHeight
          clip: true
          boundsBehavior: Flickable.StopAtBounds

          Column {
            id: content
            width: scroller.width
            spacing: Style.spacing.huge

            Column {
              width: parent.width
              spacing: Style.spacing.huge
              visible: root.page === "general"

              // Language first, as in More Time and More Weather.
              Column {
                width: parent.width
                spacing: Style.spacing.md

                PanelSectionHeader { text: root.tr("languageSection"); foreground: root.foreground; fontFamily: root.fontFamily }
                Row {
                  spacing: Style.spacing.md
                  Text {
                    width: Style.space(220)
                    anchors.verticalCenter: parent.verticalCenter
                    text: root.tr("language")
                    color: root.foreground
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.body
                  }
                  Dropdown {
                    id: languagePicker
                    width: Style.space(260)
                    showLabel: false
                    fontFamily: root.fontFamily
                    options: [
                      { value: "auto", label: root.tr("languageAuto").replace("%1",
                          Config.uiLanguage({ language: "auto" }, Qt.locale().name) === "de" ? "Deutsch" : "English") },
                      { value: "en", label: "English" },
                      { value: "de", label: "Deutsch" }
                    ]
                    value: root.working.language
                    onChanged: function(v) { root.set("language", v) }
                  }
                }
              }

              Column {
                width: parent.width
                spacing: Style.spacing.md

                Toggle {
                  width: parent.width
                  label: root.tr("enabled")
                  description: root.tr("enabledHint")
                  checked: root.working.enabled
                  foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily
                  onClicked: root.set("enabled", !root.working.enabled)
                }
                Toggle {
                  width: parent.width
                  label: root.tr("superDigits")
                  description: root.tr("superDigitsHint")
                  checked: root.working.superDigits
                  foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily
                  onClicked: root.set("superDigits", !root.working.superDigits)
                }
              }

              Column {
                width: parent.width
                spacing: Style.spacing.md

                PanelSectionHeader { text: root.tr("feedback"); foreground: root.foreground; fontFamily: root.fontFamily }

                Label { text: root.tr("indicator") }
                ButtonGroup {
                  value: root.working.indicator
                  options: [
                    { value: "off", label: root.tr("indicatorOff") },
                    { value: "minimal", label: root.tr("indicatorMinimal") },
                    { value: "full", label: root.tr("indicatorFull") }
                  ]
                  foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily
                  onChanged: function(v) { root.set("indicator", v) }
                }
                Toggle {
                  width: parent.width
                  label: root.tr("animations")
                  description: root.tr("animationsHint")
                  checked: root.working.animations
                  foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily
                  onClicked: root.set("animations", !root.working.animations)
                }
              }

              Column {
                width: parent.width
                spacing: Style.spacing.md

                PanelSectionHeader { text: root.tr("menubar"); foreground: root.foreground; fontFamily: root.fontFamily }

                Toggle {
                  width: parent.width
                  label: root.tr("barShow")
                  description: root.tr("barShowHint")
                  checked: root.working.bar.show
                  foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily
                  onClicked: root.setBar("show", !root.working.bar.show)
                }

                Repeater {
                  // A new object per change recreates the rows, so the Dropdowns show the
                  // stored value again after a reload.
                  model: root.working.bar.show ? [{ key: "left" }, { key: "middle" }, { key: "right" }] : []
                  delegate: Row {
                    required property var modelData
                    spacing: Style.spacing.md
                    Text {
                      width: Style.space(150)
                      anchors.verticalCenter: parent.verticalCenter
                      text: root.tr("bar_" + modelData.key)
                      color: root.muted
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.caption
                      font.bold: true
                    }
                    Dropdown {
                      width: Style.space(260)
                      showLabel: false
                      fontFamily: root.fontFamily
                      options: Config.BAR_ACTIONS.map(function(a) { return { value: a, label: root.tr("barAction_" + a) } })
                      value: root.working.bar[modelData.key]
                      onChanged: function(v) { root.setBar(modelData.key, v) }
                    }
                  }
                }

                Toggle {
                  width: parent.width
                  visible: root.working.bar.show
                  label: root.tr("barTooltip")
                  checked: root.working.bar.tooltip
                  foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily
                  onClicked: root.setBar("tooltip", !root.working.bar.tooltip)
                }
              }

              Column {
                width: parent.width
                spacing: Style.spacing.md

                PanelSectionHeader { text: root.tr("app"); foreground: root.foreground; fontFamily: root.fontFamily }
                Toggle {
                  width: parent.width
                  label: root.tr("launcherEntry")
                  description: root.tr("launcherEntryHint")
                  checked: root.launcherInstalled
                  enabled: !launcherProc.running
                  foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily
                  onClicked: root.setLauncher(!root.launcherInstalled)
                }
              }

              Column {
                width: parent.width
                spacing: Style.spacing.md

                PanelSectionHeader { text: root.tr("exclusions"); foreground: root.foreground; fontFamily: root.fontFamily }
                Hint { width: parent.width; text: root.tr("exclusionsHint") }

                Flow {
                  width: parent.width
                  spacing: Style.spacing.sm
                  Repeater {
                    model: root.working.exclude
                    delegate: SmallButton {
                      required property string modelData
                      required property int index
                      text: modelData + "  ×"
                      onClicked: root.set("exclude", Config.removeExclude(root.working.exclude, index))
                    }
                  }
                }

                Row {
                  spacing: Style.spacing.md
                  TextField {
                    id: excludeField
                    width: Style.space(260)
                    placeholderText: root.tr("excludePlaceholder")
                    foreground: root.foreground
                    accent: root.accent
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.body
                    onAccepted: addExcludeButton.clicked()
                  }
                  SmallButton {
                    id: addExcludeButton
                    text: root.tr("excludeAdd")
                    onClicked: {
                      root.set("exclude", Config.addExclude(root.working.exclude, excludeField.text))
                      excludeField.text = ""
                    }
                  }
                  SmallButton {
                    text: root.tr("excludeDefaults")
                    onClicked: root.set("exclude", Actions.DEFAULT_EXCLUDES.slice())
                  }
                }
              }

              // Back up and restore, as in More Time and More Weather.
              Column {
                width: parent.width
                spacing: Style.spacing.md

                PanelSectionHeader { text: root.tr("generalSectionBackup"); foreground: root.foreground; fontFamily: root.fontFamily }
                Label { text: root.tr("settingsTransferFile") }
                TextField {
                  id: transferPathField
                  width: Math.min(parent.width, Style.space(460))
                  text: transfer.shown(transfer.defaultPath)
                  foreground: root.foreground
                  accent: root.accent
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.body
                  onAccepted: keyCatcher.forceActiveFocus()
                }
                Row {
                  spacing: Style.spacing.md
                  SmallButton {
                    text: root.tr("settingsExport")
                    enabled: !transfer.busy
                    onClicked: transfer.exportTo(transferPathField.text)
                  }
                  SmallButton {
                    text: root.importArmed ? root.tr("settingsImportConfirm") : root.tr("settingsImport")
                    selected: root.importArmed
                    enabled: !transfer.busy
                    onClicked: {
                      if (!root.importArmed) { root.importArmed = true; importDisarm.restart(); return }
                      root.importArmed = false
                      importDisarm.stop()
                      transfer.importFrom(transferPathField.text)
                    }
                  }
                }
                Text {
                  visible: transfer.status !== null
                  width: parent.width
                  text: transfer.status ? root.trp(transfer.status.key, { path: transfer.shown(transfer.status.path),
                    backup: transfer.shown(transfer.backupPath) }) : ""
                  color: transfer.status && transfer.status.error ? Color.urgent : root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption
                  wrapMode: Text.WrapAnywhere
                }
                Hint { width: parent.width; text: root.trp("settingsTransferHint", { backup: transfer.shown(transfer.backupPath) }) }
                Hint {
                  width: parent.width
                  text: root.trp("settingsFileHint", { path: root.statePath.replace(Quickshell.env("HOME"), "~") })
                }
              }
            }

            Column {
              width: parent.width
              spacing: Style.spacing.huge
              visible: root.page === "mouse"

              Column {
                width: parent.width
                spacing: Style.spacing.md

                Label { text: root.tr("button") }
                ButtonGroup {
                  value: root.working.button
                  options: [
                    { value: "right", label: root.tr("buttonRight") },
                    { value: "middle", label: root.tr("buttonMiddle") },
                    { value: "side", label: root.tr("buttonSide") },
                    { value: "extra", label: root.tr("buttonExtra") }
                  ]
                  foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily
                  onChanged: function(v) { root.set("button", v) }
                }
                Hint { width: parent.width; text: root.tr("buttonHint") }

                Row {
                  spacing: Style.spacing.huge
                  NumberField {
                    id: thresholdField
                    label: root.tr("threshold") + " (" + root.tr("thresholdUnit") + ")"
                    from: Config.LIMITS.threshold.min
                    to: 500
                    value: root.working.threshold
                    foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily
                    onModified: function(v) { root.set("threshold", v) }
                  }
                  NumberField {
                    id: holdField
                    label: root.tr("holdMs")
                    from: Config.LIMITS.holdMs.min
                    to: 2000
                    stepSize: 50
                    value: root.working.holdMs
                    foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily
                    onModified: function(v) { root.set("holdMs", v) }
                  }
                }
                Hint { width: parent.width; text: root.tr("holdHint") }

                Toggle {
                  width: parent.width
                  label: root.tr("rocker")
                  description: root.tr("rockerHint")
                  checked: root.working.rocker
                  foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily
                  onClicked: root.set("rocker", !root.working.rocker)
                }
                Toggle {
                  width: parent.width
                  label: root.tr("wheel")
                  description: root.tr("wheelHint")
                  checked: root.working.wheel
                  foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily
                  onClicked: root.set("wheel", !root.working.wheel)
                }
              }
            }

            Column {
              width: parent.width
              spacing: Style.spacing.huge
              visible: root.page === "trackpad"

              Column {
                width: parent.width
                spacing: Style.spacing.md


                Toggle {
                  width: parent.width
                  label: root.tr("trackpadEnabled")
                  description: root.tr("trackpadHint")
                  checked: root.working.touchpad.enabled
                  foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily
                  onClicked: root.setTouchpad("enabled", "", !root.working.touchpad.enabled)
                }

                Repeater {
                  model: Config.FINGERS
                  delegate: Column {
                    required property string modelData
                    width: content.width
                    spacing: Style.spacing.sm
                    visible: root.working.touchpad.enabled
                    Toggle {
                      width: parent.width
                      label: root.tr("fingers_" + modelData)
                      description: root.tr("fingersHint")
                      checked: root.working.touchpad.fingers[modelData]
                      foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily
                      onClicked: root.setTouchpad("fingers", modelData, !root.working.touchpad.fingers[modelData])
                    }
                  }
                }

                NumberField {
                  id: mmField
                  visible: root.working.touchpad.enabled
                  label: root.tr("thresholdMm")
                  from: Config.LIMITS.thresholdMm.min
                  to: Config.LIMITS.thresholdMm.max
                  value: root.working.touchpad.thresholdMm
                  foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily
                  onModified: function(v) { root.setTouchpad("thresholdMm", "", v) }
                }

                Hint { width: parent.width; visible: root.working.touchpad.enabled; text: root.tr("swipeFileHint") }
                Hint {
                  width: parent.width
                  visible: !root.exposeInstalled
                  color: root.accent
                  text: root.tr("exposeRecommend")
                }

                Toggle {
                  width: parent.width
                  label: root.tr("taps")
                  description: root.tr("tapsHint")
                  checked: root.working.taps.enabled
                  foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily
                  onClicked: root.set("taps", { enabled: !root.working.taps.enabled, cornerMm: root.working.taps.cornerMm })
                }
                NumberField {
                  id: cornerField
                  visible: root.working.taps.enabled
                  label: root.tr("cornerMm")
                  from: Config.LIMITS.cornerMm.min
                  to: Config.LIMITS.cornerMm.max
                  value: root.working.taps.cornerMm
                  foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily
                  onModified: function(v) { root.set("taps", { enabled: root.working.taps.enabled, cornerMm: v }) }
                }
              }
            }

            Column {
              width: parent.width
              spacing: Style.spacing.huge
              visible: root.page === "ring"

              Column {
                width: parent.width
                spacing: Style.spacing.md

                Toggle {
                  width: parent.width
                  label: root.tr("ring")
                  description: root.tr("ringHint")
                  checked: root.working.ring.enabled
                  foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily
                  onClicked: root.setRing("enabled", !root.working.ring.enabled)
                }
                NumberField {
                  id: doubleField
                  visible: root.working.ring.enabled
                  label: root.tr("doubleMs")
                  from: Config.LIMITS.doubleMs.min
                  to: Config.LIMITS.doubleMs.max
                  stepSize: 25
                  value: root.working.ring.doubleMs
                  foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily
                  onModified: function(v) { root.setRing("doubleMs", v) }
                }

                // Opening the ring from the keyboard works without the mouse way in.
                Row {
                  spacing: Style.spacing.md
                  Text {
                    width: Style.space(220)
                    anchors.verticalCenter: parent.verticalCenter
                    text: root.tr("hotkey")
                    color: root.foreground
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.body
                  }
                  TextField {
                    id: hotkeyField
                    width: Style.space(220)
                    text: Config.hotkeyText(root.working.ring.hotkey)
                    placeholderText: root.tr("hotkeyNone")
                    foreground: root.foreground
                    accent: root.accent
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.body
                    onEditingFinished: root.setHotkey(text)
                  }
                }
                Hint { width: parent.width; text: root.hotkeyError !== "" ? root.hotkeyError : root.tr("hotkeyHint") }

                Toggle {
                  width: parent.width
                  label: root.tr("ringDividers")
                  description: root.tr("ringDividersHint")
                  checked: root.working.ring.dividers
                  foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily
                  onClicked: root.setRing("dividers", !root.working.ring.dividers)
                }

                // Look of the ring and the trail (Effects.js), with a live preview: a small
                // ring and a gesture line drawn over and over.
                Row {
                  spacing: Style.spacing.huge
                  Column {
                    spacing: Style.spacing.md
                    Row {
                      spacing: Style.spacing.md
                      Text {
                        anchors.verticalCenter: parent.verticalCenter
                        width: Style.space(120)
                        text: root.tr("ringStyle")
                        color: root.foreground
                        font.family: root.fontFamily
                        font.pixelSize: Style.font.body
                      }
                      Dropdown {
                        id: stylePicker
                        width: Style.space(240)
                        showLabel: false
                        fontFamily: root.fontFamily
                        options: Effects.STYLES.map(function(s) { return { value: s, label: Effects.name(s, root.lang) } })
                        value: root.working.ring.style
                        onChanged: function(v) { root.setRing("style", v) }
                      }
                    }
                    Hint { width: Style.space(380); text: root.tr("ringStyleHint") }
                    Toggle {
                      width: Style.space(380)
                      label: root.tr("ringStyleTrail")
                      description: root.tr("ringStyleTrailHint")
                      checked: root.working.ring.styleTrail
                      foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily
                      onClicked: root.setRing("styleTrail", !root.working.ring.styleTrail)
                    }
                  }
                  Rectangle {
                    width: Style.space(260)
                    height: width
                    radius: Style.cornerRadius
                    color: Util.alpha(Color.background, 0.82)
                    border.width: 1
                    border.color: Util.alpha(root.foreground, 0.12)
                    Canvas {
                      id: stylePreview
                      anchors.fill: parent
                      property real t: 0
                      readonly property string style: root.working.ring.style
                      readonly property bool running: root.opened && root.page === "ring"
                      onStyleChanged: { t = 0; requestPaint() }
                      onRunningChanged: if (running) requestPaint()
                      // A mini ring: two rings of twelve, and a ↓→ line drawn in 1.6 s,
                      // held, then drawn again.
                      onPaint: {
                        var ctx = getContext("2d")
                        ctx.reset()
                        var w = width, c = w / 2, slot = w * 0.085
                        var rings = [{ radius: w * 0.22, count: 12, offset: 0 }, { radius: w * 0.36, count: 12, offset: 0 }]
                        var colors = { accent: Color.accent, fg: root.foreground, bg: Color.background }
                        var still = !root.working.animations
                        var cycle = t % 3.2
                        Effects.drawRing(ctx, style, { t: t, still: still, cx: c, cy: c, rings: rings, slot: slot,
                          deadzone: w * 0.07, outer: w * 0.42, selected: { x: 0, y: -rings[1].radius },
                          selectedAge: cycle, openAge: cycle, clock: t % 60, colors: colors })
                        ctx.fillStyle = Effects.rgba(root.foreground, 0.55)
                        for (var k = 0; k < rings.length; k++)
                          for (var i = 0; i < 12; i++) {
                            var a = i / 12 * 2 * Math.PI
                            ctx.beginPath()
                            ctx.arc(c + Math.sin(a) * rings[k].radius, c - Math.cos(a) * rings[k].radius, slot * 0.18, 0, 2 * Math.PI)
                            ctx.fill()
                          }
                        if (!root.working.ring.styleTrail || style === "plain") return
                        var shown = still ? 1 : Math.min(1, cycle / 1.6)
                        var pts = [], times = [], n = 40
                        for (var j = 0; j <= n * shown; j++) {
                          var f = j / n
                          pts.push(f < 0.5 ? { x: w * 0.3, y: w * (0.25 + f * 1.0) } : { x: w * (0.3 + (f - 0.5) * 0.8), y: w * 0.75 })
                          times.push(f * 1.6)
                        }
                        Effects.drawTrail(ctx, style, { t: cycle, still: still, points: pts, times: times,
                          lineWidth: 3, colors: colors })
                      }
                      Timer {
                        interval: 40
                        repeat: true
                        running: stylePreview.running && Effects.animated(stylePreview.style) && root.working.animations
                        onTriggered: { stylePreview.t += 0.04; stylePreview.requestPaint() }
                      }
                    }
                  }
                }

                // Three rings: what each slot does, and its key.
                Repeater {
                  model: root.working.ring.rings
                  delegate: Column {
                    id: ringBlock
                    required property var modelData
                    required property int index
                    width: content.width
                    spacing: Style.spacing.sm

                    Toggle {
                      width: parent.width
                      visible: ringBlock.index > 0
                      label: root.tr("ringN").replace("%1", ringBlock.index + 1)
                      description: root.tr(ringBlock.index === 1 ? "ring2Hint" : "ring3Hint")
                      checked: ringBlock.modelData.enabled
                      foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily
                      onClicked: root.editRing(ringBlock.index, function(r) { r.enabled = !r.enabled })
                    }
                    Label {
                      visible: ringBlock.index === 0
                      text: root.tr("ringN").replace("%1", 1) + " · " + root.tr("ringSlots")
                    }
                    Column {
                      width: parent.width
                      visible: ringBlock.modelData.enabled
                      spacing: Style.spacing.sm
                      ButtonGroup {
                        value: String(ringBlock.modelData.count)
                        options: Actions.RING_COUNTS[ringBlock.index].map(function(n) {
                          return { value: String(n), label: n + " " + root.tr("ringButtons") }
                        })
                        foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily
                        onChanged: function(v) { root.setRingCount(ringBlock.index, Number(v)) }
                      }
                      Grid {
                        columns: 2
                        columnSpacing: Style.spacing.huge
                        rowSpacing: Style.spacing.sm
                        Repeater {
                          // A new array per change recreates the rows, so each Dropdown starts
                          // from the stored value again (they drop their binding once used).
                          model: ringBlock.modelData.slots
                          delegate: Row {
                            required property var modelData
                            required property int index
                            spacing: Style.spacing.md
                            Text {
                              width: Style.space(70)
                              anchors.verticalCenter: parent.verticalCenter
                              text: root.slotName(ringBlock.index, index, ringBlock.modelData.count)
                              color: root.muted
                              font.family: root.fontFamily
                              font.pixelSize: Style.font.caption
                              font.bold: true
                            }
                            Dropdown {
                              width: Style.space(220)
                              showLabel: false
                              fontFamily: root.fontFamily
                              options: root.slotOptions(modelData)
                              value: root.slotValue(modelData)
                              onChanged: function(v) { root.setSlot(ringBlock.index, index, v) }
                            }
                            TextField {
                              width: Style.space(44)
                              text: ringBlock.modelData.keys[index] || ""
                              placeholderText: "–"
                              maximumLength: 1
                              horizontalAlignment: Text.AlignHCenter
                              foreground: root.foreground
                              accent: root.accent
                              font.family: root.fontFamily
                              font.pixelSize: Style.font.body
                              onEditingFinished: root.setRingKey(ringBlock.index, index, text)
                            }
                          }
                        }
                      }
                      SmallButton {
                        text: root.tr("ringReset")
                        onClicked: root.resetRing(ringBlock.index)
                      }
                    }
                  }
                }
                Hint { width: parent.width; text: root.tr("ringKeysHint") }
              }
            }

            // Gestures: one list for both device pages (Config.rowsForPage picks the rows),
            // so the editor and its ids exist once.
            Column {
              width: parent.width
              spacing: Style.spacing.md
              visible: root.page === "mouse" || root.page === "trackpad"

              PanelSectionHeader { text: root.tr("bindings"); foreground: root.foreground; fontFamily: root.fontFamily }

              ButtonGroup {
                value: root.profile
                options: Config.PROFILES.map(function(p) { return { value: p, label: root.tr("profile_" + p) } })
                foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily
                onChanged: function(v) { root.profile = v; root.closeEditor() }
              }
              Hint { width: parent.width; text: root.tr("languageHint") }
              Hint { width: parent.width; text: root.tr("profileHint") }

              Hint { visible: root.pageRows.length === 0; text: root.tr("noBindings") }

              Repeater {
                model: root.pageRows
                delegate: Column {
                  required property var modelData
                  width: content.width
                  spacing: Style.spacing.sm

                  // Trackpad page: a heading above each group (taps, 2/3/4 fingers).
                  Label {
                    visible: modelData.groupFirst === true
                    topPadding: Style.spacing.md
                    text: modelData.group ? root.tr("group_" + modelData.group) : ""
                  }

                Rectangle {
                  width: parent.width
                  height: Style.spacing.controlHeight + Style.spacing.sm
                  radius: Style.cornerRadius
                  color: rowHover.hovered ? Util.alpha(root.foreground, 0.06) : "transparent"

                  HoverHandler { id: rowHover }

                  Item {
                    id: gestureCell
                    anchors.left: parent.left
                    anchors.leftMargin: Style.spacing.md
                    anchors.verticalCenter: parent.verticalCenter
                    width: Style.space(110)
                    height: parent.height
                    readonly property bool isTap: Actions.tapDots(modelData.gesture).length > 0
                    Text {
                      visible: !parent.isTap
                      anchors.verticalCenter: parent.verticalCenter
                      text: root.gestureText(modelData.gesture)
                      color: root.accent
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.subtitle
                      font.bold: true
                    }
                    TapGlyph {
                      visible: parent.isTap
                      anchors.verticalCenter: parent.verticalCenter
                      width: Style.space(30)
                      height: Style.space(22)
                      gesture: modelData.gesture
                      color: root.accent
                    }
                  }
                  Text {
                    anchors.left: gestureCell.right
                    anchors.right: rowButtons.left
                    anchors.rightMargin: Style.spacing.md
                    anchors.verticalCenter: parent.verticalCenter
                    elide: Text.ElideRight
                    text: Actions.actionName(modelData.action, root.lang)
                      + (modelData.overridden ? "  ·  " + root.tr("custom") : "")
                      + (modelData.source !== "*" ? "  ·  " + root.sourceText(modelData.source) : "")
                    color: root.foreground
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.body
                  }
                  Row {
                    id: rowButtons
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: Style.spacing.sm
                    SmallButton { text: root.tr("edit"); onClicked: root.openEditor(modelData) }
                    SmallButton {
                      text: root.tr("reset")
                      visible: modelData.overridden && modelData.hasDefault
                      onClicked: root.resetRow(modelData)
                    }
                    SmallButton {
                      text: root.tr("remove")
                      visible: !(modelData.overridden && modelData.hasDefault)
                        && !(modelData.action && modelData.action.type === "none")
                      onClicked: modelData.hasDefault ? root.disableRow(modelData) : root.resetRow(modelData)
                    }
                  }
                }
                }
              }

              Row {
                spacing: Style.spacing.md
                visible: !root.editorOpen
                SmallButton {
                  text: "+ " + root.tr("editor")
                  onClicked: root.openEditor(null)
                }
                SmallButton {
                  text: root.tr("resetAll")
                  onClicked: root.resetAllBindings()
                }
              }

              // ------------------------------------------------------ editor
              Rectangle {
                width: parent.width
                visible: root.editorOpen
                height: editor.implicitHeight + Style.spacing.lg * 2
                radius: Style.cornerRadius
                color: Util.alpha(root.foreground, 0.05)
                border.width: Math.max(1, Style.space(2))
                border.color: Util.alpha(root.accent, 0.6)

                Column {
                  id: editor
                  anchors.fill: parent
                  anchors.margins: Style.spacing.lg
                  spacing: Style.spacing.md

                  Label { text: root.tr("source") }
                  ButtonGroup {
                    value: root.editSource
                    options: [
                      { value: "*", label: root.tr("source_all") },
                      { value: "mouse", label: root.tr("source_mouse") },
                      { value: "tp3", label: root.tr("source_tp3") },
                      { value: "tp4", label: root.tr("source_tp4") },
                      { value: "tap", label: root.tr("source_tap") }
                    ]
                    foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily
                    onChanged: function(v) {
                      if (root.editGesture === "swipe" && v !== "tp3" && v !== "tp4") root.editGesture = ""
                      // Tap gestures and line gestures never share a name: switching
                      // between them starts the gesture over.
                      if ((v === "tap") !== (root.editSource === "tap"))
                        root.editGesture = v === "tap" ? root.editCorner + root.editCount : ""
                      root.editSource = v
                      if (/^pinch/.test(root.editGesture) && v.indexOf("tp") !== 0 && v !== "*") root.editGesture = ""
                    }
                  }

                  Label { text: root.tr("gesture") }
                  Row {
                    spacing: Style.spacing.md
                    SmallButton {
                      text: root.recordingGesture ? root.tr("recordingGesture") : "● " + root.tr("recordGesture")
                      selected: root.recordingGesture
                      onClicked: root.recordingGesture ? root.stopRecord() : root.startRecord()
                    }
                    Text {
                      anchors.verticalCenter: parent.verticalCenter
                      width: Math.max(0, editor.width - x)
                      text: root.recordingGesture ? root.tr("recordGestureNow") : root.recordInfo
                      color: root.recordingGesture || root.recordInfo !== "" ? root.accent : root.muted
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.caption
                      wrapMode: Text.WordWrap
                    }
                  }
                  Row {
                    visible: root.editSource === "tap"
                    spacing: Style.spacing.lg
                    ButtonGroup {
                      value: root.editCorner
                      options: [
                        { value: "tl", label: "↖" }, { value: "tr", label: "↗" },
                        { value: "bl", label: "↙" }, { value: "br", label: "↘" }
                      ]
                      foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily
                      onChanged: function(v) { root.setTap(v, root.editCount) }
                    }
                    ButtonGroup {
                      value: String(root.editCount)
                      options: [
                        { value: "1", label: "1×" }, { value: "2", label: "2×" },
                        { value: "3", label: "3×" }, { value: "4", label: "4×" }
                      ]
                      foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily
                      onChanged: function(v) { root.setTap(root.editCorner, Number(v)) }
                    }
                  }
                  Row {
                    visible: root.editSource !== "tap"
                    spacing: Style.spacing.sm
                    Repeater {
                      model: ["U", "D", "L", "R"]
                      delegate: SmallButton {
                        required property string modelData
                        text: Actions.arrowText(modelData)
                        onClicked: root.addDir(modelData)
                      }
                    }
                    SmallButton {
                      text: "→←"
                      tooltipText: root.tr("pinchin")
                      visible: root.editSource !== "mouse"
                      onClicked: root.editGesture = "pinchin"
                    }
                    SmallButton {
                      text: "←→"
                      tooltipText: root.tr("pinchout")
                      visible: root.editSource !== "mouse"
                      onClicked: root.editGesture = "pinchout"
                    }
                    SmallButton {
                      text: root.tr("tap2")
                      visible: root.editSource === "tp4"
                      onClicked: root.editGesture = "tap2"
                    }
                    SmallButton {
                      text: "← → " + root.tr("swipeWord")
                      tooltipText: root.tr("swipeGestureHint")
                      visible: root.editSource === "tp3" || root.editSource === "tp4"
                      onClicked: root.setSwipeGesture()
                    }
                    SmallButton {
                      text: "⌫"
                      onClicked: root.editGesture = /^(pinch|tap)/.test(root.editGesture) ? "" : root.editGesture.slice(0, -1)
                    }
                    SmallButton { text: root.tr("clear"); onClicked: root.editGesture = "" }
                    Text {
                      anchors.verticalCenter: parent.verticalCenter
                      leftPadding: Style.spacing.lg
                      text: root.editGesture === "" ? root.tr("gestureEmpty") : root.gestureText(root.editGesture)
                      color: root.editGesture === "" ? root.muted : root.accent
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.title
                      font.bold: root.editGesture !== ""
                    }
                  }
                  Hint { width: parent.width; text: root.editSource === "tap" ? root.tr("tapGestureHint") : root.tr("gestureHint") }

                  Label { text: root.tr("action") }
                  ButtonGroup {
                    value: root.editType
                    // The swipe gesture can only swipe (Hyprland) or do nothing.
                    options: root.editGesture === "swipe"
                      ? [{ value: "dispatch", label: root.tr("actionDispatch") }, { value: "none", label: root.tr("actionNone") }]
                      : [{ value: "dispatch", label: root.tr("actionDispatch") }, { value: "keys", label: root.tr("actionKeys") },
                         { value: "exec", label: root.tr("actionExec") }, { value: "none", label: root.tr("actionNone") }]
                    foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily
                    onChanged: function(v) { root.editType = v; root.editError = ""; root.recordingStep = -1 }
                  }

                  Dropdown {
                    id: dispatchPicker
                    width: parent.width
                    visible: root.editType === "dispatch"
                    showLabel: false
                    options: root.dispatchOptions(root.editGesture === "swipe")
                    fontFamily: root.fontFamily
                    onChanged: function(v) { root.editDispatch = v }
                  }

                  // Key combination steps (up to Actions.MAX_SEQUENCE).
                  Column {
                    width: parent.width
                    visible: root.editType === "keys"
                    spacing: Style.spacing.sm

                    Repeater {
                      model: root.editSteps.length
                      delegate: Row {
                        required property int index
                        spacing: Style.spacing.sm
                        Text {
                          anchors.verticalCenter: parent.verticalCenter
                          width: Style.space(28)
                          text: (index + 1) + "."
                          color: root.muted
                          font.family: root.fontFamily
                          font.pixelSize: Style.font.body
                        }
                        TextField {
                          width: Style.space(260)
                          text: root.editSteps[index]
                          placeholderText: root.tr("keysPlaceholder")
                          foreground: root.foreground
                          accent: root.accent
                          font.family: root.fontFamily
                          font.pixelSize: Style.font.body
                          onTextEdited: { root.setStep(index, text); root.editError = "" }
                        }
                        SmallButton {
                          text: root.recordingStep === index ? root.tr("recording") : root.tr("record")
                          selected: root.recordingStep === index
                          onClicked: {
                            root.recordingStep = index
                            Qt.callLater(function() { comboCatcher.forceActiveFocus() })
                          }
                        }
                        SmallButton {
                          text: "×"
                          visible: root.editSteps.length > 1
                          tooltipText: root.tr("removeStep")
                          onClicked: root.removeStep(index)
                        }
                      }
                    }
                    SmallButton {
                      text: "+ " + root.tr("addStep")
                      visible: root.editSteps.length < Actions.MAX_SEQUENCE
                      onClicked: root.addStep()
                    }
                    Hint {
                      width: parent.width
                      text: root.recordingStep >= 0 ? root.tr("recordHint") : root.tr("keysHint")
                    }
                  }

                  Column {
                    width: parent.width
                    visible: root.editType === "exec"
                    spacing: Style.spacing.sm
                    Label { text: root.tr("command") }
                    TextField {
                      id: commandField
                      width: parent.width
                      foreground: root.foreground
                      accent: root.accent
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.body
                      onTextEdited: { root.editCommand = text; root.editError = "" }
                    }
                    Hint { width: parent.width; text: root.tr("commandHint") }
                  }

                  Column {
                    width: parent.width
                    visible: root.editType === "keys" || root.editType === "exec"
                    spacing: Style.spacing.sm
                    Label { text: root.tr("label") }
                    TextField {
                      id: labelField
                      width: parent.width
                      foreground: root.foreground
                      accent: root.accent
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.body
                      onTextEdited: root.editLabel = text
                    }
                  }

                  Text {
                    width: parent.width
                    visible: root.editError !== ""
                    text: root.editError
                    color: Color.urgent
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.caption
                    wrapMode: Text.WordWrap
                  }

                  Row {
                    spacing: Style.spacing.md
                    SmallButton { text: root.tr("apply"); selected: true; onClicked: root.applyEditor() }
                    SmallButton { text: root.tr("cancelEdit"); onClicked: root.closeEditor() }
                  }
                }
              }
            }

            ChangesPage { id: changesPage; width: parent.width; visible: root.page === "changes"; page: root }
          }
        }

      }
    }
  }
}
