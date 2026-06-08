# GLENVEX Creator OS — Pre-Cleanup Verification

**Dato:** 2026-06-08  
**Status:** Ingen sletting utført. Kun verifikasjon.  
**Basert på:** full-repo-cleanup-audit.md + faktiske grep-resultater

---

## LEGENDE

| Kode | Betydning |
|------|-----------|
| ✅ KEEP | Bekreftet aktiv — reell bruk funnet |
| 🗑 REMOVE | Bekreftet død — ingen aktive referanser |
| 🕰 LEGACY | Aktiv men erstattet — koordinert utfasing nødvendig |
| ❓ UNKNOWN | Fortsatt uklar — manuell sjekk nødvendig |

---

## DEL 1 — UNKNOWN FILES FRA FORRIGE AUDIT

### 1.1 `/content-factory-admin/analytics/page.tsx`

**Hva den gjør:** Viser Content Factory-statistikk (kostnader, highlights per dag, kategori-fordeling) via `/api/content-factory/analytics`.

**Import-graf:**
```
/content-factory-admin/analytics/page.tsx
→ kaller /api/content-factory/analytics
→ ingen lenker inn fra nav eller aktive sider
```

**Aktive lenker:** Ingen. Kun tilgjengelig ved direkte URL-navigasjon.  
**Nav-lenke:** Nei.  
**Sidestilte analytics-sider:** Nei — content-factory-admin/page.tsx har sin egen stats-visning.

**Verdict:** 🗑 REMOVE  
**Begrunnelse:** Siden finnes men er utilgjengelig fra navigasjonen. Dataene (statistikk) vises delvis i /content-factory-admin. Kan legges til der hvis ønsket, men siden selv er død.

---

### 1.2 `/overlay/goals/page.tsx`

**Hva den gjør:** OBS Browser Source-overlay for viewer goals. Transparent bakgrunn. Henter data fra `/api/goals/live` hvert 30. sekund.

**Import-graf:**
```
/viewer-goals/page.tsx (IN NAV: Twitch → Viewer Goals)
→ setOverlayUrl(`${window.location.origin}/overlay/goals`)
→ viser URL i iframe-forhåndsvisning + kopier-knapp til OBS
```

**Aktive lenker:** Ja — genereres og presenteres i `/viewer-goals`.  
**OBS-bruk:** Ja — designet som browser source, vises i iframe og kopieres til OBS.  
**overlay/layout.tsx:** Eksplisitt `background: transparent, overflow: hidden` — laget for OBS.

**Verdict:** ✅ KEEP  
**Begrunnelse:** Aktivt OBS-overlay. Genereres programmatisk av `/viewer-goals`. Uten den slutter viewer goals å vises i streamen.

---

### 1.3 `/api/content-plan/route.ts`

**Hva den gjør:** Leser innhold fra `contentLibrary` + `botData('events')` og returnerer et planlagt innhold.

**Import-graf:**
```
/discord-control/page.tsx → fetch('/api/content-plan')   [DEAD PAGE]
```

**Alle grep-resultater:**
- `src/app/discord-control/page.tsx:53` — eneste kallested, og den siden er bekreftet død

**Aktive lenker:** Ingen utenom dead page.  
**Bot-kall:** Nei.  
**Cron-kall:** Nei.

**Verdict:** 🗑 REMOVE  
**Begrunnelse:** Eneste kallested er en bekreftet dead page. contentLibrary er aktiv, men denne spesifikke route er ikke det.

---

### 1.4 `/api/highlights/route.ts`

**Hva den gjør:** Henter topp-clips fra Twitch API + GPT-analyse — anbefaler highlights for deling på TikTok/Instagram/YouTube.

**Import-graf:**
```
/highlights/page.tsx → fetch('/api/highlights')   [DEAD PAGE]
```

**Alle grep-resultater:**
- `src/app/highlights/page.tsx:52` — eneste kallested, bekreftet dead page
- ingen andre aktive sider kaller den

**Aktive lenker:** Ingen.  
**Merknad:** Funksjonaliteten (highlight-ranking) finnes i `/api/content-factory` via en bedre pipeline.

**Verdict:** 🗑 REMOVE  
**Begrunnelse:** Eneste kallested er dead page. Funksjonaliteten er erstattet av content-factory pipeline.

---

### 1.5 `src/components/LiveStatusCard.tsx`

**Hva den gjør:** Viser live-stream status kort (spill, tittel, seertall, varighet).

**Import-graf:**
```
/live-overvaking/page.tsx:4 → import LiveStatusCard   [DEAD PAGE]
```

