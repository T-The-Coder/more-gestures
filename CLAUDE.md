# More Gestures – Arbeitsregeln

Opera-artige Mausgesten für Omarchy (Hyprland 0.56 + Quickshell-Shell). Der vollständige,
freigegebene Plan steht in `PLAN.md`. Setze immer nur den Schritt um, um den du gebeten wirst.

## Grenzen
- Arbeite nur in diesem Verzeichnis. Nichts nach `~/.config` kopieren, die Shell nicht neu
  starten, `hyprctl` nicht schreibend aufrufen, nichts installieren.
- Den Daemon **nie live gegen echte Geräte starten** (kein `grab()` auf echte Mäuse). Teste die Logik mit
  aufgezeichneten bzw. erzeugten Ereignisfolgen. Live-Tests übernimmt der Orchestrator.
- Am Ende jedes Schritts: Tests ausführen, dann ein Commit mit einer aussagekräftigen Nachricht. Nicht pushen.

## Technik
- Daemon: Python 3.14, `python-evdev` 2.0 (systemweit installiert, kein venv, kein pip).
  Die Logik (Zustandsautomat, Segmentierung) kommt in ein importierbares Modul ohne evdev-Abhängigkeit,
  damit `python -m unittest discover -s tests` ohne Geräte läuft. `bin/gesture-daemon` ist nur der dünne evdev/uinput-Rahmen.
- JS-Tests: `mise x node@24.21.0 -- node --test tests/*.test.mjs` (der globale node-Shim hat keine Version).
  `Actions.js`/`Config.js` sind `.pragma library`-taugliche reine Funktionen und enden mit
  `if (typeof module !== "undefined") module.exports = {...}`.
- QML läuft in Quickshell (Qt 6.11). Kein `Intl` in QML-JS. `FileView.setText` ist asynchron.
  Zustand unter `~/.local/state/omarchy/settings/more-gestures.json` mit `FileView { atomicWrites: true }`,
  kaputtes JSON ergibt Standardwerte statt eines Absturzes.
- Vorlagen zum Lesen (nicht ändern): `~/.config/omarchy/plugins/abdul.hotcorners/` (service+overlay-Plugin,
  Process, IpcHandler, Settings-Overlay), `~/Projects/omarchy-plugin-patterns.md`,
  `/usr/share/omarchy/default/hypr/bindings/clipboard.lua` (send_key_state down/up),
  `/usr/share/omarchy/shell/` (Shell-Quellen, z. B. `Commons`, `Ui`, Plugin-Manifeste).
- Kommentare begründen das *Warum* und nennen konkrete Fehlerbilder.

## Dokumentation
- `README.md` und `CHANGELOG.md` bei jeder Änderung mitpflegen, ebenso Hinweise in der Oberfläche.
- I18n: Englisch als Grundlage, dazu Deutsch.
