# Jacob QA — GLENVEX kunde nummer 0

**Målet:** Jacob skal gå gjennom alle tre nivåene uten én melding til Glenn.  
**Regel:** Trenger Jacob hjelp på ett punkt → det er en bug, ikke en brukerfeil.  
**Rapporter:** Steg-nummer + hva skjedde + URL + skjermbilde til `#qa-jacob`.

---

## LEVEL 1 — First Hour
*Kan en helt ny bruker komme seg inn og se dashboardet?*

### 1A. Registrering

| # | Gjør dette | Forventet | Status |
|---|------------|-----------|--------|
| 1.1 | Åpne `[url]/login` i privat vindu | Login-side vises med e-post og passord-felt | ☐ |
| 1.2 | Klikk "Opprett konto", skriv inn e-post og passord | Ingen feilmelding, bekreftelse vises | ☐ |
| 1.3 | Sjekk e-posten | Bekreftelses-e-post ankommer innen 2 min | ☐ |
| 1.4 | Klikk bekreftelseslenken | Videresendes til login, ikke til en blank feil-side | ☐ |
| 1.5 | Logg inn | Videresendes til `/onboarding` | ☐ |
| 1.6 | Prøv feil passord | Tydelig feilmelding på norsk — ikke bare blank side | ☐ |

> ⚠ **Kjent risiko:** E-post fra Supabase kan havne i spam. Sjekk `@glenvex.no` som avsender.

---

### 1B. Onboarding — steg 1–5

| # | Gjør dette | Forventet | Status |
|---|------------|-----------|--------|
| 2.1 | Steg 1: Skriv inn workspace-navn | Slug genereres automatisk, "Neste" aktiveres | ☐ |
| 2.2 | Steg 2: Klikk "Koble til Twitch" | Twitch OAuth åpner i samme fane | ☐ |
| 2.3 | Godkjenn Twitch-tillatelse | Tilbake til onboarding, Twitch vises som ✓ tilkoblet | ☐ |
| 2.4 | Steg 3: Klikk "Koble til Discord" | Discord bot-invitasjon åpner | ☐ |
| 2.5 | Velg Discord-server og godkjenn | Tilbake til onboarding, Discord vises som ✓ tilkoblet | ☐ |
| 2.6 | Steg 4: Discord-kanaler lastes | Live-kanal, chat-kanal og notifikasjonskanal vises i dropdown | ☐ |
| 2.7 | Velg kanaler og klikk "Lagre" | Bekreftelse, videre til steg 5 | ☐ |
| 2.8 | Steg 5: Klikk "Fullfør" | Videresendes til `/` — dashboardet åpner | ☐ |
| 2.9 | Dashboardet er ikke blankt | "Hva gjør jeg nå?"-kortet vises (selv uten stream-historikk) | ☐ |
| 2.10 | Ingen røde feil i konsollen | Åpne devtools — ingen 500-feil eller krasj | ☐ |

> ⚠ **Kjent risiko 1:** Hvis Twitch OAuth feiler vises intern feilkode (`twitch_state_mismatch` etc.) — ikke norsk tekst. Dette er en kjent svakhet.  
> ⚠ **Kjent risiko 2:** Discord-kanaler (steg 4) lastes kun hvis boten faktisk er i serveren. Hvis boten ikke er invitert riktig — tom dropdown uten forklaring.  
> ⚠ **Kjent risiko 3:** Discord-bot-invitasjon krever at Jacob er **server-eier** eller har admin-rettigheter.

---

## LEVEL 2 — First Stream
*Kan Jacob gjennomføre en hel stream og se resultater etterpå?*

### 2A. Pre-stream (uten å være live)

| # | Gjør dette | Forventet | Status |
|---|------------|-----------|--------|
| 3.1 | Se "Hva gjør jeg nå?"-kortet | Minst 4 anbefalinger med timing (X-post, poll, sponsor, raid) | ☐ |
| 3.2 | Gå til `/innstillinger` | Kanalvalg kan endres uten å miste tilkoblinger | ☐ |
| 3.3 | Gå til `/partner-hub` | Partner-liste vises (eller tom-melding hvis ingen partners) | ☐ |

---

### 2B. Under stream