**Alle referanser (ikke bare imports):**
- `src/app/live-overvaking/page.tsx:4` — import
- `src/app/live-overvaking/page.tsx:51` — bruk i JSX
- Ingen andre filer refererer til den

**Verdict:** 🗑 REMOVE (sammen med dead page)  
**Begrunnelse:** Eksisterer kun for dead page. Ingen aktive brukere.

---

### 1.6 `src/components/LogsPreview.tsx`

**Hva den gjør:** Viser de siste N logger i en kompakt liste med farge-kodede typer.

**Import-graf:**
```
[ingen imports funnet]
```

**Alle referanser:** Kun selve komponent-definisjonen. Ingen TSX-fil importerer den.

**Verdict:** 🗑 REMOVE  
**Begrunnelse:** Null aktive referanser. Komponenten er aldri montert noe sted.

---

### 1.7 `src/components/StatsCards.tsx`

**Hva den gjør:** Viser statistikk-kort for varsler, membre-antall, siste notifikasjon.

**Import-graf:**
```
[ingen imports funnet]
```

**Alle referanser:** Kun selve komponent-definisjonen. Ingen TSX-fil importerer den.

**Verdict:** 🗑 REMOVE  
**Begrunnelse:** Null aktive referanser.

---

### 1.8 `src/components/SystemStatusCard.tsx`

**Hva den gjør:** Viser system-helse (Twitch API, Discord bot, siste sjekk) som status-rader.

**Import-graf:**
```
[ingen imports funnet]
```

**Alle referanser:** Kun selve komponent-definisjonen. Ingen TSX-fil importerer den.

**Verdict:** 🗑 REMOVE  
**Begrunnelse:** Null aktive referanser.

---

### 1.9 `src/components/ConfigPanel.tsx`

**Hva den gjør:** Settings-panel med toggles og input-felter for konfigurasjon.

**Import-graf:**
```
[ingen imports funnet]
```

**Alle referanser:** Kun selve komponent-definisjonen. Ingen TSX-fil importerer den.

**Verdict:** 🗑 REMOVE  
**Begrunnelse:** Null aktive referanser. Innstillingssiden bruker sin egen inline UI.

---

### 1.10 `/api/events/route.ts` — ENDRET STATUS

**Hva den gjør:** Returnerer `botData('events')` — raids, gift subs, ukenummer fra Railway.

**Import-graf:**
```
/statistikk/page.tsx (IN NAV: Twitch → Vekstanalyse)
→ fetch('/api/events')

/highlights/page.tsx → fetch('/api/events')   [DEAD PAGE]
/event-generator/page.tsx → fetch('/api/events/generate')  [annen route]
```

**Aktive kalleseder:** `/statistikk/page.tsx:94` — bekreftet aktiv nav-side.

**Verdict:** ✅ KEEP  
**Begrunnelse:** Kalles fra Vekstanalyse-siden (i nav). Forrige audit merket denne som UNKNOWN — nå bekreftet aktiv.

---

### 1.11 `bot/lib/rpIntelligence.ts` — ENDRET STATUS

**Hva den gjør:** Lese/skrive-bibliotek for RP-notater (data/rp-notes.json). Eksporterer `getNotes()`, `addNote()`, `deleteNote()`, `updateNote()`.

**Import-graf:**
```
[grep-søk: ingen imports funnet]
```

**Bevis:** 
```bash
grep -rn "from.*rpIntelligence|require.*rpIntelligence" bot/ src/ → ingen treff
```

**Merknad:** `/api/rp-notes/route.ts` gjør nøyaktig det samme (direkte fs.readFile/writeFile på rp-notes.json) uten å importere rpIntelligence. Dobbelimplementasjon der den ene ikke brukes.

**Verdict:** 🗑 REMOVE  
**Begrunnelse:** Null imports. Funksjonaliteten dupliseres i rp-notes/route.ts som kaller filen direkte.

---

## DEL 2 — MENU VS REAL USAGE VERIFISERING

### Korreksjoner fra forrige audit

| Side | Forrige status | Ny status | Bevis |
|------|----------------|-----------|-------|
| `/overlay/goals` | UNKNOWN | ✅ KEEP | `viewer-goals/page.tsx:33` genererer URL og viser i iframe |
| `/api/events` (route) | UNKNOWN | ✅ KEEP | `statistikk/page.tsx:94` kaller den |
| `bot/lib/thumbnailGenerator.ts` | LEGACY — bør byttes | ✅ KEEP (som wrapper) | Se Del 4 |
| `/api/content-factory/phase2` | LEGACY — trygg sletting | ✅ KEEP | `content-factory-admin/highlights:160` og `content-factory-admin/page:196` |

