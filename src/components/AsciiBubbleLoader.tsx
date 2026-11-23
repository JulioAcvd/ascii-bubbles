import { useCallback, useEffect, useRef, useState } from 'react';
import { BubbleAudio } from '../engine/audio';
import { measureCellMetrics } from '../engine/glyphAtlas';
import { BubbleSimulation, FIXED_DT } from '../engine/physics';
import { createGridBuffer, rasterizeScene } from '../engine/rasterizer';
import { createAsciiRenderer, type AsciiRenderer } from '../engine/renderer';
import type { ActiveBackend, GridBuffer, PopEvent, RenderSettings, Telemetry } from '../engine/types';
import { AudioToggle } from './AudioToggle';
import { DebugPanel } from './DebugPanel';
import { LoadingIndicator } from './LoadingIndicator';

export interface AsciiBubbleLoaderProps {
  /** Optional loading progress (0..100). If omitted, shows subtle indeterminate spinner. */
  progress?: number;
  /** Subtle ASCII loading caption displayed at the bottom edge. */
  label?: string;
  /** Initial target number of floating bubbles. */
  bubbleCount?: number;
  /** Initial mute state for procedural pop audio. */
  muted?: boolean;
  /** Show subtle corner ASCII audio toggle button. */
  showAudioToggle?: boolean;
  /** Show subtle corner FPS counter & config button. */
  showCornerControls?: boolean;
  /** Optional initial overrides for font size, bubble/background style, renderer backend, etc. */
  initialSettings?: Partial<RenderSettings>;
  /** Extra container CSS class. */
  className?: string;
  /** Callback invoked whenever any bubble pops (by click or collision). */
  onPop?: (event: PopEvent) => void;
}

function getResponsiveDefaults(): RenderSettings {
  const isCompact = typeof window !== 'undefined' && window.innerWidth < 640;
  return {
    fontSize: isCompact ? 10 : 12,
    rendererMode: 'auto',
    adaptiveQuality: true,
    targetBubbleCount: isCompact ? 10 : 18,
    bubbleStyle: 'realistic',
    backgroundStyle: 'atmosphere',
    backgroundOpacity: 0.65,
    wobbleIntensity: 1.0,
    crtMode: 'off',
    crtIntensity: 1.0,
  };
}

function snapHz(rawHz: number): number {
  const standards = [60, 75, 90, 120, 144, 165, 180, 240, 360];
  let best = Math.round(rawHz);
  let bestDiff = Infinity;
  for (const s of standards) {
    const diff = Math.abs(rawHz - s);
    if (diff < 8 && diff < bestDiff) {
      bestDiff = diff;
      best = s;
    }
  }
  return best;
}

