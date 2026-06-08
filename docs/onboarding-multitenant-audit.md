# GLENVEX Creator OS — Onboarding & Multi-Tenant Readiness Audit

**Dato:** 2026-06-08  
**Formål:** Kartlegge nøyaktig hva som skal til for at en ny streamer kan onboardes uten manuell utviklerhjelp.  
**Regel:** Ingen kodeendringer. Kun dokumentasjon.

---

## 1. Executive Summary

GLENVEX Creator OS er **funksjonelt klar for én streamer** men er ikke multi-tenant. Systemet er delvis forberedt — databasen har `workspace_id` på alle tabeller, og `getWorkspaceId()` fungerer som abstraksjonsbarriere — men kritiske deler er hardkodet til Glenn sin Twitch-konto, Discord-server og brukernavn.

**Gjeldende arkitektur:** One-instance-one-streamer. Ny streamer = ny Railway-deployment + nytt Vercel-prosjekt + ny `.env`.

**Vei til alpha (3-5 streamere):** Krever bare ny deployment per streamer + manuell Supabase-rad. Ingen kodeendringer nødvendig for dette nivået.

**Vei til ekte multi-tenant:** Krever Twitch OAuth, Discord OAuth, auth-system, og bot-redesign for multiple workspaces. 4-6 sprinters.

---

## 2. Hardkodede Verdier

### 2.1 Workspace ID

`glenvex-default` er hardkodet i **20 filer**. De fleste bruker env-fallback, men to filer mangler env-støtte helt:

| Fil | Linje | Type | Problem |
|-----|-------|------|---------|
| `bot/lib/supabase.ts` | 14 | **HARDKODET — ingen env** | `export const WORKSPACE_ID = 'glenvex-default'` — null env-override mulig |
| `bot/lib/memberTracker.ts` | 5 | **HARDKODET — ingen env** | `const WORKSPACE_ID = 'glenvex-default'` — all XP-tracking til feil workspace |
| `src/lib/workspace.ts` | 23 | env-fallback | `process.env.WORKSPACE_ID ?? 'glenvex-default'` |
| `bot/lib/agentLogger.ts` | 7 | env-fallback | `process.env.WORKSPACE_ID \|\| 'glenvex-default'` |
| `bot/lib/aiPersonality.ts` | 100 | env-fallback | `process.env.WORKSPACE_ID \|\| 'glenvex-default'` |
| `bot/lib/botEvents.ts` | 3 | env-fallback | `process.env.WORKSPACE_ID \|\| 'glenvex-default'` |
| `bot/lib/botKanalPreferanser.ts` | 3 | env-fallback | `process.env.WORKSPACE_ID ?? 'glenvex-default'` |
| `bot/lib/crossPlatformContext.ts` | 13 | env-fallback | `process.env.WORKSPACE_ID \|\| 'glenvex-default'` |
| `bot/lib/learningAggregator.ts` | 14 | env-fallback | `process.env.WORKSPACE_ID \|\| 'glenvex-default'` |
| `bot/lib/partnerHelper.ts` | 12 | env-fallback | `process.env.WORKSPACE_ID \|\| 'glenvex-default'` |
| `bot/lib/recoveryEngine.ts` | 4 | env-fallback | `process.env.WORKSPACE_ID ?? 'glenvex-default'` |
| `bot/lib/systemEvents.ts` | 14 | env-fallback | `process.env.WORKSPACE_ID ?? 'glenvex-default'` |
| `bot/lib/thumbnailGenerator.ts` | 264 | env-fallback | `process.env.WORKSPACE_ID \|\| 'glenvex-default'` |
| `bot/lib/twitchBot.ts` | 225 | env-fallback | `process.env.WORKSPACE_ID \|\| 'glenvex-default'` |
| `bot/index.ts` | 662 | env-fallback | `process.env.WORKSPACE_ID \|\| 'glenvex-default'` |
| `src/app/api/ai-producer/route.ts` | 43, 48 | **DIREKTE HARDKODET** | `.eq('workspace_id', 'glenvex-default')` — ignorerer getWorkspaceId() |
| `src/app/api/stream-history/route.ts` | 15 | **DIREKTE HARDKODET** | `.eq('workspace_id', 'glenvex-default')` |
| `src/app/api/content-factory/download/route.ts` | 26 | **DIREKTE HARDKODET** | `.eq('workspace_id', 'glenvex-default')` |

