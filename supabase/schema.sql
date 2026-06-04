-- GLENVEX Creator OS – Supabase Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Workspaces ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  streamer_name TEXT NOT NULL,
  brand_name TEXT,
  twitch_channel_id TEXT,
  twitch_channel_name TEXT,
  discord_guild_id TEXT,
  discord_guild_name TEXT,
  live_channel_id TEXT,
  promo_channel_id TEXT,
  clips_channel_id TEXT,
  partner_channel_id TEXT,
  bot_personality TEXT DEFAULT 'dark_gaming',
  plan TEXT DEFAULT 'creator',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Content Library ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content_library (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id TEXT REFERENCES workspaces(id),
  tittel TEXT,
  type TEXT,
  status TEXT DEFAULT 'draft',
  tekst TEXT,
  bilde_url TEXT,
  embed_data JSONB,
  kanal_id TEXT,
  kanal_navn TEXT,
  modul TEXT,
  opprettet_av TEXT,
  discord_msg_id TEXT,
  opprettet TIMESTAMPTZ DEFAULT NOW(),
  endret TIMESTAMPTZ DEFAULT NOW(),
  publisert TIMESTAMPTZ,
  tags TEXT[]
);

-- ── RP Characters ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rp_characters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id TEXT REFERENCES workspaces(id),
  navn TEXT NOT NULL,
  kallenavn TEXT,
  server TEXT DEFAULT 'Future RP',
  rolle TEXT,
  beskrivelse TEXT,
  backstory TEXT,
  fraksjon TEXT,
  bilde_url TEXT,
  status TEXT DEFAULT 'aktiv',
  discord_msg_id TEXT,
  discord_kanal_id TEXT,
  relasjoner JSONB DEFAULT '[]',
  konflikter JSONB DEFAULT '[]',
  publiserings_historikk JSONB DEFAULT '[]',
  opprettet TIMESTAMPTZ DEFAULT NOW(),
  endret TIMESTAMPTZ DEFAULT NOW()
);

-- ── Partners ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS partners (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id TEXT REFERENCES workspaces(id),
  navn TEXT NOT NULL,
  logo TEXT,
  nettadresse TEXT,
  affiliate_link TEXT,
  rabattkode TEXT,
  beskrivelse TEXT,
  kategori TEXT DEFAULT 'annet',
  provisjonstype TEXT DEFAULT 'prosent',
  provisjon NUMERIC DEFAULT 0,
  avtale_start DATE,
  avtale_slutt DATE,
  aktiv BOOLEAN DEFAULT TRUE,
  featured BOOLEAN DEFAULT FALSE,
  owned_brand BOOLEAN DEFAULT FALSE,
  prioritet INTEGER DEFAULT 5,
  eksponering INTEGER DEFAULT 0,
  siste_promotert TIMESTAMPTZ,
  klikk INTEGER DEFAULT 0,
  estimert_inntekt NUMERIC DEFAULT 0,
  kampanjer JSONB DEFAULT '[]',
  opprettet TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Community Members ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS community_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id TEXT REFERENCES workspaces(id),
  discord_id TEXT NOT NULL,
  username TEXT,
  display_name TEXT,
  xp INTEGER DEFAULT 0,
  level INTEGER DEFAULT 1,
  messages INTEGER DEFAULT 0,
  subs INTEGER DEFAULT 0,
  gift_subs INTEGER DEFAULT 0,
  raids INTEGER DEFAULT 0,
  badges TEXT[] DEFAULT '{}',
  joined_at TIMESTAMPTZ,
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  last_welcomed TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, discord_id)
);

-- ── Live Notifications ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS live_notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id TEXT REFERENCES workspaces(id),
  stream_id TEXT,
  title TEXT,
  game TEXT,
  viewer_count INTEGER,
  discord_msg_id TEXT,
  discord_channel_id TEXT,
  posted_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Stream History ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stream_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id TEXT REFERENCES workspaces(id),
  stream_id TEXT UNIQUE,
  title TEXT,
  game TEXT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_minutes INTEGER DEFAULT 0,
  peak_viewers INTEGER DEFAULT 0,
  avg_viewers INTEGER DEFAULT 0,
  chat_messages INTEGER DEFAULT 0,
  followers_gained INTEGER DEFAULT 0,
  subs_gained INTEGER DEFAULT 0,
  raids_during INTEGER DEFAULT 0
);

-- ── Role Rules ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS role_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id TEXT REFERENCES workspaces(id),
  navn TEXT,
  beskrivelse TEXT,
  trigger_type TEXT,
  terskel INTEGER,
  rolle_navn TEXT,
  rolle_farge INTEGER,
  status TEXT DEFAULT 'aktiv',
  antall_tildelt INTEGER DEFAULT 0,
  opprettet TIMESTAMPTZ DEFAULT NOW()
);

-- ── Role Change Log ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS role_change_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id TEXT REFERENCES workspaces(id),
  bruker_navn TEXT,
  bruker_id TEXT,
  rolle TEXT,
  handling TEXT,
  aarsak TEXT,
  regel_id UUID,
  utfort_av TEXT DEFAULT 'bot',
  dato TIMESTAMPTZ DEFAULT NOW(),
  godkjent BOOLEAN
);

-- ── Bot Settings ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_settings (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
  tone TEXT DEFAULT 'dark_gaming',
  pause_discord BOOLEAN DEFAULT FALSE,
  pause_twitch BOOLEAN DEFAULT FALSE,
  pause_partner_promo BOOLEAN DEFAULT FALSE,
  pause_live_varsler BOOLEAN DEFAULT FALSE,
  aktiv BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Bot Memory ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_memory (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id TEXT REFERENCES workspaces(id),
  type TEXT,
  innhold TEXT,
  kanal TEXT,
  partner TEXT,
  dato TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_content_library_workspace ON content_library(workspace_id);
CREATE INDEX IF NOT EXISTS idx_content_library_status ON content_library(status);
CREATE INDEX IF NOT EXISTS idx_members_workspace ON community_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_members_discord ON community_members(discord_id);
CREATE INDEX IF NOT EXISTS idx_partners_workspace ON partners(workspace_id);
CREATE INDEX IF NOT EXISTS idx_stream_history_workspace ON stream_history(workspace_id);
CREATE INDEX IF NOT EXISTS idx_bot_memory_type ON bot_memory(type);

-- Enable Row Level Security (optional, disable for now)
-- ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
