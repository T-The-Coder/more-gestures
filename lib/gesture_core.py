"""Entscheidungslogik des Gesten-Daemons, bewusst ohne evdev-Abhängigkeit.

Der Daemon (bin/gesture-daemon) ist nur der dünne evdev/uinput-Rahmen. Alles, was
entscheidet, ob ein Tastendruck zurückgehalten, weitergereicht oder verworfen wird,
steht hier und läuft damit in Unit-Tests ohne Geräte.

Die Engine kennt keine Uhr und keine Geräte: Sie bekommt Zeitstempel (Sekunden,
monoton) und Ereignisse und liefert Aktionen zurück, die der Rahmen ausführt.
"""

import json
import math
from dataclasses import dataclass

# Linux-Eingabecodes (linux/input-event-codes.h). Hier fest eingetragen, damit das
# Modul ohne python-evdev importierbar bleibt.
EV_SYN = 0x00
EV_KEY = 0x01
EV_REL = 0x02
EV_ABS = 0x03

REL_X = 0x00
REL_Y = 0x01
REL_WHEEL = 0x08
REL_WHEEL_HI_RES = 0x0B
WHEEL_CODES = frozenset({REL_WHEEL, REL_WHEEL_HI_RES})

BTN_LEFT = 0x110
BTN_RIGHT = 0x111
BTN_MIDDLE = 0x112
BTN_SIDE = 0x113
BTN_EXTRA = 0x114

TRIGGER_BUTTONS = {
    "right": BTN_RIGHT,
    "middle": BTN_MIDDLE,
    "side": BTN_SIDE,
    "extra": BTN_EXTRA,
}

ABS_MT_FIRST = 0x2F  # ABS_MT_SLOT
ABS_MT_LAST = 0x3D  # ABS_MT_TOOL_Y

# Nur diese Tasten wertet der Daemon von Tastaturen aus (Super/Alt/Ctrl/Shift).
# Alles andere wird sofort verworfen und nie gespeichert oder ausgegeben.
MODIFIER_CODES = frozenset({29, 97, 42, 54, 56, 100, 125, 126})
KEY_A = 30
KEY_LEFTSHIFT = 42

# Name des eigenen uinput-Geräts. Daran erkennt der Hotplug-Abgleich es wieder und
# greift es nicht selbst: sonst Rückkopplung aus Griff und Weiterleitung.
VIRTUAL_NAME_PREFIX = "more-gestures virtual"

IDLE = "idle"
UNDECIDED = "undecided"  # Auslösetaste gedrückt und zurückgehalten
GESTURE = "gesture"  # Schwelle überschritten, Druck verworfen
PASSED = "passed"  # Druck wurde ausgeliefert, Loslassen geht ebenfalls durch
SWALLOW = "swallow"  # Notbremse: das späte Loslassen des verworfenen Drucks schlucken
CLICK_WAIT = "click-wait"  # Klick erkannt, zurückgehalten: kommt gleich ein zweiter Druck?
RING = "ring"  # Doppelklick mit gehaltenem zweiten Druck: Kreismenü offen


# Ein Segment gilt nur, wenn die Nebenachse höchstens so viel der Hauptachse hat
# (0,7 ≈ 35° von der Achse). Reine Diagonalen bleiben damit unentschieden, statt je
# nach Rauschen mal als R und mal als D erkannt zu werden.
DOMINANCE = 0.7
PROGRESS_INTERVAL = 1 / 30  # höchstens 30 progress-Ereignisse pro Sekunde
MAX_WHEEL_STEPS = 5  # Obergrenze je Ereignis, falls ein Gerät große Werte meldet


@dataclass
class Config:
    trigger: int = BTN_RIGHT
    threshold: float = 20.0  # Einheiten der Quelle: rohe REL-Werte, beim Trackpad mm
    hold_time: float = 0.350  # Sekunden bis zum Nachsenden des Drucks
    emergency_time: float = 10.0  # Sekunden bis zum Zurücksetzen einer Geste
    max_segments: int = 5
    # Wippgesten (Auslösetaste + Linksklick und umgekehrt). Standard aus: Wer mit
    # gedrückter linker Taste markiert und dann rechts klickt, will ein Kontextmenü.
    rocker: bool = False
    # Kreismenü: Klick, dann sofort wieder drücken und halten. Kostet jeden normalen
    # Klick der Auslösetaste `double_time` Verzögerung (der erste Klick wird
    # zurückgehalten, bis klar ist, ob ein zweiter Druck folgt).
    ring: bool = False
    double_time: float = 0.25


