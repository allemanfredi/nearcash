"""Prints the volume (mm³) enclosed by an STL file: the sum of the signed
tetrahedra between the origin and every triangle."""
import struct
import sys

def triangles(path):
    data = open(path, 'rb').read()
    if data[:5] == b'solid' and b'facet' in data[:400]:
        verts = []
        for line in data.decode().splitlines():
            parts = line.split()
            if parts and parts[0] == 'vertex':
                verts.append(tuple(float(c) for c in parts[1:4]))
                if len(verts) == 3:
                    yield verts
                    verts = []
        return
    count = struct.unpack('<I', data[80:84])[0]
    for i in range(count):
        base = 84 + 50 * i + 12
        yield [struct.unpack('<3f', data[base + 12 * k: base + 12 * k + 12]) for k in range(3)]

volume = 0.0
for (ax, ay, az), (bx, by, bz), (cx, cy, cz) in triangles(sys.argv[1]):
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6.0
print(f"{abs(volume):.2f}")
