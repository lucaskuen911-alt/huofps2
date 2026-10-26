"""GLB post-processor: KHR_mesh_quantization + vertex dedup + uint16 indices.

  POSITION   float32 x3 -> int16 normalised x3 (+pad), per-mesh bounding box. The dequantising
             scale/offset lives on a new child node that holds the mesh, so authored node
             transforms (pivots, sockets) are untouched.
  NORMAL     float32 x3 -> int8 normalised x3 (+pad)
  TEXCOORD_0 float32 x2 kept (tiling UVs go far outside [0, 1])

Typical saving on hard-surface viewmodels: ~45%. The file stays valid glTF 2.0 (Blender, three.js
and the Khronos validator read KHR_mesh_quantization); the Hairline loader dequantises at load.

Usage: python3 glbpack.py in.glb [out.glb]
"""

import json
import struct
import sys

import numpy as np

COMP = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def read_glb(path):
    d = open(path, 'rb').read()
    assert d[:4] == b'glTF'
    jl = struct.unpack('<I', d[12:16])[0]
    j = json.loads(d[20:20 + jl])
    bin_off = 20 + jl
    bl = struct.unpack('<I', d[bin_off:bin_off + 4])[0]
    return j, d[bin_off + 8:bin_off + 8 + bl]


def accessor(j, b, i):
    a = j['accessors'][i]
    bv = j['bufferViews'][a['bufferView']]
    n = NCOMP[a['type']]
    dt = np.dtype(COMP[a['componentType']])
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride', 0) or dt.itemsize * n
    raw = np.frombuffer(b, np.uint8, a['count'] * stride, off).reshape(a['count'], stride)
    return raw[:, :dt.itemsize * n].copy().view(dt).reshape(a['count'], n)


class Writer:
    def __init__(self):
        self.chunks = []
        self.size = 0
        self.views = []
        self.accessors = []

    def add(self, arr, target=None, stride=None):
        data = np.ascontiguousarray(arr).tobytes()
        pad = (-self.size) % 4
        if pad:
            self.chunks.append(b'\0' * pad)
            self.size += pad
        v = {'buffer': 0, 'byteOffset': self.size, 'byteLength': len(data)}
        if target:
            v['target'] = target
        if stride:
            v['byteStride'] = stride
        self.chunks.append(data)
        self.size += len(data)
        self.views.append(v)
        return len(self.views) - 1

    def accessor(self, view, ctype, count, typ, normalized=False, mn=None, mx=None):
        a = {'bufferView': view, 'componentType': ctype, 'count': int(count), 'type': typ}
        if normalized:
            a['normalized'] = True
        if mn is not None:
            a['min'] = [float(x) for x in mn]
            a['max'] = [float(x) for x in mx]
        self.accessors.append(a)
        return len(self.accessors) - 1


def pack(src, dst=None):
    j, b = read_glb(src)
    w = Writer()
    # Images first (unchanged bytes).
    for img in j.get('images', []):
        bv = j['bufferViews'][img['bufferView']]
        img['bufferView'] = w.add(np.frombuffer(b, np.uint8, bv['byteLength'], bv.get('byteOffset', 0)))
    mesh_q = {}
    for mi, mesh in enumerate(j['meshes']):
        # One bbox for every primitive of the mesh so they share the dequantising transform.
        pos_all = [accessor(j, b, p['attributes']['POSITION']) for p in mesh['primitives']]
        lo = np.min([p.min(0) for p in pos_all], 0)
        hi = np.max([p.max(0) for p in pos_all], 0)
        center = (lo + hi) / 2
        half = np.maximum((hi - lo) / 2, 1e-6)
        s = float(half.max())  # uniform scale keeps normals exact
        mesh_q[mi] = (center, s)
        for p, P in zip(mesh['primitives'], pos_all):
            at = p['attributes']
            N = accessor(j, b, at['NORMAL']).astype(np.float32)
            UV = accessor(j, b, at['TEXCOORD_0']).astype(np.float32) if 'TEXCOORD_0' in at else None
            I = accessor(j, b, p['indices']).ravel().astype(np.int64)
            qp = np.clip(np.round((P - center) / s * 32767), -32767, 32767).astype(np.int16)
            nl = np.linalg.norm(N, axis=1, keepdims=True)
            qn = np.clip(np.round(N / np.maximum(nl, 1e-9) * 127), -127, 127).astype(np.int8)
            # Dedupe identical quantised vertices.
            key = [qp, qn] + ([np.round(UV * 4096).astype(np.int32)] if UV is not None else [])
            packed = np.concatenate([k.reshape(len(P), -1).astype(np.int64) for k in key], 1)
            uniq, inv = np.unique(packed, axis=0, return_inverse=True)
            first = np.zeros(len(uniq), np.int64)
            first[inv[::-1]] = np.arange(len(P))[::-1]
            qp, qn = qp[first], qn[first]
            UV = UV[first] if UV is not None else None
            I = inv.ravel()[I]
            nv = len(qp)
            pos4 = np.zeros((nv, 4), np.int16)
            pos4[:, :3] = qp
            nrm4 = np.zeros((nv, 4), np.int8)
            nrm4[:, :3] = qn
            at.clear()
            at['POSITION'] = w.accessor(w.add(pos4, 34962, 8), 5122, nv, 'VEC3', True, qp.min(0) / 32767.0, qp.max(0) / 32767.0)
            at['NORMAL'] = w.accessor(w.add(nrm4, 34962, 4), 5120, nv, 'VEC3', True)
            if UV is not None:
                at['TEXCOORD_0'] = w.accessor(w.add(UV.astype(np.float32), 34962, 8), 5126, nv, 'VEC2')
            idx = I.astype(np.uint16 if nv < 65536 else np.uint32)
            p['indices'] = w.accessor(w.add(idx, 34963), 5123 if nv < 65536 else 5125, len(idx), 'SCALAR')
    # Move each mesh onto a child node carrying the dequantising transform.
    nodes = j['nodes']
    for ni in range(len(nodes)):
        n = nodes[ni]
        if 'mesh' not in n:
            continue
        mi = n.pop('mesh')
        center, s = mesh_q[mi]
        child = {'name': f"{n.get('name', 'node')}__q", 'mesh': mi, 'translation': [float(c) for c in center], 'scale': [s, s, s]}
        nodes.append(child)
        n.setdefault('children', []).append(len(nodes) - 1)
    j['bufferViews'] = w.views
    j['accessors'] = w.accessors
    j['buffers'] = [{'byteLength': w.size}]
    for key in ('extensionsUsed', 'extensionsRequired'):
        j[key] = sorted(set(j.get(key, [])) | {'KHR_mesh_quantization'})
    out = dst or src
    jb = json.dumps(j, separators=(',', ':')).encode()
    jb += b' ' * ((-len(jb)) % 4)
    bb = b''.join(w.chunks)
    bb += b'\0' * ((-len(bb)) % 4)
    total = 12 + 8 + len(jb) + 8 + len(bb)
    with open(out, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(jb), 0x4E4F534A))
        f.write(jb)
        f.write(struct.pack('<II', len(bb), 0x004E4942))
        f.write(bb)
    return total


if __name__ == '__main__':
    import os
    src = sys.argv[1]
    before = os.path.getsize(src)
    after = pack(src, sys.argv[2] if len(sys.argv) > 2 else None)
    print(f'{src}: {before / 1024:.0f} KB -> {after / 1024:.0f} KB')
