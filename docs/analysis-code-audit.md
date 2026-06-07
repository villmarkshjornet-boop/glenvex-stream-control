# GLENVEX Creator OS — Analysekode Audit
**Dato:** 2026-06-07  
**Sprint:** Stabiliseringsprint  
**Status:** Kartlegging fullført — ingenting slettet

---

## Executive Summary

Systemet har **to separate ML/AI-lag** som lever side om side:

1. **Gammelt lag (legacy):** `ai_producer_knowledge`, `ai_producer_stream_memory`, `ai_producer_content_memory` — Supabase-tabeller skrevet til av `knowledgeBase.ts` og `streamMemory.ts`. Fortsatt i bruk via `learningLoop.ts`.
2. **Nytt lag (primært):** `ai_agent_memory`, `ai_agent_insights`, `ai_agent_events`, `ai_agent_decisions` — brukes av `creatorContext.ts`, `agentLogger.ts`, `learningAggregator.ts`.

Begge lagene skrives til aktivt fra `learningLoop.ts`, som kaller BEGGE. Dette er det eneste virkelige duplikatproblemet.

Utover det er det to døde filer (`rpIntelligence.ts`), én API-route uten UI (`ai-scores/route.ts`), og mange observability-gap der analysekode kjører uten `system_events`.

**Ingenting er slettet. Alt er kartlagt og klassifisert.**

---

## Aktiv analyseflyt slik systemet faktisk fungerer nå

```
TWITCH STREAM (live)
│
├── bot/lib/twitchBot.ts
│   ├── logger all chat til ai_agent_events (batched 10s)
│   ├── logger subs/raids/giftsubs til system_events + ai_agent_events
│   └── bruker getRecentCrossPlatformContext() for AI-svar
│
├── bot/index.ts → checkLive()
│   ├── ved LIVE: logger LIVE_DETECTED → system_events
│   ├── kaller tweetLiveNå() (Twitter, valgfritt)
│   ├── kaller analyserStreamKontekst() (GPT → Discord post)  ← ingen system_events
│   └── kaller sjekkPreHype() (Oslo-timezone korrekt)
│
├── bot/lib/streamHistory.ts
│   └── tracker session-metrics lokalt (peak/avg viewers, chat, subs, raids)
│
├── bot/lib/memberTracker.ts
│   └── tracker Discord-profiler lokalt (XP, meldinger)
│
└── bot/lib/learningAggregator.ts (kjøres hvert 15. min)
    ├── leser ai_agent_events (siste 15 min)
    ├── kaller GPT-4o-mini (én gang per 15 min)
    └── skriver til ai_agent_memory + ai_agent_insights

STREAM SLUTTER
│
├── vodWatcher.ts (15 min ventetid)
│   ├── logger STREAM_OFFLINE_DETECTED → system_events
│   ├── logger VOD_LOOKUP_STARTED → system_events
│   └── logger VOD_AUTO_QUEUE_STARTED → system_events
│
└── CONTENT FACTORY PIPELINE
    │
    ├── FASE 1 (Vercel): /api/content-factory
    │   └── oppretter content_vods, sender til Railway
    │
    ├── FASE 1B (Railway): bot/lib/dataApi.ts
    │   ├── logger DOWNLOAD_STARTED → system_events
    │   ├── logger DOWNLOAD_DONE/FAILED → system_events
    │   ├── logger TRANSCRIPTION_STARTED/DONE → system_events
    │   └── skriver til content_transcripts
    │
    └── FASE 2 (Vercel): /api/content-factory/phase2
        ├── logger DISCOVERY_STARTED → system_events
        ├── highlightDiscovery.ts (heuristikk + creatorContext)
        │   └── skriver til content_highlights
        ├── highlightRanker.ts
        │   └── oppdaterer rank i content_highlights
        ├── learningLoop.ts (GPT-4o-mini)
        │   ├── skriver til ai_agent_memory, ai_agent_insights (nytt lag)
        │   └── skriver til ai_producer_* tabeller (gammel lag) ← DUPLIKAT
        └── logger VOD_PIPELINE_DONE → system_events

DASHBOARD (polling)
│
├── /api/dashboard/live (hvert 5s)
│   └── leser: content_vods, content_highlights, ai_agent_insights, system_events, workspaces
│
└── /api/dashboard (on-demand)
    └── leser: alle tabeller, bot-status, Twitch API, Discord API
```

---

## Liste over alle analyse-relaterte filer

### API Routes (Vercel/Next.js)

