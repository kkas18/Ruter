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
