# Plan: „More Gestures“ – Mausgesten wie bei Opera als Omarchy-Plugin

## Kontext
Opera steuert den Browser über Mausgesten: rechte Taste halten, eine Linie ziehen, loslassen.
Dieses Konzept soll auf ganz Omarchy übertragen werden, damit die häufigsten Bedienschritte
mit der Maus allein gehen: Arbeitsfläche wechseln, Fenster schließen, Launcher öffnen,
im Browser zurück und vor, Tab schließen usw.

Entscheidungen des Nutzers:
- **Auslöser:** standardmäßig die rechte Taste ziehen. Ein kurzer Klick bleibt ein normaler
  Rechtsklick. Die Auslösetaste lässt sich in den Plugin-Einstellungen ändern
  (rechts, Mitte, Seitentaste 8 oder 9).
- **Umfang:** Desktop-Aktionen und App-bewusste Aktionen. Je nach aktivem Programm
  bedeutet dieselbe Geste etwas anderes, im Browser zum Beispiel „Zurück“ statt
  „Arbeitsfläche links“.

Fakten aus der Erkundung:
- Hyprland 0.56.2 mit Lua-Konfiguration. `hyprctl eval '<lua>'` führt Lua aus.
- Omarchy schickt Tastenkürzel an das aktive Fenster mit `hl.dsp.send_key_state`: erst „down“,
  50 ms später „up“. Das umgeht hängende Tasten. Vorlage dafür:
  `/usr/share/omarchy/default/hypr/bindings/clipboard.lua`.
- Omarchy markiert Programme über Fenster-Tags: `chromium-based-browser`, `firefox-based-browser`
  (`default/hypr/apps/browser.lua`) und `terminal` (`apps/terminals.lua`). Die App-Erkennung
  baut darauf auf, statt eigene Listen von Programmklassen zu pflegen.
- Super+Rechtsziehen ist in Omarchy mit „Fenstergröße ändern“ belegt (`bindings/tiling.lua:71`).
  Solange eine Modifier-Taste gedrückt ist, darf das Plugin deshalb nicht eingreifen.
- Der Nutzer ist in der Gruppe `input` und hat per ACL Schreibrechte auf `/dev/uinput`.
  `python-evdev` 2.0 ist installiert.
- Vorlagen für Plugins: `abdul.hotcorners` (Arten `service` + `overlay`, `keepLoaded`,
  Hilfsskripte in `bin/`, `IpcHandler`) und `~/Projects/omarchy-plugin-patterns.md`.

## Architektur

```
Maus ──evdev (exklusiv gegriffen)──▶ gesture-daemon (Python) ──uinput──▶ Hyprland/Programme
                                          │ JSON-Zeilen (stdout)  ▲ Befehle (stdin)
                                          ▼                       │
                              Service.qml (Quickshell, Omarchy-Shell)
                              ├─ Gestenname → Aktion (Actions.js, je nach App)
                              ├─ Anzeige der Geste (Overlay: Pfeile + Aktionsname)
                              └─ Ausführung über hyprctl eval / Befehl
```

### 1. `bin/gesture-daemon` (Python, python-evdev)
- Findet Zeigegeräte: hat `REL_X`, `REL_Y` und die Auslösetaste, aber kein `ABS_MT`
  (Touchpads bleiben unberührt). Greift jedes Gerät exklusiv (`grab()`) und legt dazu ein
  uinput-Gerät per `UInput.from_device` an. Alles, was keine Geste ist, wird 1:1 weitergereicht.
- Das eigene uinput-Gerät wird über einen festen Namen ausgeschlossen, damit es sich nicht
  selbst greift. Neue Geräte (Hotplug) findet ein Abgleich von `/dev/input` alle 2 s.
- Zustände beim Drücken der Auslösetaste:
  - **Unentschieden:** Der Tastendruck wird zurückgehalten, die Bewegung wird weitergereicht,
    der Zeiger bewegt sich also normal.
  - Bewegung über der Schwelle (Standard 20 Einheiten) → **Geste**. Der Tastendruck wird
    verworfen.
  - Loslassen ohne Bewegung → Druck und Loslassen werden nachgesendet: ein normaler Rechtsklick.
  - Länger als 350 ms gehalten ohne Bewegung → der Druck wird nachgesendet. Damit bleibt
    „Rechts halten, im Kontextmenü ziehen“ möglich.
- Erkennung: Die Bewegung wird aufsummiert. Ein Segment entsteht, sobald eine Richtung
  (U, D, L, R) über die Schwelle hinaus überwiegt. Gleiche Richtungen hintereinander werden
  zusammengefasst, höchstens 4 Segmente. Ergebnis ist zum Beispiel `"DR"`.
- Zusätzlich:
  - Auslösetaste halten und scrollen → `wheel ±1`. Das Scrollen wird nicht weitergereicht.
  - Wippgeste: Auslösetaste halten und links klicken → `rocker-left`. Links halten und
    die Auslösetaste klicken → `rocker-right`. Lässt sich abschalten.