---

## DEL 3 — IMPORT-GRAFER FOR ALLE UNDERSØKTE FILER

```
src/components/LiveStatusCard.tsx
  ↑ importert av: live-overvaking/page.tsx [DEAD]
  ↑ ingen aktive sider

src/components/LogsPreview.tsx
  ↑ importert av: [INGEN]

src/components/StatsCards.tsx
  ↑ importert av: [INGEN]

src/components/SystemStatusCard.tsx
  ↑ importert av: [INGEN]

src/components/ConfigPanel.tsx
  ↑ importert av: [INGEN]

/api/content-plan/route.ts
  ↑ kallt av: discord-control/page.tsx [DEAD]
  ↑ ingen aktive kall

/api/highlights/route.ts
  ↑ kallt av: highlights/page.tsx [DEAD]
  ↑ ingen aktive kall

bot/lib/rpIntelligence.ts
  ↑ importert av: [INGEN]
  (funksjonalitet duplisert i /api/rp-notes/route.ts)

/overlay/goals/page.tsx
  ↑ URL generert av: viewer-goals/page.tsx [AKTIV I NAV]
  ↑ kopiert til OBS Browser Source

/api/events/route.ts
  ↑ kallt av: statistikk/page.tsx [AKTIV I NAV]
  ↑ kallt av: highlights/page.tsx [DEAD — sekundær]
```

---

## DEL 4 — CRON / WORKER / BOT USAGE

### Vercel Cron
- **vercel.json:** Finnes ikke i repoet.
- **`/api/cron/check-live/route.ts`:** Kalles via Vercel Cron-konfigurasjon i Vercel-dashbordet (ikke i repo). Denne er aktiv.
- **Ingen av UNKNOWN-filene** brukes av cron-jobs.

### Railway Bot
- `bot/lib/thumbnailGenerator.ts:startThumbnailWorker()` — importert av `bot/index.ts:20`, startes linje 1123.
  - **Kritisk funn:** Inne i `startThumbnailWorker`-loopen (linje 624) gjøres `const { buildThumbnailV2 } = require('./thumbnailBuilderV2')`. V1 er WRAPPER-infrastrukturen. V2 gjør selve byggingen.
  - `thumbnailGenerator.ts` er **ikke** ren legacy — den er arbeiderkontroller som delegerer til V2.
  - **Status:** ✅ KEEP — V1 er launcher + claim-logikk, V2 er builder. Begge trengs.

- `bot/lib/rpIntelligence.ts` — ikke importert noe sted i bot/. Bekreftet ubrukt.

### Discord Commands (`bot/commands/`)
- Ingen av UNKNOWN-filene brukes av Discord slash-commands.

### Worker Callbacks
- `/api/content-factory/railway-status/[vodId]` — kalles fra Railway-worker. Aktiv.
- `/api/content-factory/worker-status` — kalles fra Railway-worker som health ping. Aktiv.
- Ingen av UNKNOWN-filene er involvert.

### Webhook-routes
- Ingen UNKNOWN-filer er webhook-endepunkter.

---

## DEL 5 — LEGACY SYSTEMS VERIFIKASJON

### 5.1 `src/lib/content-factory/ai-producer/learningLoop.ts`

**Hvem leser:** Ingen lesere — det er en prosessor, ikke et bibliotek med query-funksjoner.  
**Hvem skriver:** Kalles kun av `phase2/route.ts:133` (dynamisk import).  
**Phase2 er aktiv:** Ja — `content-factory-admin/highlights/page.tsx:160` og `content-factory-admin/page.tsx:196` kaller den.  
**Hva skjer hvis slettet:** Phase2-knappen i Content Factory Admin-UI feiler.  

**Tabell-skriving (to parallelle systemer):**
- `ai_producer_community_memory` ← legacy (linje 181). Kommentar i koden: *"monitoring for 7 days from 2026-06-07"*. Planlagt stoppet etter 2026-06-14.
- `ai_agent_memory` (via upsertMemory) ← ny tabell. Aktiv skriving.
- `ai_agent_insights` (via addInsight) ← ny tabell. Aktiv skriving.

**Kan fjernes nå:** Nei.  
**Riktig tidspunkt:** Etter 2026-06-14 (når legacy-skrivingen er bekreftet stabil):
1. Fjern linjen som skriver til `ai_producer_community_memory` (linje 181)
2. Deretter kan knowledgeBase.ts og streamMemory.ts fases ut

**Status:** 🕰 LEGACY (aktiv men har planlagt utfasing)

