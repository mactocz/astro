# Workload vs norm Implementation Plan

## Overview

Szósty wycinek domenowy Shiftly (S-06 z roadmapy, FR-020, US-01): w widoku obsadzania `/schedules/<id>/assign` każda osoba ma obok swojego wiersza sumę godzin z siedmiu dni grafiku, normę tygodniową jej etatu i różnicę, żeby planista widział obciążenie i jego równomierność bez przełączania się do innych narzędzi. PRD mówi wprost, że obciążenie jest mierzalne i widoczne, ale bez progu i bez blokady: ocenę przekroczenia normy robi S-05 (ostrzeżenie `weekly_norm` na liście wskazań), a ten wycinek tylko pokazuje liczby. Wycinek nie dodaje migracji, tabel ani tras API. Cała logika siedzi w czystych funkcjach na fundamentach, które dostarcza Faza 1 S-05 (`live-rule-violations`): minuty zmian i etat w wyspie, moduł kalendarza ze świętami, norma tygodniowa, sumy godzin i `list` z hooka. Dlatego plan powstał równolegle z planem S-05, ale implementacja S-06 zaczyna się po scaleniu tej fazy.

## Current State Analysis

- Stan na dziś (przed S-05): wyspa obsadzania nie ma minut zmian ani etatu (`src/types.ts:122-137`, komentarz `:132` "never the e-mail address or the FTE"), w repo nie ma kalendarza ani normy, a `useAssignments` zwraca `{ byEmployeeDay, coverage, busy, error, toggle }` bez `list`. Dlatego pierwszym zadaniem tego wycinka jest sprawdzenie, że Faza 1 S-05 jest w bazie gałęzi.
- Stan po Fazie 1 S-05 (zależność, kontrakt z planu S-05): `ShiftOption` ma `startMinute` i `endMinute`, `EmployeeOption` ma `fte: Fte` (`{ numerator, denominator }`, w najprostszej postaci, `1 <= numerator <= denominator`), `src/lib/services/calendar.ts` daje `weekdayOf`, `polishHolidays`, `isHoliday` i `holidaysInWeek(startDate)` (święta w siedmiu dniach, tylko w dni inne niż niedziela), `src/lib/services/work-hours.ts` daje `shiftInterval`, `workedMinutesByEmployee(assignments, shifts)` (suma pełnych czasów trwania zmian rozpoczętych w grafiku; zmiana nocna z dnia 6 liczy się w całości), `weeklyNorm(startDate, fte)` (`baseMinutes = 2400 − 480 × liczba świąt`, ułamek `n/d`), `normMinutes(norm)` (zaokrąglone do minuty) i `exceedsNorm`, a hook zwraca `list`.
- Widok: `AssignmentGrid.tsx` ma wiersz osoby `th scope="row"` z samym nazwiskiem (`:143-145`), komórki dnia z przyciskami (`:150-185`) i podsumowanie obsady z `CoverageValue` (`:73-91`, tekst `x z y` plus `−n`/`+n` i słowa `brakuje`/`nadmiar`). Po S-05 (Faza 4) wiersz ma jeszcze kolumnę "Wskazania" po kolumnach dni, a pod siatką jest lista wskazań jako osobny element `section`; ten plan dopisuje kolumnę "Godziny" po niej.
- Wzorzec tekstu: podsumowanie obsady już używa formy "x z y" i tekstowej różnicy z prawdziwym znakiem minus (`−`), więc godziny przyjmują ten sam rejestr (`32 h z 40 h`, `mniej o 8 h`), a kolor jest tylko dodatkiem (WCAG). Format godzin z minutami istnieje w `formatDuration` (`src/lib/services/shift.ts:45`, eksportowana; `8 h`, `7 h 30 min`, `45 min`, a zero daje `0 min`), więc liczby nie wymagają nowego formatowania.
- Kruchość smoke jak w S-05: `gridOf` porównuje tekst `th scope="row"` co do znaku, `cutAtCoverage` tnie HTML po `coverage-heading`, `showsCoverage` wymaga dokładnego tekstu komórek obsady, więc kolumna "Godziny" musi być komórką `td` w wierszu osoby (nie w `th`), a kroki liczące `td` w wierszu trzeba dostosować po raz drugi (po S-05 ma już dodatkową kolumnę).
- Dziedzina (`context/foundation/work-time-rules.md`): norma z art. 130 (40 h × tygodnie + 8 h × pozostałe dni pon.-pt., minus 8 h za każde święto w dzień inny niż niedziela), D4 etat proporcjonalnie, D5 święta z ustawy; korekta o nieobecności (art. 130 § 3) należy do S-07. PRD (`FR-020`): obciążenie mierzalne i widoczne, równomierność, bez progu i bez blokady.
- Testy: konwencja jak w S-05: czyste funkcje w `src/lib/services/` z testami w workerd, `expectDeterministic`, `Object.freeze` i `structuredClone` na wejściu, bez testów komponentów i hooków, kod wyłącznie w API UTC.