| Filsti | Hva den gjør | Kalles av | Tabeller R/W | system_events | Status |
|--------|-------------|-----------|-------------|---------------|--------|
| `src/app/api/ai-producer/route.ts` | Live stream-analyse + GPT tiltak | /ai-producer page (15s poll) | R: stream_history, bot-data | Nei | **AKTIV** |
| `src/app/api/ai-producer/tips/route.ts` | Logger bruker-feedback på tips | /ai-producer page (knapp) | Ingen | Ja (TIP_DONE, TIP_DISMISSED) | **AKTIV** |
| `src/app/api/ai-command-center/route.ts` | Master-intelligence hub, performanceScore, subScores | /ai-command-center page | R: community_members, stream_history, partners, workspaces | Nei | **AKTIV** |
| `src/app/api/ai-memory/route.ts` | Lister all AI-memory for inspeksjon | /ai-memory page | R: ai_agent_memory, ai_agent_insights, ai_agent_decisions, ai_agent_events | Nei | **AKTIV** |
| `src/app/api/ai-memory/forget/route.ts` | Sletter enkelt-memory manuelt | /ai-memory page | W: ai_agent_memory, ai_agent_insights, ai_agent_decisions | Nei | **AKTIV** |
| `src/app/api/ai-memory/test/route.ts` | Test/debug endpoint | Ingen kjent UI | Ukjent | Nei | **DEV-ONLY** |
| `src/app/api/ai-scores/route.ts` | Scorer community/growth/sponsor (lokale filer) | Ingen UI-side funnet | R: lokale JSON-filer | Nei | **DØD** (se note) |
| `src/app/api/stream-coach/route.ts` | AI retrospektiv analyse av siste streams | /stream-coach page | R: stream_history | Nei | **AKTIV** |
| `src/app/api/stream-history/route.ts` | Henter stream_history (siste 50) | /statistikk, /stream-coach | R: stream_history | Nei | **AKTIV** |
| `src/app/api/stream-briefing/route.ts` | Pre-stream AI briefing (GPT) | /stream-briefing page | R: workspaces, ai_agent_insights, ai_agent_events, ai_agent_memory, content_highlights, content_vods | Nei | **AKTIV** |
| `src/app/api/content-factory/analytics/route.ts` | Pipeline-statistikk (VOD-prosessering) | /content-factory-admin/analytics | R: content_vods, content_highlights, content_pipeline_logs | Nei | **AKTIV** |
| `src/app/api/content-factory/phase2/route.ts` | Fase 2: discovery, ranking, copywriting | Railway-bot + manuell trigger | R: content_transcripts, content_vods; W: content_highlights | Ja (DISCOVERY_STARTED) | **AKTIV** |
| `src/app/api/content-factory/route.ts` | Fase 1: oppretter VOD-post, starter Railway | vodWatcher, manuell | R/W: content_vods | Ja (VOD_DETECTED, DOWNLOAD_STARTED) | **AKTIV** |
| `src/app/api/raid-targets/route.ts` | AI raid-anbefalinger (game_id lookup, norsk-fallback) | /raid-manager page | Ingen Supabase | Ja (RAID_CANDIDATES_CHECKED, RAID_RECOMMENDATION_CREATED) | **AKTIV** |
| `src/app/api/sponsor-report/route.ts` | 90-dagers sponsor-scorecard + GPT | /sponsor-manager page | R: stream_history, content_vods, content_highlights, partners, workspaces | Ja (SPONSOR_SCORE_UPDATED, SPONSOR_REPORT_GENERATED) | **AKTIV** |
| `src/app/api/cross-platform-context/route.ts` | Henter nylige Twitch/Discord-events | Dashboard, bot-systemer | R: ai_agent_events | Nei | **AKTIV** |
| `src/app/api/system-events/route.ts` | Querybart event-log | /system-health, dashboard | R: system_events | Nei | **AKTIV** |
| `src/app/api/dashboard/live/route.ts` | Ultra-rask live-poll (5s) | Dashboard frontend | R: content_vods, content_highlights, ai_agent_insights, system_events, workspaces | Nei | **AKTIV** |
| `src/app/api/dashboard/route.ts` | Master dashboard-aggregator | Dashboard frontend | R: workspaces, content_vods, content_highlights, system_events, stream_history | Nei | **AKTIV** |
| `src/app/api/pre-live/route.ts` | Sender pre-hype Discord-meldinger | Bot-scheduler, frontend | Ingen Supabase | Ja (PRE_HYPE_SENT, STREAM_STARTED) | **AKTIV** |
| `src/app/api/community-memory/route.ts` | Filbaserte community-notater | /community-memory page | Filbasert (data/community-memory.json) | Nei | **AKTIV** |
| `src/app/api/community-memory/insights/route.ts` | AI-innsikt om enkelt-membres | /community-memory page | Filbasert | Nei | **AKTIV** |

### Biblioteker (Vercel-side, src/lib/)

