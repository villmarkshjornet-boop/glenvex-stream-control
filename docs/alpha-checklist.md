# Alpha Deployment Checklist

Use this checklist for each new streamer deployment. Check off items as you complete them.

---

## Pre-Deployment

### Supabase
- [ ] New Supabase project created
- [ ] All 15 SQL files in `supabase/` applied in order (see [alpha-setup-guide.md](alpha-setup-guide.md) Step 1 for exact order)
- [ ] Storage bucket created with correct name (matches `STORAGE_BUCKET`)
- [ ] Bucket is set to **public** (required for clip/thumbnail URLs)
- [ ] `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` noted
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` noted

### Discord
- [ ] Discord Developer Application created
- [ ] Bot added with Server Members Intent + Message Content Intent enabled
- [ ] Bot invited to streamer's Discord server (Administrator permission)
- [ ] `DISCORD_BOT_TOKEN` noted
- [ ] `DISCORD_GUILD_ID` noted (right-click server → Copy Server ID)
- [ ] `DISCORD_LIVE_CHANNEL_ID` noted (live notification channel)
- [ ] `DISCORD_CHAT_CHANNEL_ID` noted (general chat channel)
- [ ] `STATUS_CHANNEL_ID` noted (bot status channel, optional)
- [ ] `BOT_ADMIN_USERNAME` confirmed (streamer's Discord username)

### Twitch
- [ ] Twitch Developer Application created at dev.twitch.tv/console
- [ ] `TWITCH_CLIENT_ID` noted
- [ ] `TWITCH_CLIENT_SECRET` noted
- [ ] `TWITCH_USERNAME` confirmed (exact lowercase channel name)

### Identity
- [ ] `WORKSPACE_ID` chosen — unique slug for this streamer (e.g. `coolstreamer`)
- [ ] `BRAND_SLUG` chosen (default: `glenvex`, replace with streamer's brand)
- [ ] `NEXT_PUBLIC_APP_NAME` set (e.g. "CoolStreamer Stream Control")

---

## Railway Deployment

- [ ] Railway project created, repo connected
- [ ] All Railway env vars set (see [env-reference.md](env-reference.md)):
  - [ ] `DISCORD_BOT_TOKEN`
  - [ ] `TWITCH_USERNAME`
  - [ ] `TWITCH_CLIENT_ID`
  - [ ] `TWITCH_CLIENT_SECRET`
  - [ ] `SUPABASE_URL`
  - [ ] `SUPABASE_SERVICE_ROLE_KEY`
  - [ ] `WORKSPACE_ID`
  - [ ] `OPENAI_API_KEY` (if AI features needed)
  - [ ] `BOT_ADMIN_USERNAME`
  - [ ] `STATUS_CHANNEL_ID`
  - [ ] `STORAGE_BUCKET`
  - [ ] `DISCORD_GUILD_ID`
  - [ ] `DISCORD_LIVE_CHANNEL_ID`
  - [ ] `DISCORD_CHAT_CHANNEL_ID`
  - [ ] `DISCORD_INVITE_URL`
- [ ] Deployment successful — build logs clean
- [ ] Railway public URL noted for `BOT_API_URL`

### Railway Smoke Tests
- [ ] Bot appears **online** in Discord
- [ ] Startup message posted in `STATUS_CHANNEL_ID` channel
- [ ] `BOT_ADMIN_USERNAME` has admin role in Discord
- [ ] `!discord` command works in Twitch chat (if streamer is live)

---

## Vercel Deployment

- [ ] Vercel project created, repo connected
- [ ] All Vercel env vars set (see [env-reference.md](env-reference.md)):
  - [ ] `SUPABASE_URL`
  - [ ] `SUPABASE_SERVICE_ROLE_KEY`
  - [ ] `WORKSPACE_ID` (same as Railway)
  - [ ] `TWITCH_CLIENT_ID`
  - [ ] `TWITCH_CLIENT_SECRET`
  - [ ] `TWITCH_USERNAME`
  - [ ] `OPENAI_API_KEY`
  - [ ] `DISCORD_BOT_TOKEN`
  - [ ] `DISCORD_GUILD_ID`
  - [ ] `DISCORD_LIVE_CHANNEL_ID`
  - [ ] `DISCORD_CHAT_CHANNEL_ID`
  - [ ] `BOT_API_URL`
  - [ ] `BRAND_SLUG`
  - [ ] `NEXT_PUBLIC_SUPABASE_URL`
  - [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - [ ] `NEXT_PUBLIC_APP_NAME`
  - [ ] `NEXT_PUBLIC_BRAND_SLUG` (same value as `BRAND_SLUG`)
- [ ] Build successful — 0 errors, 0 warnings
- [ ] Vercel deployment URL noted

### Vercel Smoke Tests
- [ ] Dashboard (`/`) loads without errors
- [ ] `/api/system-health` returns status (no 500 errors)
- [ ] `/api/content-factory/health` — Supabase OK, bucket OK
- [ ] Community page loads
- [ ] Stream history loads (or shows empty state correctly)

---

## Post-Deployment

### Workspace Isolation Verification
- [ ] Confirm `WORKSPACE_ID` is unique — no other deployment uses same value
- [ ] Write a test community member and verify it appears **only** in this workspace
- [ ] Verify bot events in Supabase `system_events` table have correct `workspace_id`

### Slash Commands
- [ ] Discord slash commands registered (`npm run deploy-commands`)
- [ ] `/rang` command works
- [ ] `/topp` command works

### Final Sign-off
- [ ] Streamer has been walked through the dashboard
- [ ] Streamer has Vercel URL bookmarked
- [ ] Streamer's Discord invite link is correct in `DISCORD_INVITE_URL`
- [ ] Deployment documented in internal records