## Desired End State

- Widok obsadzania ma dodatkową kolumnę "Godziny" w wierszu każdej osoby, po kolumnie "Wskazania": tekst `<suma> z <norma>` (np. `32 h z 40 h`) i różnica tekstem (`mniej o 8 h`, `więcej o 2 h 30 min`, `równo z normą`), bez progów, bez kolorów jako nośnika i bez blokad. Liczby odświeżają się po każdym kliknięciu ze stanu optymistycznego (także po wycofaniu przy błędzie).
- Norma osoby to norma tygodniowa jej etatu (40 h × etat, minus 8 h × etat za święto w dzień inny niż niedziela w siedmiu dniach grafiku), liczona dokładnie (ułamek etatu) i zaokrąglana tylko przy wyświetlaniu; suma to pełne czasy trwania zmian rozpoczętych w grafiku (zmiana przez północ liczy się w całości do dnia startu).
- Pod siatką jest jeden akapit opisujący, co pokazuje kolumna (norma tygodniowa i jej korekta o święta, nieobecności nie są jeszcze uwzględniane) oraz że ocena przekroczenia jest na liście wskazań.
- Wynik jest deterministyczny (kolejność wierszy nie wpływa na liczby), a funkcje są gotowe do użycia przez S-07 (nieobecności korygujące normę) i S-11 (widok pracownika).
- Weryfikacja: `npx astro sync && npm run lint && npx astro check && npm test && npm run build` przechodzi, smoke przechodzi lokalnie i w CI, a kolumna "Godziny" działa na produkcji po wdrożeniu.

### Key Discoveries:

- PRD rozdziela odpowiedzialność: S-06 pokazuje sumę względem normy "bez progu i bez blokady", a ostrzeżenie o przekroczeniu normy należy do S-05 (`weekly_norm`). Dzięki temu żadna liczba nie jest oceniana w dwóch miejscach, a kolumna może pozostać neutralna.
- Norma prawna jest miesięczna (okres rozliczeniowy to miesiąc, D2), a grafik ma siedem dni od dowolnej daty. Autor zdecydował: kolumna pokazuje normę tygodniową tych siedmiu dni, ta sama, której używa ostrzeżenie S-05, bez czytania innych grafików i bez miesięcznej sumy (ta wymagałaby statusu i wersji z S-08 i S-12).
- Suma godzin i norma tygodniowa już istnieją po Fazie 1 S-05 jako czyste funkcje (`workedMinutesByEmployee`, `weeklyNorm`, `normMinutes`), więc S-06 nie liczy nic nowego prawnie; dodaje tylko złożenie wiersza (suma, norma, różnica) i jego tekst.
- Wymierna norma: etat jest ułamkiem, więc norma w minutach nie musi być całkowita (np. 3/7 etatu to 1028,57 minuty); różnicę liczymy względem normy zaokrąglonej do minuty (tej, którą widzi planista), a ostrzeżenie S-05 porównuje dokładnie. Różnica w jednej minucie przy etacie ułamkowym jest więc możliwa i jest udokumentowana jako zaokrąglenie wyświetlania.

## What We're NOT Doing

