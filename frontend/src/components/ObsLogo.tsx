export function ObsLogo() {
  return (
    <div className="relative w-8 h-8 flex items-center justify-center">
      <div className="absolute inset-0 rounded-lg bg-obs-accent/10" />
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <circle cx="9" cy="9" r="7" stroke="#7C6AFF" strokeWidth="1.5" strokeDasharray="3 2" />
        <circle cx="9" cy="9" r="3" fill="#7C6AFF" />
        <circle cx="9" cy="9" r="1" fill="#111318" />
      </svg>
    </div>
  );
}