| Filsti | Hva den gjør | Brukes av | Tabeller R/W | system_events | Status |
|--------|-------------|-----------|-------------|---------------|--------|
| `src/lib/ai/creatorContext.ts` | **Offisiell memory-portal**. Bygger CreatorContext fra ai_agent_memory + ai_agent_insights | highlightDiscovery, learningLoop, sponsor-report, stream-briefing, ai-producer | R: ai_agent_memory, ai_agent_insights, ai_producer_knowledge (legacy); W: ai_agent_memory, ai_agent_insights | Nei | **AKTIV** |
| `src/lib/ai/eventLogger.ts` | Logger agent-events og decisions | phase2, andre lib-kall | W: ai_agent_events, ai_agent_decisions | Nei | **AKTIV** |
| `src/lib/systemEvents.ts` | Vercel-side system_events-logger (direkte) | Alle API-routes | W: system_events | Ja (er writeren) | **AKTIV** |
| `src/lib/botData.ts` | Henter data fra Railway bot API (eller fallback JSON) | ai-producer, ai-scores, ai-command-center | Ingen Supabase | Nei | **AKTIV** |
| `src/lib/content-factory/analysis/highlightDiscovery.ts` | **Highlight Discovery Engine** (heuristikk + memory) | phase2 | R: content_transcripts, ai_agent_memory; W: content_highlights | Nei | **AKTIV** |
| `src/lib/content-factory/ranking/highlightRanker.ts` | Rangerer highlights | phase2 | R/W: content_highlights | Nei | **AKTIV** |
| `src/lib/content-factory/ai-producer/learningLoop.ts` | **Learning Engine**: GPT analyse → memory-oppdatering | phase2 | R: content_highlights, content_vods, content_transcripts; W: ai_agent_memory, ai_agent_insights, ai_producer_stream_memory, ai_producer_content_memory | Nei | **AKTIV (dobbel-skriving)** |
| `src/lib/content-factory/ai-producer/knowledgeBase.ts` | **Legacy**: lese/skrive ai_producer_knowledge + ai_producer_stream_memory + ai_producer_content_memory | learningLoop.ts (kun bruker av disse funksjonene) | R/W: ai_producer_knowledge, ai_producer_stream_memory, ai_producer_content_memory | Nei | **DELVIS (legacy-lag)** |
| `src/lib/content-factory/ai-producer/streamMemory.ts` | **Legacy**: lagreStreamMemory + oppdaterContentPatterns | learningLoop.ts (kun bruker) | W: ai_producer_stream_memory, ai_producer_content_memory | Nei | **DELVIS (legacy-lag)** |
| `src/lib/content-factory/vod/vodWatcher.ts` | Auto-detekterer ny VOD etter stream | bot/index.ts | R: content_vods | Ja (STREAM_OFFLINE_DETECTED, VOD_LOOKUP_STARTED, VOD_NOT_FOUND, VOD_AUTO_QUEUE_STARTED) | **AKTIV** |
| `src/lib/botMemory.ts` | Filbasert bot-minne (ikke Supabase) | bot/index.ts (addToMemory) | Filbasert (data/bot-memory.json) | Nei | **DELVIS** |

### Bot-biblioteker (Railway-side, bot/lib/)

