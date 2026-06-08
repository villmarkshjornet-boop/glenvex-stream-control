# GLENVEX Creator OS — Effect Tracking & Rød Tråd Audit

**Dato:** 2026-06-08  
**Status:** Utført — funn og gaps dokumentert, forbedringer implementert

---

## 1. EKSISTERENDE FUNDAMENT

### Datatabeller og hva de eier

| Tabell | Eier | Hva lagres |
|--------|------|-----------|
| `ai_agent_events` | Bot + Vercel | Råhendelser: chat, raids, subs, reactions, Discord-meldinger |
| `ai_agent_memory` | LearningAggregator + LearningLoop | Kondensert kunnskap: viewers, members, vitser, spill-mønstre, stream-mønstre |
| `ai_agent_insights` | LearningAggregator + LearningLoop | Ekstraherte innsikter med confidence-score |
| `ai_agent_decisions` | LearningLoop (kun) | Beslutningslogg — brukes IKKE av andre systemer |
| `system_events` | Alle subsystemer | Observabilitetslogg — hva skjedde i hvert subsystem |
| `stream_history` | Ukjent skriver | Stream-resultater: peak viewers, følgere, subs, varighet |
| `community_members` | memberTracker (bot) | Discord XP, aktivitet, engasjement-score |
| `content_vods` | Content Factory | VOD-status og pipeline-fremgang |
| `content_highlights` | Highlight Discovery | Oppdagede highlights med scores |
| `cross_platform_users` | LearningAggregator | Kryss-plattform matches (Twitch ↔ Discord) |

### Dataflyt — slik ser den ut nå

```
RAW EVENTS (ai_agent_events)
  ↓ [LearningAggregator, hvert 15. min]
MEMORY + INNSIKTER (ai_agent_memory, ai_agent_insights)
  ↓ [getCreatorContext()]
FELLES KONTEKST
  ↓ brukes av:
    ✓ highlightDiscovery
    ✓ learningLoop
    ✓ sponsor-report
    ✗ ai-producer/route.ts  ← BRUKER IKKE getCreatorContext()
    ✗ stream-briefing       ← LESER TABELLER DIREKTE
    ✗ raid-targets          ← INGEN KONTEKST BRUKT
    ✗ community-intelligence ← ISOLERT FRA AI-LÆRING
    ✗ dashboard             ← HAR IKKE AI_AGENT_DECISIONS
```

---

## 2. RØDTRÅD-ANALYSE: HANDLING → RESULTAT

### Hva som allerede kobler

| System | Rådata | Læring | Felles kontekst | Feedback-loop |
|--------|--------|--------|-----------------|---------------|
| Learning Aggregator | ✓ les ai_agent_events | ✓ skriver til memory | – | – |
| Learning Loop | ✓ les highlights/vods | ✓ skriver til memory+insights | ✓ leser via upsertMemory | – |
| Sponsor Report | – | – | ✓ via getCreatorContext() | – |
| Highlight Discovery | – | – | ✓ via getCreatorContext() | – |
| AI Producer | ✗ ingen | ✗ ingen | ✗ BRUKER IKKE | ✗ ingen |
| Stream Briefing | ✗ raw reads | – | ✗ bypasser | ✗ ingen |
| Raid Manager | – | – | ✗ ingen | ✗ ingen |
| Community Intelligence | – | – | ✗ ingen | – |
| Dashboard | ✓ system_events | – | ✗ ingen | – |

### De fire brutte koblingene

**Brudd 1: Tips-utførelse forsvinner ut i intet**
- Bruker trykker "Utført" på AI Producer-anbefaling
- Logges til system_events (observabilitet)
- Sendes IKKE til ai_agent_events
- LearningAggregator ser aldri at anbefalingen ble fulgt
- Ingen feedback-loop

**Brudd 2: AI Producer bruker ikke kanalminnet**
- AI Producer kaller GPT med stream-kontekst og historikk
- Bruker IKKE getCreatorContext() → ingen vitser, viewers, game-kunnskap
- Anbefalingene er generiske, ikke personalisert til GLENVEX

