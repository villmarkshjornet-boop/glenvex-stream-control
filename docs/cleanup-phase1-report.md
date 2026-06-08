# GLENVEX — Cleanup Phase 1 Report

**Dato:** 2026-06-08  
**Utført av:** Claude Code  
**Basert på:** pre-cleanup-verification.md + source-of-truth-audit.md  
**Status:** FULLFØRT ✓

---

## Sammendrag

| Kategori | Fjernet |
|----------|---------|
| Sider | 22 |
| API-routes | 17 |
| Komponenter | 5 |
| Bot-filer | 1 |
| Scripts | 1 |
| **Totalt** | **46 filer** |
| Linjer fjernet | ~4 983 |

---

## Slettet

### Sider (22)

| Fil | Årsak |
|-----|-------|
| `src/app/ai-assistent/page.tsx` | Ingen nav-lenke. Erstattet av dashboard QuickActions. |
| `src/app/ai-command-center/page.tsx` | Ingen nav-lenke. File-basert, erstattet av dashboard. |
| `src/app/clips/page.tsx` | Ingen nav-lenke. Duplikat av /clip-factory. |
| `src/app/community-memory/page.tsx` | Ingen nav-lenke. Erstattet av community-intelligence (Supabase). |
| `src/app/content-factory-admin/analytics/page.tsx` | Ingen nav-lenke. CF-admin har egen stats-visning. |
| `src/app/discord-control/page.tsx` | Ingen nav-lenke. Erstattet av /discord + /innstillinger. |
| `src/app/discord-library/page.tsx` | Ingen nav-lenke. Erstattet av /innhold/publisering. |
| `src/app/event-generator/page.tsx` | Ingen nav-lenke. Route også slettet. |
| `src/app/glencoins/page.tsx` | Ingen nav-lenke. File-basert, ikke koblet til community_members. |
| `src/app/highlights/page.tsx` | Ingen nav-lenke. Erstattet av content-factory-admin/highlights. |
| `src/app/kanal-innstillinger/page.tsx` | Ingen nav-lenke. Dekket av /innstillinger. |
| `src/app/kommandoer/page.tsx` | Ingen nav-lenke. Statisk liste uten aktiv funksjonalitet. |
| `src/app/live-overvaking/page.tsx` | Ingen nav-lenke. Dashboard dekker live-status. |
| `src/app/markedsforing/page.tsx` | Ingen nav-lenke. AI-promo route er aktiv, men siden er dead. |
| `src/app/merch/page.tsx` | Ingen nav-lenke. Route også slettet. |
| `src/app/polls/page.tsx` | Ingen nav-lenke. Route også slettet. |
| `src/app/pre-live/page.tsx` | Ingen nav-lenke. Ingen aktive lenker inn. |
| `src/app/role-manager/page.tsx` | Ingen nav-lenke. Bot håndterer roller automatisk. |
| `src/app/setup-wizard/page.tsx` | Ingen nav-lenke. Erstattet av /innstillinger. |
| `src/app/system-health/page.tsx` | Ingen nav-lenke. Dashboard + /innstillinger dekker dette. |
| `src/app/systemstatus/page.tsx` | Ingen nav-lenke. Duplikat av system-health (som også er slettet). |
| `src/app/xp-system/page.tsx` | Ingen nav-lenke. Dokumentasjonsside uten aktiv funksjonalitet. |

### API-routes (17)

