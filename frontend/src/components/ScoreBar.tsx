export function ScoreBar({ pts, max, color }: { pts: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((pts / max) * 100) : 0;
  return (
    <div className="h-1.5 rounded-full bg-obs-edge overflow-hidden mt-2">
      <div
        className="h-full rounded-full transition-all duration-700 ease-out"
        style={{ width: `${pct}%`, background: color, boxShadow: `0 0 8px ${color}40` }}
      />
    </div>
  );
}
