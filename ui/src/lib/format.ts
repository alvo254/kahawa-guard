// Small formatting helpers shared across surfaces.

export function timeOfDay(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function clockNow(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function compact(n: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function pct(used: number, cap: number): number {
  if (cap <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((used / cap) * 100)));
}

/** Short, human session label from a phone hash — never the hash in full. */
export function sessionLabel(phoneHash: string): string {
  if (!phoneHash) return "—";
  return phoneHash.slice(0, 6);
}

export function truncate(s: string, n = 120): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