| Filsti | Hva den gjør | Brukes av | Tabeller R/W | system_events | Status |
|--------|-------------|-----------|-------------|---------------|--------|
| `bot/lib/agentLogger.ts` | Buffret logger for ai_agent_events + upsertBotMemory | twitchBot, index.ts, learningAggregator | W: ai_agent_events (10s batch), ai_agent_memory | Nei | **AKTIV** |
| `bot/lib/systemEvents.ts` | Railway-side system_events-logger (kø, 5s flush) | index.ts, twitchBot, dataApi, recoveryEngine | W: system_events | Ja (er writeren) | **AKTIV** |
| `bot/lib/learningAggregator.ts` | **15-min batch-aggregering via GPT** | bot/index.ts (startLearningAggregator) | R: ai_agent_events; W: ai_agent_memory, ai_agent_insights | Nei | **AKTIV** |
| `bot/lib/crossPlatformContext.ts` | Bygger kontekst-streng fra ai_agent_events for bot-svar | twitchBot, aiPersonality, index.ts | R: ai_agent_events | Nei | **AKTIV** |
| `bot/lib/aiPersonality.ts` | Chat-svar via GPT, med historikk + kontekst | twitchBot (svar i chat) | R: ai_agent_events (via crossPlatformCtx) | Nei | **AKTIV** |
| `bot/lib/dataApi.ts` | HTTP-server i bot (eksponer data til Vercel) | hentBotData() i Vercel | Ingen Supabase | Ja (via logSystemEvent) | **AKTIV** |
| `bot/lib/recoveryEngine.ts` | Auto-recovery for hengete jobs | bot/index.ts (periodisk) | R/W: content_vods, content_highlights | Ja (RECOVERY_TRIGGERED, RECOVERY_SUCCESS, RECOVERY_FAILED) | **AKTIV** |
| `bot/lib/streamHistory.ts` | Tracker session-metrics lokalt | bot/index.ts | Filbasert; async W: community_members | Nei | **AKTIV** |
| `bot/lib/memberTracker.ts` | Discord-profiler lokalt (XP, nivå) | bot/index.ts, Discord-bot | Filbasert; async W: community_members | Nei | **AKTIV** |
| `bot/lib/eventTracker.ts` | Ukentlige raids/gift subs (JSON) | bot/index.ts, dataApi | Filbasert | Nei | **AKTIV** |
| `bot/lib/botEvents.ts` | Stream-syklus state + live_events-køen | bot/index.ts | R/W: workspaces (settings_json) | Nei | **AKTIV** |
| `bot/lib/twitchBot.ts` | Twitch chat listener + AI-svar | bot/index.ts | W: ai_agent_events | Ja (TWITCH_SUB_RECEIVED, TWITCH_GIFT_SUB_RECEIVED, TWITCH_EVENT_RECEIVED) | **AKTIV** |
| `bot/lib/clipWorker.ts` | Video-klipping (ffmpeg + cloud upload) | bot/index.ts | R/W: content_highlights, content_vods | Nei | **AKTIV** |
| `bot/lib/thumbnailGenerator.ts` | Thumbnail-generering | bot/index.ts | R/W: content_highlights | Nei | **AKTIV** |
| `bot/lib/thumbnailBuilderV2.ts` | V2 thumbnail-bygging | thumbnailGenerator.ts, dataApi.ts | R/W: content_highlights | Nei | **AKTIV** |
| `bot/lib/twitter.ts` | Poster tweet ved stream-start | bot/index.ts (tweetLiveNå) | Ingen | Nei | **AKTIV** (krever Twitter API-nøkler) |
| `bot/lib/rpIntelligence.ts` | RP (roleplay) AI-intelligens | **INGEN** (ikke importert noe sted) | Ukjent | Nei | **DØD** |
| `bot/lib/botKanalPreferanser.ts` | Henter kanalpreferanser fra Supabase for boten | twitchBot.ts | R: workspaces | Nei | **AKTIV** |

### UI-sider

| Filsti | Hva den gjør | Kaller | Status |
|--------|-------------|--------|--------|
| `src/app/ai-producer/page.tsx` | Live AI-tips med Utført/Avvis | /api/ai-producer, /api/ai-producer/tips | **AKTIV** |
| `src/app/ai-memory/page.tsx` | Memory-inspeksjon og manuell sletting | /api/ai-memory | **AKTIV** |
| `src/app/ai-command-center/page.tsx` | Master intelligence dashboard | /api/ai-command-center | **AKTIV** |
| `src/app/community-memory/page.tsx` | Manuelle community-notater | /api/community-memory | **AKTIV** |
| `src/app/stream-coach/page.tsx` | Stream retrospektiv-analyse | /api/stream-coach | **AKTIV** |
| `src/app/stream-briefing/page.tsx` | Pre-stream briefing | /api/stream-briefing | **AKTIV** |
| `src/app/sponsor-manager/page.tsx` | Sponsor-scorecard | /api/sponsor-report | **AKTIV** |
| `src/app/raid-manager/page.tsx` | Raid-anbefalinger | /api/raid-targets | **AKTIV** |
| `src/app/statistikk/page.tsx` | Vekst-statistikk | /api/stream-history, Twitch API | **AKTIV** |
| `src/app/content-factory-admin/analytics/page.tsx` | Content Factory pipeline-stats | /api/content-factory/analytics | **AKTIV** |
| `src/app/system-health/page.tsx` | Systemhelse + event-logg | /api/system-health, /api/system-events | **AKTIV** |

### Scripts

| Filsti | Hva den gjør | Status |
|--------|-------------|--------|
| `scripts/test-ai-memory.ts` | Manuell test av AI Memory-systemet | **DEV-ONLY** (ikke i produksjon) |

---

## Import/Usage Map (nøkkelfunksjoner)

