# GLENVEX — Source of Truth Audit

**Dato:** 2026-06-08  
**Formål:** Definere dataeierskap per domene — hvem eier, hvem skriver, hvem leser.  
**Regler:** Ingen kodeendringer. Kun dokumentasjon.

---

## Lesesveiledning

For hvert domene besvares syv spørsmål:

| # | Spørsmål |
|---|----------|
| 1 | Hva er source of truth? |
| 2 | Hvilken tabell eier dataene? |
| 3 | Hvilken route eier dataene? |
| 4 | Hvilken side eier visningen? |
| 5 | Hvilke legacy-systemer leser samme data? |
| 6 | Hvilke systemer skriver til samme data? |
| 7 | Finnes duplikater? |

**Skrivetilgang:**  
- `PRIMÆR SKRIVER` — autorisert til å skrive, eier dataene  
- `LESER` — henter data, ingen skriveautorisasjon  
- `SEKUNDÆR SKRIVER` — skriver til samme tabell, men eier ikke domenet

---

## 1. Community (Memberbase)

**Source of truth:** Supabase-tabellen `community_members`

| Spørsmål | Svar |
|----------|------|
| **Tabell** | `community_members` (primær), `cross_platform_users` (koblingsdata) |
| **Route (eier)** | `GET /api/members` — liste over alle membres |
| **Route (detalj)** | `GET /api/members/[id]` — enkeltmedlem med AI-analyse |
| **Route (handlinger)** | `POST /api/members/[id]/action` — skriveoperasjoner |
| **Side** | `/community-manager` — primær UI for søk, profil, handlinger |
| **Legacy-lesere** | Ingen — `hentBotData()` er fallback i `/api/stream-history`, ikke her |
| **Skrivere** | Se under |

**Hvem skriver til `community_members`:**

| System | Type | Hva |
|--------|------|-----|
| `bot/lib/memberTracker.ts` | PRIMÆR SKRIVER | XP, meldinger, reactions, voice-minutter (Discord-events) |
| `POST /api/members/[id]/action` | SEKUNDÆR SKRIVER | badges (`Community Hero`), autorisert manuell skriving |
| `bot/lib/twitchBot.ts` | SEKUNDÆR SKRIVER | subs, gift_subs, raids (Twitch-events) |

**Hvem leser `community_members`:**

| System | Formål |
|--------|--------|
| `GET /api/members` | Liste til community-manager |
| `GET /api/members/[id]` | Profil + AI-analyse |
| `GET /api/community-intelligence` | Segmentering og helse-analyse |
| `GET /api/ai-producer` | Topp-membres + at-risk til GPT-prompt |
| `GET /api/ai-command-center` | *(LEGACY — route til sletting)* |

**Duplikater:** Nei. `/api/community-intelligence` og `/api/members` leser begge `community_members`, men med ulike formål — segmentering vs. profilvisning. Ingen overlappende skriving.

---

## 2. AI Memory

**Source of truth:** Supabase-tabellene `ai_agent_memory`, `ai_agent_events`, `ai_agent_decisions`, `ai_agent_insights`

| Spørsmål | Svar |
|----------|------|
| **Tabell** | `ai_agent_memory` (primær), `ai_agent_events`, `ai_agent_decisions`, `ai_agent_insights` |
| **Route (eier)** | `GET /api/ai-memory` — leser alle fire tabeller |
| **Route (slett)** | `DELETE /api/ai-memory/forget` — sletter enkelt minne |
| **Side** | `/ai-memory` — minne-browser |
| **Legacy-lesere** | `src/lib/ai/creatorContext.ts` linje 87 — fallback til `ai_producer_knowledge` (legacy, fjernes etter 2026-06-14) |

**Hvem skriver til `ai_agent_memory`:**

