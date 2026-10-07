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
- **Echte Linie wie bei Opera (geändert nach Nutzer-Feedback 2026-10-07):** Sobald `start` kommt (Schwelle
  überschritten, Tastendruck schon zurückgehalten), zeigt das Overlay eine durchsichtige Vollbild-Fläche
  auf dem Monitor unter dem Zeiger, die Zeigerereignisse annimmt (`MouseArea { hoverEnabled: true }`). Da
  kein Programm den Druck gesehen hat, gibt es keinen impliziten Griff, und die Fläche bekommt die exakten
  Zeigerpositionen von Hyprland. Daraus wird die Linie gezeichnet (Shape/Canvas, Theme-Akzentfarbe,
  ca. 4 px, abgerundet, am Ende ausblendend). Das erste Stück vor der Schwelle wird aus den
  Rohwerten rückwärts ergänzt (Startpunkt = erste Position minus aufsummierte Deltas, skaliert),
  oder einfach ab der ersten Position gezeichnet.
- Bei `end`/`cancel` verschwindet die Fläche sofort (Ausblenden ≤ 150 ms ohne Eingabe), damit der
  nächste Klick wieder beim Programm landet. Sicherheitsnetz: Fläche schließt sich spätestens nach
  10 s oder wenn 1 s lang kein Ereignis vom Daemon kam, solange keine Geste läuft.

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

---

## Erweiterung (Nachtrag 2026-10-07): Trackpad, Indikator, eigene Tastenkombinationen

### Ausgangslage auf diesem Rechner
- Geräte: `SYNA8017 Touchpad` (props 0x5), `Apple Magic Trackpad` (Bluetooth, props 0x5),
  `TPPS/2 Elan TrackPoint` (props 0x21 = POINTER|POINTING_STICK) und `SYNA8017 Mouse`.
- In `~/.config/hypr/input.lua` sind schon eigene Hyprland-Gesten eingerichtet: 3 Finger links/rechts für Alt+Left/Right
  (Zurück/Vor), 4 Finger waagerecht für die Arbeitsfläche (mit Animation), 4 Finger hoch für Exposé, runter für Hyprexpo
  und Zusammenziehen für das App-Menü.
- Wichtig für den Maus-Daemon: Der Klon über uinput muss die Input-Properties übernehmen
  (`input_props`, besonders POINTING_STICK). Sonst erkennt libinput den TrackPoint nicht mehr, und Scrollen mit der
  mittleren Taste sowie die TrackPoint-Beschleunigung gehen verloren. Hilft das nicht, werden Pointing-Sticks
  standardmäßig vom Griff ausgenommen (Einstellung „TrackPoint einbeziehen“).

### A. Trackpad-Gesten mit 3 oder 4 Fingern
- **Mitlesen ohne Griff:** Der Daemon liest Touchpads (`ABS_MT_*`) zusätzlich nur passiv, mit Lesezugriff und ohne `grab()`.
  libinput und Hyprland bekommen weiterhin alles. Scrollen, Tippen und die vorhandenen Hyprland-Gesten
  bleiben unberührt.
- **Erkennung:** Die Fingerzahl kommt aus `BTN_TOOL_TRIPLETAP`/`BTN_TOOL_QUADTAP`. Die Position ist der Mittelpunkt
  der aktiven Slots, umgerechnet in mm über `absinfo.resolution`. Die Schwelle ist in mm angegeben (Standard 12 mm
  je Segment), damit sie auf jedem Touchpad gleich wirkt. Es gibt dieselben Segmente U/D/L/R wie bei der Maus und dieselbe
  Erkennung (gemeinsames, evdev-freies Modul). Eine Geste endet, wenn die Finger angehoben werden. Ändert sich die
  Fingerzahl mitten in der Geste, wird abgebrochen.
- **Ereignisse** bekommen eine Quelle: `{"type":"end","source":"touchpad","fingers":3,"gesture":"DR"}`. In der Belegung
  stehen Gesten als `mouse:DR`, `tp3:DR` und `tp4:DR`. Fehlt ein Eintrag, gilt die gemeinsame Belegung `*:DR`.
  Eine Belegung reicht so für alle Geräte, Abweichungen sind trotzdem möglich.
- **Konflikt mit nativen Hyprland-Gesten:** Für jede Fingerzahl gibt es in den Einstellungen einen Modus:
  - **Hyprland** (Standard für 4 Finger): Das Plugin ignoriert diese Fingerzahl. Die Wischgeste für die
    Arbeitsfläche folgt dort den Fingern, und das kann das Plugin nicht nachbauen.
  - **More Gestures** (Empfehlung für 3 Finger): Das Plugin wertet die Fingerzahl aus. Die bisherigen nativen
    3-Finger-Gesten (Zurück/Vor) stecken in der Standardbelegung schon als L und R. Neu kommen Formen wie DR (Tab schließen),
    UD (neu laden) und LU (geschlossenen Tab öffnen) hinzu.
  - Damit nichts doppelt ausgelöst wird, müssen bei „More Gestures“ die nativen `hl.gesture`-Einträge dieser Fingerzahl
    raus. Das macht man nicht zur Laufzeit mit „unset“, denn die Einträge kämen bei jedem Neuladen von Hyprland zurück,
    sondern einmalig in der Konfiguration. Auf diesem Rechner heißt das: die zwei 3-Finger-Zeilen in `input.lua`
    (Zeilen 80 und 81) auskommentieren, nach einem Backup und erst nach Rückfrage. `status()` meldet eine Warnung, wenn
    Hyprland für eine vom Plugin genutzte Fingerzahl noch native Gesten meldet (soweit sich das per `hyprctl eval`
    abfragen lässt, sonst ein Hinweis in den Einstellungen).
