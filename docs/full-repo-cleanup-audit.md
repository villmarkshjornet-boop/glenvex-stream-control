# GLENVEX Creator OS — Full Repo Cleanup Audit

**Dato:** 2026-06-08  
**Formål:** Kartlegge hele repoet for døde filer, duplikater, legacy og ubrukt kode  
**Scope:** src/, bot/, scripts/, docs/

---

## LEGENDE

| Kode | Betydning |
|------|-----------|
| ✅ KEEP | Aktiv, brukes i nav/pipeline, ikke erstattet |
| 🗑 REMOVE | Bekreftet død — ingen aktive referanser |
| 🔀 MERGE | Kan slås sammen med annen aktiv fil |
| 🕰 LEGACY | Erstattet av nyere system, men krever koordinert migrering |
| 🛠 DEV-ONLY | Test/debug-route — bør gates eller slettes |
| ❓ UNKNOWN | Må verifiseres manuelt |

---

## DEL 1 — SIDER (src/app/*/page.tsx)

### I nav — Aktive sider

| Side | URL | Kaller | Status |
|------|-----|--------|--------|
| Dashboard | `/` | /api/dashboard, /api/dashboard/live | ✅ KEEP |
| Twitch Oversikt | `/twitch` | /api/twitch/* | ✅ KEEP |
| Streamplan | `/streamplan` | /api/streamplan | ✅ KEEP |
| Viewer Goals | `/viewer-goals` | /api/goals/* | ✅ KEEP |
| AI Producer | `/ai-producer` | /api/ai-producer | ✅ KEEP |
| Stream Coach | `/stream-coach` | /api/stream-coach | ✅ KEEP |
| Raid Manager | `/raid-manager` | /api/raid-targets | ✅ KEEP |
| Vekstanalyse | `/statistikk` | /api/twitch/growth | ✅ KEEP |
| Stream Briefing | `/stream-briefing` | /api/stream-briefing | ✅ KEEP |
| Discord Oversikt | `/discord` | /api/bot-activity, /api/bot-health | ✅ KEEP |
| Community Manager | `/community-manager` | /api/members, /api/members/[id] | ✅ KEEP |
| Community Intelligence | `/community-intelligence` | /api/community-intelligence | ✅ KEEP |
| Moderator | `/moderation` | /api/moderation | ✅ KEEP |
| Innhold (hub) | `/innhold` | (navigasjonsside) | ✅ KEEP |
| Publisering | `/innhold/publisering` | /api/content-library | ✅ KEEP |
| Content Factory Admin | `/content-factory-admin` | /api/content-factory/* | ✅ KEEP |
| Highlights Admin | `/content-factory-admin/highlights` | /api/content-factory | ✅ KEEP |
| Jobs Admin | `/content-factory-admin/jobs` | /api/content-factory/jobs | ✅ KEEP |
| QA Admin | `/content-factory-admin/qa` | /api/content-factory/qa | ✅ KEEP |
| Clip Factory | `/clip-factory` | /api/clip-factory | ✅ KEEP |
| Partnere (hub) | `/partnere` | (navigasjonsside) | ✅ KEEP |
| Partner Hub | `/partner-hub` | /api/partners/* | ✅ KEEP |
| Sponsor Manager | `/sponsor-manager` | /api/sponsor-report | ✅ KEEP |
| AI Memory | `/ai-memory` | /api/ai-memory, /api/cross-platform-context | ✅ KEEP |
| Team | `/team` | (statisk) | ✅ KEEP |
| Innstillinger | `/innstillinger` | /api/settings, /api/system-health | ✅ KEEP |
| Logs | `/logs` | /api/logs | ✅ KEEP |

---

### Ikke i nav — Analyse

| Side | URL | Hva gjør den | Hvem kaller den | Anbefaling |
|------|-----|--------------|-----------------|------------|
| AI Assistent | `/ai-assistent` | POSTer til /api/ai/promo og viser generert promo-tekst | Ingen aktiv lenke i nav | 🗑 REMOVE — QuickActions gjør samme jobb |
| AI Command Center | `/ai-command-center` | Dashboard med AI-scores basert på JSON-filer | Ingen aktiv lenke | 🗑 REMOVE — Erstattet av dashboard/live og community-intelligence |
| Clips | `/clips` | Viser clips-queue fra JSON-fil | Ingen aktiv lenke | 🗑 REMOVE — Duplikat av /clip-factory |
| Community Memory | `/community-memory` | Fil-basert community-notat-system (data/community-memory.json) | Ingen aktiv lenke | 🗑 REMOVE — Erstattet av community-intelligence (Supabase) |
| Analytics Admin | `/content-factory-admin/analytics` | Visningsside for content-factory analytics | Ikke i nav, men sidestilt med andre admin-sider | ❓ UNKNOWN — Sjekk om siden er ferdig |
| Discord Control | `/discord-control` | Bot-innstillinger (tone, personality) via /api/bot-settings | Ingen aktiv lenke | 🗑 REMOVE — Bør evt. flyttes til /innstillinger |
| Discord Library | `/discord-library` | Viser content-library.json | Ingen aktiv lenke | 🗑 REMOVE — Samme data i /innhold/publisering |
| Event Generator | `/event-generator` | Genererer Discord-events via /api/events/generate | Ingen aktiv lenke | 🗑 REMOVE |
| GlenCoins | `/glencoins` | XP/coin-system basert på data/glencoins.json | Ingen aktiv lenke | 🗑 REMOVE — Ikke koblet til community_members XP |
| Highlights | `/highlights` | Gammelt highlight-grensesnitt | Ingen aktiv lenke | 🗑 REMOVE — Erstattet av /content-factory-admin/highlights |
| Kanal-innstillinger | `/kanal-innstillinger` | Kanalpreferanser-side (eldre versjon) | Ingen aktiv lenke | 🗑 REMOVE — /innstillinger dekker dette |
| Kommandoer | `/kommandoer` | Liste over bot-kommandoer | Ingen aktiv lenke | 🗑 REMOVE |
| Live-overvaking | `/live-overvaking` | Live monitoring-dashboard | Ingen aktiv lenke | 🗑 REMOVE — Erstattet av dashboard |
| Markedsføring | `/markedsforing` | Kaller /api/ai/promo for sosiale medier-tekster | Ingen aktiv lenke | 🗑 REMOVE — AI Producer gjør samme jobb |
| Merch | `/merch` | Merch-side basert på /api/merch | Ingen aktiv lenke | 🗑 REMOVE |
| Overlay Goals | `/overlay/goals` | Overlay for viewer-goals (OBS) | Brukes direkte av OBS, ikke via nav | ❓ UNKNOWN — Sjekk om OBS bruker den |
| Polls | `/polls` | Twitch-polls via /api/polls | Ingen aktiv lenke | 🗑 REMOVE |
| Pre-Live | `/pre-live` | Pre-stream Discord-hype poster | Ingen aktiv lenke | 🗑 REMOVE — Eller legg til i nav under Stream |
| Role Manager | `/role-manager` | Discord-rolle-manager UI | Ingen aktiv lenke | 🗑 REMOVE — Bot håndterer roller automatisk |
| RP Intelligence | `/rp-intelligence` | RP-notater og lore (data/rp-notes.json) | Ingen aktiv lenke | 🕰 LEGACY — Filen er fil-basert. Vurder Supabase-migrasjon. |
| RP Manager | `/rp-manager` | Genererer RP-karakterer via OpenAI | Ingen aktiv lenke | 🕰 LEGACY — Aktiv funksjon men ikke eksponert i nav |
| RP Vault | `/rp-vault` | Les-interface for RP-karakterer | Ingen aktiv lenke | 🕰 LEGACY — Som over |
| Setup Wizard | `/setup-wizard` | Første gangs oppsett | Ingen aktiv lenke | 🗑 REMOVE — Erstattet av /innstillinger |
| System Health | `/system-health` | Sjekker env-vars og tjenester | Ingen aktiv lenke | 🗑 REMOVE — Funksjonalitet dekket av /innstillinger |
| Systemstatus | `/systemstatus` | Enklere statussøyde via /api/status | Ingen aktiv lenke | 🗑 REMOVE — Duplikat av /system-health (som selv er legacy) |
| XP System | `/xp-system` | XP-dokumentasjonsside | Ingen aktiv lenke | 🗑 REMOVE |

**Sum: 22 sider klare for sletting, 3 ukjente, 3 legacy som trenger koordinert migrering**

---

## DEL 2 — API ROUTES (src/app/api/)

### Bekreftet aktive (kalles fra nav-sider eller bot)

| Route | Kalles fra | Tabeller | Status |
|-------|-----------|----------|--------|
| /api/dashboard/live | page.tsx (/) | system_events, ai_agent_decisions, stream_history | ✅ KEEP |
| /api/dashboard | page.tsx (/) | Aggregert | ✅ KEEP |
| /api/ai-producer | /ai-producer | community_members, stream_history, ai_agent_memory | ✅ KEEP |
| /api/ai-producer/tips | /ai-producer | ai_agent_events, ai_agent_decisions | ✅ KEEP |
| /api/ai-memory | /ai-memory | ai_agent_memory, ai_agent_insights | ✅ KEEP |
| /api/ai-memory/forget | /ai-memory | ai_agent_memory | ✅ KEEP |
| /api/community-intelligence | /community-intelligence | community_members, ai_agent_memory, cross_platform_users | ✅ KEEP |
| /api/members | /community-manager | community_members | ✅ KEEP |
| /api/members/[id] | /community-manager | community_members, ai_agent_memory | ✅ KEEP |
| /api/members/[id]/action | /community-manager | community_members, ai_agent_memory | ✅ KEEP |
| /api/raid-targets | /raid-manager | ai_agent_memory, ai_agent_decisions | ✅ KEEP |
| /api/stream-briefing | /stream-briefing | stream_history + external | ✅ KEEP |
| /api/stream-coach | /stream-coach | data/stream-history.json | ✅ KEEP (fil-basert) |
| /api/partners | /partner-hub | ai_agent_memory | ✅ KEEP |
| /api/partners/featured | /partner-hub | — | ✅ KEEP |
| /api/partners/generate | /partner-hub | — | ✅ KEEP |
| /api/partners/promote | /partner-hub | ai_agent_memory, botMemory | ✅ KEEP |
| /api/partners/revenue | /partner-hub | — | ✅ KEEP |
| /api/sponsor-report | /sponsor-manager | — | ✅ KEEP |
| /api/system-events | /innstillinger | system_events | ✅ KEEP |
| /api/bot-health | /discord | bot (Railway poll) | ✅ KEEP |
| /api/bot-settings | /discord-control (dead), /innstillinger? | data/bot-settings.json | ❓ UNKNOWN |
| /api/bot-activity | /discord | contentLibrary + botData | ✅ KEEP |
| /api/moderation | /moderation | data/moderation.json | ✅ KEEP (fil-basert, vurder migrering) |
| /api/content-factory/* | /content-factory-admin | content_vods, content_highlights | ✅ KEEP |
| /api/content-factory/clip | /clip-factory | — | ✅ KEEP |
| /api/content-factory/jobs | /content-factory-admin/jobs | — | ✅ KEEP |
| /api/content-factory/qa | /content-factory-admin/qa | — | ✅ KEEP |
| /api/content-factory/health | Intern (orchestrator) | — | ✅ KEEP |
| /api/clip-factory | /clip-factory | — | ✅ KEEP |
| /api/goals/route | /viewer-goals | — | ✅ KEEP |
| /api/goals/live | /viewer-goals | — | ✅ KEEP |
| /api/goals/post | /viewer-goals | — | ✅ KEEP |
| /api/streamplan | /streamplan | data/streamplan.json | ✅ KEEP (fil-basert) |
| /api/streamplan/post | /streamplan | contentLibrary | ✅ KEEP |
| /api/settings | /innstillinger | workspaces (Supabase) | ✅ KEEP |
| /api/channel-settings | /innstillinger? | data/channel-settings.json ⚠️ | ✅ KEEP (men se Supabase-advarsel) |
| /api/logs | /logs | data/activity.log | ✅ KEEP |
| /api/cross-platform-context | /ai-memory | ai_agent_events | ✅ KEEP |
| /api/twitch/growth | /statistikk | external Twitch API | ✅ KEEP |
| /api/twitch/live | Bot/intern polling | external Twitch API | ✅ KEEP |
| /api/discord/channels | /innstillinger | external Discord API | ✅ KEEP |
| /api/discord/test-live | QuickActions | external Discord API | ✅ KEEP |
| /api/ai/promo | QuickActions.tsx (aktiv!) | external OpenAI | ✅ KEEP |
| /api/status | Intern/diagnostics | — | ✅ KEEP |
| /api/cron/check-live | Vercel Cron | external Twitch + Discord | ✅ KEEP |
| /api/content-library | /innhold/publisering | contentLibrary (JSON) | ✅ KEEP |
| /api/content-library/publish | /innhold/publisering | contentLibrary (JSON) | ✅ KEEP |
| /api/content-plan | Intern? | contentLibrary + botData | ❓ UNKNOWN |
| /api/highlights | ? | content_highlights (Supabase) | ❓ UNKNOWN |
| /api/rp-characters | /rp-vault, /rp-manager | contentLibrary | 🕰 LEGACY |
| /api/rp-notes | /rp-intelligence | data/rp-notes.json | 🕰 LEGACY |
| /api/rp/generate | /rp-manager | OpenAI | 🕰 LEGACY |
| /api/rp/publish | /rp-manager | contentLibrary | 🕰 LEGACY |
| /api/rp/image | /rp-manager | OpenAI DALL-E | 🕰 LEGACY |
| /api/stream-history | /stream-coach, /statistikk | botData + stream_history | ✅ KEEP |
| /api/vod/detect-latest | Content Factory intern | external Twitch API | ✅ KEEP |

---

### Bekreftet døde API-routes

| Route | Kaller | Hvorfor død | Risiko ved sletting | Status |
|-------|--------|-------------|---------------------|--------|
| /api/ai-command-center | Kun /ai-command-center (dead page) | Siden er dead, bruker fs.readFile | Lav | 🗑 REMOVE |
| /api/ai-scores | Kun /ai-scores? eller dead page | File-basert aggregering, erstattet av dashboard/live | Lav | 🗑 REMOVE |
| /api/community-memory | Kun /community-memory (dead) | File-basert, erstattet av community-intelligence | Lav | 🗑 REMOVE |
| /api/community-memory/insights | Kun /community-memory (dead) | File-basert | Lav | 🗑 REMOVE |
| /api/events/generate | Kun /event-generator (dead) | Ikke i nav | Lav | 🗑 REMOVE |
| /api/events/route | Kun botData fallback? | Sjekk om bot kaller den | ❓ UNKNOWN | ❓ UNKNOWN |
| /api/glencoins | Kun /glencoins (dead) | File-basert | Lav | 🗑 REMOVE |
| /api/merch | Kun /merch (dead) | File-basert | Lav | 🗑 REMOVE |
| /api/polls | Kun /polls (dead) | File-basert | Lav | 🗑 REMOVE |
| /api/pre-live | Kun /pre-live (dead page) | Ikke i nav | Lav | 🗑 REMOVE |
| /api/role-manager | Kun /role-manager (dead) + botData | Erstattet av bot auto-rolle | Lav | 🗑 REMOVE |
| /api/role-rules | Kun /role-manager? | Rolle-regler | Lav | 🗑 REMOVE |
| /api/clips-queue | Kun /clips (dead) | File-basert | Lav | 🗑 REMOVE |
| /api/bot-rapport | Ingen kalt fra aktiv side? | Leser log-fil | Lav | 🗑 REMOVE |

---

### Dev/test-routes (bør gates eller slettes)

| Route | Hva gjør den | Kommentar | Status |
|-------|--------------|-----------|--------|
| /api/ai-memory/test | E2E-test av ai_agent_*-tabellene. Har kommentar "Slettes etter verifisering" | Testen er gammel — tabellene er bekreftet aktive | 🛠 DEV-ONLY → REMOVE |
| /api/channel-settings/debug | Dumper Supabase workspace settings | Debug-verktøy | 🛠 DEV-ONLY → REMOVE |
| /api/live/diagnostics | Diagnostikkdata | Debug | 🛠 DEV-ONLY → Gate bak env-sjekk |
| /api/live/force-notify | Tvinger live-varsling til Discord | Operasjonell nødbruk — behold men gate | 🛠 Gate bak env/auth |
| /api/live/reset-id | Resetter lastNotifiedStreamId | Operasjonell nødbruk | 🛠 Gate bak env/auth |

---

### Interne worker-routes (ikke skal kalles fra UI)

| Route | Hva gjør den | Kalt fra |
|-------|--------------|---------|
| /api/content-factory/phase2 | Kjører gammel learningLoop (ai_producer_*) | Manuell kjøring? |
| /api/content-factory/worker-status | Status-ping fra Railway worker | Railway bot |
| /api/content-factory/railway-status/[vodId] | Callback fra Railway → Vercel | Railway bot |
| /api/content-factory/cleanup | Sletter gamle jobs | Manuell kjøring |
| /api/content-factory/retry | Prøver feila jobs på nytt | Manuell/intern |
| /api/content-factory/clip-retry | Spesifikk clip-retry | Manuell/intern |
| /api/content-factory/clip-force | Tvinger clip-generering | Manuell |
| /api/content-factory/download | VOD-nedlasting | Intern pipeline |
| /api/content-factory/thumbnails/generate | Thumbnail-gen (gammel) | Intern |
| /api/content-factory/thumbnails/generate-v2 | Thumbnail-gen V2 | Intern |

---

## DEL 3 — LIB-FILER (src/lib/)

### Aktive lib-filer

| Fil | Brukes av | Status |
|-----|----------|--------|
| src/lib/ai/creatorContext.ts | ai-producer, stream-briefing, raid-targets, community-intelligence | ✅ KEEP |
| src/lib/ai/eventLogger.ts | ai-producer/tips, raid-targets, dashboard/live | ✅ KEEP |
| src/lib/db.ts | Alle DB-routes | ✅ KEEP |
| src/lib/workspace.ts | Alle DB-routes | ✅ KEEP |
| src/lib/twitch.ts | ai-producer, stream-briefing, dashboard, cron | ✅ KEEP |
| src/lib/discord.ts | live-notify, bot-activity, stream-briefing | ✅ KEEP |
| src/lib/discordChannel.ts | debug-route, bot-activity | ✅ KEEP |
| src/lib/discordMessages.ts | live-notify | ✅ KEEP |
| src/lib/systemEvents.ts | ai-producer, stream-briefing, raid-targets, dashboard | ✅ KEEP |
| src/lib/partners.ts | partner-routes | ✅ KEEP |
| src/lib/settings.ts | live-notify, settings-route, channel-settings | ✅ KEEP |
| src/lib/openai.ts | ai/promo-route | ✅ KEEP (men sjekk om generert av ny kode) |
| src/lib/logger.ts | Mange routes | ✅ KEEP |
| src/lib/botData.ts | ai-producer, bot-activity, members, stream-history osv. | ✅ KEEP (fallback-system) |
| src/lib/getPartnerLink.ts | partner-hub | ✅ KEEP |
| src/lib/roleRules.ts | role-manager route (dead) | ❓ Sjekk om bot bruker den |
| src/lib/rpCharacters.ts | rp-routes (legacy) | 🕰 LEGACY |

### Legacy lib-filer

| Fil | Hva gjør den | Erstattet av | Brukes fortsatt av | Status |
|-----|--------------|--------------|---------------------|--------|
| src/lib/botMemory.ts | JSON-fil-basert AI-minne (data/bot-memory.json) | ai_agent_memory (Supabase) | bot-settings/route.ts, partners/promote | 🕰 LEGACY — Brukes fortsatt, men bør erstattes |
| src/lib/contentLibrary.ts | JSON-fil-basert content-staging (data/content-library.json) | Supabase content_highlights? | 8 routes inkl. aktive | 🕰 LEGACY — Svært brukt, migrasjon nødvendig |
| src/lib/content-factory/ai-producer/knowledgeBase.ts | Leser/skriver ai_producer_* Supabase-tabeller | ai_agent_* + creatorContext.ts | learningLoop.ts (via phase2) | 🕰 LEGACY — Bare phase2-route bruker den |
| src/lib/content-factory/ai-producer/learningLoop.ts | Gammel learning-loop for content-factory | bot/lib/learningAggregator.ts | /api/content-factory/phase2 | 🕰 LEGACY — Dobbelt lærings-system |
| src/lib/content-factory/ai-producer/streamMemory.ts | Skriver til ai_producer_stream_memory + ai_producer_content_memory | ai_agent_events | learningLoop.ts | 🕰 LEGACY |

---

## DEL 4 — BOT/RAILWAY (bot/)

### Aktive bot-filer

| Fil | Hva gjør den | Status |
|-----|--------------|--------|
| bot/index.ts | Hoved-entrypoint. Discord + Twitch events. | ✅ KEEP |
| bot/lib/twitchBot.ts | Twitch IRC chat-handler | ✅ KEEP |
| bot/lib/memberTracker.ts | XP, levels, community_members skriving | ✅ KEEP |
| bot/lib/learningAggregator.ts | 15-min batch, skriver ai_agent_memory + cross_platform_users | ✅ KEEP |
| bot/lib/agentLogger.ts | Event-logging til ai_agent_events + ai_agent_memory | ✅ KEEP (men dobbelt med eventLogger.ts) |
| bot/lib/streamHistory.ts | Skriver stream_history til Supabase | ✅ KEEP |
| bot/lib/recoveryEngine.ts | Crash recovery og retry | ✅ KEEP |
| bot/lib/partnerHelper.ts | Partner-matching og affiliate | ✅ KEEP |
| bot/lib/roleManager.ts | Discord-rolle-tildeling | ✅ KEEP |
| bot/lib/aiPersonality.ts | Bot-svar og personlighet | ✅ KEEP |
| bot/lib/crossPlatformContext.ts | Kobler Discord ↔ Twitch brukere | ✅ KEEP |
| bot/lib/dataApi.ts | Sender data til Vercel API | ✅ KEEP |
| bot/lib/systemEvents.ts | Systemlogging til Supabase | ✅ KEEP |
| bot/lib/supabase.ts | Supabase-klient for bot | ✅ KEEP |
| bot/lib/eventTracker.ts | Tracker events (raids, subs, etc.) | ✅ KEEP |
| bot/lib/botEvents.ts | Discord-event-håndtering | ✅ KEEP |
| bot/lib/botKanalPreferanser.ts | Laster kanalkonfigurasjon | ✅ KEEP |
| bot/lib/thumbnailBuilderV2.ts | Ny thumbnail-generator (Sharp + frames) | ✅ KEEP |
| bot/commands/* | Discord slash-commands | ✅ KEEP |
| bot/deploy-commands.ts | Discord command registrering | ✅ KEEP |

### Legacy bot-filer

| Fil | Problem | Erstattet av | Status |
|-----|---------|--------------|--------|
| bot/lib/thumbnailGenerator.ts | Bruker DALL-E 3 for AI-genererte thumbnails. Fortsatt importert i bot/index.ts linje 20. | bot/lib/thumbnailBuilderV2.ts | 🕰 LEGACY — AKTIV MEN BØR BYTTES |
| bot/lib/rpIntelligence.ts | RP-karakter-intelligens for bot. Sjekk om brukt. | Ukjent | ❓ UNKNOWN |

---

## DEL 5 — DUPLIKATER OG OVERLAPPENDE SYSTEMER

### Duplikat 1: THUMBNAIL GENERATOR

| System | Fil | Teknologi | Status |
|--------|-----|-----------|--------|
| **Gammel** | bot/lib/thumbnailGenerator.ts | DALL-E 3 genererer bilde fra scratch | I bruk (bot/index.ts:20) |
| **Ny** | bot/lib/thumbnailBuilderV2.ts | Sharp + reelle frames + GPT-4o Vision | IKKE importert i bot/index.ts |

**Problem:** Gammel er aktiv, ny er passiv. `bot/index.ts` importerer `startThumbnailWorker` fra V1.  
**Konsekvens:** Alle thumbnails lages med DALL-E (dyrt, ingen faktiske frames).  
**Aksjon:** Bytt import i bot/index.ts fra `thumbnailGenerator` til `thumbnailBuilderV2`.

---

### Duplikat 2: LÆRINGS-SYSTEM (dobbelt)

| System | Fil | Tabeller | Trigger |
|--------|-----|----------|---------|
| **Gammel** | src/lib/content-factory/ai-producer/learningLoop.ts | ai_producer_* (legacy) | /api/content-factory/phase2 (manuelt) |
| **Ny** | bot/lib/learningAggregator.ts | ai_agent_* + cross_platform_users | Automatisk hvert 15. minutt |

**Problem:** To separate learning-systemer. learningLoop skriver til utfasede tabeller. Det finnes kommentarer i koden om å slutte å skrive til `ai_producer_community_memory` etter 2026-06-14.  
**Aksjon:** Avslutt learningLoop. Slett phase2-route. Phase2-funksjonalitet er absorbiert i learningAggregator.

---

### Duplikat 3: COMMUNITY-SYSTEM (fil vs. DB)

| System | Filer | Datakilde | Status |
|--------|-------|-----------|--------|
| **Gammel** | community-memory page + /api/community-memory | data/community-memory.json (fil) | Ikke i nav |
| **Ny** | community-intelligence + community-manager | community_members + ai_agent_memory (Supabase) | I nav, aktiv |

**Problem:** Gammelt system lagrer alt i JSON-fil (ikke persistent på Vercel). Nytt system er DB-basert.  
**Aksjon:** Slett community-memory page og routes. Data som er lagret i filen er trolig tom/utdatert på Vercel.

---

### Duplikat 4: AGENT LOGGER (dobbelt)

| System | Fil | Brukes av | Skriver til |
|--------|-----|----------|-------------|
| **Bot-side** | bot/lib/agentLogger.ts | bot/index.ts, twitchBot.ts, learningAggregator.ts, aiPersonality.ts | ai_agent_events, ai_agent_memory |
| **Vercel-side** | src/lib/ai/eventLogger.ts | ai-producer/tips, raid-targets | ai_agent_events, ai_agent_decisions |

**Vurdering:** Disse er IKKE duplikater — de tjener ulike formål. agentLogger er for Railway-boten. eventLogger er for Vercel-API-ene.  
**Aksjon:** Beholde begge. Dokumentere forskjellen tydelig.

---

### Duplikat 5: AI DASHBOARD (old vs. new)

| System | Side | Hva | Status |
|--------|------|-----|--------|
| **Gammel** | /ai-command-center | Aggregert AI-score fra JSON-filer (community, stream, content, sponsor) | Dead — ikke i nav |
| **Ny** | / (Dashboard) + /community-intelligence | DB-basert med lærdom, segmenter, AI-analyse | I nav, aktiv |

**Aksjon:** Slett /ai-command-center og tilhørende route.

---

## DEL 6 — SUPABASE: TABELLER OG DATAFLYT

### Aktive tabeller (leses OG skrives til)

| Tabell | Skrives av | Leses av |
|--------|-----------|---------|
| ai_agent_memory | learningAggregator, agentLogger, eventLogger, upsertMemory | creatorContext, community-intelligence, ai-memory, raid-targets |
| ai_agent_events | agentLogger, eventLogger | cross-platform-context, learningAggregator |
| ai_agent_decisions | eventLogger (logAgentDecision) | dashboard/live, raid-targets |
| ai_agent_insights | learningAggregator | ai-memory |
| community_members | memberTracker (bot) | members-route, community-intelligence, ai-producer |
| stream_history | streamHistory (bot) | creatorContext, stream-briefing, ai-producer |
| content_vods | content-factory pipeline | content-factory/route.ts |
| content_highlights | content-factory pipeline | highlights-route, content-factory |
| cross_platform_users | learningAggregator | community-intelligence |
| system_events | logSystemEvent (mange) | system-events-route, dashboard/live |
| workspaces | settings-route | workspace.ts (alle) |

### Legacy tabeller (leses men erstattes)

| Tabell | Leses av | Skrives av | Utfasing |
|--------|---------|-----------|---------|
| ai_producer_knowledge | creatorContext.ts (linje 87), knowledgeBase.ts | knowledgeBase.ts | Skriving skal stoppes. Leses for bakoverkompatibilitet. |
| ai_producer_stream_memory | knowledgeBase.ts | streamMemory.ts | Samme |
| ai_producer_content_memory | knowledgeBase.ts | streamMemory.ts | Samme |
| ai_producer_community_memory | knowledgeBase.ts | learningLoop.ts | Kommentar i kode: stopper etter 2026-06-14 |

**Kritisk:** `creatorContext.ts` leser fortsatt fra `ai_producer_knowledge` (linje 87). Når tabellen er tom/slettet vil den returnere tomme resultater. Migrasjon: slett lesing fra legacy tabeller i creatorContext.ts og erstatt med ai_agent_memory-spørringen som allerede finnes.

---

### Kritisk Vercel-advarsel: Fil-basert skriving fungerer ikke

Disse routes bruker `fs.writeFileSync` på Vercel (serverless). **Dataen slettes ved hver ny deploy eller kald funksjon:**

| Route | Skriver til fil |
|-------|----------------|
| /api/channel-settings | data/channel-settings.json |
| /api/clips-queue | data/clips-queue.json |
| /api/community-memory | data/community-memory.json |
| /api/glencoins | data/glencoins.json |
| /api/moderation | data/moderation.json |
| /api/rp-notes | data/rp-notes.json |
| /api/streamplan | data/streamplan.json |

**De fleste er dead (community-memory, glencoins, clips-queue, rp-notes).**  
**De aktive (channel-settings, moderation, streamplan) bør migreres til Supabase.**

---

## DEL 7 — KOMPONENTER (src/components/)

| Komponent | Brukes av | Status |
|-----------|----------|--------|
| Sidebar.tsx | layout.tsx | ✅ KEEP |
| Topbar.tsx | layout.tsx | ✅ KEEP |
| BotVarsler.tsx | layout.tsx | ✅ KEEP |
| QuickActions.tsx | Noen sider (bruker /api/ai/promo og /api/discord/test-live) | ✅ KEEP |
| LiveStatusCard.tsx | Sjekk om importert | ❓ UNKNOWN |
| LogsPreview.tsx | Sjekk om importert | ❓ UNKNOWN |
| StatsCards.tsx | Sjekk om importert | ❓ UNKNOWN |
| SystemStatusCard.tsx | Sjekk om importert | ❓ UNKNOWN |
| ConfigPanel.tsx | Sjekk om importert | ❓ UNKNOWN |

---

## DEL 8 — SCRIPTS OG DOCS

| Fil | Status |
|-----|--------|
| scripts/test-ai-memory.ts | 🛠 DEV-ONLY → REMOVE (tabellene er bekreftet aktive) |
| docs/analysis-code-audit.md | ❓ UNKNOWN — Sjekk om oppdatert eller utdatert |
| docs/community-intelligence-red-thread-audit.md | ✅ KEEP — Aktuell sprint |
| docs/effect-tracking-red-thread-audit.md | ✅ KEEP — Aktuell sprint |
| docs/full-repo-cleanup-audit.md | ✅ KEEP — Denne filen |

---

## DEL 9 — CLEANUP-PLAN I TRYGG REKKEFØLGE

### Fase 1 — Trygg sletting (ingen aktive avhengigheter)

**Sider:**
```
src/app/ai-assistent/
src/app/ai-command-center/
src/app/clips/
src/app/community-memory/
src/app/discord-control/
src/app/discord-library/
src/app/event-generator/
src/app/glencoins/
src/app/highlights/
src/app/kanal-innstillinger/
src/app/kommandoer/
src/app/live-overvaking/
src/app/markedsforing/
src/app/merch/
src/app/polls/
src/app/pre-live/
src/app/role-manager/
src/app/setup-wizard/
src/app/system-health/
src/app/systemstatus/
src/app/xp-system/
```

**API-routes:**
```
src/app/api/ai-command-center/
src/app/api/ai-scores/
src/app/api/community-memory/
src/app/api/community-memory/insights/
src/app/api/events/generate/
src/app/api/glencoins/
src/app/api/merch/
src/app/api/polls/
src/app/api/pre-live/
src/app/api/role-manager/
src/app/api/role-rules/
src/app/api/clips-queue/
src/app/api/bot-rapport/
src/app/api/ai-memory/test/
src/app/api/channel-settings/debug/
```

**Scripts:**
```
scripts/test-ai-memory.ts
```

---

### Fase 2 — Bot/thumbnail fix (lav risiko, høy verdi)

1. Bytt import i `bot/index.ts` linje 20:
   - FRA: `import { startThumbnailWorker } from './lib/thumbnailGenerator'`
   - TIL: `import { startThumbnailWorker } from './lib/thumbnailBuilderV2'`
2. Verifiser at thumbnailBuilderV2 eksporterer `startThumbnailWorker`
3. Marker bot/lib/thumbnailGenerator.ts som deprecated, slett etter bekreftelse

---

### Fase 3 — Legacy lærings-system (krever testing)

1. Stopp kjøring av learningLoop via phase2-route
2. Fjern skrivingen til `ai_producer_community_memory` i learningLoop.ts (kommentert med 2026-06-14 dato)
3. Slett `src/app/api/content-factory/phase2/route.ts` når learningAggregator bekreftes stabil
4. Slett `src/lib/content-factory/ai-producer/learningLoop.ts`
5. Slett `src/lib/content-factory/ai-producer/streamMemory.ts`
6. Slett `src/lib/content-factory/ai-producer/knowledgeBase.ts`

---

### Fase 4 — Creator Context migrering (krever varsomhet)

`src/lib/ai/creatorContext.ts` leser fortsatt fra `ai_producer_knowledge` (linje 87).

1. Sjekk om tabellen inneholder data som ikke finnes i ai_agent_memory
2. Migrer evt. data til ai_agent_memory
3. Fjern `ai_producer_knowledge`-spørringen fra creatorContext.ts
4. Test AI Producer og Stream Briefing etter endring

---

### Fase 5 — Fil-basert migrasjon til Supabase (langsiktig)

Prioritert rekkefølge:
1. `/api/channel-settings` → workspaces.settings_json (delvis gjort)
2. `/api/streamplan` → ny Supabase-tabell `stream_plans`
3. `/api/moderation` → ny tabell `moderation_entries`
4. `contentLibrary.ts` → content_highlights (tabellen finnes)
5. `botMemory.ts` → ai_agent_memory (tabellen finnes)

---

### Fase 6 — RP-system (vurder fremtid)

De tre RP-sidene (/rp-manager, /rp-vault, /rp-intelligence) er IKKE i nav men er aktive features.

**Beslutning:** Enten legg dem til i nav (Innhold-seksjonen) eller marker dem for sletting.

---

## SAMMENDRAG

| Kategori | Antall | Anbefaling |
|----------|--------|------------|
| Aktive sider i nav | 27 | Behold |
| Sider klar for sletting | 21 | Slett i Fase 1 |
| Sider ukjent status | 3 | Manuell verifisering |
| Legacy sider (koordinert migrering) | 3 | Fase 5-6 |
| Aktive API-routes | ~45 | Behold |
| Døde API-routes | 14 | Slett i Fase 1 |
| Dev/test routes | 5 | Slett/gate i Fase 1 |
| Legacy lib-filer | 5 | Slett i Fase 3-4 |
| Duplikate systemer | 3 kritiske | Fix i Fase 2-3 |
| Legacy Supabase-tabeller | 4 | Fase 4 |
| Fil-baserte routes (Vercel-advarsel) | 7 aktive | Fase 5 (migrering) |

**Forventet resultat etter opprydding:**
- ~35 færre filer
- Tydeligere ansvarsgrenser mellom systemer
- Riktig thumbnail-generator i bruk
- Ett lærings-system (learningAggregator)
- Ett community-system (community-intelligence)
- Ingen skjult duplikasjon

---

*Audit utført: 2026-06-08*  
*Neste steg: Gjennomfør Fase 1 (trygg sletting) — ingen aktive systemer berøres.*
