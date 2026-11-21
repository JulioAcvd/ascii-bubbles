import { MONO_FONT_FAMILY } from './glyphAtlas';
import { BACKGROUND_HEX, GLYPH, GLYPH_CHARS } from './palette';
import type { AsciiRenderer } from './renderer';
import type { ActiveBackend, GridBuffer } from './types';

/**
 * Optimized Canvas 2D ASCII fallback renderer.
 * Skips empty space (~80% of cells) and quantizes RGBA keys to minimize fillStyle churn.
 */
export class Canvas2DAsciiRenderer implements AsciiRenderer {
  readonly backend: ActiveBackend = 'canvas2d';

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private fontSize = 12;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', {
      alpha: false,
    });
    if (!ctx) {
      throw new Error('Canvas 2D context unavailable');
    }
    this.canvas = canvas;
    this.ctx = ctx;
  }

  resize(width: number, height: number, dpr: number, fontSize: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.dpr = Math.max(1, Math.min(2, dpr));
    this.fontSize = fontSize;

    const backingW = Math.max(1, Math.round(this.width * this.dpr));
    const backingH = Math.max(1, Math.round(this.height * this.dpr));
    if (this.canvas.width !== backingW || this.canvas.height !== backingH) {
      this.canvas.width = backingW;
      this.canvas.height = backingH;
    }

    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.font = `500 ${this.fontSize}px ${MONO_FONT_FAMILY}`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
  }

  render(grid: GridBuffer): void {
    const ctx = this.ctx;
    const { cols, rows, cellW, cellH, glyphIdx, rgba } = grid;

    ctx.fillStyle = BACKGROUND_HEX;
    ctx.fillRect(0, 0, this.width, this.height);

    let lastColorKey = -1;
    const halfW = cellW * 0.5;
    const halfH = cellH * 0.52;

    for (let row = 0; row < rows; row++) {
      const py = row * cellH + halfH;
      const rowOffset = row * cols;

      for (let col = 0; col < cols; col++) {
        const idx = rowOffset + col;
        const g = glyphIdx[idx];
        if (g === GLYPH.SPACE) continue;

        const off = idx * 4;
        const aByte = rgba[off + 3];
        if (aByte < 4) continue;

        // Quantize color to 5-bit RGB + 5-bit alpha to cut redundant CSS fillStyle updates
        const rq = rgba[off] & 0xf8;
        const gq = rgba[off + 1] & 0xf8;
        const bq = rgba[off + 2] & 0xf8;
        const aq = aByte & 0xf8;
        const colorKey = (rq << 24) | (gq << 16) | (bq << 8) | aq;

        if (colorKey !== lastColorKey) {
          lastColorKey = colorKey;
          ctx.fillStyle = `rgba(${rq},${gq},${bq},${(aq / 255).toFixed(2)})`;
        }

        ctx.fillText(GLYPH_CHARS[g], col * cellW + halfW, py);
      }
    }
  }

  dispose(): void {
    // Nothing to explicitly release on Canvas 2D
  }
}