| System | Type | Hva |
|--------|------|-----|
| `bot/lib/agentLogger.ts` | PRIMÆR SKRIVER | Alle Discord/Twitch-events → minne (upsert) |
| `bot/lib/learningAggregator.ts` | PRIMÆR SKRIVER | Batch-læring fra events |
| `POST /api/members/[id]/action` | SEKUNDÆR SKRIVER | `follow_up`-minne (manuell oppfølgingsliste) |
| `GET /api/raid-targets` | SEKUNDÆR SKRIVER | `stream_pattern`-minne for raid-historikk |

**Hvem skriver til `ai_agent_events`:**

| System | Type | Hva |
|--------|------|-----|
| `src/lib/ai/eventLogger.ts` | PRIMÆR SKRIVER | Vercel-side hendelser |
| `bot/lib/agentLogger.ts` | PRIMÆR SKRIVER | Railway-side hendelser |

**Hvem skriver til `ai_agent_decisions`:**

| System | Type | Hva |
|--------|------|-----|
| `src/lib/ai/eventLogger.ts` → `logAgentDecision()` | PRIMÆR SKRIVER | AI-beslutningsspor (Vercel) |
| Kalt fra: ai-producer, raid-targets, ai-producer/tips | — | — |

**Hvem skriver til `ai_agent_insights`:**

| System | Type | Hva |
|--------|------|-----|
| Railway `learningAggregator.ts` | PRIMÆR SKRIVER | Innsikter fra stream-analyse |

**Hvem leser `ai_agent_memory`:**

| System | Formål |
|--------|--------|
| `GET /api/ai-memory` | Primær UI-visning |
| `GET /api/community-intelligence` | Signaler, jokes, membres til CI-dashboard |
| `GET /api/members/[id]` | Kontekst per membre |
| `GET /api/stream-briefing` | Topp-minner til stream-briefing-prompt |
| `bot/lib/aiPersonality.ts` | Viewer-minner og topics til Discord-bot-personlighet |
| `bot/lib/crossPlatformContext.ts` | Kryss-plattform kontekst |
| `bot/lib/thumbnailGenerator.ts` | AI-nøkkelord til thumbnail-metadata |

**Duplikater:** Ingen skriveduplisering. `logSystemEvent()` og `logAgentEvent()` er separate tabeller med ulike formål (`system_events` vs. `ai_agent_events`) — ingen overlap.

---

## 3. AI Producer

**Source of truth:** `stream_history` + `community_members` som input. GPT-4o som prosessor.

| Spørsmål | Svar |
|----------|------|
| **Tabell** | Leser `stream_history`, `community_members`. Skriver til `ai_agent_decisions` via `logAgentDecision()`. |
| **Route (eier)** | `GET /api/ai-producer` — hovedanalyse med stream-data + community-sammendrag |
| **Route (tips)** | `GET /api/ai-producer/tips` — actionable produksjonstips |
| **Side** | `/ai-producer` |
| **Legacy-skrivere** | `src/lib/content-factory/ai-producer/learningLoop.ts` skriver til BÅDE `ai_agent_memory` (ny) og `ai_producer_community_memory` (legacy) — fjernes etter 2026-06-14 |
| **Legacy-lesere** | `src/lib/ai/creatorContext.ts:87` leser `ai_producer_knowledge` som fallback |

**Legacy AI Producer-tabeller (sunset):**

| Tabell | Status | Planlagt fjerning |
|--------|--------|-------------------|
| `ai_producer_knowledge` | Leses som fallback i `creatorContext.ts:87` | Etter Fase 3 (post 2026-06-14) |
| `ai_producer_stream_memory` | Leses av `streamMemory.ts` | Etter Fase 3 |
| `ai_producer_content_memory` | Leses av `knowledgeBase.ts` | Etter Fase 3 |
| `ai_producer_community_memory` | Skrives av `learningLoop.ts:181` | Slutt å skrive etter 2026-06-14 |

**Duplikater:** `ai_producer_*`-tabellene er duplikater av `ai_agent_memory`. Migrering pågår.

---

## 4. Streamplan

**Source of truth:** `workspaces.settings_json` (JSONB-felt)

