// glTF 2.0 binary (.glb) loader for authored assets (art/*.py -> assets/models/*.glb).
//
// Converts what the engine needs and nothing more:
//   - meshes -> the engine's interleaved vertex format (pos3 nrm3 uv2 col4), so authored meshes
//     go through the same mesh upload, shadow pass, light baker and culling as procedural ones
//   - KHR_mesh_quantization (int16 positions, int8 normals) is dequantised on load
//   - node hierarchy is flattened: part(name) returns every mesh under that node expressed in
//     the node's own frame (pivots stay authored), socket(name) returns a node origin
//   - materials: base colour / metal-roughness / normal / emissive, textures decoded once
//     (WebP via EXT_texture_webp, PNG, JPEG) and uploaded lazily per GL context
//
// Coordinate system: glTF is +Y up, -Z forward, metres — identical to the engine.

import { VERTEX_FLOATS } from './gl/GLUtil.js';
import { mat4, multiply, transformPoint, transformDir } from './gl/Mat4.js';

const TYPE_N = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const CTYPE = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NORM = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

export class GltfAsset {
  constructor(json, bin, images) {
    this.json = json;
    this.bin = bin;
    this.images = images; // ImageBitmap | null per image index
    this.byName = new Map();
    this.world = [];
    this.parent = [];
    const nodes = json.nodes || [];
    nodes.forEach((n, i) => {
      if (n.name) this.byName.set(n.name, i);
      this.parent[i] = -1;
    });
    nodes.forEach((n, i) => (n.children || []).forEach((c) => (this.parent[c] = i)));
    this.local = nodes.map((n) => nodeMatrix(n));
    for (let i = 0; i < nodes.length; i++) this.world[i] = this.worldOf(i);
    this.materials = (json.materials || []).map((m, i) => parseMaterial(m, i));
    this.textures = new Map(); // per GL context
  }

  worldOf(i) {
    if (this.world[i]) return this.world[i];
    const p = this.parent[i];
    const w = p < 0 ? this.local[i] : multiply(mat4(), this.worldOf(p), this.local[i]);
    this.world[i] = w;
    return w;
  }

  has(name) {
    return this.byName.has(name);
  }

  names(prefix = '') {
    return [...this.byName.keys()].filter((n) => n.startsWith(prefix));
  }

  /** Origin of a node in scene coordinates (sockets, pivots). */
  socket(name) {
    const i = this.byName.get(name);
    if (i === undefined) throw new Error(`glTF: no node '${name}'`);
    const w = this.world[i];
    return [w[12], w[13], w[14]];
  }

  /** Node origin relative to its parent (e.g. a magazine pivot inside its weapon group). */
  localOrigin(name) {
    const i = this.byName.get(name);
    const m = this.local[i];
    return [m[12], m[13], m[14]];
  }

  /**
   * Every primitive under node `name`, in the node's frame (or scene frame with world=true),
   * grouped by material: [{ vertices, indices, material, min, max }].
   * `offset` translates the result (attachments placed at a socket).
   */
  part(name, { world = false, offset = null, color = null } = {}) {
    const root = this.byName.get(name);
    if (root === undefined) throw new Error(`glTF: no node '${name}'`);
    const inv = world ? null : invertAffine(this.world[root]);
    const groups = new Map();
    const visit = (i) => {
      const n = this.json.nodes[i];
      if (n.mesh !== undefined) {
        const m = inv ? multiply(mat4(), inv, this.world[i]) : this.world[i];
        if (offset) { m[12] += offset[0]; m[13] += offset[1]; m[14] += offset[2]; }
        for (const prim of this.json.meshes[n.mesh].primitives) this.appendPrimitive(prim, m, groups, color);
      }
      for (const c of n.children || []) visit(c);
    };
    visit(root);
    return [...groups.values()].map((g) => finishGroup(g));
  }

