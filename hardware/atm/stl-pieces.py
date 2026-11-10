"""Prints how many separate pieces an STL file holds: triangles that share a
vertex belong to the same piece. A part that should print as one piece but
holds several has a gap somewhere (check-clearances.sh fails on it)."""
import struct
import sys


def triangles(path):
    data = open(path, 'rb').read()
    if data[:5] == b'solid' and b'facet' in data[:400]:
        verts = []
        for line in data.decode().splitlines():
            parts = line.split()
            if parts and parts[0] == 'vertex':
                verts.append(tuple(round(float(c), 4) for c in parts[1:4]))
                if len(verts) == 3:
                    yield verts
                    verts = []
        return
    count = struct.unpack('<I', data[80:84])[0]
    for i in range(count):
        base = 84 + 50 * i + 12
        yield [tuple(round(c, 4) for c in struct.unpack('<3f', data[base + 12 * k: base + 12 * k + 12])) for k in range(3)]


# Union-find over vertices: two vertices of one triangle are in the same piece.
parent = {}


def root(v):
    while parent.setdefault(v, v) != v:
        parent[v] = parent[parent[v]]
        v = parent[v]
    return v


for a, b, c in triangles(sys.argv[1]):
    parent[root(b)] = root(a)
    parent[root(c)] = root(a)
print(len({root(v) for v in list(parent)}))
