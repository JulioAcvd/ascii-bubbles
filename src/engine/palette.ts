/**
 * Pure classic 7-bit ASCII glyph table and physical thin-film interference LUT.
 */
export const GLYPH_CHARS = [
  ' ',  // 0: empty
  '.',  // 1
  ',',  // 2
  '\'', // 3
  '`',  // 4
  ':',  // 5
  ';',  // 6
  '-',  // 7
  '~',  // 8
  '=',  // 9
  '+',  // 10
  'x',  // 11
  '*',  // 12
  '#',  // 13
  '%',  // 14
  '@',  // 15
  '(',  // 16
  ')',  // 17
  '/',  // 18
  '\\', // 19
  '_',  // 20
  '^',  // 21
  '|',  // 22
  'o',  // 23
  'O',  // 24
  'c',  // 25
  '0',  // 26
  '8',  // 27
  '$',  // 28
  '"',  // 29
  '!',  // 30
] as const;

export const GLYPH = {
  SPACE: 0,
  DOT: 1,
  COMMA: 2,
  APOS: 3,
  GRAVE: 4,
  COLON: 5,
  SEMI: 6,
  DASH: 7,
  TILDE: 8,
  EQ: 9,
  PLUS: 10,
  X: 11,
  STAR: 12,
  HASH: 13,
  PERCENT: 14,
  AT: 15,
  LPAREN: 16,
  RPAREN: 17,
  SLASH: 18,
  BSLASH: 19,
  UNDER: 20,
  CARET: 21,
  PIPE: 22,
  LOWER_O: 23,
  UPPER_O: 24,
  LOWER_C: 25,
  ZERO: 26,
  EIGHT: 27,
  DOLLAR: 28,
  QUOTE: 29,
  BANG: 30,
} as const;

/** Original preset density ramp */
export const DENSITY_RAMP = [
  GLYPH.DOT,
  GLYPH.COLON,
  GLYPH.DASH,
  GLYPH.TILDE,
  GLYPH.EQ,
  GLYPH.PLUS,
  GLYPH.STAR,
  GLYPH.HASH,
  GLYPH.PERCENT,
  GLYPH.AT,
] as const;

/** Smooth, fine optical-luminance ASCII ramp for photorealistic soap-film gradients */
export const REALISTIC_RAMP = [
  GLYPH.DOT,
  GLYPH.COMMA,
  GLYPH.APOS,
  GLYPH.COLON,
  GLYPH.SEMI,
  GLYPH.TILDE,
  GLYPH.DASH,
  GLYPH.EQ,
  GLYPH.PLUS,
  GLYPH.STAR,
  GLYPH.PERCENT,
  GLYPH.HASH,
  GLYPH.AT,
] as const;

/** Ultra-delicate sparkling crystalline ASCII ramp */
export const CRYSTALLINE_RAMP = [
  GLYPH.DOT,
  GLYPH.APOS,
  GLYPH.GRAVE,
  GLYPH.COLON,
  GLYPH.SEMI,
  GLYPH.PLUS,
  GLYPH.STAR,
  GLYPH.LOWER_O,
  GLYPH.UPPER_O,
  GLYPH.AT,
] as const;

/** Rich, sculptural high-density ASCII shading ramp */
export const DENSE_RAMP = [
  GLYPH.DOT,
  GLYPH.COLON,
  GLYPH.DASH,
  GLYPH.EQ,
  GLYPH.PLUS,
  GLYPH.LOWER_O,
  GLYPH.STAR,
  GLYPH.UPPER_O,
  GLYPH.ZERO,
  GLYPH.HASH,
  GLYPH.EIGHT,
  GLYPH.PERCENT,
  GLYPH.DOLLAR,
  GLYPH.AT,
] as const;

/** Soft rounded organic ASCII ramp */
export const ORGANIC_RAMP = [
  GLYPH.DOT,
  GLYPH.COMMA,
  GLYPH.COLON,
  GLYPH.TILDE,
  GLYPH.LOWER_C,
  GLYPH.LOWER_O,
  GLYPH.PLUS,
  GLYPH.STAR,
  GLYPH.UPPER_O,
  GLYPH.AT,
] as const;

export const BACKGROUND_HEX = '#07090f';
export const BACKGROUND_RGB = [7, 9, 15] as const;

const TWO_PI = Math.PI * 2;

/**
 * 256-entry thin-film optical interference RGB lookup table.
 * Models constructive/destructive interference of soap film across
 * R (~650nm), G (~532nm), and B (~460nm) wavelengths with pearlescent lift
 * so bubbles shimmer realistically in cyan, magenta, lavender, seafoam, and gold
 * against a deep dark backdrop.
 */
export const IRIDESCENCE_LUT = new Uint8Array(256 * 3);

function buildIridescenceLut(): void {
  const phaseR = 0.0;
  const phaseG = 1.92;
  const phaseB = 3.85;

  for (let i = 0; i < 256; i++) {
    const t = (i / 256) * TWO_PI;

    const rWave = 0.5 + 0.5 * Math.cos(t + phaseR + 0.22 * Math.sin(t * 2.0));
    const gWave = 0.5 + 0.5 * Math.cos(t + phaseG + 0.18 * Math.sin(t * 2.0 + 0.9));
    const bWave = 0.5 + 0.5 * Math.cos(t + phaseB + 0.20 * Math.sin(t * 2.0 + 1.7));

    const r = Math.round(92 + 160 * Math.pow(rWave, 0.85));
    const g = Math.round(108 + 145 * Math.pow(gWave, 0.85));
    const b = Math.round(126 + 129 * Math.pow(bWave, 0.82));

    const off = i * 3;
    IRIDESCENCE_LUT[off] = r > 255 ? 255 : r;
    IRIDESCENCE_LUT[off + 1] = g > 255 ? 255 : g;
    IRIDESCENCE_LUT[off + 2] = b > 255 ? 255 : b;
  }
}

buildIridescenceLut();

/**
 * Sample thin-film RGB bytes from the precomputed LUT using any phase in radians.
 */
export function sampleIridescenceIndex(phaseRad: number): number {
  const norm = ((phaseRad / TWO_PI) % 1 + 1) % 1;
  return (norm * 256) & 255;
}
