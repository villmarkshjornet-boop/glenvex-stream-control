-- ============================================================
-- GLENVEX Creator OS — RLS Production Policies
-- Kjør dette når dere er klare for multi-tenant (Jacob + flere workspaces)
--
-- Arkitektur:
--   service_role (bot + Vercel server-side) → full tilgang, alltid
--   authenticated (innloggede brukere via Supabase Auth) → kun eget workspace
--   anon → ingen tilgang til AI-tabellene
--
-- FORUTSETNING: workspace_id må ligge i auth.jwt() -> 'user_metadata'
-- Dette settes automatisk når bruker opprettes med:
--   supabase.auth.signUp({ email, password, options: { data: { workspace_id: 'glenvex' } } })
-- ============================================================

-- ── Aktiver RLS på alle relevante tabeller ────────────────────────────────────

ALTER TABLE ai_agent_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_agent_memory    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_agent_insights  ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE stream_history     ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_vods       ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_highlights ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_content_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces         ENABLE ROW LEVEL SECURITY;

-- ── service_role: full tilgang (belt-og-bukseseler — bypasser RLS uansett, ──
-- ── men eksplisitte policies gjør det synlig og beskytter mot future-regresjon) ──

CREATE POLICY "service_role_all_ai_agent_events"
  ON ai_agent_events FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_ai_agent_memory"
  ON ai_agent_memory FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_ai_agent_insights"
  ON ai_agent_insights FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_system_events"
  ON system_events FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_stream_history"
  ON stream_history FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_content_vods"
  ON content_vods FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_content_highlights"
  ON content_highlights FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_content_transcripts"
  ON content_transcripts FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_partner_content_log"
  ON partner_content_log FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_community_members"
  ON community_members FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_workspaces"
  ON workspaces FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── authenticated brukere: kun eget workspace ─────────────────────────────────
-- workspace_id hentes fra JWT user_metadata (settes ved signUp/signIn)

CREATE POLICY "user_own_workspace_ai_agent_events"
  ON ai_agent_events FOR ALL TO authenticated
  USING      (workspace_id = (auth.jwt() -> 'user_metadata' ->> 'workspace_id'))
  WITH CHECK (workspace_id = (auth.jwt() -> 'user_metadata' ->> 'workspace_id'));

CREATE POLICY "user_own_workspace_ai_agent_memory"
  ON ai_agent_memory FOR ALL TO authenticated
  USING      (workspace_id = (auth.jwt() -> 'user_metadata' ->> 'workspace_id'))
  WITH CHECK (workspace_id = (auth.jwt() -> 'user_metadata' ->> 'workspace_id'));

CREATE POLICY "user_own_workspace_ai_agent_insights"
  ON ai_agent_insights FOR ALL TO authenticated
  USING      (workspace_id = (auth.jwt() -> 'user_metadata' ->> 'workspace_id'))
  WITH CHECK (workspace_id = (auth.jwt() -> 'user_metadata' ->> 'workspace_id'));

CREATE POLICY "user_own_workspace_system_events"
  ON system_events FOR ALL TO authenticated
  USING      (workspace_id = (auth.jwt() -> 'user_metadata' ->> 'workspace_id'))
  WITH CHECK (workspace_id = (auth.jwt() -> 'user_metadata' ->> 'workspace_id'));

CREATE POLICY "user_own_workspace_stream_history"
  ON stream_history FOR ALL TO authenticated
  USING      (workspace_id = (auth.jwt() -> 'user_metadata' ->> 'workspace_id'))
  WITH CHECK (workspace_id = (auth.jwt() -> 'user_metadata' ->> 'workspace_id'));

CREATE POLICY "user_own_workspace_content_vods"
  ON content_vods FOR ALL TO authenticated
  USING      (workspace_id = (auth.jwt() -> 'user_metadata' ->> 'workspace_id'))
  WITH CHECK (workspace_id = (auth.jwt() -> 'user_metadata' ->> 'workspace_id'));

CREATE POLICY "user_own_workspace_content_highlights"
  ON content_highlights FOR ALL TO authenticated
  USING      (workspace_id = (auth.jwt() -> 'user_metadata' ->> 'workspace_id'))
  WITH CHECK (workspace_id = (auth.jwt() -> 'user_metadata' ->> 'workspace_id'));

CREATE POLICY "user_own_workspace_content_transcripts"
  ON content_transcripts FOR ALL TO authenticated
  USING      (workspace_id = (auth.jwt() -> 'user_metadata' ->> 'workspace_id'))
  WITH CHECK (workspace_id = (auth.jwt() -> 'user_metadata' ->> 'workspace_id'));

CREATE POLICY "user_own_workspace_partner_content_log"
  ON partner_content_log FOR ALL TO authenticated
  USING      (workspace_id = (auth.jwt() -> 'user_metadata' ->> 'workspace_id'))
  WITH CHECK (workspace_id = (auth.jwt() -> 'user_metadata' ->> 'workspace_id'));

CREATE POLICY "user_own_workspace_community_members"
  ON community_members FOR ALL TO authenticated
  USING      (workspace_id = (auth.jwt() -> 'user_metadata' ->> 'workspace_id'))
  WITH CHECK (workspace_id = (auth.jwt() -> 'user_metadata' ->> 'workspace_id'));

-- workspaces: brukere ser kun sin egen rad (via owner_user_id)
CREATE POLICY "user_own_workspace_workspaces"
  ON workspaces FOR ALL TO authenticated
  USING      (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

-- ── anon: ingen tilgang ────────────────────────────────────────────────────────
-- (ingen policies = ingen tilgang, dette er standardoppførselen med RLS aktivert)

-- ── Verifiser at policies er satt korrekt ────────────────────────────────────
-- Kjør dette etter migrasjonen for å bekrefte:
--
-- SELECT tablename, policyname, roles, cmd
-- FROM pg_policies
-- WHERE tablename IN (
--   'ai_agent_events', 'system_events', 'ai_agent_memory',
--   'ai_agent_insights', 'stream_history'
-- )
-- ORDER BY tablename, policyname;