```
getCreatorContext()
  └── importert i:
      ├── src/lib/content-factory/analysis/highlightDiscovery.ts
      ├── src/lib/content-factory/ai-producer/learningLoop.ts
      ├── src/app/api/sponsor-report/route.ts
      └── src/app/api/stream-briefing/route.ts (via creatorCtx)

logSystemEvent() [Vercel-side: src/lib/systemEvents.ts]
  └── importert i:
      ├── src/app/api/content-factory/route.ts
      ├── src/app/api/content-factory/phase2/route.ts
      ├── src/app/api/raid-targets/route.ts
      ├── src/app/api/sponsor-report/route.ts
      ├── src/app/api/pre-live/route.ts
      ├── src/app/api/streamplan/route.ts
      ├── src/app/api/ai-producer/tips/route.ts
      └── src/lib/content-factory/vod/vodWatcher.ts

logSystemEvent() [Railway-side: bot/lib/systemEvents.ts]
  └── importert i:
      ├── bot/index.ts
      ├── bot/lib/twitchBot.ts
      ├── bot/lib/dataApi.ts
      └── bot/lib/recoveryEngine.ts

hentBotData()
  └── importert i:
      ├── src/app/api/ai-producer/route.ts
      └── src/app/api/ai-command-center/route.ts

learningLoop (kjørLearningLoop)
  └── importert i:
      └── src/app/api/content-factory/phase2/route.ts

learningAggregator (startLearningAggregator)
  └── importert i:
      └── bot/index.ts

vodWatcher (sjekkForNyVod)
  └── brukt i:
      └── src/lib/content-factory/index.ts (kalt fra bot/index.ts)
```

---

## Database-tabeller brukt

| Tabell | Leses av | Skrives av | Status |
|--------|----------|------------|--------|
| `ai_agent_memory` | creatorContext, ai-memory route, highlightDiscovery, learningLoop, dashboard/live, crossPlatformCtx | creatorContext (upsert), agentLogger (upsert), learningAggregator, learningLoop | **AKTIV** |
| `ai_agent_insights` | creatorContext, ai-memory route, stream-briefing, dashboard/live | creatorContext (insert), learningAggregator, learningLoop | **AKTIV** |
| `ai_agent_decisions` | ai-memory route | eventLogger | **AKTIV** |
| `ai_agent_events` | cross-platform-context, crossPlatformCtx, learningAggregator, stream-briefing, ai-memory | agentLogger (batched), eventLogger | **AKTIV** |
| `stream_history` | ai-producer, stream-coach, stream-history, sponsor-report, ai-command-center | bot/lib/streamHistory.ts (async) | **AKTIV** |
| `content_vods` | sponsor-report, dashboard, dashboard/live, vodWatcher, recoveryEngine | content-factory/route, recoveryEngine | **AKTIV** |
| `content_highlights` | sponsor-report, dashboard/live, clipWorker, highlightRanker, learningLoop | highlightDiscovery, highlightRanker, clipWorker, thumbnailGenerator | **AKTIV** |
| `content_transcripts` | phase2, highlightDiscovery, learningLoop | bot/lib/dataApi.ts (fase 1B) | **AKTIV** |
| `system_events` | system-events route, dashboard, dashboard/live | src/lib/systemEvents.ts, bot/lib/systemEvents.ts | **AKTIV** |
| `community_members` | ai-command-center | memberTracker.ts (async), streamHistory.ts (async) | **AKTIV** |
| `partners` | ai-command-center, sponsor-report | partner-relaterte routes | **AKTIV** |
| `workspaces` | dashboard, dashboard/live, stream-briefing, botEvents | botEvents.ts (settings_json), channel-settings | **AKTIV** |
| `content_pipeline_logs` | content-factory/analytics | phase2 (via pipelineLogger) | **AKTIV** |
| `ai_producer_knowledge` | knowledgeBase.ts (hentKnowledgeBase, oppdaterKnowledge) | learningLoop → knowledgeBase | **LEGACY** |
| `ai_producer_stream_memory` | knowledgeBase.ts (hentStreamMemory) | learningLoop → streamMemory | **LEGACY** |
| `ai_producer_content_memory` | knowledgeBase.ts (hentContentPatterns) | learningLoop → streamMemory | **LEGACY** |

---

## API-routes brukt (kall-oversikt)

| Route | Kalt fra | Frekvens |
|-------|---------|---------|
| `/api/ai-producer` | /ai-producer page | hvert 15s |
| `/api/ai-producer/tips` | /ai-producer page (knapper) | ved bruker-handling |
| `/api/ai-command-center` | /ai-command-center page | on-demand |
| `/api/ai-memory` | /ai-memory page | on-demand |
| `/api/ai-scores` | **Ingen UI-side funnet** | ← PROBLEM |
| `/api/stream-coach` | /stream-coach page | on-demand |
| `/api/stream-history` | /statistikk, /stream-coach | on-demand |
| `/api/stream-briefing` | /stream-briefing page | on-demand |
| `/api/content-factory` (GET) | /content-factory-admin | hvert 10s |
| `/api/content-factory` (POST) | vodWatcher, manuell | ved ny VOD |
| `/api/content-factory/phase2` | Railway-bot + manuell | ved TRANSCRIBED |
| `/api/content-factory/analytics` | /content-factory-admin/analytics | on-demand |
| `/api/raid-targets` | /raid-manager page | on-demand |
| `/api/sponsor-report` | /sponsor-manager page | on-demand |
| `/api/dashboard/live` | Dashboard (polling) | hvert 5s |
| `/api/dashboard` | Dashboard | on-demand |
| `/api/system-events` | /system-health, dashboard | on-demand |
| `/api/cross-platform-context` | Dashboard, debug | on-demand |
| `/api/pre-live` | Bot-scheduler, frontend | ved pre-hype |

