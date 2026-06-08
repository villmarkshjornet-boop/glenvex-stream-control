# Alpha Validation Framework

**Versjon:** 1.0
**Dato:** 2026-06-08
**Scope:** Eksternt alpha-program med 2–5 streamere.
**Varighet per streamer:** 14 dager observasjonsperiode + 7 dager oppfølging.

---

## DEL 1 — Suksessdefinisjon

Alpha er vellykket hvis **alle primærkravene** er oppfylt og **minst 2 av 3 sekundærkrav** er oppfylt.

### Primærkrav (må-krav)

| # | Krav | Grense | Begrunnelse |
|---|------|--------|-------------|
| P1 | Streamer bruker systemet aktivt i minst **7 sammenhengende dager** | 7 dager | Verifiserer at det ikke bare er nyhetsfølelse som driver bruk |
| P2 | Streamer logger inn i dashbordet minst **3 ganger per uke** | ≥3/uke | Minimal habituel bruk |
| P3 | Minst **én** kjernefunksjon brukes ukentlig uten oppfordring fra oss | 1 funksjon/uke | Selvstendig bruksinitiativ |
| P4 | Systemet forblir oppe i minst **95 % av streamers aktive periode** | 95 % uptime | Teknisk grunnkrav |
| P5 | Streamer ønsker å **fortsette** etter testperioden | Ja/Nei | Retensjons-signal |

### Sekundærkrav (bør-krav)

| # | Krav | Grense |
|---|------|--------|
| S1 | AI Producer brukes aktivt i minst **3 live-sesjoner** | ≥3 sesjoner |
| S2 | Community Manager brukes til å **håndtere minst én hendelse** (level-up, sub, raid) | ≥1 hendelse |
| S3 | Content Factory genererer og streamer **godkjenner minst 1 highlight** | ≥1 highlight |

### Mislykket alpha-signal

Alpha er mislykket hvis **ett eller flere** av følgende inntreffer:

- Streamer avbryter frivillig i løpet av dag 1–5
- Streamer bruker aldri systemet uassistert
- Mer enn 3 kritiske feil (feil som stopper en kjernefunksjon) uten at vi kan reparere innen 24 timer
- Streamer rapporterer at systemet "ikke passer" arbeidsflyten deres etter uke 1

---

## DEL 2 — Metrics

### 2A — Tekniske metrics

Alle tekniske metrics samles automatisk via `system_events`-tabellen i Supabase.

#### Stabilitet

| Metric | Definisjon | Mål | Kritisk grense |
|--------|-----------|-----|----------------|
| **Bot uptime** | % av tid Railway-boten er online vs. forventet oppe | ≥ 95 % | < 90 % |
| **Vercel uptime** | % av API-kall som svarer uten 5xx | ≥ 99 % | < 95 % |
| **Supabase connection rate** | % av DB-spørringer som lykkes | ≥ 99 % | < 97 % |
| **Recovery time** | Tid fra feil oppdages til system er oppe igjen | ≤ 30 min | > 2 timer |

#### Discord

| Metric | Definisjon | Mål |
|--------|-----------|-----|
| **Live notification success rate** | % av live-starter som resulterer i Discord-post | ≥ 95 % |
| **Community events posted** | Antall sub/raid/level-up-meldinger postet i Discord | Telles |
| **Bot command response rate** | % av slash commands som svarer uten feil | ≥ 98 % |

#### Twitch

| Metric | Definisjon | Mål |
|--------|-----------|-----|
| **Stream detection success rate** | % av stream-starter som fanges av boten | ≥ 95 % |
| **Detection latency** | Sekunder fra stream starter til bot reagerer | ≤ 60 s |
| **Sub/raid/cheer detection rate** | % av Twitch-hendelser korrekt fanget | ≥ 98 % |

#### Content Factory

| Metric | Definisjon | Mål |
|--------|-----------|-----|
| **VOD detection success rate** | % av fullførte streams som resulterer i VOD-registrering | ≥ 90 % |
| **Clip pipeline success rate** | % av klipp-jobber som fullføres uten FAILED-status | ≥ 80 % |
| **Thumbnail generation success rate** | % av thumbnails generert uten feil | ≥ 85 % |
| **Pipeline latency (e2e)** | Tid fra stream slutter til første highlight er klar | ≤ 2 timer |

