"""Corner taps on a grabbed touchpad: count taps in the four corners, swallow them.

Pure logic without evdev. The daemon grabs the touchpad, groups its events into frames
(everything up to SYN_REPORT) and hands each frame to `TapFilter.frame`. What comes
back is forwarded through the uinput clone, so libinput keeps seeing the touchpad as
before, except for taps that start in a corner:

- A touch that begins with one finger inside a corner zone is held back.
- It becomes a corner tap when it lifts quickly (tap time) without moving (tap move).
  Anything else (it moves, stays, a second finger lands, the pad is clicked) releases
  the held frames at once and the touch goes on as usual.
- Taps in the same corner within the gap time add up. After the gap the count is final:
  if that corner/count is bound, the gesture is reported and the taps are swallowed
  (no click reaches the application). If not, the held taps are replayed late, so a
  plain tap in a corner still clicks, just a gap later.

Corners: "tl", "tr", "bl", "br". Gesture name "<corner><count>", e.g. "tl2".
"""

import math
from dataclasses import dataclass, field

EV_SYN = 0x00
EV_KEY = 0x01
EV_ABS = 0x03
SYN_REPORT = 0

BTN_LEFT = 0x110
ABS_MT_SLOT = 0x2F
ABS_MT_POSITION_X = 0x35
ABS_MT_POSITION_Y = 0x36
ABS_MT_TRACKING_ID = 0x39

CORNERS = ("tl", "tr", "bl", "br")
MAX_TAPS = 4

IDLE = "idle"
HOLD = "hold"  # a touch that started in a corner is held back
WAIT = "wait"  # between taps: counting, held taps waiting for the verdict


@dataclass
class TapSettings:
    enabled: bool = False
    corner_mm: float = 14.0
    tap_time: float = 0.18  # libinput's own tap timeout is about 180 ms
    tap_move_mm: float = 2.5
    gap: float = 0.3  # max pause between taps of one sequence
    # Gesture names that have an action, e.g. {"tl2", "tr3"}. Only corners with at least
    # one bound gesture are held back at all; everything else passes untouched.
    bound: set = field(default_factory=set)


def update_settings(settings, data):
    rejected = []
    for key, value in data.items():
        if key == "enabled" and isinstance(value, bool):
            settings.enabled = value
        elif key == "corner_mm" and _num(value, 4, 40):
            settings.corner_mm = float(value)
        elif key == "bound" and isinstance(value, list) and all(_valid_name(v) for v in value):
            settings.bound = set(value)
        else:
            rejected.append(key)
    return rejected


def _num(v, lo, hi):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and lo <= v <= hi


def _valid_name(v):
    return isinstance(v, str) and len(v) == 3 and v[:2] in CORNERS and v[2] in "1234"


@dataclass
class Axis:
    minimum: int
    maximum: int
    resolution: int  # units per mm

    def mm(self, value):
        return (value - self.minimum) / (self.resolution or 1)

    @property
    def size_mm(self):
        return (self.maximum - self.minimum) / (self.resolution or 1)


