"""最小的 MessagePack 编码(只编码,不解码):dict / list / tuple / str / bytes / int / float / bool / None。
Fish Audio 的 /v1/tts 吃 msgpack(参考音频是字节,放 JSON 里要 base64 大一圈),不为这一处加依赖。"""

import struct
from typing import Any


def packb(obj: Any) -> bytes:
    out = bytearray()
    _pack(obj, out)
    return bytes(out)


def _pack(obj: Any, out: bytearray) -> None:
    if obj is None:
        out.append(0xC0)
    elif obj is True:
        out.append(0xC3)
    elif obj is False:
        out.append(0xC2)
    elif isinstance(obj, int):
        _pack_int(obj, out)
    elif isinstance(obj, float):
        out += b"\xcb" + struct.pack(">d", obj)
    elif isinstance(obj, str):
        data = obj.encode("utf-8")
        n = len(data)
        if n < 32:
            out.append(0xA0 | n)
        elif n < 0x100:
            out += b"\xd9" + bytes([n])
        elif n < 0x10000:
            out += b"\xda" + struct.pack(">H", n)
        else:
            out += b"\xdb" + struct.pack(">I", n)
        out += data
    elif isinstance(obj, (bytes, bytearray, memoryview)):
        data = bytes(obj)
        n = len(data)
        if n < 0x100:
            out += b"\xc4" + bytes([n])
        elif n < 0x10000:
            out += b"\xc5" + struct.pack(">H", n)
        else:
            out += b"\xc6" + struct.pack(">I", n)
        out += data
    elif isinstance(obj, (list, tuple)):
        _pack_header(len(obj), 0x90, 0xDC, 0xDD, out)
        for item in obj:
            _pack(item, out)
    elif isinstance(obj, dict):
        _pack_header(len(obj), 0x80, 0xDE, 0xDF, out)
        for k, v in obj.items():
            _pack(k, out)
            _pack(v, out)
    else:
        raise TypeError(f"msgpack 编不了 {type(obj).__name__}")


def _pack_header(n: int, fix: int, code16: int, code32: int, out: bytearray) -> None:
    if n < 16:
        out.append(fix | n)
    elif n < 0x10000:
        out += bytes([code16]) + struct.pack(">H", n)
    else:
        out += bytes([code32]) + struct.pack(">I", n)


def _pack_int(v: int, out: bytearray) -> None:
    if v >= 0:
        if v < 0x80:
            out.append(v)
        elif v < 0x100:
            out += b"\xcc" + bytes([v])
        elif v < 0x10000:
            out += b"\xcd" + struct.pack(">H", v)
        elif v < 0x100000000:
            out += b"\xce" + struct.pack(">I", v)
        elif v < 0x10000000000000000:
            out += b"\xcf" + struct.pack(">Q", v)
        else:
            raise OverflowError("整数太大")
    else:
        if v >= -32:
            out += struct.pack(">b", v)
        elif v >= -0x80:
            out += b"\xd0" + struct.pack(">b", v)
        elif v >= -0x8000:
            out += b"\xd1" + struct.pack(">h", v)
        elif v >= -0x80000000:
            out += b"\xd2" + struct.pack(">i", v)
        elif v >= -0x8000000000000000:
            out += b"\xd3" + struct.pack(">q", v)
        else:
            raise OverflowError("整数太大")