---

### 2B — Produkt-metrics

Produkt-metrics hentes fra `system_events`, `content_highlights`, `community_members` og fremtidig brukerinteraksjonslogging.

#### AI Producer

| Metric | Definisjon | Godt signal |
|--------|-----------|-------------|
| **AI tips generert** | Antall tips-sesjoner kjørt under live | Telles |
| **Tips åpnet** | Antall ganger tips-panelet klikkes på | > 50 % av tips |
| **Tips brukt** (kvalitativ) | Streamer rapporterer at de handlet på et tips | ≥ 1 per uke |
| **Tips ignorert** | Tips generert der streamer ikke rapporterer handling | Telles |

> Merk: Vi kan ikke måle "tips brukt" automatisk — det krever ukentlig check-in med streameren.

#### Community Manager

| Metric | Definisjon | Godt signal |
|--------|-----------|-------------|
| **Level-ups prosessert** | Antall Discord-meldinger sendt for level-up | Telles |
| **Community hendelser håndtert** | Sub/raid/gift sub-anerkjennelser | ≥ 3/uke |
| **Leaderboard-visninger** | `/topp`-kommando brukt | Telles |
| **Manuell community-handling** | Streamer endrer XP/nivå/badge manuelt | Telles |

#### Raid Manager

| Metric | Definisjon | Godt signal |
|--------|-----------|-------------|
| **Raid-anbefalinger vist** | Antall ganger raid-manager besøkes | Telles |
| **Anbefalinger fulgt** | Streamer raider foreslått kanal | ≥ 1 raid/uke |
| **Anbefalinger avvist** | Streamer raider andre enn foreslått | Telles — ikke negativt |

#### Content Factory

| Metric | Definisjon | Godt signal |
|--------|-----------|-------------|
| **Highlights generert** | Antall highlight-forslag produsert | Telles |
| **Highlights godkjent** | Highlights streamer beholder etter review | ≥ 50 % av genererte |
| **Highlights avvist** | Highlights slettet i QA | < 50 % av genererte |
| **ZIP-nedlastinger** | Antall ganger streamer laster ned klipp-pakke | ≥ 1 per stream |
| **Thumbnails brukt** | Streamer bruker generert thumbnail (kvalitativ) | ≥ 1 per stream |

#### Generell plattform

| Metric | Definisjon | Godt signal |
|--------|-----------|-------------|
| **Dashboard-besøk** | Unike daglige besøk | ≥ 3/uke |
| **Sider besøkt per sesjon** | Gjennomsnittlig dybde per besøk | ≥ 2 sider |
| **Funksjoner aldri brukt** | Sider/funksjoner med 0 besøk etter 14 dager | Identifiser — vurder deprioritering |
| **Returnerende besøk** | % av besøk fra eksisterende bruker (ikke første gang) | ≥ 70 % |

---

## DEL 3 — Feedback-skjema

Gjennomføres som **uformell 20-minutters samtale** (ikke spørreskjema) etter dag 7 og dag 14.
Følgende spørsmål brukes som struktur. Intervjueren noterer, stilte ikke rigid rekkefølge.

---

### Intervjuguide — Uke 1 (dag 7)

**Åpning:** "Ingen riktige eller gale svar. Vi vil forstå opplevelsen din, ikke forsvare produktet."

**Del A — Første inntrykk**
1. Hva var det første du tenkte da du begynte å bruke systemet?
2. Var det noe du ikke forsto da du satte det opp?
3. Hva tok lengst tid å forstå?

**Del B — Bruk**
4. Hva har du brukt mest denne uken?
5. Hva har du ikke rørt i det hele tatt?
6. Er det noe du forventet å finne, men som ikke var der?

**Del C — Verdi**
7. Har systemet spart deg for tid? Hva slags tid?
8. Har det gitt deg informasjon du ikke hadde fra før?
9. Har du gjort noe annerledes i streamen din på grunn av det du så i systemet?

---

### Intervjuguide — Uke 2 (dag 14)