- Oceny, progów, kolorów statusu, ostrzeżeń i blokad: przekroczenie normy ostrzega S-05; ta kolumna jest neutralna zgodnie z PRD.
- Korekty normy o nieobecności (art. 130 § 3) i godzin o czas nieobecności: S-07 doda dane o nieobecnościach i skoryguje normę; plan tylko zapisuje to jako przekazanie.
- Normy miesięcznej, okresu rozliczeniowego jako widoku, godzin z wielu grafików i sumy miesięcznej; średniotygodniowej normy czasu pracy w dłuższym okresie.
- Wskaźnika równomierności zespołu (min, max, rozstęp): zdecydowano, że równomierność jest widoczna przez porównanie wierszy (PRD pozwala na takie rozwiązanie); wskaźnik zespołowy można dodać osobnym wycinkiem, gdy będzie potrzebny.
- Paska, wykresu i kolorów jako nośnika (pasek sugerowałby próg, którego PRD nie zakłada).
- Sum godzin w widoku pracownika (S-11) i w widoku planisty na liście grafików.
- Migracji, tabel, tras API, zmian w `access.ts`, `ci.yml`, `package.json`, nowych zmiennych środowiskowych i klucza service-role w Workerze.
- Testów komponentów i hooków (konwencja repo): zachowanie wyspy sprawdza przegląd w przeglądarce.

## Implementation Approach

Od środka na zewnątrz, w dwóch fazach: czysta funkcja i tekst (Faza 1), widok, smoke, dokumentacja i wdrożenie (Faza 2). Wszystkie liczby biorą się z funkcji, które dostarcza S-05, więc ten wycinek nie powtarza definicji świąt ani normy.

Warunek wstępny: Faza 1 planu S-05 (`live-rule-violations`) jest scalona do bazy gałęzi. Jeśli nie jest, implementację S-06 należy wstrzymać (plan nie powiela fundamentów, żeby nie powstały dwie definicje opcji wyspy i kalendarza).

Rozstrzygnięte w planowaniu (do zakwestionowania przy zatwierdzaniu):
- Kolumna "Godziny" jest ostatnią kolumną wiersza osoby (po "Wskazaniach"), komórką `td`; tekst ma dwie linie w jednej komórce (`<suma> z <norma>` oraz różnica słowami).
- Format: godziny i minuty z istniejącej `formatDuration` bez jej zmiany (`8 h`, `8 h 30 min`, `0 min` dla zera), różnica z prefiksem słownym (`mniej o`, `więcej o`) i `równo z normą` dla zera; prawdziwy znak minus nie jest potrzebny, bo słowa niosą kierunek.
- Osoba bez żadnej zmiany ma wiersz `0 min z <norma>` i `mniej o <norma>`.
- Norma zaokrąglana do minuty (`normMinutes`), różnica liczona z tej wartości; plan zapisuje tę regułę w teście i w akapicie pod siatką.
- Nieobecności S-07: kolumna ich nie uwzględnia, a akapit pod siatką mówi o tym wprost, żeby planista nie zakładał, że norma jest skorygowana.

## Critical Implementation Details

- **Strefa czasowa i kolejność**: kod używa wyłącznie funkcji z S-05 (UTC, minuty), więc nie wprowadza żadnego `Date`; jeśli powstaje nowy kod daty, test szpieguje lokalne gettery jak w S-05.
- **Brak mutacji wejścia**: `summarizeWorkload` nie zmienia ani `assignments`, ani `employees`, ani `shifts` (testy z `Object.freeze` i `structuredClone`); wynik jest posortowany po kluczu pracownika, więc nie zależy od kolejności wejścia.
- **Miejsce kolumny**: kolumna jest komórką `td` w istniejącym wierszu, a jej tekst nie może trafić do `th scope="row"` ani do `aria-label` przycisków zmian (kroki smoke porównują je dokładnie); lista wskazań z S-05 pozostaje osobnym elementem.

## Phase 1: Suma godzin i porównanie z normą

### Overview

