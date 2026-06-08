# Alpha Setup Guide — GLENVEX Stream Control

Step-by-step guide for onboarding a new streamer to the alpha deployment.
Architecture: one Railway deployment (bot) + one Vercel deployment (frontend) per streamer.

---

## Prerequisites

- Supabase account (free tier works)
- Railway account
- Vercel account
- Discord server with admin access
- Twitch Developer Application
- OpenAI API key

---

## Step 1 — Supabase Setup

1. Create a new Supabase project at https://supabase.com
2. Note your **Project URL** and **Service Role Key** (Settings → API → Project API keys)
3. Run the SQL files from the `supabase/` folder in the repo. Open each file in a text editor, copy the contents, and paste into **Supabase → SQL Editor → New query → Run**.

   Run them in this exact order:

   | # | File | What it creates |
   |---|------|-----------------|
   | 1 | `supabase/schema.sql` | All core tables: workspaces, community_members, stream_history, partners, etc. **Start here.** |
   | 2 | `supabase/content-factory.sql` | Content Factory tables (content_vods, content_highlights, content_assets, etc.) |
   | 3 | `supabase/add-settings.sql` | Adds `settings_json` column to workspaces |
   | 4 | `supabase/add-clip-queue.sql` | Adds `clip_status` to content_highlights |
   | 5 | `supabase/add-clip-columns.sql` | Adds more clip columns to content_highlights |
   | 6 | `supabase/add-audio-storage.sql` | Adds audio fields to content_vods |
   | 7 | `supabase/add-vod-progress.sql` | Adds progress tracking to content_vods |
   | 8 | `supabase/ai-producer-migration.sql` | AI Producer memory tables |
   | 9 | `supabase/global-ai-migration.sql` | Global AI memory layer (ai_agent_memory) |
   | 10 | `supabase/thumbnail-migration.sql` | Thumbnail fields on content_highlights |
   | 11 | `supabase/thumbnail-v2-migration.sql` | Thumbnail V2 quality score fields |
   | 12 | `supabase/thumbnail-v2b-migration.sql` | Adds `thumbnail_started_at` |
   | 13 | `supabase/system-events-migration.sql` | system_events table (event bus) |
   | 14 | `supabase/community-intelligence-migration.sql` | Extends community_members with engagement tracking |
   | 15 | `supabase/cross-platform-migration.sql` | Cross-platform user matching table |

   > All files use `CREATE TABLE IF NOT EXISTS` and `ADD COLUMN IF NOT EXISTS` — safe to re-run if unsure.

4. Create a storage bucket:
   - Go to **Storage → New Bucket**
   - Name: `glenvex-assets` (or your own name — set `STORAGE_BUCKET` env var to match)
   - Public: ✅ (required for public thumbnail/clip URLs)
5. Verify core tables exist: `workspaces`, `community_members`, `stream_history`, `system_events`, `content_vods`, `content_highlights`

---

## Step 2 — Discord Setup

1. Go to https://discord.com/developers/applications → New Application
2. Bot tab → Add Bot → copy **Bot Token** (`DISCORD_BOT_TOKEN`)
3. Enable **Privileged Gateway Intents**: Server Members Intent, Message Content Intent
4. OAuth2 → URL Generator → Scopes: `bot`, `applications.commands`
   - Permissions: Administrator (easiest for alpha)
5. Invite bot to your Discord server using the generated URL
6. Get the **Discord Server ID** (Guild ID): Right-click server → Copy Server ID (`DISCORD_GUILD_ID`)
7. Create or identify channels and copy their IDs:
   - `#live-varsling` → `DISCORD_LIVE_CHANNEL_ID`
   - `#general` or main chat → `DISCORD_CHAT_CHANNEL_ID`
   - `#bot-status` (optional) → `STATUS_CHANNEL_ID`

---

## Step 3 — Twitch Setup

1. Go to https://dev.twitch.tv/console → Register Your Application
2. Name: anything, OAuth Redirect URL: `http://localhost`, Category: Broadcasting
3. Copy **Client ID** → `TWITCH_CLIENT_ID`
4. New Secret → copy **Client Secret** → `TWITCH_CLIENT_SECRET`
5. Set `TWITCH_USERNAME` to the exact Twitch channel username (lowercase)
6. Create a Discord invite link for the `!discord` command → `DISCORD_INVITE_URL`

