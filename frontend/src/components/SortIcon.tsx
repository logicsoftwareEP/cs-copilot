export function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (!active) return <span className="ml-1 text-obs-invisible">{'\u21D5'}</span>;
  return <span className="ml-1 text-obs-accent">{dir === 'asc' ? '\u2191' : '\u2193'}</span>;
}