**Del A — Vane**
1. Er systemet blitt en del av rutinen din? Hva bruker du det til?
2. Er det noe du sjekker automatisk nå, uten å tenke over det?

**Del B — Friksjon**
3. Hva forstod du fremdeles ikke etter to uker?
4. Hva er kjedeligst eller mest irriterende?
5. Har du hatt tekniske problemer? Hvilke?

**Del C — Verdi og betalingsvilje**
6. Hva ville du savnet hvis systemet forsvant i morgen?
7. Hva ville du **ikke** savnet?
8. Hva ville du vært villig til å betale for — og hva ville du betalt?
   - Alternativ A: Betale per måned for hele systemet
   - Alternativ B: Betale kun for Content Factory
   - Alternativ C: Betale kun for Community Manager
   - Alternativ D: Ingenting — det er ikke verdt å betale for

**Del D — Fremtid**
9. Hva skulle systemet gjøre som det ikke gjør i dag?
10. Ville du anbefalt dette til en annen streamer? Hvorfor / hvorfor ikke?

---

### Skjema — Kvantitativ del (sendes på e-post etter samtalen)

Skala 1–5 der 1 = veldig uenig, 5 = veldig enig.

| Påstand | Score |
|---------|-------|
| Systemet var enkelt å sette opp | __ |
| Dashbordet er lett å forstå | __ |
| AI Producer gir nyttige tips | __ |
| Community Manager sparer meg for tid | __ |
| Content Factory er nyttig for produksjonen min | __ |
| Jeg stoler på dataene systemet viser | __ |
| Jeg ville anbefalt dette til en venn | __ |
| Jeg ønsker å fortsette å bruke dette etter testperioden | __ |

**Åpent felt:** "Én ting du vil vi skal vite:"

---

## DEL 4 — Alpha-score (0–100)

Alpha-scoren beregnes etter 14 dager. Brukes til å sammenligne streamere og spore forbedringer over tid.

### Beregningsmodell

```
Alpha Score = Stabilitetsscore + Aktivitetsscore + Verdiscore + Retensjonsscore
```

---

### Komponent 1: Stabilitetsscore (maks 25 poeng)

| Metric | Poeng |
|--------|-------|
| Bot uptime ≥ 99 % | 10 |
| Bot uptime 95–99 % | 6 |
| Bot uptime < 95 % | 0 |
| Ingen kritiske feil (stopper kjerneflyt) | 10 |
| 1 kritisk feil, fikset < 24 t | 6 |
| 2+ kritiske feil | 0 |
| Vercel API feilet < 1 % av kall | 5 |
| Vercel API feilet 1–5 % | 3 |
| Vercel API feilet > 5 % | 0 |

---

### Komponent 2: Aktivitetsscore (maks 30 poeng)

| Metric | Poeng |
|--------|-------|
| Dashboard besøkt ≥ 5 dager av 14 | 10 |
| Dashboard besøkt 3–4 dager av 14 | 6 |
| Dashboard besøkt 1–2 dager av 14 | 2 |
| AI Producer brukt ≥ 3 ganger | 8 |
| AI Producer brukt 1–2 ganger | 4 |
| AI Producer aldri brukt | 0 |
| Content Factory: ≥ 1 highlight godkjent | 6 |
| Content Factory: brukt men ingen godkjent | 3 |
| Content Factory: aldri brukt | 0 |
| Raid Manager besøkt ≥ 2 ganger | 3 |
| Community Manager brukt ≥ 3 ganger | 3 |

---

### Komponent 3: Verdiscore (maks 25 poeng)

Basert på svar i uke 2-intervjuet og kvantitativt skjema.

| Signal | Poeng |
|--------|-------|
| Gjennomsnittsscore på kvantitativt skjema ≥ 4.0 | 15 |
| Gjennomsnittsscore 3.0–3.9 | 9 |
| Gjennomsnittsscore < 3.0 | 3 |
| Streamer nevner konkret endring i stream-rutine pga. systemet | 5 |
| Streamer nevner vilje til å betale for minst én funksjon | 5 |

---

### Komponent 4: Retensjonsscore (maks 20 poeng)

