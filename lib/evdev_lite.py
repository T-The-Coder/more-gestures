"""The part of python-evdev the daemon uses, in plain Python (ioctl and struct).

Omarchy ships Python but not python-evdev, so the daemon talks to the kernel itself:
open /dev/input/event*, read its capabilities, grab it, read its events, and clone it
through /dev/uinput. The names mirror python-evdev (InputDevice, UInput.from_device,
absinfo, input_props ...), so bin/gesture-daemon reads the same as before.

Numbers come from linux/input.h and linux/uinput.h; the ioctl request layout (_IOC) is
the generic one used by x86, ARM and RISC-V.
"""

import collections
import fcntl
import glob
import os
import struct

EV_SYN, EV_KEY, EV_REL, EV_ABS, EV_MSC, EV_SW = 0x00, 0x01, 0x02, 0x03, 0x04, 0x05
EV_LED, EV_SND, EV_REP, EV_FF = 0x11, 0x12, 0x14, 0x15
EV_MAX = 0x1F
SYN_REPORT, SYN_DROPPED = 0, 3
INPUT_PROP_POINTING_STICK = 0x05
INPUT_PROP_MAX = 0x1F

# struct input_event: struct timeval (two native longs), __u16 type, __u16 code, __s32 value.
EVENT = struct.Struct("@llHHi")
# struct input_absinfo: value, minimum, maximum, fuzz, flat, resolution (all __s32).
ABSINFO = struct.Struct("@6i")

# Highest code per event type (KEY_MAX, REL_MAX ...), for the size of the bit arrays.
_MAX_CODE = {EV_KEY: 0x2FF, EV_REL: 0x0F, EV_ABS: 0x3F, EV_MSC: 0x07, EV_SW: 0x11,
             EV_LED: 0x0F, EV_SND: 0x07, EV_REP: 0x01, EV_FF: 0x7F}

_IOC_NONE, _IOC_WRITE, _IOC_READ = 0, 1, 2


def _ioc(direction, kind, nr, size):
    return (direction << 30) | (size << 16) | (ord(kind) << 8) | nr


def EVIOCGNAME(length):
    return _ioc(_IOC_READ, "E", 0x06, length)


def EVIOCGPROP(length):
    return _ioc(_IOC_READ, "E", 0x09, length)


def EVIOCGBIT(ev_type, length):
    return _ioc(_IOC_READ, "E", 0x20 + ev_type, length)


def EVIOCGABS(code):
    return _ioc(_IOC_READ, "E", 0x40 + code, ABSINFO.size)


EVIOCGID = _ioc(_IOC_READ, "E", 0x02, 8)
EVIOCGRAB = _ioc(_IOC_WRITE, "E", 0x90, 4)

UI_DEV_CREATE = _ioc(_IOC_NONE, "U", 1, 0)
UI_DEV_DESTROY = _ioc(_IOC_NONE, "U", 2, 0)
# struct uinput_setup: struct input_id (4 x __u16), char name[80], __u32 ff_effects_max.
UINPUT_SETUP = struct.Struct("@4H80sI")
UI_DEV_SETUP = _ioc(_IOC_WRITE, "U", 3, UINPUT_SETUP.size)
# struct uinput_abs_setup: __u16 code, (padding), struct input_absinfo.
UINPUT_ABS_SETUP = struct.Struct("@H2x6i")
UI_ABS_SETUP = _ioc(_IOC_WRITE, "U", 4, UINPUT_ABS_SETUP.size)
UI_SET_EVBIT = _ioc(_IOC_WRITE, "U", 100, 4)
UI_SET_PROPBIT = _ioc(_IOC_WRITE, "U", 110, 4)
_UI_SET_BIT = {EV_KEY: 101, EV_REL: 102, EV_ABS: 103, EV_MSC: 104, EV_LED: 105,
               EV_SND: 106, EV_FF: 107, EV_SW: 109}

UINPUT_PATH = "/dev/uinput"
NAME_MAX = 79  # uinput names hold 80 bytes with the terminating zero

DeviceInfo = collections.namedtuple("DeviceInfo", "bustype vendor product version")
AbsInfo = collections.namedtuple("AbsInfo", "value min max fuzz flat resolution")
InputEvent = collections.namedtuple("InputEvent", "sec usec type code value")


def list_devices(pattern="/dev/input/event*"):
    return sorted(glob.glob(pattern))


def _bits(buf):
    """Indices of the set bits in a kernel bit array."""
    return [i * 8 + b for i, byte in enumerate(buf) for b in range(8) if byte >> b & 1]


def _read_bits(fd, request, nbytes):
    buf = bytearray(nbytes)
    fcntl.ioctl(fd, request, buf)
    return _bits(buf)


def parse_events(data):
    """Splits what read() returned into InputEvents (whole events only)."""
    usable = len(data) - len(data) % EVENT.size
    return [InputEvent(*EVENT.unpack_from(data, i)) for i in range(0, usable, EVENT.size)]


