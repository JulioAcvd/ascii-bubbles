import {
  CRYSTALLINE_RAMP,
  DENSE_RAMP,
  DENSITY_RAMP,
  GLYPH,
  IRIDESCENCE_LUT,
  ORGANIC_RAMP,
  REALISTIC_RAMP,
  sampleIridescenceIndex,
} from './palette';
import type { BubbleSimulation } from './physics';
import type { BackgroundStyle, BubbleStyle, GridBuffer } from './types';

// Normalized half-vectors placed cleanly along the curved soap-film arcs
// so highlights land on the upper-left & lower-right curves while keeping the center crystal-clear hollow.
const H1X = -0.525;
const H1Y = -0.545;
const H1Z = 0.654;

const H2X = 0.565;
const H2Y = 0.550;
const H2Z = 0.615;

// Soft overhead dome light for realistic curved window reflection
const H3X = -0.22;
const H3Y = -0.78;
const H3Z = 0.585;

const PI = Math.PI;
const TWO_PI = Math.PI * 2;

export interface RasterizeOptions {
  bubbleStyle?: BubbleStyle;
  backgroundStyle?: BackgroundStyle;
  backgroundOpacity?: number;
  wobbleIntensity?: number;
}

export function createGridBuffer(cols: number, rows: number, cellW: number, cellH: number): GridBuffer {
  const safeCols = Math.max(1, cols);
  const safeRows = Math.max(1, rows);
  const count = safeCols * safeRows;
  return {
    cols: safeCols,
    rows: safeRows,
    cellW,
    cellH,
    glyphIdx: new Uint8Array(count),
    rgba: new Uint8Array(count * 4),
  };
}

/**
 * Picks a pure classic ASCII contour character matching the outer tangent of a circle
 * (used exclusively by the preserved 'classic' preset).
 */
function pickContourGlyph(theta: number): number {
  const absTheta = Math.abs(theta);
  if (absTheta < 0.36) return GLYPH.RPAREN;
  if (absTheta > PI - 0.36) return GLYPH.LPAREN;
  if (theta < -1.18 && theta > -1.96) return GLYPH.DASH;
  if (theta > 1.18 && theta < 1.96) return GLYPH.UNDER;
  if ((theta < 0 && theta > -1.18) || theta > 1.96) {
    return GLYPH.BSLASH;
  }
  return GLYPH.SLASH;
}

/**
 * Alpha-blend a foreground ASCII cell over an existing cell in-place.
 */
function blendCell(
  grid: GridBuffer,
  idx: number,
  glyph: number,
  r: number,
  g: number,
  b: number,
  a: number
): void {
  if (a <= 0.012) return;
  const off = idx * 4;
  const dstA = grid.rgba[off + 3] / 255;

  if (dstA <= 0.01 || grid.glyphIdx[idx] === GLYPH.SPACE) {
    grid.glyphIdx[idx] = glyph;
    grid.rgba[off] = r;
    grid.rgba[off + 1] = g;
    grid.rgba[off + 2] = b;
    grid.rgba[off + 3] = Math.min(255, Math.round(a * 255));
    return;
  }

  const outA = a + dstA * (1 - a);
  const invOutA = 1 / outA;
  const dstW = dstA * (1 - a);

  grid.rgba[off] = Math.min(255, Math.round((r * a + grid.rgba[off] * dstW) * invOutA));
  grid.rgba[off + 1] = Math.min(255, Math.round((g * a + grid.rgba[off + 1] * dstW) * invOutA));
  grid.rgba[off + 2] = Math.min(255, Math.round((b * a + grid.rgba[off + 2] * dstW) * invOutA));
  grid.rgba[off + 3] = Math.min(255, Math.round(outA * 255));

  if (a >= dstA * 0.55) {
    grid.glyphIdx[idx] = glyph;
  }
}

/**
 * Deterministic fast integer hash for subtle per-cell grain without allocations.
 */
