# REIS

Sanntid og reisesøk for kollektivtrafikken i Oslo. Appen er en PWA uten byggesteg: kartet er hovedskjermen, og alt annet skjer i ett ark. Data kommer fra Entur (åpne data, NLOD), og kartet bruker OpenFreeMap.

## Kjøre lokalt
```sh
npm install        # bare utviklingsverktøy (ESLint)
npm start          # http://localhost:8123
```
Appen må serveres over HTTP(S). Åpnes `index.html` direkte fra disk, virker verken service worker eller API-kall.

## Sjekker
```sh
npm run lint       # ESLint, også på tvers av filene
npm test           # enhetstester for kjernelogikken (node:test)
npm run check      # begge, slik CI kjører dem
```

## Struktur
Skriptene lastes i denne rekkefølgen fra `index.html` og deler globalt navnerom:

| Fil | Ansvar |
|---|---|
| `js/mapstyle.js` | Kartstilen (lyst, mørkt og satellitt) |
| `js/core.js` | Ren logikk uten DOM: tid, avstand og gangtid, posisjon langs linjen, tidslinjens oppsett, vekting av trafikkmeldinger. Testes i `tests/` |
| `js/base.js` | Hjelpere, konstanter, lagring, feilhåndtering (`report`), nettstatus, tema og GraphQL |
| `js/map.js` | Kartlag, holdeplassikoner og avgangskort på kartet |
| `js/sheet.js` | Arket (dra-gester og høyder) og ruteren |
| `js/components.js` | Ring, linjeskilt, avgangsrader og tidslinje |
| `js/floatcard.js` | Flytekortet for holdeplass og kjøretøy |
| `js/pages.js` | Sidene: Hjem, Søk, Reiseforslag, Reisen, Holdeplass, Turen, Meldinger og Innstillinger |
| `js/data.js` | Henting av posisjon, holdeplasser, avganger, kjøretøy, meldinger, søk og rute |
| `js/live.js` | Live reise: kjøretøyet på valgt reise, statusboksen og sporene |
| `js/main.js` | Oppdateringsrytme (med sparemodus) og oppstart |

## Dokumentasjon
- `docs/designvurdering.md`: vurderinger og designvalg runde for runde.
- `docs/testplan.md`: sjekkliste for test på ekte telefoner.

Uavhengig app, ikke tilknyttet Ruter AS.
