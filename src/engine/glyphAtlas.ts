import { GLYPH_CHARS } from './palette';

export const MONO_FONT_FAMILY =
  "'JetBrains Mono', ui-monospace, 'Cascadia Mono', 'SFMono-Regular', Menlo, Consolas, monospace";

export interface CellMetrics {
  fontSize: number;
  cellW: number;
  cellH: number;
}

export interface GlyphAtlas {
  canvas: HTMLCanvasElement;
  glyphCount: number;
  cellW: number;
  cellH: number;
  texCellW: number;
  texCellH: number;
  dpr: number;
}

let measureCtx: CanvasRenderingContext2D | null = null;

export function measureCellMetrics(fontSize: number): CellMetrics {
  const clamped = Math.max(8, Math.min(28, Math.round(fontSize)));
  if (typeof document === 'undefined') {
    return {
      fontSize: clamped,
      cellW: Math.max(5, Math.round(clamped * 0.62)),
      cellH: Math.max(8, Math.round(clamped * 1.18)),
    };
  }

  if (!measureCtx) {
    const c = document.createElement('canvas');
    measureCtx = c.getContext('2d');
  }

  if (!measureCtx) {
    return {
      fontSize: clamped,
      cellW: clamped * 0.62,
      cellH: clamped * 1.18,
    };
  }

  measureCtx.font = `500 ${clamped}px ${MONO_FONT_FAMILY}`;
  const metrics = measureCtx.measureText('M');
  const measuredW = metrics.width > 0 ? metrics.width : clamped * 0.62;

  return {
    fontSize: clamped,
    cellW: Math.max(5, Math.round(measuredW * 10) / 10),
    cellH: Math.max(8, Math.round(clamped * 1.16 * 10) / 10),
  };
}

/**
 * Renders every pure ASCII glyph once onto a crisp DPR-scaled horizontal strip texture.
 */
export function buildGlyphAtlas(fontSize: number, dpr: number): GlyphAtlas {
  const safeDpr = Math.max(1, Math.min(2.5, dpr));
  const metrics = measureCellMetrics(fontSize);
  const glyphCount = GLYPH_CHARS.length;

  const texCellW = Math.max(8, Math.ceil(metrics.cellW * safeDpr));
  const texCellH = Math.max(10, Math.ceil(metrics.cellH * safeDpr));

  const canvas = document.createElement('canvas');
  canvas.width = texCellW * glyphCount;
  canvas.height = texCellH;

  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.font = `500 ${metrics.fontSize * safeDpr}px ${MONO_FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const centerY = texCellH * 0.52;
    for (let i = 0; i < glyphCount; i++) {
      const ch = GLYPH_CHARS[i];
      if (ch === ' ') continue;
      ctx.fillText(ch, i * texCellW + texCellW * 0.5, centerY);
    }
  }

  return {
    canvas,
    glyphCount,
    cellW: metrics.cellW,
    cellH: metrics.cellH,
    texCellW,
    texCellH,
    dpr: safeDpr,
  };
}