class TapFilter:
    def __init__(self, settings, ax, ay):
        self.settings = settings
        self.ax = ax
        self.ay = ay
        self.passthrough = False
        self._slot = 0
        self._out_slot = 0  # the slot libinput believes is current (see _emit)
        self._slots = {}  # slot -> [x, y, active]
        self.state = IDLE
        self._held = []  # frames of the current touch (HOLD)
        self._taps = []  # frames of finished taps in this sequence (WAIT and HOLD)
        self._count = 0
        self._corner = ""
        self._start = (0.0, 0.0)
        self._since = 0.0
        self._deadline = None

    # ------------------------------------------------------------- public

    def set_passthrough(self, active):
        self.passthrough = active
        return self._emit(self._release_all()) if active else []

    def frame(self, now, events):
        """One frame (events without the SYN_REPORT). Returns (frames, messages)."""
        frames, msgs = self._frame(now, events)
        return self._emit(frames), msgs

    def _emit(self, frames):
        """Keep ABS_MT_SLOT consistent for libinput.

        The kernel sends ABS_MT_SLOT only when the slot changes. A swallowed frame may have
        carried that change, so a later frame would land on the wrong finger. Each frame
        knows the slot it started in; when libinput believes another one, prepend it.
        """
        out = []
        for start_slot, events in frames:
            events = list(events)
            first_mt = next((c for t, c, _ in events if t == EV_ABS and ABS_MT_SLOT <= c <= 0x3D), None)
            if first_mt is not None and first_mt != ABS_MT_SLOT and start_slot != self._out_slot:
                events.insert(0, (EV_ABS, ABS_MT_SLOT, start_slot))
                self._out_slot = start_slot
            for t, c, v in events:
                if t == EV_ABS and c == ABS_MT_SLOT:
                    self._out_slot = v
            out.append(events)
        return out

    def _frame(self, now, events):
        start_slot = self._slot
        entry = (start_slot, events)
        before = self._contacts()
        new_contact = False
        clicked = False
        for etype, code, value in events:
            if etype == EV_ABS:
                if code == ABS_MT_SLOT:
                    self._slot = value
                elif code == ABS_MT_TRACKING_ID:
                    s = self._slots.setdefault(self._slot, [0, 0, False])
                    if value >= 0 and not s[2]:
                        new_contact = True
                    s[2] = value >= 0
                elif code == ABS_MT_POSITION_X:
                    self._slots.setdefault(self._slot, [0, 0, False])[0] = value
                elif code == ABS_MT_POSITION_Y:
                    self._slots.setdefault(self._slot, [0, 0, False])[1] = value
            elif etype == EV_KEY and code == BTN_LEFT and value:
                clicked = True
        after = self._contacts()

        frames, msgs = [], []
        if self.state == WAIT and not new_contact and not clicked and after == 0:
            # Trailing frames between taps (timestamps, tool bits) stay with the held
            # taps, so a replay keeps the original order.
            self._taps.append(entry)
            return frames, msgs
        if self.state == WAIT:
            starts_tap = new_contact and before == 0 and after == 1 and \
                self._corner_of(self._only_point()) == self._corner and self._count < MAX_TAPS
            if starts_tap:
                self._begin_hold(now, entry)
                return frames, msgs
            f, m = self._finalize()
            frames += f
            msgs += m
        if self.state == HOLD:
            self._held.append(entry)
            if clicked or after > 1 or now - self._since > self.settings.tap_time or self._moved():
                frames += self._release_all()
            elif after == 0:
                self._count += 1
                self._taps.extend(self._held)
                self._held = []
                self.state = WAIT
                self._deadline = now + self.settings.gap
                if self._count >= MAX_TAPS:
                    f, m = self._finalize()
                    frames += f
                    msgs += m
            return frames, msgs
        # IDLE
        if self._active() and new_contact and before == 0 and after == 1 and not clicked:
            corner = self._corner_of(self._only_point())
            if corner and self._corner_bound(corner):
                self._corner = corner
                self._count = 0
                self._begin_hold(now, entry)
                return frames, msgs
        frames.append(entry)
        return frames, msgs

    def tick(self, now):
        """Timeouts: a held touch that stays too long, the end of a tap sequence."""
        if self.state == HOLD and now - self._since > self.settings.tap_time:
            return self._emit(self._release_all()), []
        if self.state == WAIT and self._deadline is not None and now >= self._deadline:
            frames, msgs = self._finalize()
            return self._emit(frames), msgs
        return [], []

    def deadline(self):
        if self.state == HOLD:
            return self._since + self.settings.tap_time
        if self.state == WAIT:
            return self._deadline
        return None

    def reset(self):
        """SYN_DROPPED: forget positions; whatever is held goes out as it came."""
        frames = self._emit(self._release_all())
        self._slots = {}
        return frames

    # ------------------------------------------------------------ internals

    def _active(self):
        return self.settings.enabled and not self.passthrough and bool(self.settings.bound)

    def _corner_bound(self, corner):
        return any(name.startswith(corner) for name in self.settings.bound)

    def _contacts(self):
        return sum(1 for s in self._slots.values() if s[2])

    def _only_point(self):
        for s in self._slots.values():
            if s[2]:
                return (s[0], s[1])
        return None

    def _corner_of(self, point):
        if point is None:
            return ""
        x, y = self.ax.mm(point[0]), self.ay.mm(point[1])
        c = self.settings.corner_mm
        left, right = x <= c, x >= self.ax.size_mm - c
        top, bottom = y <= c, y >= self.ay.size_mm - c
        if top and left:
            return "tl"
        if top and right:
            return "tr"
        if bottom and left:
            return "bl"
        if bottom and right:
            return "br"
        return ""

    def _begin_hold(self, now, entry):
        self.state = HOLD
        self._held = [entry]
        self._since = now
        p = self._only_point()
        self._start = (self.ax.mm(p[0]), self.ay.mm(p[1]))
        self._deadline = None

    def _moved(self):
        p = self._only_point()
        if p is None:
            return False
        return math.hypot(self.ax.mm(p[0]) - self._start[0],
                          self.ay.mm(p[1]) - self._start[1]) > self.settings.tap_move_mm

    def _release_all(self):
        """Everything held goes out in order; the touch continues as a normal one."""
        frames = self._taps + self._held
        self._taps, self._held = [], []
        self._count = 0
        self.state = IDLE
        self._deadline = None
        return frames

    def _finalize(self):
        name = f"{self._corner}{self._count}"
        if self._count and name in self.settings.bound:
            self._taps, self._held = [], []
            self._count = 0
            self.state = IDLE
            self._deadline = None
            return [], [{"type": "end", "source": "tap", "corner": name[:2],
                         "count": int(name[2]), "gesture": name}]
        # Not bound: the taps were ordinary taps after all, replay them (late).
        return self._release_all(), []
