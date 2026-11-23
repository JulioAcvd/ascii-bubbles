import type {
  BackgroundStyle,
  BubbleStyle,
  CrtMode,
  RendererMode,
  RenderSettings,
  Telemetry,
} from '../engine/types';

export interface DebugPanelProps {
  settings: RenderSettings;
  telemetry: Telemetry;
  onChange: (patch: Partial<RenderSettings>) => void;
  onClose: () => void;
}

const BUBBLE_STYLES: { label: string; value: BubbleStyle; hint: string }[] = [
  { label: 'Realista', value: 'realistic', hint: 'Gradiente suave antialias: .,\':;~-=+*%#@' },
  { label: 'Original', value: 'classic', hint: 'Preset inicial con contorno ()/\\-_ y .:-~=+*#%@' },
  { label: 'Cristalino', value: 'crystalline', hint: 'Borde fino brillante: .\'`:;+*oO@' },
  { label: 'Denso', value: 'dense', hint: 'Volumen 3D marcado: .:-=+o*O0#8%$@' },
  { label: 'Orgánico', value: 'organic', hint: 'Trazos curvos blandos: .,:~co+*O@' },
];

const BACKGROUND_STYLES: { label: string; value: BackgroundStyle }[] = [
  { label: 'Atmósfera', value: 'atmosphere' },
  { label: 'Corrientes', value: 'currents' },
  { label: 'Neblina', value: 'nebula' },
  { label: 'Rejilla', value: 'grid' },
  { label: 'Bruma', value: 'mist' },
  { label: 'Negro', value: 'none' },
];

const DENSITY_PRESETS = [
  { label: 'Fina (11px)', fontSize: 11 },
  { label: 'Media (14px)', fontSize: 14 },
  { label: 'Gruesa (18px)', fontSize: 18 },
] as const;

const RENDERER_MODES: { label: string; value: RendererMode }[] = [
  { label: 'Auto', value: 'auto' },
  { label: 'WebGL2', value: 'webgl2' },
  { label: 'Canvas 2D', value: 'canvas2d' },
];

const CRT_MODES: { label: string; value: CrtMode; hint: string }[] = [
  { label: 'Apagado', value: 'off', hint: 'Imagen digital limpia sin filtro CRT' },
  { label: 'PVM Sutil', value: 'subtle', hint: 'Monitor de estudio: colores vivos, bloom suave y scanlines finas' },
  { label: 'TV Retro', value: 'classic', hint: 'Tubo CRT clásico: curvatura, fósforo vibrante y aberración RGB' },
  { label: 'Arcade', value: 'arcade', hint: 'Brillo fósforo intenso, alto contraste y color eléctrico' },
];