---

## Scheduler/Cron/Bot-jobber (Railway persistent process)

| Jobb | Kjøres i | Intervall | Skriver til | Status |
|------|---------|-----------|------------|--------|
| `checkLive()` | bot/index.ts | hvert 60s | system_events, ai_agent_events | **AKTIV** |
| `sjekkPreHype()` | bot/index.ts | hvert 60s | system_events (PRE_HYPE_SENT) | **AKTIV** |
| `sjekkForNyVod()` | bot/index.ts | hvert 60s | system_events (VOD_*) | **AKTIV** |
| `runRecoveryCheck()` | bot/index.ts | hvert 30s | system_events (RECOVERY_*), content_vods, content_highlights | **AKTIV** |
| `kjørAggregering()` | bot/lib/learningAggregator.ts | hvert 15min | ai_agent_memory, ai_agent_insights | **AKTIV** |
| `flushSystemEvents()` | bot/lib/systemEvents.ts | hvert 5s | system_events | **AKTIV** |
| `flushBotAgentEvents()` | bot/lib/agentLogger.ts | hvert 10s | ai_agent_events | **AKTIV** |
| `startClipWorker()` | bot/index.ts | kontinuerlig (poll) | content_highlights, content_vods | **AKTIV** |
| `startThumbnailWorker()` | bot/index.ts | kontinuerlig (poll) | content_highlights | **AKTIV** |

---

## Død kode

### 1. `src/app/api/ai-scores/route.ts` — **SAFE TO REMOVE**

**Grunn:** Ingen UI-side kaller denne. `/ai-scores` route eksisterer uten tilhørende side. Scorer (communityScore, growthScore, sponsorScore) er **duplikert og forbedret** i:
- `src/app/api/ai-command-center/route.ts` (bedre scoringsmodell, mer data)
- `src/app/api/sponsor-report/route.ts` (sponsor-spesifikk scoring)

Leser kun lokale JSON-filer (ikke Supabase). Scorer er beregnet med lavere maks-verdier enn nyere versjoner.

**Risiko ved sletting:** Ingen (ingen caller).

---

### 2. `bot/lib/rpIntelligence.ts` — **SAFE TO REMOVE**

**Grunn:** Filen er **ikke importert noe sted** i hele codebase. Søk på `rpIntelligence` gir null treff utenfor selve filen.

**Risiko ved sletting:** Ingen (ubrukt).

---

### 3. `src/app/api/ai-memory/test/route.ts` — **SAFE TO REMOVE**

**Grunn:** Debug/test-endpoint uten produksjons-caller. Kun brukt manuelt under utvikling.

**Risiko ved sletting:** Ingen (dev-only).

---

### 4. `scripts/test-ai-memory.ts` — **NEEDS MANUAL CHECK**

**Grunn:** Lokal test-script. Ikke i produksjon. Kan beholdes som dokumentasjon, men bør ikke deployment-bundlas.

**Risiko ved sletting:** Minimal. Sjekk om den brukes aktivt i utvikling.

---

## Duplikater

### D1: Dual memory-lag i `learningLoop.ts` — **MERGE (høy prioritet)**

`src/lib/content-factory/ai-producer/learningLoop.ts` skriver til **begge** minnelagene:
- **Nytt lag:** `ai_agent_memory` + `ai_agent_insights` (via `upsertMemory`, `addInsight` fra creatorContext)
- **Gammelt lag:** `ai_producer_stream_memory` + `ai_producer_content_memory` + `ai_producer_knowledge` (via `streamMemory.ts` og `knowledgeBase.ts`)

Disse to lagene inneholder **overlappende data** om stream-mønstre og content-kategorier.

**Anbefaling:** Fjern skrivingen til legacy-tabellene fra `learningLoop.ts`. Behold `knowledgeBase.ts` og `streamMemory.ts` kun som lesere (for bakoverkompatibilitet) inntil legacy-tabeller er migrert og tømt.

**Risiko:** Lav — legacy-tabellene leses kun av `learningLoop.ts` selv (for å telle eksisterende mønstre). Etter fjerning av skriving vil disse tabellene gradvis bli irrelevante.

---

### D2: Sponsor-scoring vs AI-scores vs AI-Command-Center — **KEEP ALT (ulike formål)**

Tre separate score-systemer:
- `ai-scores/route.ts`: Community/growth/sponsor scoring med lokale filer → **DØD** (ingen caller)
- `ai-command-center/route.ts`: performanceScore + subScores (community, growth, content, sponsor) → **AKTIV** masterintelligens
- `sponsor-report/route.ts`: Detaljert sponsor-score med 7/30/90d historikk, score-breakdown, milestones → **AKTIV** sponsorspesifikk