class InputDevice:
    """An event device, opened read only and non-blocking."""

    def __init__(self, path):
        self.path = path
        self.fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_CLOEXEC)
        try:
            buf = bytearray(256)
            fcntl.ioctl(self.fd, EVIOCGNAME(len(buf)), buf)
            self.name = bytes(buf).split(b"\0", 1)[0].decode("utf-8", "replace")
            ids = bytearray(8)
            fcntl.ioctl(self.fd, EVIOCGID, ids)
            self.info = DeviceInfo(*struct.unpack("@4H", ids))
        except OSError:
            os.close(self.fd)
            raise

    def capabilities(self):
        """{event type: [codes]} without EV_SYN and EV_REP, like python-evdev with
        absinfo=False."""
        caps = {}
        for ev_type in _read_bits(self.fd, EVIOCGBIT(0, (EV_MAX + 8) // 8), (EV_MAX + 8) // 8):
            # EV_REP is left out as python-evdev does: the kernel has no code bits for it
            # (EVIOCGBIT says EINVAL), and on a clone it would make the kernel repeat
            # held keys on top of the repeats forwarded from the original.
            if ev_type in (EV_SYN, EV_REP) or ev_type not in _MAX_CODE:
                continue
            nbytes = _MAX_CODE[ev_type] // 8 + 1
            caps[ev_type] = _read_bits(self.fd, EVIOCGBIT(ev_type, nbytes), nbytes)
        return caps

    def input_props(self):
        nbytes = INPUT_PROP_MAX // 8 + 1
        try:
            return _read_bits(self.fd, EVIOCGPROP(nbytes), nbytes)
        except OSError:
            return []

    def absinfo(self, code):
        buf = bytearray(ABSINFO.size)
        fcntl.ioctl(self.fd, EVIOCGABS(code), buf)
        return AbsInfo(*ABSINFO.unpack(buf))

    def grab(self):
        fcntl.ioctl(self.fd, EVIOCGRAB, 1)

    def ungrab(self):
        fcntl.ioctl(self.fd, EVIOCGRAB, 0)

    def read(self):
        """The events waiting now; BlockingIOError when there are none (as python-evdev)."""
        return parse_events(os.read(self.fd, EVENT.size * 64))

    def close(self):
        if self.fd is not None:
            fd, self.fd = self.fd, None
            os.close(fd)


class UInput:
    """A virtual input device. from_device() copies a real one: capabilities, axes,
    input props and ids, so libinput and hwdb treat the clone as the original."""

    def __init__(self, caps, name, input_props=(), absinfo=None,
                 bustype=0x06, vendor=0, product=0, version=0):
        self.fd = os.open(UINPUT_PATH, os.O_WRONLY | os.O_NONBLOCK | os.O_CLOEXEC)
        try:
            for ev_type, codes in caps.items():
                if ev_type in (EV_SYN, EV_FF):
                    continue
                fcntl.ioctl(self.fd, UI_SET_EVBIT, ev_type)
                setter = _UI_SET_BIT.get(ev_type)
                if setter is None:
                    continue  # EV_REP: the kernel repeats by itself
                for code in codes:
                    fcntl.ioctl(self.fd, _ioc(_IOC_WRITE, "U", setter, 4), code)
            for prop in input_props:
                fcntl.ioctl(self.fd, UI_SET_PROPBIT, prop)
            for code, info in (absinfo or {}).items():
                fcntl.ioctl(self.fd, UI_ABS_SETUP, UINPUT_ABS_SETUP.pack(code, *info))
            raw = name.encode("utf-8")[:NAME_MAX]
            fcntl.ioctl(self.fd, UI_DEV_SETUP,
                        UINPUT_SETUP.pack(bustype, vendor, product, version, raw, 0))
            fcntl.ioctl(self.fd, UI_DEV_CREATE)
        except OSError:
            os.close(self.fd)
            raise

    @classmethod
    def from_device(cls, dev, name, input_props=None, vendor=None, product=None,
                    version=None, bustype=None):
        caps = dev.capabilities()
        absinfo = {code: dev.absinfo(code) for code in caps.get(EV_ABS, ())}
        info = dev.info
        return cls(caps, name,
                   input_props=dev.input_props() if input_props is None else input_props,
                   absinfo=absinfo,
                   bustype=info.bustype if bustype is None else bustype,
                   vendor=info.vendor if vendor is None else vendor,
                   product=info.product if product is None else product,
                   version=info.version if version is None else version)

    def write(self, ev_type, code, value):
        os.write(self.fd, EVENT.pack(0, 0, ev_type, code, value))

    def syn(self):
        self.write(EV_SYN, SYN_REPORT, 0)

    def close(self):
        if self.fd is not None:
            fd, self.fd = self.fd, None
            try:
                fcntl.ioctl(fd, UI_DEV_DESTROY)
            finally:
                os.close(fd)


def access():
    """What the daemon may do here: read input devices, create uinput devices.

    Reading is tested on every event device (one readable one is enough: a keyboard
    alone would not do, but a system without any readable device cannot work);
    uinput by opening it for writing, which is what creating a clone needs.
    """
    devices = list_devices()
    readable = any(os.access(p, os.R_OK) for p in devices)
    try:
        os.close(os.open(UINPUT_PATH, os.O_WRONLY | os.O_NONBLOCK | os.O_CLOEXEC))
        uinput = True
    except OSError:
        uinput = False
    return {"devices": len(devices), "input": readable, "uinput": uinput}