**Kritisk:** De to filene uten env-fallback (`supabase.ts` og `memberTracker.ts`) vil skrive all data til `glenvex-default` uansett WORKSPACE_ID-verdien satt i env.

### 2.2 Streamer-navn / `owner_user_id`

`'glenvex'` som `owner_user_id` er hardkodet på **7 steder** — brukes ved opprettelse av workspace hvis raden ikke eksisterer:

| Fil | Linje | Verdi |
|-----|-------|-------|
| `src/lib/workspace.ts` | 32 | `owner_user_id: 'glenvex'` |
| `src/app/api/channel-settings/route.ts` | 78–81 | `owner_user_id: 'glenvex'`, `streamer_name: env ?? 'glenvex'` |
| `src/app/api/streamplan/route.ts` | 53–56 | `owner_user_id: 'glenvex'`, `streamer_name: env ?? 'glenvex'` |
| `src/lib/discordMessages.ts` | 69–72 | `owner_user_id: 'glenvex'`, `streamer_name: env ?? 'glenvex'` |
| `src/lib/partners.ts` | 71–74 | `owner_user_id: 'glenvex'`, `streamer_name: env ?? 'glenvex'` |
| `src/lib/settings.ts` | 11 | `twitchUsername: process.env.TWITCH_USERNAME \|\| 'glenvex'` |
| `bot/commands/promo.ts` | 17 | `userName: 'glenvex'` — **hardkodet, ingen env** |

### 2.3 Twitch-brukernavn som fallback

`TWITCH_USERNAME` brukes riktig med env, men `'glenvex'` er alltid default:

| Fil | Bruker |
|-----|--------|
| `src/lib/twitch.ts` | `process.env.TWITCH_USERNAME \|\| 'glenvex'` (linjer 58, 108) |
| `src/app/api/ai/promo/route.ts` | `process.env.TWITCH_USERNAME \|\| 'glenvex'` |
| `src/app/api/discord/test-live/route.ts` | `process.env.TWITCH_USERNAME \|\| 'glenvex'` |
| `src/app/api/live/diagnostics/route.ts` | `process.env.TWITCH_USERNAME \|\| 'glenvex'` |
| `src/app/api/live/force-notify/route.ts` | `process.env.TWITCH_USERNAME \|\| 'glenvex'` |
| `bot/lib/twitchBot.ts` | `KANAL = process.env.TWITCH_USERNAME?.toLowerCase() \|\| 'glenvex'` |

**Disse er OK for alpha** — sett env, fungerer. Problem ved multi-tenant (én instans, mange streamere).

### 2.4 Hardkodet admin-brukernavn

| Fil | Linje | Verdi | Problem |
|-----|-------|-------|---------|
| `bot/index.ts` | 1109–1116 | `'gkarlsen'` | Funksjon `sikkerAdminTilGkarlsen()` — tildeler admin-rolle til brukernavn 'gkarlsen' på Discord. Kjører ved bot-start. |
| `bot/lib/aiPersonality.ts` | (linje ~21, 43) | `'gkarlsen'` | Hardkodet i AI-system-prompt som streamer/eier |
| `src/app/api/stream-briefing/route.ts` | 88 | `Glenn Ove Karlsen` | Hardkodet navn i GPT-prompt |

### 2.5 Hardkodet Discord-kanal ID

| Fil | Linje | Verdi | Problem |
|-----|-------|-------|---------|
| `bot/index.ts` | 1084 | `'1511722714623381645'` | `STATUS_KANAL_ID` — hardkodet kanal-ID for bot-status-meldinger |

### 2.6 Storage Bucket

`'glenvex-assets'` hardkodet i **12 filer**:

| Fil | Kontekst |
|-----|----------|
| `bot/lib/clipWorker.ts` | Linje 120, 126 |
| `bot/lib/thumbnailBuilderV2.ts` | Linje 393, 398 |
| `bot/lib/thumbnailGenerator.ts` | Linje 318 |
| `src/app/api/content-factory/thumbnail/[highlightId]/route.ts` | Linje 90, 95 |
| `src/app/api/content-factory/thumbnails/generate/route.ts` | Linje 131, 136 |
| `src/app/api/content-factory/health/route.ts` | Linje 39 |
| `src/app/api/content-factory/[vodId]/route.ts` | Linje 57 |
| `src/lib/content-factory/storage/storageService.ts` | Linje 51, 55, 79 |
| `src/app/content-factory-admin/highlights/page.tsx` | Zip-filnavn: `glenvex_highlight_...` |