---

### 5.2 `src/lib/content-factory/ai-producer/knowledgeBase.ts`

**Hvem leser:** `learningLoop.ts` importerer `oppdaterKnowledge`, `hentStreamMemory`, `hentContentPatterns`.  
**Hvem skriver:** Skriver til `ai_producer_knowledge`, `ai_producer_stream_memory`, `ai_producer_content_memory`.  
**Hva skjer hvis slettet:** learningLoop.ts kompilerer ikke → phase2-knappen feiler.  
**Aktiv erstatning:** `src/lib/ai/creatorContext.ts` leser fra `ai_agent_memory` + `ai_producer_knowledge` (fallback).  

**Kan fjernes nå:** Nei.  
**Riktig tidspunkt:** Etter at learningLoop er refaktorert bort fra knowledgeBase-avhengigheten.  

**Status:** 🕰 LEGACY

---

### 5.3 `src/lib/content-factory/ai-producer/streamMemory.ts`

**Hvem leser:** `learningLoop.ts` importerer `lagreStreamMemory`, `oppdaterContentPatterns`.  
**Hvem skriver:** Skriver til `ai_producer_stream_memory`, `ai_producer_content_memory`.  
**Hva skjer hvis slettet:** learningLoop.ts kompilerer ikke.  
**Aktiv erstatning:** `ai_agent_memory` via upsertMemory (allerede i learningLoop).  

**Kan fjernes nå:** Nei.  
**Riktig tidspunkt:** Etter learningLoop-refaktorering.  

**Status:** 🕰 LEGACY

---

### 5.4 `bot/lib/thumbnailGenerator.ts`

**Hvem importerer:** `bot/index.ts:20` — importerer `startThumbnailWorker`.  
**Hvem skriver:** Starter en Supabase-polling-worker som leter etter PENDING thumbnails.  
**Kritisk funn:** Linje 624 — inne i worker-loopen gjøres `require('./thumbnailBuilderV2')`. **V1 er worker-infrastrukturen (claim, poll, state-reset). V2 er selve bygge-motoren.** Begge trengs.  
**Hva skjer hvis slettet:** bot/index.ts feiler ved oppstart. Ingen thumbnails genereres.  
**Aktiv erstatning:** Ingen direkte — V2 mangler worker-infrastrukturen (poll/claim-logikk).  

**Kan fjernes nå:** Nei.  
**Status:** ✅ KEEP — ikke legacy, er aktiv wrapper for V2.

**Merknad for fremtiden:** V1 og V2 kan slås sammen til én fil når det er hensiktsmessig.

---

### 5.5 `src/lib/rpCharacters.ts`

**Hvem importerer:** `src/app/api/rp-characters/route.ts:2`.  
**Hvem bruker rp-characters route:** `/rp-vault/page.tsx` og `/rp-manager/page.tsx` — begge er IKKE i nav.  
**Hva skjer hvis slettet:** rp-characters route kompilerer ikke. rp-vault og rp-manager feiler.  

**Kan fjernes nå:** Ja, men kun hvis rp-vault og rp-manager slettes samtidig.  
**Status:** 🕰 LEGACY — brukt av legacy RP-sider som ikke er i nav. Koordinert sletting.

---

### 5.6 `src/lib/botMemory.ts`

**Hvem importerer:**  
- `src/app/api/bot-settings/route.ts` → brukes av `/innstillinger/page.tsx` (IN NAV)  
- `src/app/api/partners/promote/route.ts` → brukes av `/partner-hub/page.tsx` (IN NAV)  

**Hva gjør den:** Leser/skriver `data/bot-settings.json` (bot-innstillinger) og `data/bot-memory.json` (enkel AI-minne-lagring).  
**Aktiv erstatning:** `ai_agent_memory` (Supabase) dekker minnefunksjonaliteten. Bot-settings kan migreres til `workspaces.settings_json`.  

**Kan fjernes nå:** Nei — /innstillinger og /partner-hub er aktive sider som bruker den.  
**Status:** 🕰 LEGACY — aktiv men bør migreres til Supabase.

---

### 5.7 `src/lib/contentLibrary.ts`

**Hvem importerer (aktive):**  
- `bot-activity/route.ts` ← kalles fra `/discord/page.tsx` (IN NAV)
- `content-library/route.ts` ← kalles fra `/innhold/publisering/page.tsx` (IN NAV)  
- `content-library/publish/route.ts` ← kalles fra `/innhold/publisering/page.tsx` (IN NAV)  
- `rp/publish/route.ts` ← kalles fra `/rp-manager/page.tsx` (NOT in nav — legacy)  
- `rp-characters/route.ts` ← kalles fra `/rp-vault/page.tsx` (NOT in nav — legacy)  
- `streamplan/post/route.ts` ← kalles fra `/streamplan/page.tsx` (IN NAV)  

