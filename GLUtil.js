// Thin WebGL2 helpers: programs with cached uniform locations, interleaved meshes, textures.

export const VERTEX_FLOATS = 12; // pos3 nrm3 uv2 col4
// Static level geometry adds a per-vertex albedo tint (rgb) so differently painted brushes and
// props share one draw per chunk x material. Meshes without it read the generic value (1, 1, 1).
export const TINTED_FLOATS = 15;
export const ATTR = { pos: 0, nrm: 1, uv: 2, col: 3, tint: 4 };

export function createProgram(gl, name, vsSrc, fsSrc) {
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(`${name} ${type === gl.VERTEX_SHADER ? 'VS' : 'FS'}: ${gl.getShaderInfoLog(s)}`);
    }
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSrc));
  gl.bindAttribLocation(prog, ATTR.pos, 'aPos');
  gl.bindAttribLocation(prog, ATTR.nrm, 'aNrm');
  gl.bindAttribLocation(prog, ATTR.uv, 'aUv');
  gl.bindAttribLocation(prog, ATTR.col, 'aCol');
  gl.bindAttribLocation(prog, ATTR.tint, 'aTint');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`${name} link: ${gl.getProgramInfoLog(prog)}`);
  const uniforms = {};
  const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(prog, i);
    uniforms[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(prog, info.name);
  }
  return { prog, u: uniforms, name };
}

/** Upload an interleaved mesh (Float32Array of VERTEX_FLOATS per vertex) with Uint32 indices. */
export function createMesh(gl, vertices, indices, dynamic = false, floats = VERTEX_FLOATS) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
  const stride = floats * 4;
  gl.enableVertexAttribArray(ATTR.pos);
  gl.vertexAttribPointer(ATTR.pos, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(ATTR.nrm);
  gl.vertexAttribPointer(ATTR.nrm, 3, gl.FLOAT, false, stride, 12);
  gl.enableVertexAttribArray(ATTR.uv);
  gl.vertexAttribPointer(ATTR.uv, 2, gl.FLOAT, false, stride, 24);
  gl.enableVertexAttribArray(ATTR.col);
  gl.vertexAttribPointer(ATTR.col, 4, gl.FLOAT, false, stride, 32);
  if (floats === TINTED_FLOATS) {
    gl.enableVertexAttribArray(ATTR.tint);
    gl.vertexAttribPointer(ATTR.tint, 3, gl.FLOAT, false, stride, 48);
  }
  let ibo = null;
  if (indices) {
    ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
  }
  gl.bindVertexArray(null);
  return { vao, vbo, ibo, count: indices ? indices.length : vertices.length / floats, indexed: !!indices, capacity: vertices.length };
}

export function updateMesh(gl, mesh, vertices, vertexCount) {
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
  if (vertices.length > mesh.capacity) {
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
    mesh.capacity = vertices.length;
  } else {
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices, 0, vertexCount * VERTEX_FLOATS);
  }
  mesh.count = vertexCount;
}

export function textureFromCanvas(gl, canvas, { srgb = true, repeat = true, mips = true, aniso = null } = {}) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  if (mips) {
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  } else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
  return tex;
}

export function createShadowTarget(gl, size) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, size, size);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
  gl.drawBuffers([gl.NONE]);
  gl.readBuffer(gl.NONE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, size };
}
