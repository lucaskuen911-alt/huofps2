// GLSL ES 3.00 shader sources.
//
// Lighting model ("stylized PBR-lite", one exposure for every pass):
//   sun      : wrapped Lambert x sun colour x shadow, where shadow = STATIC map (whole level,
//              rendered once at load: brushes + baked props) x DYNAMIC map (characters, crane
//              stacks, around the camera). Crisp, stable shadows everywhere.
//   ambient  : baked per-vertex sky + one-bounce irradiance (level) or hemisphere x probe (dynamic)
//   grade    : filmic curve, saturation lift, cool shadows / warm highlights, height-weighted fog
// Authored assets add GGX specular, edge highlights on bevels (screen-space normal change) and a
// sky rim on dynamic objects so silhouettes read against any background.
// No per-pixel dynamic lights except the muzzle flash (a uniform; no permutations).

const HEADER = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
`;

const GRADE = `
uniform float uExposure;
vec3 tonemap(vec3 c) {
  c *= uExposure;
  // Narkowicz ACES fit, then a saturation lift so painted colour zones stay vivid.
  c = clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, 1.16);
  // Split tone: lift shadows toward teal, highlights toward warm.
  c += (vec3(-0.012, 0.004, 0.018) * (1.0 - l) + vec3(0.014, 0.004, -0.012) * l) * 0.8;
  return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
}
`;

const FOG = `
uniform vec3 uFogColor;
uniform float uFogDensity;
vec3 applyFog(vec3 c, vec3 world, vec3 cam) {
  float d = length(world - cam);
  // Denser near the ground: harbour haze pools low, the skyline stays readable.
  float h = clamp(1.0 - (world.y + 2.0) / 30.0, 0.25, 1.0);
  return mix(c, uFogColor, 1.0 - exp(-uFogDensity * d * h));
}
`;

const SHADOW_FN = `
uniform sampler2DShadow uShadow;
uniform float uShadowOn;
uniform sampler2DShadow uSShadow;
uniform mat4 uSShadowMat;
uniform vec2 uSShadowParams;   // x: on, y: texel size (uv)
float pcf4(sampler2DShadow s, vec3 p, float t, float bias) {
  float r = texture(s, vec3(p.xy + vec2(-t, -t), p.z - bias));
  r += texture(s, vec3(p.xy + vec2(t, -t), p.z - bias));
  r += texture(s, vec3(p.xy + vec2(-t, t), p.z - bias));
  r += texture(s, vec3(p.xy + vec2(t, t), p.z - bias));
  return r * 0.25;
}
float dynShadow(vec4 sp) {
  if (uShadowOn < 0.5) return 1.0;
  vec3 p = sp.xyz / sp.w * 0.5 + 0.5;
  if (p.x <= 0.0 || p.x >= 1.0 || p.y <= 0.0 || p.y >= 1.0 || p.z >= 1.0) return 1.0;
  return pcf4(uShadow, p, 0.6 / 2048.0, 0.0012);
}
float staticShadow(vec3 world, vec3 n) {
  if (uSShadowParams.x < 0.5) return 1.0;
  vec4 q = uSShadowMat * vec4(world + n * 0.05, 1.0);
  vec3 p = q.xyz / q.w * 0.5 + 0.5;
  if (p.x <= 0.0 || p.x >= 1.0 || p.y <= 0.0 || p.y >= 1.0 || p.z >= 1.0) return 1.0;
  return pcf4(uSShadow, p, uSShadowParams.y * 0.75, 0.00035);
}
float sunShadow(vec3 world, vec3 n, vec4 dynPos) {
  return staticShadow(world, n) * dynShadow(dynPos);
}
// Soft terminator: light wraps a little past 90 degrees (painted look, no harsh black side).
float wrapDiffuse(float ndl) {
  return clamp((ndl + 0.18) / 1.18, 0.0, 1.0);
}
`;

export const WORLD_VS = `${HEADER}
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec2 aUv;
layout(location=3) in vec4 aCol;
layout(location=4) in vec3 aTint;
uniform mat4 uViewProj;
uniform mat4 uShadowMat;
out vec2 vUv;
out vec4 vCol;
out vec3 vTint;
out vec3 vWorld;
out vec3 vNrm;
out vec4 vShadowPos;
invariant gl_Position;
void main() {
  vUv = aUv;
  vTint = aTint;
  vCol = aCol;
  vWorld = aPos;
  vNrm = aNrm;
  vShadowPos = uShadowMat * vec4(aPos, 1.0);
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

export const WORLD_FS = `${HEADER}
in vec2 vUv;
in vec4 vCol;
in vec3 vTint;
in vec3 vWorld;
in vec3 vNrm;
in vec4 vShadowPos;
uniform sampler2D uAlbedo;
uniform vec3 uTint;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform vec3 uSky;
uniform vec3 uHorizon;
uniform vec3 uCamPos;
uniform vec4 uMuzzle;     // xyz position, w intensity
uniform vec3 uMuzzleColor;
uniform float uGlow;      // emissive surface (light strips, lit windows)
uniform float uWater;
uniform float uTime;
out vec4 fragColor;
${SHADOW_FN}
${GRADE}
${FOG}
void main() {
  vec3 N = normalize(vNrm);
  vec3 albedo = texture(uAlbedo, vUv).rgb * uTint * vTint;
  float sh = sunShadow(vWorld, N, vShadowPos);
  float ndl = dot(N, uSunDir);
  vec3 light = vCol.rgb + uSunColor * wrapDiffuse(ndl) * sh;
  if (uMuzzle.w > 0.0) {
    vec3 L = uMuzzle.xyz - vWorld;
    float d2 = dot(L, L);
    light += uMuzzleColor * uMuzzle.w * max(0.0, dot(N, L * inversesqrt(d2))) / (1.0 + d2 * 0.9);
  }
  vec3 c = albedo * light;
  if (uGlow > 0.0) c = albedo * uGlow;
  if (uWater > 0.5) {
    // Harbour water: animated ripple normal, Fresnel sky reflection, sun glint.
    vec3 V = normalize(uCamPos - vWorld);
    vec2 p = vWorld.xz;
    float t = uTime;
    vec3 n = normalize(vec3(
      sin(p.x * 0.9 + t * 1.3) * 0.05 + sin(p.y * 1.7 - t * 0.9 + p.x * 0.4) * 0.035 + sin(p.x * 4.1 + p.y * 2.3 + t * 2.6) * 0.015,
      1.0,
      cos(p.y * 0.8 + t * 1.1) * 0.05 + sin(p.x * 1.3 + p.y * 0.6 + t * 1.7) * 0.03 + cos(p.y * 3.7 - p.x * 1.9 - t * 2.2) * 0.015));
    float fres = 0.03 + 0.97 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
    vec3 R = reflect(-V, n);
    vec3 sky = mix(uHorizon, uSky, pow(max(R.y, 0.0), 0.5));
    vec3 deep = albedo * (vCol.rgb * 0.9 + uSunColor * 0.12 * sh);
    c = mix(deep, sky * 1.05, clamp(fres, 0.0, 0.9));
    c += uSunColor * pow(max(dot(R, uSunDir), 0.0), 260.0) * 3.0 * sh;
  }
  c = applyFog(c, vWorld, uCamPos);
  fragColor = vec4(tonemap(c), 1.0);
}`;

// Depth pre-pass for the environment: the position expression is identical to WORLD_VS and
// both declare gl_Position invariant, so the colour pass can test with LEQUAL and no writes.
export const WORLD_DEPTH_VS = `${HEADER}
layout(location=0) in vec3 aPos;
uniform mat4 uViewProj;
invariant gl_Position;
void main() { gl_Position = uViewProj * vec4(aPos, 1.0); }`;

export const DEPTH_VS = `${HEADER}
layout(location=0) in vec3 aPos;
uniform mat4 uViewProj;
uniform mat4 uModel;
void main() { gl_Position = uViewProj * uModel * vec4(aPos, 1.0); }`;

export const DEPTH_FS = `${HEADER}
out vec4 fragColor;
void main() { fragColor = vec4(0.0); }`;

// Procedural meshes (casings, fallback characters/viewmodel): hemisphere ambient + sun.
export const LIT_VS = `${HEADER}
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec2 aUv;
layout(location=3) in vec4 aCol;
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform mat4 uShadowMat;
out vec3 vNrm;
out vec4 vCol;
out vec3 vWorld;
out vec4 vShadowPos;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vNrm = mat3(uModel) * aNrm;
  vCol = aCol;
  vShadowPos = uShadowMat * w;
  gl_Position = uViewProj * w;
}`;

export const LIT_FS = `${HEADER}
in vec3 vNrm;
in vec4 vCol;
in vec3 vWorld;
in vec4 vShadowPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSky;
uniform vec3 uGround;
uniform vec2 uProbe;       // x: sun visibility, y: sky openness
uniform vec3 uCamPos;
uniform vec4 uTint;        // rgb multiplier, a = output alpha
uniform vec3 uEmissive;    // additive flash (hit feedback)
uniform vec3 uGlow;        // emissive colour for vertex alpha = 1 parts
uniform vec4 uMuzzle;
uniform vec3 uMuzzleColor;
uniform float uFlat;       // 1 = x-ray silhouette
out vec4 fragColor;
${SHADOW_FN}
${GRADE}
${FOG}
void main() {
  if (uFlat > 0.5) {
    fragColor = vec4(uTint.rgb, uTint.a);
    return;
  }
  vec3 n = normalize(vNrm);
  vec3 v = normalize(uCamPos - vWorld);
  vec3 albedo = vCol.rgb * uTint.rgb;
  float hemi = n.y * 0.5 + 0.5;
  vec3 amb = mix(uGround, uSky, hemi) * (0.3 + 0.4 * uProbe.y);
  float sh = sunShadow(vWorld, n, vShadowPos);
  vec3 sun = uSunColor * 0.8 * wrapDiffuse(dot(n, uSunDir)) * sh;
  float rim = pow(1.0 - max(0.0, dot(n, v)), 3.0) * 0.35;
  vec3 c = albedo * (amb + sun) + rim * uSky * 0.5;
  vec3 h = normalize(uSunDir + v);
  c += uSunColor * pow(max(0.0, dot(n, h)), 64.0) * 0.05 * sh;
  if (uMuzzle.w > 0.0) {
    vec3 L = uMuzzle.xyz - vWorld;
    float d2 = dot(L, L);
    c += albedo * uMuzzleColor * uMuzzle.w * max(0.0, dot(n, L * inversesqrt(d2))) / (1.0 + d2 * 6.0);
  }
  c = mix(c, uGlow, vCol.a);
  c += uEmissive;
  c = applyFog(c, vWorld, uCamPos);
  fragColor = vec4(tonemap(c), uTint.a);
}`;

// Sky: full-screen triangle at the far plane. Gradient, sun disc + halo, soft painted clouds,
// and a horizon silhouette per map (mesas for Saltworks, harbour skyline + sea for Dockside 9).
export const SKY_VS = `${HEADER}
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vNdc;
void main() {
  vNdc = P[gl_VertexID];
  gl_Position = vec4(P[gl_VertexID], 1.0, 1.0);
}`;

export const SKY_FS = `${HEADER}
in vec2 vNdc;
uniform mat4 uInvViewProj;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uFogColor;
uniform float uHorizonKind;  // 0 mesas, 1 harbour
uniform float uTime;
out vec4 fragColor;
uniform float uExposure;
vec3 tonemapSky(vec3 c) {
  c *= uExposure;
  c = clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, 1.16);
  return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}
float mesa(float a) {
  return 0.035 + 0.025 * sin(a * 3.0 + 1.3) + 0.018 * sin(a * 7.0 + 0.4) + 0.008 * sin(a * 17.0) + 0.003 * sin(a * 41.0);
}
// Harbour skyline: blocky towers and gantry cranes in two azimuth bands, open sea elsewhere.
float skyline(float a) {
  float band = smoothstep(0.2, 0.6, sin(a * 1.0 + 2.2)) + 0.6 * smoothstep(0.5, 0.9, sin(a * 2.0 - 0.8));
  float cell = floor(a * 38.0);
  float h = hash(vec2(cell, 3.0));
  float tower = (0.012 + h * h * 0.06) * band;
  float crane = step(0.93, hash(vec2(cell, 9.0))) * 0.07 * band;
  return max(tower, crane) + 0.004;
}
void main() {
  vec4 w = uInvViewProj * vec4(vNdc, 1.0, 1.0);
  vec3 d = normalize(w.xyz / w.w - uCamPos);
  float k = pow(max(d.y, 0.0), 0.5);
  vec3 c = mix(uHorizon, uZenith, k) * 1.12;
  float s = max(0.0, dot(d, uSunDir));
  c += uSunColor * (pow(s, 900.0) * 18.0 + pow(s, 14.0) * 0.16 + pow(s, 3.0) * 0.05);
  // Painted cumulus: flattened fbm on a sky dome, lit from the sun side.
  if (d.y > 0.0) {
    vec2 uv = d.xz / (d.y + 0.18) * 1.6 + vec2(uTime * 0.004, 0.0);
    float n = fbm(uv);
    float cover = smoothstep(0.52, 0.78, n) * smoothstep(0.0, 0.25, d.y);
    float lit = 0.75 + 0.25 * dot(normalize(vec3(d.x, 0.3, d.z)), uSunDir);
    vec3 cloud = mix(uHorizon * 1.05, vec3(1.0, 0.97, 0.92) * 1.25, lit) ;
    c = mix(c, cloud, cover * 0.85);
  }
  float az = atan(d.z, d.x);
  if (uHorizonKind < 0.5) {
    float m = mesa(az);
    if (d.y < m) {
      float t = clamp((m - d.y) * 18.0, 0.0, 1.0);
      vec3 rock = mix(vec3(0.62, 0.5, 0.44), vec3(0.5, 0.42, 0.4), t);
      c = mix(uFogColor * 1.02, rock, 0.35);
    }
  } else {
    float m = skyline(az);
    if (d.y < m) c = mix(uFogColor * 0.92, vec3(0.42, 0.5, 0.58), 0.35);
    if (d.y < 0.0) c = mix(uFogColor * 0.95, vec3(0.16, 0.3, 0.36), clamp(-d.y * 6.0, 0.0, 1.0));
  }
  fragColor = vec4(tonemapSky(c), 1.0);
}`;

// Decals: multiply-blended onto the lit frame. Texture luminance is the ink mask.
export const DECAL_VS = `${HEADER}
layout(location=0) in vec3 aPos;
layout(location=2) in vec2 aUv;
layout(location=3) in vec4 aCol;
uniform mat4 uViewProj;
uniform vec3 uCamPos;
uniform float uFogDensity;
out vec2 vUv;
out vec4 vCol;
out float vFog;
void main() {
  vUv = aUv;
  vCol = aCol;
  vFog = 1.0 - exp(-uFogDensity * length(aPos - uCamPos));
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

export const DECAL_FS = `${HEADER}
in vec2 vUv;
in vec4 vCol;
in float vFog;
uniform sampler2D uTex;
out vec4 fragColor;
void main() {
  vec3 t = texture(uTex, vUv).rgb;
  vec3 c = mix(vCol.rgb, vec3(1.0), t);
  c = mix(vec3(1.0), c, vCol.a * (1.0 - vFog));
  fragColor = vec4(c, 1.0);
}`;

// Particles, tracers, flashes, smoke: pre-built camera-facing quads.
export const FX_VS = `${HEADER}
layout(location=0) in vec3 aPos;
layout(location=2) in vec2 aUv;
layout(location=3) in vec4 aCol;
uniform mat4 uViewProj;
out vec2 vUv;
out vec4 vCol;
void main() {
  vUv = aUv;
  vCol = aCol;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

export const FX_FS = `${HEADER}
in vec2 vUv;
in vec4 vCol;
uniform sampler2D uTex;
uniform float uGamma;
out vec4 fragColor;
void main() {
  vec4 t = texture(uTex, vUv);
  vec4 c = vec4(vCol.rgb, vCol.a * t.a);
  // Additive sprites are authored in linear HDR; compress so they bloom without clipping hue.
  if (uGamma > 0.5) c.rgb = c.rgb / (1.0 + c.rgb * 0.35);
  fragColor = c;
}`;

// Authored glTF assets: metal/roughness PBR with stylized touches.
//   uBaked = 1: vertex colour rgb is the level's baked indirect light (static props)
//   uBaked = 0: hemisphere ambient x per-object probe (viewmodel, characters, crane stacks)
// Sun visibility always comes from the shadow maps. Normal maps use a derivative cotangent
// frame (no tangent attribute needed).
export const PBR_VS = `${HEADER}
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec2 aUv;
layout(location=3) in vec4 aCol;
layout(location=4) in vec3 aTint;
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform mat4 uShadowMat;
out vec3 vNrm;
out vec4 vCol;
out vec3 vTint;
out vec3 vWorld;
out vec2 vUv;
out vec4 vShadowPos;
void main() {
  vTint = aTint;
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vNrm = mat3(uModel) * aNrm;
  vCol = aCol;
  vUv = aUv;
  vShadowPos = uShadowMat * w;
  gl_Position = uViewProj * w;
}`;

export const PBR_FS = `${HEADER}
in vec3 vNrm;
in vec4 vCol;
in vec3 vTint;
in vec3 vWorld;
in vec2 vUv;
in vec4 vShadowPos;
uniform sampler2D uBase;
uniform sampler2D uMr;
uniform sampler2D uNrm;
uniform vec4 uBaseFactor;   // rgb: material factor x palette tint, a: alpha
uniform vec2 uMrFactor;     // roughness, metalness multipliers
uniform vec3 uEmit;         // emissive radiance (linear HDR)
uniform float uNormalScale;
uniform float uBaked;
uniform vec2 uProbe;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSky;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uCamPos;
uniform vec3 uFlash;        // additive hit flash
uniform vec4 uMuzzle;
uniform vec3 uMuzzleColor;
uniform float uFlat;        // 1 = x-ray silhouette
uniform float uEdge;        // edge highlight strength (viewmodel / props)
uniform float uViewSpace;   // 1 = drawn in the viewmodel pass (no fog, no world shadows)
out vec4 fragColor;
${SHADOW_FN}
${GRADE}
${FOG}
const float PI = 3.14159265;
vec3 perturb(vec3 N, vec3 P, vec2 uv, vec3 tn) {
  vec3 dp1 = dFdx(P), dp2 = dFdy(P);
  vec2 du1 = dFdx(uv), du2 = dFdy(uv);
  vec3 dp2p = cross(dp2, N), dp1p = cross(N, dp1);
  vec3 T = dp2p * du1.x + dp1p * du2.x;
  vec3 B = dp2p * du1.y + dp1p * du2.y;
  float m = max(dot(T, T), dot(B, B));
  if (m < 1e-20) return N;
  float k = inversesqrt(m);
  return normalize(mat3(T * k, B * k, N) * tn);
}
float ggx(float NdH, float a) {
  float a2 = a * a;
  float d = NdH * NdH * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d);
}
float smithV(float NdL, float NdV, float a) {
  float a2 = a * a;
  float gv = NdL * sqrt(NdV * NdV * (1.0 - a2) + a2);
  float gl = NdV * sqrt(NdL * NdL * (1.0 - a2) + a2);
  return 0.5 / max(gv + gl, 1e-5);
}
vec3 envBRDF(vec3 F0, float rough, float NdV) {
  // Karis' analytic fit of the split-sum DFG term.
  vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
  vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
  vec4 r = rough * c0 + c1;
  float a004 = min(r.x * r.x, exp2(-9.28 * NdV)) * r.x + r.y;
  vec2 AB = vec2(-1.04, 1.04) * a004 + r.zw;
  return F0 * AB.x + AB.y;
}
void main() {
  if (uFlat > 0.5) { fragColor = uBaseFactor; return; }
  vec3 base = texture(uBase, vUv).rgb * uBaseFactor.rgb * vTint;
  vec3 mr = texture(uMr, vUv).rgb;
  float ao = mr.r;
  float rough = clamp(mr.g * uMrFactor.x, 0.12, 1.0);
  float metal = clamp(mr.b * uMrFactor.y, 0.0, 1.0);
  vec3 tn = texture(uNrm, vUv).xyz * 2.0 - 1.0;
  tn.xy *= uNormalScale;
  vec3 Ng = normalize(vNrm);
  if (!gl_FrontFacing) Ng = -Ng;
  vec3 N = perturb(Ng, vWorld, vUv, normalize(tn));
  vec3 V = normalize(uCamPos - vWorld);
  vec3 L = uSunDir;
  vec3 H = normalize(L + V);
  float NdLr = dot(N, L);
  float NdL = max(NdLr, 0.0);
  float NdV = max(dot(N, V), 1e-4);
  float NdH = max(dot(N, H), 0.0);
  float VdH = max(dot(V, H), 0.0);
  float a = rough * rough;
  vec3 F0 = mix(vec3(0.04), base, metal);
  vec3 diff = base * (1.0 - metal);

  // The viewmodel can poke into walls: it takes the eye probe, never world shadow lookups.
  float sunVis = uViewSpace > 0.5 ? uProbe.x : sunShadow(vWorld, Ng, vShadowPos);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - VdH, 5.0);
  vec3 spec = F * ggx(NdH, a) * smithV(NdL, NdV, a) * PI;
  vec3 direct = uSunColor * sunVis * (diff * (1.0 - F) * wrapDiffuse(NdLr) + spec * NdL);

  vec3 indirect;
  float specOcc;
  if (uBaked > 0.5) {
    indirect = vCol.rgb;
    specOcc = clamp(dot(vCol.rgb, vec3(0.333)) / max(dot(uSky, vec3(0.333)), 1e-3), 0.15, 1.0);
  } else {
    float hemi = N.y * 0.5 + 0.5;
    indirect = mix(uGround, uSky, hemi) * (0.32 + 0.45 * uProbe.y);
    specOcc = 0.35 + 0.65 * uProbe.y;
  }
  vec3 R = reflect(-V, N);
  vec3 env = R.y >= 0.0 ? mix(uHorizon, uSky, pow(R.y, 0.5)) : mix(uHorizon, uGround, min(1.0, -R.y * 3.0));
  env = mix(env, indirect, rough * 0.7);
  vec3 ambient = diff * indirect * ao + env * envBRDF(F0, rough, NdV) * specOcc * ao * 0.9;

  vec3 c = direct + ambient;
  // Edge highlight: bevels are where the interpolated normal turns fast in screen space. A
  // painted-on light edge makes hard-surface silhouettes read at a glance.
  float edge = clamp(length(fwidth(Ng)) * 1.6 - 0.05, 0.0, 1.0);
  c += edge * uEdge * (base * 0.6 + 0.12) * (indirect + uSunColor * 0.25 * sunVis);
  if (uBaked < 0.5) {
    float rim = pow(1.0 - NdV, 4.0);
    c += rim * uSky * 0.35 * (0.4 + 0.6 * uProbe.y);
  }
  if (uMuzzle.w > 0.0) {
    vec3 Lm = uMuzzle.xyz - vWorld;
    float d2 = dot(Lm, Lm);
    vec3 l = Lm * inversesqrt(d2);
    float att = uMuzzle.w / (1.0 + d2 * 6.0);
    vec3 hm = normalize(l + V);
    c += uMuzzleColor * att * max(dot(N, l), 0.0) * (diff + F0 * ggx(max(dot(N, hm), 0.0), a) * 0.25);
  }
  c += uEmit + uFlash;
  if (uViewSpace < 0.5) c = applyFog(c, vWorld, uCamPos);
  fragColor = vec4(tonemap(c), uBaseFactor.a);
}`;
