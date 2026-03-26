export function MetricCard({ label, value, sub, accent, delay }: {
  label: string; value: string | number; sub?: string; accent?: string; delay: number;
}) {
  return (
    <div className={`animate-fade-up stagger-${delay} bg-obs-raised border border-obs-edge rounded-xl px-5 py-4 group hover:border-obs-rule transition-colors`}>
      <p className="text-[14px] font-semibold uppercase tracking-[0.12em] text-obs-ghost mb-2">{label}</p>
      <p className="text-[28px] font-bold font-mono tracking-tight" style={{ color: accent || '#E4E8EF' }}>
        {value}
      </p>
      {sub && <p className="text-[14px] text-obs-dim mt-1">{sub}</p>}
    </div>
  );
}
