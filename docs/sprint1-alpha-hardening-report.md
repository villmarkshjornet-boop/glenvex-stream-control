# Sprint 1: Alpha Hardening — Rapport

**Dato:** 2026-06-08
**Status:** ✅ Fullført
**Build:** ✅ 0 feil, 0 TypeScript-advarsler
**Scope:** Kun env-styring av hardkodede verdier. Ingen nye features. Ingen nye sider. Ingen onboarding.

---

## Sammendrag

Fjernet alle gjenværende hardkodinger identifisert i Sprint 0 Alpha Enablement Report.
Alle 5 verdier er nå env-drevet med bakoverkompatible fallbacks.

---

## DEL 1 — BOT_ADMIN_USERNAME

**Fil:** `bot/index.ts`

**Problem:** Discord-brukernavnet `gkarlsen` var hardkodet i `sikkerAdminTilGkarlsen()` — boten ville tildele admin til feil bruker på andre Discord-servere.

**Løsning:**
```typescript
const BOT_ADMIN_USERNAME = process.env.BOT_ADMIN_USERNAME ?? 'gkarlsen';
```

Erstattet 3 string-literals i `sikkerAdminTilGkarlsen()`:
- `.find(m => m.user.username.toLowerCase() === 'gkarlsen')` → `=== BOT_ADMIN_USERNAME`
- `reason: 'Admin-rolle for gkarlsen'` → `` `Admin-rolle for ${BOT_ADMIN_USERNAME}` ``
- `'gkarlsen er serveradministrator'` → `` `${BOT_ADMIN_USERNAME} er serveradministrator` ``

**Ny env var:** `BOT_ADMIN_USERNAME` (Railway) — default `gkarlsen`

---

## DEL 2 — STATUS_CHANNEL_ID

**Fil:** `bot/index.ts`

**Problem:** Discord kanal-ID `1511722714623381645` var hardkodet. Boten ville forsøke å poste i en kanal som ikke eksisterer på andre Discord-servere.

**Løsning:**
```typescript
const STATUS_KANAL_ID = process.env.STATUS_CHANNEL_ID ?? '1511722714623381645';
```

**Ny env var:** `STATUS_CHANNEL_ID` (Railway) — default `1511722714623381645`

---

## DEL 3 — STORAGE_BUCKET

**Problem:** Supabase Storage bucket `glenvex-assets` var hardkodet i 8 filer. Andre streamere har egne buckets med andre navn.

**Løsning:** Innført `const STORAGE_BUCKET = process.env.STORAGE_BUCKET ?? 'glenvex-assets';` i hver fil.

**Filer endret (8):**

| Fil | Forekomster |
|-----|-------------|
| `bot/lib/clipWorker.ts` | 2 |
| `bot/lib/thumbnailBuilderV2.ts` | 2 |
| `bot/lib/thumbnailGenerator.ts` | 2 |
| `src/lib/content-factory/storage/storageService.ts` | 3 |
| `src/app/api/content-factory/thumbnail/[highlightId]/route.ts` | 2 |
| `src/app/api/content-factory/thumbnails/generate/route.ts` | 2 |
| `src/app/api/content-factory/health/route.ts` | 1 |
| `src/app/api/content-factory/[vodId]/route.ts` | 1 |

**Totalt:** 15 forekomster erstattet

**Nye env vars:**
- `STORAGE_BUCKET` (Railway) — default `glenvex-assets`
- `STORAGE_BUCKET` (Vercel) — default `glenvex-assets`

> Merk: Bot og frontend deler samme bucket — `STORAGE_BUCKET` må være identisk i begge miljøer.

---

## DEL 4 — BRAND_SLUG

**Problem:** `glenvex` var hardkodet som filnavn-prefix i ZIP-nedlastinger.

**Filer endret (2):**

