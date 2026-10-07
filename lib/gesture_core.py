"""Entscheidungslogik des Gesten-Daemons, bewusst ohne evdev-Abhängigkeit.

Der Daemon (bin/gesture-daemon) ist nur der dünne evdev/uinput-Rahmen. Alles, was
entscheidet, ob ein Tastendruck zurückgehalten, weitergereicht oder verworfen wird,
steht hier und läuft damit in Unit-Tests ohne Geräte.

Die Engine kennt keine Uhr und keine Geräte: Sie bekommt Zeitstempel (Sekunden,
monoton) und Ereignisse und liefert Aktionen zurück, die der Rahmen ausführt.
"""

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


@dataclass
class Config:
    trigger: int = BTN_RIGHT
    threshold: float = 20.0  # Bewegungseinheiten (rohe REL-Werte)
    hold_time: float = 0.350  # Sekunden bis zum Nachsenden des Drucks
    emergency_time: float = 10.0  # Sekunden bis zum Zurücksetzen einer Geste


def _codes(caps, etype):
    """Codes eines Ereignistyps; ABS-Einträge sind bei evdev (code, AbsInfo)-Paare."""
    result = set()
    for entry in caps.get(etype, ()):
        result.add(entry[0] if isinstance(entry, (tuple, list)) else entry)
    return result


def classify(name, caps, trigger=BTN_RIGHT):
    """Ordnet ein Gerät ein: "pointer", "keyboard" oder None.

    `caps` ist `InputDevice.capabilities()` (Typ -> Codes). Zeigegeräte haben REL_X,
    REL_Y und die Auslösetaste, aber kein ABS_MT: Touchpads und Touchscreens bleiben
    unberührt. Das eigene uinput-Gerät wird über den Namen ausgeschlossen.
    """
    if name.startswith(VIRTUAL_NAME_PREFIX):
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


class Engine:
    """Zustandsautomat für ein Zeigegerät."""

    def __init__(self, config=None):
        self.config = config or Config()
        self.state = IDLE
        self.modifiers = False
        self._pressed_at = 0.0
        self._dx = 0.0
        self._dy = 0.0

    # --- Eingänge -----------------------------------------------------------

    def handle(self, now, etype, code, value):
        """Ein Ereignis des Zeigegeräts verarbeiten, Aktionen zurückgeben."""
        if etype == EV_KEY and code == self.config.trigger and value in (0, 1):
            return self._trigger(now, value)
        if etype == EV_REL and self.state == UNDECIDED and code in (REL_X, REL_Y):
            return self._motion(code, value)
        return [Emit(etype, code, value)]

    def tick(self, now):
        """Zeitabhängige Übergänge; der Rahmen ruft das spätestens bei `deadline()`."""
        if self.state == UNDECIDED and now - self._pressed_at >= self.config.hold_time:
            # Rechts halten und im Kontextmenü ziehen muss weiter gehen: Wer lange
            # hält, will keine Geste, der Druck geht verspätet durch.
            return self._flush_press()
        if self.state == GESTURE and now - self._pressed_at >= self.config.emergency_time:
            return self._emergency()
        return []

    def deadline(self):
        """Zeitpunkt des nächsten `tick`-Übergangs oder None."""
        if self.state == UNDECIDED:
            return self._pressed_at + self.config.hold_time
        if self.state == GESTURE:
            return self._pressed_at + self.config.emergency_time
        return None

    def set_modifiers(self, now, active):
        """Meldung der passiv gelesenen Tastaturen: ist Super/Alt/Ctrl/Shift gedrückt?"""
        self.modifiers = active
        if active and self.state == UNDECIDED:
            # Super+Rechtsziehen ist in Omarchy „Fenstergröße ändern“: Hyprland braucht
            # den Druck sofort, sonst bleibt das Ziehen ohne Wirkung.
            return self._flush_press()
        return []

    def reset(self):
        """Nach SYN_DROPPED: Zustand verwerfen, ohne etwas zu senden.

        Ein ausgelieferter Druck wird wie üblich beim Loslassen durchgereicht (IDLE
        reicht Loslassen durch); ein zurückgehaltener Druck wird verworfen und sein
        Loslassen geschluckt.
        """
        if self.state in (UNDECIDED, GESTURE):
            self.state = SWALLOW
        elif self.state == PASSED:
            self.state = IDLE

    def shutdown(self):
        """Beim Beenden: einen ausgelieferten Druck loslassen, sonst hängt die Taste."""
        actions = []
        if self.state == PASSED:
            actions += [Emit(EV_KEY, self.config.trigger, 0), Emit(EV_SYN, 0, 0)]
        self.state = IDLE
        return actions

    # --- Übergänge ----------------------------------------------------------

    def _trigger(self, now, value):
        trig = self.config.trigger
        if value == 1:
            if self.state in (IDLE, SWALLOW):
                # SWALLOW + neuer Druck heißt: das Loslassen ging verloren, neu beginnen.
                if self.modifiers:
                    self.state = PASSED
                    return [Emit(EV_KEY, trig, 1)]
                self.state = UNDECIDED
                self._pressed_at = now
                self._dx = self._dy = 0.0
                return []
            return []  # doppelter Druck in einem laufenden Zyklus
        # Loslassen
        if self.state == UNDECIDED:
            # Klick ohne Bewegung: nachsenden. SYN dazwischen, damit Druck und
            # Loslassen als getrennte Pakete ankommen und nicht verschmelzen.
            self.state = IDLE
            return [Emit(EV_KEY, trig, 1), Emit(EV_SYN, 0, 0), Emit(EV_KEY, trig, 0)]
        if self.state in (GESTURE, SWALLOW):
            self.state = IDLE
            return []
        self.state = IDLE
        return [Emit(EV_KEY, trig, 0)]

    def _motion(self, code, value):
        if code == REL_X:
            self._dx += value
        else:
            self._dy += value
        actions = [Emit(EV_REL, code, value)]  # Zeiger bewegt sich weiter normal
        if math.hypot(self._dx, self._dy) > self.config.threshold:
            self.state = GESTURE
            actions.append(Message({"type": "gesture-candidate"}))
        return actions

    def _flush_press(self):
        self.state = PASSED
        return [Emit(EV_KEY, self.config.trigger, 1), Emit(EV_SYN, 0, 0)]

    def _emergency(self):
        # Fehlerbild: Das Loslassen kommt nie an (Gerät hängt, Treiberfehler). Ohne
        # Notbremse bliebe der Daemon für immer in der Geste und die Taste tot.
        self.state = SWALLOW
        return [Message({"type": "cancel"})]