export function AsciiBubbleLoader({
  progress,
  label = 'cargando...',
  bubbleCount,
  muted: initialMuted = false,
  showAudioToggle = true,
  showCornerControls = true,
  initialSettings,
  className = '',
  onPop,
}: AsciiBubbleLoaderProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<BubbleSimulation | null>(null);
  const audioRef = useRef<BubbleAudio | null>(null);
  const onPopRef = useRef(onPop);
  onPopRef.current = onPop;

  const [muted, setMuted] = useState(initialMuted);
  const [debugOpen, setDebugOpen] = useState(false);
  const [cornerFps, setCornerFps] = useState(0);
  const [activeBackend, setActiveBackend] = useState<ActiveBackend>('webgl2');
  const [settings, setSettings] = useState<RenderSettings>(() => {
    const defaults = getResponsiveDefaults();
    return {
      ...defaults,
      ...initialSettings,
      targetBubbleCount: bubbleCount ?? initialSettings?.targetBubbleCount ?? defaults.targetBubbleCount,
    };
  });

  const [telemetry, setTelemetry] = useState<Telemetry>({
    fps: 0,
    frameTimeMs: 0,
    vsyncIntervalMs: 16.67,
    estimatedHz: 60,
    backend: 'webgl2',
    cols: 0,
    rows: 0,
    effectiveFontSize: settings.fontSize,
    bubbleCount: settings.targetBubbleCount,
    particleCount: 0,
    poppedTotal: 0,
  });

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const debugOpenRef = useRef(debugOpen);
  debugOpenRef.current = debugOpen;

  useEffect(() => {
    if (typeof bubbleCount === 'number') {
      setSettings((prev) => ({ ...prev, targetBubbleCount: bubbleCount }));
    }
  }, [bubbleCount]);

  useEffect(() => {
    simRef.current?.setTargetBubbleCount(settings.targetBubbleCount);
  }, [settings.targetBubbleCount]);

  useEffect(() => {
    const audio = new BubbleAudio(initialMuted);
    audioRef.current = audio;
    return () => {
      audio.dispose();
      audioRef.current = null;
    };
  }, [initialMuted]);

  useEffect(() => {
    audioRef.current?.setMuted(muted);
  }, [muted]);

  // Config & Perf panel hotkey: press 'F'
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        setDebugOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleSettingsChange = useCallback((patch: Partial<RenderSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    let renderer: AsciiRenderer;
    try {
      renderer = createAsciiRenderer(canvas, settings.rendererMode);
      setActiveBackend(renderer.backend);
    } catch {
      return;
    }

    let width = Math.max(240, container.clientWidth || window.innerWidth);
    let height = Math.max(240, container.clientHeight || window.innerHeight);

    if (!simRef.current) {
      simRef.current = new BubbleSimulation({
        width,
        height,
        targetBubbleCount: settingsRef.current.targetBubbleCount,
      });
    } else {
      simRef.current.resize(width, height);
    }
    const sim = simRef.current;

    let adaptiveBoost = 0;
    let currentEffectiveFont = settingsRef.current.fontSize;
    let grid: GridBuffer = createGridBuffer(1, 1, 8, 14);

    const rebuildGridAndRenderer = (force = false) => {
      const targetFont = Math.max(
        9,
        Math.min(24, settingsRef.current.fontSize + (settingsRef.current.adaptiveQuality ? adaptiveBoost : 0))
      );
      const metrics = measureCellMetrics(targetFont);
      const cols = Math.max(12, Math.ceil(width / metrics.cellW));
      const rows = Math.max(8, Math.ceil(height / metrics.cellH));

      if (
        force ||
        currentEffectiveFont !== targetFont ||
        grid.cols !== cols ||
        grid.rows !== rows ||
        Math.abs(grid.cellW - metrics.cellW) > 0.05 ||
        Math.abs(grid.cellH - metrics.cellH) > 0.05
      ) {
        currentEffectiveFont = targetFont;
        grid = createGridBuffer(cols, rows, metrics.cellW, metrics.cellH);
        renderer.resize(width, height, window.devicePixelRatio || 1, targetFont);
      }
    };

    rebuildGridAndRenderer(true);

    let cancelled = false;
    if (document.fonts && document.fonts.ready) {
      void document.fonts.ready.then(() => {
        if (!cancelled) {
          rebuildGridAndRenderer(true);
        }
      });
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      width = Math.max(240, Math.round(rect.width));
      height = Math.max(240, Math.round(rect.height));
      sim.resize(width, height);
      rebuildGridAndRenderer(true);
    });
    resizeObserver.observe(container);

    let rafId = 0;
    let lastRafTime = performance.now();
    let accumulator = 0;

    let avgIntervalMs = 16.67;
    let avgWorkMs = 1.0;
    let slowDurationMs = 0;
    let fastDurationMs = 0;
    let lastTelemetryPush = 0;
    let lastCornerFpsPush = 0;

    const frameLoop = (now: number) => {
      rafId = window.requestAnimationFrame(frameLoop);

      const rawDtMs = now - lastRafTime;
      lastRafTime = now;
      const clampedDtSec = Math.min(0.05, Math.max(0.0005, rawDtMs / 1000));

      if (rawDtMs > 1 && rawDtMs < 100) {
        avgIntervalMs = avgIntervalMs * 0.92 + rawDtMs * 0.08;
      }

      const workStart = performance.now();
      const curSettings = settingsRef.current;

      if (!curSettings.adaptiveQuality && adaptiveBoost !== 0) {
        adaptiveBoost = 0;
      }
      const desiredFont = Math.max(
        9,
        Math.min(24, curSettings.fontSize + (curSettings.adaptiveQuality ? adaptiveBoost : 0))
      );
      if (desiredFont !== currentEffectiveFont) {
        rebuildGridAndRenderer(false);
      }

      // Fixed-timestep physics (120Hz internal)
      accumulator += clampedDtSec;
      let steps = 0;
      while (accumulator >= FIXED_DT && steps < 6) {
        sim.step(FIXED_DT);
        accumulator -= FIXED_DT;
        steps++;
      }

      const pops = sim.drainPopEvents();
      if (pops.length > 0) {
        for (let i = 0; i < pops.length; i++) {
          const ev = pops[i];
          audioRef.current?.playPop(ev.radius, ev.cause);
          onPopRef.current?.(ev);
        }
      }

      const alpha = Math.max(0, Math.min(1, accumulator / FIXED_DT));
      rasterizeScene(sim, grid, alpha, {
        bubbleStyle: curSettings.bubbleStyle,
        backgroundStyle: curSettings.backgroundStyle,
        backgroundOpacity: curSettings.backgroundOpacity,
        wobbleIntensity: curSettings.wobbleIntensity,
      });
      renderer.render(grid, {
        mode: curSettings.crtMode,
        intensity: curSettings.crtIntensity,
        time: sim.time,
      });

      const workMs = performance.now() - workStart;
      avgWorkMs = avgWorkMs * 0.9 + workMs * 0.1;

      // Adaptive scaling controller (protects 60fps on weak devices without flickering)
      if (curSettings.adaptiveQuality) {
        const instantFps = 1000 / Math.max(1, avgIntervalMs);
        if (instantFps < 52 && avgWorkMs > 10.5) {
          slowDurationMs += rawDtMs;
          fastDurationMs = 0;
          if (slowDurationMs > 1400 && adaptiveBoost < 6) {
            adaptiveBoost += 2;
            slowDurationMs = 0;
            rebuildGridAndRenderer(false);
          }
        } else if (avgWorkMs < 4.5 && instantFps >= 58) {
          fastDurationMs += rawDtMs;
          slowDurationMs = 0;
          if (fastDurationMs > 3800 && adaptiveBoost > 0) {
            adaptiveBoost = Math.max(0, adaptiveBoost - 2);
            fastDurationMs = 0;
            rebuildGridAndRenderer(false);
          }
        } else {
          slowDurationMs = Math.max(0, slowDurationMs - rawDtMs * 0.5);
          fastDurationMs = 0;
        }
      }

      // Lightweight corner FPS counter (~2.5 Hz)
      if (now - lastCornerFpsPush > 380) {
        lastCornerFpsPush = now;
        const measuredFps = Math.round(1000 / Math.max(1, avgIntervalMs));
        setCornerFps(measuredFps);
      }

      // Full telemetry only when config panel is open (~4 Hz)
      if (debugOpenRef.current && now - lastTelemetryPush > 240) {
        lastTelemetryPush = now;
        const measuredFps = Math.round(1000 / Math.max(1, avgIntervalMs));
        setTelemetry({
          fps: measuredFps,
          frameTimeMs: avgWorkMs,
          vsyncIntervalMs: avgIntervalMs,
          estimatedHz: snapHz(1000 / Math.max(1, avgIntervalMs)),
          backend: renderer.backend,
          cols: grid.cols,
          rows: grid.rows,
          effectiveFontSize: currentEffectiveFont,
          bubbleCount: sim.bubbles.length,
          particleCount: sim.particles.length,
          poppedTotal: sim.poppedTotal,
        });
      }
    };

    rafId = window.requestAnimationFrame(frameLoop);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      renderer.dispose();
    };
  }, [settings.rendererMode]);

  const lastMoveTimeRef = useRef<number>(0);
  const blowingPointerIdRef = useRef<number | null>(null);
  const touchHoldTimerRef = useRef<number | null>(null);
  const touchStartRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);

  const clearTouchHold = () => {
    if (touchHoldTimerRef.current !== null) {
      window.clearTimeout(touchHoldTimerRef.current);
      touchHoldTimerRef.current = null;
    }
    touchStartRef.current = null;
  };

  useEffect(() => {
    return () => {
      if (touchHoldTimerRef.current !== null) {
        window.clearTimeout(touchHoldTimerRef.current);
      }
    };
  }, []);

  const getLocalCoords = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: e.clientX, y: e.clientY };
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const sim = simRef.current;
    if (!sim) return;
    const now = performance.now();
    const dt = lastMoveTimeRef.current > 0 ? (now - lastMoveTimeRef.current) / 1000 : FIXED_DT;
    lastMoveTimeRef.current = now;
    const { x, y } = getLocalCoords(e);
    sim.setPointer(x, y, true, dt);

    if (blowingPointerIdRef.current === e.pointerId) {
      sim.updateBlowingPosition(x, y);
      return;
    }

    // Cancel pending touch long-press if finger moves briskly (user is swiping air currents)
    if (touchStartRef.current && touchStartRef.current.pointerId === e.pointerId) {
      const dist = Math.hypot(x - touchStartRef.current.x, y - touchStartRef.current.y);
      if (dist > 14) {
        clearTouchHold();
      }
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    audioRef.current?.unlock();
    const sim = simRef.current;
    if (!sim) return;
    const { x, y } = getLocalCoords(e);
    sim.setPointer(x, y, true, FIXED_DT);

    // Desktop right-click hold: blow a growing soap bubble from the cursor tip!
    if (e.button === 2) {
      e.preventDefault();
      clearTouchHold();
      blowingPointerIdRef.current = e.pointerId;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Ignore if capture is unsupported
      }
      sim.startBlowing(x, y);
      return;
    }

    // Ignore middle-click or other secondary buttons
    if (e.button !== 0) return;

    // On touchscreens: quick tap pops a bubble or spawns one; holding empty space (~220ms) blows a giant bubble!
    if (e.pointerType === 'touch') {
      const hitIdx = sim.hitTestBubble(x, y);
      if (hitIdx !== -1) {
        const result = sim.handlePointerDown(x, y);
        if (result.action === 'popped' && result.popEvent) {
          const drained = sim.drainPopEvents();
          for (const ev of drained) {
            audioRef.current?.playPop(ev.radius, ev.cause);
            onPopRef.current?.(ev);
          }
        }
        return;
      }

      clearTouchHold();
      touchStartRef.current = { x, y, pointerId: e.pointerId };
      touchHoldTimerRef.current = window.setTimeout(() => {
        touchHoldTimerRef.current = null;
        const activeSim = simRef.current;
        const start = touchStartRef.current;
        if (!activeSim || !start) return;
        blowingPointerIdRef.current = start.pointerId;
        touchStartRef.current = null;
        activeSim.startBlowing(activeSim.pointerX, activeSim.pointerY);
      }, 220);
      return;
    }

    // Desktop left-click: pop bubble or quick-spawn on empty space
    const result = sim.handlePointerDown(x, y);
    if (result.action === 'popped' && result.popEvent) {
      const drained = sim.drainPopEvents();
      for (const ev of drained) {
        audioRef.current?.playPop(ev.radius, ev.cause);
        onPopRef.current?.(ev);
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const sim = simRef.current;

    if (blowingPointerIdRef.current === e.pointerId) {
      blowingPointerIdRef.current = null;
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Ignore
      }
      sim?.releaseBlowing();
      return;
    }

    // Quick touch tap on empty space (lifted before 220ms hold threshold) -> spawn normal bubble
    if (touchStartRef.current && touchStartRef.current.pointerId === e.pointerId) {
      const { x, y } = touchStartRef.current;
      clearTouchHold();
      sim?.handlePointerDown(x, y);
    }
  };

  const handlePointerLeave = (e: React.PointerEvent<HTMLDivElement>) => {
    const sim = simRef.current;
    if (!sim) return;
    if (blowingPointerIdRef.current === e.pointerId && !e.currentTarget.hasPointerCapture(e.pointerId)) {
      blowingPointerIdRef.current = null;
      sim.releaseBlowing();
    }
    clearTouchHold();
    sim.setPointer(sim.pointerX, sim.pointerY, false);
    lastMoveTimeRef.current = 0;
  };

  const useCssCrtFallback = activeBackend === 'canvas2d' && settings.crtMode !== 'off';
  const crtCssClass = useCssCrtFallback ? `ascii-crt-fallback ascii-crt-${settings.crtMode}` : '';

  return (
    <div
      ref={containerRef}
      className={`ascii-bubble-loader ${crtCssClass} ${className}`.trim()}
      style={
        useCssCrtFallback
          ? ({ '--crt-intensity': settings.crtIntensity } as React.CSSProperties)
          : undefined
      }
      onContextMenu={(e) => e.preventDefault()}
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onPointerCancel={(e) => {
        handlePointerUp(e);
        handlePointerLeave(e);
      }}
    >
      <canvas
        key={settings.rendererMode}
        ref={canvasRef}
        className="ascii-bubble-canvas"
        aria-label="Pantalla interactiva de burbujas en caracteres ASCII"
      />

      {useCssCrtFallback && <div className="ascii-crt-overlay" aria-hidden="true" />}

      {label !== '' && <LoadingIndicator label={label} progress={progress} />}

      {(showCornerControls || showAudioToggle) && (
        <div
          className="ascii-corner-hud"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {showCornerControls && (
            <>
              <span className="ascii-fps-badge" aria-label="Cuadros por segundo">
                {cornerFps > 0 ? `${cornerFps} fps` : '-- fps'}
              </span>
              <button
                type="button"
                className={`ascii-corner-btn ${debugOpen ? 'active' : ''}`}
                onClick={() => setDebugOpen((open) => !open)}
                aria-label="Abrir configuración (tecla F)"
                title="Configuración y rendimiento (tecla F)"
              >
                [cfg]
              </button>
            </>
          )}

          {showAudioToggle && (
            <AudioToggle
              muted={muted}
              onToggle={() => {
                setMuted((prev) => {
                  const next = !prev;
                  if (!next) {
                    audioRef.current?.setMuted(false);
                    audioRef.current?.unlock();
                  }
                  return next;
                });
              }}
            />
          )}
        </div>
      )}

      {debugOpen && (
        <DebugPanel
          settings={settings}
          telemetry={telemetry}
          onChange={handleSettingsChange}
          onClose={() => setDebugOpen(false)}
        />
      )}
    </div>
  );
}
