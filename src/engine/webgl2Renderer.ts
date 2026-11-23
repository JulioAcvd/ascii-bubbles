import { getCrtProfile } from './crt';
import { buildGlyphAtlas } from './glyphAtlas';
import { BACKGROUND_RGB } from './palette';
import type { AsciiRenderer } from './renderer';
import type { ActiveBackend, CrtRenderParams, GridBuffer } from './types';

const VERTEX_SHADER_SRC = `#version 300 es
precision highp float;

layout(location = 0) in uint aGlyph;
layout(location = 1) in vec4 aColor;

uniform int uCols;
uniform vec2 uCellSize;
uniform vec2 uViewport;
uniform float uGlyphCount;

out vec2 vUv;
out vec4 vColor;

const vec2 QUAD_POS[6] = vec2[6](
  vec2(0.0, 0.0),
  vec2(1.0, 0.0),
  vec2(0.0, 1.0),
  vec2(1.0, 0.0),
  vec2(1.0, 1.0),
  vec2(0.0, 1.0)
);

void main() {
  if (aGlyph == 0u || aColor.a <= 0.004) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
    vUv = vec2(0.0);
    vColor = vec4(0.0);
    return;
  }

  int idx = gl_InstanceID;
  int col = idx % uCols;
  int row = idx / uCols;

  vec2 corner = QUAD_POS[gl_VertexID];
  vec2 pixelPos = (vec2(float(col), float(row)) + corner) * uCellSize;

  vec2 ndc = (pixelPos / uViewport) * 2.0 - 1.0;
  ndc.y = -ndc.y;
  gl_Position = vec4(ndc, 0.0, 1.0);

  float g = float(aGlyph);
  float u0 = g / uGlyphCount;
  float u1 = (g + 1.0) / uGlyphCount;
  vUv = vec2(mix(u0, u1, corner.x), corner.y);
  vColor = aColor;
}
`;

const FRAGMENT_SHADER_SRC = `#version 300 es
precision mediump float;

uniform sampler2D uAtlas;

in vec2 vUv;
in vec4 vColor;

out vec4 outColor;

void main() {
  float mask = texture(uAtlas, vUv).a;
  if (mask <= 0.02) discard;

  float alpha = mask * vColor.a;
  outColor = vec4(vColor.rgb, alpha);
}
`;

// Full-screen triangle vertex shader for zero-overhead CRT post-processing
const CRT_VERTEX_SHADER_SRC = `#version 300 es
precision highp float;

out vec2 vUv;

void main() {
  vec2 pos = vec2((gl_VertexID == 1) ? 3.0 : -1.0, (gl_VertexID == 2) ? 3.0 : -1.0);
  vUv = pos * 0.5 + 0.5;
  gl_Position = vec4(pos, 0.0, 1.0);
}
`;

