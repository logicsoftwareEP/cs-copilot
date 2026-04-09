export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
