"""Writes a tiny valid uncompressed 16-bit Bayer DNG (no numpy) for the Android RAW test."""
import struct, sys, math
W, H = 96, 64
pix = bytearray()
for y in range(H):
    for x in range(W):
        # smooth colour gradient + a bright disc, RGGB mosaic
        r, g, b = x / W, y / H, 0.5 + 0.5 * math.sin((x + y) / 9)
        if (x - W / 2) ** 2 + (y - H / 2) ** 2 < 14 ** 2: r, g, b = 0.9, 0.85, 0.7
        c = (r, g, b)[[0, 1, 1, 2][(y % 2) * 2 + (x % 2)]]
        pix += struct.pack('<H', int(200 + c * 3800))
ifd_entries = []  # (tag, type, count, value-bytes or int)
def rat(n, d=1000): return struct.pack('<ii', n, d)
extra = bytearray()
def add_extra(b):
    off = len(extra); extra.extend(b); return off
cm = b''.join(rat(v) for v in (1000, 0, 0, 0, 1000, 0, 0, 0, 1000))
neutral = b''.join(struct.pack('<II', n, 1000) for n in (1000, 1000, 1000))
model = b'Chromasmith Synthetic\0'
E = [
 (254, 4, 1, 0), (256, 4, 1, W), (257, 4, 1, H), (258, 3, 1, 16), (259, 3, 1, 1), (262, 3, 1, 32803),
 (273, 4, 1, 'STRIP'), (277, 3, 1, 1), (278, 4, 1, H), (279, 4, 1, len(pix)),
 (33421, 3, 2, 2 | (2 << 16)), (33422, 1, 4, bytes([0, 1, 1, 2])),
 (50706, 1, 4, bytes([1, 4, 0, 0])), (50707, 1, 4, bytes([1, 1, 0, 0])),
 (50708, 2, len(model), model), (50721, 10, 9, cm), (50728, 5, 3, neutral),
 (50714, 3, 1, 0), (50717, 3, 1, 4095 + 200),
]
E.sort(key=lambda e: e[0])
n = len(E); ifd_off = 8; ifd_size = 2 + n * 12 + 4
data_off = ifd_off + ifd_size
strip_off = data_off  # pixel strip first, then out-of-line values
extra_base = strip_off + len(pix)
out = bytearray(b'II*\0' + struct.pack('<I', ifd_off)); body = struct.pack('<H', n); ext = bytearray()
for tag, typ, cnt, val in E:
    size = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 10: 8}[typ] * cnt
    if val == 'STRIP': v = struct.pack('<I', strip_off)
    elif isinstance(val, int): v = struct.pack('<I', val) if typ in (4, 3) and size <= 4 else None
    else: v = None
    if isinstance(val, (bytes, bytearray)):
        if size <= 4: v = bytes(val).ljust(4, b'\0')
        else: v = struct.pack('<I', extra_base + len(ext)); ext += val + (b'\0' if len(val) % 2 else b'')
    body += struct.pack('<HHI', tag, typ, cnt) + v
body += struct.pack('<I', 0)
out += body + pix + ext
open(sys.argv[1], 'wb').write(out)
print('wrote', sys.argv[1], len(out), 'bytes')
