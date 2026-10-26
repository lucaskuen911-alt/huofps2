// Authored binary assets (glTF models). The single-file build embeds them gzip+base64 in
// window.__HL_ASSETS (see tools/build.mjs); a dev server falls back to fetching assets/models/.

const cache = new Map();

export function loadAsset(name) {
  if (!cache.has(name)) cache.set(name, fetchAsset(name));
  return cache.get(name);
}

async function fetchAsset(name) {
  const embedded = typeof window !== 'undefined' && window.__HL_ASSETS && window.__HL_ASSETS[name];
  const isTex = name.startsWith('tex/');
  if (embedded) return isTex ? decodeBase64(embedded).buffer : gunzip(decodeBase64(embedded));
  const res = await fetch(isTex ? `assets/textures/${name.slice(4)}` : `assets/models/${name}`);
  if (!res.ok) throw new Error(`Missing asset ${name} (${res.status})`);
  return res.arrayBuffer();
}

/** Authored texture as an ImageBitmap, or null when the build has none for `name`. */
export async function loadImage(name) {
  const has = typeof window !== 'undefined' && window.__HL_ASSETS && window.__HL_ASSETS[name];
  if (!has || typeof createImageBitmap === 'undefined') return null;
  const buf = await loadAsset(name);
  return createImageBitmap(new Blob([buf], { type: 'image/webp' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
}

function decodeBase64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function gunzip(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot decompress the embedded models (needs DecompressionStream).');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}