function cellHash(col: number, row: number): number {
  let h = (col * 374761393 + row * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Rasterizes the selected low-opacity ASCII background so the viewport feels alive
 * with ASCII texture while keeping bubbles clearly the protagonists.
 */
function rasterizeBackground(
  sim: BubbleSimulation,
  grid: GridBuffer,
  style: BackgroundStyle,
  opacityScale: number
): void {
  if (style === 'none' || opacityScale <= 0.01) return;

  const { cols, rows, cellW, cellH, glyphIdx, rgba } = grid;
  const invCellW = 1 / cellW;
  const invCellH = 1 / cellH;
  const t = sim.time;
  const pNormX = sim.width > 0 ? sim.pointerX / sim.width - 0.5 : 0;
  const pNormY = sim.height > 0 ? sim.pointerY / sim.height - 0.5 : 0;

  if (style === 'atmosphere') {
    // 1. Subtle full-viewport ASCII cosmic veil (visible quiet dot/colon stardust texture)
    const driftCol = t * 0.45 - pNormX * 2.2;
    const driftRow = -t * 0.25 - pNormY * 1.6;
    for (let row = 0; row < rows; row++) {
      const rowOffset = row * cols;
      const yWave = (row + driftRow) * 0.14;
      for (let col = 0; col < cols; col++) {
        const h = cellHash(col, row);
        // Keep ~36% of background cells softly textured so it reads as delicate ASCII air, not noisy static
        if (h > 0.36) continue;

        const xWave = (col + driftCol) * 0.085;
        const veil =
          0.5 +
          0.28 * Math.sin(xWave + yWave * 0.9 + t * 0.22) +
          0.22 * Math.cos(xWave * 1.4 - yWave * 1.2 - t * 0.16);

        if (veil < 0.34) continue;
        const idx = rowOffset + col;
        const off = idx * 4;
        const glyph = veil > 0.80 ? GLYPH.COLON : h < 0.12 ? GLYPH.COMMA : GLYPH.DOT;
        const a = Math.min(0.42, (0.09 + (veil - 0.34) * 0.24) * opacityScale);
        glyphIdx[idx] = glyph;
        rgba[off] = 104 + Math.round(veil * 36);
        rgba[off + 1] = 128 + Math.round(veil * 42);
        rgba[off + 2] = 178 + Math.round(veil * 48);
        rgba[off + 3] = Math.round(a * 255);
      }
    }

    // 2. Parallax twinkling foreground ASCII stars/motas on top of the veil
    const stars = sim.stars;
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      const px = s.nx * sim.width - pNormX * s.depth * 24;
      const py = s.ny * sim.height - pNormY * s.depth * 18;
      const col = Math.floor(px * invCellW);
      const row = Math.floor(py * invCellH);
      if (col < 0 || col >= cols || row < 0 || row >= rows) continue;

      const twinkle = 0.48 + 0.52 * Math.sin(s.twinklePhase);
      const starAlpha = Math.min(0.68, (0.20 + 0.34 * s.depth) * twinkle * opacityScale);
      const idx = row * cols + col;
      const off = idx * 4;
      const aByte = Math.round(starAlpha * 255);
      if (aByte > rgba[off + 3]) {
        glyphIdx[idx] = s.depth > 0.82 && twinkle > 0.85 ? GLYPH.STAR : s.glyphIdx;
        rgba[off] = Math.min(255, s.r + 25);
        rgba[off + 1] = Math.min(255, s.g + 28);
        rgba[off + 2] = Math.min(255, s.b + 30);
        rgba[off + 3] = aByte;
      }
    }
    return;
  }

  if (style === 'currents') {
    // Full-viewport flowing ASCII wind streams reacting subtly to time & cursor parallax
    for (let row = 0; row < rows; row++) {
      const rowOffset = row * cols;
      const wy = (row + 0.5) * cellH * 0.0085;
      for (let col = 0; col < cols; col++) {
        // Checker-sparsity keeps airflow airy & readable
        if (((col + (row & 1)) & 1) !== 0 && cellHash(col, row) > 0.28) continue;

        const wx = (col + 0.5) * cellW * 0.0065;
        const flow =
          Math.sin(wx * 2.2 + t * 0.55 + Math.cos(wy * 1.9 - t * 0.35)) +
          Math.cos(wy * 2.4 - t * 0.42 + wx * 0.7);

        const mag = Math.abs(flow);
        if (mag < 0.32) continue;

        let glyph: number;
        if (mag > 1.35) glyph = GLYPH.TILDE;
        else if (mag > 0.98) glyph = GLYPH.DASH;
        else if (mag > 0.65) glyph = flow > 0 ? GLYPH.APOS : GLYPH.COMMA;
        else glyph = GLYPH.DOT;

        const a = Math.min(0.46, (0.10 + (mag - 0.32) * 0.18) * opacityScale);
        const idx = rowOffset + col;
        const off = idx * 4;
        glyphIdx[idx] = glyph;
        rgba[off] = 96 + Math.round(mag * 28);
        rgba[off + 1] = 142 + Math.round(mag * 32);
        rgba[off + 2] = 192 + Math.round(mag * 26);
        rgba[off + 3] = Math.round(a * 255);
      }
    }
    return;
  }

  if (style === 'nebula') {
    // Soft full-screen ASCII aurora/fog waves drifting across midnight blue & violet
    for (let row = 0; row < rows; row++) {
      const rowOffset = row * cols;
      const ny = row / Math.max(1, rows);
      for (let col = 0; col < cols; col++) {
        const nx = col / Math.max(1, cols);
        const v1 = Math.sin(nx * 5.2 + t * 0.24 + Math.sin(ny * 4.1 - t * 0.18));
        const v2 = Math.cos(ny * 4.8 - t * 0.21 + nx * 2.8);
        const n = 0.5 + 0.28 * v1 + 0.22 * v2;
        if (n < 0.30) continue;

        let glyph: number;
        if (n > 0.84) glyph = GLYPH.TILDE;
        else if (n > 0.70) glyph = GLYPH.DASH;
        else if (n > 0.55) glyph = GLYPH.COLON;
        else if (n > 0.42) glyph = GLYPH.COMMA;
        else glyph = GLYPH.DOT;

        const a = Math.min(0.42, (0.07 + (n - 0.30) * 0.34) * opacityScale);
        const hueShift = 0.5 + 0.5 * Math.sin(nx * 3.1 - ny * 2.4 + t * 0.15);
        const idx = rowOffset + col;
        const off = idx * 4;
        glyphIdx[idx] = glyph;
        rgba[off] = Math.round(88 + hueShift * 68);
        rgba[off + 1] = Math.round(118 + (1 - hueShift) * 48);
        rgba[off + 2] = Math.round(176 + hueShift * 42);
        rgba[off + 3] = Math.round(a * 255);
      }
    }
    return;
  }

  if (style === 'grid') {
    // Clean architectural ASCII dot matrix with subtle crosshairs & breathing wave
    const stepX = 6;
    const stepY = 3;
    const shiftX = Math.round(-pNormX * 4);
    const shiftY = Math.round(-pNormY * 2);

    for (let row = 0; row < rows; row++) {
      const rowOffset = row * cols;
      const ry = ((row + shiftY) % stepY + stepY) % stepY;
      for (let col = 0; col < cols; col++) {
        const rx = ((col + shiftX) % stepX + stepX) % stepX;
        const isMajor = rx === 0 && ry === 0;
        const isMid = rx === 3 && ry === 0;
        if (!isMajor && !isMid) continue;

        const wave = 0.65 + 0.35 * Math.sin(col * 0.08 + row * 0.15 - t * 0.85);
        const a = Math.min(0.48, (isMajor ? 0.30 : 0.13) * wave * opacityScale);
        const idx = rowOffset + col;
        const off = idx * 4;
        glyphIdx[idx] = isMajor ? GLYPH.PLUS : GLYPH.DOT;
        rgba[off] = 112;
        rgba[off + 1] = 148;
        rgba[off + 2] = 198;
        rgba[off + 3] = Math.round(a * 255);
      }
    }
    return;
  }

  if (style === 'mist') {
    // Calm vertical drifting ASCII rain-mist columns
    for (let col = 0; col < cols; col += 2) {
      const colSeed = cellHash(col, 17);
      const speed = 1.6 + colSeed * 2.8;
      const phase = colSeed * 40 + t * speed;
      const head = ((phase % (rows + 14)) + (rows + 14)) % (rows + 14);
      const trailLen = 7 + Math.floor(colSeed * 9);

      for (let k = 0; k < trailLen; k++) {
        const row = Math.floor(head - k);
        if (row < 0 || row >= rows) continue;
        const fade = 1 - k / trailLen;
        const glyph = k === 0 ? GLYPH.COLON : k < 3 ? GLYPH.PIPE : k < 6 ? GLYPH.APOS : GLYPH.DOT;
        const a = Math.min(0.45, (0.07 + fade * 0.28) * opacityScale);
        const idx = row * cols + col;
        const off = idx * 4;
        glyphIdx[idx] = glyph;
        rgba[off] = 104 + Math.round(fade * 36);
        rgba[off + 1] = 154 + Math.round(fade * 44);
        rgba[off + 2] = 198 + Math.round(fade * 34);
        rgba[off + 3] = Math.round(a * 255);
      }
    }
  }
}

/**
 * Rasterizes the entire scene (selectable ASCII background, 3D Fresnel iridescent bubbles
 * in selectable ASCII styles, phase-1 rupture rings, and phase-2 falling ASCII droplets)
 * into the pre-allocated GridBuffer. Zero heap allocations per frame.
 */
export function rasterizeScene(
  sim: BubbleSimulation,
  grid: GridBuffer,
  alpha: number,
  options: RasterizeOptions = {}
): void {
  const { cols, rows, cellW, cellH, glyphIdx, rgba } = grid;
  const invCellW = 1 / cellW;
  const invCellH = 1 / cellH;

  const bubbleStyle: BubbleStyle = options.bubbleStyle ?? 'realistic';
  const backgroundStyle: BackgroundStyle = options.backgroundStyle ?? 'atmosphere';
  const backgroundOpacity = options.backgroundOpacity ?? 0.65;
  const wobbleScale = options.wobbleIntensity ?? 1.0;

  // Clear grid in two fast native memset calls
  glyphIdx.fill(0);
  rgba.fill(0);

  // -------------------------------------------------------------------------
  // Layer 1: Selectable low-opacity ASCII background
  // -------------------------------------------------------------------------
  rasterizeBackground(sim, grid, backgroundStyle, backgroundOpacity);

  // -------------------------------------------------------------------------
  // Layer 2: 3D Fresnel Iridescent ASCII Bubbles
  // -------------------------------------------------------------------------
  const bubbles = sim.bubbles;

  for (let bi = 0; bi < bubbles.length; bi++) {
    const b = bubbles[bi];
    const bx = b.prevX + (b.x - b.prevX) * alpha;
    const by = b.prevY + (b.y - b.prevY) * alpha;
    const r0 = b.radius;
    if (r0 < 3) continue;

    // Organic style gets a slight extra soft bounce feel
    const styleWobbleMul = bubbleStyle === 'organic' ? wobbleScale * 1.35 : wobbleScale;
    const wobbleAmp = Math.max(-0.22, Math.min(0.22, b.wobbleAmp * styleWobbleMul));
    const maxExtent = r0 * (1.06 + Math.abs(wobbleAmp) + 0.03 * styleWobbleMul);

    const minCol = Math.max(0, Math.floor((bx - maxExtent) * invCellW));
    const maxCol = Math.min(cols - 1, Math.ceil((bx + maxExtent) * invCellW));
    const minRow = Math.max(0, Math.floor((by - maxExtent) * invCellH));
    const maxRow = Math.min(rows - 1, Math.ceil((by + maxExtent) * invCellH));

    const wobbleAngle = b.wobbleAngle;
    const wobblePhase3 = b.wobblePhase3;
    const filmPhase = b.filmPhase;
    const filmBias = b.filmThicknessBias;
    const hoverBoost = b.hoverGlow * 0.16;
    const mode3Amp = 0.014 * styleWobbleMul;
    // Crisp sub-cell anti-aliasing band width (softens outermost silhouette without dimming the rim peak)
    const aaBand = Math.max(0.035, Math.min(0.085, (cellW * 0.85) / r0));

    for (let row = minRow; row <= maxRow; row++) {
      const py = (row + 0.5) * cellH;
      const dy = py - by;
      const dySq = dy * dy;
      const rowOffset = row * cols;

      for (let col = minCol; col <= maxCol; col++) {
        const px = (col + 0.5) * cellW;
        const dx = px - bx;
        const distSq = dx * dx + dySq;
        if (distSq > maxExtent * maxExtent) continue;

        const dist = Math.sqrt(distSq);
        const theta = Math.atan2(dy, dx);

        const wobble =
          1 +
          wobbleAmp * Math.cos(2 * (theta - wobbleAngle)) +
          mode3Amp * Math.sin(3 * theta + wobblePhase3);
        const effR = r0 * wobble;
        const r = dist / effR;
        if (r > 1.03) continue;

        const rClamped = r > 0.999 ? 0.999 : r;
        const invEffR = 1 / effR;
        const nx = dx * invEffR;
        const ny = dy * invEffR;
        const nz = Math.sqrt(Math.max(0, 1 - rClamped * rClamped));

        // 1. Fresnel reflectance (crystal-clear hollow center, continuous 360° luminous soap rim)
        const rimCurve =
          bubbleStyle === 'dense'
            ? Math.pow(1 - nz, 1.05) * 0.78 + Math.pow(rClamped, 3.4) * 0.36
            : bubbleStyle === 'crystalline'
              ? Math.pow(1 - nz, 1.65) * 0.72 + Math.pow(rClamped, 6.2) * 0.52
              : Math.pow(1 - nz, 1.2) * 0.76 + Math.pow(rClamped, 4.4) * 0.46;
        const fresnel = Math.min(1.0, 0.03 + rimCurve);

        // 2. Dual specular light reflections + subtle overhead curved window reflection
        const ndh1 = nx * H1X + ny * H1Y + nz * H1Z;
        const spec1 = ndh1 > 0 ? Math.pow(ndh1, 28) : 0;
        const specBroad = ndh1 > 0 ? Math.pow(ndh1, 10) * 0.42 : 0;

        const ndh2 = nx * H2X + ny * H2Y + nz * H2Z;
        const spec2 = ndh2 > 0 ? Math.pow(ndh2, 14) * 0.46 : 0;

        const ndh3 = nx * H3X + ny * H3Y + nz * H3Z;
        const domeGlint = ndh3 > 0 ? Math.pow(ndh3, 18) * 0.36 : 0;

        // 3. Swirling thin-film optical path difference -> iridescent RGB from LUT
        const swirl =
          Math.sin(nx * 2.8 + filmPhase) * 0.95 +
          Math.cos(ny * 2.5 - filmPhase * 0.78) * 0.85;
        const filmOpticalPhase = nz * 4.4 + swirl * 1.45 + filmBias + theta * 0.35;
        const lutOff = sampleIridescenceIndex(filmOpticalPhase) * 3;
        let irR = IRIDESCENCE_LUT[lutOff];
        let irG = IRIDESCENCE_LUT[lutOff + 1];
        let irB = IRIDESCENCE_LUT[lutOff + 2];

        const whiteMix = Math.min(1, spec1 * 1.25 + domeGlint * 0.6 + specBroad * 0.25 + hoverBoost * 0.3);
        irR = Math.round(irR + (252 - irR) * whiteMix);
        irG = Math.round(irG + (254 - irG) * whiteMix);
        irB = Math.round(irB + (255 - irB) * whiteMix);

        const shimmerWave = 0.5 + 0.5 * Math.sin(filmOpticalPhase * 1.6);
        const rimEnergy =
          fresnel * (0.88 + 0.24 * shimmerWave) +
          spec1 * 1.15 +
          specBroad +
          spec2 +
          domeGlint * 0.65 +
          hoverBoost;

        // Hollow center preservation (allows ASCII background to shine through with soap-film tint!)
        const hollowRadius = bubbleStyle === 'dense' ? 0.44 : bubbleStyle === 'crystalline' ? 0.74 : 0.68;
        if (r < hollowRadius && spec1 < 0.08 && specBroad < 0.19 && spec2 < 0.16 && domeGlint < 0.14) {
          const idx = rowOffset + col;
          if (shimmerWave < (bubbleStyle === 'dense' ? 0.58 : 0.74)) {
            if (glyphIdx[idx] !== GLYPH.SPACE) {
              const off = idx * 4;
              rgba[off] = Math.min(255, Math.round(rgba[off] * 0.55 + irR * 0.45));
              rgba[off + 1] = Math.min(255, Math.round(rgba[off + 1] * 0.55 + irG * 0.45));
              rgba[off + 2] = Math.min(255, Math.round(rgba[off + 2] * 0.55 + irB * 0.45));
            }
            continue;
          }
          const whisperAlpha = (0.07 + 0.11 * (r / hollowRadius)) * (0.65 + hoverBoost);
          blendCell(grid, idx, GLYPH.DOT, irR, irG, irB, whisperAlpha);
          continue;
        }

        // Select glyph & edge feathering according to the active BubbleStyle preset
        let chosenGlyph: number;
        let edgeFeather: number;
        let cellAlpha: number;

        if (bubbleStyle === 'classic') {
          // Preserved Original preset: directional contour glyphs ()/\-_ on outermost ring
          if (spec1 > 0.42) {
            chosenGlyph = spec1 > 0.72 ? GLYPH.AT : GLYPH.HASH;
          } else if (r >= 0.88 && spec1 < 0.25) {
            chosenGlyph = rimEnergy > 0.96 ? GLYPH.STAR : pickContourGlyph(theta);
          } else {
            const rampPos = Math.max(
              0,
              Math.min(DENSITY_RAMP.length - 1, Math.floor(rimEnergy * (DENSITY_RAMP.length - 0.5)))
            );
            chosenGlyph = DENSITY_RAMP[rampPos];
          }
          edgeFeather = r > 0.985 ? Math.max(0, 1 - (r - 0.985) / 0.045) : 1;
          cellAlpha = Math.min(0.98, (0.18 + rimEnergy * 0.78) * edgeFeather);
        } else if (bubbleStyle === 'realistic') {
          // Smooth sub-cell anti-aliased optical film: NO chunky brackets, silky round spherical gradient!
          edgeFeather = r > 1.01 - aaBand ? Math.max(0, (1.02 - r) / (aaBand + 0.01)) : 1;
          // Smooth bell-shaped soap rim peak around r=0.92 fading cleanly at outer silhouette
          const opticalRim = rimEnergy * edgeFeather;
          if (spec1 > 0.48) {
            chosenGlyph = spec1 > 0.76 ? GLYPH.AT : GLYPH.HASH;
          } else if (r > 0.96 && edgeFeather < 0.52) {
            // Feather outermost sub-pixel ring with tiny soft punctuation for silky round contour
            chosenGlyph = edgeFeather < 0.25 ? GLYPH.DOT : GLYPH.COLON;
          } else {
            const rampPos = Math.max(
              0,
              Math.min(REALISTIC_RAMP.length - 1, Math.floor(opticalRim * (REALISTIC_RAMP.length - 0.3)))
            );
            chosenGlyph = REALISTIC_RAMP[rampPos];
          }
          cellAlpha = Math.min(0.97, (0.14 + rimEnergy * 0.82) * Math.pow(edgeFeather, 0.75));
        } else if (bubbleStyle === 'crystalline') {
          // Ultra-delicate sparkling soap rim with crisp micro-dots and jewel highlights
          edgeFeather = r > 1.01 - aaBand ? Math.max(0, (1.02 - r) / (aaBand + 0.01)) : 1;
          const energy = rimEnergy * edgeFeather;
          if (spec1 > 0.40) {
            chosenGlyph = spec1 > 0.70 ? GLYPH.AT : GLYPH.STAR;
          } else if (r > 0.95 && edgeFeather < 0.45) {
            chosenGlyph = GLYPH.DOT;
          } else {
            const rampPos = Math.max(
              0,
              Math.min(CRYSTALLINE_RAMP.length - 1, Math.floor(energy * (CRYSTALLINE_RAMP.length - 0.3)))
            );
            chosenGlyph = CRYSTALLINE_RAMP[rampPos];
          }
          cellAlpha = Math.min(0.96, (0.12 + rimEnergy * 0.84) * Math.pow(edgeFeather, 0.78));
        } else if (bubbleStyle === 'dense') {
          // Sculptural rich 3D gradient with heavier ASCII luminance glyphs
          edgeFeather = r > 1.01 - aaBand ? Math.max(0, (1.02 - r) / (aaBand + 0.01)) : 1;
          const energy = rimEnergy * edgeFeather;
          const rampPos = Math.max(
            0,
            Math.min(DENSE_RAMP.length - 1, Math.floor(energy * (DENSE_RAMP.length - 0.3)))
          );
          chosenGlyph = DENSE_RAMP[rampPos];
          cellAlpha = Math.min(0.98, (0.20 + rimEnergy * 0.78) * Math.pow(edgeFeather, 0.72));
        } else {
          // 'organic': rounded soft glyphs (o, c, ~, :, .) with livelier squishy feel
          edgeFeather = r > 1.01 - aaBand ? Math.max(0, (1.02 - r) / (aaBand + 0.01)) : 1;
          const energy = rimEnergy * edgeFeather;
          if (spec1 > 0.45) {
            chosenGlyph = spec1 > 0.75 ? GLYPH.AT : GLYPH.UPPER_O;
          } else {
            const rampPos = Math.max(
              0,
              Math.min(ORGANIC_RAMP.length - 1, Math.floor(energy * (ORGANIC_RAMP.length - 0.3)))
            );
            chosenGlyph = ORGANIC_RAMP[rampPos];
          }
          cellAlpha = Math.min(0.97, (0.16 + rimEnergy * 0.80) * Math.pow(edgeFeather, 0.75));
        }

        blendCell(grid, rowOffset + col, chosenGlyph, irR, irG, irB, cellAlpha);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Layer 3a: Explosion Phase 1 — Directional Rupture Ring (* + x ~)
  // -------------------------------------------------------------------------
  const rings = sim.rings;
  for (let ri = 0; ri < rings.length; ri++) {
    const ring = rings[ri];
    const t = Math.min(1, ring.age / ring.duration);
    const expandR = ring.radius * (1.0 + t * 0.34);
    const tearHalfArc = t * PI;

    const steps = Math.max(24, Math.min(96, Math.round((TWO_PI * expandR) / Math.min(cellW, cellH))));
    for (let s = 0; s < steps; s++) {
      const theta = (s / steps) * TWO_PI;
      let diff = Math.abs(((theta - ring.originAngle + PI * 3) % TWO_PI) - PI);
      if (diff > PI) diff = TWO_PI - diff;

      if (diff < tearHalfArc - 0.35) continue;

      const atTearFront = Math.abs(diff - tearHalfArc) <= 0.42;
      const px = ring.x + Math.cos(theta) * expandR;
      const py = ring.y + Math.sin(theta) * expandR;

      const col = Math.floor(px * invCellW);
      const row = Math.floor(py * invCellH);
      if (col < 0 || col >= cols || row < 0 || row >= rows) continue;

      const lutOff = sampleIridescenceIndex(theta * 1.4 + ring.filmPhase + ring.filmBias) * 3;
      let rCol = IRIDESCENCE_LUT[lutOff];
      let gCol = IRIDESCENCE_LUT[lutOff + 1];
      let bCol = IRIDESCENCE_LUT[lutOff + 2];

      let glyph: number;
      let a: number;
      if (atTearFront) {
        rCol = Math.round(rCol + (255 - rCol) * 0.72);
        gCol = Math.round(gCol + (255 - gCol) * 0.72);
        bCol = Math.round(bCol + (255 - bCol) * 0.72);
        glyph = t < 0.45 ? GLYPH.STAR : (s & 1) === 0 ? GLYPH.X : GLYPH.PLUS;
        a = (1 - t * 0.75) * 0.96;
      } else {
        glyph = (s & 1) === 0 ? GLYPH.TILDE : GLYPH.DASH;
        a = (1 - t) * 0.55;
      }

      blendCell(grid, row * cols + col, glyph, rCol, gCol, bCol, a);
    }
  }

  // -------------------------------------------------------------------------
  // Layer 3b: Explosion Phase 2 — Falling Iridescent ASCII Droplets
  // -------------------------------------------------------------------------
  const particles = sim.particles;
  for (let pi = 0; pi < particles.length; pi++) {
    const p = particles[pi];
    const u = Math.min(1, p.age / p.maxAge);
    const px = p.prevX + (p.x - p.prevX) * alpha;
    const py = p.prevY + (p.y - p.prevY) * alpha;

    const col = Math.floor(px * invCellW);
    const row = Math.floor(py * invCellH);
    if (col < 0 || col >= cols || row < 0 || row >= rows) continue;

    let glyph: number;
    if (p.kind === 1) {
      glyph = u < 0.35 ? GLYPH.COLON : u < 0.72 ? GLYPH.DOT : GLYPH.APOS;
    } else {
      if (u < 0.16) glyph = GLYPH.STAR;
      else if (u < 0.36) glyph = GLYPH.PLUS;
      else if (u < 0.60) glyph = GLYPH.COLON;
      else if (u < 0.84) glyph = GLYPH.DOT;
      else glyph = GLYPH.APOS;
    }

    const flash = u < 0.18 ? (1 - u / 0.18) * 0.55 : 0;
    const rCol = Math.round(p.r + (255 - p.r) * flash);
    const gCol = Math.round(p.g + (255 - p.g) * flash);
    const bCol = Math.round(p.b + (255 - p.b) * flash);
    const pAlpha = Math.pow(1 - u, 1.3) * (p.kind === 1 ? 0.72 : 0.95);

    blendCell(grid, row * cols + col, glyph, rCol, gCol, bCol, pAlpha);
  }
}
