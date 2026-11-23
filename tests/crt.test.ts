import { describe, expect, it } from 'vitest';
import { getCrtProfile } from '../src/engine/crt';

describe('CRT retro TV profiles', () => {
  it('returns zeroed values when CRT mode is off', () => {
    const off = getCrtProfile('off', 1.2);
    expect(off.curvature).toBe(0);
    expect(off.scanline).toBe(0);
    expect(off.bloom).toBe(0);
    expect(off.vibrance).toBe(0);
    expect(off.chromaticPx).toBe(0);
  });

  it('produces distinct retro TV characteristics across subtle, classic, and arcade modes', () => {
    const subtle = getCrtProfile('subtle', 1);
    const classic = getCrtProfile('classic', 1);
    const arcade = getCrtProfile('arcade', 1);

    // Classic TV Retro has the strongest barrel tube curvature
    expect(classic.curvature).toBeGreaterThan(subtle.curvature);
    expect(classic.curvature).toBeGreaterThan(arcade.curvature);

    // Arcade maximizes phosphor bloom & color vibrance pop
    expect(arcade.bloom).toBeGreaterThan(classic.bloom);
    expect(arcade.vibrance).toBeGreaterThan(classic.vibrance);
    expect(classic.vibrance).toBeGreaterThan(subtle.vibrance);
  });

  it('scales cleanly with intensity and clamps safe upper bounds', () => {
    const low = getCrtProfile('classic', 0.4);
    const high = getCrtProfile('classic', 1.5);
    expect(high.bloom).toBeGreaterThan(low.bloom);
    expect(high.scanline).toBeLessThanOrEqual(0.65);
    expect(high.vignette).toBeLessThanOrEqual(0.75);
  });
});
