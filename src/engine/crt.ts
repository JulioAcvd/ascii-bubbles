import type { CrtMode } from './types';

export interface CrtShaderProfile {
  curvature: number;
  scanline: number;
  grille: number;
  chromaticPx: number;
  bloom: number;
  vibrance: number;
  vignette: number;
}

const ZERO_PROFILE: CrtShaderProfile = {
  curvature: 0,
  scanline: 0,
  grille: 0,
  chromaticPx: 0,
  bloom: 0,
  vibrance: 0,
  vignette: 0,
};

const BASE_PROFILES: Record<Exclude<CrtMode, 'off'>, CrtShaderProfile> = {
  subtle: {
    curvature: 0.032,
    scanline: 0.22,
    grille: 0.1,
    chromaticPx: 0.95,
    bloom: 0.62,
    vibrance: 0.36,
    vignette: 0.22,
  },
  classic: {
    curvature: 0.092,
    scanline: 0.38,
    grille: 0.18,
    chromaticPx: 1.9,
    bloom: 0.88,
    vibrance: 0.5,
    vignette: 0.42,
  },
  arcade: {
    curvature: 0.06,
    scanline: 0.32,
    grille: 0.22,
    chromaticPx: 1.5,
    bloom: 1.18,
    vibrance: 0.68,
    vignette: 0.3,
  },
};

export function getCrtProfile(mode: CrtMode, intensity = 1): CrtShaderProfile {
  if (mode === 'off') return ZERO_PROFILE;
  const k = Math.max(0.25, Math.min(1.6, intensity));
  const base = BASE_PROFILES[mode];
  return {
    curvature: base.curvature * (0.45 + 0.55 * k),
    scanline: Math.min(0.65, base.scanline * k),
    grille: Math.min(0.45, base.grille * k),
    chromaticPx: base.chromaticPx * k,
    bloom: base.bloom * k,
    vibrance: base.vibrance * (0.5 + 0.5 * k),
    vignette: Math.min(0.75, base.vignette * (0.55 + 0.45 * k)),
  };
}
