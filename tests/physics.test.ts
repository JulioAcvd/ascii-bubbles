import { describe, expect, it } from 'vitest';
import { BubbleSimulation, FIXED_DT } from '../src/engine/physics';

describe('BubbleSimulation physics', () => {
  it('seeds initial bubbles and background stars within viewport bounds', () => {
    const sim = new BubbleSimulation({ width: 1200, height: 800, targetBubbleCount: 16, seed: 42 });
    expect(sim.bubbles.length).toBe(16);
    expect(sim.stars.length).toBeGreaterThan(50);

    for (const b of sim.bubbles) {
      expect(b.x).toBeGreaterThanOrEqual(b.radius - 1);
      expect(b.x).toBeLessThanOrEqual(1200 - b.radius + 1);
      expect(b.y).toBeGreaterThanOrEqual(b.radius - 1);
      expect(b.y).toBeLessThanOrEqual(800 - b.radius + 1);
    }
  });

  it('pops a bubble when clicked, spawning a rupture ring and iridescent droplet particles', () => {
    const sim = new BubbleSimulation({ width: 1000, height: 700, targetBubbleCount: 8, seed: 7 });
    const target = sim.bubbles[0];
    const initialCount = sim.bubbles.length;

    const result = sim.handlePointerDown(target.x + target.radius * 0.4, target.y);
    expect(result.action).toBe('popped');
    expect(result.popEvent?.cause).toBe('click');
    expect(sim.bubbles.length).toBe(initialCount - 1);
    expect(sim.rings.length).toBe(1);
    expect(sim.particles.length).toBeGreaterThanOrEqual(18);
    expect(sim.poppedTotal).toBe(1);
  });

  it('spawns a new bubble when clicking empty space', () => {
    const sim = new BubbleSimulation({ width: 1000, height: 700, targetBubbleCount: 2, seed: 99 });
    // Clear existing bubbles to guarantee empty click
    sim.bubbles.length = 0;

    const result = sim.handlePointerDown(500, 350);
    expect(result.action).toBe('spawned');
    expect(sim.bubbles.length).toBe(1);
    expect(sim.bubbles[0].x).toBeCloseTo(500, 0);
    expect(sim.bubbles[0].y).toBeCloseTo(350, 0);
    // Spawns small and inflates toward targetRadius
    expect(sim.bubbles[0].radius).toBeLessThan(sim.bubbles[0].targetRadius);
  });

  it('bounces bubbles elastically with wobble on soft collision without popping', () => {
    const sim = new BubbleSimulation({ width: 1000, height: 700, targetBubbleCount: 2, seed: 11 });
    const [a, b] = sim.bubbles;
    a.radius = 45;
    a.targetRadius = 45;
    a.mass = 45 * 45;
    a.x = 460;
    a.y = 350;
    a.vx = 40;
    a.vy = 0;
    a.wobbleAmp = 0;
    a.wobbleVel = 0;

    b.radius = 45;
    b.targetRadius = 45;
    b.mass = 45 * 45;
    b.x = 540; // overlapping by 10px
    b.y = 350;
    b.vx = -40;
    b.vy = 0;
    b.wobbleAmp = 0;
    b.wobbleVel = 0;

    sim.step(FIXED_DT);

    expect(sim.bubbles.length).toBe(2);
    expect(a.vx).toBeLessThan(0);
    expect(b.vx).toBeGreaterThan(0);
    expect(Math.abs(a.wobbleVel)).toBeGreaterThan(0.1);
    expect(Math.abs(b.wobbleVel)).toBeGreaterThan(0.1);
  });

  it('pops the larger/fragile bubble on a strong collision', () => {
    const sim = new BubbleSimulation({ width: 1000, height: 700, targetBubbleCount: 2, seed: 13 });
    const [large, small] = sim.bubbles;
    large.radius = 70;
    large.targetRadius = 70;
    large.mass = 70 * 70;
    large.x = 460;
    large.y = 350;
    large.vx = 110;
    large.vy = 0;

    small.radius = 35;
    small.targetRadius = 35;
    small.mass = 35 * 35;
    small.x = 560; // distance 100 < 105 -> colliding at 210 px/s (above threshold, below extreme)
    small.y = 350;
    small.vx = -100;
    small.vy = 0;

    sim.step(FIXED_DT);

    expect(sim.bubbles.length).toBe(1);
    expect(sim.bubbles[0].id).toBe(small.id);
    const events = sim.drainPopEvents();
    expect(events.length).toBe(1);
    expect(events[0].cause).toBe('collision');
    expect(sim.rings.length).toBe(1);
    expect(sim.particles.length).toBeGreaterThanOrEqual(18);
  });

  it('pops both bubbles on an extreme high-speed impact', () => {
    const sim = new BubbleSimulation({ width: 1000, height: 700, targetBubbleCount: 2, seed: 17 });
    const [a, b] = sim.bubbles;
    a.radius = 50;
    a.targetRadius = 50;
    a.x = 460;
    a.y = 350;
    a.vx = 180;
    a.vy = 0;

    b.radius = 50;
    b.targetRadius = 50;
    b.x = 550;
    b.y = 350;
    b.vx = -180;
    b.vy = 0;

    sim.step(FIXED_DT);

    expect(sim.bubbles.length).toBe(0);
    expect(sim.drainPopEvents().length).toBe(2);
  });

  it('pushes nearby bubbles using cursor air currents', () => {
    const sim = new BubbleSimulation({ width: 1000, height: 700, targetBubbleCount: 1, seed: 21 });
    const b = sim.bubbles[0];
    b.x = 500;
    b.y = 350;
    b.vx = 0;
    b.vy = 0;

    // Sweep cursor briskly rightward near the bubble
    sim.setPointer(460, 350, true, FIXED_DT);
    sim.setPointer(485, 350, true, FIXED_DT);
    for (let i = 0; i < 6; i++) {
      sim.step(FIXED_DT);
    }

    expect(b.vx).toBeGreaterThan(8);
  });

  it('automatically respawns bubbles after popping to maintain target population', () => {
    const sim = new BubbleSimulation({ width: 1000, height: 700, targetBubbleCount: 6, seed: 31 });
    sim.bubbles.length = 2;

    // Advance 3 seconds of simulation time
    for (let i = 0; i < 360; i++) {
      sim.step(FIXED_DT);
    }

    expect(sim.bubbles.length).toBeGreaterThanOrEqual(5);
  });

  it('grows a giant bubble while blowing and releases it with realistic weight and pinch-off wobble', () => {
    const sim = new BubbleSimulation({ width: 1200, height: 800, targetBubbleCount: 1, seed: 55 });
    sim.bubbles.length = 0;

    const blown = sim.startBlowing(600, 320);
    expect(blown.isInflating).toBe(true);
    expect(sim.isBlowing()).toBe(true);

    // Hold for ~2.2 seconds -> grows into a large/giant bubble without bursting yet
    for (let i = 0; i < 264; i++) {
      sim.step(FIXED_DT);
    }

    expect(sim.isBlowing()).toBe(true);
    expect(blown.radius).toBeGreaterThan(95);
    expect(blown.giantFactor).toBeGreaterThan(0.25);
    expect(blown.strain).toBeGreaterThan(0.15);
    // Heavy giant soap bubble hangs slightly below the wand tip
    expect(blown.y).toBeGreaterThan(320 + 10);

    const released = sim.releaseBlowing();
    expect(released?.id).toBe(blown.id);
    expect(released?.isInflating).toBe(false);
    expect(sim.isBlowing()).toBe(false);
    expect(Math.abs(released?.wobbleVel ?? 0)).toBeGreaterThan(0.5);
  });

  it('bursts a blown bubble right on the wand if held too long (over-inflation)', () => {
    const sim = new BubbleSimulation({ width: 1200, height: 800, targetBubbleCount: 1, seed: 61 });
    sim.bubbles.length = 0;

    sim.startBlowing(600, 350);

    // Hold continuously for 6 seconds -> guaranteed to exceed burstRadius and snap on the wand
    let overinflateEvent = null;
    for (let i = 0; i < 720; i++) {
      sim.step(FIXED_DT);
      const events = sim.drainPopEvents();
      const found = events.find((e) => e.cause === 'overinflate');
      if (found) {
        overinflateEvent = found;
        break;
      }
    }

    expect(overinflateEvent).not.toBeNull();
    expect(overinflateEvent?.cause).toBe('overinflate');
    expect(sim.isBlowing()).toBe(false);
    expect(sim.rings.length).toBeGreaterThanOrEqual(1);
    expect(sim.particles.length).toBeGreaterThan(40);
  });

  it('makes giant bubbles noticeably more fragile on impact than small bubbles', () => {
    const sim = new BubbleSimulation({ width: 1200, height: 800, targetBubbleCount: 1, seed: 73 });
    const smallThreshold = sim.getCollisionPopThreshold(32);
    const giantThreshold = sim.getCollisionPopThreshold(155);
    expect(giantThreshold).toBeLessThan(smallThreshold * 0.65);
  });
});