| Spørsmål | Svar |
|----------|------|
| **Tabell** | `workspaces` (feltet `settings_json`) |
| **Route (eier)** | `GET/POST /api/streamplan` — les og lagre ukeplan |
| **Route (post)** | `POST /api/streamplan/post` — poster til Discord |
| **Side** | `/streamplan` |
| **Legacy-lesere** | Ingen |
| **Skrivere** | Kun `/api/streamplan` (POST) |
| **Andre som leser workspaces** | Se §12 (Settings) |

**Duplikater:** Nei. Strømplanen deler `workspaces`-tabellen med andre domenner, men bruker egne nøkler i `settings_json`. Ingen konflikter.

---

## 5. Pre-Hype / Pre-Live

**Source of truth:** Ingen persistent data — stateless operasjon

| Spørsmål | Svar |
|----------|------|
| **Tabell** | Ingen. Leser Discord-kanalconfig fra `workspaces.settings_json` via `discordChannel.ts` |
| **Route (eier)** | `POST /api/pre-live` — sender Discord-melding (30min / 15min / live) |
| **Side** | `/pre-live` |
| **Legacy-lesere** | Ingen |
| **Skrivere** | Ingen Supabase-skriving. Logger til `system_events` via `logSystemEvent()` |
| **Duplikater** | Railway-boten sender automatisk live-notification ved stream-deteksjon. `/api/pre-live` er manuelt-trigget supplement. Begge poster til Discord, men til ulike kanaler (pre-hype vs. live-kanal). |

**NB:** Pre-hype og automatisk live-varsling er **ikke duplikater** — de bruker ulike kanaler og triggermekanismer.

---

## 6. Content Factory

**Source of truth:** Supabase-tabellene for VOD-pipeline

| Spørsmål | Svar |
|----------|------|
| **Tabeller** | `content_vods`, `content_highlights`, `content_transcripts`, `content_pipeline_logs`, `content_review_queue`, `content_assets` |
| **Route (eier)** | `GET/POST /api/content-factory` — pipeline-kontroll |
| **Route (jobs)** | `GET /api/content-factory/jobs` |
| **Route (analyse)** | `POST /api/content-factory/phase2` — highlight-discovery + copy (**AKTIV** — kalles fra nav) |
| **Route (thumbnail)** | `POST /api/content-factory/thumbnails/generate` og `/generate-v2` |
| **Side** | `/content-factory-admin` (primær), `/content-factory-admin/highlights`, `/content-factory-admin/qa` |
| **Legacy-lesere** | Ingen |

**Hvem skriver til content-tabellene:**

| System | Type | Hva |
|--------|------|-----|
| `GET /api/content-factory` | PRIMÆR SKRIVER | VOD-registrering, status-oppdatering |
| `POST /api/content-factory/phase2` | PRIMÆR SKRIVER | Highlights, copy, pipeline-logger |
| `bot/lib/clipWorker.ts` | PRIMÆR SKRIVER | Clip-status, clip-metadata |
| `bot/lib/thumbnailBuilderV2.ts` | PRIMÆR SKRIVER | Thumbnail-assets og metadata |
| `bot/lib/recoveryEngine.ts` | SEKUNDÆR SKRIVER | Resetter feilede jobs |

**Infrastruktur (ikke legacy):**

| Fil | Rolle |
|-----|-------|
| `bot/lib/thumbnailGenerator.ts` | Worker-infrastruktur (poll/claim/state-reset). BEHOLDER. Kaller V2 internt (linje 624). |
| `bot/lib/thumbnailBuilderV2.ts` | Thumbnail-motor. Primær builder. |

**Duplikater:** Thumbnail-route finnes i to versjoner (`/thumbnails/generate` og `/thumbnails/generate-v2`). Begge er aktive — V1 er worker-infrastruktur, V2 er motor. **Ikke duplikater.**

---

## 7. Community Manager

**Source of truth:** `community_members` + `ai_agent_memory` (kontekst)

