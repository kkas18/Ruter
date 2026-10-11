# Testplan for ekte telefoner

Automatiske tester dekker kjernelogikken (`npm run check`) og hovedflytene i en ekte nettleser med lagrede svar fra Entur, inkludert tilgjengelighet (`npm run e2e`). Det som bare kan sjekkes på en ekte telefon ute i trafikken, står her. Kryss av og noter det som avviker. Kopier gjerne **Innstillinger → Diagnostikk → Kopier diagnostikk** inn i notatet.

**Enheter:** én iPhone (Safari, lagt til på hjemskjermen) og én Android (Chrome, installert som app).
**Sted:** en vanlig holdeplass (for eksempel Furuveien) og et knutepunkt (Jernbanetorget eller Storo).

## 1. Installasjon og oppstart
- [ ] Appen kan legges til på hjemskjermen og åpner i fullskjerm uten nettleserrammer.
- [ ] Velkomstskjermen spør om posisjon. Tillat → kartet går til der du står.
- [ ] Andre gang åpner appen rett på kartet, under 2 sekunder.

## 2. Posisjon og kompass
- [ ] Den blå prikken står der du står (±10 m). Nøyaktigheten står i undertittelen («±6 m»).
- [ ] Gå 50 m: prikken følger jevnt og hopper ikke.
- [ ] Kompasset: kjeglen peker dit telefonen peker. På iPhone må du godta tilgang til bevegelse.
- [ ] «Min posisjon»-knappen sentrerer og følger. Drar du i kartet, slutter den å følge.

## 3. Hjem og holdeplass
- [ ] Hjem viser holdeplassene rundt deg med tidslinje. Avganger du ikke rekker, er stiplet.
- [ ] Minuttene teller ned (tallet ruller) uten at noe blinker eller hopper.
- [ ] Trykk på en holdeplass: kartkortet viser neste avgang du **rekker**. Dra arket ned: kortet viser fire avganger.
- [ ] På et knutepunkt: tidslinjen har opptil seks rader, og resten står i listen («+N til i listen»).
- [ ] En holdeplass langt unna (mer enn 20 min å gå) har ingen skravering og ingen «Gå nå».

## 4. Reise
- [ ] Legg til Hjem fra Hjem-flisen. Flisen viser «Gå om N min» og linjen, og ett trykk åpner reiseforslagene.
- [ ] Endre og fjern Hjem fra blyanten i søket.
- [ ] Søk etter et mål. Reiseforslagene har ring («gå om N min»), fargestripe og tilkjøringsspor når bussen er underveis.
- [ ] Velg en reise: ringen viser «gå om» → «går om» → «gå av om» etter hvert som du går, venter og sitter på.
- [ ] Om bord: bussen glir langs skinnen i reiselisten, og «Neste: …» stemmer med virkeligheten (noter avvik i stopp).
- [ ] «Følg»-knappen: kartet følger bussen jevnt til du drar i kartet.
- [ ] Reisevalg øverst i forslagene: «Færre bytter» legger direkte reiser først, «Trinnfritt» viser en kort forklaring, og «Rolig gange» gir lengre gangtid. Valgene huskes til neste søk og gjelder også Hjem-flisen.
- [ ] «Varsle meg» på en reise: tillat varsler, legg appen i bakgrunnen. Varselet «Gå nå» kommer ett minutt før du må gå, med linje, holdeplass og tid. Trykk på varselet: appen åpnes.
- [ ] «Del ankomst»: delingsarket åpnes med «Er fremme ved … ca. kl. …». Tiden stemmer med reisen, også når bussen er forsinket.
- [ ] «Billett»: Ruter-appen åpnes i App Store eller Google Play, med «Åpne» hvis den er installert.

## 5. Bevegelse
- [ ] Trykk på en holdeplass på Hjem: navnet glir opp og blir tittelen. Tilbake: det glir ned igjen.
- [ ] Trykk på en prikk i tidslinjen: prikken blir linjeskiltet i turens overskrift.
- [ ] Ringen tømmes jevnt (ikke i hopp). Ved «gå nå» puster den to ganger, og telefonen gir et lett dobbeltdunk.
- [ ] Dra arket helt opp: kartet bak dempes litt. Dra ned på Hjem når listen står øverst: en liten buss kjører over, og avgangene oppdateres.
- [ ] Alt over skal holde 60 bilder i sekundet. Med «Reduser bevegelse» på: ingen glidende overganger, bare vanlige sidebytter.

## 6. Kart
- [ ] Satellitt av og på: navnene er lesbare i begge.
- [ ] På et knutepunkt: busser som står på samme sted, legges i en ring og overlapper ikke holdeplassikonet.
- [ ] Trykk på en buss: turen åpnes, og bussen vises på linjen.
- [ ] Bilder per sekund: kartet skal panorere og zoome uten hakking. Noter telefonmodell hvis det hakker.

## 7. Nett og batteri
- [ ] Flymodus: «Frakoblet» vises i søkefeltet, og Hjem sier «data fra kl. …». Ingen feilmeldinger.
- [ ] Nett tilbake: alt oppdateres av seg selv innen 30 sekunder.
- [ ] La appen ligge åpen på Hjem i 30 minutter. Batteriforbruk under 5 % (sparemodus etter fem minutter uten berøring).
- [ ] Diagnostikk viser antall kall til Entur siste time. Forventet: rundt 600 i aktiv bruk, under 250 i sparemodus.
- [ ] Arket helt oppe i 5 minutter: antall kall i Diagnostikk øker nesten ikke (kartet hviler). Dra arket ned: bussene kommer tilbake innen et par sekunder.

## 8. Tilgjengelighet
- [ ] VoiceOver (iPhone) og TalkBack (Android): sidetittelen leses når du bytter side. Avgangene leses med linje, retning og minutter.
- [ ] Skjermleseren leser **ikke** opp tidslinjene hvert 20. sekund, bare «Gå nå» og «Gå av snart».
- [ ] Stor tekst i systemet: ingen tekst kuttes slik at mening går tapt.
- [ ] Redusert bevegelse i systemet: animasjonene slås av.
- [ ] Alle knapper kan treffes med tommelen uten å bomme (prikkene i tidslinjen, lukk-knappen på kartkortet).
- [ ] Søket med skjermleser: forslagene leses som en liste med antall, og valgt forslag leses når du blar.
- [ ] Ringen ved null leses «Gå nå» (eller «Går nå», «Gå av nå»), ikke «nå gå».

## 9. Språk
- [ ] Telefon på engelsk: appen starter på engelsk. Innstillinger → Språk → Norsk bytter med en gang, uten omstart.
- [ ] På engelsk: trafikkmeldinger på engelsk der Ruter har skrevet dem, ellers på norsk. Klokkeslett med 24 timer.

## 10. Når testen er bestått
Neste steg er «Gå nå»-varsel også når appen er helt lukket. Det krever en liten push-tjeneste på en server, og på iPhone at appen er lagt til på hjemskjermen.
