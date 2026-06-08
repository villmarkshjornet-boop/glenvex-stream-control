# GLENVEX Creator OS — Community Intelligence Red Thread Audit

**Dato:** 2026-06-08  
**Ansvarlig:** Effect Tracking Sprint

---

## 1. EKSISTERENDE KOMPONENTER

### `community_members` (Supabase-tabell)
Felter: `discord_id`, `username`, `display_name`, `xp`, `level`, `messages`, `reactions`, `voice_minutes`, `streams_attended`, `engagement_score`, `community_score`, `subs`, `gift_subs`, `raids`, `badges`, `last_seen`, `joined_at`

Status: **Komplett** — alle nødvendige felter finnes.

### `memberTracker.ts` (Railway bot)
Skriver: xp, messages, reactions, voiceMinutes, streamsAttended, engagementScore, communityScore til Supabase.  
Funksjoner: `addReaction()`, `addVoiceMinutes()`, `addStreamAttendance()`, `computeScores()`  
Status: **Aktiv** — samler data løpende.

### `community-intelligence/route.ts`
Beregner: health metrics, toppXP, toppChattere, toppSupportere, toppEngasjement, atRisk, newMembers, hiddenGems, AI analyse  
Mangler: Core Members, Community Heroes, Retention Leaders, AI Memory-kontekst, anbefalinger, cross-platform stats  
Status: **Delvis** — god base, men ikke koblet til rødtråden.

### `community-manager/page.tsx`
Viser: søkbar member-liste, XP-bar, roller, detaljvisning med alle nye felter  
Mangler: segment-labels per membre (Core/Hero/At Risk), AI-innsikter  
Status: **Delvis** — god UI, mangler klassifisering.

### `ai_agent_events` (fra bot)
Skriver: Twitch chat, Discord meldinger, raids, subs med importance_score  
Brukes av: LearningAggregator  
Community Manager bruker den: **NEI**

### `ai_agent_memory` (via getCreatorContext)
Inneholder: viewer-kunnskap, member-kunnskap, vitser, community-signaler fra LearningAggregator  
Community Manager bruker den: **NEI** ← GAP

### `ai_agent_decisions`
Inneholder: utførte AI-anbefalinger med feedback_score  
Community Manager bruker den: **NEI** — men ikke kritisk for community

### `stream_history`
Inneholder: peak_viewers, avg_viewers, followers_gained, subs_gained per stream  
Community Manager bruker den: **NEI** ← GAP (Retention Leaders kan ikke beregnes uten stream-count)

### `cross_platform_users`
Inneholder: Discord ↔ Twitch matches med confidence_score  
Skrives av: LearningAggregator (username-match)  
Community Manager bruker den: **NEI** ← GAP (kryssplattform-identitet)

---

## 2. RØD TRÅD — MANGLENDE KOBLINGER

| Gap | Fil | Hva mangler | Datakilde | Prioritet |
|-----|-----|-------------|-----------|-----------|
| G1 | community-intelligence/route.ts | Core Members-segment | community_members.streams_attended + engagement_score | KRITISK |
| G2 | community-intelligence/route.ts | Community Heroes-segment | community_members.level + subs + gift_subs | KRITISK |
| G3 | community-intelligence/route.ts | Streamer Supporters | community_members.subs + gift_subs + raids | HØY |
| G4 | community-intelligence/route.ts | Retention Leaders | community_members.streams_attended | HØY |
| G5 | community-intelligence/route.ts | AI Memory-kontekst | ai_agent_memory (topic, joke, member types) | HØY |
| G6 | community-intelligence/route.ts | Cross-platform count | cross_platform_users | MEDIUM |
| G7 | community-intelligence/route.ts | Anbefalinger (VIP, follow-up, spotlight) | eksisterende segments | HØY |
| G8 | community-manager/page.tsx | Segment-badges | beregnet client-side fra eksisterende data | HØY |
| G9 | ai-producer/route.ts | Community Intelligence i GPT-prompt | community_members (top 5, at-risk count) | HØY |
| G10 | raid-targets/route.ts | Community-aktivitetskontext | community_members.aktive24h | LAV |

---

## 3. SEGMENT-DEFINISJON (basert på eksisterende data)

Alle segmenter beregnes fra `community_members` uten nye tabeller:

```
Core Members:
  streams_attended >= 5 AND last_seen < 7d AND (messages > 10 OR engagement_score >= 20)
  → Bærebjelken i communityet

Community Heroes:
  level >= 30 OR (subs + gift_subs*2 + raids*3) >= 5
  → Veteraner og dedikerte støttespillere

Streamer Supporters:
  (subs + gift_subs*2 + raids*3) >= 3
  → Finansiell og event-støtte

Retention Leaders:
  streams_attended >= 8 AND last_seen < 14d
  → Alltid der, konsekvent tilstedeværelse

At Risk (eksisterer):
  last_seen > 14d AND xp > 100
  → Viktige membres som er i ferd med å forsvinne

Hidden Gems (eksisterer):
  community_score >= 30 AND messages < 50 AND last_seen < 30d
  → Verdifulle membres med lav synlighet
```

---

## 4. AI MEMORY INTEGRASJON

`ai_agent_memory` inneholder (community-relevante types):
- `memory_type = 'topic'` → community-signaler, fraser, inside jokes
- `memory_type = 'joke'` → running jokes
- `memory_type = 'member'` → kjente Discord-membres
- `memory_type = 'viewer'` → kjente Twitch-seere

Community Intelligence bør vise:
1. Kjente community-signaler/fraser fra AI Memory
2. Hvem AI Memory kjenner igjen som faste membres/viewers
3. Cross-platform matches (Discord ↔ Twitch)

---

## 5. ANBEFALINGER (kan genereres uten ny AI)

Anbefalinger basert på eksisterende data (ingen inventerte tall):

| Type | Trigger | Begrunnelse |
|------|---------|-------------|
| Gi VIP | Community Hero uten VIP-badge | Level + support-score |
| Følg opp | At Risk med høy XP | Var svært aktiv, nå borte |
| Spotlight | Hidden Gem | Høy community_score, lite synlig |
| Takk | Core Member > 10 streams | Lojalitet |

---

## 6. IMPLEMENTERTE FORBEDRINGER (i denne sprinten)

- G1-G7: community-intelligence/route.ts utvidet med alle nye segmenter, AI Memory, cross-platform, anbefalinger
- G8: community-manager/page.tsx viser segment-badge per membre
- G9: ai-producer/route.ts sender community-data til GPT (top membres, at-risk)

---

## 7. GJENVÆRENDE GAPS (ikke implementert)

- **G10 — Raid Manager**: Community-aktivitet ikke brukt. Lav prioritet — mangler data om hvilke membres som deltar i raids
- **Cross-platform Twitch-identitet**: cross_platform_users har mekanismen (LearningAggregator), men confidence er lav (basert på username-match alene). Trenger manuell bekreftelse for høy confidence
- **stream_history → per-membre**: Kan ikke koble enkeltmedlem til spesifikk stream uten ny tabell. streams_attended-feltet gir proxy