**For alpha:** Én bucket per deployment fungerer. For multi-tenant: prefiks-basert (`{workspace_id}/`) eller separat bucket per workspace.

### 2.7 Discord invite URL

| Fil | Linje | Verdi |
|-----|-------|-------|
| `bot/lib/twitchBot.ts` | 13 | `process.env.DISCORD_INVITE_URL \|\| 'https://discord.gg/glenvex'` |

Env-override finnes. OK for alpha — sett `DISCORD_INVITE_URL` per deployment.

---

## 3. Workspace-modell

### Hva finnes

**`workspaces`-tabell er implementert** med kolonnene:

```
id, owner_user_id, streamer_name, brand_name,
twitch_channel_id, twitch_channel_name,
discord_guild_id, discord_guild_name,
live_channel_id, promo_channel_id, clips_channel_id, partner_channel_id,
bot_personality, plan, settings_json, created_at, updated_at
```

`settings_json` (JSONB) lagrer:
- `twitchUsername`, `twitchUrl`, sosiale medier-linker
- `kanalPreferanser` (live, announce, chat, clips, partner, streamplan, events, subs, pre_hype, raid, ai_producer, content_factory, errors)
- Streamplan-data, viewer-goals, streamplan-state

**`getWorkspaceId()`** returnerer `process.env.WORKSPACE_ID ?? 'glenvex-default'` — konstant per deploymentinstans. Ingen request-level workspace-switching.

### Routes som bruker getWorkspaceId() korrekt (24+)

Dashboard, members, community-intelligence, ai-memory, streamplan, channel-settings, bot-settings, settings, content-factory (alle), sponsor-report, stream-briefing, goals, partners, og flere.

### Routes som ignorerer workspace (hardkodet)

| Route | Problem |
|-------|---------|
| `/api/ai-producer` | `.eq('workspace_id', 'glenvex-default')` direkte |
| `/api/stream-history` | `.eq('workspace_id', 'glenvex-default')` direkte |
| `/api/content-factory/download` | `.eq('workspace_id', 'glenvex-default')` direkte |

### Kan systemet støtte flere workspaces i dag?

**Nei** — men med minimal innsats kan det støtte **én workspace per deployment**:

| Komponent | Multi-tenant klar? |
|-----------|-------------------|
| Supabase-tabeller | ✓ Alle har workspace_id |
| getWorkspaceId() abstraksjonen | ✓ Fungerer per instans |
| 3 routes med hardkodet workspace | ✗ Enkle 3-linjers fiks |
| bot/lib/supabase.ts | ✗ Trenger én env-linje |
| bot/lib/memberTracker.ts | ✗ Trenger én env-linje |
| bot guild-seleksjon | ✗ `guilds.cache.first()` |
| Twitch-kanal monitoring | ✗ Én kanal per bot-instans |

---

## 4. Twitch Readiness

### Hva finnes

| Funksjon | Status |
|----------|--------|
| Twitch API client | ✓ `src/lib/twitch.ts` — client_credentials grant |
| Live-sjekk | ✓ `getStreamInfo()`, `getBroadcasterId()` |
| VOD-oppslag | ✓ via Helix API |
| Sub/raid-tracking | ✓ `bot/lib/twitchBot.ts` via tmi.js |
| Raid-targets | ✓ `/api/raid-targets` — Helix API |
| Clips | ✓ Helix `/clips` endpoint |
| Chat-bot | ✓ tmi.js med TWITCH_BOT_OAUTH |
| Follower-sjekk | ✓ Helix `/channels/followers` |

### Hva mangler

| Funksjon | Gap |
|----------|-----|
| **Twitch OAuth** | ✗ Finnes ikke. Bruker statisk `TWITCH_USER_OAUTH` i env. |
| Token refresh | ✗ Ingen automatisk token-refresh |
| EventSub | ✗ Bruker tmi.js (WebSocket IRC), ikke EventSub. Ingen per-streamer subscriptions. |
| Broadcaster ID per workspace | ✗ `getBroadcasterId()` bruker `process.env.TWITCH_USERNAME` — global |
| Scopes management | ✗ Ingen scope-liste dokumentert |

### Nødvendige Twitch-scopes

For full funksjonalitet:

