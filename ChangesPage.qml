import QtQuick
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Changelog.js" as Changelog

// Settings page "Update log": the plugin's own CHANGELOG.md, read from its folder each
// time the page shows (nothing is fetched) and parsed by Changelog.js, the parser More
// Time and More Weather share: a card per version, newest first. The first three
// versions show, the rest wait behind "Show older versions", as in More Time.
//
// This log groups its items under "### Added / Changed / Fixed" (Keep a Changelog);
// the shared parser turns such a heading into an item without a title, drawn here as a
// small group heading. Items without a bold lead show their whole text in the
// foreground colour, since there is no title to carry them.
Column {
  id: changesPage
  required property var page   // the Settings root: tr(), colours, font
  spacing: Style.space(12)

  property bool active: visible
  onActiveChanged: if (active) {
    showOlder = false
    logFile.reload()
    manifestFile.reload()
  }

  property var sections: []
  property bool loaded: false
  property string installedVersion: ""
  property bool showOlder: false
  readonly property int firstShown: 3
  readonly property var shownSections: showOlder ? sections : sections.slice(0, firstShown)

  function filePath(name) { return String(Qt.resolvedUrl(name)).replace(/^file:\/\//, "") }
  function isGroup(item) {
    return item.title === "" && /^(Added|Changed|Fixed|Removed|Deprecated|Security)\b[^.]*$/.test(item.text)
  }

  FileView {
    id: logFile
    path: changesPage.filePath("CHANGELOG.md")
    printErrors: false
    onLoaded: {
      try { changesPage.sections = Changelog.parse(text()) } catch (e) { changesPage.sections = [] }
      changesPage.loaded = true
    }
    onLoadFailed: {
      changesPage.sections = []
      changesPage.loaded = true
    }
  }
  FileView {
    id: manifestFile
    path: changesPage.filePath("manifest.json")
    printErrors: false
    onLoaded: {
      try { changesPage.installedVersion = String(JSON.parse(text()).version || "") } catch (e) { changesPage.installedVersion = "" }
    }
  }

  // Enter on the page: the older versions.
  function activate() {
    if (!showOlder && sections.length > firstShown) {
      showOlder = true
      return true
    }
    return false
  }

  Text {
    visible: changesPage.page.lang.indexOf("en") !== 0
    width: parent.width
    text: changesPage.page.tr("changesEnglishNote")
    color: changesPage.page.muted
    font.family: changesPage.page.fontFamily
    font.pixelSize: Style.font.caption
    wrapMode: Text.WordWrap
  }

  Text {
    visible: changesPage.loaded && changesPage.sections.length === 0
    width: parent.width
    text: changesPage.page.tr("changesNone")
    color: changesPage.page.muted
    font.family: changesPage.page.fontFamily
    font.pixelSize: Style.font.bodySmall
    wrapMode: Text.WordWrap
  }

  Repeater {
    model: changesPage.shownSections

    Rectangle {
      id: versionCard
      required property var modelData
      readonly property bool installed: !modelData.unreleased && modelData.version === changesPage.installedVersion
      width: changesPage.width
      height: versionContent.implicitHeight + Style.space(20)
      radius: Style.cornerRadius
      color: "transparent"
      border.color: Util.alpha(changesPage.page.foreground, 0.18)
      border.width: Style.spacing.hairline

      Column {
        id: versionContent
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: Style.space(10)
        spacing: Style.space(8)

        Item {
          width: parent.width
          height: Math.max(versionTitle.implicitHeight, installedTag.implicitHeight)

          Text {
            id: versionTitle
            anchors.left: parent.left
            anchors.right: installedTag.visible ? installedTag.left : parent.right
            anchors.rightMargin: Style.space(8)
            text: versionCard.modelData.unreleased ? changesPage.page.tr("changesUnreleased")
              : versionCard.modelData.version + (versionCard.modelData.date ? " · " + versionCard.modelData.date : "")
            color: changesPage.page.foreground
            font.family: changesPage.page.fontFamily
            font.pixelSize: Style.font.bodySmall
            font.bold: true
            elide: Text.ElideRight
          }

          Text {
            id: installedTag
            visible: versionCard.installed
            anchors.right: parent.right
            anchors.verticalCenter: versionTitle.verticalCenter
            text: changesPage.page.tr("changesCurrent")
            color: Color.accent
            font.family: changesPage.page.fontFamily
            font.pixelSize: Style.font.caption
            font.bold: true
          }
        }

        Repeater {
          model: versionCard.modelData.items

          Column {
            id: change
            required property var modelData
            readonly property bool group: changesPage.isGroup(modelData)
            width: versionContent.width
            spacing: Style.space(2)
            topPadding: group ? Style.space(4) : 0

            Text {
              visible: change.modelData.title !== "" || change.group
              width: parent.width
              text: change.group ? change.modelData.text.toLocaleUpperCase() : change.modelData.title
              color: change.group ? Color.accent : changesPage.page.foreground
              font.family: changesPage.page.fontFamily
              font.pixelSize: change.group ? Style.font.caption : Style.font.bodySmall
              font.bold: change.group
              font.letterSpacing: change.group ? 1 : 0
              wrapMode: Text.WordWrap
            }
            Text {
              visible: change.modelData.text !== "" && !change.group
              width: parent.width
              text: change.modelData.text
              color: change.modelData.title === "" ? changesPage.page.foreground : changesPage.page.muted
              font.family: changesPage.page.fontFamily
              font.pixelSize: change.modelData.title === "" ? Style.font.bodySmall : Style.font.caption
              wrapMode: Text.WordWrap
            }
          }
        }
      }
    }
  }

  Button {
    visible: !changesPage.showOlder && changesPage.sections.length > changesPage.firstShown
    bordered: true
    text: changesPage.page.tr("changesShowOlder")
    foreground: changesPage.page.foreground
    accent: changesPage.page.accent
    fontFamily: changesPage.page.fontFamily
    onClicked: changesPage.showOlder = true
  }
}