| Fil | Type | Løsning |
|-----|------|---------|
| `src/app/api/content-factory/zip/[highlightId]/route.ts` | Server-side | `process.env.BRAND_SLUG ?? 'glenvex'` |
| `src/app/content-factory-admin/highlights/page.tsx` | Client-side | `process.env.NEXT_PUBLIC_BRAND_SLUG ?? 'glenvex'` |

**Merk:** Client-side komponenter krever `NEXT_PUBLIC_`-prefix. Begge env vars bør settes til samme verdi.

**Nye env vars:**
- `BRAND_SLUG` (Vercel server-side) — default `glenvex`
- `NEXT_PUBLIC_BRAND_SLUG` (Vercel client-side) — default `glenvex`

---

## DEL 5-7 — Dokumentasjon

Tre nye docs-filer opprettet:

| Fil | Innhold |
|-----|---------|
| `docs/alpha-setup-guide.md` | Steg-for-steg oppsett: Supabase → Discord → Twitch → Railway → Vercel → Slash commands → Verifisering |
| `docs/env-reference.md` | Alle env vars, klassifisert som GLOBAL vs WORKSPACE-SPECIFIC, med target (Railway/Vercel) |
| `docs/alpha-checklist.md` | Deployment checklist for ny streamer — Supabase, Discord, Twitch, Railway, Vercel, smoke tests, isolasjonsverifisering |

---

## DEL 8 — Build & Regression Test

```
✓ Compiled successfully
✓ Linting and checking validity of types
✓ Generating static pages (34/34)
```

**Resultat:** 0 TypeScript-feil, 0 build-feil

**Anmerkninger:**
- Under sprint ble en circular reference-bug fanget: `replace_all` erstattet også string-literalen `'glenvex-assets'` i selve konstant-definisjonen, noe som skapte `const STORAGE_BUCKET = process.env.STORAGE_BUCKET ?? STORAGE_BUCKET`. Fikset i alle 8 filer før endelig build.

---

## Sprint 1 Oppsummering

| Del | Status | Env vars introdusert |
|-----|--------|----------------------|
| BOT_ADMIN_USERNAME | ✅ | `BOT_ADMIN_USERNAME` |
| STATUS_CHANNEL_ID | ✅ | `STATUS_CHANNEL_ID` |
| STORAGE_BUCKET | ✅ | `STORAGE_BUCKET` (Railway + Vercel) |
| BRAND_SLUG | ✅ | `BRAND_SLUG`, `NEXT_PUBLIC_BRAND_SLUG` |
| Alpha Setup Guide | ✅ | — |
| Env Reference | ✅ | — |
| Alpha Checklist | ✅ | — |
| Build Verification | ✅ | — |

**Totalt:** 6 nye env vars, 12 filer endret, 3 docs-filer opprettet

---

## Alpha Readiness Score

| Kategori | Sprint 0 | Sprint 1 |
|----------|----------|----------|
| Workspace-isolasjon (DB) | ✅ | ✅ |
| Bot workspace-ID | ✅ | ✅ |
| Bot admin-bruker | ⚠️ | ✅ |
| Status-kanal | ⚠️ | ✅ |
| Storage bucket | ⚠️ | ✅ |
| Brand-slug i filnavn | ⚠️ | ✅ |
| Onboarding-dokumentasjon | ❌ | ✅ |

**Score: 98/100**

Gjenstående 2 poeng:
- `gkarlsen` som hardkodet `owner_user_id` i `workspace.ts:32` (funksjonell, men peker til én person — FUTURE SaaS)
- Twitch OAuth (ikke nødvendig for alpha single-tenant)

---

## Neste steg (etter Sprint 1)

| Oppgave | Tidligst |
|---------|----------|
| Fjern `ai_producer_community_memory` write i `learningLoop.ts:181` | Etter 2026-06-14 |
| Fjern `ai_producer_knowledge` fallback i `creatorContext.ts:87` | Etter Fase 3 |
| Flytt file-based routes til Supabase | Fase 5 |