| Spørsmål | Svar |
|----------|------|
| **Tabeller** | `community_members` (primær), `ai_agent_memory` (kontekst + follow-up) |
| **Route (liste)** | `GET /api/members` |
| **Route (profil)** | `GET /api/members/[id]` |
| **Route (handlinger)** | `POST /api/members/[id]/action` |
| **Side** | `/community-manager` |
| **Legacy-lesere** | Ingen |

**Skrivetilgang per action:**

| Action | Tabell | Type |
|--------|--------|------|
| `follow_up_add` | `ai_agent_memory` (type: `follow_up`) | Vercel-side manuell skriving |
| `follow_up_remove` | `ai_agent_memory` | Vercel-side manuell sletting |
| `hero_badge_add` | `community_members.badges` | Vercel-side manuell skriving |
| `hero_badge_remove` | `community_members.badges` | Vercel-side manuell skriving |

**Discord-actions (gi_vip, fjern_vip, discord_roller):** Disabled — krever Discord bot-integrasjon som ikke er implementert.

**Duplikater:** Community Manager og Community Intelligence leser begge `community_members`. **Ikke duplikater** — formålene er ulike (handlinger vs. analyse).

---

## 8. Community Intelligence

**Source of truth:** Beregnet fra `community_members` + `ai_agent_memory` + `cross_platform_users`

| Spørsmål | Svar |
|----------|------|
| **Tabeller** | `community_members` (LESER), `ai_agent_memory` (LESER), `cross_platform_users` (LESER — count) |
| **Route (eier)** | `GET /api/community-intelligence` |
| **Side** | `/community-intelligence` |
| **Legacy-lesere** | Ingen |
| **Skrivere** | Ingen — rent analytisk, ingen skriving |

**Segmenter (beregnet, ingen egne tabeller):**

| Segment | Kilde |
|---------|-------|
| Core Members | `streams_attended≥5 AND last_seen<7d AND (messages>10 OR engagement≥20)` |
| Community Heroes | `level≥30 OR supportScore≥5` |
| Streamer Supporters | `supportScore≥3` |
| Retention Leaders | `streams_attended≥8 AND last_seen<14d` |
| At Risk | `last_seen>14d AND xp>100 AND joined>30d` |
| Hidden Gems | `community_score≥30 AND messages<50 AND last_seen<30d` |

**Duplikater:** Ingen. CI er et analytisk lag — ingen overlapp med Community Manager's skriveoperasjoner.

---

## 9. Raid Manager

**Source of truth:** Twitch API (live data) + GPT-4o-mini (scoring)

| Spørsmål | Svar |
|----------|------|
| **Tabell** | Ingen persistent data. Skriver til `ai_agent_memory` (type: `stream_pattern`) for raid-historikk. Logger til `system_events` og `ai_agent_decisions`. |
| **Route (eier)** | `GET /api/raid-targets` |
| **Side** | `/raid-manager` |
| **Legacy-lesere** | Ingen |
| **Skrivere** | `GET /api/raid-targets` skriver til `ai_agent_memory` og `ai_agent_decisions` |

**Avhengigheter:**

| System | Hva |
|--------|-----|
| `src/lib/twitch.ts` | `getStreamInfo()` + `getBroadcasterId()` |
| Twitch Helix API | Live streams i samme kategori |
| `src/lib/ai/creatorContext.ts` → `upsertMemory()` | Lagre raid-historikk i minnet |
| `src/lib/ai/eventLogger.ts` → `logAgentDecision()` | Beslutningsspor |

**Duplikater:** Nei. Raid-targets er stateless utover memory-logging.

---

## 10. Sponsor Manager

**Source of truth:** Aggregert fra flere tabeller — ingen "eier" én tabell

