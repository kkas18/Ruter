# Designvurdering av REIS

Vurdert på 390 × 844 (iPhone-størrelse) i lys og mørk modus, med ekte data fra Entur.

## Poeng før redesign

| Område | Poeng | Hovedfunn |
|---|---|---|
| Design | **5/10** | Tre CSS-lag oppå hverandre («REIS 2»-overstyringer) ga ujevn typografi og avstand. Monospace-merker («Gå nå») skilte seg ut fra resten. Tunge, fargede filterknapper. Logo og sidetittel på hver skjerm. Flytende fanelinje og myke skygger på alle flater, et typisk generisk uttrykk. |
| Grafikk | **3/10** | Illustrasjonene var glatte, isometriske 3D-bilder med tydelig KI-preg som ikke passet appen. Kartet viste «API KEY REQUIRED» (CARTO krever nå nøkkel). Reiselinjen ble aldri tegnet langs gatene, fordi Entur-feltet `points` ikke finnes lenger. Ikonene var generiske. |
| Animasjoner | **4/10** | Bare standardeffekter (fade/rise, blinkende prikker). Ingen felles tempo eller myk kurve. Ingenting animerte selve innholdet: rute, minutter eller valg. |
| Appfølelse | **5/10** | Haptikk og drabart ark var et godt grunnlag. Men kartet var ødelagt, trafikkmeldinger kom på engelsk, Entur-plassholderne «Origin»/«Destination» ble vist som stedsnavn, og samme avgang kunne stå to ganger. Kartfanen var tom fordi arket var skjult. Zoom var sperret (`user-scalable=no`), og søket kunne ikke brukes med tastatur. |
| **Snitt** | **4,3/10** | |

## Ny retning: «perrong»

Inspirert av skilting på stasjoner og linjekart, ikke av app-maler.

