import QtQuick

// The More Gestures symbol drawn in QML so it follows the theme live: a square split
// by a fine cross whose lower arm is missing (a schematic mouse). Same proportions as
// bin/app-icon (64 px square, 6 px frame, 2.5 px lines in a 128 px tile).
Item {
  id: root
  property color color: "white"
  implicitWidth: 32
  implicitHeight: 32

  readonly property real frame: Math.max(1.5, width * 6 / 64)
  readonly property real line: Math.max(1, width * 2.5 / 64)

  Rectangle {
    anchors.fill: parent
    radius: root.width * 10 / 64
    color: "transparent"
    border.width: root.frame
    border.color: root.color
  }
  Rectangle {  // horizontal arm across the middle
    x: root.frame / 2
    width: root.width - root.frame
    y: (root.height - root.line) / 2
    height: root.line
    color: root.color
  }
  Rectangle {  // upper arm only: the buttons
    x: (root.width - root.line) / 2
    width: root.line
    y: root.frame / 2
    height: root.height / 2 - root.frame / 2
    color: root.color
  }
}
