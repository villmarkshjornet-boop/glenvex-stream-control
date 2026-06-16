export function tidSiden(iso: string): string {
  const sek = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sek < 60)    return 'akkurat nå';
  if (sek < 3600)  return `${Math.floor(sek / 60)}m siden`;
  if (sek < 86400) return `${Math.floor(sek / 3600)}t siden`;
  return `${Math.floor(sek / 86400)}d siden`;
}

export function alderLabel(ts: string | null): string {
  if (!ts) return '—';
  return tidSiden(ts);
}

export function healthDot(ts: string | null, warnMs: number): string {
  if (!ts) return 'bg-g-muted/30';
  const age = Date.now() - new Date(ts).getTime();
  if (age > warnMs * 3) return 'bg-red-400';
  if (age > warnMs) return 'bg-yellow-400';
  return 'bg-g-green';
}