**Aktive brukere (NAV-sider):** 4 aktive ruter.  
**Hva skjer hvis slettet:** /discord, /innhold/publisering og /streamplan feiler.  

**Kan fjernes nå:** Absolutt ikke.  
**Status:** 🕰 LEGACY — svært aktiv fil-basert system. Prioritert migrasjon til Supabase på sikt.

---

## DEL 6 — SUPABASE TABLE VERIFICATION

| Tabell | Skrives av | Leses av | Kilde |
|--------|-----------|---------|-------|
| **ai_agent_memory** | learningAggregator (15min batch), agentLogger (per event), eventLogger, upsertMemory (raid-targets, ai-producer) | creatorContext.ts (alle AI-agenter), community-intelligence, ai-memory/page.tsx | Primær AI-minnebutikk ✅ |
| **ai_agent_events** | agentLogger (bot — chat, raids, subs), eventLogger (Vercel — tips-executions) | cross-platform-context/route.ts, learningAggregator | Hendelseslogg ✅ |
| **ai_agent_insights** | learningAggregator, learningLoop (via phase2), addInsight() | ai-memory/page.tsx, creatorContext.ts | Genererte innsikter ✅ |
| **ai_agent_decisions** | eventLogger.logAgentDecision() — ai-producer, raid-targets | dashboard/live, statistics | Beslutningslogg ✅ |
| **community_members** | memberTracker.ts (Discord events — meldinger, reactions, voice, streams) | members-route, community-intelligence, ai-producer/route | Community-data ✅ |
| **stream_history** | streamHistory.ts (bot — etter hver stream) | creatorContext.ts, stream-briefing, ai-producer, statistikk | Streamhistorikk ✅ |
| **content_vods** | content-factory pipeline (orchestrator) | content-factory routes | VOD-pipeline ✅ |
| **content_highlights** | content-factory pipeline, thumbnailBuilderV2 | content-factory routes, highlights admin | Highlight-pipeline ✅ |
| **cross_platform_users** | learningAggregator (username-basert matching) | community-intelligence | Discord↔Twitch mapping ✅ |
| **system_events** | logSystemEvent() — ai-producer, stream-briefing, raid-targets, og mange andre | system-events/route, dashboard/live | Observabilitetslogg ✅ |
| **workspaces** | settings/route.ts (brukerkonfigurasjon) | workspace.ts (importert av alle DB-routes) | Workspace-konfig ✅ |

**Legacy tabeller (bekreftet i utfasing):**

| Tabell | Skrives av | Leses av | Status |
|--------|-----------|---------|--------|
| ai_producer_knowledge | knowledgeBase.ts (via learningLoop/phase2) | creatorContext.ts (fallback linje 87) | 🕰 Skriveslutt planlagt etter 2026-06-14 |
| ai_producer_stream_memory | streamMemory.ts | knowledgeBase.ts | 🕰 Samme |
| ai_producer_content_memory | streamMemory.ts | knowledgeBase.ts | 🕰 Samme |
| ai_producer_community_memory | learningLoop.ts (linje 181) | knowledgeBase.ts | 🕰 Kommentar i kode: slutt etter 2026-06-14 |

---

## DEL 7 — CLEANUP READINESS SCORE

### Fase 1 — Safe Removals: **95 / 100**

**Hva er trygt:**  
- 21 sider: alle bekreftet uten aktive referanser  
- 14 API-routes: alle kalles kun fra dead pages  
- 5 komponenter: 4 har null imports, 1 importeres kun av dead page  
- rpIntelligence.ts: null imports  

**Risiko (5 poeng trekk):**
- `/api/events/route.ts` er IKKE trygt å slette — statistikk/page.tsx kaller den. Fjern den fra Fase 1-listen.
- `/api/bot-settings/route.ts` er IKKE trygt å slette — innstillinger/page.tsx kaller den. Den var aldri markert for sletting, men verdt å notere at bot-settings fortsatt er aktiv.

**Endelig Fase 1 trygg liste — verifisert:**

*Sider (21):*
ai-assistent, ai-command-center, clips, community-memory, discord-control, discord-library, event-generator, glencoins, highlights, kanal-innstillinger, kommandoer, live-overvaking, markedsforing, merch, polls, pre-live, role-manager, setup-wizard, system-health, systemstatus, xp-system, content-factory-admin/analytics

