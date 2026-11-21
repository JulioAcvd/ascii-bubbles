import { describe, expect, it } from 'vitest';
import { GLYPH } from '../src/engine/palette';
import { BubbleSimulation, FIXED_DT } from '../src/engine/physics';
import { createGridBuffer, rasterizeScene } from '../src/engine/rasterizer';
import type { BackgroundStyle, BubbleStyle } from '../src/engine/types';

describe('ASCII scene rasterizer', () => {
  it('renders a bubble with luminous rim and hollow translucent center across all bubble styles', () => {
    const styles: BubbleStyle[] = ['realistic', 'classic', 'crystalline', 'dense', 'organic'];
    const cellW = 7;
    const cellH = 14;
    const grid = createGridBuffer(Math.ceil(600 / cellW), Math.ceil(400 / cellH), cellW, cellH);

    for (const bubbleStyle of styles) {
      const sim = new BubbleSimulation({ width: 600, height: 400, targetBubbleCount: 1, seed: 5 });
      const b = sim.bubbles[0];
      b.x = 300;
      b.y = 200;
      b.prevX = 300;
      b.prevY = 200;
      b.radius = 72;
      b.targetRadius = 72;
      b.wobbleAmp = 0;

      rasterizeScene(sim, grid, 1, {
        bubbleStyle,
        backgroundStyle: 'none',
      });

      const centerCol = Math.floor(300 / cellW);
      const centerRow = Math.floor(200 / cellH);
      const centerAlpha = grid.rgba[(centerRow * grid.cols + centerCol) * 4 + 3];

      // Right rim near r ≈ 0.93
      const rimCol = Math.floor((300 + 67) / cellW);
      const rimIdx = centerRow * grid.cols + rimCol;
      const rimAlpha = grid.rgba[rimIdx * 4 + 3];

      expect(rimAlpha, `rimAlpha for ${bubbleStyle}`).toBeGreaterThan(105);
      expect(grid.glyphIdx[rimIdx], `rim glyph for ${bubbleStyle}`).not.toBe(GLYPH.SPACE);
      expect(centerAlpha, `centerAlpha for ${bubbleStyle}`).toBeLessThan(rimAlpha * 0.45);
    }
  });

  it('renders clearly visible low-opacity ASCII backgrounds and keeps "none" completely blank', () => {
    const sim = new BubbleSimulation({ width: 640, height: 360, targetBubbleCount: 1, seed: 12 });
    sim.bubbles.length = 0; // isolate background layer
    const grid = createGridBuffer(88, 26, 7.2, 14);

    const visibleStyles: BackgroundStyle[] = ['atmosphere', 'currents', 'nebula', 'grid', 'mist'];
    for (const backgroundStyle of visibleStyles) {
      rasterizeScene(sim, grid, 1, { backgroundStyle, backgroundOpacity: 0.7 });
      let nonEmpty = 0;
      let maxAlpha = 0;
      for (let i = 0; i < grid.glyphIdx.length; i++) {
        if (grid.glyphIdx[i] !== GLYPH.SPACE) {
          nonEmpty++;
          const a = grid.rgba[i * 4 + 3];
          if (a > maxAlpha) maxAlpha = a;
        }
      }
      // Must be clearly visible ASCII characters, yet subordinate to bright bubbles
      expect(nonEmpty, `cell count for ${backgroundStyle}`).toBeGreaterThan(40);
      expect(maxAlpha, `max alpha for ${backgroundStyle}`).toBeLessThan(180);
    }

    rasterizeScene(sim, grid, 1, { backgroundStyle: 'none', backgroundOpacity: 0.7 });
    let noneCount = 0;
    for (let i = 0; i < grid.glyphIdx.length; i++) {
      if (grid.glyphIdx[i] !== GLYPH.SPACE) noneCount++;
    }
    expect(noneCount).toBe(0);
  });

  it('rasterizes rupture rings and explosion particles after a pop without out-of-bounds errors', () => {
    const sim = new BubbleSimulation({ width: 600, height: 400, targetBubbleCount: 3, seed: 19 });
    const b = sim.bubbles[0];
    b.x = 300;
    b.y = 200;
    b.radius = 58;
    b.targetRadius = 58;

    sim.popBubbleAtIndex(0, 0, 'click');
    sim.bubbles.length = 0;
    sim.step(FIXED_DT * 2);

    const grid = createGridBuffer(86, 30, 7, 14);
    rasterizeScene(sim, grid, 1, { backgroundStyle: 'none' });

    let nonEmpty = 0;
    for (let i = 0; i < grid.glyphIdx.length; i++) {
      if (grid.glyphIdx[i] !== GLYPH.SPACE) nonEmpty++;
    }
    expect(nonEmpty).toBeGreaterThan(15);
  });

  it('rasterizes a full 1080p fine ASCII grid with active background well within high-refresh-rate budget', () => {
    const sim = new BubbleSimulation({ width: 1920, height: 1080, targetBubbleCount: 18, seed: 42 });
    const cellW = 7.2;
    const cellH = 14;
    const grid = createGridBuffer(Math.ceil(1920 / cellW), Math.ceil(1080 / cellH), cellW, cellH);

    for (let i = 0; i < 10; i++) {
      sim.step(FIXED_DT);
      rasterizeScene(sim, grid, 0.5, { bubbleStyle: 'realistic', backgroundStyle: 'atmosphere' });
    }

    const frames = 40;
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      sim.step(FIXED_DT);
      rasterizeScene(sim, grid, 0.5, { bubbleStyle: 'realistic', backgroundStyle: 'atmosphere' });
    }
    const avgMs = (performance.now() - t0) / frames;

    expect(avgMs).toBeLessThan(8);
  });
});