  appendPrimitive(prim, m, groups, color) {
    const at = prim.attributes;
    const P = this.accessor(at.POSITION);
    const N = at.NORMAL !== undefined ? this.accessor(at.NORMAL) : null;
    const UV = at.TEXCOORD_0 !== undefined ? this.accessor(at.TEXCOORD_0) : null;
    const I = prim.indices !== undefined ? this.accessor(prim.indices) : null;
    const matIndex = prim.material ?? -1;
    let g = groups.get(matIndex);
    if (!g) {
      g = { material: matIndex >= 0 ? this.materials[matIndex] : DEFAULT_MATERIAL, v: [], i: [], count: 0 };
      groups.set(matIndex, g);
    }
    const n = P.count;
    const out = new Float32Array(n * VERTEX_FLOATS);
    const tp = [0, 0, 0], tn = [0, 0, 0];
    const col = color || [1, 1, 1, 1];
    for (let k = 0; k < n; k++) {
      transformPoint(m, P.get(k, 0), P.get(k, 1), P.get(k, 2), tp);
      let nx = 0, ny = 1, nz = 0;
      if (N) {
        transformDir(m, N.get(k, 0), N.get(k, 1), N.get(k, 2), tn);
        const l = Math.hypot(tn[0], tn[1], tn[2]) || 1;
        nx = tn[0] / l; ny = tn[1] / l; nz = tn[2] / l;
      }
      const o = k * VERTEX_FLOATS;
      out[o] = tp[0]; out[o + 1] = tp[1]; out[o + 2] = tp[2];
      out[o + 3] = nx; out[o + 4] = ny; out[o + 5] = nz;
      out[o + 6] = UV ? UV.get(k, 0) : 0;
      out[o + 7] = UV ? UV.get(k, 1) : 0;
      out[o + 8] = col[0]; out[o + 9] = col[1]; out[o + 10] = col[2]; out[o + 11] = col[3];
    }
    // Negative-determinant transforms flip winding.
    const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
    const idx = I ? Uint32Array.from({ length: I.count }, (_, k) => I.get(k, 0)) : Uint32Array.from({ length: n }, (_, k) => k);
    if (det < 0) for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
    g.v.push(out);
    g.i.push({ idx, base: g.count });
    g.count += n;
  }

  accessor(index) {
    const a = this.json.accessors[index];
    const bv = this.json.bufferViews[a.bufferView];
    const C = CTYPE[a.componentType];
    const nc = TYPE_N[a.type];
    const stride = (bv.byteStride || C.BYTES_PER_ELEMENT * nc) / C.BYTES_PER_ELEMENT;
    const off = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const len = (a.count - 1) * stride + nc;
    const arr = new C(this.bin.buffer, this.bin.byteOffset + off, len);
    const scale = a.normalized ? 1 / NORM[a.componentType] : 1;
    return {
      count: a.count,
      get: a.normalized ? (k, c) => Math.max(-1, arr[k * stride + c] * scale) : (k, c) => arr[k * stride + c],
    };
  }

  /** GL texture for an image index (sRGB for colour data), uploaded once per context. */
  texture(gl, imageIndex, srgb, aniso) {
    const key = `${imageIndex}:${srgb ? 's' : 'l'}`;
    let t = this.textures.get(key);
    if (t) return t;
    const img = this.images[imageIndex];
    t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    this.textures.set(key, t);
    return t;
  }

  /** Image index behind a glTF textureInfo (handles EXT_texture_webp sources). */
  imageOf(texInfo) {
    if (!texInfo) return -1;
    const tex = this.json.textures[texInfo.index];
    const webp = tex.extensions && tex.extensions.EXT_texture_webp;
    return webp ? webp.source : tex.source ?? -1;
  }
}

const DEFAULT_MATERIAL = { name: 'default', index: -1, baseColor: [1, 1, 1, 1], metallic: 0, roughness: 0.6, emissive: [0, 0, 0], base: null, mr: null, normal: null, emissiveTex: null };