---

## Step 4 — Railway Bot Deployment

1. Fork or clone the repo to your GitHub
2. Go to https://railway.app → New Project → Deploy from GitHub
3. Select the repo, set Root Directory: `/` (or `bot/` if separate)
4. Set all **Railway Environment Variables** (see [env-reference.md](env-reference.md)):

   ```
   DISCORD_BOT_TOKEN=...
   TWITCH_USERNAME=your_twitch_channel
   TWITCH_CLIENT_ID=...
   TWITCH_CLIENT_SECRET=...
   SUPABASE_URL=https://xxxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=...
   WORKSPACE_ID=your-streamer-slug        (e.g. "coolstreamer")
   OPENAI_API_KEY=...
   BOT_ADMIN_USERNAME=your_discord_username
   STATUS_CHANNEL_ID=1234567890123456789
   STORAGE_BUCKET=glenvex-assets
   PORT=4242
   DISCORD_GUILD_ID=...
   DISCORD_LIVE_CHANNEL_ID=...
   DISCORD_CHAT_CHANNEL_ID=...
   DISCORD_INVITE_URL=https://discord.gg/...
   ```

5. Start command: `npm run bot` (or `node dist/bot/index.js`)
6. Note the Railway deployment URL → needed for `BOT_API_URL` in Vercel

---

## Step 5 — Vercel Frontend Deployment

1. Go to https://vercel.com → Add New Project → Import from GitHub
2. Set **Root Directory** to `/` (the Next.js app is in the root)
3. Set all **Vercel Environment Variables** (see [env-reference.md](env-reference.md)):

   ```
   SUPABASE_URL=https://xxxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=...
   WORKSPACE_ID=your-streamer-slug        (same as Railway)
   TWITCH_CLIENT_ID=...
   TWITCH_CLIENT_SECRET=...
   TWITCH_USERNAME=your_twitch_channel
   OPENAI_API_KEY=...
   DISCORD_BOT_TOKEN=...
   DISCORD_GUILD_ID=...
   DISCORD_LIVE_CHANNEL_ID=...
   DISCORD_CHAT_CHANNEL_ID=...
   BOT_API_URL=https://your-bot.up.railway.app
   BRAND_SLUG=your_brand                  (default: glenvex)
   
   NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   NEXT_PUBLIC_APP_NAME=YourBrand Stream Control
   NEXT_PUBLIC_BRAND_SLUG=your_brand      (same as BRAND_SLUG)
   ```

4. Deploy — Vercel will run `npm run build` automatically

---

## Step 6 — Register Discord Slash Commands

After bot is running on Railway, register slash commands once:

```bash
DISCORD_BOT_TOKEN=... DISCORD_CLIENT_ID=... node dist/bot/deploy-commands.js
```

Or run `npm run deploy-commands` with env vars set.

---

## Step 7 — Verification

1. **Bot online**: Check Discord — bot should appear online
2. **Status message**: Bot posts a startup message in `STATUS_CHANNEL_ID` channel
3. **Admin role**: Bot auto-assigns admin to `BOT_ADMIN_USERNAME` on startup
4. **Frontend**: Visit Vercel URL → dashboard should load with 0 errors
5. **Supabase connection**: Visit `/api/content-factory/health` → all checks green
6. **System events**: Visit `/system-events` page — should show `BOT_STARTED` event

---

## Common Issues

| Problem | Cause | Fix |
|---------|-------|-----|
| Bot offline | `DISCORD_BOT_TOKEN` wrong or missing | Regenerate token in Discord Developer Portal |
| No Twitch data | `TWITCH_CLIENT_ID`/`SECRET` wrong | Verify credentials, check token hasn't expired |
| Supabase timeout | Wrong URL or missing migrations | Re-run migrations, check URL format |
| `WORKSPACE_ID` clash | Two deployments share same ID | Each streamer must have a unique `WORKSPACE_ID` |
| Storage 404 | Bucket doesn't exist or wrong name | Create bucket in Supabase or fix `STORAGE_BUCKET` |
| Build fails | Missing env var | Check build logs — Next.js reports missing NEXT_PUBLIC vars |