| Spørsmål | Svar |
|----------|------|
| **Tabeller (leses)** | `stream_history`, `content_vods`, `content_highlights`, `partners`, `workspaces` |
| **Tabell (skrives)** | `partners` (via `/api/partners`) |
| **Route (rapport)** | `GET /api/sponsor-report` — aggregerer alle tabeller, genererer pitch med GPT |
| **Route (partners)** | `GET/POST/PUT/DELETE /api/partners` — CRUD for partnere |
| **Route (featured)** | `GET /api/partners/featured` |
| **Route (promote)** | `POST /api/partners/promote` — Discord-posting |
| **Route (revenue)** | `GET /api/partners/revenue` |
| **Side** | `/sponsor-manager` |
| **Legacy-lesere** | Ingen |

**Hvem skriver til `partners`:**

| System | Type | Hva |
|--------|------|-----|
| `POST/PUT/DELETE /api/partners` via `src/lib/partners.ts` | PRIMÆR SKRIVER | Partner-CRUD |

**Duplikater:** Nei. `sponsor-report` leser bredt, men skriver ingenting.

---

## 11. Dashboard

**Source of truth:** Aggregert sanntidsvisning — eier ingen data

| Spørsmål | Svar |
|----------|------|
| **Tabeller (leses)** | `workspaces`, `content_vods`, `content_highlights`, `ai_agent_insights`, `system_events`, `ai_agent_decisions`, `content_transcripts` |
| **Route (slow)** | `GET /api/dashboard` — 60s poll, innstillinger + VOD-status |
| **Route (fast)** | `GET /api/dashboard/live` — 5s poll, live-status + aktive jobs |
| **Side** | `/` (rot — Creator Operations Center) |
| **Legacy-lesere** | Ingen |
| **Skrivere** | Ingen — rent aggregerende |

**Duplikater:** Nei. Dashboard leser fra mange tabeller, men eier ingen av dem.

---

## 12. Settings

**Source of truth:** `workspaces.settings_json` (JSONB)

| Spørsmål | Svar |
|----------|------|
| **Tabell** | `workspaces` |
| **Route (eier)** | `GET/POST /api/settings` — lese og skrive workspace-konfig |
| **Route (bot)** | `GET/POST /api/bot-settings` — bot-atferdsflagger |
| **Route (kanal)** | `GET/POST /api/channel-settings` — Discord kanalpreferanser |
| **Side** | `/innstillinger` |
| **Legacy-lesere** | Ingen |

**Andre routes som LESER `workspaces`:**

| Route | Hva leses |
|-------|-----------|
| `GET /api/dashboard` | `settings_json` |
| `GET /api/dashboard/live` | `settings_json` |
| `GET /api/goals` | `settings_json` |
| `GET /api/goals/live` | `settings_json` |
| `GET /api/streamplan` | `settings_json` |
| `GET /api/stream-briefing` | `settings_json` |
| `GET /api/sponsor-report` | `settings_json` |
| `GET /api/bot-activity` | `settings_json` |

**Hvem SKRIVER til `workspaces`:**

| System | Type | Hva |
|--------|------|-----|
| `POST /api/settings` | PRIMÆR SKRIVER | Generell konfig |
| `POST /api/channel-settings` | PRIMÆR SKRIVER | Discord kanalvalg |
| `POST /api/streamplan` | SEKUNDÆR SKRIVER | Ukeplan i `settings_json` |
| `POST /api/goals` | SEKUNDÆR SKRIVER | Stream-mål i `settings_json` |

**Duplikater:** `settings`, `channel-settings` og `bot-settings` skriver alle til `workspaces`, men til ulike nøkler i `settings_json`. Ingen konflikter, men tre skrive-inngangspunkter til samme tabell er verdt å notere.

---

## 13. Discord

**Source of truth:** Discord API (eksternt) + `workspaces.settings_json` for kanalconfig

| Spørsmål | Svar |
|----------|------|
| **Tabeller** | `community_members` (oppdateres av bot), `workspaces` (kanalconfig), `ai_agent_memory` (via agentLogger) |
| **Route (kanaler)** | `GET /api/discord/channels` — analyser Discord-kanaler |
| **Route (test)** | `POST /api/discord/test-live` — test live-varsling |
| **Side** | `/discord` *(delvis aktiv — sjekk nav)* |
| **Bot** | `bot/index.ts` — Discord bot (Railway, persistent prosess) |

