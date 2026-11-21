import { describe, expect, it } from 'vitest';
import {
  CRYSTALLINE_RAMP,
  DENSE_RAMP,
  DENSITY_RAMP,
  GLYPH_CHARS,
  IRIDESCENCE_LUT,
  ORGANIC_RAMP,
  REALISTIC_RAMP,
  sampleIridescenceIndex,
} from '../src/engine/palette';

describe('palette', () => {
  it('uses strictly pure 7-bit printable ASCII characters', () => {
    for (const ch of GLYPH_CHARS) {
      expect(ch.length).toBe(1);
      const code = ch.charCodeAt(0);
      expect(code).toBeGreaterThanOrEqual(32);
      expect(code).toBeLessThanOrEqual(126);
    }
  });

  it('keeps all style ramp indices within GLYPH_CHARS bounds', () => {
    const allRamps = [DENSITY_RAMP, REALISTIC_RAMP, CRYSTALLINE_RAMP, DENSE_RAMP, ORGANIC_RAMP];
    for (const ramp of allRamps) {
      for (const idx of ramp) {
        expect(idx).toBeGreaterThan(0);
        expect(idx).toBeLessThan(GLYPH_CHARS.length);
      }
    }
  });

  it('produces vibrant, non-dark thin-film iridescence RGB values across the full 256 LUT', () => {
    expect(IRIDESCENCE_LUT.length).toBe(256 * 3);
    let minChannel = 255;
    let maxChannel = 0;
    for (let i = 0; i < 256; i++) {
      const r = IRIDESCENCE_LUT[i * 3];
      const g = IRIDESCENCE_LUT[i * 3 + 1];
      const b = IRIDESCENCE_LUT[i * 3 + 2];
      const lum = (r + g + b) / 3;
      expect(lum).toBeGreaterThan(105);
      minChannel = Math.min(minChannel, r, g, b);
      maxChannel = Math.max(maxChannel, r, g, b);
    }
    expect(maxChannel - minChannel).toBeGreaterThan(120);
  });

  it('wraps negative and large phases cleanly into [0, 255]', () => {
    expect(sampleIridescenceIndex(0)).toBe(0);
    expect(sampleIridescenceIndex(-0.1)).toBeGreaterThanOrEqual(0);
    expect(sampleIridescenceIndex(-0.1)).toBeLessThanOrEqual(255);
    expect(sampleIridescenceIndex(1000)).toBeGreaterThanOrEqual(0);
    expect(sampleIridescenceIndex(1000)).toBeLessThanOrEqual(255);
  });
});
