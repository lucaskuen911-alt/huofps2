// Frame renderer. Pass order:
//   0. Static shadow (once, at load): every brush + baked prop -> 4096 map over the whole level
//   1. Shadow   : dynamic casters only (characters, crane stacks) -> 2048 map around the camera
//   2. Pre-pass : environment depth only (colour writes off)
//   3. Opaque   : environment colour with LEQUAL + no depth writes (zero overdraw shading),
//                 then characters/props
//   4. Sky      : full-screen triangle at the far plane (only fills uncovered pixels)
//   5. Decals   : static paint + bullet marks, multiply blend
//   6. X-ray    : revealed hostiles through walls
//   7. FX       : smoke (alpha), tracers/sparks/flashes (additive)
//   8. Viewmodel: depth cleared, own projection so the weapon never clips into walls
// Environment chunks are frustum culled per 16 m chunk.

import { createProgram, createMesh, textureFromCanvas, createShadowTarget } from './gl/GLUtil.js';
import * as M from './gl/Mat4.js';
import * as SH from './Shaders.js';
import { buildSurfaceTextures, buildDecalAtlas, buildFxAtlas } from './Textures.js';
import { SURFACES } from '../data/surfaces.js';
const SHADOW_SIZE = 2048;
const SHADOW_EXTENT = 34;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: true,
      alpha: false,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
      desynchronized: true, // lower presentation latency where supported
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    this.programs = {
      world: createProgram(gl, 'world', SH.WORLD_VS, SH.WORLD_FS),
      worldDepth: createProgram(gl, 'worldDepth', SH.WORLD_DEPTH_VS, SH.DEPTH_FS),
      depth: createProgram(gl, 'depth', SH.DEPTH_VS, SH.DEPTH_FS),
      lit: createProgram(gl, 'lit', SH.LIT_VS, SH.LIT_FS),
      sky: createProgram(gl, 'sky', SH.SKY_VS, SH.SKY_FS),
      decal: createProgram(gl, 'decal', SH.DECAL_VS, SH.DECAL_FS),
      fx: createProgram(gl, 'fx', SH.FX_VS, SH.FX_FS),
      pbr: createProgram(gl, 'pbr', SH.PBR_VS, SH.PBR_FS),
    };
    // 1x1 fallbacks so every PBR draw binds the same three samplers (no shader variants).
    this.defaults = {
      base: solidTexture(gl, [255, 255, 255, 255], true),
      mr: solidTexture(gl, [255, 150, 0, 255], false),
      normal: solidTexture(gl, [128, 128, 255, 255], false),
    };
    this.gpuMaterials = new Map();
    this.staticProps = [];
    this.emptyVao = gl.createVertexArray();
    this.shadow = createShadowTarget(gl, SHADOW_SIZE);
    this.shadowMat = M.mat4();
    this.shadowView = M.mat4();
    this.shadowProj = M.mat4();
    this.planes = new Float32Array(24);
    this.identity = M.mat4();
    this.stats = { drawCalls: 0, triangles: 0, chunksVisible: 0, chunksTotal: 0, gpuMs: 0 };
    this.width = 1;
    this.height = 1;
    this.chunks = [];
    this.textures = {};
    this.time = 0;
    gl.vertexAttrib4f(4, 1, 1, 1, 1); // generic aTint for meshes without the attribute
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.staticShadow = null;
    this.staticShadowSize = Math.min(4096, maxTex);
    this.staticShadowMat = M.mat4();
    this.staticShadowParams = new Float32Array([0, 0]);
  }

  /**
   * Render the level's static sun shadow once: brushes + baked props into one orthographic map
   * covering the playable bounds. Receivers sample it with a small normal offset and 4-tap PCF.
   */
  bakeStaticShadow(map) {
    const gl = this.gl;
    const size = this.staticShadowSize;
    if (!this.staticShadow) this.staticShadow = createShadowTarget(gl, size);
    const b = map.bounds;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, cy = (b.minY + Math.min(b.maxY, 40)) / 2;
    const d = this.sunDir;
    const view = M.mat4(), proj = M.mat4();
    M.lookAt(view, cx + d[0] * 200, cy + d[1] * 200, cz + d[2] * 200, cx, cy, cz, 0, 1, 0);
    // Fit the ortho box to the bounds' corners in light space.
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const p = [0, 0, 0];
    for (const x of [b.minX, b.maxX]) for (const y of [b.minY, Math.min(b.maxY, 45)]) for (const z of [b.minZ, b.maxZ]) {
      M.transformPoint(view, x, y, z, p);
      x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); z0 = Math.min(z0, -p[2]); z1 = Math.max(z1, -p[2]);
    }
    M.ortho(proj, x0, x1, y0, y1, Math.max(0.1, z0 - 5), z1 + 5);
    M.multiply(this.staticShadowMat, proj, view);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.staticShadow.fbo);
    gl.viewport(0, 0, size, size);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.6, 3.0);
    const prog = this.programs.depth;
    gl.useProgram(prog.prog);
    gl.uniformMatrix4fv(prog.u.uViewProj, false, this.staticShadowMat);
    gl.uniformMatrix4fv(prog.u.uModel, false, this.identity);
    for (const c of this.chunks) if (c.surface !== 'water') this.drawMesh(c.mesh);
    for (const pr of this.staticProps) this.drawMesh(pr.mesh);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.staticShadowParams[0] = 1;
    this.staticShadowParams[1] = 1 / size;
    this.stats.staticShadowTexel = ((x1 - x0) / size) * 100; // cm
  }

  /** Common shadow / grade / fog uniforms for any lit program. */
  bindLighting(u, shadowOn, fogDensity) {
    const gl = this.gl;
    gl.uniformMatrix4fv(u.uShadowMat, false, this.shadowMat);
    gl.uniform1f(u.uShadowOn, shadowOn ? 1 : 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.shadow.tex);
    gl.uniform1i(u.uShadow, 1);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.staticShadow ? this.staticShadow.tex : this.shadow.tex);
    gl.uniform1i(u.uSShadow, 4);
    gl.uniformMatrix4fv(u.uSShadowMat, false, this.staticShadowMat);
    gl.uniform2fv(u.uSShadowParams, this.staticShadowParams);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1f(u.uExposure, this.exposure);
    gl.uniform3fv(u.uFogColor, this.env.fog.color);
    gl.uniform1f(u.uFogDensity, fogDensity);
    gl.uniform3fv(u.uSunDir, this.sunDir);
    gl.uniform3fv(u.uSunColor, this.sunColor);
  }

  /** Upload environment geometry and the texture set. */
  initWorld(map, geometry, staticDecals) {
    const gl = this.gl;
    const canvases = buildSurfaceTextures();
    for (const k of Object.keys(canvases)) this.textures[k] = this.textures[k] || textureFromCanvas(gl, canvases[k], { aniso: this.aniso });
    this.textures.decals = textureFromCanvas(gl, buildDecalAtlas(), { repeat: false });
    this.textures.fx = textureFromCanvas(gl, buildFxAtlas(), { srgb: false, repeat: false });
    this.chunks = geometry.chunks.map((c) => ({
      mesh: createMesh(gl, c.vertices, c.indices, false, c.floats || 12),
      surface: c.surface,
      tint: ONE3,
      min: c.min,
      max: c.max,
      tris: c.indices.length / 3,
    }));
    this.staticDecals = staticDecals.map((d) => ({ mesh: createMesh(gl, d.vertices, d.indices), texture: d.textureCanvas ? textureFromCanvas(gl, d.textureCanvas, { repeat: false }) : this.textures.decals }));
    this.env = map.env;
    const s = map.env.sun.dir;
    const l = Math.hypot(s[0], s[1], s[2]);
    this.sunDir = [s[0] / l, s[1] / l, s[2] / l];
    this.sunColor = map.env.sun.color.map((c) => c * map.env.sun.intensity);
    this.exposure = map.env.exposure || 0.8;
    this.horizonKind = map.env.horizon === 'harbour' ? 1 : 0;
  }

  /** Authored surface texture (ImageBitmap) replacing the procedural one for `surface`. */
  setSurfaceImage(surface, image) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    if (this.aniso) gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    this.textures[surface] = t;
  }

  resize(cssW, cssH, scale) {
    const w = Math.max(1, Math.round(cssW * scale));
    const h = Math.max(1, Math.round(cssH * scale));
    if (w !== this.canvas.width || h !== this.canvas.height) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.width = w;
    this.height = h;
  }

  createMesh(vertices, indices, dynamic, floats) {
    return createMesh(this.gl, vertices, indices, dynamic, floats);
  }

  /** GPU view of a glTF material (textures uploaded once per asset). */
  material(asset, mat) {
    const key = `${asset ? asset.id || 'a' : 'none'}:${mat.index}:${mat.name}`;
    let g = this.gpuMaterials.get(key);
    if (g) return g;
    const gl = this.gl;
    const tex = (info, srgb, fallback) => {
      const i = asset ? asset.imageOf(info) : -1;
      return i >= 0 && asset.images[i] ? asset.texture(gl, i, srgb, this.aniso) : fallback;
    };
    g = {
      name: mat.name,
      base: tex(mat.base, true, this.defaults.base),
      mr: tex(mat.mr, false, this.defaults.mr),
      normal: tex(mat.normal, false, this.defaults.normal),
      baseColor: mat.baseColor,
      emissive: mat.emissive,
      mrFactor: [mat.roughness ?? 1, mat.metallic ?? 1],
    };
    this.gpuMaterials.set(key, g);
    return g;
  }

  /** Static, light-baked authored props (world-space vertices, vertex colour = bake). */
  setStaticProps(list) {
    this.staticProps = list;
  }

  // ------------------------------------------------------------------ frame
  render(f) {
    const gl = this.gl;
    const st = this.stats;
    this.time = f.time !== undefined ? f.time : this.time + 1 / 60;
    st.drawCalls = 0;
    st.triangles = 0;
    st.byPass = {};
    this.pass = 'shadow';

    // Dynamic objects: frustum cull by bounding sphere (model translation + radius), and only
    // cast into the camera-centred shadow map when inside its extent.
    M.frustumPlanes(f.camera.viewProj, this.planes);
    const cp = f.camera.pos;
    const lit = [];
    const casters = [];
    for (const o of f.lit) {
      const m = o.model;
      if (m && o.radius !== 0) {
        const r = o.radius || 2;
        const x = m[12], y = m[13], z = m[14];
        if (o.castShadow) {
          const dx = x - cp[0], dz = z - cp[2];
          if (Math.abs(dx) < SHADOW_EXTENT + r + 8 && Math.abs(dz) < SHADOW_EXTENT + r + 8) casters.push(o);
        }
        CMIN[0] = x - r; CMIN[1] = y - r; CMIN[2] = z - r; CMAX[0] = x + r; CMAX[1] = y + r; CMAX[2] = z + r;
        if (!o.xray && !M.aabbInFrustum(this.planes, CMIN, CMAX)) continue;
      } else if (o.castShadow) casters.push(o);
      lit.push(o);
    }
    st.litVisible = lit.length;
    const shadowOn = casters.length > 0;
    if (shadowOn) this.shadowPass(f.camera.pos, casters);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.depthMask(true);
    gl.colorMask(true, true, true, true);
    gl.clearColor(0.8, 0.78, 0.74, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);

    // Cull environment chunks.
    const visible = [];
    for (const c of this.chunks) if (M.aabbInFrustum(this.planes, c.min, c.max)) visible.push(c);
    st.chunksVisible = visible.length;
    st.chunksTotal = this.chunks.length;

    // 2. depth pre-pass
    this.pass = 'prepass';
    let p = this.programs.worldDepth;
    gl.useProgram(p.prog);
    gl.uniformMatrix4fv(p.u.uViewProj, false, f.camera.viewProj);
    gl.colorMask(false, false, false, false);
    gl.depthFunc(gl.LESS);
    for (const c of visible) this.drawMesh(c.mesh);
    gl.colorMask(true, true, true, true);

    // 3a. environment colour, LEQUAL against the pre-pass depth
    this.pass = 'world';
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    p = this.programs.world;
    gl.useProgram(p.prog);
    gl.uniformMatrix4fv(p.u.uViewProj, false, f.camera.viewProj);
    this.bindLighting(p.u, shadowOn, this.env.fog.density);
    gl.uniform3fv(p.u.uCamPos, f.camera.pos);
    gl.uniform3fv(p.u.uSky, this.env.sky.zenith);
    gl.uniform3fv(p.u.uHorizon, this.env.sky.horizon);
    gl.uniform4fv(p.u.uMuzzle, f.muzzle.light);
    gl.uniform3fv(p.u.uMuzzleColor, f.muzzle.color);
    gl.uniform1f(p.u.uTime, this.time);
    gl.uniform1f(p.u.uGlow, 0);
    gl.uniform1i(p.u.uAlbedo, 0);
    // Sort by surface to minimise texture binds.
    visible.sort((a, b) => (a.surface < b.surface ? -1 : a.surface > b.surface ? 1 : 0));
    let bound = null;
    for (const c of visible) {
      if (bound !== c.surface) {
        gl.bindTexture(gl.TEXTURE_2D, this.textures[c.surface]);
        bound = c.surface;
      }
      gl.uniform3fv(p.u.uTint, c.tint);
      gl.uniform1f(p.u.uWater, c.surface === 'water' ? 1 : 0);
      this.drawMesh(c.mesh);
    }
    gl.depthMask(true);
    gl.depthFunc(gl.LESS);

    // 3b. baked authored props (frustum culled, back faces culled: authored meshes are closed)
    const props = [];
    for (const pr of this.staticProps) if (M.aabbInFrustum(this.planes, pr.min, pr.max)) props.push(pr);
    st.propsVisible = props.length;
    this.pass = 'props';
    if (props.length) this.drawPbrList(props, f.camera, f.muzzle, shadowOn, this.env.fog.density, true);

    // 3c. dynamic lit objects (no back-face culling: procedural parts are not watertight)
    this.pass = 'dynamic';
    gl.disable(gl.CULL_FACE);
    this.drawLitList(lit.filter((o) => !o.xray), f.camera, f.muzzle, shadowOn, this.env.fog.density);

    // 4. sky
    this.pass = 'sky+decal+fx';
    p = this.programs.sky;
    gl.useProgram(p.prog);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    gl.uniformMatrix4fv(p.u.uInvViewProj, false, f.camera.invViewProj);
    gl.uniform3fv(p.u.uCamPos, f.camera.pos);
    gl.uniform3fv(p.u.uSunDir, this.sunDir);
    gl.uniform3fv(p.u.uSunColor, this.sunColor);
    gl.uniform3fv(p.u.uZenith, this.env.sky.zenith);
    gl.uniform3fv(p.u.uHorizon, this.env.sky.horizon);
    gl.uniform3fv(p.u.uFogColor, this.env.fog.color);
    gl.uniform1f(p.u.uHorizonKind, this.horizonKind);
    gl.uniform1f(p.u.uTime, this.time);
    gl.uniform1f(p.u.uExposure, this.exposure);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    st.drawCalls++;

    // 5. decals (multiply)
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.DST_COLOR, gl.ZERO);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(-2, -4);
    p = this.programs.decal;
    gl.useProgram(p.prog);
    gl.uniformMatrix4fv(p.u.uViewProj, false, f.camera.viewProj);
    gl.uniform3fv(p.u.uCamPos, f.camera.pos);
    gl.uniform1f(p.u.uFogDensity, this.env.fog.density);
    gl.uniform1i(p.u.uTex, 0);
    for (const d of this.staticDecals) {
      gl.bindTexture(gl.TEXTURE_2D, d.texture);
      this.drawMesh(d.mesh);
    }
    if (f.decals && f.decals.count > 0) {
      gl.bindTexture(gl.TEXTURE_2D, this.textures.decals);
      this.drawMesh(f.decals);
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);

    // 6. x-ray silhouettes
    const xray = lit.filter((o) => o.xray);
    if (xray.length) {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.DEPTH_TEST);
      this.drawLitList(xray, f.camera, f.muzzle, false, 0);
      gl.enable(gl.DEPTH_TEST);
    }

    // 7. FX
    p = this.programs.fx;
    gl.useProgram(p.prog);
    gl.uniformMatrix4fv(p.u.uViewProj, false, f.camera.viewProj);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.fx);
    gl.uniform1i(p.u.uTex, 0);
    if (f.fxAlpha && f.fxAlpha.count > 0) {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1f(p.u.uGamma, 0);
      this.drawMesh(f.fxAlpha);
    }
    if (f.fxAdd && f.fxAdd.count > 0) {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.uniform1f(p.u.uGamma, 1);
      this.drawMesh(f.fxAdd);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    // 8. viewmodel
    this.pass = 'viewmodel';
    if (f.viewmodel.length) {
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.depthFunc(gl.LESS);
      this.drawLitList(f.viewmodel, f.vmCamera, f.muzzle, false, 0, true);
      if (f.vmFx && f.vmFx.count > 0) {
        p = this.programs.fx;
        gl.useProgram(p.prog);
        gl.uniformMatrix4fv(p.u.uViewProj, false, f.vmCamera.viewProj);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.fx);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        gl.depthMask(false);
        gl.uniform1f(p.u.uGamma, 1);
        this.drawMesh(f.vmFx);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }
    }
    gl.bindVertexArray(null);
  }

  drawMesh(mesh) {
    const gl = this.gl;
    gl.bindVertexArray(mesh.vao);
    if (mesh.indexed) gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
    else gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    this.stats.drawCalls++;
    this.stats.triangles += mesh.count / 3;
    const bp = this.stats.byPass;
    if (bp) bp[this.pass] = (bp[this.pass] || 0) + 1;
  }

  drawLitList(list, cam, muzzle, shadowOn, fogDensity, viewSpace = false) {
    if (!list.length) return;
    const pbr = list.filter((o) => o.material);
    if (pbr.length) {
      this.drawPbrList(pbr, cam, muzzle, shadowOn, fogDensity, false, viewSpace);
      if (pbr.length === list.length) return;
      list = list.filter((o) => !o.material);
    }
    const gl = this.gl;
    const p = this.programs.lit;
    gl.useProgram(p.prog);
    gl.uniformMatrix4fv(p.u.uViewProj, false, cam.viewProj);
    this.bindLighting(p.u, shadowOn, fogDensity);
    if (viewSpace) gl.uniform2f(p.u.uSShadowParams, 0, 0);
    gl.uniform3fv(p.u.uSky, this.env.sky.zenith);
    gl.uniform3fv(p.u.uGround, this.env.sky.bounce);
    gl.uniform3fv(p.u.uCamPos, cam.pos);
    gl.uniform4fv(p.u.uMuzzle, muzzle.light);
    gl.uniform3fv(p.u.uMuzzleColor, muzzle.color);
    for (const o of list) {
      gl.uniformMatrix4fv(p.u.uModel, false, o.model);
      gl.uniform4fv(p.u.uTint, o.tint || ONE4);
      gl.uniform3fv(p.u.uEmissive, o.emissive || ZERO3);
      gl.uniform3fv(p.u.uGlow, o.glow || ZERO3);
      gl.uniform2fv(p.u.uProbe, o.probe || ONE2);
      gl.uniform1f(p.u.uFlat, o.xray ? 1 : 0);
      if (o.alpha) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      }
      this.drawMesh(o.mesh);
      if (o.alpha) gl.disable(gl.BLEND);
    }
  }

  drawPbrList(list, cam, muzzle, shadowOn, fogDensity, baked, viewSpace = false) {
    const gl = this.gl;
    const p = this.programs.pbr;
    const u = p.u;
    gl.useProgram(p.prog);
    gl.uniformMatrix4fv(u.uViewProj, false, cam.viewProj);
    this.bindLighting(u, shadowOn, fogDensity);
    gl.uniform1f(u.uViewSpace, viewSpace ? 1 : 0);
    gl.uniform1f(u.uEdge, viewSpace ? 0.55 : 0.3);
    gl.uniform1i(u.uBase, 0);
    gl.uniform1i(u.uMr, 2);
    gl.uniform1i(u.uNrm, 3);
    gl.uniform3fv(u.uSky, this.env.sky.zenith);
    gl.uniform3fv(u.uHorizon, this.env.sky.horizon);
    gl.uniform3fv(u.uGround, this.env.sky.bounce);
    gl.uniform3fv(u.uCamPos, cam.pos);
    gl.uniform4fv(u.uMuzzle, muzzle.light);
    gl.uniform3fv(u.uMuzzleColor, muzzle.color);
    gl.uniform1f(u.uBaked, baked ? 1 : 0);
    if (baked) gl.enable(gl.CULL_FACE);
    let bound = null;
    for (const o of list) {
      const m = o.material;
      if (m !== bound) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, m.base);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, m.mr);
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, m.normal);
        gl.uniform2fv(u.uMrFactor, m.mrFactor);
        bound = m;
      }
      const t = o.tint || ONE3;
      const bc = m.baseColor;
      BASE4[0] = bc[0] * t[0]; BASE4[1] = bc[1] * t[1]; BASE4[2] = bc[2] * t[2]; BASE4[3] = o.alpha !== undefined ? o.alpha : (o.xray ? o.tint4[3] : 1);
      if (o.xray) { BASE4[0] = o.tint4[0]; BASE4[1] = o.tint4[1]; BASE4[2] = o.tint4[2]; }
      gl.uniform4fv(u.uBaseFactor, BASE4);
      gl.uniform3fv(u.uEmit, o.emit || m.emissive || ZERO3);
      gl.uniform3fv(u.uFlash, o.emissive || ZERO3);
      gl.uniform1f(u.uNormalScale, o.normalScale !== undefined ? o.normalScale : 1);
      gl.uniform2fv(u.uProbe, o.probe || ONE2);
      gl.uniform1f(u.uFlat, o.xray ? 1 : 0);
      gl.uniformMatrix4fv(u.uModel, false, o.model || this.identity);
      if (o.alpha !== undefined && o.alpha < 1) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      }
      this.drawMesh(o.mesh);
      if (o.alpha !== undefined && o.alpha < 1) gl.disable(gl.BLEND);
    }
    gl.activeTexture(gl.TEXTURE0);
    if (baked) gl.disable(gl.CULL_FACE);
  }

  shadowPass(center, casters) {
    const gl = this.gl;
    const d = this.sunDir;
    // Snap the light-space origin to shadow texels so moving the camera never shimmers edges.
    const texel = (SHADOW_EXTENT * 2) / SHADOW_SIZE;
    const cx = Math.round(center[0] / texel) * texel;
    const cz = Math.round(center[2] / texel) * texel;
    const cy = Math.round(center[1] / 2) * 2; // multi-level maps: follow the camera's floor
    M.lookAt(this.shadowView, cx + d[0] * 70, cy + d[1] * 70, cz + d[2] * 70, cx, cy, cz, 0, 1, 0);
    M.ortho(this.shadowProj, -SHADOW_EXTENT, SHADOW_EXTENT, -SHADOW_EXTENT, SHADOW_EXTENT, 1, 150);
    M.multiply(this.shadowMat, this.shadowProj, this.shadowView);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadow.fbo);
    gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.disable(gl.CULL_FACE);
    const p = this.programs.depth;
    gl.useProgram(p.prog);
    gl.uniformMatrix4fv(p.u.uViewProj, false, this.shadowMat);
    for (const o of casters) {
      gl.uniformMatrix4fv(p.u.uModel, false, o.model || this.identity);
      this.drawMesh(o.mesh);
    }
  }
}

const ONE4 = new Float32Array([1, 1, 1, 1]);
const ONE3 = new Float32Array([1, 1, 1]);
const CMIN = [0, 0, 0], CMAX = [0, 0, 0];
const BASE4 = new Float32Array(4);

function solidTexture(gl, rgba, srgb) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return t;
}
const ONE2 = new Float32Array([1, 1]);
const ZERO3 = new Float32Array([0, 0, 0]);