def _number(value, low, high):
    ok = isinstance(value, (int, float)) and not isinstance(value, bool)
    return ok and low <= value <= high


def update_config(config, data):
    """Wendet ein `config {...}` aus stdin auf `config` an (in place, alle Engines teilen es).

    Gültige Schlüssel: threshold, hold_ms, rocker. Ungültige oder unbekannte Einträge
    werden übersprungen und zurückgegeben, damit ein Tippfehler in der Einstellungsdatei
    nicht die ganze Konfiguration verwirft und der Daemon nie an NaN oder 0 hängt.
    """
    rejected = []
    for key, value in data.items():
        if key == "threshold" and _number(value, 1, 5000):
            config.threshold = float(value)
        elif key == "hold_ms" and _number(value, 0, 5000):
            config.hold_time = value / 1000.0
        elif key == "rocker" and isinstance(value, bool):
            config.rocker = value
        elif key == "ring" and isinstance(value, bool):
            config.ring = value
        elif key == "double_ms" and _number(value, 100, 800):
            config.double_time = value / 1000.0
        else:
            rejected.append(key)
    return rejected


def parse_command(line):
    """Parst eine stdin-Zeile: ("pass", bool), ("config", dict) oder None."""
    word, _, rest = line.strip().partition(" ")
    rest = rest.strip()
    if word == "pass" and rest in ("on", "off"):
        return ("pass", rest == "on")
    if word == "config":
        try:
            data = json.loads(rest)
        except ValueError:
            return None
        return ("config", data) if isinstance(data, dict) else None
    return None


def _codes(caps, etype):
    """Codes eines Ereignistyps; ABS-Einträge sind bei evdev (code, AbsInfo)-Paare."""
    result = set()
    for entry in caps.get(etype, ()):
        result.add(entry[0] if isinstance(entry, (tuple, list)) else entry)
    return result


def classify(name, caps, trigger=BTN_RIGHT, pointing_stick=False, include_sticks=False):
    """Ordnet ein Gerät ein: "pointer", "keyboard" oder None.

    Pointing-Sticks (TrackPoint) bleiben ohne `include_sticks` ungegriffen: Im
    Live-Test ging über den uinput-Klon das Scrollen mit der mittleren Taste verloren,
    obwohl udev den Klon als ID_INPUT_POINTINGSTICK erkennt.

    `caps` ist `InputDevice.capabilities()` (Typ -> Codes). Zeigegeräte haben REL_X,
    REL_Y und die Auslösetaste, aber kein ABS_MT: Touchpads und Touchscreens bleiben
    unberührt. Das eigene uinput-Gerät wird über den Namen ausgeschlossen.
    """
    if name.startswith(VIRTUAL_NAME_PREFIX):
        return None
    if pointing_stick and not include_sticks:
        return None
    rel = _codes(caps, EV_REL)
    keys = _codes(caps, EV_KEY)
    abs_codes = _codes(caps, EV_ABS)
    if any(ABS_MT_FIRST <= c <= ABS_MT_LAST for c in abs_codes):
        return None
    if {REL_X, REL_Y} <= rel and trigger in keys:
        return "pointer"
    if not rel and KEY_LEFTSHIFT in keys and KEY_A in keys:
        return "keyboard"
    return None


@dataclass(frozen=True)
class Emit:
    """Ereignis an das uinput-Gerät schreiben."""

    etype: int
    code: int
    value: int


@dataclass(frozen=True)
class Message:
    """JSON-Zeile für stdout (Dienst)."""

    payload: dict