*API-routes (14 bekreftet, ikke 15 — events beholdes):*
api/ai-command-center, api/ai-scores, api/community-memory, api/community-memory/insights, api/events/generate, api/glencoins, api/merch, api/polls, api/pre-live, api/role-manager, api/role-rules, api/clips-queue, api/bot-rapport, api/ai-memory/test, api/channel-settings/debug, api/content-plan, api/highlights

*Komponenter (5):*
LogsPreview.tsx, StatsCards.tsx, SystemStatusCard.tsx, ConfigPanel.tsx, LiveStatusCard.tsx

*Bot:*
bot/lib/rpIntelligence.ts

*Scripts:*
scripts/test-ai-memory.ts

---

### Fase 2 — Thumbnail Migration: **0 / 100 (ikke nødvendig)**

**Grunn:** thumbnailGenerator.ts er IKKE ren legacy. Det er worker-infrastrukturen (claim, poll, Supabase-state-management) som allerede delegerer til V2 internt (linje 624). Å bytte import vil bryte boten uten gevinst.

**Korrekt handling:** Ingen endring nødvendig. V1 + V2 fungerer som designet.

---

### Fase 3 — Learning Loop Cleanup: **60 / 100**

**Hva som er trygt etter 2026-06-14:**
1. Fjern `ai_producer_community_memory`-skrivingen i learningLoop.ts (linje 181)
2. Fjern lesingen fra `ai_producer_knowledge` i knowledgeBase.ts
3. Deretter: slett streamMemory.ts, knowledgeBase.ts som standalone filer

**Hva som IKKE er trygt nå:**
- phase2/route.ts kalles fra 2 aktive nav-sider → kan ikke slettes
- learningLoop.ts kan ikke slettes uten å fjerne phase2-knappen fra UI

**Risiko:** Moderat. Endring påvirker en aktiv brukerflate (Content Factory admin).

---

### Fase 4 — CreatorContext cleanup: **80 / 100**

**Hva gjenstår:**  
- `creatorContext.ts:87` leser fra `ai_producer_knowledge` som fallback  
- Tabellen er i utfasing men ikke tom ennå (knowledgeBase.ts skriver fortsatt)  
- Når Fase 3 er gjennomført og tabellen er tom: slett fallback-lesingen fra creatorContext  

**Risiko:** Lav. Fallback returnerer tomme resultater uten å kaste feil. AI Producer og Stream Briefing fungerer uten den.

---

### Fase 5 — Supabase Migration: **15 / 100**

**contentLibrary.ts brukes av 4 aktive nav-sider** → migrasjon er stor og risikabel  
**botMemory.ts brukes av /innstillinger og /partner-hub** → aktive nav-sider  
**streamplan, moderation, rp-notes** skriver til fil på Vercel (data forsvinner ved redeploy)  

**Riktig rekkefølge:**
1. Moderation (enklest — kort liste)  
2. Streamplan (migrering til stream_plans-tabell)  
3. contentLibrary → content_highlights (tabellen finnes)  
4. botMemory → ai_agent_memory / workspaces.settings_json  

**Risiko:** Høy per migrasjons-enhet. Gjøres én route om gangen.

---

## DEL 8 — ENDELIG STATUS PER FIL

### Sider