export function DebugPanel({ settings, telemetry, onChange, onClose }: DebugPanelProps) {
  const activeBubbleHint =
    BUBBLE_STYLES.find((s) => s.value === settings.bubbleStyle)?.hint ?? '';
  const activeCrtHint =
    CRT_MODES.find((c) => c.value === settings.crtMode)?.hint ?? '';

  return (
    <aside
      className="ascii-debug-panel"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      aria-label="Panel de configuración y rendimiento ASCII"
    >
      <div className="ascii-debug-header">
        <span>:: CONFIG &amp; PERF [F]</span>
        <button
          type="button"
          className="ascii-debug-close"
          onClick={onClose}
          aria-label="Cerrar panel"
        >
          [x]
        </button>
      </div>

      <div className="ascii-debug-stats">
        <div>
          <span className="k">FPS / Hz</span>
          <span className="v">
            {telemetry.fps} fps (~{telemetry.estimatedHz}Hz)
          </span>
        </div>
        <div>
          <span className="k">Frame CPU</span>
          <span className="v">{telemetry.frameTimeMs.toFixed(2)} ms</span>
        </div>
        <div>
          <span className="k">Backend</span>
          <span className="v">{telemetry.backend.toUpperCase()}</span>
        </div>
        <div>
          <span className="k">Grilla</span>
          <span className="v">
            {telemetry.cols}x{telemetry.rows} ({telemetry.effectiveFontSize}px)
          </span>
        </div>
        <div>
          <span className="k">Escena</span>
          <span className="v">
            {telemetry.bubbleCount} burb / {telemetry.particleCount} part / {telemetry.poppedTotal} pop
          </span>
        </div>
      </div>

      <div className="ascii-debug-section">
        <div className="ascii-debug-label">Efecto CRT Retro</div>
        <div className="ascii-debug-btn-grid-4">
          {CRT_MODES.map((crt) => (
            <button
              key={crt.value}
              type="button"
              className={settings.crtMode === crt.value ? 'active' : ''}
              onClick={() => onChange({ crtMode: crt.value })}
            >
              {crt.label}
            </button>
          ))}
        </div>
        <div className="ascii-debug-hint">{activeCrtHint}</div>
      </div>

      {settings.crtMode !== 'off' && (
        <div className="ascii-debug-section">
          <label className="ascii-debug-label" htmlFor="ascii-crt-slider">
            Intensidad CRT: <strong>{Math.round(settings.crtIntensity * 100)}%</strong>
          </label>
          <input
            id="ascii-crt-slider"
            type="range"
            min={0.35}
            max={1.5}
            step={0.05}
            value={settings.crtIntensity}
            onChange={(e) => onChange({ crtIntensity: Number(e.target.value) })}
          />
        </div>
      )}

      <div className="ascii-debug-section">
        <div className="ascii-debug-label">Estilo ASCII de burbujas</div>
        <div className="ascii-debug-btn-grid">
          {BUBBLE_STYLES.map((style) => (
            <button
              key={style.value}
              type="button"
              className={settings.bubbleStyle === style.value ? 'active' : ''}
              onClick={() => onChange({ bubbleStyle: style.value })}
            >
              {style.label}
            </button>
          ))}
        </div>
        <div className="ascii-debug-hint">{activeBubbleHint}</div>
      </div>

      <div className="ascii-debug-section">
        <label className="ascii-debug-label" htmlFor="ascii-wobble-slider">
          Deformación orgánica: <strong>{settings.wobbleIntensity.toFixed(1)}x</strong>
        </label>
        <input
          id="ascii-wobble-slider"
          type="range"
          min={0.3}
          max={2.0}
          step={0.1}
          value={settings.wobbleIntensity}
          onChange={(e) => onChange({ wobbleIntensity: Number(e.target.value) })}
        />
      </div>

      <div className="ascii-debug-section">
        <div className="ascii-debug-label">Fondo ASCII</div>
        <div className="ascii-debug-btn-grid">
          {BACKGROUND_STYLES.map((bg) => (
            <button
              key={bg.value}
              type="button"
              className={settings.backgroundStyle === bg.value ? 'active' : ''}
              onClick={() => onChange({ backgroundStyle: bg.value })}
            >
              {bg.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ascii-debug-section">
        <label className="ascii-debug-label" htmlFor="ascii-bg-opacity-slider">
          Opacidad del fondo: <strong>{Math.round(settings.backgroundOpacity * 100)}%</strong>
        </label>
        <input
          id="ascii-bg-opacity-slider"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={settings.backgroundOpacity}
          onChange={(e) => onChange({ backgroundOpacity: Number(e.target.value) })}
        />
      </div>

      <div className="ascii-debug-section">
        <label className="ascii-debug-label" htmlFor="ascii-font-slider">
          Densidad ASCII: <strong>{settings.fontSize}px</strong>
          {telemetry.effectiveFontSize !== settings.fontSize && (
            <span className="ascii-debug-badge"> (adaptado: {telemetry.effectiveFontSize}px)</span>
          )}
        </label>
        <input
          id="ascii-font-slider"
          type="range"
          min={9}
          max={22}
          step={1}
          value={settings.fontSize}
          onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
        />
        <div className="ascii-debug-btn-row">
          {DENSITY_PRESETS.map((preset) => (
            <button
              key={preset.fontSize}
              type="button"
              className={settings.fontSize === preset.fontSize ? 'active' : ''}
              onClick={() => onChange({ fontSize: preset.fontSize })}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ascii-debug-section">
        <div className="ascii-debug-label">Motor de renderizado</div>
        <div className="ascii-debug-btn-row">
          {RENDERER_MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              className={settings.rendererMode === m.value ? 'active' : ''}
              onClick={() => onChange({ rendererMode: m.value })}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ascii-debug-section">
        <label className="ascii-debug-label" htmlFor="ascii-bubbles-slider">
          Burbujas objetivo: <strong>{settings.targetBubbleCount}</strong>
        </label>
        <input
          id="ascii-bubbles-slider"
          type="range"
          min={6}
          max={36}
          step={1}
          value={settings.targetBubbleCount}
          onChange={(e) => onChange({ targetBubbleCount: Number(e.target.value) })}
        />
      </div>

      <label className="ascii-debug-checkbox">
        <input
          type="checkbox"
          checked={settings.adaptiveQuality}
          onChange={(e) => onChange({ adaptiveQuality: e.target.checked })}
        />
        <span>Escalado adaptativo (protege 60fps en equipos lentos)</span>
      </label>
    </aside>
  );
}