**Brudd 3: Stream Briefing leser raw tabeller**
- Leser ai_agent_memory direkte (10 rader)
- Leser ai_agent_insights direkte (5 rader)
- Bypasser getCreatorContext() — betyr fragmentert context
- Inkonsistent med resten av systemet

**Brudd 4: Raid-anbefalinger lagres ikke**
- Raid Manager anbefaler mål
- Logges til system_events
- Lagres IKKE i ai_agent_memory
- Neste raid-anbefaling husker ikke hva som ble anbefalt sist

---

## 3. ALLE GAPS MED PRIORITET

| # | Fil | Gap | Data som burde brukes | Fix | Prioritet |
|---|-----|-----|----------------------|-----|-----------|
| G1 | `ai-producer/tips/route.ts` | Tips-utførelse sendes ikke til ai_agent_events | `logAgentEvent()` + `logAgentDecision()` | Legg til etter logSystemEvent | KRITISK |
| G2 | `ai-producer/route.ts` | Bruker ikke getCreatorContext() | ai_agent_memory via getCreatorContext | Kall getCreatorContext(), legg i prompt | KRITISK |
| G3 | `stream-briefing/route.ts` | Leser raw tabeller istedenfor getCreatorContext | ai_agent_memory (kondensert) | Legg til getCreatorContext() call | HØY |
| G4 | `raid-targets/route.ts` | Lagrer ikke anbefalinger i memory | ai_agent_memory | upsertMemory() etter anbefaling | HØY |
| G5 | `learningAggregator.ts` | Dropper kjøring ved < 3 events | Alle events, uavhengig av antall | Endre terskel til 1 | MEDIUM |
| G6 | `dashboard/live/route.ts` | Viser ikke ai_agent_decisions | ai_agent_decisions (utførte tiltak) | Legg til query + lærdom-seksjon | MEDIUM |
| G7 | `community-intelligence/route.ts` | Isolert fra AI-læring | ai_agent_memory (community-signaler) | Les community-minne som kontekst | LAV |
| G8 | `ai_agent_decisions.feedback_score` | Aldri satt | Outcome fra tips-utførelse | Sett feedback_score=1 (utført), 0 (avvist) | KRITISK |

---

## 4. IMPLEMENTERTE FORBEDRINGER

### G1 — Tips feedback-loop (tips/route.ts)
Nå logges utførte anbefalinger til `ai_agent_events` med `source: 'ai_producer'`
og til `ai_agent_decisions` med `feedback_score: 1` (utført) / `0` (avvist).
LearningAggregator vil nå se disse som events og kan lære av dem.

### G2 — AI Producer bruker kanalminne (ai-producer/route.ts)
Kaller nå `getCreatorContext()` og bruker `buildContextPrompt()` i GPT-prompten.
Anbefalingene er nå personalisert med kjente viewers, vitser og spillmønstre.

### G3 — Stream Briefing bruker getCreatorContext (stream-briefing/route.ts)
Legger til getCreatorContext() kall og inkluderer stream-historikk og utførte tips
i briefing-konteksten. Eksisterende direkte lesinger beholdt for Discord/Twitch events.

### G4 — Raid-anbefalinger lagres i memory (raid-targets/route.ts)
Etter AI-scoring lagres toppanbefaling i `ai_agent_memory` med key `raid_target_<login>`.
Neste kjøring kan sjekke om målet er kjent og justere scoring.

### G5 — LearningAggregator-terskel (learningAggregator.ts)
Endret fra `< 3` til `< 1`. Aggregering kjører nå selv ved lav aktivitet.

### G6 — Dashboard viser lærdom (dashboard/live/route.ts + page.tsx)
Nytt `lærdom`-felt i API-svaret med:
- Siste utførte tiltak
- Effect-indikasjoner (konfidensbasert)
- "GLENVEX vet nå"-seksjon på forsiden

