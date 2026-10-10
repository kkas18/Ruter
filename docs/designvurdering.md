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