// Authentic Retro CRT TV post-process: barrel curvature, RGB convergence shift,
// phosphor bloom/halation, vivid color boost, scanlines, aperture grille & glass vignette.
const CRT_FRAGMENT_SHADER_SRC = `#version 300 es
precision highp float;

uniform sampler2D uScene;
uniform vec2 uResolution;
uniform float uTime;
uniform float uCurvature;
uniform float uScanline;
uniform float uGrille;
uniform float uChromaticPx;
uniform float uBloom;
uniform float uVibrance;
uniform float uVignette;

in vec2 vUv;
out vec4 outColor;

vec2 barrelWarp(vec2 uv, float k) {
  vec2 c = uv * 2.0 - 1.0;
  vec2 offset = c.yx * c.yx;
  c += c * offset * k;
  return c * 0.5 + 0.5;
}

vec3 boostVibrance(vec3 col, float amount) {
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float maxC = max(col.r, max(col.g, col.b));
  float minC = min(col.r, min(col.g, col.b));
  float sat = maxC - minC;
  // Boost colorful pixels strongly while keeping near-white specular highlights clean
  float boost = 1.0 + amount * (1.15 - sat * 0.55);
  vec3 vivid = mix(vec3(luma), col, boost);
  // Subtle CRT phosphor gamma richness (deep blacks, luminous mids/highs)
  vivid = pow(max(vivid, vec3(0.0)), vec3(0.92));
  return clamp(vivid * (1.0 + amount * 0.18), 0.0, 1.35);
}

void main() {
  vec2 uv = barrelWarp(vUv, uCurvature);

  // Soft rounded CRT tube bezel mask outside curved glass
  vec2 edge = abs(uv * 2.0 - 1.0);
  if (edge.x > 1.0 || edge.y > 1.0) {
    outColor = vec4(0.012, 0.015, 0.024, 1.0);
    return;
  }

  vec2 texel = 1.0 / max(uResolution, vec2(1.0));
  float radial = length(uv * 2.0 - 1.0);

  // 1. Analog RGB phosphor convergence offset (slightly stronger toward tube corners)
  float caPx = uChromaticPx * (0.65 + 0.55 * radial);
  vec2 caShift = vec2(caPx * texel.x, 0.0);

  float r = texture(uScene, clamp(uv + caShift, 0.0, 1.0)).r;
  float g = texture(uScene, uv).g;
  float b = texture(uScene, clamp(uv - caShift, 0.0, 1.0)).b;
  vec3 baseCol = vec3(r, g, b);

  // 2. Phosphor bloom / halation (9-tap circular kernel makes iridescent rims glow!)
  vec3 glow = vec3(0.0);
  if (uBloom > 0.01) {
    vec2 r1 = texel * 1.85;
    vec2 r2 = texel * 3.8;
    glow += texture(uScene, clamp(uv + vec2(r1.x, 0.0), 0.0, 1.0)).rgb * 0.16;
    glow += texture(uScene, clamp(uv - vec2(r1.x, 0.0), 0.0, 1.0)).rgb * 0.16;
    glow += texture(uScene, clamp(uv + vec2(0.0, r1.y), 0.0, 1.0)).rgb * 0.16;
    glow += texture(uScene, clamp(uv - vec2(0.0, r1.y), 0.0, 1.0)).rgb * 0.16;
    glow += texture(uScene, clamp(uv + vec2(r2.x, r2.y), 0.0, 1.0)).rgb * 0.09;
    glow += texture(uScene, clamp(uv + vec2(-r2.x, r2.y), 0.0, 1.0)).rgb * 0.09;
    glow += texture(uScene, clamp(uv + vec2(r2.x, -r2.y), 0.0, 1.0)).rgb * 0.09;
    glow += texture(uScene, clamp(uv + vec2(-r2.x, -r2.y), 0.0, 1.0)).rgb * 0.09;

    // Emphasize bright phosphor characters over dark background
    vec3 brightGlow = max(glow - vec3(0.035, 0.042, 0.068), vec3(0.0));
    baseCol += brightGlow * uBloom * 1.15;
  }

  // 3. Vibrant CRT phosphor color lift
  vec3 color = boostVibrance(baseCol, uVibrance);

  // 4. Horizontal CRT scanlines (proportional to logical height so mobile & 4K look balanced)
  float scanFreq = clamp(uResolution.y * 0.42, 180.0, 420.0);
  float scanWave = 0.5 + 0.5 * sin(uv.y * scanFreq * 6.2831853);
  float scanMask = 1.0 - uScanline * (1.0 - pow(scanWave, 0.72));
  color *= scanMask;

  // 5. RGB Aperture Grille phosphor triad micro-mask
  float triad = mod(floor(gl_FragCoord.x), 3.0);
  vec3 grilleTint =
    triad < 0.5 ? vec3(1.0 + uGrille * 0.42, 1.0 - uGrille * 0.22, 1.0 - uGrille * 0.22) :
    triad < 1.5 ? vec3(1.0 - uGrille * 0.22, 1.0 + uGrille * 0.42, 1.0 - uGrille * 0.22) :
                  vec3(1.0 - uGrille * 0.22, 1.0 - uGrille * 0.22, 1.0 + uGrille * 0.42);
  color *= grilleTint;

  // 6. Subtle analog hum bar drifting slowly down the tube + gentle glass sheen
  float rollBar = 0.5 + 0.5 * sin((uv.y + uTime * 0.055) * 6.2831853);
  color *= 1.0 + pow(rollBar, 8.0) * 0.045;

  // Subtle curved glass highlight near upper-left (WebGL uv.y = 1.0 is top)
  float glassGlare = exp(-dot(uv - vec2(0.28, 0.86), uv - vec2(0.28, 0.86)) * 4.5);
  color += vec3(0.022, 0.030, 0.045) * glassGlare * (0.4 + uCurvature * 4.0);

  // 7. Rounded tube bezel softening & corner vignette
  vec2 borderFade = smoothstep(1.0, 0.972, edge);
  float bezelMask = borderFade.x * borderFade.y;
  float vig = 1.0 - uVignette * dot(uv - 0.5, uv - 0.5) * 2.15;
  color *= clamp(vig, 0.35, 1.0) * bezelMask;

  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error('Failed to create WebGL2 shader');
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) ?? 'Unknown shader compile error';
    gl.deleteShader(shader);
    throw new Error(info);
  }
  return shader;
}

function linkProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    throw new Error('Failed to create WebGL2 program');
  }

  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) ?? 'Program link failed';
    gl.deleteProgram(program);
    throw new Error(info);
  }
  return program;
}

export class WebGL2AsciiRenderer implements AsciiRenderer {
  readonly backend: ActiveBackend = 'webgl2';

  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private glyphVbo: WebGLBuffer;
  private colorVbo: WebGLBuffer;
  private atlasTex: WebGLTexture;

  // Offscreen FBO + CRT post-process pipeline
  private postProgram: WebGLProgram;
  private postVao: WebGLVertexArrayObject;
  private fbo: WebGLFramebuffer;
  private sceneTex: WebGLTexture;
  private fboWidth = 0;
  private fboHeight = 0;

  private uColsLoc: WebGLUniformLocation | null;
  private uCellSizeLoc: WebGLUniformLocation | null;
  private uViewportLoc: WebGLUniformLocation | null;
  private uGlyphCountLoc: WebGLUniformLocation | null;
  private uAtlasLoc: WebGLUniformLocation | null;

  private uSceneLoc: WebGLUniformLocation | null;
  private uResolutionLoc: WebGLUniformLocation | null;
  private uTimeLoc: WebGLUniformLocation | null;
  private uCurvatureLoc: WebGLUniformLocation | null;
  private uScanlineLoc: WebGLUniformLocation | null;
  private uGrilleLoc: WebGLUniformLocation | null;
  private uChromaticLoc: WebGLUniformLocation | null;
  private uBloomLoc: WebGLUniformLocation | null;
  private uVibranceLoc: WebGLUniformLocation | null;
  private uVignetteLoc: WebGLUniformLocation | null;

  private capacity = 0;
  private viewportW = 1;
  private viewportH = 1;
  private backingW = 1;
  private backingH = 1;
  private dpr = 1;
  private glyphCount = 1;
  private atlasFontSize = -1;
  private atlasDpr = -1;

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.gl = gl;

    this.program = linkProgram(gl, VERTEX_SHADER_SRC, FRAGMENT_SHADER_SRC);
    this.postProgram = linkProgram(gl, CRT_VERTEX_SHADER_SRC, CRT_FRAGMENT_SHADER_SRC);

    const vao = gl.createVertexArray();
    const postVao = gl.createVertexArray();
    const glyphVbo = gl.createBuffer();
    const colorVbo = gl.createBuffer();
    const atlasTex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    const sceneTex = gl.createTexture();

    if (!vao || !postVao || !glyphVbo || !colorVbo || !atlasTex || !fbo || !sceneTex) {
      throw new Error('Failed to allocate WebGL2 GPU resources');
    }

    this.vao = vao;
    this.postVao = postVao;
    this.glyphVbo = glyphVbo;
    this.colorVbo = colorVbo;
    this.atlasTex = atlasTex;
    this.fbo = fbo;
    this.sceneTex = sceneTex;

    this.uColsLoc = gl.getUniformLocation(this.program, 'uCols');
    this.uCellSizeLoc = gl.getUniformLocation(this.program, 'uCellSize');
    this.uViewportLoc = gl.getUniformLocation(this.program, 'uViewport');
    this.uGlyphCountLoc = gl.getUniformLocation(this.program, 'uGlyphCount');
    this.uAtlasLoc = gl.getUniformLocation(this.program, 'uAtlas');

    this.uSceneLoc = gl.getUniformLocation(this.postProgram, 'uScene');
    this.uResolutionLoc = gl.getUniformLocation(this.postProgram, 'uResolution');
    this.uTimeLoc = gl.getUniformLocation(this.postProgram, 'uTime');
    this.uCurvatureLoc = gl.getUniformLocation(this.postProgram, 'uCurvature');
    this.uScanlineLoc = gl.getUniformLocation(this.postProgram, 'uScanline');
    this.uGrilleLoc = gl.getUniformLocation(this.postProgram, 'uGrille');
    this.uChromaticLoc = gl.getUniformLocation(this.postProgram, 'uChromaticPx');
    this.uBloomLoc = gl.getUniformLocation(this.postProgram, 'uBloom');
    this.uVibranceLoc = gl.getUniformLocation(this.postProgram, 'uVibrance');
    this.uVignetteLoc = gl.getUniformLocation(this.postProgram, 'uVignette');

    // Configure VAO with per-instance glyph & RGBA attributes
    gl.bindVertexArray(this.vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.glyphVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribIPointer(0, 1, gl.UNSIGNED_BYTE, 0, 0);
    gl.vertexAttribDivisor(0, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorVbo);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.UNSIGNED_BYTE, true, 0, 0);
    gl.vertexAttribDivisor(1, 1);

    gl.bindVertexArray(null);

    // Configure scene texture sampling for CRT post-process
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(
      BACKGROUND_RGB[0] / 255,
      BACKGROUND_RGB[1] / 255,
      BACKGROUND_RGB[2] / 255,
      1
    );
  }

  static tryCreate(canvas: HTMLCanvasElement): WebGL2AsciiRenderer | null {
    try {
      const gl = canvas.getContext('webgl2', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: 'high-performance',
      });
      if (!gl) return null;
      return new WebGL2AsciiRenderer(canvas, gl);
    } catch {
      return null;
    }
  }

  resize(width: number, height: number, dpr: number, fontSize: number): void {
    this.viewportW = Math.max(1, width);
    this.viewportH = Math.max(1, height);
    this.dpr = Math.max(1, Math.min(2.5, dpr));

    this.backingW = Math.max(1, Math.round(this.viewportW * this.dpr));
    this.backingH = Math.max(1, Math.round(this.viewportH * this.dpr));
    if (this.canvas.width !== this.backingW || this.canvas.height !== this.backingH) {
      this.canvas.width = this.backingW;
      this.canvas.height = this.backingH;
    }
    this.gl.viewport(0, 0, this.backingW, this.backingH);

    if (this.atlasFontSize !== fontSize || Math.abs(this.atlasDpr - this.dpr) > 0.05) {
      this.rebuildAtlas(fontSize, this.dpr);
    }
  }

  render(grid: GridBuffer, crt?: CrtRenderParams): void {
    const gl = this.gl;
    const cellCount = grid.cols * grid.rows;
    if (cellCount <= 0) return;

    if (cellCount > this.capacity) {
      this.capacity = cellCount;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.glyphVbo);
      gl.bufferData(gl.ARRAY_BUFFER, this.capacity, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.colorVbo);
      gl.bufferData(gl.ARRAY_BUFFER, this.capacity * 4, gl.DYNAMIC_DRAW);
    }

    const useCrt = Boolean(crt && crt.mode !== 'off');
    if (useCrt) {
      this.ensureFboSize();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.viewport(0, 0, this.backingW, this.backingH);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.backingW, this.backingH);
    }

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.glyphVbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, grid.glyphIdx);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorVbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, grid.rgba);

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);

    gl.uniform1i(this.uColsLoc, grid.cols);
    gl.uniform2f(this.uCellSizeLoc, grid.cellW, grid.cellH);
    gl.uniform2f(this.uViewportLoc, this.viewportW, this.viewportH);
    gl.uniform1f(this.uGlyphCountLoc, this.glyphCount);
    gl.uniform1i(this.uAtlasLoc, 0);

    // Pass 1: Single instanced draw call for the entire ASCII grid
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, cellCount);
    gl.bindVertexArray(null);

    if (!useCrt || !crt) return;

    // Pass 2: Full-screen CRT Retro TV post-processing shader (1 triangle!)
    const profile = getCrtProfile(crt.mode, crt.intensity);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.backingW, this.backingH);
    gl.disable(gl.BLEND);

    gl.useProgram(this.postProgram);
    gl.bindVertexArray(this.postVao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);

    gl.uniform1i(this.uSceneLoc, 0);
    gl.uniform2f(this.uResolutionLoc, this.backingW, this.backingH);
    gl.uniform1f(this.uTimeLoc, crt.time);
    gl.uniform1f(this.uCurvatureLoc, profile.curvature);
    gl.uniform1f(this.uScanlineLoc, profile.scanline);
    gl.uniform1f(this.uGrilleLoc, profile.grille);
    gl.uniform1f(this.uChromaticLoc, profile.chromaticPx * this.dpr);
    gl.uniform1f(this.uBloomLoc, profile.bloom);
    gl.uniform1f(this.uVibranceLoc, profile.vibrance);
    gl.uniform1f(this.uVignetteLoc, profile.vignette);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteTexture(this.atlasTex);
    gl.deleteTexture(this.sceneTex);
    gl.deleteFramebuffer(this.fbo);
    gl.deleteBuffer(this.glyphVbo);
    gl.deleteBuffer(this.colorVbo);
    gl.deleteVertexArray(this.vao);
    gl.deleteVertexArray(this.postVao);
    gl.deleteProgram(this.program);
    gl.deleteProgram(this.postProgram);
  }

  private ensureFboSize(): void {
    if (this.fboWidth === this.backingW && this.fboHeight === this.backingH) return;
    const gl = this.gl;
    this.fboWidth = this.backingW;
    this.fboHeight = this.backingH;

    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      this.fboWidth,
      this.fboHeight,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sceneTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  private rebuildAtlas(fontSize: number, dpr: number): void {
    const atlas = buildGlyphAtlas(fontSize, dpr);
    this.glyphCount = atlas.glyphCount;
    this.atlasFontSize = fontSize;
    this.atlasDpr = dpr;

    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }
}