Dodać czystą funkcję składającą wiersz obciążenia (suma, norma, różnica) i tekst do wyświetlenia, z testami granic i determinizmu, na fundamentach z Fazy 1 S-05. Widok się nie zmienia.

### Changes Required:

#### 1. Typ wiersza

**File**: `src/types.ts`

**Intent**: Kontrakt wiersza obciążenia dla widoku i dla S-07, S-11. Wstawić w środku pliku, tuż obok typów wskazania z S-05.

**Contract**: `WorkloadRow { employeeId: string; workedMinutes: number; normMinutes: number; differenceMinutes: number }` (`differenceMinutes = workedMinutes − normMinutes`, ujemna, gdy suma jest poniżej normy). Nie ma pola wagi ani statusu.

#### 2. Obciążenie

**File**: `src/lib/services/workload.ts` (nowy), `src/lib/services/workload.test.ts` (nowy)

**Intent**: Złożyć wiersze obciążenia z już istniejących funkcji sum i normy oraz opisać je tekstem, bez żadnej oceny.

**Contract**: `summarizeWorkload(input: { startDate: string; assignments: AssignmentInput[]; shifts: ShiftTimes[]; employees: { id: string; fte: Fte }[] }): WorkloadRow[]` zwraca po jednym wierszu na pracownika z listy (także bez zmian, z sumą 0), posortowane po `employeeId` porządkiem kodowych jednostek tekstu (nie `Intl.Collator`), z `workedMinutes` z `workedMinutesByEmployee`, `normMinutes` z `normMinutes(weeklyNorm(startDate, fte))` i `differenceMinutes` jako różnicą tych dwóch liczb całkowitych. `formatWorkload(row): { total: string; difference: string }` zwraca `total` w postaci `<suma> z <norma>` oraz `difference` w postaci `mniej o <różnica>`, `więcej o <różnica>` albo `równo z normą`, z godzinami i minutami z `formatDuration` z `src/lib/services/shift.ts` (już eksportowanej; zero daje `0 min`, więc nie trzeba jej zmieniać). Testy tabelaryczne `it.each`: etat 1/1, 3/4, 1/2 i 3/7 (norma 40 h, 30 h, 20 h, 17 h 9 min), tydzień ze świętem w dzień inny niż niedziela (np. od wt. 10.11.2026, norma 32 h) i z niedzielą świąteczną (norma bez zmian), osoba bez zmian (`0 min z <norma>`, `mniej o <norma>`), suma równa normie (`równo z normą`), o minutę poniżej i o minutę powyżej normy, zmiana nocna rozpoczęta w dniu 6 (liczy się w całości), dwie zmiany jednej osoby w dniu, nieznana zmiana pomijana, pracownik bez przypisań na liście, przypisanie osoby spoza listy pomijane; powtarzalność przez `expectDeterministic` z wariantami z `seededShuffle`, brak mutacji wejścia (`Object.freeze`, `structuredClone`) i test szpiegujący lokalne gettery `Date`.

### Success Criteria:

#### Automated Verification:

- Testy obciążenia przechodzą w workerd: `npm test`
- Linting przechodzi: `npm run lint`
- Sprawdzanie typów przechodzi: `npx astro check`

#### Manual Verification:

- Format tekstu godzin i różnicy (`32 h z 40 h`, `mniej o 8 h`, `więcej o 2 h 30 min`, `równo z normą`) i reguła zaokrąglania normy ułamkowej zostały przejrzane i zatwierdzone przez autora

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Kolumna "Godziny", smoke i wdrożenie

### Overview

Pokazać kolumnę "Godziny" w widoku obsadzania, dowieść jej w smoke na prawdziwych danych, opisać w dokumentacji i wdrożyć. Brak migracji: wdrożenie to `npm run build` i `npx wrangler deploy`.

### Changes Required:

#### 1. Hook i kolumna

**File**: `src/components/hooks/useWorkload.ts` (nowy), `src/components/schedules/AssignmentGrid.tsx`

**Intent**: Policzyć wiersze obciążenia ze stanu optymistycznego hooka obsadzania i pokazać je w osobnej kolumnie, bez dotykania istniejących komórek.