```
# Read-only (kan bruke App Token — ingen bruker-OAuth nødvendig)
streams:read         — live-deteksjon
clips:read           — clips
videos:read          — VODs

# Krever User OAuth (streamer autoriserer)
channel:read:subscriptions   — sub-count/sub-events
channel:read:redemptions     — channel point redemptions  
bits:read                    — bits events
moderator:read:followers      — follower count (ny API)
chat:read                    — lese chat (kan bruke bot-token)
chat:edit                    — skrive i chat (bot-token)
```

### Routes som er hardkodet til én Twitch

| Route | Problem |
|-------|---------|
| `/api/twitch/live` | Bruker `process.env.TWITCH_USERNAME` — OK med env, ikke OK multi-tenant |
| `/api/twitch/growth` | Samme |
| `/api/raid-targets` | Leser `TWITCH_USERNAME` og `TWITCH_CLIENT_ID/SECRET` fra env |
| `/api/cron/check-live` | Sjekker én hard-definert kanal |
| `bot/lib/twitchBot.ts` | `KANAL = env.TWITCH_USERNAME \|\| 'glenvex'` — én kanal per bot-instans |

---

## 5. Discord Readiness

### Hva finnes

| Funksjon | Status |
|----------|--------|
| Discord bot (Railway) | ✓ Fungerer for én server |
| Kanal-preferanser | ✓ Lagres i `workspaces.settings_json.kanalPreferanser` |
| `/api/discord/channels` | ✓ Henter kanaler fra Discord API |
| Role assignment | ✓ `bot/lib/roleManager.ts` |
| Guild Members Intent | ✓ Konfigurert i bot |
| Message Content Intent | ✓ Konfigurert |
| Voice State tracking | ✓ `memberTracker.ts` |
| Live-varsling | ✓ Automatisk ved live-deteksjon |

### Hva mangler

| Funksjon | Gap |
|----------|-----|
| **Discord OAuth** | ✗ Finnes ikke. Guild ID er static env var. |
| Server/guild velger-UI | ✗ Finnes ikke |
| Bot-invite flow | ✗ Hardkodet invite URL (`https://discord.gg/glenvex`) |
| Permissions-verifisering | ✗ Ingen automatisk sjekk ved oppsett |
| Multi-guild bot support | ✗ Bot bruker `guilds.cache.first()` |

### Hardkodet til Glenn sin Discord

| Fil | Verdi | Problem |
|-----|-------|---------|
| `bot/index.ts:1084` | `'1511722714623381645'` | STATUS_KANAL_ID — hardkodet kanal-ID |
| `bot/index.ts:1109–1116` | `'gkarlsen'` | Admin-tildeling ved bot-start |
| `.env` | `DISCORD_GUILD_ID=792407451466203136` | Globalt i env |
| `.env` | `DISCORD_LIVE_CHANNEL_ID=792429261852114954` | Globalt i env |
| `.env` | `DISCORD_LIVE_ROLE_ID=1511722718490529972` | Globalt i env |

### Påkrevde Discord-permissions for bot

```
# Bot permissions integer: 8 (Administrator) eller finkornet:
Manage Roles          — role assignment
Send Messages         — varsling i kanaler
Embed Links           — live-varslinger med embed
Attach Files          — clip-posting
Use Slash Commands    — slash commands
Read Message History  — kontekstuell AI
View Channel          — lese alle kanaler
Manage Messages       — moderasjon (valgfritt)
Voice permissions     — voice state tracking

# Gateway Intents:
GUILD_MEMBERS         — for memberTracker
MESSAGE_CONTENT       — for AI-analyse av meldinger
GUILD_VOICE_STATES    — for voice tracking
```

### Env-vars som må bli database-config

| Env-var | Hvor det hører hjemme |
|---------|-----------------------|
| `DISCORD_GUILD_ID` | `workspaces.discord_guild_id` — finnes allerede i schema |
| `DISCORD_LIVE_CHANNEL_ID` | `workspaces.live_channel_id` — finnes i schema |
| `DISCORD_CHAT_CHANNEL_ID` | `workspaces.settings_json.kanalPreferanser.chat` |
| `DISCORD_ANNOUNCE_CHANNEL_ID` | `workspaces.settings_json.kanalPreferanser.announce` |
| `DISCORD_LIVE_ROLE_ID` | `workspaces.settings_json.kanalPreferanser.live_role` |

---

## 6. Bot Multi-Tenant Readiness