- Modifier: Der Daemon liest die Tastaturen nur passiv, ohne sie zu greifen, und wertet
  ausschließlich Super, Alt, Ctrl und Shift aus. Ist einer davon gedrückt, wird sofort
  durchgereicht, damit Super+Rechtsziehen weiter die Fenstergröße ändert. Andere Tasten
  werden nie gespeichert oder ausgegeben.
- Ausgabe über stdout als JSON-Zeilen: `start`, `segment {dirs}`, `end {gesture}`, `cancel`,
  `wheel {dir}`, `rocker {side}`.
- Eingabe über stdin: `pass on|off` (für ausgeschlossene Programme wie Spiele oder VMs,
  dann wird alles direkt durchgereicht) und `config {...}` (Taste, Schwellen).
- Sicherheit:
  - SIGTERM, SIGINT und das Ende von stdin führen zu ungrab und Beenden. Stirbt die Shell,
    stirbt auch der Daemon, und der Kernel gibt den Griff frei: Die Maus funktioniert dann wieder.
  - Notbremse: Bleibt die Auslösetaste länger als 10 s gedrückt, wird zurückgesetzt.

### 2. `Service.qml` (service, keepLoaded)
- Startet den Daemon per `Process` und liest die Zeilen mit `SplitParser`. Startet ihn bei
  Absturz neu, mit wachsender Wartezeit. Startet ihn neu, wenn sich die Auslösetaste ändert.
- Verfolgt das aktive Fenster (Quickshell-Modul Hyprland bzw. `hyprctl activewindow -j`
  wie bei hotcorners) und schickt `pass on|off` an den Daemon, wenn Klasse oder Tag auf der
  Ausschlussliste steht.
- Bei `end` ermittelt `Actions.resolve(gesture, windowInfo, config)` die Aktion, die dann
  ausgeführt wird.
- `IpcHandler { target: "more-gestures" }` mit `enable`, `disable`, `toggle` und `status()`
  (JSON zur Diagnose).

### 3. Overlay (Anzeige während der Geste)
- Eine Layer-Shell-Fläche auf Ebene Overlay, die keine Eingaben annimmt (leere Input-Region).
  Sie erscheint an der Zeigerposition beim Start (`hyprctl cursorpos`).
- Zeigt die Pfeile der bisher erkannten Segmente und darunter den Namen der Aktion, die
  beim Loslassen ausgeführt würde. Ist die Geste unbekannt, steht dort „—“.
  Farben kommen aus dem Theme (`Color`/`Style` der Shell).
- Eine Zeichenspur der Mausbewegung ist bewusst nicht vorgesehen: Der Daemon kennt nur relative
  Rohwerte ohne die Mausbeschleunigung des Compositors, die Spur würde deshalb abweichen.

### 4. `Actions.js` (reine Funktionen, unter Node testbar)
Aktionsarten:
- `dispatch`: Lua über `hyprctl eval`
- `key`: send_key_state down/up wie in clipboard.lua
- `exec`: Befehl, z. B. `omarchy …`
- `none`

Profile werden nach Fenster-Tag gewählt, der erste Treffer gilt, zuletzt kommt `default`.

Standardbelegung:

| Geste | Desktop (default) | Browser (chromium/firefox-Tag) |
|---|---|---|
| ← L | Arbeitsfläche links | Zurück (Alt+Left) |
| → R | Arbeitsfläche rechts | Vor (Alt+Right) |
| ↑ U | App-Launcher | — (erbt Desktop) |
| ↓ D | Neues Terminal | Neuer Tab (Ctrl+T) |
| ↓→ DR | Fenster schließen | Tab schließen (Ctrl+W) |
| ↑↓ UD | — | Neu laden (F5) |
| ←↑ LU | — | Geschlossenen Tab öffnen (Ctrl+Shift+T) |
| ↓↑ DU | Schwebend umschalten | Tab duplizieren |
| →↑ RU | Vollbild umschalten | erbt |
| ↑← UL / ↑→ UR | Fenster auf Arbeitsfläche links/rechts verschieben | erbt |
| Taste + Mausrad | Arbeitsfläche wechseln | Tab wechseln (Ctrl+Tab / Ctrl+Shift+Tab) |
| Wippe links/rechts | wie L / R | Zurück / Vor |

Terminal-Profil: L/R erben vom Desktop, DR schließt das Fenster.

### 5. Einstellungen (`Settings.qml`, overlay, nach dem Muster von hotcorners)
- Ein/Aus, Auslösetaste, Bewegungsschwelle, Haltezeit, Wippgesten, Mausrad.
- Je Profil eine Liste „Geste → Aktion“ zum Bearbeiten mit einer Auswahl aus fertigen Aktionen.
- Ausschlussliste mit Klassen und Tags (Vorbelegung: Steam-Spiele, retroarch, qemu).
- Speicherung als JSON im Plugin-Konfigurationsordner, Lesen und Schreiben wie bei hotcorners
  (`Config.js`).