---

## 5. EFFECT TRACKING — DATAMODELL

Effect tracking skjer via eksisterende tabeller (ingen ny tabell):

```
HANDLING:                 ai_agent_decisions
  agent_type:             'ai_producer'
  decision_type:          'recommendation_outcome'
  feedback_score:         1 (utført) | 0 (avvist)
  input_context.game:     spillet da anbefalingen ble gitt
  created_at:             tidspunkt

RESULTAT:                 stream_history
  started_at / ended_at:  finner nærmeste stream etter tiltaket
  peak_viewers:           sammenligner med snitt
  followers_gained:       direkte effektmål

CONFIDENCE-MODELL:
  lav:     < 3 datapunkter eller < 1 stream etter tiltaket
  medium:  3-9 datapunkter med målbar forskjell
  høy:     ≥ 10 datapunkter med konsistent mønster
```

---

## 6. CONFIDENCE-SYSTEM

Systemet skal aldri si "Dette fungerte" uten data.

Brukte labels:

| Label | Betingelse |
|-------|-----------|
| `for_lite_datagrunnlag` | < 3 datapunkter |
| `mulig_positiv_effekt` | Positiv trend, men usikker kausalitet |
| `mulig_negativ_effekt` | Negativ trend etter tiltak |
| `ingen_tydelig_effekt` | < 5% endring i målte verdier |
| `høy_confidence` | ≥ 10 datapunkter, konsistent mønster |

---

## 7. SYSTEMER SOM BRUKER FELLES LÆRING (etter implementering)

| System | getCreatorContext | ai_agent_events | ai_agent_decisions | Feedback-loop |
|--------|------------------|-----------------|---------------------|---------------|
| Learning Aggregator | – | ✓ leser | – | ✓ skriver |
| Learning Loop | ✓ skriver | – | ✓ skriver | – |
| Highlight Discovery | ✓ leser | – | – | – |
| AI Producer | ✓ leser (NY) | – | ✓ skriver (NY) | – |
| AI Producer Tips | – | ✓ skriver (NY) | ✓ skriver (NY) | ✓ (NY) |
| Stream Briefing | ✓ leser (NY) | ✓ leser | – | – |
| Raid Manager | – | – | ✓ skriver (NY) | ✓ memory (NY) |
| Sponsor Report | ✓ leser | – | – | – |
| Dashboard | – | – | ✓ leser (NY) | – |
| Community Intelligence | – | – | – | – (gap) |

---

## 8. GJENVÆRENDE GAPS (ikke implementert)

- **Community Intelligence** bruker ikke ai_agent_memory — laveste prioritet, siden community-data kommer direkte fra Discord
- **Sponsor Manager** bruker ikke Content Factory-resultater direkte — sponsor-report.ts er read-only
- **Community Manager** bruker ikke stream_history — gap, men lavt impact
- **ai_producer_community_memory** (legacy) skrives fortsatt — fjernes etter 2026-06-14 monitoring

---

## 9. AKSEPTANSEKRITERIER — STATUS

| Kriterium | Status |
|-----------|--------|
| Rapport over eksisterende effect tracking / rød tråd | ✓ Denne filen |
| Ingen duplikatmotor | ✓ Alt bygget på eksisterende tabeller |
| AI Producer-anbefalinger kobles til system_events | ✓ (var allerede på plass) |
| Utførte anbefalinger påvirker senere analyser | ✓ Via ai_agent_events + ai_agent_decisions |
| getCreatorContext() bruker mer felles læring | ✓ + stream_history, executed tips |
| Dashboard viser hva systemet lærer | ✓ Ny lærdom-widget |
| Gap der systemer ikke bruker felles læring er rapportert | ✓ Se seksjon 6 |
| Alle nye analyser skriver til system_events | ✓ |
| Datagrunnlag med lav kvalitet merkes tydelig | ✓ Confidence-labels |
| Ingen tall eller konklusjoner inventeres | ✓ |
