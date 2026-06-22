# Jacob QA — GLENVEX kunde nummer 0

**Mål:** Jacob skal gå fra tom e-postadresse til ferdig stream uten én Discord-melding til Glenn.  
**Regel:** Hvis Jacob trenger hjelp på et steg → det er en bug, ikke en brukerfeil.

Bruk en frisk nettleser (privat vindu) og noter nøyaktig hva som skjer ved feil.

---

## 1. Registrering

| # | Test | Forventet | Status |
|---|------|-----------|--------|
| 1.1 | Gå til `[url]/login` | Login-side med e-post/passord-felt vises | ☐ |
| 1.2 | Opprett konto med ny e-post | Bekreftelses-e-post sendes umiddelbart | ☐ |
| 1.3 | Åpne bekreftelses-lenken | Bekreftet, videresendes til login | ☐ |
| 1.4 | Logg inn med e-post/passord | Videresendes til `/onboarding` | ☐ |
| 1.5 | Prøv å logge inn med feil passord | Tydelig feilmelding — ikke bare blank side | ☐ |

**Kjente risici:** E-post kan havne i spam. Supabase-mailer må ha korrekt From-adresse.

---

## 2. Onboarding

| # | Test | Forventet | Status |
|---|------|-----------|--------|
| 2.1 | Steg 1: Velkomst-skjerm vises | GLENVEX-branding, tydelig "Neste"-knapp | ☐ |
| 2.2 | Steg 2: Koble til Twitch | Klikk → Twitch OAuth åpner, tillat → returnerer tilbake | ☐ |
| 2.3 | Twitch vises som tilkoblet | Brukernavn og profilbilde vises | ☐ |
| 2.4 | Steg 3: Koble til Discord | Discord OAuth → bot-invitasjon → tilbake | ☐ |
| 2.5 | Discord vises som tilkoblet | Server-navn vises | ☐ |
| 2.6 | Steg 4: Velg kanaler | Live-kanal, chat-kanal, notifikasjons-kanal vises | ☐ |
| 2.7 | Lagre kanalvalg | Bekreftelses-melding, fortsett til neste steg | ☐ |
| 2.8 | Steg 5: Aktiver | Klikk fullfør → videresendes til `/` (dashboardet) | ☐ |
| 2.9 | Dashboard åpner uten feil | Ingen røde feil, ingen tomt innhold | ☐ |

**Kjente risici:** Discord bot-invitasjon krever servereier-tillatelse. Kanalene må faktisk eksistere.

---

## 3. Live-stream

*Gjennomfør en ekte stream på Twitch for å teste dette.*

| # | Test | Forventet | Status |
|---|------|-----------|--------|
| 3.1 | Start stream på Twitch | Dashboard skifter til "Live Command Center" innen 30 sek | ☐ |
| 3.2 | Discord live-melding | Bot poster live-varsel i valgt Discord-kanal | ☐ |
| 3.3 | Twitch-bot i chat | Bot svarer i chat (f.eks. !kommando eller auto-hei) | ☐ |
| 3.4 | Mission Queue | Minst én mission vises i Live Command Center | ☐ |
| 3.5 | Kjør poll | Klikk "Start poll" → poll vises i Twitch-chat | ☐ |
| 3.6 | Sponsor-post | Klikk "Send sponsor" → melding i Discord/Twitch | ☐ |
| 3.7 | X-post forslag | AI-generert X-posttekst vises med varianter | ☐ |
| 3.8 | Kopier X-post | Klikk "Kopier" → tekst i utklippstavle | ☐ |
| 3.9 | Raid-forslag | Raid-kandidater vises ved riktig tidspunkt | ☐ |
| 3.10 | Avslutt stream | Dashboard vender tilbake til offline-modus | ☐ |

**Kjente risici:** Bot trenger tid på å starte (Railway cold start). X-post er kopier-only, ingen auto-posting.

---

## 4. Etter stream

| # | Test | Forventet | Status |
|---|------|-----------|--------|
| 4.1 | Stream vises i dashboardet | Hero-kortet viser siste stream med score | ☐ |
| 4.2 | "Hva gjør jeg nå?" vises | Konkrete anbefalinger basert på stream-data | ☐ |
| 4.3 | AI Memory / Innsikter | AiInsightFeed viser praktiske funn (ikke tom) | ☐ |
| 4.4 | Creator Brain lærdomme | Minst én lærdom vises (etter 3+ streams) | ☐ |
| 4.5 | Content Factory | Gå til `/content-factory-admin` → klipp/VOD vises | ☐ |
| 4.6 | Stream Coach | Gå til `/stream-coach` → siste analyse lastes | ☐ |
| 4.7 | Statistikk/rapport | Gå til `/statistikk` → data fra streamen vises | ☐ |
| 4.8 | RecentStreams | Siste streams vises i listen (ikke "Teknisk feil") | ☐ |

**Kjente risici:** Content Factory krever Railway VOD-prosessering. Creator Brain trenger 3+ streams for reelle lærdomme.

---

## 5. Drift og stabilitet

| # | Test | Forventet | Status |
|---|------|-----------|--------|
| 5.1 | La siden stå inaktiv i 2 timer | Refresh data — ikke kastet til login | ☐ |
| 5.2 | Åpne tre nettleser-tabs samtidig | Ingen krasj, ingen race conditions | ☐ |
| 5.3 | Storage Health i Detaljer-seksjonen | Grønn "OK" eller tydelige advarsler | ☐ |
| 5.4 | System Health i Detaljer-seksjonen | Twitch/Discord/Railway-status vises | ☐ |
| 5.5 | Bot offline-melding | Hvis bot er nede: tydelig varsel, ikke stille feil | ☐ |
| 5.6 | Innstillinger | `/innstillinger` åpner, kanalvalg kan endres | ☐ |
| 5.7 | Logg ut | Klikk logg ut → videresendes til `/login` | ☐ |
| 5.8 | Logg inn igjen | Fungerer uten å måtte slette cookies manuelt | ☐ |

---

## 6. Billing ⚠ IKKE IMPLEMENTERT

> Billing/faktura er ikke bygget ennå. Jacob kan ikke teste dette.  
> Må bygges i Sprint A før GLENVEX kan ha betalende kunder.

| # | Test | Forventet | Status |
|---|------|-----------|--------|
| 6.1 | Se abonnement | Pris, plan, neste faktura vises | ❌ Mangler |
| 6.2 | Legg inn betalingskort | Stripe-integrasjon | ❌ Mangler |
| 6.3 | Motta faktura på e-post | PDF-faktura etter betaling | ❌ Mangler |
| 6.4 | Avbryt abonnement | Konto beholder tilgang til perioden slutter | ❌ Mangler |

---

## Slik rapporterer Jacob funn

For hvert problem:
1. **Steg** — hvilken boks i sjekklisten
2. **Hva skjedde** — nøyaktig feilmelding eller oppførsel
3. **URL** — hvilken side
4. **Skjermbilde** — hvis mulig

Bruk Discord-kanalen `#qa-jacob` (eller DM til Glenn) for alle rapporter.

---

*Sist oppdatert: 2026-06-22*  
*Prioritet: Sprint A — SaaS Readiness*