### Gjeldende design: single-guild, single-channel

Boten er designet for **én Discord-server og én Twitch-kanal** per Railway-instans:

| Problem | Fil | Linje | Detalj |
|---------|-----|-------|--------|
| `guilds.cache.first()` | `bot/index.ts` | 434, 1087, 1106 | Hardkodet første guild — faller om boten er med i flere |
| `KANAL = env.TWITCH_USERNAME` | `bot/lib/twitchBot.ts` | 14 | Kun én Twitch-kanal overvåkes |
| Ingen workspace-routing | `bot/lib/twitchBot.ts` | — | Alle events går til én workspace |
| `WORKSPACE_ID` hardkodet | `bot/lib/supabase.ts` | 14 | Ingen env-override mulig |
| `WORKSPACE_ID` hardkodet | `bot/lib/memberTracker.ts` | 5 | All XP til ett workspace |
| Admin-hardkoding | `bot/index.ts` | 1109–1116 | `sikkerAdminTilGkarlsen()` kjører alltid |
| Status-kanal hardkodet | `bot/index.ts` | 1084 | `STATUS_KANAL_ID = '1511722714623381645'` |

### Kan boten støtte flere workspaces?

**Ikke i nåværende form.** Arkitekturen er én-til-én:

```
Railway instans
├── ENV: WORKSPACE_ID = 'streamer-123'
├── ENV: TWITCH_USERNAME = 'streamer123'
├── ENV: DISCORD_GUILD_ID = '...'
└── Bot → overvåker én kanal, én guild, skriver til én workspace
```

For alpha: **én Railway-instans per streamer** er riktig tilnærming.

### For fremtidig multi-tenant bot

Bot ville trenge:
1. Workspace-config lastet fra Supabase ved oppstart (en rad per workspace)
2. Twitch: `tmi.js`-klient per kanal eller EventSub-basert mottak
3. Discord: guild→workspace mapping for alle events
4. Fjerne hardkodet admin-funksjon
5. Gjøre STATUS_KANAL_ID per-workspace konfigurerbar

---

## 7. Database Multi-Tenant Readiness

| Tabell | workspace_id | user_id | Kan skilles | RLS | Risiko |
|--------|:---:|:---:|:---:|:---:|--------|
| `community_members` | ✓ | ✗ | ✓ | Ukjent | Lav — workspace_id på alle queries |
| `stream_history` | ✓ | ✗ | ✓ | Ukjent | Lav |
| `ai_agent_memory` | ✓ | ✗ | ✓ | Ukjent | Lav |
| `ai_agent_events` | ✓ | ✗ | ✓ | Ukjent | Lav |
| `ai_agent_decisions` | ✓ | ✗ | ✓ | Ukjent | Lav |
| `ai_agent_insights` | ✓ | ✗ | ✓ | Ukjent | Lav |
| `content_vods` | ✓ | ✗ | ✓ | Ukjent | Lav |
| `content_highlights` | ✓ | ✗ | ✓ | Ukjent | Lav |
| `system_events` | ✓ | ✗ | ✓ | Ukjent | Lav |
| `partners` | ✓ | ✗ | ✓ | Ukjent | Lav |
| `cross_platform_users` | ✓ | ✗ | ✓ | Ukjent | Lav |
| `workspaces` | ✓ (PK) | owner_user_id (tekst) | ✓ | Ukjent | Medium |

**Konklusjon:** Databasen er multi-tenant ready på radnivå. Alle tabeller har `workspace_id`. Isolation avhenger av at koden filtrerer riktig — ingen RLS-håndhevelse er verifisert, men RLS er ikke nødvendig for alpha (én instans = én workspace).

**Eneste risiko:** 3 routes som hardkoder `'glenvex-default'` — disse ville lekke data mellom workspaces. Enkle enkeltlinjers fiks.

**Storage bucket:** `glenvex-assets` er én global bucket. For isolasjon: bruk `{workspace_id}/`-prefiks på filstier — dette er allerede delvis i bruk. Full isolasjon krever bucket-per-workspace eller Supabase Storage policies.

---

## 8. Env-Vars Klassifisering

### Global (kan forbli global)

Disse er infrastruktur-nøkler som er like for alle workspaces på en instans:

| Env-var | Brukes av | Kommentar |
|---------|-----------|-----------|
| `SUPABASE_URL` | Alt | Delt database-tilkobling |
| `SUPABASE_SERVICE_ROLE_KEY` | Alt | Delt admin-nøkkel |
| `OPENAI_API_KEY` | 28 steder | En global AI-nøkkel |
| `DISCORD_BOT_TOKEN` | Bot + API | Én global bot-token (multi-tenant krever deling) |
| `TWITCH_CLIENT_ID` | 25 steder | App-registrering er global |
| `TWITCH_CLIENT_SECRET` | 11 steder | App-registrering er global |
| `CRON_SECRET` | 1 sted | Infrastruktur-hemmelighet |
| `NEXT_PUBLIC_APP_URL` / `VERCEL_URL` | Bot + API | Basis-URL per deployment |
| `PORT` | Bot | Server-port |
| `CONTENT_FACTORY_ENABLED` | Bot | Feature flag |
| `BOT_API_URL` | Vercel → Bot | Intern kommunikasjon |
| `ADMIN_PASSWORD` | Auth-gate | Midlertidig — bør bli auth |

### Per Workspace (må flyttes til database)

Disse er streamer-spesifikke og må lagres i `workspaces`-tabellen:

| Env-var | Hvor hører det hjemme | Kolonne finnes? |
|---------|-----------------------|:---:|
| `TWITCH_USERNAME` | `workspaces.twitch_channel_name` | ✓ |
| `TWITCH_URL` | Beregnet fra `twitch_channel_name` | Ikke nødvendig |
| `TWITCH_USER_OAUTH` | Ny kolonne: `workspaces.twitch_access_token` | ✗ |
| `TWITCH_BOT_OAUTH` | Ny kolonne: `workspaces.twitch_bot_token` | ✗ |
| `TWITCH_BOT_USERNAME` | Ny kolonne: `workspaces.twitch_bot_username` | ✗ |
| `DISCORD_GUILD_ID` | `workspaces.discord_guild_id` | ✓ |
| `DISCORD_LIVE_CHANNEL_ID` | `workspaces.live_channel_id` | ✓ |
| `DISCORD_CHAT_CHANNEL_ID` | `workspaces.settings_json.kanalPreferanser.chat` | ✓ |
| `DISCORD_ANNOUNCE_CHANNEL_ID` | `workspaces.settings_json.kanalPreferanser.announce` | ✓ |
| `DISCORD_LIVE_ROLE_ID` | `workspaces.settings_json.kanalPreferanser.live_role` | ✗ ny nøkkel |
| `WORKSPACE_ID` | Generert automatisk ved onboarding | N/A |
| `NEXT_PUBLIC_APP_NAME` | `workspaces.brand_name` | ✓ |
| `DISCORD_INVITE_URL` | `workspaces.settings_json.discordInviteUrl` | ✗ ny nøkkel |

**Manglende kolonner i `workspaces`-tabellen:**

```sql
-- Kreves for full Twitch-onboarding
twitch_access_token   TEXT    -- user OAuth token
twitch_refresh_token  TEXT    -- for token refresh
twitch_token_expires  TIMESTAMPTZ
twitch_bot_token      TEXT    -- bot chat token
twitch_bot_username   TEXT    -- bot username
twitch_broadcaster_id TEXT    -- cached broadcaster_id
```

---

## 9. Onboarding-flow (papirdesign)

### Ideell selvbetjent flow

