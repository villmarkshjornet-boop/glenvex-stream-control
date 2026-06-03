# GLENVEX Stream Control

> Twitch + Discord command center for streameren GLENVEX.
> Dashboard, live-varsling, AI promo og slash-kommandoer – alt på ett sted.

---

## Innhold

- [Funksjonsoversikt](#funksjonsoversikt)
- [Installasjon](#installasjon)
- [Steg 1 – Lag Discord Bot](#steg-1--lag-discord-bot)
- [Steg 2 – Lag Twitch Developer App](#steg-2--lag-twitch-developer-app)
- [Steg 3 – Fyll .env](#steg-3--fyll-env)
- [Kjøre lokalt](#kjøre-lokalt)
- [Teste live-varsel](#teste-live-varsel)
- [Deploy på Vercel](#deploy-på-vercel)
- [Sett opp ekstern cron](#sett-opp-ekstern-cron)
- [Mappestruktur](#mappestruktur)

---

## Funksjonsoversikt

| Funksjon | Beskrivelse |
|---|---|
| Dashboard | Live-status, systemstatus, stats og konfigpanel |
| Twitch Live Detection | Pollar Twitch API – detekterer live-status, spill, tittel, seere |
| Discord Bot | Poster live-embed i valgt kanal, pinger rolle |
| Slash-kommandoer | `/live`, `/twitch`, `/promo`, `/setup`, `/status`, `/socials`, `/clip` |
| AI Promo | GPT-generert promo for TikTok, Instagram, Twitter, YouTube, Discord |
| Settings | Persistent JSON-konfig – kanal-ID, rolle-ID, toggles |
| Logs | Systemlogg med tidspunkt, type og status |
| Cron endpoint | Beskyttet `POST /api/cron/check-live` – kall fra ekstern cron |

---

## Installasjon

```bash
git clone <repo-url> glenvex-stream-control
cd glenvex-stream-control

npm install

cp .env.example .env
# Fyll .env – se stegene under
```

---

## Steg 1 – Lag Discord Bot

1. Gå til [discord.com/developers/applications](https://discord.com/developers/applications)
2. Klikk **New Application** → gi den et navn (f.eks. `GLENVEX Bot`)
3. Gå til **Bot** i sidemenyen
4. Klikk **Reset Token** og kopier tokenet → `DISCORD_BOT_TOKEN`
5. Under **Privileged Gateway Intents**: slå på **Server Members Intent** og **Message Content Intent**
6. Gå til **OAuth2 → General**: kopier **Client ID** → `DISCORD_CLIENT_ID`

### Inviter boten til serveren

1. Gå til **OAuth2 → URL Generator**
2. Under **Scopes**: hak av `bot` og `applications.commands`
3. Under **Bot Permissions**: hak av:
   - `Send Messages`
   - `Embed Links`
   - `Manage Channels` (for `/setup`)
   - `Manage Roles` (for `/setup`)
   - `Mention Everyone`
   - `Read Message History`
4. Kopier den genererte URL-en og åpne den i nettleseren
5. Velg serveren du vil invitere boten til

### Hent Guild og Channel ID-er

- **Guild ID**: Høyreklikk på servernavnet → `Kopier server-ID`
- **Channel ID**: Høyreklikk på kanalen → `Kopier kanal-ID`
- Aktiver Developer Mode i Discord: `Innstillinger → Avansert → Utviklermodus`

---

## Steg 2 – Lag Twitch Developer App

1. Gå til [dev.twitch.tv/console](https://dev.twitch.tv/console)
2. Logg inn med din Twitch-konto
3. Klikk **Register Your Application**
4. Fyll inn:
   - **Name**: GLENVEX Stream Control
   - **OAuth Redirect URLs**: `http://localhost`
   - **Category**: Other
5. Klikk **Manage** → kopier **Client ID** → `TWITCH_CLIENT_ID`
6. Klikk **New Secret** → kopier → `TWITCH_CLIENT_SECRET`

---

## Steg 3 – Fyll .env

Kopier `.env.example` til `.env` og fyll inn:

```env
# Discord
DISCORD_BOT_TOKEN=MTE...    # Bot-token fra Discord Developer Portal
DISCORD_CLIENT_ID=123...    # Application Client ID
DISCORD_GUILD_ID=456...     # ID på din Discord-server
DISCORD_LIVE_CHANNEL_ID=789...   # Kanal der live-varsel skal postes
DISCORD_LIVE_ROLE_ID=012...      # Rolle som skal pinges (kan være tom)

# Twitch
TWITCH_CLIENT_ID=abc123...
TWITCH_CLIENT_SECRET=xyz789...
TWITCH_USERNAME=glenvex
TWITCH_URL=https://twitch.tv/glenvex

# OpenAI (valgfri – AI promo fungerer med fallback uten nøkkel)
OPENAI_API_KEY=sk-...

# System
CRON_SECRET=lag-en-tilfeldig-lang-streng-her
ADMIN_PASSWORD=bytt-dette-passordet
NEXT_PUBLIC_APP_NAME=GLENVEX Stream Control
```

---

## Kjøre lokalt

### Terminal 1 – Next.js dashboard

```bash
npm run dev
```

Åpne [http://localhost:3000](http://localhost:3000)

### Terminal 2 – Discord bot (valgfritt)

```bash
# Registrer slash-kommandoer én gang
npm run bot:deploy

# Start boten
npm run bot
```

> **Merk:** Discord-boten og Next.js-appen deler `data/settings.json` og `data/logs.json`.
> Begge leser/skriver til samme filer lokalt.

---

## Teste live-varsel

### Via dashboard

1. Åpne [http://localhost:3000](http://localhost:3000)
2. Klikk **Test Live Varsel** i Hurtighandlinger

### Via API direkte

```bash
curl -X POST http://localhost:3000/api/discord/test-live
```

### Via cron-endpoint

```bash
curl -X POST "http://localhost:3000/api/cron/check-live" \
  -H "x-cron-secret: din-cron-secret"
```

---

## Deploy på Vercel

1. Push prosjektet til GitHub

2. Gå til [vercel.com](https://vercel.com) og importer repoet

3. Under **Environment Variables**: legg inn alle variabler fra `.env`

4. Deploy!

> **Viktig – filsystem på Vercel:**
> `data/settings.json` og `data/logs.json` er **ikke persistent** på Vercel (serverless har ephemeral filsystem).
> For produksjon anbefales det å bytte til en database (f.eks. Vercel KV, PlanetScale, eller Upstash Redis).
> For MVP og lokal bruk fungerer JSON-filene perfekt.

> **Discord bot på Vercel:**
> Boten (`npm run bot`) kan **ikke** kjøres på Vercel. Bruk i stedet:
> - [Railway](https://railway.app) – gratis tier holder til en Discord-bot
> - [Fly.io](https://fly.io)
> - En VPS / hjemmeserver

---

## Sett opp ekstern cron

Bruk en ekstern cron-tjeneste til å kalle live-check-endpointet jevnlig.

### Alternativ A – cron-job.org (gratis)

1. Gå til [cron-job.org](https://cron-job.org) og lag en konto
2. Opprett ny cron-jobb:
   - **URL**: `https://din-vercel-url.vercel.app/api/cron/check-live`
   - **Method**: POST
   - **Headers**: legg til `x-cron-secret: din-cron-secret`
   - **Schedule**: hvert minutt eller hvert 2. minutt
3. Aktiver jobben

### Alternativ B – Vercel Cron Jobs (hvis du er på Pro)

Legg dette i `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/check-live",
      "schedule": "*/2 * * * *"
    }
  ]
}
```

### Alternativ C – GitHub Actions

```yaml
name: Live Check
on:
  schedule:
    - cron: '*/2 * * * *'
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -X POST "${{ secrets.APP_URL }}/api/cron/check-live" \
            -H "x-cron-secret: ${{ secrets.CRON_SECRET }}"
```

---

## API-referanse

| Endpoint | Metode | Beskrivelse |
|---|---|---|
| `/api/status` | GET | Full systemstatus (Twitch, Discord, stream, logs) |
| `/api/twitch/live` | GET | Henter live stream-info fra Twitch |
| `/api/discord/test-live` | POST | Sender test live-embed til Discord |
| `/api/ai/promo` | POST | Genererer AI promo-innhold |
| `/api/settings` | GET/POST | Henter/oppdaterer innstillinger |
| `/api/logs` | GET | Henter systemlogg (`?limit=N&type=success`) |
| `/api/cron/check-live` | POST | Sjekker live-status og poster varsel (krever `x-cron-secret`) |

---

## Mappestruktur

```
glenvex-stream-control/
├── bot/                        # Discord bot (separat prosess)
│   ├── index.ts                # Bot entry point
│   ├── deploy-commands.ts      # Registrer slash-kommandoer
│   └── commands/
│       ├── live.ts             # /live
│       ├── twitch.ts           # /twitch
│       ├── promo.ts            # /promo
│       ├── setup.ts            # /setup
│       ├── status.ts           # /status
│       ├── socials.ts          # /socials
│       └── clip.ts             # /clip
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/                # API-ruter
│   │   ├── ai-assistent/       # AI promo-side
│   │   ├── discord/            # Discord-side
│   │   ├── innstillinger/      # Settings-side
│   │   ├── kommandoer/         # Kommandooversikt
│   │   ├── live-overvaking/    # Live monitor
│   │   ├── logs/               # Logg-side
│   │   ├── markedsforing/      # Markedsføring
│   │   ├── systemstatus/       # Systemstatus
│   │   ├── layout.tsx          # Root layout
│   │   └── page.tsx            # Dashboard
│   ├── components/             # React-komponenter
│   ├── lib/                    # Delt logikk
│   │   ├── discord.ts          # Discord REST API
│   │   ├── logger.ts           # Logg-system
│   │   ├── openai.ts           # AI promo
│   │   ├── settings.ts         # Settings-lagring
│   │   └── twitch.ts           # Twitch Helix API
│   └── types/
│       └── index.ts            # TypeScript types
├── data/                       # Runtime-data (ikke i git)
│   ├── settings.json           # Genereres automatisk
│   └── logs.json               # Genereres automatisk
├── .env.example
├── package.json
└── tsconfig.json
```

---

## Nødvendige Discord-tillatelser (bot)

```
Send Messages
Embed Links
Attach Files
Read Message History
Mention Everyone
Manage Channels    (for /setup)
Manage Roles       (for /setup)
Use Slash Commands
```

---

Bygget med ❤️ for GLENVEX community.