**Bot-skriving til Supabase:**

| Bot-fil | Tabell | Hva |
|---------|--------|-----|
| `bot/lib/memberTracker.ts` | `community_members` | XP, meldinger, reactions, voice |
| `bot/lib/agentLogger.ts` | `ai_agent_memory`, `ai_agent_events` | Discord-hendelser som minne |
| `bot/lib/twitchBot.ts` | `community_members` | Subs, gift_subs, raids |
| `bot/lib/learningAggregator.ts` | `ai_agent_memory`, `ai_agent_insights`, `cross_platform_users` | Batch-læring |

**Legacy-filer (markert for sletting):**
- `bot/lib/rpIntelligence.ts` — ingen aktive imports (Fase 1-sletting)

**Duplikater:** `bot/lib/twitchBot.ts` håndterer BÅDE Twitch-events og Discord-interaksjoner. Fungerer som bro mellom plattformene — ikke en duplikat, men en integrasjonsmodul.

---

## 14. Twitch

**Source of truth:** Twitch Helix API (eksternt) + `stream_history` for historikk

| Spørsmål | Svar |
|----------|------|
| **Tabeller** | `stream_history` (historikk), `workspaces` (kanalconfig) |
| **Route (live)** | `GET /api/twitch/live` — sjekk live-status |
| **Route (vekst)** | `GET /api/twitch/growth` — vekstanalyse |
| **Route (cron)** | `GET /api/cron/check-live` — automatisk live-sjekk |
| **Side** | `/twitch` *(sjekk om aktiv i nav)* |
| **Bot** | `bot/lib/twitchBot.ts` — lytter på Twitch-events via EventSub |

**Hvem skriver til `stream_history`:**

| System | Type | Hva |
|--------|------|-----|
| Railway bot (`bot/index.ts` eller `twitchBot.ts`) | PRIMÆR SKRIVER | Stream-sesjon data ved stream-start/slutt |
| *(Ingen Vercel-route skriver til stream_history)* | — | — |

**Hvem leser `stream_history`:**

| System | Formål |
|--------|--------|
| `GET /api/stream-history` | Visning + fallback til `hentBotData()` |
| `GET /api/ai-producer` | Stream-data til GPT-prompt |
| `GET /api/sponsor-report` | Metrics til sponsor-rapport |
| `GET /api/ai-command-center` | *(LEGACY — til sletting)* |

**Duplikater:** `hentBotData('stream-history')` i `stream-history/route.ts` er en Railway-fallback som hentes hvis Supabase er tom. Dette er **ikke** en duplikat — det er en degradert driftsmodus.

---

## Tverrgående systemer

### `system_events` — Observability

**Eier:** `src/lib/systemEvents.ts` → `logSystemEvent()`  
**Lesere:** `GET /api/system-events`, Dashboard (via `GET /api/dashboard/live`)  
**Skrivere:** Mange routes logger hit for observabilitet:

| Route | Hva logges |
|-------|-----------|
| `pre-live` | Hype-melding sendt |
| `raid-targets` | Raid-kandidater hentet, anbefaling lagret |
| `ai-producer` | Stream-analyse ferdig |
| `content-factory` | Pipeline-hendelser |
| `stream-briefing` | Briefing generert |
| `streamplan/post` | Plan postet til Discord |

`system_events` er et **write-only observability-lag** — ingen domene eier det, alle skriver til det.

---

### `workspaces` — Global Konfig

**Eier:** `GET/POST /api/settings` (primær inngangspunkt)  
**Tabellen er delt mellom:** streamplan, goals, channel-settings, bot-activity, dashboard  
**Risiko:** Tre ulike routes skriver til samme JSONB-felt med ulike nøkler. Ingen låsemekanisme. Lav risiko i dag (én bruker), men bør vurderes ved skalerring.

