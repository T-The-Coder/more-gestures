import QtQuick
import qs.Commons
import qs.Ui

// A whole number with a label, − and + (and ↑ ↓ in the field): the kit's NumberField,
// but typed into a GestureTextField. NumberField's SpinBox edits in a TextInput, which
// in Qt 6.11 and 6.12.0 reads the clipboard payload on every clipboard change
// (see GestureTextField.qml); this one reads it only when you paste.
// value is never written here: a change goes out through modified(), and the owner's
// binding brings it back.
Column {
  id: root

  property string label: ""
  property int value: 0
  property int from: 0
  property int to: 100
  property int stepSize: 1
  property color foreground: Color.foreground
  property color accent: Color.accent
  property string fontFamily: Style.font.family
  property real fontSize: Style.font.body
  property real fieldWidth: Style.spacing.numberFieldWidth

  signal modified(int value)

  spacing: Style.spacing.md

  function clamp(v) { return Math.max(root.from, Math.min(root.to, v)) }
  function offer(v) {
    v = clamp(v)
    edit.text = String(v)
    if (v !== root.value) root.modified(v)
  }
  // Typed text counts when the field is left or Return is pressed; what cannot be
  // read as a number brings the value back.
  function commit() {
    var v = parseInt(edit.text, 10)
    if (isNaN(v)) edit.text = String(root.value)
    else offer(v)
  }

  onValueChanged: if (!edit.activeFocus) edit.text = String(value)

  Text {
    textFormat: Text.PlainText
    visible: root.label !== ""
    text: root.label
    color: Qt.darker(root.foreground, 1.4)
    font.family: root.fontFamily
    font.pixelSize: Style.font.bodySmall
  }

  Row {
    spacing: Style.spacing.sm

    SmallButton {
      text: "−"
      enabled: root.value > root.from
      onClicked: root.offer(root.value - root.stepSize)
    }
    GestureTextField {
      id: edit
      width: root.fieldWidth
      horizontalAlignment: TextEdit.AlignHCenter
      foreground: root.foreground
      accent: root.accent
      font.family: root.fontFamily
      font.pixelSize: root.fontSize
      inputMethodHints: Qt.ImhFormattedNumbersOnly
      validator: IntValidator { bottom: Math.min(0, root.from); top: root.to }
      keyFilter: function(event) {
        if (event.key === Qt.Key_Up || event.key === Qt.Key_Down) {
          var typed = parseInt(edit.text, 10)
          root.offer((isNaN(typed) ? root.value : typed) + (event.key === Qt.Key_Up ? root.stepSize : -root.stepSize))
          event.accepted = true
        }
      }
      onEditingFinished: root.commit()
      onActiveFocusChanged: if (!activeFocus) root.commit()
      Component.onCompleted: text = String(root.value)
    }
    SmallButton {
      text: "+"
      enabled: root.value < root.to
      onClicked: root.offer(root.value + root.stepSize)
    }
  }
}