**Contract**: `useWorkload({ schedule, shifts, employees, list })` zwraca `Record<string, { total: string; difference: string }>` (klucz to id pracownika) z jednego `useMemo` (zależnego od `list`), złożonego z `summarizeWorkload` i `formatWorkload`, bez efektów ubocznych. `AssignmentGrid` dostaje w nagłówku tabeli kolumnę `th scope="col"` "Godziny", a w każdym wierszu osoby po kolumnie "Wskazania" komórkę `td` z dwoma wierszami tekstu (suma z normą, różnica słowami) w neutralnych kolorach, bez `role`, `aria-live` i klas ostrzegawczych. Pod tabelą obsady (albo pod listą wskazań, tam gdzie S-05 umieścił stały akapit) jeden akapit z opisem: "Godziny: suma zmian rozpoczętych w tym grafiku względem normy tygodniowej etatu (40 h pomniejszone o 8 h za każde święto w dzień inny niż niedziela, proporcjonalnie do etatu). Nieobecności nie są jeszcze uwzględnione. Przekroczenie normy pokazuje lista wskazań." Nic nie zmienia się w `th scope="row"`, w `aria-label` przycisków i w tabeli obsady.

#### 2. Aktualizacja i nowe kroki smoke

**File**: `scripts/smoke.mjs`

**Intent**: Dostosować istniejące kroki stron `/assign` do dodatkowej kolumny i dowieść liczb na prawdziwych danych, z asercjami, które zawodzą przy błędnej liczbie, nie tylko przy braku elementu.

**Contract**: Kroki liczące `td` w wierszu osoby (po S-05 mają już kolumnę "Wskazania") uwzględniają kolumnę "Godziny"; `gridOf`, `cutAtCoverage` i `showsCoverage` pozostają bez zmian co do wyniku. Nowe kroki w środku bloku stron `/assign`, na osobnym grafiku `Smoke-<runId>-hours` (utworzonym przez `POST /api/schedules`, z przypisaniami dodawanymi trasą przypisań): osoba z pełnym etatem i jedną zmianą 06:00–14:00 (`8 h z 40 h`, `mniej o 32 h`), ta sama osoba z dwiema zmianami w różne dni (np. 06:00–14:00 i 22:00–07:00, razem `17 h z 40 h`, `mniej o 23 h`), zmiana nocna rozpoczęta w dniu 6 liczona w całości (`9 h`), osoba bez zmian (`0 min z 40 h`, `mniej o 40 h`), osoba na 1/2 etatu z jedną zmianą (`8 h z 20 h`, `mniej o 12 h`) i osoba z sumą dokładnie równą normie (wymaga zestawu pięciu zmian po 8 h, `40 h z 40 h`, `równo z normą`). Grafik zaczynający się w tygodniu ze świętem (np. wt. 10.11.2026, norma `32 h`) potwierdza korektę normy. Kroki "sąsiadów": po zdjęciu przypisania trasą i ponownym wczytaniu strony zmienia się tylko wiersz właściwej osoby, a pozostałe osoby i ich teksty zostają bez zmian. Asercje sprawdzają dokładny tekst kolumny wiersza osoby (nie samą klasę ani status), a brak `role="alert"` i `aria-live` w kolumnie. Zmiana nocna z S-05 (22:00–07:00 daje krytyczne wskazanie `daily_hours`) nie wpływa na asercje, bo kroki sprawdzają tylko kolumnę "Godziny" (w kroku dozwolone są wskazania z S-05).

#### 3. Dokumentacja

**File**: `CLAUDE.md`, `AGENTS.md`, `README.md`

**Intent**: Utrzymać dokumentację zgodną z kodem.

**Contract**: Nowy akapit (nie edycja istniejących długich linii) o obciążeniu: `src/lib/services/workload.ts`, hook `useWorkload`, kolumna "Godziny", definicja normy tygodniowej, brak progu i brak nieobecności (S-07); uzupełnienie opisu `npm run smoke` o kroki godzin; `README.md`: opis kolumny na stronie obsadzania. Nie dotykać fragmentów o service-role.