---

### `cross_platform_users` — Kryss-plattform Kobling

**Eier:** `bot/lib/learningAggregator.ts` (skriver)  
**Lesere:** `GET /api/community-intelligence` (count), `bot/lib/crossPlatformContext.ts`  
**Formål:** Kobler Discord-brukere til Twitch-brukere

---

## Oversikt: Hvem eier hva

| Tabell | Primær eier (CRUD) | Sekundære skrivere | Antall lesere |
|--------|--------------------|--------------------|---------------|
| `community_members` | `bot/lib/memberTracker.ts` | `/api/members/[id]/action`, `twitchBot.ts` | 5 |
| `ai_agent_memory` | `bot/lib/agentLogger.ts`, `learningAggregator.ts` | `/api/members/[id]/action`, `/api/raid-targets` | 6+ |
| `ai_agent_events` | `src/lib/ai/eventLogger.ts`, `bot/lib/agentLogger.ts` | — | 1 (ai-memory) |
| `ai_agent_decisions` | `src/lib/ai/eventLogger.ts` | — | 2 (ai-memory, dashboard) |
| `ai_agent_insights` | `bot/lib/learningAggregator.ts` | — | 2 (ai-memory, dashboard) |
| `stream_history` | Railway bot (twitchBot.ts) | — | 4 |
| `content_vods` | `/api/content-factory`, `clipWorker.ts` | `recoveryEngine.ts` | 3 |
| `content_highlights` | `/api/content-factory/phase2`, `clipWorker.ts` | — | 3 |
| `workspaces` | `/api/settings` | `/api/streamplan`, `/api/goals`, `/api/channel-settings` | 8+ |
| `partners` | `src/lib/partners.ts` | — | 2 |
| `system_events` | `src/lib/systemEvents.ts` | (mange routes logger) | 2 (system-events, dashboard) |
| `cross_platform_users` | `bot/lib/learningAggregator.ts` | — | 2 |

---

## Duplikat-register

| Duplikat | Type | Status |
|----------|------|--------|
| `ai_producer_*` tabeller vs. `ai_agent_*` | Funksjonell duplikasjon — begge inneholder læringsdata | Aktiv sunset. Legacytabeller fjernes etter 2026-06-14 |
| `hentBotData()` vs. Supabase | Fallback, ikke duplikat | Midlertidig — fjernes når Railway-fallback ikke lenger trengs |
| `/thumbnails/generate` vs. `/thumbnails/generate-v2` | Infrastruktur (V1) vs. motor (V2) | Ikke duplikater — V1 delegerer til V2 |
| `ai-command-center/route.ts` | Leser `community_members` + `stream_history` | LEGACY til sletting (Fase 1) |

---

## Skrivetilgangstabell (autorisert vs. uautorisert)

> Definisjoner: **Autorisert** = designet som skriver for dette domenet. **Uautorisert** = skriver til en tabell den ikke "eier" — bør vurderes om det er riktig.

| System | Tabell | Status |
|--------|--------|--------|
| `memberTracker.ts` → `community_members` | Autorisert |  |
| `twitchBot.ts` → `community_members` | Autorisert |  |
| `/api/members/[id]/action` → `community_members.badges` | Autorisert (manuell handling) |  |
| `/api/members/[id]/action` → `ai_agent_memory` (follow_up) | Autorisert (dokumentert pattern) |  |
| `/api/raid-targets` → `ai_agent_memory` | Akseptert sekundær skriving (historikk-logging) |  |
| `learningLoop.ts:181` → `ai_producer_community_memory` | LEGACY — fjernes etter 2026-06-14 |  |
| `creatorContext.ts:87` → leser `ai_producer_knowledge` | LEGACY fallback — fjernes etter Fase 3 |  |

---

*Generert 2026-06-08 — Neste revisjon anbefalt etter Fase 3 cleanup (post 2026-06-14)*
