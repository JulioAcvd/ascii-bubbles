import { GLYPH, IRIDESCENCE_LUT, sampleIridescenceIndex } from './palette';
import type {
  Bubble,
  PopEvent,
  PointerInteractionResult,
  PopParticle,
  RuptureRing,
  StarDust,
} from './types';

export const FIXED_DT = 1 / 120;
const MAX_PARTICLES = 1000;
const MAX_RINGS = 32;
const WALL_RESTITUTION = 0.82;
const BUBBLE_RESTITUTION = 0.88;
const AIR_DRAG = 0.58;
const POINTER_INFLUENCE_RADIUS = 148;
const EXTREME_IMPACT_SPEED = 275;

const STAR_GLYPHS = [
  GLYPH.DOT,
  GLYPH.DOT,
  GLYPH.DOT,
  GLYPH.COMMA,
  GLYPH.APOS,
  GLYPH.GRAVE,
  GLYPH.COLON,
  GLYPH.PLUS,
] as const;

export interface SimulationConfig {
  width: number;
  height: number;
  targetBubbleCount: number;
  seed?: number;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * Deterministic mulberry32 PRNG for reproducible tests & smooth organic variation.
 */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class BubbleSimulation {
  width: number;
  height: number;
  targetBubbleCount: number;

  readonly bubbles: Bubble[] = [];
  readonly rings: RuptureRing[] = [];
  readonly particles: PopParticle[] = [];
  readonly stars: StarDust[] = [];

  time = 0;
  poppedTotal = 0;

  pointerX = 0;
  pointerY = 0;
  pointerVx = 0;
  pointerVy = 0;
  pointerActive = false;

  private nextId = 1;
  private rng: () => number;
  private respawnTimer = 0;
  private pendingPopEvents: PopEvent[] = [];
  private blowingBubbleId: number | null = null;

  constructor(config: SimulationConfig) {
    this.width = Math.max(240, config.width);
    this.height = Math.max(240, config.height);
    this.targetBubbleCount = Math.max(1, config.targetBubbleCount);
    this.rng = createRng(config.seed ?? Math.floor(Math.random() * 1_000_000_000));
    this.pointerX = this.width * 0.5;
    this.pointerY = this.height * 0.5;

    this.initStars();
    this.seedInitialBubbles();
  }

  resize(width: number, height: number): void {
    const newW = Math.max(240, width);
    const newH = Math.max(240, height);
    const scaleX = newW / this.width;
    const scaleY = newH / this.height;

    this.width = newW;
    this.height = newH;

    for (let i = 0; i < this.bubbles.length; i++) {
      const b = this.bubbles[i];
      b.x = Math.min(newW - b.radius, Math.max(b.radius, b.x * scaleX));
      b.y = Math.min(newH - b.radius, Math.max(b.radius, b.y * scaleY));
      b.prevX = b.x;
      b.prevY = b.y;
    }

    this.updateStarDensity();
  }

  setTargetBubbleCount(count: number): void {
    this.targetBubbleCount = Math.max(1, Math.min(48, Math.round(count)));
  }

  setPointer(x: number, y: number, active: boolean, dt = FIXED_DT): void {
    if (active && this.pointerActive) {
      const safeDt = Math.max(0.004, Math.min(0.08, dt));
      const rawVx = (x - this.pointerX) / safeDt;
      const rawVy = (y - this.pointerY) / safeDt;
      const blend = 0.42;
      this.pointerVx = this.pointerVx * (1 - blend) + Math.max(-1800, Math.min(1800, rawVx)) * blend;
      this.pointerVy = this.pointerVy * (1 - blend) + Math.max(-1800, Math.min(1800, rawVy)) * blend;
    } else if (!active) {
      this.pointerVx *= 0.6;
      this.pointerVy *= 0.6;
    }

    this.pointerX = x;
    this.pointerY = y;
    this.pointerActive = active;
  }

  drainPopEvents(): PopEvent[] {
    if (this.pendingPopEvents.length === 0) return [];
    const out = this.pendingPopEvents;
    this.pendingPopEvents = [];
    return out;
  }

  /**
   * Returns true if a bubble exists under the given coordinates (with subtle touch forgiveness).
   */
  hitTestBubble(x: number, y: number): number {
    let hitIndex = -1;
    let bestDistSq = Infinity;

    for (let i = 0; i < this.bubbles.length; i++) {
      const b = this.bubbles[i];
      const dx = x - b.x;
      const dy = y - b.y;
      const hitR = b.radius + 7;
      const dSq = dx * dx + dy * dy;
      if (dSq <= hitR * hitR && dSq < bestDistSq) {
        bestDistSq = dSq;
        hitIndex = i;
      }
    }
    return hitIndex;
  }

  /**
   * Left-click / tap handler: pops a hit bubble from the exact click location,
   * or spawns a new bubble gently growing at the clicked empty space.
   */
  handlePointerDown(x: number, y: number): PointerInteractionResult {
    const hitIndex = this.hitTestBubble(x, y);

    if (hitIndex !== -1) {
      const b = this.bubbles[hitIndex];
      const originAngle = Math.atan2(y - b.y, x - b.x);
      const popEvent = this.popBubbleAtIndex(hitIndex, originAngle, 'click');
      return { action: 'popped', popEvent, bubbleId: b.id };
    }

    const maxAllowed = this.targetBubbleCount + 14;
    if (this.bubbles.length >= maxAllowed) {
      const removeIdx = this.bubbles.findIndex((b) => !b.isInflating);
      if (removeIdx !== -1) this.bubbles.splice(removeIdx, 1);
    }

    const targetR = this.pickBubbleRadius();
    const clampedX = Math.max(targetR + 4, Math.min(this.width - targetR - 4, x));
    const clampedY = Math.max(targetR + 4, Math.min(this.height - targetR - 4, y));

    const angle = this.rng() * Math.PI * 2;
    const speed = 10 + this.rng() * 18;
    const bubble = this.createBubble(clampedX, clampedY, targetR, true);
    bubble.vx = Math.cos(angle) * speed + this.pointerVx * 0.05;
    bubble.vy = Math.sin(angle) * speed - 12 + this.pointerVy * 0.05;
    bubble.wobbleAmp = 0.09;
    bubble.wobbleVel = 0.65;
    bubble.wobbleAngle = angle;

    this.bubbles.push(bubble);
    return { action: 'spawned', bubbleId: bubble.id };
  }

  /**
   * Right-click hold (or mobile long-press): starts blowing a bubble anchored at the cursor/finger.
   * Holding grows it smoothly into a heavy, wobbly giant bubble; holding too long bursts it on the wand!
   */
  startBlowing(x: number, y: number): Bubble {
    if (this.blowingBubbleId !== null) {
      this.releaseBlowing();
    }

    const maxAllowed = this.targetBubbleCount + 14;
    if (this.bubbles.length >= maxAllowed) {
      const removeIdx = this.bubbles.findIndex((b) => !b.isInflating);
      if (removeIdx !== -1) this.bubbles.splice(removeIdx, 1);
    }

    const minDim = Math.min(this.width, this.height);
    // Max stable giant radius scales cleanly to viewport with natural organic variance
    const baseBurst = clamp(minDim * 0.25, 112, 192);
    const burstRadius = baseBurst * (0.92 + this.rng() * 0.16);

    const startR = 13;
    const clampedX = clamp(x, startR + 4, this.width - startR - 4);
    const clampedY = clamp(y, startR + 4, this.height - startR - 4);

    const bubble = this.createBubble(clampedX, clampedY, startR, false);
    bubble.isInflating = true;
    bubble.burstRadius = burstRadius;
    bubble.strain = 0;
    bubble.wandX = x;
    bubble.wandY = y;
    bubble.vx = 0;
    bubble.vy = 0;
    bubble.wobbleAmp = 0.03;
    bubble.wobbleVel = 0.25;

    this.bubbles.push(bubble);
    this.blowingBubbleId = bubble.id;
    return bubble;
  }

  updateBlowingPosition(x: number, y: number): void {
    if (this.blowingBubbleId === null) return;
    const b = this.bubbles.find((item) => item.id === this.blowingBubbleId);
    if (!b || !b.isInflating) {
      this.blowingBubbleId = null;
      return;
    }
    b.wandX = x;
    b.wandY = y;
  }

  /**
   * Releases the currently inflating bubble from the wand into free float with realistic pinch-off wobble.
   */
  releaseBlowing(): Bubble | null {
    if (this.blowingBubbleId === null) return null;
    const id = this.blowingBubbleId;
    this.blowingBubbleId = null;

    const b = this.bubbles.find((item) => item.id === id);
    if (!b) return null;

    b.isInflating = false;
    b.targetRadius = b.radius;
    b.strain = 0;
    b.giantFactor = this.computeGiantFactor(b.radius);
    b.mass = b.radius * b.radius;

    // Realistic pinch-off elastic recoil as the bubble neck detaches from the wand
    const releaseAngle = Math.atan2(b.y - b.wandY, b.x - b.wandX);
    b.wobbleAngle = Number.isFinite(releaseAngle) ? releaseAngle : Math.PI * 0.5;
    b.wobbleVel -= 0.58 + b.giantFactor * 0.92;

    // Inherit a calm fraction of the wand motion + subtle organic drift
    b.vx = clamp(b.vx * 0.55 + this.pointerVx * 0.09 + (this.rng() - 0.5) * 14, -140, 140);
    b.vy = clamp(b.vy * 0.55 + this.pointerVy * 0.09 + (b.giantFactor > 0.3 ? 6 : -8), -140, 140);
    return b;
  }

  isBlowing(): boolean {
    if (this.blowingBubbleId === null) return false;
    const exists = this.bubbles.some((b) => b.id === this.blowingBubbleId && b.isInflating);
    if (!exists) this.blowingBubbleId = null;
    return exists;
  }

  /**
   * Advance the simulation by one fixed physics step.
   */
  step(dt = FIXED_DT): void {
    this.time += dt;

    const pointerDecay = Math.exp(-11 * dt);
    this.pointerVx *= pointerDecay;
    this.pointerVy *= pointerDecay;

    this.stepStars(dt);
    this.stepBubbles(dt);
    this.resolveBubbleCollisions();
    this.stepRings(dt);
    this.stepParticles(dt);
    this.stepRespawn(dt);
  }

  /**
   * Surface-tension resilience: larger & giant soap bubbles pop noticeably more easily on impact.
   */
  getCollisionPopThreshold(radius: number): number {
    const normalized = clamp((radius - 26) / 145, 0, 1);
    return 185 - normalized * 105; // ~185 px/s for small, ~137 px/s for large, ~80 px/s for giant
  }

  /**
   * Force-pop a bubble by index, creating 2-phase explosion + shockwave on neighbors.
   */
  popBubbleAtIndex(
    index: number,
    originAngle: number,
    cause: 'click' | 'collision' | 'overinflate'
  ): PopEvent {
    const b = this.bubbles[index];
    if (b.id === this.blowingBubbleId) {
      this.blowingBubbleId = null;
    }
    this.bubbles.splice(index, 1);
    this.poppedTotal += 1;

    const event: PopEvent = {
      x: b.x,
      y: b.y,
      radius: b.radius,
      cause,
    };
    this.pendingPopEvents.push(event);

    // Phase 1: Directional rupture ring tearing open from impact/click/wand point
    if (this.rings.length >= MAX_RINGS) {
      this.rings.shift();
    }
    this.rings.push({
      x: b.x,
      y: b.y,
      radius: b.radius,
      originAngle,
      age: 0,
      duration: 0.14 + Math.min(0.14, b.radius * 0.00095),
      filmPhase: b.filmPhase,
      filmBias: b.filmThicknessBias,
    });

    // Phase 2: Iridescent ASCII droplet burst around perimeter + fine mist (more droplets for giant bubbles!)
    const dropletCount = Math.min(76, Math.max(18, Math.round(14 + b.radius * 0.42)));
    for (let i = 0; i < dropletCount; i++) {
      if (this.particles.length >= MAX_PARTICLES) {
        this.particles.shift();
      }
      const frac = i / dropletCount;
      const theta = frac * Math.PI * 2 + (this.rng() - 0.5) * 0.18;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      const radialJitter = b.radius * (0.86 + this.rng() * 0.2);
      const px = b.x + cosT * radialJitter;
      const py = b.y + sinT * radialJitter;

      const angleDiff = Math.cos(theta - originAngle);
      const burstBoost = cause === 'overinflate' ? 1.18 : 1.0;
      const burstSpeed = (72 + this.rng() * 138) * (1.0 - angleDiff * 0.18) * burstBoost;

      const filmAngle = theta * 1.4 + b.filmPhase + b.filmThicknessBias;
      const lutIdx = sampleIridescenceIndex(filmAngle) * 3;
      const r = IRIDESCENCE_LUT[lutIdx];
      const g = IRIDESCENCE_LUT[lutIdx + 1];
      const bCol = IRIDESCENCE_LUT[lutIdx + 2];

      const isMist = i % 3 === 0 ? 1 : 0;
      this.particles.push({
        x: px,
        y: py,
        prevX: px,
        prevY: py,
        vx: cosT * burstSpeed + b.vx * 0.35 + (this.rng() - 0.5) * 28,
        vy: sinT * burstSpeed + b.vy * 0.35 + (this.rng() - 0.5) * 28,
        age: 0,
        maxAge: isMist ? 0.54 + this.rng() * 0.45 : 0.46 + this.rng() * 0.48,
        r,
        g,
        b: bCol,
        drag: isMist ? 4.2 + this.rng() * 1.4 : 2.9 + this.rng() * 1.2,
        gravity: isMist ? 24 + this.rng() * 18 : 44 + this.rng() * 28,
        kind: isMist,
      });
    }

    // Shockwave pushes nearby bubbles and ripples their film
    const shockRadius = b.radius * 3.4 + 45;
    const shockRadiusSq = shockRadius * shockRadius;
    for (let i = 0; i < this.bubbles.length; i++) {
      const other = this.bubbles[i];
      if (other.isInflating) continue;
      const dx = other.x - b.x;
      const dy = other.y - b.y;
      const dSq = dx * dx + dy * dy;
      if (dSq > 1 && dSq < shockRadiusSq) {
        const d = Math.sqrt(dSq);
        const falloff = 1 - d / shockRadius;
        const push = (58 + b.radius * 0.78) * falloff * falloff;
        const nx = dx / d;
        const ny = dy / d;
        other.vx += nx * push;
        other.vy += ny * push;
        other.wobbleAngle = Math.atan2(ny, nx);
        other.wobbleVel += 0.9 * falloff;
      }
    }

    return event;
  }

  private computeGiantFactor(radius: number): number {
    return clamp((radius - 70) / 95, 0, 1);
  }

  private initStars(): void {
    this.stars.length = 0;
    const count = this.computeDesiredStarCount();
    for (let i = 0; i < count; i++) {
      this.stars.push(this.createStar());
    }
  }

  private updateStarDensity(): void {
    const desired = this.computeDesiredStarCount();
    while (this.stars.length < desired) {
      this.stars.push(this.createStar());
    }
    if (this.stars.length > desired) {
      this.stars.length = desired;
    }
  }

  private computeDesiredStarCount(): number {
    const area = this.width * this.height;
    return Math.max(55, Math.min(220, Math.round(area / 12500)));
  }

  private createStar(): StarDust {
    const depth = 0.25 + this.rng() * 0.75;
    const glyphIdx = STAR_GLYPHS[Math.floor(this.rng() * STAR_GLYPHS.length)];
    const tintPick = this.rng();
    let r = 135;
    let g = 158;
    let b = 205;
    if (tintPick < 0.33) {
      r = 158;
      g = 148;
      b = 208;
    } else if (tintPick < 0.66) {
      r = 128;
      g = 175;
      b = 205;
    }

    return {
      nx: this.rng(),
      ny: this.rng(),
      depth,
      twinklePhase: this.rng() * Math.PI * 2,
      twinkleSpeed: 0.35 + this.rng() * 1.15,
      driftVx: (this.rng() - 0.5) * 0.0045 * depth,
      driftVy: (-0.0018 - this.rng() * 0.0035) * depth,
      glyphIdx,
      r,
      g,
      b,
    };
  }

  private seedInitialBubbles(): void {
    this.bubbles.length = 0;
    for (let i = 0; i < this.targetBubbleCount; i++) {
      const r = this.pickBubbleRadius();
      let x = r + this.rng() * Math.max(10, this.width - r * 2);
      let y = r + this.rng() * Math.max(10, this.height - r * 2);

      for (let attempt = 0; attempt < 18; attempt++) {
        let overlaps = false;
        for (let j = 0; j < this.bubbles.length; j++) {
          const other = this.bubbles[j];
          const dx = x - other.x;
          const dy = y - other.y;
          const minDist = r + other.radius + 10;
          if (dx * dx + dy * dy < minDist * minDist) {
            overlaps = true;
            break;
          }
        }
        if (!overlaps) break;
        x = r + this.rng() * Math.max(10, this.width - r * 2);
        y = r + this.rng() * Math.max(10, this.height - r * 2);
      }

      const b = this.createBubble(x, y, r, false);
      this.bubbles.push(b);
    }
  }

  private pickBubbleRadius(): number {
    const minDim = Math.min(this.width, this.height);
    const scale = Math.max(0.68, Math.min(1.22, minDim / 820));
    const u = this.rng();
    let base: number;
    if (u < 0.28) {
      base = 28 + this.rng() * 16;
    } else if (u < 0.78) {
      base = 44 + this.rng() * 24;
    } else {
      base = 68 + this.rng() * 26;
    }
    return base * scale;
  }

  private createBubble(x: number, y: number, targetRadius: number, growIn: boolean): Bubble {
    const startRadius = growIn ? Math.max(8, targetRadius * 0.22) : targetRadius;
    const driftAngle = this.rng() * Math.PI * 2;
    const speed = 8 + this.rng() * 16;

    return {
      id: this.nextId++,
      x,
      y,
      prevX: x,
      prevY: y,
      vx: Math.cos(driftAngle) * speed,
      vy: Math.sin(driftAngle) * speed,
      radius: startRadius,
      targetRadius,
      mass: targetRadius * targetRadius,
      filmPhase: this.rng() * Math.PI * 2,
      filmSpin: (this.rng() < 0.5 ? -1 : 1) * (0.28 + this.rng() * 0.45),
      filmThicknessBias: this.rng() * Math.PI * 2,
      wobbleAmp: 0.018 + this.rng() * 0.015,
      wobbleVel: 0,
      wobbleAngle: this.rng() * Math.PI * 2,
      wobblePhase3: this.rng() * Math.PI * 2,
      driftSeed: this.rng() * 100,
      age: 0,
      hoverGlow: 0,
      isInflating: false,
      strain: 0,
      burstRadius: 170,
      giantFactor: this.computeGiantFactor(startRadius),
      wandX: x,
      wandY: y,
    };
  }

  private stepStars(dt: number): void {
    for (let i = 0; i < this.stars.length; i++) {
      const s = this.stars[i];
      s.twinklePhase += s.twinkleSpeed * dt;
      s.nx += s.driftVx * dt;
      s.ny += s.driftVy * dt;
      if (s.nx < 0) s.nx += 1;
      else if (s.nx > 1) s.nx -= 1;
      if (s.ny < 0) s.ny += 1;
      else if (s.ny > 1) s.ny -= 1;
    }
  }

  private stepBubbles(dt: number): void {
    const pointerSpeed = Math.hypot(this.pointerVx, this.pointerVy);
    let overinflatedIndex = -1;
    let overinflatedAngle = -Math.PI * 0.5;

    for (let i = 0; i < this.bubbles.length; i++) {
      const b = this.bubbles[i];
      b.prevX = b.x;
      b.prevY = b.y;
      b.age += dt;

      // ---------------------------------------------------------------------
      // Actively inflating bubble tethered to the cursor/touch wand
      // ---------------------------------------------------------------------
      if (b.isInflating) {
        // Constant-airflow inflation: swells briskly at start, tapers gently as volume grows
        const dR = (158 / Math.pow(Math.max(12, b.radius), 0.36)) * dt;
        b.radius += dR;
        b.targetRadius = b.radius;
        b.mass = b.radius * b.radius;
        b.giantFactor = this.computeGiantFactor(b.radius);

        // Gravity sag: as the giant soap bubble grows heavier, it hangs slightly below the wand tip
        const sagOffset = b.radius * (0.24 + b.giantFactor * 0.42);
        const anchorX = clamp(b.wandX, b.radius * 0.35, this.width - b.radius * 0.35);
        const anchorY = clamp(b.wandY + sagOffset, b.radius * 0.35, this.height - b.radius * 0.35);

        // Elastic tether spring so gentle wand motion creates realistic trailing stretch
        const springK = 36 - b.giantFactor * 16;
        const tetherDamp = 9.5;
        b.vx += ((anchorX - b.x) * springK - b.vx * tetherDamp) * dt;
        b.vy += ((anchorY - b.y) * springK - b.vy * tetherDamp) * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;

        // Progressive surface-tension strain approaching burst limit
        const strainStart = b.burstRadius * 0.34;
        const baseStrain = clamp((b.radius - strainStart) / Math.max(20, b.burstRadius - strainStart), 0, 1);
        // Whipping the wand rapidly while holding a large fragile bubble adds extra shear strain
        const shearPenalty = b.giantFactor > 0.25 && pointerSpeed > 260
          ? clamp((pointerSpeed - 260) / 900, 0, 0.35) * b.giantFactor
          : 0;
        b.strain = clamp(baseStrain + shearPenalty, 0, 1);

        // Stretch axis aligns with hang/trail vector from wand tip
        const stretchDx = b.x - b.wandX;
        const stretchDy = b.y - b.wandY;
        if (stretchDx * stretchDx + stretchDy * stretchDy > 4) {
          b.wobbleAngle = Math.atan2(stretchDy, stretchDx);
        }

        // Lively liquid oscillation grows stronger as the bubble gets larger & more unstable
        const omega = 5.0 / Math.sqrt(Math.max(0.5, b.radius / 52));
        const targetStretch = 0.03 + b.giantFactor * 0.065 + b.strain * 0.045;
        const harmonicDrive = Math.sin(this.time * (3.2 + b.strain * 4.5) + b.driftSeed) * (0.04 + b.strain * 0.09);
        const wobbleAcc = -(omega * omega) * (b.wobbleAmp - targetStretch) - 1.9 * b.wobbleVel + harmonicDrive;
        b.wobbleVel += wobbleAcc * dt;
        b.wobbleAmp = clamp(b.wobbleAmp + b.wobbleVel * dt, -0.22, 0.24);

        b.filmPhase += (b.filmSpin * (1 + b.strain * 1.4) + 0.35) * dt;
        b.wobblePhase3 += (1.1 + b.giantFactor * 1.4 + b.strain * 1.8) * dt;
        b.hoverGlow = 0.35 + b.strain * 0.45;

        // Burst directly on the wand if over-inflated (or sheared past breaking point)!
        if (b.radius >= b.burstRadius || b.strain >= 1) {
          overinflatedIndex = i;
          overinflatedAngle = Math.atan2(b.wandY - b.y, b.wandX - b.x);
        }
        continue;
      }

      // ---------------------------------------------------------------------
      // Free-floating bubble physics (lightweight normal vs heavy giant)
      // ---------------------------------------------------------------------
      if (b.radius < b.targetRadius) {
        const diff = b.targetRadius - b.radius;
        b.radius += diff * Math.min(1, dt * 8.5);
        if (Math.abs(b.targetRadius - b.radius) < 0.25) {
          b.radius = b.targetRadius;
        }
        b.mass = b.radius * b.radius;
      }

      b.giantFactor = this.computeGiantFactor(b.radius);
      const gf = b.giantFactor;

      // 1. Organic air currents + realistic weight/buoyancy:
      //    Small bubbles drift lightly with tiny upward lift; giant bubbles feel noticeably heavier & slower!
      const t = this.time;
      const currentScale = 1 - gf * 0.38;
      const fx =
        (Math.sin(b.y * 0.0042 + t * 0.34 + b.driftSeed) * 12.5 +
          Math.cos(b.x * 0.0031 - t * 0.23 + b.driftSeed * 1.7) * 7.5) *
        currentScale;
      const weightPull = -1.4 + gf * 11.2; // small: gentle upward lift; giant: slow heavy downward glide
      const fy =
        (Math.cos(b.x * 0.0038 + t * 0.29 + b.driftSeed * 0.8) * 12.0 +
          Math.sin(b.y * 0.0034 + t * 0.21 - b.driftSeed) * 6.5) *
          currentScale +
        weightPull;

      b.vx += fx * dt;
      b.vy += fy * dt;

      // 2. Cursor/touch air current & hover highlight (giant bubbles have more inertia against gusts)
      if (this.pointerActive && this.blowingBubbleId === null) {
        const dx = b.x - this.pointerX;
        const dy = b.y - this.pointerY;
        const distSq = dx * dx + dy * dy;

        const isHovered = distSq <= (b.radius + 6) * (b.radius + 6);
        const targetGlow = isHovered ? 1 : 0;
        b.hoverGlow += (targetGlow - b.hoverGlow) * Math.min(1, dt * 10);

        const maxR = POINTER_INFLUENCE_RADIUS + b.radius * 0.65;
        if (distSq < maxR * maxR && pointerSpeed > 12) {
          const dist = Math.sqrt(distSq) || 1;
          const falloff = 1 - dist / maxR;
          const weight = falloff * falloff;
          const inertiaFactor = 1 - gf * 0.52;

          const airForce = 2.65 * weight * inertiaFactor;
          b.vx += this.pointerVx * airForce * dt;
          b.vy += this.pointerVy * airForce * dt;

          if (dist < b.radius + 54) {
            const bow = Math.min(480, pointerSpeed * 0.55) * weight * 1.7 * inertiaFactor;
            b.vx += (dx / dist) * bow * dt;
            b.vy += (dy / dist) * bow * dt;
          }

          if (pointerSpeed > 160) {
            b.wobbleAngle = Math.atan2(this.pointerVy, this.pointerVx);
            b.wobbleVel += Math.min(0.95, pointerSpeed * 0.0014) * (1 + gf * 0.8) * weight * dt * 18;
          }
        }
      } else if (b.hoverGlow > 0.001) {
        b.hoverGlow *= Math.exp(-8 * dt);
      }

      // 3. Air resistance (larger cross-section = heavier viscous drag so giant bubbles glide serenely)
      const dragFactor = Math.exp(-AIR_DRAG * (1 + gf * 0.65) * dt);
      b.vx *= dragFactor;
      b.vy *= dragFactor;

      const speed = Math.hypot(b.vx, b.vy);
      const maxSpeed = 620 - gf * 240;
      if (speed > maxSpeed) {
        const speedClamp = maxSpeed / speed;
        b.vx *= speedClamp;
        b.vy *= speedClamp;
      }

      // 4. Integrate position
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      // 5. Soft elastic wall bounce (giant bubbles cushion softer & squish dramatically on walls/floor)
      const r = b.radius;
      const wallRestitution = WALL_RESTITUTION - gf * 0.18;
      const wallSquashScale = 0.0042 + gf * 0.0048;

      if (b.x < r) {
        b.x = r;
        const impact = Math.abs(b.vx);
        b.vx = impact * wallRestitution;
        this.exciteWobble(b, 0, impact * wallSquashScale);
      } else if (b.x > this.width - r) {
        b.x = this.width - r;
        const impact = Math.abs(b.vx);
        b.vx = -impact * wallRestitution;
        this.exciteWobble(b, Math.PI, impact * wallSquashScale);
      }

      if (b.y < r) {
        b.y = r;
        const impact = Math.abs(b.vy);
        b.vy = impact * wallRestitution;
        this.exciteWobble(b, Math.PI * 0.5, impact * wallSquashScale);
      } else if (b.y > this.height - r) {
        b.y = this.height - r;
        const impact = Math.abs(b.vy);
        b.vy = -impact * wallRestitution;
        this.exciteWobble(b, -Math.PI * 0.5, impact * wallSquashScale);
      }

      // 6. Iridescent soap-film swirl & slow deep surface-tension wobble for giant bubbles
      b.filmPhase += (b.filmSpin * (1 + gf * 0.3) + speed * 0.0045) * dt;
      b.wobblePhase3 += (0.85 + gf * 0.45 + speed * 0.006) * dt;

      // Natural harmonic frequency inversely proportional to sqrt(radius): giant bubbles undulate slowly!
      const omega = 5.4 / Math.sqrt(Math.max(0.45, b.radius / 50));
      const damping = 2.6 - gf * 1.15; // giant soap film keeps sloshing longer before settling!
      // Slight aerodynamic flattening perpendicular to motion + slow organic giant slosh
      const aeroTarget = gf > 0.05 && speed > 4 ? -clamp(speed * 0.0014 * gf, 0, 0.065) : 0;
      const organicDrive =
        gf > 0.05 ? Math.sin(t * (1.55 - gf * 0.45) + b.driftSeed) * gf * 0.95 : 0;

      if (gf > 0.25 && speed > 14 && Math.abs(b.wobbleVel) < 0.25) {
        // Gently orient aerodynamic flattening with drift direction when calm
        const velAngle = Math.atan2(b.vy, b.vx);
        const angleDelta = Math.atan2(Math.sin(velAngle - b.wobbleAngle), Math.cos(velAngle - b.wobbleAngle));
        b.wobbleAngle += angleDelta * Math.min(1, dt * 1.4);
      }

      const wobbleAcc = -(omega * omega) * (b.wobbleAmp - aeroTarget) - damping * b.wobbleVel + organicDrive;
      b.wobbleVel += wobbleAcc * dt;
      b.wobbleAmp += b.wobbleVel * dt;
      const maxWobble = 0.16 + gf * 0.09;
      b.wobbleAmp = clamp(b.wobbleAmp, -maxWobble, maxWobble);
    }

    if (overinflatedIndex !== -1 && overinflatedIndex < this.bubbles.length) {
      this.popBubbleAtIndex(overinflatedIndex, overinflatedAngle, 'overinflate');
    }
  }

  private exciteWobble(b: Bubble, angle: number, impulse: number): void {
    const clamped = Math.min(1.6, impulse);
    if (clamped < 0.04) return;
    b.wobbleAngle = angle;
    b.wobbleVel -= clamped;
  }

  private resolveBubbleCollisions(): void {
    const toPop = new Map<number, number>();

    for (let i = 0; i < this.bubbles.length; i++) {
      if (toPop.has(i)) continue;
      const a = this.bubbles[i];

      for (let j = i + 1; j < this.bubbles.length; j++) {
        if (toPop.has(j)) continue;
        const b = this.bubbles[j];

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const minDist = a.radius + b.radius;
        const distSq = dx * dx + dy * dy;

        if (distSq >= minDist * minDist) continue;

        const dist = Math.sqrt(distSq) || 0.001;
        const nx = dx / dist;
        const ny = dy / dist;

        const rvx = b.vx - a.vx;
        const rvy = b.vy - a.vy;
        const relNormalVel = rvx * nx + rvy * ny;
        const impactSpeed = -relNormalVel;

        // If an inflating giant bubble gets bumped hard by another bubble, it can burst easily
        if (impactSpeed > 0) {
          const largerIsA = a.radius >= b.radius;
          const fragileRadius = largerIsA ? a.radius : b.radius;
          const threshold = this.getCollisionPopThreshold(fragileRadius);

          if (impactSpeed >= EXTREME_IMPACT_SPEED) {
            toPop.set(i, Math.atan2(ny, nx));
            toPop.set(j, Math.atan2(-ny, -nx));
            continue;
          }

          if (impactSpeed >= threshold) {
            if (largerIsA) {
              toPop.set(i, Math.atan2(ny, nx));
              b.vx += nx * impactSpeed * 0.25;
              b.vy += ny * impactSpeed * 0.25;
              this.exciteWobble(b, Math.atan2(-ny, -nx), 0.75);
            } else {
              toPop.set(j, Math.atan2(-ny, -nx));
              a.vx -= nx * impactSpeed * 0.25;
              a.vy -= ny * impactSpeed * 0.25;
              this.exciteWobble(a, Math.atan2(ny, nx), 0.75);
            }
            continue;
          }
        }

        // Soft collision -> elastic positional separation + momentum bounce + squash wobble
        const overlap = minDist - dist;
        const totalMass = a.mass + b.mass;
        const shareA = a.isInflating ? 0.15 : b.isInflating ? 0.85 : b.mass / totalMass;
        const shareB = 1 - shareA;

        a.x -= nx * overlap * shareA;
        a.y -= ny * overlap * shareA;
        b.x += nx * overlap * shareB;
        b.y += ny * overlap * shareB;

        if (relNormalVel < 0) {
          const jImpulse = (-(1 + BUBBLE_RESTITUTION) * relNormalVel) / (1 / a.mass + 1 / b.mass);
          const ix = jImpulse * nx;
          const iy = jImpulse * ny;
          if (!a.isInflating) {
            a.vx -= ix / a.mass;
            a.vy -= iy / a.mass;
          }
          if (!b.isInflating) {
            b.vx += ix / b.mass;
            b.vy += iy / b.mass;
          }

          const wobbleKick = Math.min(1.25, impactSpeed * 0.0078);
          const angleNormal = Math.atan2(ny, nx);
          this.exciteWobble(a, angleNormal, wobbleKick * (1 + a.giantFactor * 0.45));
          this.exciteWobble(b, angleNormal + Math.PI, wobbleKick * (1 + b.giantFactor * 0.45));
        }
      }
    }

    if (toPop.size > 0) {
      const sorted = Array.from(toPop.entries()).sort((u, v) => v[0] - u[0]);
      for (let k = 0; k < sorted.length; k++) {
        const [idx, angle] = sorted[k];
        if (idx >= 0 && idx < this.bubbles.length) {
          this.popBubbleAtIndex(idx, angle, 'collision');
        }
      }
    }
  }

  private stepRings(dt: number): void {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const ring = this.rings[i];
      ring.age += dt;
      if (ring.age >= ring.duration) {
        this.rings.splice(i, 1);
      }
    }
  }