### Success Criteria:

#### Automated Verification:

- Bramka przechodzi: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- Smoke z istniejącymi i nowymi krokami stron przechodzi lokalnie: `npm run smoke`
- CI na pull requeście jest zielone (job `ci` i job `smoke`)

#### Manual Verification:

- W przeglądarce na desktopie: kliknięcie przypisujące zmianę zmienia sumę i różnicę w wierszu osoby od razu, wycofanie przy błędzie przywraca poprzednie liczby, kolumna jest czytelna i neutralna (bez progów i kolorów jako nośnika), akapit pod siatką jest zrozumiały, a obsługa klawiaturą i czytnik nie mają nowych pułapek
- Na telefonie (lub emulacji): strona się ładuje, kolumna jest czytelna, tabela przewija się poziomo bez rozjeżdżania strony
- Po wdrożeniu (`npm run build` i `npx wrangler deploy`, bez migracji) kolumna "Godziny" pokazuje poprawne liczby na produkcji; nie uruchamiać `npm run smoke` na produkcji

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Testing Strategy

### Unit Tests:

- `workload.test.ts`: normy i sumy dla etatów 1/1, 3/4, 1/2 i 3/7, tygodnie ze świętem i z niedzielą świąteczną, osoba bez zmian, granice równo, o minutę poniżej i powyżej, zmiana nocna z dnia 6, kolejność i powtarzalność (`expectDeterministic`, `seededShuffle`), brak mutacji wejścia, niezależność od strefy czasowej.
- Brak testów komponentów i hooków (konwencja repo): `useWorkload` składa tylko dane z czystych funkcji.

### Integration Tests:

- Smoke stron: dokładny tekst kolumny "Godziny" dla sześciu przypadków (osoba z jedną zmianą, dwiema, nocą z dnia 6, bez zmian, na 1/2 etatu, równo z normą), tydzień ze świętem i sąsiedzi (zmienia się tylko wiersz właściwej osoby), brak `role="alert"` i `aria-live` w kolumnie.
- Kontrola celowego uszkodzenia po fazach z testami lub smoke (np. norma bez korekty świąt, suma liczona bez nocy z dnia 6, kolumna w `th scope="row"`): test lub smoke musi pójść na czerwono, jak w S-04.

### Manual Testing Steps:

1. W grafiku z kilkoma osobami o różnych etatach przypisać zmiany i sprawdzić sumę, normę i różnicę w wierszu każdej osoby po każdym kliknięciu.
2. Zdjąć przypisanie i sprawdzić, że liczby wracają bez odświeżania; zasymulować błąd zapisu (zatrzymany serwer) i sprawdzić, że wiersz wraca do poprzednich liczb.
3. Utworzyć grafik od wtorku 10.11.2026 (środa 11.11 to święto) i sprawdzić, że norma pełnego etatu to 32 h.
4. Sprawdzić czytelność na telefonie i odczyt kolumny w czytniku ekranu.

## Performance Considerations

Obliczenia są O(liczba przypisań) w jednym `useMemo` zależnym od `list`, więc koszt jest pomijalny przy rzędzie setek wpisów; ten sam kod liczy się też raz w Workerze przy renderze serwerowym wyspy (limit 10 ms CPU), razem z regułami S-05. Pomiar CPU po wdrożeniu robi S-05; jeśli ten wycinek jest wdrażany po nim, wystarczy powtórzyć pomiar `wrangler tail` dla strony obsadzania i dopisać wynik do `context/deployment/deploy-plan.md` tylko wtedy, gdy zmienił się o więcej niż marginalnie.

## Migration Notes

Bez migracji i bez zmian w bazie. Wdrożenie to `npm run build` i `npx wrangler deploy`. Zmiana jest addytywna (nowa kolumna i akapit), więc wdrożenie nie wymaga kolejności względem bazy.

## Parallel Work Notes

