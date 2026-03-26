import { ChurnScore } from '../types';

export function Sparkline({ history }: { history: ChurnScore[] }) {
  const valid = history.filter(h => h.score !== null);
  if (valid.length === 0) return <p className="text-[14px] text-obs-ghost py-4">No history available</p>;

  const W = 280, H = 64;
  const scores = valid.map(h => h.score as number);

  if (valid.length === 1) {
    return (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <circle cx={W / 2} cy={H / 2} r="4" fill="#7C6AFF" />
      </svg>
    );
  }

  const pts = scores.map((s, i) => {
    const x = (i / (scores.length - 1)) * (W - 16) + 8;
    const y = H - 8 - (s / 100) * (H - 16);
    return `${x},${y}`;
  });

  const areaPath = [`M8,${H}`, ...pts.map(p => `L${p}`), `L${W - 8},${H}`, 'Z'].join(' ');
  const linePath = [`M${pts[0]}`, ...pts.slice(1).map(p => `L${p}`)].join(' ');
  const lastPt = pts[pts.length - 1].split(',');

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7C6AFF" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#7C6AFF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#sparkGrad)" />
      <path d={linePath} fill="none" stroke="#7C6AFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastPt[0]} cy={lastPt[1]} r="4" fill="#7C6AFF" />
      <circle cx={lastPt[0]} cy={lastPt[1]} r="6" fill="none" stroke="#7C6AFF" strokeWidth="1" opacity="0.3" />
    </svg>
  );
}