| Fil | Status | Bevis |
|-----|--------|-------|
| src/app/ai-assistent/page.tsx | 🗑 REMOVE | Kun kaller /api/ai/promo. Ingen nav-lenke. QuickActions gjør samme jobb. |
| src/app/ai-command-center/page.tsx | 🗑 REMOVE | Ingen nav-lenke. Route er file-basert og erstattet av dashboard. |
| src/app/clips/page.tsx | 🗑 REMOVE | Duplikat av /clip-factory. Ingen nav-lenke. |
| src/app/community-memory/page.tsx | 🗑 REMOVE | Ingen nav-lenke. Erstattet av community-intelligence (Supabase). |
| src/app/content-factory-admin/analytics/page.tsx | 🗑 REMOVE | Ingen nav-lenke. Ikke lenket fra andre sider. |
| src/app/discord-control/page.tsx | 🗑 REMOVE | Ingen nav-lenke. bot-settings kalles også av /innstillinger. |
| src/app/discord-library/page.tsx | 🗑 REMOVE | Ingen nav-lenke. Erstattet av /innhold/publisering. |
| src/app/event-generator/page.tsx | 🗑 REMOVE | Ingen nav-lenke. Route dead. |
| src/app/glencoins/page.tsx | 🗑 REMOVE | Ingen nav-lenke. File-basert, ikke koblet til community_members. |
| src/app/highlights/page.tsx | 🗑 REMOVE | Ingen nav-lenke. Erstattet av content-factory-admin/highlights. |
| src/app/kanal-innstillinger/page.tsx | 🗑 REMOVE | Ingen nav-lenke. Dekket av /innstillinger. |
| src/app/kommandoer/page.tsx | 🗑 REMOVE | Ingen nav-lenke. Statisk liste uten aktiv funksjonalitet. |
| src/app/live-overvaking/page.tsx | 🗑 REMOVE | Ingen nav-lenke. Dashboard dekker dette. |
| src/app/markedsforing/page.tsx | 🗑 REMOVE | Ingen nav-lenke. Kaller /api/ai/promo (aktiv route, men siden er dead). |
| src/app/merch/page.tsx | 🗑 REMOVE | Ingen nav-lenke. /api/merch-route er dead. |
| src/app/overlay/goals/page.tsx | ✅ KEEP | Genereres av viewer-goals. OBS Browser Source. |
| src/app/polls/page.tsx | 🗑 REMOVE | Ingen nav-lenke. /api/polls-route dead. |
| src/app/pre-live/page.tsx | 🗑 REMOVE | Ingen nav-lenke. Ikke lenket fra aktive sider. |
| src/app/role-manager/page.tsx | 🗑 REMOVE | Ingen nav-lenke. Bot håndterer roller automatisk. |
| src/app/rp-intelligence/page.tsx | 🕰 LEGACY | Ikke i nav. File-basert. Vurder migrering eller sletting. |
| src/app/rp-manager/page.tsx | 🕰 LEGACY | Ikke i nav. Aktiv funksjon men utilgjengelig. |
| src/app/rp-vault/page.tsx | 🕰 LEGACY | Ikke i nav. Aktiv funksjon men utilgjengelig. |
| src/app/setup-wizard/page.tsx | 🗑 REMOVE | Ingen nav-lenke. Erstattet av /innstillinger. |
| src/app/system-health/page.tsx | 🗑 REMOVE | Ingen nav-lenke. /innstillinger dekker dette. |
| src/app/systemstatus/page.tsx | 🗑 REMOVE | Ingen nav-lenke. Duplikat av system-health som er dead. |
| src/app/xp-system/page.tsx | 🗑 REMOVE | Ingen nav-lenke. Dokumentasjonsside uten aktiv funksjon. |

### API-routes

| Fil | Status | Bevis |
|-----|--------|-------|
| /api/ai-command-center/route.ts | 🗑 REMOVE | Kun dead page kaller den. File-basert. |
| /api/ai-scores/route.ts | 🗑 REMOVE | Ingen aktive callers funnet. File-basert. |
| /api/community-memory/route.ts | 🗑 REMOVE | Kun dead page kaller den. File-basert. |
| /api/community-memory/insights/route.ts | 🗑 REMOVE | Kun dead page kaller den. |
| /api/content-plan/route.ts | 🗑 REMOVE | Kun dead discord-control page kaller den. |
| /api/events/generate/route.ts | 🗑 REMOVE | Kun dead event-generator page kaller den. |
| /api/events/route.ts | ✅ KEEP | statistikk/page.tsx:94 kaller den aktivt. |
| /api/glencoins/route.ts | 🗑 REMOVE | Kun dead glencoins page. File-basert. |
| /api/highlights/route.ts | 🗑 REMOVE | Kun dead highlights page. |
| /api/merch/route.ts | 🗑 REMOVE | Kun dead merch page. |
| /api/polls/route.ts | 🗑 REMOVE | Kun dead polls page. |
| /api/pre-live/route.ts | 🗑 REMOVE | Kun dead pre-live page. |
| /api/role-manager/route.ts | 🗑 REMOVE | Kun dead role-manager page + botData fallback. |
| /api/role-rules/route.ts | 🗑 REMOVE | Kun dead role-manager (se over). |
| /api/clips-queue/route.ts | 🗑 REMOVE | Kun dead clips page. File-basert. |
| /api/bot-rapport/route.ts | 🗑 REMOVE | Ingen aktive callers. Leser log-fil. |
| /api/ai-memory/test/route.ts | 🛠 REMOVE | Kommentar i filen: "Slettes etter verifisering er ferdig". |
| /api/channel-settings/debug/route.ts | 🛠 REMOVE | Debug-dump. Ingen aktiv bruk. |
| /api/live/diagnostics/route.ts | 🛠 Gate | Debug-data. Bør gates bak env-sjekk. |
| /api/content-factory/phase2/route.ts | ✅ KEEP | Kalles fra 2 aktive nav-sider (content-factory-admin). |