| Fil | Årsak |
|-----|-------|
| `src/app/api/ai-command-center/route.ts` | Kun slettet side kalte den. File-basert. |
| `src/app/api/ai-scores/route.ts` | Ingen aktive callers funnet. File-basert. |
| `src/app/api/community-memory/route.ts` | Kun slettet side kalte den. File-basert. |
| `src/app/api/community-memory/insights/route.ts` | Kun slettet side. Del av community-memory mappen. |
| `src/app/api/content-plan/route.ts` | Kun slettet discord-control side kalte den. |
| `src/app/api/events/generate/route.ts` | Kun slettet event-generator side kalte den. |
| `src/app/api/glencoins/route.ts` | Kun slettet glencoins side. File-basert. |
| `src/app/api/highlights/route.ts` | Kun slettet highlights side. Erstattet av content-factory pipeline. |
| `src/app/api/merch/route.ts` | Kun slettet merch side. File-basert. |
| `src/app/api/polls/route.ts` | Kun slettet polls side. File-basert. |
| `src/app/api/pre-live/route.ts` | Kun slettet pre-live side. Stateless Discord-posting. |
| `src/app/api/role-manager/route.ts` | Kun slettet role-manager side. |
| `src/app/api/role-manager/assign/route.ts` | Del av role-manager mappen. |
| `src/app/api/role-rules/route.ts` | Kun slettet role-manager side. |
| `src/app/api/clips-queue/route.ts` | Kun slettet clips side. File-basert. |
| `src/app/api/bot-rapport/route.ts` | Ingen aktive callers. Leste log-fil. |
| `src/app/api/ai-memory/test/route.ts` | Dev/test-route. Verifisering ferdig. |
| `src/app/api/channel-settings/debug/route.ts` | Debug-dump. Ingen aktiv bruk. |

### Komponenter (5)

| Fil | Årsak |
|-----|-------|
| `src/components/LiveStatusCard.tsx` | Kun importert av slettet live-overvaking side. |
| `src/components/LogsPreview.tsx` | Null imports i hele kodebasen. |
| `src/components/StatsCards.tsx` | Null imports i hele kodebasen. |
| `src/components/SystemStatusCard.tsx` | Null imports i hele kodebasen. |
| `src/components/ConfigPanel.tsx` | Null imports i hele kodebasen. |

### Bot-filer (1)

| Fil | Årsak |
|-----|-------|
| `bot/lib/rpIntelligence.ts` | Null imports i bot/ og src/. Funksjonalitet duplisert i /api/rp-notes direkte. |

### Scripts (1)

| Fil | Årsak |
|-----|-------|
| `scripts/test-ai-memory.ts` | Dev/test-script. ai_agent_*-tabeller bekreftet aktive. Utdatert. |

---

## Beholdt (vurdert men ikke fjernet)

| Fil | Grunn til å beholde |
|-----|---------------------|
| `src/app/overlay/goals/page.tsx` | OBS Browser Source. Genereres av viewer-goals/page.tsx. |
| `src/app/api/events/route.ts` | Kalles av statistikk/page.tsx (aktiv nav-side). |
| `src/app/api/content-factory/phase2/route.ts` | Kalles fra 2 aktive nav-sider (CF admin). |
| `bot/lib/thumbnailGenerator.ts` | Worker-infrastruktur for V2. Delegerer til V2 internt (linje 624). |
| `src/lib/contentLibrary.ts` | 4 aktive nav-sider bruker den. LEGACY men aktiv. |
| `src/lib/botMemory.ts` | /innstillinger og /partner-hub bruker den. Aktiv. |
| `src/lib/rpCharacters.ts` | Importert av rp-characters route (koordinert sletting med RP-sider). |
| `src/app/rp-*/` (3 sider) | Ikke i nav, men aktiv funksjonalitet. Utsatt til fremtidig beslutning. |
| Alle 4 legacy ai_producer_* tabeller | Sunset pågår — skriving stoppes etter 2026-06-14. |
| `src/lib/content-factory/ai-producer/learningLoop.ts` | Aktiv via phase2 (nav). Planlagt refaktorering etter 2026-06-14. |

---

## Dead href-referanser fikset

Fem aktive filer hadde hrefs som pekte til slettede sider. Disse ble oppdatert som del av cleanup:

| Fil | Endring |
|-----|---------|
| `src/app/team/page.tsx` | Fjernet 3 items (live-overvaking, discord-control, pre-live) + 1 knapp (system-health) |
| `src/app/twitch/page.tsx` | Fjernet live-overvaking fra VERKTOY + inline link i live-stream-kort |
| `src/app/page.tsx` | Fjernet pre-live fra hurtiglenker, grid endret fra 7 til 6 kolonner |
| `src/app/api/dashboard/live/route.ts` | Oppdatert `/pre-live` → `/streamplan`, `/live-overvaking` → `/` (2 steder) |
| `src/app/api/dashboard/route.ts` | Oppdatert `/pre-live` → `/streamplan`, `/live-overvaking` → `/` |