S-06 zależy od Fazy 1 planu S-05 (`live-rule-violations`): minuty zmian i etat w opcjach wyspy, kalendarz, norma tygodniowa, sumy godzin i `list` z hooka. Planowanie jest równoległe, ale implementacja zaczyna się po scaleniu tej fazy do bazy gałęzi. Wspólne pliki: `src/types.ts`, `AssignmentGrid.tsx`, `scripts/smoke.mjs`, `CLAUDE.md`, `AGENTS.md`, `README.md`, roadmapa. Żeby scalenie z S-05 (Fazy 2 do 5 mogą trwać równolegle) było tanie: nowe typy w środku `types.ts`; kolumna "Godziny" w osobnym `td` po kolumnie "Wskazania"; hook `useWorkload` w osobnym pliku, bez edycji `useViolations`; kroki smoke w środku bloku stron `/assign`, po krokach S-05; w dokumentacji nowe akapity zamiast edycji istniejących linii; w roadmapie każdy wycinek zmienia tylko swoje wiersze. Poprawki z przeglądu S-03 powinny być scalone przed implementacją.

## References

- Roadmap: `context/foundation/roadmap.md` (S-06, S-05, S-07, S-11), PRD: `context/foundation/prd.md` (FR-020, US-01, NFR), reguły: `context/foundation/work-time-rules.md` (D2, D4, D5, art. 130 i przypadki testowe)
- Plan S-05: `context/changes/live-rule-violations/plan.md` (Faza 1: fundamenty, kontrakt wskazań i `weekly_norm`; Faza 4: kolumna "Wskazania"; Faza 5: dokumentacja i pomiar CPU)
- Dane i widok: `src/types.ts:122-137`, `src/lib/services/shift.ts` (`formatDuration`, `shiftDurationMinutes`), `src/lib/services/assignment.ts:86-141`, `src/components/hooks/useAssignments.ts`, `src/components/schedules/AssignmentGrid.tsx:73-246`, `src/pages/schedules/[id]/assign.astro`
- Testy: `src/lib/testing/determinism.ts`, `src/lib/services/assignment.test.ts` (wzorzec); smoke: `scripts/smoke.mjs` (`gridOf`, `cutAtCoverage`, `showsCoverage`, kroki stron `/assign`)
- Poprzednie zmiany: `context/archive/2026-11-24-manual-shift-assignment/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Suma godzin i porównanie z normą

#### Automated

- [x] 1.1 Testy obciążenia przechodzą w workerd: `npm test` — 99bc869
- [x] 1.2 Linting przechodzi: `npm run lint` — 99bc869
- [x] 1.3 Sprawdzanie typów przechodzi: `npx astro check` — 99bc869

#### Manual

- [x] 1.4 Format tekstu godzin i różnicy (`32 h z 40 h`, `mniej o 8 h`, `więcej o 2 h 30 min`, `równo z normą`) i reguła zaokrąglania normy ułamkowej zostały przejrzane i zatwierdzone przez autora — 99bc869

### Phase 2: Kolumna "Godziny", smoke i wdrożenie

#### Automated

- [x] 2.1 Bramka przechodzi: `npx astro sync && npm run lint && npx astro check && npm test && npm run build` — a232459
- [x] 2.2 Smoke z istniejącymi i nowymi krokami stron przechodzi lokalnie: `npm run smoke` — a232459
- [ ] 2.3 CI na pull requeście jest zielone (job `ci` i job `smoke`)

#### Manual

- [x] 2.4 W przeglądarce na desktopie: kliknięcie przypisujące zmianę zmienia sumę i różnicę w wierszu osoby od razu, wycofanie przy błędzie przywraca poprzednie liczby, kolumna jest czytelna i neutralna (bez progów i kolorów jako nośnika), akapit pod siatką jest zrozumiały, a obsługa klawiaturą i czytnik nie mają nowych pułapek — a232459
- [x] 2.5 Na telefonie (lub emulacji): strona się ładuje, kolumna jest czytelna, tabela przewija się poziomo bez rozjeżdżania strony — a232459
- [ ] 2.6 Po wdrożeniu (`npm run build` i `npx wrangler deploy`, bez migracji) kolumna "Godziny" pokazuje poprawne liczby na produkcji; nie uruchamiać `npm run smoke` na produkcji