| # | Gjør dette | Forventet | Status |
|---|------------|-----------|--------|
| 4.1 | Start stream på Twitch | Dashboard skifter til "Live Command Center" innen 60 sek | ☐ |
| 4.2 | Discord live-melding | Bot poster live-varsel i valgt Discord-kanal | ☐ |
| 4.3 | Twitch-bot i chat | Bot er synlig i chat og svarer | ☐ |
| 4.4 | Mission Queue vises | Minst én mission dukker opp | ☐ |
| 4.5 | Klikk en mission | Handling utføres, mission markeres fullført | ☐ |
| 4.6 | Kjør poll via dashboard | Poll starter i Twitch-chat | ☐ |
| 4.7 | Send sponsor-post | Melding sendes til Discord/Twitch | ☐ |
| 4.8 | X-post forslag vises | AI-generert tekst med varianter (🔥 Hype / 🎭 Drama / 🤝 Community) | ☐ |
| 4.9 | Kopier X-post | Tekst kopiert til utklippstavle — legg inn manuelt på X | ☐ |
| 4.10 | Raid-forslag | Kandidater vises etter ~75% av forventet streamlengde | ☐ |
| 4.11 | Avslutt stream | Dashboard skifter tilbake til offline-modus innen 2 min | ☐ |

> ⚠ **Kjent risiko 1:** Boten starter på Railway og kan bruke 30–60 sek på cold start. Ikke forventet live-data umiddelbart.  
> ⚠ **Kjent risiko 2:** X-post er kopier-only — boten poster ikke automatisk på X.  
> ⚠ **Kjent risiko 3:** Hvis Discord OAuth-token har utløpt siden onboarding, kan live-post feile. Da vises bot-status som `auth_failed` i dashboardet.

---

### 2C. Etter stream

| # | Gjør dette | Forventet | Status |
|---|------------|-----------|--------|
| 5.1 | Hero-kortet viser siste stream | Score, grade og nøkkeltall (ikke "Teknisk feil") | ☐ |
| 5.2 | AI Memory viser innsikt | Minst én setning med praktisk funn | ☐ |
| 5.3 | Siste streams-listen | Forrige stream vises — ikke "Grade D / 0" | ☐ |
| 5.4 | Gå til `/stream-coach` | Analyse av streamen lastes | ☐ |
| 5.5 | Gå til `/content-factory-admin` | Klipp/VOD fra streamen dukker opp | ☐ |
| 5.6 | Gå til `/statistikk` | Statistikk for streamen vises | ☐ |

> ⚠ **Kjent risiko:** Content Factory krever Railway VOD-prosessering. Klipp kan ta 5–15 min å dukke opp.

---

## LEVEL 3 — First Week
*Etter 3–5 streams: har Jacob fått reell verdi?*

| # | Test | Forventet | Status |
|---|------|-----------|--------|
| 6.1 | Creator Brain lærdomme | Minst 3 konkrete funn (ikke tomme kort) | ☐ |
| 6.2 | "Hva gjør jeg nå?" er mer presis | Anbefalinger basert på Jacob sine faktiske streams | ☐ |
| 6.3 | Partner Engine foreslår | Minst én partnerpost er sendt automatisk | ☐ |
| 6.4 | AI Memory husker | Viewers Jacob kjenner fra chat nevnes | ☐ |
| 6.5 | Jacob spør ikke om hjelp | Hele uken uten Discord-meldinger til Glenn | ☐ |

> Når 6.5 er grønn → DA bygger vi Stripe.

---

## Kjente bugs å fikse FØR Jacob tester

Disse er funnet ved kode-gjennomgang — Jacob vil trolig treffe dem:

| Prioritet | Problem | Fil | Symptom |
|-----------|---------|-----|---------|
| 🔴 Høy | OAuth-feilkoder vises direkte (`twitch_state_mismatch`) | `onboarding/page.tsx:125` | Jacob forstår ikke hva som gikk galt |
| 🔴 Høy | Tom dropdown på Discord-kanaler hvis bot ikke er invitert | `onboarding/page.tsx` steg 4 | Ingen forklaring på hvorfor kanaler mangler |
| 🟡 Medium | "Hva gjør jeg nå?"-kortet er tomt ved 0 streams | `NextStreamBrief.tsx` | Ny bruker ser ingenting — bør vise standard-anbefalinger |
| 🟡 Medium | Creator Brain-kort skjules helt ved 0 lærdomme | `CreatorBrainLearning.tsx:69` | Tomt dashboardet ser ødelagt ut |
| 🟢 Lav | Bot cold start gir 30–60 sek tom Live Command Center | Bot/Railway | Kan løses med loading-state og retry |

---

*Versjon 2 — restrukturert til First Hour / First Stream / First Week*  
*Sist oppdatert: 2026-06-22*