## Dateien (neues Projekt `~/Projects/more-gestures/`)
- `manifest.json`: `id: "more-gestures"`, `kinds: ["service","overlay"]`, `keepLoaded: true`
- `bin/gesture-daemon` (Python)
- `Service.qml`, `GestureOverlay.qml`, `Settings.qml`, `Actions.js`, `Config.js`, `I18n.js`
  (Deutsch und Englisch)
- `tests/`: `test_recognizer.py` (unittest, Zustandsautomat und Segmentierung mit
  aufgezeichneten Ereignisfolgen) und `actions.test.js` (über mise node, wie bei more-time)
- `README.md`, `CHANGELOG.md`, `LICENSE`, `preview.png`
- Bereitstellung durch Kopieren nach `~/.config/omarchy/plugins/more-gestures/`, wie bei more-time.
  Die Shell lädt Plugin-Code beim Speichern neu. Ein neuer Service wird mit
  `omarchy-shell shell rescanPlugins` erfasst.
- Konventionen aus dem Gedächtnis: README, CHANGELOG und Hinweise in der App bei jeder Änderung
  aktuell halten. Nach jedem Commit nach Forgejo (origin) pushen. Geteilte Dateien mit
  mt und mw nur übernehmen, wenn sie wirklich passen.

## Orchestrierung über OpenRouter (Ori)
Programmiert wird von `ori claude` mit `anthropic/claude-sonnet-5.5` über OpenRouter. Ori ist bereits
angemeldet. Diese Sitzung übernimmt Orchestrierung, Prüfung und Freigabe.

1. Diese Sitzung legt `~/Projects/more-gestures/` mit `git init` an und kopiert diesen Plan als `PLAN.md` dorthin.
   Dazu kommen eine `CLAUDE.md` mit den Konventionen: README und CHANGELOG pflegen, Tests,
   Bereitstellung durch Kopieren, die Fallen bei Quickshell aus `omarchy-plugin-patterns.md`.
   Danach prüft sie mit `ori models` bzw. einem kurzen Probelauf, ob es die Modell-ID gibt.
2. Für jeden Schritt aus „Reihenfolge der Umsetzung“ gibt es genau einen Lauf, im Hintergrund und
   mit Protokoll unter `logs/step-N.log`:
   ```
   cd ~/Projects/more-gestures && ORI_TELEMETRY=0 ori claude --model anthropic/claude-sonnet-5.5 -- \
     -p "Lies PLAN.md und CLAUDE.md. Setze nur Schritt N um. Schreibe Tests, führe sie aus, committe. Keine anderen Schritte." \
     --permission-mode acceptEdits --allowedTools "Bash(python*) Bash(mise*) Bash(git*) Read Edit Write"
   ```
   Der Agent darf nichts nach `~/.config` kopieren und die Shell nicht neu starten.
   Bereitstellung und Live-Tests macht diese Sitzung.
3. Nach jedem Lauf prüft diese Sitzung den Diff (`git show`), führt die Tests selbst aus und
   macht die Live-Prüfung aus „Prüfung“. Bei Mängeln folgt ein Nachbesserungslauf mit
   `--resume` oder einem gezielten Prompt. Erst dann kommt der nächste Schritt.
4. Schritt 1, der Maus-Griff, wird zuerst nur mit `--dry-run` und dann kurz live getestet.
   Dabei bleibt immer ein Terminal mit `pkill -f gesture-daemon` bereit.
5. Nach dem letzten Schritt: Bereitstellung, Commit, Push nach Forgejo (sobald ein Remote
   angelegt ist, vorher nachfragen), kurzer Bericht mit den OpenRouter-Kosten aus den Läufen.

## Reihenfolge der Umsetzung
1. Daemon mit Durchreichen und Klick-Nachsenden, ohne Gesten. Prüfen, dass sich Maus,
   Rechtsklick, Kontextmenü-Ziehen und Super+Rechtsziehen unverändert anfühlen.
2. Erkennung und JSON-Ausgabe, mit Unit-Tests.
3. Service mit Actions.js und Standardbelegung.
4. Overlay.
5. Einstellungen und Ausschlussliste.
6. Dokumentation und Bereitstellung.

## Prüfung
- `python -m unittest` für die Erkennung. `mise exec node -- node --test tests/` für Actions.js.
- Den Daemon zuerst allein im Terminal mit `--dry-run` laufen lassen: Er gibt dann nur Ereignisse
  aus. `Ctrl+C` muss die Maus sofort freigeben.
- In der echten Shell:
  - Rechtsklick in Browser, Dateimanager und Terminal (Kontextmenü erscheint)
  - Gesten L, R und DR im Browser und auf dem Desktop
  - Super+Rechtsziehen ändert weiter die Fenstergröße
  - Mausrad mit gehaltener Taste
  - Spiel oder VM in der Ausschlussliste: Dort darf nichts abgefangen werden
- `qs ipc call more-gestures status` zeigt Daemon-Zustand, Geräte und die letzte Geste.
- Absturztest: Daemon mit `kill -9` beenden. Die Maus muss sofort wieder gehen, der Service
  startet ihn neu.