class Recognizer:
    """Richtungserkennung, quellenneutral: Eingabe sind Deltas in beliebigen Einheiten.

    `config.threshold` gibt die Länge eines Segments in denselben Einheiten an (Maus:
    rohe Einheiten, Trackpad: mm). Liefert Payloads (dicts) für `start`, `segment` und
    `progress`; `end`/`cancel` bildet der Aufrufer, weil nur er das Loslassen kennt.
    """

    def __init__(self, config, source="mouse", extra=None):
        self.config = config
        self.source = source
        self.extra = extra or {}  # z. B. {"fingers": 3} in jedem Payload
        self.reset()

    def reset(self):
        self.started = False
        self.dirs = []
        self._vx = self._vy = 0.0  # Weg seit dem Anker (letztes Segment bzw. Anfang)
        self._last_progress = -math.inf
        self._last_shown = None

    @property
    def gesture(self):
        return "".join(self.dirs)

    def payload(self, kind, **fields):
        return {"type": kind, "source": self.source, **self.extra, **fields}

    def feed(self, now, dx, dy):
        threshold = self.config.threshold
        self._vx += dx
        self._vy += dy
        if self.dirs:
            self._follow(dx, dy)
        out = []
        if not self.started:
            # Start sobald die Schwelle in irgendeiner Richtung überschritten ist, auch
            # bei Diagonalen: Der Druck muss verworfen sein, sonst würde er nach der
            # Haltezeit mitten im Ziehen als Klick nachgesendet.
            if math.hypot(self._vx, self._vy) <= threshold:
                return out
            self.started = True
            out.append(self.payload("start"))
        cand = self._candidate()
        if (cand is None or cand[0] == self._last_dir()
                or len(self.dirs) >= self.config.max_segments):
            return out
        direction, mag = cand
        if mag > threshold:
            self.dirs.append(direction)
            self._vx = self._vy = 0.0
            self._last_shown = None
            out.append(self.payload("segment", dirs=self.gesture))
            return out
        shown = (direction, round(mag / threshold, 2))
        if shown != self._last_shown and now - self._last_progress >= PROGRESS_INTERVAL:
            self._last_shown = shown
            self._last_progress = now
            out.append(self.payload("progress", dir=shown[0], ratio=shown[1]))
        return out

    def _last_dir(self):
        return self.dirs[-1] if self.dirs else None

    def _follow(self, dx, dy):
        """Den Anker mit dem Extrempunkt der laufenden Richtung mitziehen.

        Zittern gegen die Richtung zählt so nur vom weitesten Punkt aus: Nach R 100 und
        8 zurück braucht es die volle Schwelle für ein L, nicht noch 12 mehr. Und bei
        einer leicht schrägen Linie wächst die Querachse nicht über viele Ereignisse
        zur Schwelle an, weil sie bei jedem Vorwärtsschritt zurückgesetzt wird.
        """
        last = self.dirs[-1]
        sign = 1 if last in "RD" else -1
        if last in "LR":
            along_delta, cross_delta = sign * dx, dy
            if sign * self._vx > 0:
                self._vx = 0.0
            if along_delta > 0 and along_delta > abs(cross_delta):
                self._vy = 0.0
        else:
            along_delta, cross_delta = sign * dy, dx
            if sign * self._vy > 0:
                self._vy = 0.0
            if along_delta > 0 and along_delta > abs(cross_delta):
                self._vx = 0.0

    def _candidate(self):
        ax, ay = abs(self._vx), abs(self._vy)
        if ax >= ay:
            direction, mag, minor = ("R" if self._vx > 0 else "L"), ax, ay
        else:
            direction, mag, minor = ("D" if self._vy > 0 else "U"), ay, ax
        # Fingers on a trackpad drift more than a mouse: the touchpad settings pass a
        # more lenient dominance than the mouse default.
        if mag == 0 or minor > getattr(self.config, "dominance", DOMINANCE) * mag:
            return None
        return direction, mag


