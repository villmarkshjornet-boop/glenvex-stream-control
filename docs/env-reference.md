# Environment Variable Reference

All environment variables used by the system.
**Deployment target**: Railway (bot) and/or Vercel (frontend).
**Scope**: GLOBAL = same value can be shared; WORKSPACE-SPECIFIC = must differ per streamer.

---

## Supabase

| Variable | Target | Scope | Required | Default | Description |
|----------|--------|-------|----------|---------|-------------|
| `SUPABASE_URL` | Railway + Vercel | Global | ✅ | — | Supabase project URL (https://xxxx.supabase.co) |
| `SUPABASE_SERVICE_ROLE_KEY` | Railway + Vercel | Global | ✅ | — | Service role key (bypasses RLS — keep secret) |
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel | Global | ✅ | — | Same as SUPABASE_URL — exposed to browser |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel | Global | ✅ | — | Anon key — safe to expose to browser |

---

## Workspace Identity

| Variable | Target | Scope | Required | Default | Description |
|----------|--------|-------|----------|---------|-------------|
| `WORKSPACE_ID` | Railway + Vercel | Workspace-specific | ✅ | `glenvex-default` | Unique slug per streamer (e.g. `coolstreamer`). Must match between Railway and Vercel. |

---

## Twitch

| Variable | Target | Scope | Required | Default | Description |
|----------|--------|-------|----------|---------|-------------|
| `TWITCH_CLIENT_ID` | Railway + Vercel | Workspace-specific | ✅ | — | Twitch Developer Application client ID |
| `TWITCH_CLIENT_SECRET` | Railway + Vercel | Workspace-specific | ✅ | — | Twitch Developer Application client secret |
| `TWITCH_USERNAME` | Railway + Vercel | Workspace-specific | ✅ | — | Exact Twitch channel username (lowercase) |

---

## Discord

| Variable | Target | Scope | Required | Default | Description |
|----------|--------|-------|----------|---------|-------------|
| `DISCORD_BOT_TOKEN` | Railway + Vercel | Workspace-specific | ✅ | — | Bot token from Discord Developer Portal |
| `DISCORD_GUILD_ID` | Railway + Vercel | Workspace-specific | ✅ | — | Discord server/guild ID |
| `DISCORD_LIVE_CHANNEL_ID` | Railway + Vercel | Workspace-specific | ✅ | — | Channel ID for live stream notifications |
| `DISCORD_CHAT_CHANNEL_ID` | Railway + Vercel | Workspace-specific | ✅ | — | Channel ID for general chat/promo posts |
| `DISCORD_INVITE_URL` | Railway | Workspace-specific | — | — | Public invite URL shown in Twitch chat `!discord` command |
| `STATUS_CHANNEL_ID` | Railway | Workspace-specific | — | `1511722714623381645` | Channel ID where bot posts startup/update messages |
| `BOT_ADMIN_USERNAME` | Railway | Workspace-specific | — | `gkarlsen` | Discord username that gets auto-assigned admin role on bot startup |

---

## OpenAI

| Variable | Target | Scope | Required | Default | Description |
|----------|--------|-------|----------|---------|-------------|
| `OPENAI_API_KEY` | Railway + Vercel | Global | — | — | OpenAI API key. Required for AI features (AI Producer, Thumbnail Builder, Community Intelligence, Stream Briefing). System degrades gracefully without it. |

---

## Brand & Storage

| Variable | Target | Scope | Required | Default | Description |
|----------|--------|-------|----------|---------|-------------|
| `STORAGE_BUCKET` | Railway + Vercel | Workspace-specific | — | `glenvex-assets` | Supabase Storage bucket name for clips, thumbnails, VODs |
| `BRAND_SLUG` | Vercel | Workspace-specific | — | `glenvex` | Prefix used in server-generated ZIP filenames (e.g. `coolstreamer_highlight_xyz.zip`) |
| `NEXT_PUBLIC_BRAND_SLUG` | Vercel | Workspace-specific | — | `glenvex` | Same as BRAND_SLUG — must match, exposed to browser for client-side download filenames |
| `NEXT_PUBLIC_APP_NAME` | Vercel | Workspace-specific | — | `GLENVEX Stream Control` | App name displayed in the frontend UI |

---

## Integration

| Variable | Target | Scope | Required | Default | Description |
|----------|--------|-------|----------|---------|-------------|
| `BOT_API_URL` | Vercel | Workspace-specific | — | — | URL of the Railway bot's data API (e.g. `https://your-bot.up.railway.app`). Without this, Vercel falls back to local JSON files. |
| `PORT` | Railway | Global | — | `4242` | Port for the Railway bot's internal data API. Railway sets this automatically. |

---

## Feature Flags

| Variable | Target | Scope | Required | Default | Description |
|----------|--------|-------|----------|---------|-------------|
| `CONTENT_FACTORY_ENABLED` | Vercel + Railway | Global | — | `false` | Set to `true` to enable the Content Factory pipeline (VOD processing, clipping, thumbnails). Leave disabled until full VOD workflow is configured. |

---

## Notes

- **WORKSPACE_ID must be identical** between Railway and Vercel — mismatches cause data written by the bot to not appear in the frontend.
- **STORAGE_BUCKET must be identical** between Railway and Vercel — the bot uploads files, Vercel serves their URLs.
- **BRAND_SLUG and NEXT_PUBLIC_BRAND_SLUG must match** — one is server-side, one is client-side.
- All `NEXT_PUBLIC_` variables are inlined at build time. Changing them requires a Vercel redeploy.
- The fallback values preserve backwards compatibility with the original single-tenant deployment.
