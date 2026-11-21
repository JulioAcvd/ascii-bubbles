export interface AudioToggleProps {
  muted: boolean;
  onToggle: () => void;
}

export function AudioToggle({ muted, onToggle }: AudioToggleProps) {
  return (
    <button
      type="button"
      className="ascii-audio-toggle"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label={muted ? 'Activar sonido' : 'Silenciar sonido'}
      title={muted ? 'Activar sonido' : 'Silenciar sonido'}
    >
      {muted ? '[snd:off]' : '[snd:on]'}
    </button>
  );
}
