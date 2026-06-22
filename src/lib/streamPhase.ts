export type StreamPhaseV2 = 'STARTUP' | 'EARLY_GROWTH' | 'PRIME_TIME' | 'WRAP_UP';

export interface StreamPhaseResult {
  phase:             StreamPhaseV2;
  label:             string;       // Norwegian UI label
  description:       string;       // Why these tasks right now
  color:             'green' | 'yellow' | 'orange' | 'blue';
  raidAllowed:       boolean;
  expectedTotalMin:  number;       // Historical avg or default
  wrapUpStartsAtMin: number;       // When WRAP_UP begins (expected end - 20 min)
  raidUnlocksAtMin:  number;       // max(90, expectedTotal * 0.75)
}

const DEFAULT_DURATION_MIN = 120;

export function computeStreamPhase(
  elapsedMin: number,
  avgHistoricalMin: number,
): StreamPhaseResult {
  const expectedTotalMin  = Math.max(60, avgHistoricalMin > 0 ? avgHistoricalMin : DEFAULT_DURATION_MIN);
  // WRAP_UP starts 20 min before expected end, but never before 60 min in
  const wrapUpStartsAtMin = Math.max(60, Math.round(expectedTotalMin - 20));
  // Raid: never before 90 min AND never before 75% of expected total
  const raidUnlocksAtMin  = Math.max(90, Math.round(expectedTotalMin * 0.75));

  const raidAllowed = elapsedMin >= raidUnlocksAtMin;

  let phase: StreamPhaseV2;
  if (elapsedMin < 20) {
    phase = 'STARTUP';
  } else if (elapsedMin < 60) {
    phase = 'EARLY_GROWTH';
  } else if (elapsedMin < wrapUpStartsAtMin) {
    phase = 'PRIME_TIME';
  } else {
    phase = 'WRAP_UP';
  }

  const PHASE_META: Record<StreamPhaseV2, Omit<StreamPhaseResult, 'phase' | 'raidAllowed' | 'expectedTotalMin' | 'wrapUpStartsAtMin' | 'raidUnlocksAtMin'>> = {
    STARTUP: {
      label:       'Oppstart',
      color:       'green',
      description: 'Aktiver chatten. Annonser på X og Discord. Ingen sponsor eller raid ennå.',
    },
    EARLY_GROWTH: {
      label:       'Vekst',
      color:       'yellow',
      description: 'Bygg opp chatten. Kjør poll. Sponsor kan nevnes naturlig. Raid er for tidlig.',
    },
    PRIME_TIME: {
      label:       'Primetime',
      color:       'orange',
      description: 'Høy energi. Klippbare øyeblikk. Sponsor og CTA. Raid kun mot slutten.',
    },
    WRAP_UP: {
      label:       'Avslutning',
      color:       'blue',
      description: 'Minne om Discord. Siste sponsor. Velg raid-mål. Avslutt sterkt.',
    },
  };

  return {
    phase,
    raidAllowed,
    expectedTotalMin,
    wrapUpStartsAtMin,
    raidUnlocksAtMin,
    ...PHASE_META[phase],
  };
}