| Signal | Poeng |
|--------|-------|
| Ønsker å fortsette etter testperioden | 10 |
| Vil anbefale til en venn (score 4–5) | 5 |
| Brukte systemet uassistert (uten oppfordring fra oss) | 5 |

---

### Tolkning av alpha-score

| Score | Vurdering | Implikasjon |
|-------|-----------|-------------|
| 85–100 | Sterk alpha | Klar for flere alpha-brukere |
| 70–84 | Godkjent alpha | Godkjent med kjente svakheter som må adresseres |
| 55–69 | Marginal alpha | Spesifikk friksjon må løses før skalering |
| 40–54 | Svak alpha | Produktet løser ikke tydelig nok et reelt behov |
| < 40 | Feilet alpha | Stopp — identifiser grunnleggende problem før videre |

---

## DEL 5 — Exit-kriterier

### 5A — Klar for flere alpha-brukere

**Vilkår (alle må være oppfylt):**
- [ ] Minst **2 av de første alpha-streamerne** har fullført 14-dagers periode
- [ ] Gjennomsnittlig alpha-score ≥ **70**
- [ ] Ingen uløste kritiske bugs i produksjon
- [ ] `alpha-checklist.md` og `alpha-setup-guide.md` er verifisert mot faktisk onboarding
- [ ] Vi kan sette opp en ny streamer på **under 2 timer** uten at vi er tilstede

**Kapasitet:** Maks 8 samtidige alpha-brukere (Railway + Vercel + manuell oppfølging er tidsbegrenset).

---

### 5B — Klar for beta

**Vilkår (alle må være oppfylt):**
- [ ] Minst **5 alpha-brukere** har fullført validering
- [ ] Gjennomsnittlig alpha-score ≥ **75**
- [ ] Gjennomsnittlig retensjonsscore ≥ **15 av 20**
- [ ] Minst **3 streamere** ønsker å fortsette etter testperioden
- [ ] Minst **2 betalingsintensjonssignaler** fra intervjuene ("jeg ville betalt X")
- [ ] Oppsett kan gjøres **uten manuell hjelp fra oss** (onboarding wizard eller tydelig selvbetjening)
- [ ] Ingen kjente bugs som stopper kjerneflyt uten workaround

**Hva beta innebærer:** Streamere setter opp selv, betaler (eller er på gratisnivå), vi er ikke inne og hjelper manuelt.

---

### 5C — Klar for onboarding-utvikling

Onboarding-wizard bygges **ikke** før dette er oppfylt:

- [ ] Vi har manuelt onboardet minst **3 streamere** og dokumentert alle stegene
- [ ] Vi har identifisert de **3 vanligste konfigurasjonsfeilene** fra alpha
- [ ] Vi vet hvilke env vars som er **forvirrende** og hvilke som er trivielle
- [ ] Vi vet hvilken **rekkefølge** stegene bør gjøres i (Supabase før Discord? Discord før Twitch?)
- [ ] Alpha-score for minst én streamer ≥ **80**

**Begrunnelse:** Onboarding-wizard designet uten brukerdata vil optimere for feil steg i feil rekkefølge. Manuell onboarding gir innsikten vi trenger for å bygge riktig wizard.

---

## Vedlegg — Observasjonslogg per streamer

For hver alpha-bruker, hold en enkel logg:

```
Streamer: [navn]
WORKSPACE_ID: [slug]
Start: [dato]
Slutt: [dato]

Dag 1:
- Oppsatt OK? [Ja/Nei, noter problemer]
- Første inntrykk (stikkord):

Dag 3:
- Aktiv? [Ja/Nei]
- Observerte hendelsesr:

Dag 7:
- Uke 1-intervju gjennomført? [Ja/Nei]
- Nøkkelfunn:
- Kritiske problemer:

Dag 14:
- Uke 2-intervju gjennomført? [Ja/Nei]
- Nøkkelfunn:
- Ønsker å fortsette? [Ja/Nei]

Alpha-score:
  Stabilitet: __ / 25
  Aktivitet:  __ / 30
  Verdi:      __ / 25
  Retensjon:  __ / 20
  Total:      __ / 100

Konklusjon:
```
