import { buildGlyphAtlas } from './glyphAtlas';
import { BACKGROUND_RGB } from './palette';
import type { AsciiRenderer } from './renderer';
import type { ActiveBackend, GridBuffer } from './types';

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
  // Collapse empty cells off-screen so GPU skips fragment rasterization completely
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

  // Convert top-left pixel coordinates to NDC [-1, 1]
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

  // Crisp glyph coverage with subtle luminosity lift on bright highlights
  float alpha = mask * vColor.a;
  outColor = vec4(vColor.rgb, alpha);
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

export class WebGL2AsciiRenderer implements AsciiRenderer {
  readonly backend: ActiveBackend = 'webgl2';

  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private glyphVbo: WebGLBuffer;
  private colorVbo: WebGLBuffer;
  private atlasTex: WebGLTexture;

  private uColsLoc: WebGLUniformLocation | null;
  private uCellSizeLoc: WebGLUniformLocation | null;
  private uViewportLoc: WebGLUniformLocation | null;
  private uGlyphCountLoc: WebGLUniformLocation | null;
  private uAtlasLoc: WebGLUniformLocation | null;

  private capacity = 0;
  private viewportW = 1;
  private viewportH = 1;
  private dpr = 1;
  private glyphCount = 1;
  private atlasFontSize = -1;
  private atlasDpr = -1;

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.gl = gl;

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SRC);
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

    this.program = program;

    const vao = gl.createVertexArray();
    const glyphVbo = gl.createBuffer();
    const colorVbo = gl.createBuffer();
    const atlasTex = gl.createTexture();
    if (!vao || !glyphVbo || !colorVbo || !atlasTex) {
      throw new Error('Failed to allocate WebGL2 GPU resources');
    }

    this.vao = vao;
    this.glyphVbo = glyphVbo;
    this.colorVbo = colorVbo;
    this.atlasTex = atlasTex;

    this.uColsLoc = gl.getUniformLocation(program, 'uCols');
    this.uCellSizeLoc = gl.getUniformLocation(program, 'uCellSize');
    this.uViewportLoc = gl.getUniformLocation(program, 'uViewport');
    this.uGlyphCountLoc = gl.getUniformLocation(program, 'uGlyphCount');
    this.uAtlasLoc = gl.getUniformLocation(program, 'uAtlas');

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
        desynchronized: true,
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

    const backingW = Math.max(1, Math.round(this.viewportW * this.dpr));
    const backingH = Math.max(1, Math.round(this.viewportH * this.dpr));
    if (this.canvas.width !== backingW || this.canvas.height !== backingH) {
      this.canvas.width = backingW;
      this.canvas.height = backingH;
    }
    this.gl.viewport(0, 0, backingW, backingH);

    if (this.atlasFontSize !== fontSize || Math.abs(this.atlasDpr - this.dpr) > 0.05) {
      this.rebuildAtlas(fontSize, this.dpr);
    }
  }

  render(grid: GridBuffer): void {
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

    // Single instanced draw call for the entire ASCII viewport!
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, cellCount);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteTexture(this.atlasTex);
    gl.deleteBuffer(this.glyphVbo);
    gl.deleteBuffer(this.colorVbo);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
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