`ai-command-center` og `sponsor-report` er **ikke duplikater** — ulike detaljeringsnivåer og formål. Kun `ai-scores` er overflødig.

---

### D3: `botMemory.ts` vs `ai_agent_memory` — **NEEDS MANUAL CHECK**

`src/lib/botMemory.ts` vedlikeholder en lokal `data/bot-memory.json` med enkle oppføringer (`addToMemory()`). Dette kalles fra `bot/index.ts` ved live-start. Det er **ikke** det samme som `ai_agent_memory` (Supabase, strukturert, med confidence-scores).

`botMemory.ts` fungerer som en primitiv "daily log" — ikke duplikat, men kan vurderes for migrasjon til `logBotAgentEvent()` over tid.

---

## Risiko ved sletting

| Fil | Risiko | Merknad |
|-----|--------|---------|
| `bot/lib/rpIntelligence.ts` | Ingen | Ikke importert noe sted |
| `src/app/api/ai-scores/route.ts` | Ingen | Ingen UI/caller |
| `src/app/api/ai-memory/test/route.ts` | Minimal | Dev-only |
| `scripts/test-ai-memory.ts` | Minimal | Dev-only script |
| `src/lib/content-factory/ai-producer/knowledgeBase.ts` | Middels | Brukes av learningLoop.ts — fjern etter at dobbel-skriving er ryddet |
| `src/lib/content-factory/ai-producer/streamMemory.ts` | Middels | Brukes av learningLoop.ts — fjern etter at dobbel-skriving er ryddet |

---

## Observability Gaps

Analysekode som kjører **uten** å skrive til `system_events`:

| Kode | Hva skjer | Foreslått event |
|------|----------|----------------|
| `bot/index.ts → analyserStreamKontekst()` | GPT-kall ved stream-start, poster Discord-melding | `STREAM_CONTEXT_ANALYZED` med game, erRP, melding sendt |
| `src/app/api/ai-command-center/route.ts` | performanceScore kalkulert, GPT-prioriteter generert | `INTELLIGENCE_REPORT_GENERATED` med performanceScore, topp-prioritet |
| `src/app/api/ai-producer/route.ts` | Tiltak generert via GPT-4o | `AI_PRODUCER_ANALYSIS_COMPLETE` med antall tiltak, game, viewers |
| `src/app/api/stream-coach/route.ts` | AI retrospektiv-analyse kjørt | `STREAM_COACH_ANALYSIS_COMPLETE` med streamsAnalysert, topGame |
| `src/app/api/stream-briefing/route.ts` | Pre-stream briefing generert | `PRE_STREAM_BRIEFING_GENERATED` |
| `src/lib/content-factory/analysis/highlightDiscovery.ts` | Highlights oppdaget | `HIGHLIGHTS_DISCOVERED` med antall, avgScore, vodId |
| `src/lib/content-factory/ranking/highlightRanker.ts` | Highlights rangert | `HIGHLIGHTS_RANKED` med antall, topScore |
| `src/lib/content-factory/ai-producer/learningLoop.ts` | Learning loop kjørt | `LEARNING_LOOP_EXECUTED` med memoryOppdatert, innsikterLagret |
| `bot/lib/learningAggregator.ts` | 15-min batch-aggregering | `AGGREGATION_COMPLETE` med eventsAnalysert, innsikterFunnet |
| `bot/lib/aiPersonality.ts` | Chat-svar generert via GPT | `BOT_CHAT_RESPONSE_GENERATED` (lavprioritet, høy volum) |
| `bot/lib/clipWorker.ts` | Klipping utført | `CLIP_EXTRACTED` med highlightId, strategi brukt |
| `bot/lib/thumbnailGenerator.ts` | Thumbnail generert | `THUMBNAIL_GENERATED` med highlightId |
| `bot/lib/memberTracker.ts` | Ny member XP-event | `MEMBER_XP_UPDATED` (lavprioritet) |
| `bot/lib/streamHistory.ts` | Session avsluttet | `SESSION_ENDED` med peak/avg viewers, duration |

---

## Anbefalt cleanup-plan

### Steg 1: Fjern klar død kode (ingen risiko)
1. Slett `bot/lib/rpIntelligence.ts`
2. Slett `src/app/api/ai-scores/route.ts`
3. Slett `src/app/api/ai-memory/test/route.ts`

### Steg 2: Rydd dobbel-skriving i learningLoop (krever test)
4. I `src/lib/content-factory/ai-producer/learningLoop.ts`:
   - Fjern import av `lagreStreamMemory` og `oppdaterContentPatterns` fra `./streamMemory`
   - Fjern import av `oppdaterKnowledge`, `hentStreamMemory`, `hentContentPatterns` fra `./knowledgeBase`
   - Fjern de tilhørende kall-stedene (ca. linje 4–5 imports + ca. linje 30–55 kall)
