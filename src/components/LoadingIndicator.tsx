import { useEffect, useState } from 'react';

const SPINNER_FRAMES = ['|', '/', '-', '\\'] as const;

export interface LoadingIndicatorProps {
  label?: string;
  progress?: number;
}

export function LoadingIndicator({ label = 'cargando...', progress }: LoadingIndicatorProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, 140);
    return () => window.clearInterval(id);
  }, []);

  const hasProgress = typeof progress === 'number' && Number.isFinite(progress);
  const clamped = hasProgress ? Math.max(0, Math.min(100, Math.round(progress))) : 0;

  let barText = '';
  if (hasProgress) {
    const slots = 14;
    const filled = Math.round((clamped / 100) * slots);
    barText = `[${'='.repeat(filled)}${'-'.repeat(slots - filled)}] ${String(clamped).padStart(3, ' ')}%`;
  }

  return (
    <div className="ascii-loader-status" aria-live="polite" role="status">
      <span className="ascii-loader-spinner" aria-hidden="true">
        [{SPINNER_FRAMES[frame]}]
      </span>
      <span className="ascii-loader-label">{label}</span>
      {hasProgress && <span className="ascii-loader-bar">{barText}</span>}
    </div>
  );
}
