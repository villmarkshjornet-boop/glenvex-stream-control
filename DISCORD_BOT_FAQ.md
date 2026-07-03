# GLENVEX Discord Bot — Komplett guide

> Alt du trenger å vite om hva boten gjør, hvilke kommandoer som finnes og hvordan systemene henger sammen.

---

## Innholdsfortegnelse

1. [Profil og XP](#1-profil-og-xp)
2. [Rank-systemet](#2-rank-systemet)
3. [Coins](#3-coins)
4. [Badges](#4-badges)
5. [Achievements](#5-achievements)
6. [Quests](#6-quests)
7. [Samlekort (Persona Cards)](#7-samlekort-persona-cards)
8. [Casino — Blackjack](#8-casino--blackjack)
9. [Casino — Roulette](#9-casino--roulette)
10. [Prestige](#10-prestige)
11. [Hero of the Day](#11-hero-of-the-day)
12. [Twitch-integrasjon](#12-twitch-integrasjon)
13. [Handel med kort](#13-handel-med-kort)
14. [Alle kommandoer — oversikt](#14-alle-kommandoer--oversikt)

---

## 1. Profil og XP

### `/profil [bruker]`
Viser din komplette profil. Utelat `bruker` for å se din egen.

**Hva vises:**
- Nåværende level og XP til neste level (med progress bar)
- Rank i serveren (f.eks. #3 av 47 — Topp 6%)
- Aktiv rang (Noob / Rookie / … / Mythic) og perk-multiplikatorer
- Prestige-nivå (⭐I, ⭐⭐II osv.) hvis du har prestige-et
- Coins-saldo
- Streak (antall dager på rad med aktivitet)
- Badges opptjent
- XP-fordeling (hvor XP-en din kom fra)
- Fremgang mot neste badge

### Slik tjener du XP

| Aktivitet | XP |
|---|---|
| Melding sendt | +5 XP |
| Reaksjon gitt | +2 XP |
| Voice channel (per minutt) | +1 XP |
| Se stream | +50 XP per stream |
| Twitch sub | +200 XP |
| Gifted sub | +100 XP |
| Delta i raid | +500 XP |

---

## 2. Rank-systemet

Ranken din oppdateres automatisk basert på level. Høyere rank = bedre multiplikatorer på XP og coins.

| Level | Rang | XP-multiplikator | Coins-multiplikator |
|---|---|---|---|
| 1–10 | 🌱 Noob | 1.0× | 1.0× |
| 11–20 | 🔰 Rookie | 1.1× | 1.1× |
| 21–30 | 🧭 Explorer | 1.2× | 1.2× |
| 31–40 | ⚔️ Survivor | 1.3× | 1.3× |
| 41–50 | 🛡️ Veteran | 1.5× | 1.5× |
| 51–60 | 💎 Elite | 1.75× | 1.75× |
| 61–75 | 🌟 Legend | 2.0× | 2.0× |
| 76–100 | 👑 Mythic | 2.5× | 2.5× |

---

## 3. Coins

Coins er serverens virtuelle valuta. **Ingen ekte penger involvert.**

**Slik tjener du coins:**
- Automatisk gjennom XP-aktiviteter (se rank-multiplikatorer)
- Fullføre quests
- Låse opp achievements
- Vinne i Blackjack eller Roulette
- Selge samlekort

**Slik bruker du coins:**
- Reroll persona-kort: **100 coins**
- Blackjack innsats: 10–1 000 coins
- Roulette innsats: 5–500 coins

Alle transaksjoner logges i systemet for gjennomsiktighet.

---

## 4. Badges

Badges vises på profilen din. Det finnes tre typer:

| Type | Forklaring |
|---|---|
| **Auto** | Tildeles automatisk når du møter kravene |
| **Manual** | Tildeles manuelt av admin/mod |
| **Admin** | Spesielle badges kun admins kan gi |

### Tilgjengelige badges

| Badge | Ikon | Krav | Type |
|---|---|---|---|
| H4ckerman | ⚡ | Tildelt av admin | Admin |
| Veteran 1 år | 📅 | 365 dager i serveren | Auto |
| Veteran 2 år | 📆 | 730 dager i serveren | Auto |
| Sub Loyalist | 💜 | 12+ måneders Twitch sub (via `/linktwitch`) | Auto |
| Chatty | 💬 | 1 000 meldinger sendt | Auto |
| OG | 🏅 | Original community-medlem | Manual |
| Raider | ⚔️ | Deltatt i 3+ raids | Auto |

Auto-badges sjekkes automatisk etter aktivitet. Du trenger ikke gjøre noe ekstra.

---

## 5. Achievements

### `/achievements`
Viser alle achievements du har låst opp, med ikoner og dato.

Det finnes **17 achievements** fordelt på 5 kategorier:

### Social
| Achievement | Krav | Belønning |
|---|---|---|
| 💬 Første ord | Send 1 melding | 10 XP + 5 coins |
| 🗨️ Pratsom | Send 100 meldinger | 50 XP + 25 coins |
| 💬 Snakkesalig | Send 1 000 meldinger | 200 XP + 100 coins |
| ⚔️ Første raid | Delta i 1 raid | 30 XP + 15 coins |
| 🛡️ Raid-veteran | Delta i 10 raids | 150 XP + 75 coins |
| 🦸 Dagens Helt | Bli valgt som Hero of the Day | 200 XP + 100 coins |

### Loyalty
| Achievement | Krav | Belønning |
|---|---|---|
| 🔰 Level 10 | Nå level 10 | 50 coins |
| ⭐ Halvveis | Nå level 50 | 250 coins |
| 👑 Maxed Out | Nå level 100 | 1 000 coins |
| ⭐ Prestige I | Oppnå første prestige | 500 coins |
| 🔥 Uke-dedikert | 7-dagers streak | 100 XP + 50 coins |
| 🔥 En hel måned | 30-dagers streak | 500 XP + 250 coins |

### Economy
| Achievement | Krav | Belønning |
|---|---|---|
| 🐷 Sparegris | Tjen 1 000 coins totalt | 50 XP |
| 💰 Finansgeni | Tjen 10 000 coins totalt | 200 XP |

### Games
| Achievement | Krav | Belønning |
|---|---|---|
| 🃏 Første Blackjack | Spill ditt første blackjack-parti | 20 XP + 10 coins |
| 🎡 Første Spin | Spill din første roulette | 20 XP + 10 coins |

### Hemmelig
| Achievement | Krav | Belønning |
|---|---|---|
| ⚡ ??? | Hemmelig | 500 XP + 500 coins |

---

## 6. Quests

### `/quests [type]`
Viser dine aktive quests og fremgang. Velg `daily` eller `weekly` for å filtrere.

Quests resetter automatisk:
- **Daglige** — midnatt hver natt
- **Ukentlige** — mandag morgen

### Daglige quests

| Quest | Mål | Belønning |
|---|---|---|
| Daglig snakker | Send 5 meldinger | 20 XP + 10 coins |
| Aktiv i dag | Send 20 meldinger | 50 XP + 25 coins |
| Voice-tid | 30 min i voice | 40 XP + 20 coins |
| Gamer | Spill 1 casino-spill | 15 XP + 5 coins |
| Reaksjonær | Reager på 5 meldinger | 15 XP + 5 coins |

### Ukentlige quests

| Quest | Mål | Belønning |
|---|---|---|
| Ukens chatter | Send 100 meldinger | 200 XP + 100 coins |
| Voice-dedikert | 2 timer i voice | 150 XP + 75 coins |
| Casino-uke | Spill 5 casino-spill | 100 XP + 50 coins |
| Økonom | Tjen 1 000 coins denne uken | 300 XP |

---

## 7. Samlekort (Persona Cards)

### `/persona [reroll]`
Genererer ditt personlige AI-samlekort basert på hvem du er i serveren. Kortet er unikt for deg.

**Første gang:** Gratis  
**Reroll:** Koster **100 coins**

Kortet har en sjeldenhet basert på din aktivitet og litt flaks:

| Sjeldenhet | Sjanse | Salgspris |
|---|---|---|
| ⬜ Common | 55 % | 10 coins |
| 🟩 Uncommon | 28 % | 30 coins |
| 🟦 Rare | 12 % | 100 coins |
| 🟪 Epic | 4 % | 300 coins |
| 🟧 Legendary | 0.9 % | 1 000 coins |
| 🔴 Mythic | 0.1 % | 5 000 coins |

### Pity-systemet (garanterte odds)
Du aldri «uheldig for alltid»:
- **5 Common på rad** → neste kort er minst Uncommon
- **15 trekk uten Rare** → neste kort er minst Rare
- **40 trekk uten Epic** → doblet sjanse for Epic

### `/minekort`
Se alle kortene dine. Blar gjennom ett og ett med knappene ◀ ▶.

**Hva du kan gjøre med kortene:**
- **💰 Selg** — selg kortet for coins (se pris i knapp-teksten). Vises bekreftelsesdialog før salg. Selger du et kort forsvinner det for alltid.
- **⭐ Showcase** — sett kortet som showcase på profilen din. Du kan bare ha ett showcase-kort om gangen.
- **🎴 Trekk nytt** — går til `/persona` for å trekke et nytt kort

**Regler:**
- Solgte kort kan ikke selges igjen, trades eller settes som showcase
- Kort som er i en aktiv trade kan ikke selges

---

## 8. Casino — Blackjack

### `/blackjack <innsats>`
Klassisk Blackjack mot dealer. Innsats: **10–1 000 coins**. Cooldown: **5 minutter** mellom partier.

**Regler:**
- Du og dealer får 2 kort. Dealer viser bare ett kort.
- Mål: Kom nærmest 21 uten å gå over.
- **Hit** — trekk nytt kort
- **Stand** — stopp, la dealer spille
- Dealer hitter alltid til de har 17+

**Utbetalinger:**
| Resultat | Utbetaling |
|---|---|
| Blackjack (21 på første to kort) | 1.5× innsats |
| Vanlig seier | 1× innsats |
| Push (uavgjort) | Innsats tilbake |
| Tap | Mister innsatsen |

All RNG logges server-side for sporbarhet.

---

## 9. Casino — Roulette

### `/roulette <innsats> <type> [nummer]`
Europeisk roulette (enkelt null). Innsats: **5–500 coins**. Cooldown: **3 minutter**.

**Satsingstyper:**

| Type | Odds | Utbetaling |
|---|---|---|
| `rød` / `svart` | ~48.6% | 1× innsats |
| `odde` / `partall` | ~48.6% | 1× innsats |
| `1til18` / `19til36` | ~48.6% | 1× innsats |
| `dusin1` (1–12) | ~32.4% | 2× innsats |
| `dusin2` (13–24) | ~32.4% | 2× innsats |
| `dusin3` (25–36) | ~32.4% | 2× innsats |
| `grønt` (0) | 2.7% | 35× innsats |
| `nummer` (0–36) | 2.7% | 35× innsats |

Eksempel: `/roulette 50 nummer 17` — satser 50 coins på tallet 17.

---

## 10. Prestige

### `/prestige`
Når du når **level 100** kan du prestige. Dette resetter level og XP til 1, men du beholder:
- Alle coins
- Alle badges
- Alle achievements
- Alle samlekort

Til gjengjeld får du prestige-merket på profilen: ⭐I → ⭐⭐II → osv.

Prestige-nivå gir ingen mekanisk fordel i seg selv, men viser at du har gjennomført hele grinden og startet på nytt. Achievement «Prestige I» låses opp ved første prestige (500 coins belønning).

---

## 11. Hero of the Day

Én person kåres automatisk til **Hero of the Day** basert på bidrag. Ikke tilfeldig — basert på faktisk aktivitet:

| Aktivitet | Poeng |
|---|---|
| Melding sendt | 1 poeng |
| Reaksjon gitt | 2 poeng |
| Minutt i voice | 0.5 poeng |
| Stream sett | 3 poeng |

Den med flest poeng den dagen blir dagens helt. Achievement «Dagens Helt» låses opp første gang du vinner (200 XP + 100 coins).

---

## 12. Twitch-integrasjon

### `/linktwitch <twitch_bruker>`
Kobler Twitch-kontoen din til Discord. Gir deg sub-rolle automatisk og knytter Twitch-sub til XP-systemet.

### `/live`
Sjekker om streameren er live på Twitch akkurat nå.

### `/twitch`
Viser Twitch-linken til kanalen.

### `/socials`
Viser alle sosiale medier for streameren.

---

## 13. Handel med kort

### `/trade tilby`
Tilby et av kortene dine til en annen bruker.

Eksempel: `/trade tilby bruker:@Kalle kort:Mørk Riddler`  
Du trenger ikke skrive hele kortnavnet — del av tittelen holder.

### `/trade mine`
Viser alle dine aktive handelstilbud (sendt og mottatt). Du kan godta, avslå eller kansellere direkte.

**Regler:**
- Solgte kort kan ikke trades
- Kort i aktiv trade kan ikke selges
- Tilbud utløper etter en periode

---

## 14. Alle kommandoer — oversikt

### For alle brukere

| Kommando | Hva den gjør |
|---|---|
| `/profil [bruker]` | Vis XP, level, badges, coins og statistikk |
| `/achievements` | Se dine opplåste achievements |
| `/quests [type]` | Se daglige og ukentlige quests med fremgang |
| `/prestige` | Reset til level 1 (krever level 100) |
| `/persona [reroll]` | Generer eller reroll ditt AI-samlekort |
| `/minekort` | Bla gjennom kort, selg dem eller sett showcase |
| `/trade tilby` | Tilby et kort til en annen bruker |
| `/trade mine` | Se dine aktive handelstilbud |
| `/blackjack <innsats>` | Spill Blackjack (10–1 000 coins, 5 min cooldown) |
| `/roulette <innsats> <type> [nummer]` | Spill Roulette (5–500 coins, 3 min cooldown) |
| `/linktwitch <bruker>` | Koble Twitch-konto til Discord |
| `/live` | Sjekk om streameren er live |
| `/twitch` | Vis Twitch-link |
| `/socials` | Vis alle sosiale medier |
| `/clip` | Forklarer hvordan du lager clips |
| `/innsend <url> [beskrivelse]` | Send inn en clip for godkjenning |
| `/promo` | Generer AI promo-tekst for aktiv stream |
| `/status` | Vis Twitch API, Discord Bot og systemstatus |

### For admin/mod

| Kommando | Hva den gjør |
|---|---|
| `/admin boost-xp <bruker> <xp>` | Sett XP for en bruker til en bestemt verdi |
| `/kanaler analyse` | AI analyserer kanaler og foreslår endringer |
| `/kanaler opprett <navn> [kategori]` | Opprett ny tekstkanal |
| `/kanaler rydd` | Vis inaktive kanaler og slett dem |
| `/setup` | Opprett anbefalt Discord-struktur for streaming community |

---

## Ofte stilte spørsmål

**Kan jeg kjøpe coins med ekte penger?**  
Nei. Coins er 100 % virtuell valuta. Ingen kjøp, ingen betalingsmurer.

**Kan jeg miste coins i casino?**  
Ja. Taper du i Blackjack eller Roulette mister du innsatsen. Bruk coins du har råd til å tape.

**Hva skjer med kortet mitt hvis jeg selger det?**  
Det forsvinner permanent fra samlingen din. Du kan ikke angre.

**Showcase-kortet mitt vises ikke på profilen?**  
Sjekk at kortet ikke er solgt. Solgte kort fjernes automatisk fra showcase.

**Jeg har nok XP til å prestige, men kommandoen sier nei?**  
Boten sjekker `level`, ikke bare XP. Bruk `/profil` for å se faktisk level.

**Achievements dukker ikke opp?**  
Achievements sjekkes etter aktivitet. Noen ganger vises de neste gang du bruker `/profil`. Kontakt admin hvis det er lenge siden.

**Hvorfor fikk jeg ikke badge automatisk?**  
Auto-badges sjekkes ved aktivitet. Prøv å send en melding eller sjekk `/profil`. Noen krav (sub-måneder) krever at Twitch er koblet til via `/linktwitch`.