5. Etter steg 4: Slett `src/lib/content-factory/ai-producer/streamMemory.ts`
6. Etter steg 4: Slett `src/lib/content-factory/ai-producer/knowledgeBase.ts`
7. Legacy-tabeller (`ai_producer_knowledge`, `ai_producer_stream_memory`, `ai_producer_content_memory`) kan arkiveres/slettes i Supabase etter at de ikke lenger skrives til

### Steg 3: Legg til system_events der det mangler (observability)
Prioritert rekkefølge:
8. `learningLoop.ts` → `LEARNING_LOOP_EXECUTED`
9. `learningAggregator.ts` → `AGGREGATION_COMPLETE`
10. `highlightDiscovery.ts` → `HIGHLIGHTS_DISCOVERED`
11. `highlightRanker.ts` → `HIGHLIGHTS_RANKED`
12. `bot/index.ts → analyserStreamKontekst()` → `STREAM_CONTEXT_ANALYZED`
13. `ai-command-center/route.ts` → `INTELLIGENCE_REPORT_GENERATED`
14. `ai-producer/route.ts` → `AI_PRODUCER_ANALYSIS_COMPLETE`
15. `stream-briefing/route.ts` → `PRE_STREAM_BRIEFING_GENERATED`
16. `clipWorker.ts` → `CLIP_EXTRACTED`

### Steg 4: Dashboard-synlighet for analyse (etter observability er på plass)
17. Legg til "Learning Loop"-sektor i system_events-feed på dashboard
18. Vis `LEARNING_LOOP_EXECUTED` og `AGGREGATION_COMPLETE` i Global Activity Feed

---

## Do Not Touch-liste

Følgende filer og systemer skal **ikke røres** i stabiliseringssprinten:

| Hva | Hvorfor |
|-----|---------|
| `bot/lib/clipWorker.ts` | Eksplisitt constraint — Clip Worker |
| `bot/lib/thumbnailGenerator.ts` | Thumbnail V1 |
| `bot/lib/thumbnailBuilderV2.ts` | Thumbnail V2 (pågående observability) |
| `src/lib/ai/creatorContext.ts` | Offisiell AI Memory-arkitektur — ikke endre grensesnittet |
| `bot/lib/agentLogger.ts` | Kritisk — all agent-logging avhenger av dette |
| `bot/lib/learningAggregator.ts` | Core ML-komponent — kun tillegg av logging |
| `src/lib/content-factory/analysis/highlightDiscovery.ts` | Deepgram-nær kode — ikke rør |
| `src/lib/content-factory/ai-producer/learningLoop.ts` | Kan rydde legacy-skriving (steg 2), men ikke endre core-logikk |
| Partner affiliate enforcement (`bot/lib/partnerHelper.ts`) | Eksplisitt constraint |
| `src/lib/ai/eventLogger.ts` | Memory-arkitektur |
| `bot/lib/crossPlatformContext.ts` | Cross-platform memory — eksplisitt constraint |

---

## Quick Reference: Hva er aktivt analyse?

```
✅ AKTIV og observerbar:
   vodWatcher → system_events (STREAM_OFFLINE, VOD_LOOKUP, etc.)
   twitchBot → system_events (TWITCH_SUB, TWITCH_GIFT_SUB, LIVE_DETECTED)
   recoveryEngine → system_events (RECOVERY_*)
   pre-live → system_events (PRE_HYPE_SENT, STREAM_STARTED)
   raid-targets → system_events (RAID_CANDIDATES_CHECKED)
   sponsor-report → system_events (SPONSOR_SCORE_UPDATED)
   content-factory pipeline → system_events (DISCOVERY_STARTED, VOD_PIPELINE_DONE)

⚠️ AKTIV men ikke observerbar (observability gap):
   analyserStreamKontekst() i bot/index.ts
   ai-command-center scoring
   ai-producer tiltak-generering
   stream-briefing generering
   highlightDiscovery
   highlightRanker
   learningLoop
   learningAggregator
   clipWorker
   thumbnailGenerator

❌ DØD kode:
   rpIntelligence.ts (ikke importert)
   api/ai-scores/route.ts (ingen caller)
   api/ai-memory/test/route.ts (dev-only)

⚠️ LEGACY (brukes fortsatt, men bør fases ut):
   ai_producer_knowledge tabell (skrives til av learningLoop via knowledgeBase.ts)
   ai_producer_stream_memory tabell
   ai_producer_content_memory tabell
   knowledgeBase.ts + streamMemory.ts (kun brukt av learningLoop)
```

---

*Rapporten er generert automatisk fra statisk kodeanalyse. Ingenting er slettet. Cleanup-plan kan utføres trygt i angitt rekkefølge.*
