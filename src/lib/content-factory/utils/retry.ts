export interface RetryOptions {
  maxForsøk?: number;
  venteMs?: number;
  backoff?: boolean;
}

export async function medRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const { maxForsøk = 3, venteMs = 2000, backoff = true } = opts;
  let sisteFeil: Error | null = null;

  for (let forsøk = 1; forsøk <= maxForsøk; forsøk++) {
    try {
      return await fn();
    } catch (err) {
      sisteFeil = err as Error;
      const erSiste = forsøk === maxForsøk;

      // Ikke retry ved visse feil
      const msg = (err as Error).message ?? '';
      if (msg.includes('Invalid file format') || msg.includes('FEATURE_DISABLED')) {
        throw err;
      }

      if (!erSiste) {
        const venteTid = backoff ? venteMs * forsøk : venteMs;
        console.warn(`[Retry] Forsøk ${forsøk}/${maxForsøk} feilet: ${msg.slice(0, 100)} – venter ${venteTid}ms`);
        await new Promise(r => setTimeout(r, venteTid));
      }
    }
  }

  throw sisteFeil ?? new Error('Ukjent feil etter retry');
}

export function sikreJsonParse(tekst: string, fallback: any = {}): any {
  if (!tekst?.trim()) return fallback;
  try {
    return JSON.parse(tekst);
  } catch {
    // Prøv å reparere avskåret JSON
    const avsluttetMedKrøll = tekst.lastIndexOf('}');
    const avsluttetMedKlammer = tekst.lastIndexOf(']');
    const siste = Math.max(avsluttetMedKrøll, avsluttetMedKlammer);
    if (siste > 0) {
      try { return JSON.parse(tekst.slice(0, siste + 1)); } catch {}
    }
    return fallback;
  }
}

export function håndterRateLimit(err: Error): boolean {
  const msg = err.message?.toLowerCase() ?? '';
  return msg.includes('rate limit') || msg.includes('429') || msg.includes('too many');
}

export async function venteVedRateLimit(err: Error): Promise<void> {
  if (håndterRateLimit(err)) {
    console.warn('[RateLimit] Venter 60s...');
    await new Promise(r => setTimeout(r, 60_000));
  }
}