- Das Mausrad hat beim Trackpad kein Gegenstück. Wippgesten gibt es nur bei der Maus.

### B. Indikator „Geste wird erkannt“
- **Wann:** Bei der Maus erst, wenn die Bewegungsschwelle überschritten ist. So blinkt bei normalen Rechtsklicks nichts.
  Beim Trackpad, sobald 3 oder 4 Finger aufliegen und sich bewegen.
- **Wo:** an der Zeigerposition beim Start (`hyprctl cursorpos`), auf dem Monitor unter dem Zeiger, als Layer-Overlay
  ohne Eingabe.
- **Was:**
  1. Ein kleiner Ring zeigt „Geste aktiv“. Daneben steht ein Symbol für die Quelle: Maus oder Hand mit „3“ bzw. „4“.
  2. Die echte Linie (siehe Abschnitt 3) und dazu die erkannten Segmente als Pfeile. Das aktuelle Segment wächst sichtbar, bis es die
     Schwelle erreicht (dafür sendet der Daemon `progress {dir, ratio}` mit höchstens 30 Hz).
  3. Darunter steht der Name der Aktion, die beim Loslassen ausgeführt würde. Für Tastenkombinationen
     steht dort die Kombination, z. B. „Strg+Umschalt+T“.
  4. Farben aus dem Theme: neutral, solange erkannt wird, Akzentfarbe bei einer gültigen Aktion, gedimmt mit „—“ bei einer
     unbekannten Geste. Beim Auslösen gibt es eine kurze Bestätigung (Häkchen, 150 ms), beim Abbrechen ein Ausblenden.
- **Einstellung „Indikator“:** aus, minimal (nur Ring und Aktionsname) oder vollständig.
  Das Überblenden lässt sich abschalten (Barrierefreiheit).

### C. Tastenkombination als Aktion (für Maus und Trackpad)
- Neue Aktionsart `keys`: `{ "type": "keys", "combo": ["CTRL SHIFT", "T"], "sequence": [...] }`.
  - Eine Kombination: Modifier (SUPER, CTRL, ALT, SHIFT) plus eine Taste (xkb-Name: Buchstabe, Ziffer, F1–F24, Pfeile,
    Tab, Return, Escape, Space, Prior/Next, Home/End, Delete, BackSpace, XF86-Medientasten).
  - Optional eine **Folge** aus bis zu 4 Kombinationen mit 80 ms Abstand (z. B. Strg+K, Strg+S für VS Code).
  - Optional **Ziel**: das aktive Fenster (Standard) oder eine Fensterklasse.
- **Senden:** wie in `clipboard.lua` über `hl.dsp.send_key_state` erst „down“, nach 50 ms „up“, je Kombination, über `hyprctl eval`.
  Einen Ziel-Parameter für eine Fensterklasse nur nutzen, wenn `send_key_state` ihn wirklich anbietet.
  Das muss geprüft werden, sonst entfällt die Option.
- **Sicherheit:** Modifier und Tastennamen werden in `Actions.js` gegen eine Positivliste bzw. die Regex `^[A-Za-z0-9_]+$`
  geprüft. Der Lua-Text wird nur aus geprüften Teilen zusammengesetzt, damit keine Lua-Injektion über die Einstellungsdatei möglich ist.
- **Einstellungen:** Im Feld „Aktion“ gibt es die Auswahl „Tastenkombination…“ mit einem Aufnahmefeld. Man klickt hinein
  und drückt die Kombination, das Feld fängt sie als Qt-Tastenereignis ab und wandelt sie in Modifier und xkb-Namen um.
  Alternativ lässt sie sich als Text eingeben („Strg+Umschalt+T“ oder „CTRL+SHIFT+T“). Ungültige Eingaben werden
  sofort angezeigt.
- Die Standard-Browserbelegung (Zurück, Tab schließen …) wird intern auf genau diese Aktionsart umgestellt. Es gibt
  dann nur noch einen Weg, Tasten zu senden.

### Auswirkung auf die Reihenfolge
- Schritt 2 (Erkennung): Die Erkennung wird von Anfang an quellenneutral gebaut (Einheiten: Maus-Einheiten bzw. mm),
  mit `progress`-Ereignissen.
- Schritt 3 (Service/Actions): Aktionsart `keys` mit Folge und Validierung. Gestenschlüssel mit Quelle und Rückfall auf `*:`.
- Schritt 4 (Overlay): Der Indikator wird wie unter B beschrieben gebaut.
- **Neuer Schritt 4b:** Trackpad mitlesen (Touchpad-Erkennung, Fingerzahl, mm-Umrechnung, Modus je Fingerzahl) samt Tests
  mit aufgezeichneten Mehrfinger-Folgen. Danach mit Rückfrage die 3-Finger-Zeilen in `input.lua` auskommentieren.
- Schritt 5 (Einstellungen): dazu Aufnahmefeld für Tastenkombinationen, Modus je Fingerzahl, Indikatorstil, TrackPoint-Option.