```
Steg 1: Registrering
├── Finnes ikke — ingen auth-system
├── Krever: email/password ELLER Twitch SSO
└── Gap: Auth-system (NextAuth, Clerk, eller Supabase Auth)

Steg 2: Koble Twitch
├── Finnes ikke — bruker statisk TWITCH_USER_OAUTH i .env
├── Krever: Twitch OAuth redirect → callback → token lagret i workspaces
├── Route trengs: GET /api/auth/twitch → POST /api/auth/twitch/callback
└── Gap: OAuth flow + token-lagring + refresh-mekanisme

Steg 3: Koble Discord
├── Finnes ikke — bruker DISCORD_GUILD_ID i .env
├── Krever: Discord OAuth + guild-velger UI
├── Route trengs: GET /api/auth/discord → POST /api/auth/discord/callback
└── Gap: OAuth flow + guild-seleksjon

Steg 4: Inviter boten til serveren
├── Finnes delvis — bot-invite URL eksisterer
├── Status: hardkodet til glenvex sin Discord
├── Krever: generert invite URL med workspace-parametere
└── Gap: invite URL generert per workspace + velg-server-UI

Steg 5: Verifiser bot-permissions
├── Finnes ikke
├── Krever: sjekk at bot har nødvendige permisjoner i guild
├── Route trengs: GET /api/setup/verify-discord
└── Gap: permissions-check + tydelig feilmelding

Steg 6: Velg Discord-kanaler
├── Finnes delvis — /api/discord/channels henter kanaler
├── Finnes: channel-settings route med kanalPreferanser
├── Finnes: innstillinger-side lar brukeren konfigurere
└── Gap: visuell kanal-velger i en onboarding-wizard-form

Steg 7: Sett Twitch-konfig
├── Finnes: innstillinger-side med twitchUsername, twitchUrl
└── Gap: auto-populering fra Twitch OAuth-data

Steg 8: Sett streamplan
├── Finnes: /streamplan
└── Ingen gap — fungerer allerede per workspace

Steg 9: Test live-varsling
├── Finnes: /api/discord/test-live
└── Ingen gap — fungerer hvis kanal er satt

Steg 10: Dashboard klar
├── Finnes: Dashboard viser system-status
└── Ingen gap — fungerer allerede
```

### Per steg — hva kan feile

| Steg | Typisk feil | Synlighet i dag |
|------|-------------|-----------------|
| Twitch OAuth | Token expired, feil scopes | Stille feil — returns empty data |
| Discord invite | Bot ikke invitert | Dashboard viser "Discord: Offline" |
| Bot-permissions | Mangler Manage Roles | Role assignment feiler stille |
| Kanalvalg | Feil kanal-ID | Varsling sendes til feil kanal |
| Live-deteksjon | Twitch API rate limit | Ingen notifikasjon |

---

## 10. Minimum Alpha-scope (3–5 teststreamere)

**Mål:** Én ny streamer kan bruke systemet uten at koden er hardkodet til Glenn.

### Hva er absolutt nødvendig

1. **Fikse `bot/lib/supabase.ts`** — endre linje 14 til `process.env.WORKSPACE_ID ?? 'glenvex-default'`
2. **Fikse `bot/lib/memberTracker.ts`** — endre linje 5 til `process.env.WORKSPACE_ID ?? 'glenvex-default'`
3. **Fikse 3 routes** — erstatt hardkodet `'glenvex-default'` med `getWorkspaceId()`
4. **Ny Supabase-rad** i `workspaces` for ny streamer
5. **Ny Railway-deployment** med ny `.env` per streamer

### Hva kan gjøres manuelt (av deg som admin)

| Handling | Hvordan |
|----------|---------|
| Opprette workspace | Supabase-dashboard → INSERT i `workspaces` |
| Sette Twitch OAuth token | `TWITCH_USER_OAUTH` i Railway env |
| Sette Discord guild + kanaler | Supabase → oppdater `workspaces`-rad + `settings_json` |
| Invitere boten | Manuelt via bot-invite link |
| Sette WORKSPACE_ID | Railway env var |

### Hva MÅ være selvbetjent for alpha

Ingenting — for 3-5 streamere kan alt konfigureres manuelt av deg.

### Estimert tid for alpha-oppsett per streamer

Med kode-fikser fra punkt 1-3 over: ~30 minutter manuelt arbeid per streamer (Supabase-konfig + Railway-deployment).

---

## 11. Risikoer

| Risiko | Alvorlighet | Sannsynlighet | Mitigation |
|--------|:-----------:|:-------------:|-----------|
| `memberTracker.ts` skriver til `glenvex-default` uansett WORKSPACE_ID | Høy | Høy | 1-linjers fiks |
| `supabase.ts` WORKSPACE_ID uten env-override | Høy | Høy | 1-linjers fiks |
| 3 routes med hardkodet workspace ID | Medium | Høy | 3 enkle fiks |
| Discord STATUS_KANAL_ID hardkodet | Medium | Medium | Gjøres per-workspace via env/config |
| `gkarlsen` admin-tildeling kjører for alle bots | Medium | Høy | Refaktorer til env-basert admin |
| Storage bucket delt — alle filer i `glenvex-assets` | Lav for alpha | — | Mappestruktur med `{workspace_id}/` finnes delvis allerede |
| Twitch tokens utgår — ingen refresh | Medium | Medium | Manuell fornying via Railway env |
| Én global DISCORD_BOT_TOKEN | Lav for alpha | — | Én bot kan betjene mange servere |
| Ingen RLS på Supabase | Medium | Lav (én instans) | Ikke kritisk for alpha |