  private stepParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.maxAge) {
        this.particles.splice(i, 1);
        continue;
      }

      p.prevX = p.x;
      p.prevY = p.y;
      const damp = Math.exp(-p.drag * dt);
      p.vx *= damp;
      p.vy = p.vy * damp + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  private stepRespawn(dt: number): void {
    if (this.bubbles.length >= this.targetBubbleCount) {
      this.respawnTimer = 0;
      return;
    }

    this.respawnTimer += dt;
    const interval = this.bubbles.length < this.targetBubbleCount * 0.5 ? 0.28 : 0.55;
    if (this.respawnTimer < interval) return;
    this.respawnTimer = 0;

    const r = this.pickBubbleRadius();
    const edge = Math.floor(this.rng() * 4);
    let x = this.width * 0.5;
    let y = this.height * 0.5;
    let vx = 0;
    let vy = 0;

    if (edge === 0) {
      x = r + this.rng() * Math.max(10, this.width - r * 2);
      y = this.height - r - 2;
      vx = (this.rng() - 0.5) * 18;
      vy = -(16 + this.rng() * 18);
    } else if (edge === 1) {
      x = r + 2;
      y = r + this.rng() * Math.max(10, this.height - r * 2);
      vx = 16 + this.rng() * 18;
      vy = (this.rng() - 0.5) * 18;
    } else if (edge === 2) {
      x = this.width - r - 2;
      y = r + this.rng() * Math.max(10, this.height - r * 2);
      vx = -(16 + this.rng() * 18);
      vy = (this.rng() - 0.5) * 18;
    } else {
      x = r + this.rng() * Math.max(10, this.width - r * 2);
      y = r + 2;
      vx = (this.rng() - 0.5) * 18;
      vy = 14 + this.rng() * 16;
    }

    const b = this.createBubble(x, y, r, true);
    b.vx = vx;
    b.vy = vy;
    this.bubbles.push(b);
  }
}