class Engine:
    """Zustandsautomat für ein Zeigegerät."""

    def __init__(self, config=None):
        self.config = config or Config()
        self.state = IDLE
        self.modifiers = False
        self.passthrough = False  # `pass on`: alles direkt durchreichen
        self.recognizer = Recognizer(self.config)
        self._pressed_at = 0.0
        self._click_at = 0.0
        self._fx = self._fy = 0  # Bewegung des laufenden Pakets (bis SYN_REPORT)
        self._consumed = False  # Rad oder Wippe haben die Liniengeste ersetzt
        self._left_down = False  # Linke Taste wurde an die Anwendung geliefert
        self._left_swallowed = False  # Linker Druck wurde als Wippe verworfen

    @property
    def bypass(self):
        return self.modifiers or self.passthrough

    # --- Eingänge -----------------------------------------------------------

    def handle(self, now, etype, code, value):
        """Ein Ereignis des Zeigegeräts verarbeiten, Aktionen zurückgeben."""
        if etype == EV_KEY and code == self.config.trigger and value in (0, 1):
            return self._trigger(now, value)
        if self.state == CLICK_WAIT and etype == EV_KEY:
            # Another button while a click is held back: the click happened first, so it
            # goes out first, then this button as usual.
            return self._replay_click() + self.handle(now, etype, code, value)
        if self.state == RING and etype == EV_REL and code in WHEEL_CODES:
            return []  # the ring is open: the wheel must not scroll the window below
        if etype == EV_KEY and code == BTN_LEFT and value in (0, 1):
            return self._left(value)
        if etype == EV_REL and self.state in (UNDECIDED, GESTURE):
            if code in (REL_X, REL_Y):
                # Pro Paket sammeln: REL_X und REL_Y kommen getrennt, eine Diagonale
                # soll aber als ein Schritt zählen.
                if code == REL_X:
                    self._fx += value
                else:
                    self._fy += value
                return [Emit(etype, code, value)]  # Zeiger bewegt sich weiter normal
            if code in WHEEL_CODES:
                return self._wheel(code, value)
        if etype == EV_SYN and code == 0:
            return [Emit(etype, code, value)] + self._flush_frame(now)
        return [Emit(etype, code, value)]

    def tick(self, now):
        """Zeitabhängige Übergänge; der Rahmen ruft das spätestens bei `deadline()`."""
        if self.state == UNDECIDED and now - self._pressed_at >= self.config.hold_time:
            # Rechts halten und im Kontextmenü ziehen muss weiter gehen: Wer lange
            # hält, will keine Geste, der Druck geht verspätet durch.
            return self._flush_press()
        if self.state == GESTURE and now - self._pressed_at >= self.config.emergency_time:
            return self._emergency()
        if self.state == CLICK_WAIT and now - self._click_at >= self.config.double_time:
            return self._replay_click()  # no second press: it was an ordinary click
        if self.state == RING and now - self._pressed_at >= self.config.emergency_time:
            self.state = SWALLOW
            return [Message({"type": "ring", "phase": "cancel"})]
        return []

    def deadline(self):
        """Zeitpunkt des nächsten `tick`-Übergangs oder None."""
        if self.state == UNDECIDED:
            return self._pressed_at + self.config.hold_time
        if self.state in (GESTURE, RING):
            return self._pressed_at + self.config.emergency_time
        if self.state == CLICK_WAIT:
            return self._click_at + self.config.double_time
        return None

    def set_modifiers(self, now, active):
        """Meldung der passiv gelesenen Tastaturen: ist Super/Alt/Ctrl/Shift gedrückt?"""
        self.modifiers = active
        return self._bypass_changed()

    def set_passthrough(self, now, active):
        """`pass on|off`: für ausgeschlossene Programme (Spiele, VMs) alles durchreichen."""
        self.passthrough = active
        return self._bypass_changed()

    def reset(self):
        """Nach SYN_DROPPED: Zustand verwerfen, ohne etwas zu senden.

        Ein ausgelieferter Druck wird wie üblich beim Loslassen durchgereicht (IDLE
        reicht Loslassen durch); ein zurückgehaltener Druck wird verworfen und sein
        Loslassen geschluckt.
        """
        if self.state in (UNDECIDED, GESTURE, RING):
            self.state = SWALLOW
        elif self.state in (PASSED, CLICK_WAIT):
            self.state = IDLE
        self._fx = self._fy = 0
        self._left_down = self._left_swallowed = False

    def shutdown(self):
        """Beim Beenden: einen ausgelieferten Druck loslassen, sonst hängt die Taste."""
        actions = []
        if self.state == PASSED:
            actions += [Emit(EV_KEY, self.config.trigger, 0), Emit(EV_SYN, 0, 0)]
        elif self.state == CLICK_WAIT:
            actions += self._replay_click()
        self.state = IDLE
        return actions

    # --- Übergänge ----------------------------------------------------------

    def _bypass_changed(self):
        if self.bypass and self.state == CLICK_WAIT:
            return self._replay_click()
        if self.bypass and self.state == UNDECIDED:
            # Super+Rechtsziehen ist in Omarchy „Fenstergröße ändern“: Hyprland braucht
            # den Druck sofort, sonst bleibt das Ziehen ohne Wirkung.
            return self._flush_press()
        return []

    def _begin(self, now):
        self.state = UNDECIDED
        self._pressed_at = now
        self._fx = self._fy = 0
        self._consumed = False
        self.recognizer.reset()

    def _trigger(self, now, value):
        trig = self.config.trigger
        if value == 1:
            if self.state == CLICK_WAIT:
                if self.bypass:
                    return self._replay_click() + self._trigger(now, value)
                # Second press right after a click, held: the ring opens. The first
                # click is dropped, it was only the first half of the double click.
                self.state = RING
                self._pressed_at = now
                return [Message({"type": "ring", "phase": "open"})]
            if self.state in (IDLE, SWALLOW):
                # SWALLOW + neuer Druck heißt: das Loslassen ging verloren, neu beginnen.
                if self.bypass:
                    self.state = PASSED
                    return [Emit(EV_KEY, trig, 1)]
                self._begin(now)
                if self.config.rocker and self._left_down:
                    # Links halten, Auslösetaste klicken. Der Druck wird verworfen
                    # und sein Loslassen als Ende einer verbrauchten Geste geschluckt.
                    self.state = GESTURE
                    self._consumed = True
                    return [Message({"type": "rocker", "side": "right"})]
                return []
            return []  # doppelter Druck in einem laufenden Zyklus
        # Loslassen. Ein noch offenes Paket zuerst auswerten, damit die letzte
        # Bewegung noch ins Segment zählt.
        out = self._flush_frame(now)
        if self.state == UNDECIDED:
            if self.config.ring and not self.bypass:
                # Maybe the first half of a double click: hold the click back for
                # double_time (tick replays it when no second press comes).
                self.state = CLICK_WAIT
                self._click_at = now
                return []
            # Klick ohne Bewegung: nachsenden. SYN dazwischen, damit Druck und
            # Loslassen als getrennte Pakete ankommen und nicht verschmelzen.
            self.state = IDLE
            return [Emit(EV_KEY, trig, 1), Emit(EV_SYN, 0, 0), Emit(EV_KEY, trig, 0)]
        if self.state == RING:
            self.state = IDLE
            return [Message({"type": "ring", "phase": "close"})]
        if self.state == GESTURE:
            self.state = IDLE
            if self._consumed:
                return out
            rec = self.recognizer
            # Ohne erkanntes Segment (Diagonale, Zickzack) gibt es nichts auszuführen.
            if rec.dirs:
                return out + [Message(rec.payload("end", gesture=rec.gesture))]
            return out + [Message(rec.payload("cancel"))]
        if self.state == SWALLOW:
            self.state = IDLE
            return []
        self.state = IDLE
        return [Emit(EV_KEY, trig, 0)]

    def _left(self, value):
        if value == 0:
            if self._left_swallowed:
                self._left_swallowed = False
                return []
            self._left_down = False
            return [Emit(EV_KEY, BTN_LEFT, 0)]
        if self.config.rocker and self.state in (UNDECIDED, GESTURE):
            # Auslösetaste halten, links klicken. Der Linksklick geht nicht an die
            # Anwendung; sein Loslassen wird ebenfalls geschluckt.
            self._left_swallowed = True
            return self._consume() + [Message({"type": "rocker", "side": "left"})]
        self._left_down = True
        return [Emit(EV_KEY, BTN_LEFT, 1)]

    def _wheel(self, code, value):
        out = self._consume()
        if code == REL_WHEEL:  # Hi-Res-Werte werden nur geschluckt, sonst zählte jede Raste doppelt
            direction = "up" if value > 0 else "down"
            out += [Message({"type": "wheel", "dir": direction})] * min(abs(value), MAX_WHEEL_STEPS)
        return out

    def _consume(self):
        """Rad oder Wippe ersetzen die Linienbewegung: Druck verwerfen, Pfad abbrechen.

        Fehlerbild sonst: Ein Rad nach einem Segment würde beim Loslassen zusätzlich die
        Liniengeste auslösen, und der Druck der Auslösetaste käme als Rechtsklick nach.
        """
        out = []
        if self.state == UNDECIDED:
            self.state = GESTURE
        if self.recognizer.started and not self._consumed:
            out.append(Message(self.recognizer.payload("cancel")))
        self._consumed = True
        self._fx = self._fy = 0
        return out

    def _flush_frame(self, now):
        dx, dy, self._fx, self._fy = self._fx, self._fy, 0, 0
        if self.state not in (UNDECIDED, GESTURE) or self._consumed or not (dx or dy):
            return []
        out = [Message(p) for p in self.recognizer.feed(now, dx, dy)]
        if self.recognizer.started:
            self.state = GESTURE
        return out

    def _replay_click(self):
        trig = self.config.trigger
        self.state = IDLE
        return [Emit(EV_KEY, trig, 1), Emit(EV_SYN, 0, 0), Emit(EV_KEY, trig, 0), Emit(EV_SYN, 0, 0)]

    def _flush_press(self):
        self.state = PASSED
        self._fx = self._fy = 0
        return [Emit(EV_KEY, self.config.trigger, 1), Emit(EV_SYN, 0, 0)]

    def _emergency(self):
        # Fehlerbild: Das Loslassen kommt nie an (Gerät hängt, Treiberfehler). Ohne
        # Notbremse bliebe der Daemon für immer in der Geste und die Taste tot.
        self.state = SWALLOW
        if self.recognizer.started and not self._consumed:
            return [Message(self.recognizer.payload("cancel"))]
        return []