---

## 12. Anbefalt Sprintplan

### Sprint 0 — Alpha-blokkere (< 1 dag, 5 filer)

*Gjør systemet brukbart for ny streamer på separat deployment*

| Oppgave | Fil | Endring |
|---------|-----|---------|
| Fix supabase.ts workspace | `bot/lib/supabase.ts:14` | `'glenvex-default'` → `process.env.WORKSPACE_ID ?? 'glenvex-default'` |
| Fix memberTracker workspace | `bot/lib/memberTracker.ts:5` | Samme |
| Fix ai-producer route | `src/app/api/ai-producer/route.ts:43,48` | `.eq('workspace_id', getWorkspaceId())` |
| Fix stream-history route | `src/app/api/stream-history/route.ts:15` | Samme |
| Fix download route | `src/app/api/content-factory/download/route.ts:26` | Samme |

---

### Sprint 1 — Workspace-konfig uten hardkoding (1-2 dager)

*Gjør systemet konfigurerbart per streamer via Supabase + env*

| Oppgave | Hva |
|---------|-----|
| Fjern `gkarlsen`-hardkoding fra `bot/index.ts` | Erstatt med konfigurerbart env-var `BOT_ADMIN_USERNAME` |
| Gjør STATUS_KANAL_ID per-workspace | Les fra `workspaces.settings_json` i stedet for hardkodet |
| Legg til `twitch_broadcaster_id` til `workspaces`-tabell | Cache broadcaster ID slik at vi slipper løkke på API |
| Legg til Discord invite URL til `workspaces` | `settings_json.discordInviteUrl` |
| Gjør bot-personality per-workspace | `workspaces.bot_personality` → AI-prompts |

---

### Sprint 2 — Onboarding-UI (3-5 dager)

*Wizard-side for å sette opp workspace uten å røre Supabase manuelt*

| Oppgave | Hva |
|---------|-----|
| `/setup` side | Multi-steg wizard: streamer info → Discord kanaler → test |
| `/api/setup/workspace` | POST for å opprette/oppdatere workspace |
| `/api/setup/verify-discord` | Sjekk bot er i guild + har permisjoner |
| Auto-populate fra eksisterende env | Bruk eksisterende `TWITCH_USERNAME` etc. som default |

---

### Sprint 3 — Twitch OAuth (3-5 dager)

*Ny streamer kobler Twitch uten å sette manuell token i Railway*

| Oppgave | Hva |
|---------|-----|
| `GET /api/auth/twitch` | Redirect til Twitch OAuth |
| `GET /api/auth/twitch/callback` | Motta token → lagre i `workspaces` |
| Token refresh-mekanisme | Cron-job eller middleware |
| Ny migrering | Legg til `twitch_access_token`, `twitch_refresh_token`, `twitch_token_expires`, `twitch_broadcaster_id` til `workspaces` |

---

### Sprint 4 — Discord OAuth + Bot-invite (3-5 dager)

*Ny streamer velger Discord-server og inviterer boten via UI*

| Oppgave | Hva |
|---------|-----|
| `GET /api/auth/discord` | Redirect til Discord OAuth |
| `GET /api/auth/discord/callback` | Motta guild-info → lagre i `workspaces` |
| Guild-velger UI | Vis alle Discord-servere bruker er admin i |
| Bot-invite redirect | Dynamisk invite URL per workspace |
| Permissions-verifisering | Sjekk bot har nødvendige rettigheter etter invite |

---

### Sprint 5 — Ekte multi-tenant bot (5-10 dager)

*Én Railway-instans betjener flere streamere*

| Oppgave | Hva |
|---------|-----|
| Boten laster workspace-config fra Supabase | Erstatt env-avhengighet med DB-lesing ved oppstart |
| Multi-guild Discord-routing | guild → workspace mapping |
| Multi-channel Twitch-monitoring | tmi.js multi-channel ELLER EventSub |
| Storage-isolasjon | `{workspace_id}/`-prefiks håndhevet overalt |
| Auth-system | Supabase Auth eller Clerk for self-service |

---

*Rapport fullført: 2026-06-08*  
*Neste steg anbefalt: Sprint 0 (5-filersfix) for å muliggjøre alpha-onboarding.*
