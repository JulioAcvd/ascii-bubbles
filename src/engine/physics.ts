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
const MAX_PARTICLES = 900;
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

  // Pointer state for air-current turbulence and subtle background parallax
  pointerX = 0;
  pointerY = 0;
  pointerVx = 0;
  pointerVy = 0;
  pointerActive = false;

  private nextId = 1;
  private rng: () => number;
  private respawnTimer = 0;
  private pendingPopEvents: PopEvent[] = [];

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
      // Exponential smoothing prevents velocity spikes on erratic mouse polling
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
   * Click/tap handler: pops a hit bubble from the exact click location,
   * or spawns a new bubble gently growing at the clicked empty space.
   */
  handlePointerDown(x: number, y: number): PointerInteractionResult {
    // Check bubbles from smallest to largest (prefer smaller foreground bubble on overlap)
    let hitIndex = -1;
    let bestDistSq = Infinity;

    for (let i = 0; i < this.bubbles.length; i++) {
      const b = this.bubbles[i];
      const dx = x - b.x;
      const dy = y - b.y;
      const hitR = b.radius + 7; // subtle touch/click forgiveness
      const dSq = dx * dx + dy * dy;
      if (dSq <= hitR * hitR && dSq < bestDistSq) {
        bestDistSq = dSq;
        hitIndex = i;
      }
    }

    if (hitIndex !== -1) {
      const b = this.bubbles[hitIndex];
      const originAngle = Math.atan2(y - b.y, x - b.x);
      const popEvent = this.popBubbleAtIndex(hitIndex, originAngle, 'click');
      return { action: 'popped', popEvent, bubbleId: b.id };
    }

    // Clicked empty space -> gently blow a new bubble into existence
    const maxAllowed = this.targetBubbleCount + 14;
    if (this.bubbles.length >= maxAllowed) {
      // Remove oldest bubble gently if way over cap
      this.bubbles.shift();
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
   * Advance the simulation by one fixed physics step.
   */
  step(dt = FIXED_DT): void {
    this.time += dt;

    // Decay pointer velocity smoothly when cursor stops moving
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
   * Surface-tension resilience: larger soap bubbles pop slightly more easily on hard impacts.
   */
  getCollisionPopThreshold(radius: number): number {
    const normalized = Math.max(0, Math.min(1, (radius - 26) / 68));
    return 185 - normalized * 48; // ~185 px/s for small, ~137 px/s for large
  }

  /**
   * Force-pop a bubble by index, creating 2-phase explosion + mild shockwave on neighbors.
   */
  popBubbleAtIndex(index: number, originAngle: number, cause: 'click' | 'collision'): PopEvent {
    const b = this.bubbles[index];
    this.bubbles.splice(index, 1);
    this.poppedTotal += 1;

    const event: PopEvent = {
      x: b.x,
      y: b.y,
      radius: b.radius,
      cause,
    };
    this.pendingPopEvents.push(event);

    // Phase 1: Directional rupture ring tearing open from impact/click point
    if (this.rings.length >= MAX_RINGS) {
      this.rings.shift();
    }
    this.rings.push({
      x: b.x,
      y: b.y,
      radius: b.radius,
      originAngle,
      age: 0,
      duration: 0.14 + Math.min(0.08, b.radius * 0.0009),
      filmPhase: b.filmPhase,
      filmBias: b.filmThicknessBias,
    });

    // Phase 2: Iridescent ASCII droplet burst around perimeter + fine mist
    const dropletCount = Math.min(48, Math.max(18, Math.round(14 + b.radius * 0.42)));
    for (let i = 0; i < dropletCount; i++) {
      if (this.particles.length >= MAX_PARTICLES) {
        this.particles.shift();
      }
      const frac = i / dropletCount;
      const theta = frac * Math.PI * 2 + (this.rng() - 0.5) * 0.18;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      // Slight radial position jitter around the film rim
      const radialJitter = b.radius * (0.86 + this.rng() * 0.2);
      const px = b.x + cosT * radialJitter;
      const py = b.y + sinT * radialJitter;

      // Droplets burst slightly faster opposite the rupture origin as the film snaps back
      const angleDiff = Math.cos(theta - originAngle);
      const burstSpeed = (72 + this.rng() * 138) * (1.0 - angleDiff * 0.18);

      // Inherit exact thin-film iridescent color at this perimeter angle
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
        maxAge: isMist ? 0.52 + this.rng() * 0.42 : 0.42 + this.rng() * 0.45,
        r,
        g,
        b: bCol,
        drag: isMist ? 4.2 + this.rng() * 1.4 : 2.9 + this.rng() * 1.2,
        gravity: isMist ? 22 + this.rng() * 18 : 42 + this.rng() * 26,
        kind: isMist,
      });
    }

    // Mild shockwave pushes nearby bubbles and ripples their film
    const shockRadius = b.radius * 3.4 + 45;
    const shockRadiusSq = shockRadius * shockRadius;
    for (let i = 0; i < this.bubbles.length; i++) {
      const other = this.bubbles[i];
      const dx = other.x - b.x;
      const dy = other.y - b.y;
      const dSq = dx * dx + dy * dy;
      if (dSq > 1 && dSq < shockRadiusSq) {
        const d = Math.sqrt(dSq);
        const falloff = 1 - d / shockRadius;
        const push = (58 + b.radius * 0.75) * falloff * falloff;
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
    // Subtle cool starlight tints: ice-blue, soft lavender, pale silver
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

      // Try to place without heavy overlap
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
    // Scale radii gently to viewport so bubbles feel proportional on both phones and 4K monitors
    const minDim = Math.min(this.width, this.height);
    const scale = Math.max(0.68, Math.min(1.22, minDim / 820));
    const u = this.rng();
    // Skewed distribution: several medium bubbles, some delicate small ones, a few hero large ones
    let base: number;
    if (u < 0.28) {
      base = 28 + this.rng() * 16; // small (28..44)
    } else if (u < 0.78) {
      base = 44 + this.rng() * 24; // medium (44..68)
    } else {
      base = 68 + this.rng() * 26; // large hero (68..94)
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
    const dragFactor = Math.exp(-AIR_DRAG * dt);
    const pointerSpeed = Math.hypot(this.pointerVx, this.pointerVy);

    for (let i = 0; i < this.bubbles.length; i++) {
      const b = this.bubbles[i];
      b.prevX = b.x;
      b.prevY = b.y;
      b.age += dt;

      // Smooth spawn inflate animation
      if (b.radius < b.targetRadius) {
        const diff = b.targetRadius - b.radius;
        b.radius += diff * Math.min(1, dt * 8.5);
        if (Math.abs(b.targetRadius - b.radius) < 0.25) {
          b.radius = b.targetRadius;
        }
        b.mass = b.radius * b.radius;
      }

      // 1. Slow organic air-current field (curl-like multi-sine microgravity drift)
      const t = this.time;
      const fx =
        Math.sin(b.y * 0.0042 + t * 0.34 + b.driftSeed) * 12.5 +
        Math.cos(b.x * 0.0031 - t * 0.23 + b.driftSeed * 1.7) * 7.5;
      const fy =
        Math.cos(b.x * 0.0038 + t * 0.29 + b.driftSeed * 0.8) * 12.0 +
        Math.sin(b.y * 0.0034 + t * 0.21 - b.driftSeed) * 6.5 -
        1.4; // feather-light upward buoyancy hint

      b.vx += fx * dt;
      b.vy += fy * dt;

      // 2. Cursor/touch air current & hover highlight
      if (this.pointerActive) {
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

          // Entrainment: air dragged along pointer velocity vector
          const airForce = 2.65 * weight;
          b.vx += this.pointerVx * airForce * dt;
          b.vy += this.pointerVy * airForce * dt;

          // Bow-wave push: fast cursor also parts bubbles out of its immediate path
          if (dist < b.radius + 54) {
            const bow = Math.min(480, pointerSpeed * 0.55) * weight * 1.7;
            b.vx += (dx / dist) * bow * dt;
            b.vy += (dy / dist) * bow * dt;
          }

          // Subtle wobble ripple from wind gust
          if (pointerSpeed > 180) {
            b.wobbleAngle = Math.atan2(this.pointerVy, this.pointerVx);
            b.wobbleVel += Math.min(0.8, pointerSpeed * 0.0012) * weight * dt * 18;
          }
        }
      } else if (b.hoverGlow > 0.001) {
        b.hoverGlow *= Math.exp(-8 * dt);
      }

      // 3. Gentle air resistance (fast pushes coast smoothly, then settle into serene float)
      b.vx *= dragFactor;
      b.vy *= dragFactor;

      // Speed cap for numerical stability
      const speed = Math.hypot(b.vx, b.vy);
      if (speed > 620) {
        const clamp = 620 / speed;
        b.vx *= clamp;
        b.vy *= clamp;
      }

      // 4. Integrate position
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      // 5. Soft elastic wall bounce with film squash
      const r = b.radius;
      if (b.x < r) {
        b.x = r;
        const impact = Math.abs(b.vx);
        b.vx = impact * WALL_RESTITUTION;
        this.exciteWobble(b, 0, impact * 0.0042);
      } else if (b.x > this.width - r) {
        b.x = this.width - r;
        const impact = Math.abs(b.vx);
        b.vx = -impact * WALL_RESTITUTION;
        this.exciteWobble(b, Math.PI, impact * 0.0042);
      }

      if (b.y < r) {
        b.y = r;
        const impact = Math.abs(b.vy);
        b.vy = impact * WALL_RESTITUTION;
        this.exciteWobble(b, Math.PI * 0.5, impact * 0.0042);
      } else if (b.y > this.height - r) {
        b.y = this.height - r;
        const impact = Math.abs(b.vy);
        b.vy = -impact * WALL_RESTITUTION;
        this.exciteWobble(b, -Math.PI * 0.5, impact * 0.0042);
      }

      // 6. Iridescent soap-film swirl rotation & surface-tension spring wobble
      b.filmPhase += (b.filmSpin + speed * 0.0045) * dt;
      b.wobblePhase3 += (0.85 + speed * 0.006) * dt;

      // Natural harmonic frequency inversely proportional to sqrt(radius)
      const omega = 5.4 / Math.sqrt(Math.max(0.45, b.radius / 50));
      const damping = 2.6;
      const wobbleAcc = -(omega * omega) * b.wobbleAmp - damping * b.wobbleVel;
      b.wobbleVel += wobbleAcc * dt;
      b.wobbleAmp += b.wobbleVel * dt;
      // Soft ambient breathing baseline so floating bubbles never look dead-rigid
      b.wobbleAmp = Math.max(-0.16, Math.min(0.16, b.wobbleAmp));
    }
  }

  private exciteWobble(b: Bubble, angle: number, impulse: number): void {
    const clamped = Math.min(1.4, impulse);
    if (clamped < 0.04) return;
    b.wobbleAngle = angle;
    b.wobbleVel -= clamped; // negative = initial squash along collision axis
  }

  private resolveBubbleCollisions(): void {
    const toPop = new Map<number, number>(); // index -> originAngle

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

        // Relative velocity of b with respect to a along collision normal
        const rvx = b.vx - a.vx;
        const rvy = b.vy - a.vy;
        const relNormalVel = rvx * nx + rvy * ny;
        const impactSpeed = -relNormalVel;

        // Check hard collision pop threshold (only when approaching each other)
        if (impactSpeed > 0) {
          const largerIsA = a.radius >= b.radius;
          const fragileRadius = largerIsA ? a.radius : b.radius;
          const threshold = this.getCollisionPopThreshold(fragileRadius);

          if (impactSpeed >= EXTREME_IMPACT_SPEED) {
            const angleA = Math.atan2(ny, nx);
            const angleB = Math.atan2(-ny, -nx);
            toPop.set(i, angleA);
            toPop.set(j, angleB);
            continue;
          }

          if (impactSpeed >= threshold) {
            if (largerIsA) {
              toPop.set(i, Math.atan2(ny, nx));
              // Survivor gets light elastic recoil and wobble
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
        const shareA = b.mass / totalMass;
        const shareB = a.mass / totalMass;

        a.x -= nx * overlap * shareA;
        a.y -= ny * overlap * shareA;
        b.x += nx * overlap * shareB;
        b.y += ny * overlap * shareB;

        if (relNormalVel < 0) {
          const jImpulse = (-(1 + BUBBLE_RESTITUTION) * relNormalVel) / (1 / a.mass + 1 / b.mass);
          const ix = jImpulse * nx;
          const iy = jImpulse * ny;
          a.vx -= ix / a.mass;
          a.vy -= iy / a.mass;
          b.vx += ix / b.mass;
          b.vy += iy / b.mass;

          const wobbleKick = Math.min(1.15, impactSpeed * 0.0075);
          const angleNormal = Math.atan2(ny, nx);
          this.exciteWobble(a, angleNormal, wobbleKick);
          this.exciteWobble(b, angleNormal + Math.PI, wobbleKick);
        }
      }
    }

    if (toPop.size > 0) {
      // Pop from highest index down so splicing never invalidates remaining indices
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
    // Spawn gently from a random viewport edge drifting inward
    const edge = Math.floor(this.rng() * 4);
    let x = this.width * 0.5;
    let y = this.height * 0.5;
    let vx = 0;
    let vy = 0;

    if (edge === 0) {
      // Bottom edge drifting gently up
      x = r + this.rng() * Math.max(10, this.width - r * 2);
      y = this.height - r - 2;
      vx = (this.rng() - 0.5) * 18;
      vy = -(16 + this.rng() * 18);
    } else if (edge === 1) {
      // Left edge drifting gently right
      x = r + 2;
      y = r + this.rng() * Math.max(10, this.height - r * 2);
      vx = 16 + this.rng() * 18;
      vy = (this.rng() - 0.5) * 18;
    } else if (edge === 2) {
      // Right edge drifting gently left
      x = this.width - r - 2;
      y = r + this.rng() * Math.max(10, this.height - r * 2);
      vx = -(16 + this.rng() * 18);
      vy = (this.rng() - 0.5) * 18;
    } else {
      // Top edge drifting gently down
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