---

## Build Status

```
✓ Compiled successfully
✓ Linting and checking validity of types
✓ Generating static pages (34/34)
✓ Build completed without errors or warnings
```

**Feil:** 0  
**Warnings:** 0  
**Brutte imports:** 0 (etter cache-clearing av .next/)

---

## Repo Impact

| Metric | Verdi |
|--------|-------|
| Filer fjernet | 46 |
| Sider fjernet | 22 |
| API-routes fjernet | 17 (18 route.ts-filer inkl. assign) |
| Komponenter fjernet | 5 |
| Bot-filer fjernet | 1 |
| Scripts fjernet | 1 |
| Linjer fjernet | ~4 983 |
| Linjer lagt til (href-fikser) | ~0 netto |
| Build output: statiske sider | 34 (fra ~56) |

---

## Railway Bot Verifikasjon

Alle kritiske Railway-filer bekreftet intakt etter cleanup:

| Fil | Status |
|-----|--------|
| `bot/index.ts` | ✓ Intakt |
| `bot/lib/twitchBot.ts` | ✓ Intakt |
| `bot/lib/memberTracker.ts` | ✓ Intakt |
| `bot/lib/learningAggregator.ts` | ✓ Intakt |
| `bot/lib/agentLogger.ts` | ✓ Intakt |
| `bot/lib/clipWorker.ts` | ✓ Intakt |
| `bot/lib/thumbnailGenerator.ts` | ✓ Intakt |
| `bot/lib/thumbnailBuilderV2.ts` | ✓ Intakt |
| `bot/lib/recoveryEngine.ts` | ✓ Intakt |
| `bot/lib/crossPlatformContext.ts` | ✓ Intakt |

---

## Menyverifikasjon

| Seksjon | Status |
|---------|--------|
| Dashboard (/) | ✓ Hurtiglenker oppdatert — pre-live fjernet, /streamplan og /discord er gyldige |
| Twitch | ✓ live-overvaking fjernet fra VERKTOY og live-stream-kort |
| Discord (/discord) | ✓ Ingen endringer nødvendig — siden er aktiv |
| Community | ✓ Uberørt |
| Content Factory | ✓ Analytics-subside fjernet, highlights+jobs+qa intakt |
| AI Producer | ✓ Uberørt |
| Sponsor Manager | ✓ Uberørt |
| Settings (/innstillinger) | ✓ Uberørt |
| Team-side | ✓ 3 dead items fjernet fra seksjons-lister + system-health-knapp fjernet |

---

## Risiko og oppfølgingspunkter

| Punkt | Type | Anbefaling |
|-------|------|------------|
| `/api/ai/promo` kalles av `markedsforing/page.tsx` som nå er slettet | Lav | Route er fortsatt aktiv og kan brukes av andre. Ingen tiltak nødvendig. |
| `/api/live/diagnostics` er debug-route med sensitiv info | Medium | Vurder å gate bak `NODE_ENV !== 'production'` i Fase 5. |
| RP-sider (rp-manager, rp-vault, rp-intelligence) er ikke i nav | Lav | Bestem fremtid: legg til i nav eller slett koordinert med rpCharacters.ts + rp-routes. |
| File-based writes (contentLibrary, botMemory, moderation, streamplan) | Medium | Fase 5: migrering til Supabase, én route om gangen. |

---

## Neste steg

| Fase | Betingelse | Innhold |
|------|------------|---------|
| **Fase 3** | Etter 2026-06-14 | Fjern `ai_producer_community_memory`-skriving i learningLoop.ts:181 |
| **Fase 4** | Etter Fase 3 | Fjern `ai_producer_knowledge`-fallback i creatorContext.ts:87 |
| **Fase 5** | Langsiktig | Migrer file-based routes til Supabase (contentLibrary, botMemory, moderation, streamplan) |
| **Fase 6** | Etter beslutning | RP-system: legg til i nav eller slett koordinert |

---

*Cleanup Phase 1 fullført: 2026-06-08*