function parseMaterial(m, index) {
  const pbr = m.pbrMetallicRoughness || {};
  const strength = (m.extensions && m.extensions.KHR_materials_emissive_strength && m.extensions.KHR_materials_emissive_strength.emissiveStrength) || 1;
  const e = m.emissiveFactor || [0, 0, 0];
  return {
    name: m.name || `mat${index}`,
    index,
    baseColor: pbr.baseColorFactor || [1, 1, 1, 1],
    metallic: pbr.metallicFactor ?? 1,
    roughness: pbr.roughnessFactor ?? 1,
    emissive: [e[0] * strength, e[1] * strength, e[2] * strength],
    base: pbr.baseColorTexture || null,
    mr: pbr.metallicRoughnessTexture || null,
    normal: m.normalTexture || null,
    emissiveTex: m.emissiveTexture || null,
  };
}

function finishGroup(g) {
  const vertices = new Float32Array(g.count * VERTEX_FLOATS);
  let o = 0;
  for (const v of g.v) { vertices.set(v, o); o += v.length; }
  const total = g.i.reduce((s, x) => s + x.idx.length, 0);
  const indices = new Uint32Array(total);
  let p = 0;
  for (const { idx, base } of g.i) { for (let k = 0; k < idx.length; k++) indices[p++] = idx[k] + base; }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < vertices.length; k += VERTEX_FLOATS) {
    for (let c = 0; c < 3; c++) {
      if (vertices[k + c] < min[c]) min[c] = vertices[k + c];
      if (vertices[k + c] > max[c]) max[c] = vertices[k + c];
    }
  }
  return { vertices, indices, material: g.material, min, max };
}

function nodeMatrix(n) {
  if (n.matrix) return Float32Array.from(n.matrix);
  const t = n.translation || [0, 0, 0];
  const r = n.rotation || [0, 0, 0, 1];
  const s = n.scale || [1, 1, 1];
  const [x, y, z, w] = r;
  const m = mat4();
  m[0] = (1 - 2 * (y * y + z * z)) * s[0]; m[1] = 2 * (x * y + z * w) * s[0]; m[2] = 2 * (x * z - y * w) * s[0];
  m[4] = 2 * (x * y - z * w) * s[1]; m[5] = (1 - 2 * (x * x + z * z)) * s[1]; m[6] = 2 * (y * z + x * w) * s[1];
  m[8] = 2 * (x * z + y * w) * s[2]; m[9] = 2 * (y * z - x * w) * s[2]; m[10] = (1 - 2 * (x * x + y * y)) * s[2];
  m[12] = t[0]; m[13] = t[1]; m[14] = t[2];
  return m;
}

function invertAffine(m) {
  const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const id = 1 / det;
  const o = mat4();
  o[0] = A * id; o[1] = -(b * i - c * h) * id; o[2] = (b * f - c * e) * id;
  o[4] = B * id; o[5] = (a * i - c * g) * id; o[6] = -(a * f - c * d) * id;
  o[8] = C * id; o[9] = -(a * h - b * g) * id; o[10] = (a * e - b * d) * id;
  o[12] = -(m[12] * o[0] + m[13] * o[4] + m[14] * o[8]);
  o[13] = -(m[12] * o[1] + m[13] * o[5] + m[14] * o[9]);
  o[14] = -(m[12] * o[2] + m[13] * o[6] + m[14] * o[10]);
  return o;
}

/** Parse a .glb ArrayBuffer; decodes embedded images. */
export async function loadGlb(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('glTF: not a .glb file');
  let off = 12;
  let json = null, bin = null;
  while (off < arrayBuffer.byteLength) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    const body = new Uint8Array(arrayBuffer, off + 8, len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(body));
    else if (type === 0x004e4942) bin = body;
    off += 8 + len;
  }
  const images = await Promise.all(
    (json.images || []).map(async (im) => {
      if (im.bufferView === undefined || typeof createImageBitmap === 'undefined') return null;
      const bv = json.bufferViews[im.bufferView];
      const bytes = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
      const blob = new Blob([bytes], { type: im.mimeType || 'image/png' });
      return createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    }),
  );
  return new GltfAsset(json, bin, images);
}

