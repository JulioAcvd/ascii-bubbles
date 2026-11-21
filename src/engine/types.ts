export type RendererMode = 'auto' | 'webgl2' | 'canvas2d';
export type ActiveBackend = 'webgl2' | 'canvas2d';

export type BubbleStyle = 'realistic' | 'classic' | 'crystalline' | 'dense' | 'organic';

export type BackgroundStyle = 'atmosphere' | 'currents' | 'nebula' | 'grid' | 'mist' | 'none';

export interface RenderSettings {
  fontSize: number;
  rendererMode: RendererMode;
  adaptiveQuality: boolean;
  targetBubbleCount: number;
  bubbleStyle: BubbleStyle;
  backgroundStyle: BackgroundStyle;
  backgroundOpacity: number;
  wobbleIntensity: number;
}

export interface Telemetry {
  fps: number;
  frameTimeMs: number;
  vsyncIntervalMs: number;
  estimatedHz: number;
  backend: ActiveBackend;
  cols: number;
  rows: number;
  effectiveFontSize: number;
  bubbleCount: number;
  particleCount: number;
  poppedTotal: number;
}

export interface Bubble {
  id: number;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  radius: number;
  targetRadius: number;
  mass: number;
  filmPhase: number;
  filmSpin: number;
  filmThicknessBias: number;
  wobbleAmp: number;
  wobbleVel: number;
  wobbleAngle: number;
  wobblePhase3: number;
  driftSeed: number;
  age: number;
  hoverGlow: number;
}

export interface RuptureRing {
  x: number;
  y: number;
  radius: number;
  originAngle: number;
  age: number;
  duration: number;
  filmPhase: number;
  filmBias: number;
}

export interface PopParticle {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  age: number;
  maxAge: number;
  r: number;
  g: number;
  b: number;
  drag: number;
  gravity: number;
  kind: 0 | 1;
}

export interface StarDust {
  nx: number;
  ny: number;
  depth: number;
  twinklePhase: number;
  twinkleSpeed: number;
  driftVx: number;
  driftVy: number;
  glyphIdx: number;
  r: number;
  g: number;
  b: number;
}

export interface PopEvent {
  x: number;
  y: number;
  radius: number;
  cause: 'click' | 'collision';
}

export interface GridBuffer {
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  glyphIdx: Uint8Array;
  rgba: Uint8Array;
}

export interface PointerInteractionResult {
  action: 'popped' | 'spawned' | 'none';
  popEvent?: PopEvent;
  bubbleId?: number;
}