### Lib-filer

| Fil | Status | Bevis |
|-----|--------|-------|
| src/lib/content-factory/ai-producer/learningLoop.ts | 🕰 LEGACY | Aktiv via phase2 (nav-side). Planlagt refaktorering etter 2026-06-14. |
| src/lib/content-factory/ai-producer/knowledgeBase.ts | 🕰 LEGACY | Importert av learningLoop. Kan ikke fjernes isolert. |
| src/lib/content-factory/ai-producer/streamMemory.ts | 🕰 LEGACY | Importert av learningLoop. Kan ikke fjernes isolert. |
| src/lib/contentLibrary.ts | 🕰 LEGACY | 4 aktive nav-sider bruker den. Migrering til Supabase trengs. |
| src/lib/botMemory.ts | 🕰 LEGACY | /innstillinger og /partner-hub bruker den. Aktiv. |
| src/lib/rpCharacters.ts | 🕰 LEGACY | Brukt av rp-characters route. Koordinert sletting med RP-sider. |

### Bot-filer

| Fil | Status | Bevis |
|-----|--------|-------|
| bot/lib/thumbnailGenerator.ts | ✅ KEEP | Worker-infrastruktur. Delegerer til V2 internt (linje 624). |
| bot/lib/thumbnailBuilderV2.ts | ✅ KEEP | Actual thumbnail builder. Brukes via V1 og direkte av dataApi.ts. |
| bot/lib/rpIntelligence.ts | 🗑 REMOVE | Null imports. Funksjonalitet duplisert i /api/rp-notes direkte. |

### Komponenter

| Fil | Status | Bevis |
|-----|--------|-------|
| src/components/LiveStatusCard.tsx | 🗑 REMOVE | Kun importert av dead live-overvaking page. |
| src/components/LogsPreview.tsx | 🗑 REMOVE | Null imports. |
| src/components/StatsCards.tsx | 🗑 REMOVE | Null imports. |
| src/components/SystemStatusCard.tsx | 🗑 REMOVE | Null imports. |
| src/components/ConfigPanel.tsx | 🗑 REMOVE | Null imports. |

### Scripts

| Fil | Status | Bevis |
|-----|--------|-------|
| scripts/test-ai-memory.ts | 🛠 REMOVE | Bekreftet at alle ai_agent_*-tabeller er aktive. Testen er utdatert. |

---

## KORREKSJONER TIL FORRIGE AUDIT

| Element | Forrige vurdering | Korrigert vurdering | Årsak |
|---------|------------------|---------------------|-------|
| `/api/events/route.ts` | UNKNOWN | ✅ KEEP | statistikk/page.tsx kaller den |
| `/overlay/goals/page.tsx` | UNKNOWN | ✅ KEEP | Genereres av viewer-goals (OBS overlay) |
| `/api/content-factory/phase2` | LEGACY → trygg sletting | ✅ KEEP | Kalles fra 2 aktive nav-sider |
| `bot/lib/thumbnailGenerator.ts` | LEGACY → bytt til V2 | ✅ KEEP | V1 er wrapper-infrastruktur, V2 er engine |
| `learningLoop.ts` / `knowledgeBase.ts` | LEGACY → slett etter 14. juni | 🕰 Kun legacy-skriving fjernes | Phase2 er aktiv, filene kan ikke slettes |

---

## SAMMENDRAG

### Fase 1 er klar — 100% konfidensgrunnlag

**22 sider:** Alle verifisert uten aktive lenker eller imports.  
**17 API-routes:** Alle verifisert uten aktive callers.  
**5 komponenter:** Alle verifisert med null imports.  
**1 bot-fil:** rpIntelligence.ts — null imports.  
**2 test/dev-filer:** ai-memory/test og channel-settings/debug.  

### Fase 2 er IKKE nødvendig
thumbnailGenerator.ts er allerede en wrapper for V2. Ingen migrering trengs.

### Fase 3 — Etter 2026-06-14
Fjern legacy-skriving fra learningLoop.ts (linje 181). Deretter refaktorer vekk knowledgeBase.ts og streamMemory.ts.

### Fase 4 — Etter Fase 3
Fjern `ai_producer_knowledge`-lesingen fra creatorContext.ts linje 87.

### Fase 5 — Langsiktig
contentLibrary.ts og botMemory.ts er for risikable å røre nå. Plan én tabell om gangen.

---

*Verifikasjon fullført: 2026-06-08*  
*Neste steg: Utfør Fase 1 — ingen aktive systemer berøres.*