- **Farger:** Papir (#F4F2ED) og blekk (#14191C), med signalgult (#FFC800) som eneste merkefarge. Transportfargene brukes bare der de betyr noe: linjemerker, ruter og tidsbaren.
- **Typografi:** Schibsted Grotesk (norsk, OFL), lagt ved lokalt så den virker uten nett. Tabulære tall brukes kun i tidskolonner.
- **Flater:** Hårfine linjer i stedet for skygger. Fanelinjen ligger fast nederst, og titlene er store og krymper inn i toppfeltet når man ruller.
- **Grafikk:** Eget merke (en rute fra ring til gult punkt) og et animert linjekart i SVG erstatter KI-bildene. Appikonene er generert fra merket.
- **Kart:** Kartverkets gråtonekart, gratis og uten nøkkel, som lar rutefargene stå frem. Mørk modus inverterer flisene.

## Konkrete forbedringer

1. **Reiseforslag:** Hvert forslag viser en tidsbar der hver etappe har bredde etter varighet. Kortene viser også når og hvor du går på.
2. **Reisedetaljer:** Et linjediagram med farge per etappe, plattform, retning («T-bane mot Frognerseteren») og stopp underveis.
3. **Avganger:** Ser ut som en avgangstavle. Minuttene teller med en kort animasjon, forsinkelser vises med overstreket rutetid, og «Gå nå» står i tekst.
4. **Kart:** Søkefelt øverst, «I nærheten»-ark med neste avgang, og ruten tegnes inn fra start til mål.
5. **Feilrettinger:** Kartflisene virker igjen, ruten følger gatene (`pointsOnLink`), meldingene er på norsk, utløpte meldinger filtreres bort, og doble avganger fjernes.
6. **Tilgjengelighet:** Zoom er tillatt. Søket kan brukes med piltaster, Enter og Esc, og `aria-pressed`/`aria-current` er på plass. Redusert bevegelse respekteres overalt.
7. **Bevegelse:** Felles tokens for tempo og kurver (`--t-fast/med/slow`, `--ease-out`, `--ease-sheet`). Arket reagerer på fart, ikke bare posisjon.

## Egenvurdering etter redesign

Design 8 · Grafikk 8 · Animasjoner 7,5 · Appfølelse 8. Dette er en egenvurdering og bør testes på ekte telefoner.

Neste steg som ville løftet videre:
- delte overganger mellom reiseforslag og kart (View Transitions);
- dra-for-å-oppdatere i Avganger;
- egne kartfliser med samme palett.

## Runde 2: kartet som hovedflate

**Tilbakemelding:** Kartet skulle bli mer profesjonelt og elegant å navigere i, og samme handling skulle ikke ligge flere steder.

### Navigasjon uten dobbeltheter
Fanene er fjernet. Kartet er hovedskjermen, og alt annet skjer i ett ark med en stabel sider:

| Side | Innhold | Åpnes fra |
|---|---|---|
| Hjem | Favoritter og holdeplasser i nærheten med neste avganger, varsel om trafikkmeldinger | Start |
| Søk | Fra/til, tidspunkt, nylige mål og favoritter | Søkefeltet på kartet, eller trykk på tittelen i reiseforslagene |
| Reiseforslag | Alternativer med tidsbar; valgt rute vises på kartet | Valg i søket |
| Reisen | Linjediagram med bytter og stopp | Et forslag |
| Holdeplass | Avgangstavle med filter bare for transportmidler som faktisk går derfra | Kort på Hjem eller holdeplass på kartet |
| Trafikkmeldinger | Alle aktive avvik | Varselet på Hjem |
| Innstillinger | Utseende, gangfart, kjøretøy, vibrasjon | Tannhjulet |

Dette er fjernet fordi det var en kopi av noe annet:
- Avganger-fanen (nå Hjem og Holdeplass);
- søkeknappen på kartet (nå ett søkefelt);
- egen kartfane;
- favorittlisten i innstillingene (stjernen på holdeplassen styrer favoritter);
- karttypevalg og oppdateringsintervall (ett gjennomarbeidet kart og fast intervall på 30 sek).

### Kartet
- **Vektorkart** (MapLibre GL med OpenFreeMap) i appens egen palett, i både lys og mørk modus. Det er ikke lenger et invertert rasterkart.
- **Rolig innhold:** ingen POI-ikoner og dempede veier. Kollektivruter, holdeplasser og kjøretøy ligger øverst.
- **Utforsk ved å flytte kartet:** holdeplasser lastes der du ser, og uten posisjon følger «I nærheten» kartsenteret.
- **Rotasjon** med kompass som peker mot nord, mykt følg-meg, og hold inne for å velge «Fra her» / «Til her».
- **Ruter tegnes inn** etappe for etappe og tilpasses alltid den synlige delen av kartet over arket.

### Arket
- **Tre høyder** (lav, halv, full) som reagerer på fart.
- **Felles tilbake:** knapp, Esc, Androids tilbake-tast og «dra ned» på helskjermsider gjør det samme.
- **Stor skjerm:** arket blir et fast sidepanel.

## Runde 3: satellitt og live reise

**Tilbakemelding:** Kartet skulle ha satellittbilde, holdeplassene skulle vises langs valgt rute, og alt skulle være live: din posisjon og kjøretøyene.

### Satellitt
- Én kartknapp (lag-ikonet) veksler mellom kart og satellitt. Valget huskes.
- Satellitt er en hybrid: Esri World Imagery under, sted- og gatenavn i hvit tekst oppå. Ruter og holdeplasser får hvit kontur, så de synes på flybilder.

### Holdeplasser langs ruten
- Alle stopp på valgt reise vises: store prikker for på, av og bytte, små for stopp underveis.
- Hvert stopp har navn og sanntidsklokkeslett. Stopp underveis får navn fra zoom 13,5.
- Tidene oppdateres hvert 30. sekund (`leg(id)` hos Entur), både på kartet og i tidslinjen.

### Live kjøretøy
- **Ruter deler ikke GPS-posisjoner** via Entur (strømmen for `RUT` er tom). For kjøretøyet du skal med, beregnes posisjonen derfor langs linjen fra faktiske og forventede tider ved hvert stopp. Dette merkes «beregnet fra sanntid» og tegnes med stiplet ring.
- **Der operatøren har GPS** (Vy, Flytoget, Brakar, Go-Ahead m.fl.), brukes ekte posisjon fra Enturs kjøretøy-API. Den oppdateres hvert 10. sekund og tegnes med hel ring.
- **Statuslinje i reisen:**
  - før du går på: «T-bane 1 er 2 stopp unna Jernbanetorget · om 4 min»;
  - om bord: «Neste stopp … · Gå av ved … kl. …».
  - Trykk på statuslinjen for å se kjøretøyet på kartet.
- **Kjøretøylaget på kartet** henter bare utsnittet du ser på, hvert 10. sekund, og lar kjøretøyene gli mellom oppdateringene.

### Din posisjon
- Ferske GPS-målinger (`maximumAge: 0`). Markøren glir mellom målingene, og nøyaktigheten vises («Rundt deg · ±8 m»).
- Kompasset viser hvilken vei du peker når du står stille. I fart brukes GPS-retningen.

### Ruter-kjøretøy uten valgt reise
- Når du zoomer inn (fra zoom 13,8), vises også Ruters busser, trikker og T-baner i hele utsnittet. Posisjonen er beregnet fra sanntid og vises med stiplet ring. Kjøretøy med GPS har hel ring.
- **Slik holdes datamengden nede:**
  - én spørring finner turene som skal til holdeplassene i utsnittet (`stopPlacesByBbox`);
  - hver tur hentes én gang, deretter bare oppdaterte tider hvert 30. sekund;
  - linjegeometrien caches per rutemønster;
  - maks 70 turer om gangen.
- Posisjonene regnes ut på nytt flere ganger i sekundet, så kjøretøyene glir langs linjen.

### Avganger direkte på kartet
- **Fra gatenivå (zoom 15,3)** får hver holdeplass med avganger et lite kort med navn og de tre neste avgangene (linjemerke og minutter, «nå» i gult). Holdeplasser uten avganger viser bare prikk og navn.
- **Én forespørsel** (`stopPlacesByBbox` med `estimatedCalls`) henter avgangene for hele utsnittet. Den oppdateres hvert 30. sekund og når kartet flyttes, og minuttene telles ned hvert 20. sekund.
- **Kortene er kartsymboler**, så kartet selv sorterer bort kort som ville overlappet. Stasjoner og favoritter vinner, og kjøretøy blokkerer ikke kortene.
- **Trykk på et kort** åpner avgangstavlen med en gang, fordi tidene allerede er hentet. Den valgte holdeplassen viser den større boblen i stedet for kortet.
- **Kortene har egne farger** for lys modus, mørk modus og satellitt.

### Flytekort
- Avgangsboblen er byttet ut med et flyttbart glasskort. Det er koblet til holdeplassen (eller kjøretøyet) med en tynn stiplet linje og følger med når kartet flyttes.
- **Dra kortet dit du vil.** Appen husker hvor du plasserte det, og legger ellers kortet der det ikke dekker posisjonen din, søkefeltet eller arket.
- **Innhold:** neste avgang vises stort med sanntidsprikk og eventuell forsinkelse, og de tre neste kompakt under. «Sanntid» eller «Rutetid» står i toppen.
- **Bevegelse:** kortet vokser fram fra punktet det hører til, radene glir inn etter tur, og minuttene tikker. Ved oppdateringer animeres ikke radene på nytt.
- **Kjøretøy:** trykk på et kjøretøy viser det samme kortet, med linje, retning, kilde (GPS eller beregnet) og tid til neste stopp, og kortet følger kjøretøyet mens det kjører.
- **Avgangskortene på kartet** viser nå en grønn sanntidsprikk foran tider som er live.

### Turen: én bestemt avgang på kartet
- Trykk på én avgang hvor som helst for å åpne turen: i holdeplasskortet på kartet (hver avgang kan trykkes for seg), i flytekortet, i avgangstavlen, eller direkte på et kjøretøy.
- **Kartet:** hele ruten i linjens farge. Strekningen kjøretøyet allerede har kjørt, er grå. Alle stopp har navn og live klokkeslett, og kjøretøyet beveger seg langs ruten. Utsnittet tilpasses så kjøretøyet, holdeplassen din og du selv er med.
- **Arket:**
  - live status øverst («Buss 30 er 2 stopp unna Jernbanetorget · om 4 min», eller «har passert …»);
  - hvor langt du har å gå, med «Gå nå» eller «Rekker trolig ikke»;
  - stopplisten med tider og forsinkelser, der passerte stopp er nedtonet og kjøretøyet er markert «Underveis» i listen.
- **«Din holdeplass»** er den du trykket på. Knutepunkt matches via foreldrestoppestedet. Åpnes turen fra et kjøretøy, velges stoppet på ruten nærmest deg.

## Runde 4: ny vurdering mot Ruter-appen

Vurdert på 390 px i lys modus, mørk modus og satellitt, med ekte data ved Furuveien (Manglerud) og Jernbanetorget, og sammenlignet med et skjermbilde fra Ruter-appen.

| Område | Før runden | Etter | Kommentar |
|---|---|---|---|
| Design | 7,5 | **8** | Ryddig arkstabel og flytekort. Hjem var preget av et generelt varsel om 40 meldinger. |
| Grafikk | 6,5 | **7,5** | Holdeplassene var anonyme hvite ringer, mens Ruter har tydelige piktogrammer. Nå har vi piktogrammer i linjefargene. |
| Animasjoner | 7,5 | **7,5** | Gode overganger, tikkende minutter og ruter som tegnes inn. Ikke endret i denne runden. |
| Appfølelse | 7 | **8** | Trafikkmeldinger og søk ga støy. Nå er begge relevante for der du er. |
| **Snitt** | **7,1** | **7,75** | |

### Der vi er bedre enn Ruter-appen
- Avgangskort direkte på kartet ved hver holdeplass, med sanntid.
- Trykk på én avgang viser akkurat den turen: hele ruten, kjøretøyet og avstanden til deg.
- Ruter-kjøretøy vises på kartet (beregnet fra sanntid, tydelig merket) og trykkbare.
- Flyttbart flytekort, hybrid satellittkart og én navigasjon uten faner.

### Der Ruter fortsatt er bedre
- Billettkjøp og konto, som er utenfor denne appens rolle.
- Ekte GPS-posisjon for egne kjøretøy. Ruter har den internt, men deler den ikke som åpne data.
- Moden app testet på mange telefoner, med varsler og universell utforming kvalitetssikret.

### Gjort i denne runden
1. **Holdeplassikoner:** avrundet kvadrat i linjefargen med hvitt piktogram for buss, trikk, T-bane, tog og båt. Favoritter har en gul stjerne. Zoomet ut vises fargede prikker. Kortene på kartet ligger nå over ikonet.
2. **Relevante trafikkmeldinger:** meldingene leses for berørte linjer (`Affects/LineRef`). Hjem viser bare meldinger for linjer som går fra holdeplassene rundt deg eller favorittene dine («2 meldinger for linjer rundt deg»). Resten ligger i en rolig lenke nederst. Meldingssiden har to deler, «Rundt deg» og «Øvrige», med linjemerker.
3. **Søk:** med minst tre treff innen 60 km tas fjerne treff bort, og adresser begrenses til fem.

### Neste steg
- Test på ekte telefoner (iPhone og Android) ute i trafikken: GPS, kompass og dra-gester.
- Varsel «Gå nå» for en valgt avgang (krever push via service worker).
- Gjennomgang av universell utforming: skjermleser, kontrast i satellittmodus og store tekststørrelser.

### Se bussen din på valgt reise
- **På kartet:** strekningen bussen har igjen fram til holdeplassen din tegnes stiplet i linjefargen, med stoppene den skal innom. Bussen vises live.
- **Spor i statuslinjen:** en vannrett linje med stoppene før holdeplassen din. Bussmerket glir mot det gule ankerpunktet («Din holdeplass») og pulserer svakt. Sporet starter der bussen er (opptil 8 stopp før). Om bord viser sporet veien fram til der du skal av.
- **«Følg»:** kartet følger bussen jevnt til du drar i kartet selv. Et trykk på teksten viser bussen én gang.

## Mindre tekst, mer visualisering

Prinsipp: **ett stort tall per skjerm, resten som grafikk, tekst bare når du trykker.** Setningene ligger fortsatt i `aria-label`/`title`, så skjermlesere får hele forklaringen.

| Før | Nå |
|---|---|
| «Buss fra Furuveien om 14 min» i hvert reiseforslag | **Nedtellingsring** («gå om») som tømmes og går fra grønn → gul (≤ 5 min) → rød (≤ 1 min) |
| Stolpe + egen rad med linjebrikker | **Fargestripe**: én bit per etappe med lengde etter tid, linjenummeret står inni, gange som grå bit med minutter |
| Ingenting om hvor bussen er før du velger reise | **Tilkjøringsspor** i hvert forslag: bussen glir mot holdeplassen din (vises bare når den er underveis) |
| «Buss 70 er 11 stopp unna Furuveien / Går kl. 20:24 · om 14 min · beregnet fra sanntid» | Ring + «11 stopp unna» + spor; kilden er et lite merke (`GPS` eller `≈`) |
| «Buss mot X · Plattform B · Sanntid · 5 stopp underveis» | Linjeskilt → mål, plattform som liten brikke, sanntid som prikk, stoppene som prikker; bussen glir langs skinnen mens du sitter på |
| Avgangsliste alene | **Tidslinje** de neste 30 (eller 60) minuttene: én rad per linje og retning, hel prikk = sanntid, hul = rutetid, rød hale = forsinkelse, skravert felt = tiden du trenger for å gå dit |
| Avvik som tekstbanner | Gult **!**-merke på linjeskiltet der linjen vises én gang (reise, reisestripe); én kompakt meldingsrad per holdeplass |
| — | **Belegg** som 1–3 figurer der operatøren deler det (Ruter gjør det foreløpig ikke, da vises ingenting) |

Typografi: titler 21 → 19 px, avgangstall 22 → 20 px, sekundærtekst 12–12,5 px. Tall ruller mykt når de endres.

## Runde 5: vurdering etter visualiseringen

| Område | Før runden | Etter | Kommentar |
|---|---|---|---|
| Design | 8 | **8,5** | Holdeplass-siden viste samme avganger tre ganger, og Hjem var fortsatt tekstlister. Nå har hver avgang én plass. |
| Grafikk | 8,5 | **9** | Én tidslinje overalt (Hjem, holdeplass), ringen har synlig forklaring og kartkortet bruker symboler. |
| Animasjoner | 8 | **8,5** | Prikker, spor og ringer oppdateres på stedet og glir i stedet for å tegnes på nytt. |
| Appfølelse | 8 | **8** | Uendret til appen er testet på ekte telefoner. |
| **Snitt** | **8,1** | **8,5** | |

### Gjort i denne runden
1. **Ingen dobbeltheter på holdeplassen:** kortet på kartet viser bare neste avgang når arket er oppe (fire når arket er nede). Tidslinjen viser de nærmeste avgangene, og listen under tar bare resten («Senere», eller «Flere avganger» når ikke alle linjer får plass).
2. **Hjem:** hvert holdeplasskort har en liten tidslinje med to retninger, gangtid som skravert felt og avganger du ikke rekker tonet ned – samme bildespråk som på holdeplassen. (Ring og tidslinje på samme kort ville vist neste avgang to ganger.)
3. **Ringen forklarer seg selv:** et lite ord under tallet – «gå om», «går om», «gå av om» – som blir «gå nå» ved null.
4. **Kartkortet:** «Buss · plattform B · +1 min» er byttet ut med plattformbrikke, sanntidsprikk og en liten rød «+1» ved minuttene.
5. **Myke oppdateringer:** tidslinjene på Hjem og holdeplassen, sporene i reiseforslagene og ringene endres på stedet, så prikkene glir mot «nå».
6. **Store knutepunkt:** holdeplass-siden henter opptil fire avganger per linje og retning den neste timen (Jernbanetorget: over hundre i stedet for 14). Prikker som ville kollidert slås sammen («12⁺¹»), retningen står over linjen så prikkene får hele bredden, og linjer som ikke får plass står i listen.
7. **Kartet:** kildehenvisningen er en liten, dempet knapp i stedet for en tung svart sirkel.
