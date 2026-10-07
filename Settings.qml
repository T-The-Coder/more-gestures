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

// Settings overlay for More Gestures (mouse only; trackpad modes come with step 4b).
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
  readonly property string lang: Qt.locale().name
  function tr(key) { return I18n.tr(root.lang, key) }

  // Editor state. editKey === "" with editorOpen means "new gesture".
  property bool editorOpen: false
  property string editKey: ""
  property string editGesture: ""
  property string editType: "dispatch"
  property string editDispatch: "workspace-prev"
  property var editSteps: [""]          // keys: one text per combination
  property string editCommand: ""
  property string editLabel: ""
  property string editError: ""
  property int recordingStep: -1        // index of the step being recorded, -1 = none

  readonly property string statePath: Quickshell.env("HOME") + Config.PATH_SUFFIX

  // Shares the [menu] surface tokens like the other Omarchy overlays.
  readonly property color background: Color.menu.background
  readonly property color foreground: Color.menu.text
  readonly property color accent: Color.accent
  readonly property color muted: Qt.darker(root.foreground, 1.6)
  readonly property var borderSpec: Border.surfaceSpec("menu", "border", Color.menu.border, Math.max(1, Style.space(2)))
  readonly property string fontFamily: Style.font.menuFamily

  readonly property var rows: Config.listBindings(root.working, root.profile, Actions)

  // ------------------------------------------------------------------ lifecycle

  function open(payloadJson) {
    stateFile.reload()
    root.working = Config.parse(stateFile.text(), Actions)
    root.profile = "default"
    root.closeEditor()
    root.syncControls()
    root.opened = true
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function close() {
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
  }

  function save() {
    stateFile.setText(Config.serialize(root.working, Actions))
    root.close()
  }

  function set(key, value) {
    var next = Config.clone(root.working)
    next[key] = value
    root.working = Config.sanitize(next, Actions)
  }

  // --------------------------------------------------------------------- editor

  function dispatchOptions() {
    var code = I18n.lang(root.lang)
    return Object.keys(Actions.DISPATCH).map(function(id) {
      return { value: id, label: Actions.DISPATCH[id][code] }
    })
  }

  function openEditor(row) {
    root.recordingStep = -1
    root.editError = ""
    if (!row) {
      root.editKey = ""
      root.editGesture = ""
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

  function closeEditor() {
    root.recordingStep = -1
    root.editorOpen = false
    root.editError = ""
  }

  function addDir(d) {
    if (root.editGesture.length >= 4 || /^(wheel|rocker)-/.test(root.editGesture)) return
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
    // Existing rows keep their device scope; new gestures apply to all devices.
    var source = root.editKey !== "" ? root.editKey.split(":")[0] : "*"
    var key = Config.gestureKeyFor(source, root.editGesture, Actions)
    if (key === "") { root.editError = root.tr("err_gesture"); return }
    var built = root.editorAction()
    if (!built.ok) { root.editError = built.error; return }
    var res = Config.setBinding(root.working, root.profile, key, built.action, Actions)
    if (!res.ok) { root.editError = root.tr("err_action"); return }
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

  function gestureText(g) {
    if (/^[UDLR]+$/.test(g)) return Actions.arrowText(g)
    return g
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
    onFileChanged: reload()
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
        if (root.editorOpen) root.closeEditor(); else root.close()
        event.accepted = true
      }

      BorderSurface {
        id: card
        width: Math.min(Style.space(820), panel.width - Style.gapsOut * 2)
        height: Math.min(content.implicitHeight + card.contentTopInset + card.contentBottomInset,
          panel.height - Style.gapsOut * 2)
        radius: Style.cornerRadius
        anchors.centerIn: parent
        color: root.background
        borderSpec: root.borderSpec
        padding: Style.spacing.panelPadding

        MouseArea { anchors.fill: parent; onClicked: {} }

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

        Flickable {
          id: scroller
          anchors.fill: parent
          anchors.topMargin: card.contentTopInset
          anchors.leftMargin: card.contentLeftInset
          anchors.rightMargin: card.contentRightInset
          anchors.bottomMargin: card.contentBottomInset
          contentHeight: content.implicitHeight
          clip: true
          boundsBehavior: Flickable.StopAtBounds

          Column {
            id: content
            width: scroller.width
            spacing: Style.spacing.huge

            // ------------------------------------------------------- header
            Row {
              spacing: Style.spacing.lg
              MouseGlyph {
                width: Style.space(36)
                height: width
                color: root.foreground
                anchors.verticalCenter: parent.verticalCenter
              }
              Column {
                spacing: Style.spacing.sm
                anchors.verticalCenter: parent.verticalCenter
                Text {
                  text: root.tr("title")
                  color: root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.title
                  font.bold: true
                }
                Hint { text: root.tr("subtitle") }
              }
            }

            // ------------------------------------------------------ general
            Column {
              width: parent.width
              spacing: Style.spacing.md

              PanelSectionHeader { text: root.tr("general"); foreground: root.foreground; fontFamily: root.fontFamily }

              Toggle {
                width: parent.width
                label: root.tr("enabled")
                description: root.tr("enabledHint")
                checked: root.working.enabled
                foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily
                onClicked: root.set("enabled", !root.working.enabled)
              }

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

            // ----------------------------------------------------- feedback
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

            // ----------------------------------------------------- bindings
            Column {
              width: parent.width
              spacing: Style.spacing.md

              PanelSectionHeader { text: root.tr("bindings"); foreground: root.foreground; fontFamily: root.fontFamily }

              ButtonGroup {
                value: root.profile
                options: Config.PROFILES.map(function(p) { return { value: p, label: root.tr("profile_" + p) } })
                foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily
                onChanged: function(v) { root.profile = v; root.closeEditor() }
              }
              Hint { width: parent.width; text: root.tr("profileHint") }

              Hint { visible: root.rows.length === 0; text: root.tr("noBindings") }

              Repeater {
                model: root.rows
                delegate: Rectangle {
                  required property var modelData
                  width: content.width
                  height: Style.spacing.controlHeight + Style.spacing.sm
                  radius: Style.cornerRadius
                  color: rowHover.hovered ? Util.alpha(root.foreground, 0.06) : "transparent"

                  HoverHandler { id: rowHover }

                  Text {
                    id: gestureCell
                    anchors.left: parent.left
                    anchors.leftMargin: Style.spacing.md
                    anchors.verticalCenter: parent.verticalCenter
                    width: Style.space(110)
                    text: root.gestureText(modelData.gesture)
                    color: root.accent
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.subtitle
                    font.bold: true
                  }
                  Text {
                    anchors.left: gestureCell.right
                    anchors.right: rowButtons.left
                    anchors.rightMargin: Style.spacing.md
                    anchors.verticalCenter: parent.verticalCenter
                    elide: Text.ElideRight
                    text: Actions.actionName(modelData.action, root.lang)
                      + (modelData.overridden ? "  ·  " + root.tr("custom") : "")
                      + (modelData.source !== "*" ? "  ·  " + modelData.source : "")
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

              SmallButton {
                text: "+ " + root.tr("editor")
                visible: !root.editorOpen
                onClicked: root.openEditor(null)
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

                  Label { text: root.tr("gesture") }
                  Row {
                    spacing: Style.spacing.sm
                    Repeater {
                      model: ["U", "D", "L", "R"]
                      delegate: SmallButton {
                        required property string modelData
                        text: Actions.arrowText(modelData)
                        onClicked: root.addDir(modelData)
                      }
                    }
                    SmallButton { text: "⌫"; onClicked: root.editGesture = root.editGesture.slice(0, -1) }
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
                  Hint { width: parent.width; text: root.tr("gestureHint") }

                  Label { text: root.tr("action") }
                  ButtonGroup {
                    value: root.editType
                    options: [
                      { value: "dispatch", label: root.tr("actionDispatch") },
                      { value: "keys", label: root.tr("actionKeys") },
                      { value: "exec", label: root.tr("actionExec") },
                      { value: "none", label: root.tr("actionNone") }
                    ]
                    foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily
                    onChanged: function(v) { root.editType = v; root.editError = ""; root.recordingStep = -1 }
                  }

                  Dropdown {
                    id: dispatchPicker
                    width: parent.width
                    visible: root.editType === "dispatch"
                    showLabel: false
                    options: root.dispatchOptions()
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

            // --------------------------------------------------- exclusions
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

            // ------------------------------------------------------- footer
            Item {
              width: parent.width
              height: Style.spacing.controlHeight + Style.spacing.md

              Text {
                anchors.left: parent.left
                anchors.verticalCenter: parent.verticalCenter
                text: root.statePath.replace(Quickshell.env("HOME"), "~")
                color: Qt.darker(root.foreground, 2.0)
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
              }
              Row {
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                spacing: Style.spacing.md
                SmallButton { text: root.tr("cancel"); onClicked: root.close() }
                SmallButton { text: root.tr("save"); selected: true; onClicked: root.save() }
              }
            }
          }
        }
      }
    }
  }
}
