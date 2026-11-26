# Live rule violations Implementation Plan

## Overview

Piąty wycinek domenowy Shiftly (S-05 z roadmapy, FR-010, US-01) i gwiazda przewodnia roadmapy: planista widzi na żywo, po każdym kliknięciu w widoku obsadzania `/schedules/<id>/assign`, krytyczne naruszenia reguł czasu pracy i ostrzeżenia, każde z czytelnym powodem i miejscem w grafiku. Reguły to czyste funkcje liczone w wyspie React ze stanu optymistycznego przypisań (S-04), więc wynik jest widoczny bez odpytywania serwera (NFR < 3 s). Wycinek nie dodaje migracji ani tabel. Reguły MVP (PRD): odpoczynek dobowy (11 h), limit 8 h w dobie, odpoczynek tygodniowy (35 h, 24 h przy zmianie zmiany), pułap 48 h w tygodniu (krytyczne) oraz przekroczenie normy tygodniowej etatu i brak kadrowy (ostrzeżenia). Plan zamyka też luki, które PRD i roadmapa zostawiły (granica z S-06, doba przy północy, krawędzie grafiku). Dostarcza kontrakt wskazania, który zużyją S-07 (nieobecności), S-08 (zatwierdzanie i zapis wskazań), S-09 (generator) i S-06 (suma godzin na wspólnych fundamentach). Plan powstał równolegle z planem S-06 (`workload-vs-norm`), a pierwsza faza tego planu dostarcza fundamenty obu.

## Current State Analysis

- Dane w wyspie obsadzania są niepełne dla reguł. `ShiftOption` ma tylko sformatowane teksty (`times`, `endsNextDay`, `duration`; `src/types.ts:122-130`), bez minut rozpoczęcia i zakończenia, a `EmployeeOption` ma tylko `id` i nazwisko z imieniem (`:133-137`, komentarz `:132`: "never the e-mail address or the FTE"). Mapowanie robi `src/lib/schedule-options.ts:8-20`; `assign.astro:26-38, 77-83` przekazuje je wyspie razem z całym `Schedule` i przypisaniami bez `source`.
- Godziny zmiany: `startMinute` i `endMinute` w `ShiftInput` (`types.ts:31-36`), `shiftDurationMinutes` (`src/lib/services/shift.ts:35-37`, `(end − start + 1440) % 1440`), `endsNextDay` (`:40-42`), `MINUTES_PER_DAY` (`:4`). Zmiana nocna liczy się do dnia startu (`schedules.sql:33-36`); zmiana z `dayOffset` 6 kończy się w następnym tygodniu (plan S-03:28: "odpoczynki między tygodniami należą do S-05").
- Stan przypisań: `useAssignments.ts` trzyma `Map` `assigned` (`:71-79`), a `list` (`:86`), `byEmployeeDay` (`:87`) i `coverage` (`:88`) są pochodnymi w `useMemo`; `toggle` (`:93-126`) zmienia stan przed `fetch` i wycofuje tylko jedną pozycję. Hook zwraca `{ byEmployeeDay, coverage, busy, error, toggle }` (`:128`), bez `list`. Czyste `groupByEmployeeDay` i `summarizeCoverage` (`src/lib/services/assignment.ts:95-141`) są precedensem liczenia w hooku.
- Widok: `AssignmentGrid.tsx` ma wiersz osoby `th scope="row"` z samym nazwiskiem (`:143-145`), komórki dnia z przyciskami (`:150-185`), podsumowanie obsady z tekstem "To informacja o obsadzie, nie błąd" (`:198-201`) i `CoverageValue` (`:73-91`). Brak miejsca na wskazania.
- Kalendarz: w repo nie ma dnia tygodnia (jest tylko polski skrót w `dayColumns`, `schedule.ts:126-134`), okresu rozliczeniowego, świąt ani Wielkanocy; helpery dat w `schedule.ts` (`parseIsoDate` `:73-87`, `addDays` `:102-107`) liczą w UTC, a części (`utcTime`, `partsOf`, `formatIso`, `DateParts`, `:44-67`) są prywatne.
- Testy: konwencja to czyste funkcje w `src/lib/services/` z testami w workerd (`vitest.config.ts:17`), bez testów komponentów i hooków; `expectDeterministic` i `seededShuffle` (`src/lib/testing/determinism.ts:17-25, 44-64`) przyjmują jedno wejście i porównują `toStrictEqual`, a mutacji wejścia nie wykrywają (trzeba ją sprawdzać `Object.freeze` i `structuredClone`, jak w `assignment.test.ts`). Workerd działa w UTC, więc zależność od strefy czasowej jest niewykrywalna testami: kod reguł musi używać wyłącznie API UTC (`schedule.ts:56-63`).
- Dziedzina (`context/foundation/work-time-rules.md`): doba to 24 h od rozpoczęcia pracy, nie doba kalendarzowa (`:25, 36`); tydzień to 7 dni od pierwszego dnia okresu rozliczeniowego (`:26`); odpoczynek tygodniowy skraca się do 24 h przy przejściu na inną zmianę (`:27, 41`); D2 miesiąc kalendarzowy, D3 limit 8 h z komunikatem o systemach równoważnych, D4 etat proporcjonalnie, D5 święta wyliczane z ustawy (`:80-84`); przypadki: normy 176, 168, 176 h (`:55-59`), odpoczynek 8 h to naruszenie, 11 h zgodne (`:63-64`). Niewiadome: doba przy północy i przejście na inną zmianę (`:66, 89-90`, roadmapa `:177`).
- Smoke jest kruchy względem nowych elementów strony: `gridOf` porównuje tekst `th scope="row"` co do znaku, `cutAtCoverage` tnie HTML po `coverage-heading`, `showsCoverage` wymaga dokładnego tekstu komórki (np. "0 z 5−5brakuje 5"), a `aria-label` przycisku jest porównywany dokładnie; zmiana API ma 22:00–07:00 (9 h), więc każde jej przypisanie jest naruszeniem limitu 8 h.
- Limit 10 ms CPU na żądanie (Workers Free): wyspa jest renderowana na serwerze (`client:load`), więc liczenie reguł odbywa się raz w Workerze przy każdym załadowaniu strony; `context/deployment/deploy-plan.md:125-131, 140` wprost każe powtórzyć pomiar po dodaniu walidatora reguł. Środowisko testowe tego limitu nie egzekwuje.
- Wejście do planu: poprawki z przeglądu S-03 (`follow-ups/review-fixes.md`) wchodzą przed implementacją: F2 (test kluczy `toEmployeeOptions`, który ta zmiana przestawi na `id`, `name`, `fte`) i F9 (wspólny komparator tekstu, którego reguły użyją).

## Desired End State

- Strona `/schedules/<id>/assign` pokazuje pod siatką listę wskazań pogrupowaną wagą (krytyczne pierwsze), a w komórkach osoby i dnia oraz w osobnej kolumnie "Wskazania" na końcu wiersza osoby tekstowe znaczniki wagi i liczby wskazań (kolor tylko dodatkiem). Każde wskazanie ma powód po polsku z liczbami (np. "przerwa 8 h 0 min, wymagane co najmniej 11 h") i wskazuje osobę oraz dzień. Po każdym kliknięciu (także po wycofaniu przy błędzie) lista i znaczniki liczą się od nowa z aktualnego stanu.
- Reguły: (krytyczne) odpoczynek dobowy poniżej 11 h, ponad 8 h w oknie 24 h od rozpoczęcia pracy (zmiana dłuższa niż 8 h z komunikatem, że systemy równoważne nie są obsługiwane), ponad 48 h w siedmiu dniach grafiku, brak odpoczynku tygodniowego (35 h, 24 h przy zmianie godziny rozpoczęcia); (ostrzeżenia) przekroczenie normy tygodniowej etatu (40 h × etat minus 8 h × etat za każde święto w dzień inny niż niedziela) i brak kadrowy (jedno ostrzeżenie na komórkę obsady). Nadmiar obsady nie jest wskazaniem.
- Reguły działają wyłącznie w obrębie jednego grafiku; strona mówi wprost, że odpoczynek na krawędziach (poprzedni i następny tydzień) nie jest sprawdzany. Narzędzie ostrzega i nie gwarantuje zgodności z prawem (guardrail PRD).
- Wynik jest deterministyczny i w kanonicznej kolejności (waga, reguła, pracownik, klucz); każde wskazanie ma stabilny klucz niezależny od kolejności wejścia, liczb i czasu.
- Fundamenty (minuty zmian i etat w wyspie, moduł kalendarza ze świętami, norma tygodniowa, sumy godzin, `list` z `useAssignments`) są gotowe dla S-06.
- Weryfikacja: `npx astro sync && npm run lint && npx astro check && npm test && npm run build` przechodzi, smoke przechodzi lokalnie i w CI, a po wdrożeniu pomiar CPU renderu strony obsadzania mieści się w limicie.

### Key Discoveries:

- Limit godzin z art. 129 i norma z art. 130 to ta sama liczba; roadmapa (S-05) każe ją oceniać jako krytyczną, a PRD dla S-06 mówi "bez progu i bez blokady". Norma prawna jest miesięczna i średnia, więc ocena jednego tygodnia jako krytyczna blokowałaby w S-08 grafiki zgodne z prawem (np. 44 h w tym tygodniu i 36 h w następnym). Decyzja autora: ostrzeżenie względem normy tygodniowej, a krytyczne zostają granice, które każdy tydzień musi spełnić (8 h, 11 h, 35 h, 48 h).
- Tydzień D2 (1-7, 8-14, ...) prawie nigdy nie pokrywa się z siedmioma dniami grafiku, więc odpoczynek tygodniowy liczony na tygodniach D2 prawie nigdy by się nie wykonał. Decyzja autora: tydzień to siedem dni grafiku; strona to nazywa.
- Odczyt "doba od rozpoczęcia pracy" (art. 128 § 3 pkt 1) łapie rotacje z wcześniejszym startem (pon. 08:00-16:00, wt. 06:00-14:00 daje 10 h w jednej dobie), których konwencja "cała zmiana do dnia startu" nie widzi; autor wybrał wersję prawną.
- Skrócenie odpoczynku tygodniowego do 24 h wymaga definicji "przejścia na inną zmianę", której słownik zmian (nazwa i godziny, nazwy mogą się powtarzać) nie daje; autor wybrał: inna godzina rozpoczęcia niż ostatnia zmiana przed przerwą.
- Brak kadrowy ma już gotowy kształt w `CoverageCell` (`missing`, `surplus`); wskazanie to jedno ostrzeżenie na komórkę z `missing > 0`.
- Granica własności: S-08 potrzebuje klucza wskazania do jawnego potwierdzenia ostrzeżeń (po jednym albo zbiorczo) i do weryfikacji po stronie serwera, że potwierdzony zbiór równa się przeliczonemu (wzorzec `p_confirm_removals` z S-04).

## What We're NOT Doing

- Nieobecności i kolizji z nimi (S-07), zatwierdzania, blokady krytycznych i zapisu wskazań (S-08), generowania (S-09), widoku pracownika (S-11). Wskazania nie są zapisywane: powstają w wyspie z bieżącego stanu.
- Odczytu sąsiednich grafików: odpoczynek między tygodniami nie jest sprawdzany (brak statusu i wersji do czasu S-08 i S-12, nakładające się szkice tego samego okresu). Zmiana nocna z ostatniego dnia liczy się z końcem poza grafikiem, ale nie oceniamy tego, co następuje po grafiku.
- Sumy godzin pokazywanej per osoba względem normy (S-06): S-05 dostarcza tylko fundamenty (`workedMinutesByEmployee`, `weeklyNorm`) i ostrzeżenie o przekroczeniu normy.
- Normy miesięcznej, okresu rozliczeniowego w wyświetlaniu i skumulowanych godzin z wielu grafików; reguły niedzieli i dni wolnych (art. 133 § 3, `work-time-rules.md:41`), nadgodzin, systemów równoważnych (art. 135 do 138), przerw w zmianie (czas zmiany to czas zegarowy) i zmiany czasu (DST).
- Migracji, nowych tabel, tras API, zmian w `access.ts`, `ci.yml`, `package.json`, nowych zmiennych środowiskowych i klucza service-role w Workerze.
- Testów komponentów i hooków (jak w S-01 do S-04): zachowanie wyspy sprawdza przegląd w przeglądarce, więc cała logika siedzi w czystych funkcjach.
- Rejestrowania i zatwierdzania wskazań (guardrail "rejestrowane, nigdy zatwierdzane po cichu" realizuje S-08 na kluczach z tego wycinka).
- Konfigurowalności progów i reguł (stała lista, PRD Non-Goals).

## Implementation Approach

Od środka na zewnątrz, jak w S-03 i S-04: fundamenty i dane (Faza 1), reguły odpoczynku i godzin (Faza 2), norma, brak kadrowy i silnik (Faza 3), widok (Faza 4), smoke, dokumentacja i wdrożenie (Faza 5). Każda faza kończy się własnym dowodem; Fazy 1 do 3 to wyłącznie czyste funkcje z testami deterministycznymi (powtarzalność, brak mutacji wejścia, granice co do minuty), więc ryzyko poprawności reguł jest rozstrzygnięte, zanim ruszy interfejs. Wszystkie fazy trafiają do jednego pull requesta, ale S-06 startuje implementację po Fazie 1 (zob. "Parallel Work Notes").

Decyzje z wywiadu: ostrzeżenie względem normy tygodniowej (a nie krytyczne), fundamenty w Fazie 1 tego planu, doba jako okno 24 h od rozpoczęcia pracy, ocena tylko w obrębie jednego grafiku, tydzień to siedem dni grafiku, przejście na inną zmianę to inna godzina rozpoczęcia, zmiana dłuższa niż 8 h jako krytyczna z komunikatem, lista wskazań pod siatką plus znaczniki w komórkach.

Rozstrzygnięte w planowaniu (do zakwestionowania przy zatwierdzaniu):
- Pułap 48 h w siedmiu dniach grafiku jest krytyczny (suma pełnych czasów trwania zmian rozpoczętych w grafiku).
- Okna doby: dla każdej zmiany jako początku okna liczone są faktyczne minuty pracy tej osoby w oknie `[start, start + 24 h)` (także część zmiany z poprzedniej doby, jeśli zachodzi na okno); naruszenie raportowane jest raz na grupę nakładających się okien (okno, którego początek leży w już zgłoszonym oknie tej samej osoby, jest pomijane).
- Odpoczynek tygodniowy jest spełniony, gdy w osi czasu osoby (siedem dni grafiku, krawędzie liczone jako odpoczynek od początku i do końca grafiku) istnieje przerwa nie krótsza niż 35 h albo nie krótsza niż 24 h, jeśli zmiana przed przerwą i po niej mają różną godzinę rozpoczęcia. Krawędzie nigdy nie dają fałszywych krytycznych.
- Klucz wskazania: `<reguła>|<pracownik albo ->|<kotwice posortowane>`, bez liczb, indeksów i czasu; kolejność wyniku: waga (krytyczne pierwsze), reguła w ustalonej kolejności, pracownik, klucz (porządek kodowych jednostek tekstu, nie `Intl.Collator`).
- Powody budują czyste funkcje reguł (z nazwiskiem, nazwą zmiany, etykietą dnia z `dayColumns` i liczbami w godzinach i minutach), żeby S-08 mogło je zamrozić jako tekst; wskazanie niesie też liczby (`actual`, `limit`, `unit`).
- Przypisanie do zmiany, której nie ma w dostarczonych godzinach (np. "(niedostępne)"), jest pomijane przez reguły czasowe (nie ma minut), bez cichego błędu: wskazanie "brak godzin zmiany" nie powstaje, a brak kadrowy liczy się dalej z samych przypisań.
- Święta liczone dla lat 2020 do 2099 (zakres dat grafiku); Wigilia (24 grudnia) jest dniem wolnym od 2025 r.

## Critical Implementation Details

- **Wspólny kształt dwóch plików**: `useAssignments.ts` zwraca `list` (jedna linia, robiona w Fazie 1, żeby S-06 jej nie dotykało), a `AssignmentGrid.tsx` dostaje kolumnę "Wskazania" jako `td` po kolumnach dni; kolumnę "Godziny" S-06 dopisze po niej. Nowe elementy nie mogą trafić do `th scope="row"` ani do `aria-label` przycisków (kroki smoke porównują ich tekst dokładnie) ani do tabeli z `th scope="row"` po sekcji `coverage-heading` (`cutAtCoverage` policzyłby ją jako wiersz pokrycia): lista wskazań to osobny element (`section` z listą `ul`).
- **Strefa czasowa**: cały kod reguł i kalendarza używa wyłącznie API UTC (`Date.UTC`, `getUTC*`) albo arytmetyki na minutach; testy w workerd (UTC) tego nie wykryją, więc test szpieguje lokalne gettery (`Date.prototype.getDate` itp.) i wymaga, by nie były wołane.
- **Kolejność w `useAssignments`**: reguły liczone są z `list` (stan optymistyczny), nie z `props.assignments`, więc odświeżają się także przy wycofaniu; w trakcie żądania wskazanie może mignąć i zniknąć, co jest oczekiwane.
- **Wymierna norma**: etat to ułamek `n/d`, więc norma w minutach nie musi być całkowita; porównanie (`suma × d > baza × n`) jest dokładne, a zaokrąglenie dotyczy tylko wyświetlania.

## Phase 1: Fundamenty

### Overview

Dodać dane potrzebne regułom i S-06 w wyspie (minuty zmian, etat), moduł kalendarza ze świętami, normę tygodniową i sumy godzin, wszystko jako czyste funkcje z testami, oraz udostępnić `list` z hooka. Zmiana zachowania aplikacji jest minimalna: wyspa dostaje więcej pól, a strona działa jak dotąd.

### Changes Required:

#### 1. Typy i opcje wyspy

**File**: `src/types.ts`, `src/lib/schedule-options.ts` (+ testy)

**Intent**: Dać wyspie surowe minuty zmiany i etat pracownika, których reguły potrzebują, i zmienić komentarz o etacie, który przestaje być prawdą (e-mail nadal nie trafia do wyspy). Strona planisty jest `no-store` i dostępna tylko dla planisty.

**Contract**: `ShiftOption` dostaje `startMinute: number` i `endMinute: number` (minuty od północy, jak w `ShiftInput`); `EmployeeOption` dostaje `fte: Fte`, a komentarz przy nim brzmi, że wyspa dostaje imię, nazwisko i etat, nigdy adres e-mail. `toShiftOptions` i `toEmployeeOptions` kopiują te pola. Test jednostkowy `schedule-options.test.ts` (nowy) przypina dokładne klucze (`id`, `name`, `fte` oraz `id`, `name`, `times`, `endsNextDay`, `duration`, `startMinute`, `endMinute`) przez `toStrictEqual`; to zastępuje test z poprawki F2 przeglądu S-03 (jeśli już istnieje, aktualizuje jego oczekiwane klucze). Typy nowe wstawiać w środku `src/types.ts`, nie na końcu.

#### 2. Kalendarz

**File**: `src/lib/services/calendar.ts` (nowy), `src/lib/services/calendar.test.ts` (nowy)

**Intent**: Jedno źródło prawdy o dniu tygodnia i dniach wolnych od pracy, jako czyste funkcje UTC bez importów `astro:*`.

**Contract**: `weekdayOf(isoDate: string): number` (0 niedziela do 6 sobota) i `isSunday`; `easterSunday(year): { month: number; day: number }` (algorytm anonimowy gregoriański); `polishHolidays(year: number): string[]` posortowane `YYYY-MM-DD`: 1 stycznia, 6 stycznia, niedziela i poniedziałek Wielkiej Nocy, 1 maja, 3 maja, Zielone Świątki (Wielkanoc + 49 dni), Boże Ciało (Wielkanoc + 60 dni), 15 sierpnia, 1 listopada, 11 listopada, 24 grudnia (tylko od 2025), 25 i 26 grudnia; `isHoliday(isoDate)`; `holidaysInWeek(startDate): string[]` (święta w siedmiu dniach od `startDate`, tylko w dni inne niż niedziela, bo tylko takie obniżają normę). Wejście niepoprawne daje błąd jak `parseIsoDate`. Testy: Wielkanoc 2020-2030 (2020-04-12, 2021-04-04, 2022-04-17, 2023-04-09, 2024-03-31, 2025-04-20, 2026-04-05, 2027-03-28, 2028-04-16, 2029-04-01, 2030-04-21), Zielone Świątki 2026-05-24 i Boże Ciało 2026-06-04 z dokumentu reguł, 24 grudnia 2024 nie jest świętem a 2025 jest, 3 maja 2026 i 1 listopada 2026 to niedziele (wypadają z `holidaysInWeek`), granice lat 2020 i 2099; wyrocznia: test-only helper liczący wymiar miesiąca według art. 130 (40 h × tygodnie + 8 h × pozostałe dni pon.-pt. − 8 h × święta poza niedzielą) z `isHoliday` i `weekdayOf` musi dać 176 h (marzec 2026), 168 h (kwiecień 2026) i 176 h (październik 2026) z `work-time-rules.md:55-59`; powtarzalność przez `expectDeterministic`; test szpiegujący lokalne gettery `Date`.

#### 3. Godziny i norma tygodniowa

**File**: `src/lib/services/work-hours.ts` (nowy), `src/lib/services/work-hours.test.ts` (nowy)

**Intent**: Wspólne dla S-05 i S-06 obliczenia na minutach: przedziały pracy, suma godzin osoby i norma tygodniowa.

**Contract**: `ShiftTimes { id: string; name: string; startMinute: number; endMinute: number }`; `shiftInterval(shift, dayOffset): { start: number; end: number }` (minuty od północy dnia 0: `start = dayOffset × 1440 + startMinute`, `end = start + czas trwania` z `shiftDurationMinutes`); `workedMinutesByEmployee(assignments, shifts): Record<string, number>` (suma pełnych czasów trwania zmian rozpoczętych w grafiku, klucze posortowane; przypisania do nieznanej zmiany pomijane); `weeklyNorm(startDate: string, fte: Fte): WeeklyNorm` (`baseMinutes = 2400 − 480 × holidaysInWeek(startDate).length`, ułamek etatu `n/d`, lista świąt) oraz `normMinutes(norm): number` (zaokrąglone do minuty, do wyświetlania) i `exceedsNorm(workedMinutes, norm): boolean` (dokładnie: `worked × d > base × n`). Testy: norma 40 h dla etatu 1/1, 30 h dla 3/4, 20 h dla 1/2, 17 h 9 min dla 3/7 (1028,57 minuty zaokrąglone do 1029; porównanie dokładne, bez zaokrąglenia), tydzień od wt. 10.11.2026 z środą 11.11 (norma 32 h), tydzień z niedzielą świąteczną (norma bez zmian), tydzień z Wigilią w 2025; granica `exceedsNorm` równa normie i o minutę powyżej; zmiana nocna rozpoczęta w dniu 6 liczy się w całości; brak mutacji wejścia; `expectDeterministic` z wariantami z `seededShuffle`.

#### 4. Lista przypisań z hooka

**File**: `src/components/hooks/useAssignments.ts`

**Intent**: Udostępnić `list` (pochodna ze stanu optymistycznego), której potrzebują reguły i S-06.

**Contract**: wartość zwracana dostaje pole `list: AssignmentInput[]` (istniejące `list` z `useMemo`, bez zmiany logiki).

### Success Criteria:

#### Automated Verification:

- Testy fundamentów i opcji wyspy przechodzą w workerd: `npm test`
- Linting przechodzi: `npm run lint`
- Sprawdzanie typów przechodzi: `npx astro check`

#### Manual Verification:

- Lista świąt (w tym ruchomych i Wigilia od 2025), wektory normy (176, 168, 176 h oraz 40, 32, 30 h) i definicja normy tygodniowej (40 h × etat − 8 h × etat za święto w dzień inny niż niedziela) zostały przejrzane i zatwierdzone przez autora

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Reguły odpoczynku i godzin

### Overview

Dodać typy wskazania i reguły krytyczne liczone na osi czasu osoby: odpoczynek dobowy, limit 8 h w oknie 24 h, pułap 48 h i odpoczynek tygodniowy, z powodami po polsku i kluczem. Czyste funkcje z testami granic co do minuty; widok się nie zmienia.

### Changes Required:

#### 1. Typy wskazania

**File**: `src/types.ts`

**Intent**: Kontrakt wskazania dla UI i dla S-07, S-08, S-09. Wstawić w środku pliku.

**Contract**: `ViolationSeverity = "critical" | "warning"`; `ViolationRule = "daily_rest" | "daily_hours" | "weekly_hours" | "weekly_rest" | "weekly_norm" | "understaffed"`; `ViolationAnchor { shiftId: string; dayOffset: number; employeeId: string | null }` (przypisanie albo, przy `employeeId` równym `null`, komórka obsady); `Violation { key: string; severity: ViolationSeverity; rule: ViolationRule; employeeId: string | null; anchors: ViolationAnchor[]; reason: string; actual: number; limit: number; unit: "minutes" | "people" }`. Wskazania o zasięgu całego tygodnia osoby mają pustą listę kotwic.

#### 2. Reguły

**File**: `src/lib/services/rules.ts` (nowy), `src/lib/services/rules.test.ts` (nowy)

**Intent**: Czyste funkcje liczące naruszenia z przypisań, godzin zmian i etatu, deterministyczne, bez mutacji wejścia i bez importów `astro:*`.

**Contract**: `RuleInput { startDate: string; staffing: StaffingCell[]; assignments: AssignmentInput[]; shifts: ShiftTimes[]; employees: { id: string; name: string; fte: Fte }[] }`. Wspólna oś: przedziały osoby z `shiftInterval`, posortowane po początku, końcu i `shiftId`. Funkcje (każda zwraca `Violation[]`, wszystkie krytyczne):
- Odpoczynek dobowy: dla kolejnych przedziałów osoby przerwa liczona od największego dotąd końca do początku następnego; przerwa poniżej 660 minut to naruszenie (próg włącznie: 660 jest zgodne, 659 nie), przerwa ujemna to nakładanie się zmian z odrębnym powodem; kotwice: dwa przypisania.
- Limit 8 h w dobie: okno `[start, start + 1440)` zaczyna się w początku każdej zmiany; godziny to faktyczne minuty pracy osoby w oknie (część zmiany z poprzedniej doby, która zachodzi na okno, też); ponad 480 minut to naruszenie (480 zgodne, 481 nie); okno zaczynające się w już zgłoszonym oknie tej osoby jest pomijane; kotwice: przypisania, które zachodzą na okno; powód podaje początek okna i godziny, a gdy którakolwiek zmiana w oknie trwa ponad 480 minut, dodaje zdanie, że zmiana dłuższa niż 8 h wymaga systemu równoważnego (art. 135), którego Shiftly nie obsługuje.
- Pułap 48 h: suma pełnych czasów trwania zmian osoby rozpoczętych w grafiku ponad 2880 minut (2880 zgodne, 2881 nie); bez kotwic.
- Odpoczynek tygodniowy: oś siedmiu dni `[0, 10080)` z przerwami między przedziałami i krawędziami (od 0 do pierwszego początku i od ostatniego końca do 10080); spełniony, gdy istnieje przerwa co najmniej 2100 minut albo co najmniej 1440 minut przy różnej godzinie rozpoczęcia (minuta w dobie) zmiany przed przerwą i po niej (krawędź nie ma sąsiada, więc próg 2100); osoba bez zmian bez naruszenia; naruszenie podaje najdłuższą przerwę i próg, który do niej się stosuje (`actual`, `limit`); bez kotwic.
Klucz i kolejność jak w "Implementation Approach". Powody po polsku z nazwiskiem, etykietą dnia (`dayColumns`) i czasem w godzinach i minutach. Testy tabelaryczne `it.each` z granicami (659/660 minut przerwy, 480/481 minut w oknie, 2880/2881 minut w tygodniu, 2099/2100 i 1439/1440 minut przerwy tygodniowej), przypadkami z dokumentu reguł (koniec 22:00 i start 06:00 to 8 h naruszenie, start 09:00 to 11 h zgodne), rotacją pon. 08:00-16:00 i wt. 06:00-14:00 (10 h w oknie, naruszenie), tą samą rotacją bez przesunięcia (pon. 08:00-16:00, wt. 08:00-16:00: zgodne), zmianą nocną 22:00-06:00 po dniu z zmianą dzienną, zmianą dłuższą niż 8 h z komunikatem, dwoma zmianami jednej osoby w dniu, nakładającymi się zmianami, nocą z dnia 6 (koniec poza grafikiem), osobą bez zmian, przypisaniem do nieznanej zmiany, unikalnością klucza i brakiem duplikatów przy grupie nakładających się okien; `expectDeterministic` z wariantami z `seededShuffle`, `Object.freeze` i `structuredClone` na wejściu, test szpiegujący lokalne gettery `Date`.

### Success Criteria:

#### Automated Verification:

- Testy reguł przechodzą w workerd: `npm test`
- Linting przechodzi: `npm run lint`
- Sprawdzanie typów przechodzi: `npx astro check`

#### Manual Verification:

- Powody po polsku, przykłady z granicami (8 h i 11 h, 10 h w oknie doby, 35 h i 24 h) i zachowanie na krawędziach grafiku zostały przejrzane i zatwierdzone przez autora

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 3: Norma, brak kadrowy i silnik

### Overview

Dołożyć ostrzeżenia (norma tygodniowa, brak kadrowy) i jedną funkcję `evaluateSchedule` składającą wszystkie reguły w kanonicznej kolejności, z testami determinizmu całości.

### Changes Required:

#### 1. Ostrzeżenia

**File**: `src/lib/services/rules.ts`, `src/lib/services/rules.test.ts`

**Intent**: Reguły niekrytyczne na tych samych danych i tym samym kluczu.

**Contract**: Norma tygodniowa: dla każdej osoby `exceedsNorm(workedMinutes, weeklyNorm(startDate, fte))` daje ostrzeżenie `weekly_norm` (bez kotwic; `actual` to suma, `limit` to norma zaokrąglona do minuty, powód podaje etat i święta obniżające normę); osoba bez etatu w danych jest pomijana. Brak kadrowy: dla każdej komórki z `summarizeCoverage(staffing, assignments)` z `missing > 0` ostrzeżenie `understaffed` z kotwicą `{ shiftId, dayOffset, employeeId: null }`, `actual` jako liczba przypisanych i `limit` jako wymagana liczba (`unit: "people"`); powód podaje nazwę zmiany, godziny i etykietę dnia; nadmiar nie jest wskazaniem. Testy: równo z normą i o minutę powyżej, etat 3/4 i 1/2, tydzień ze świętem obniżającym normę, osoba powyżej 48 h (krytyczne `weekly_hours` i ostrzeżenie `weekly_norm` naraz), komórki z brakiem, kompletem, nadmiarem i bez przypisań, wyłączność nadmiaru.

#### 2. Silnik

**File**: `src/lib/services/rules.ts`, `src/lib/services/rules.test.ts`

**Intent**: Jeden punkt wejścia dla UI, S-07, S-08 i S-09.

**Contract**: `evaluateSchedule(input: RuleInput): Violation[]` składa wszystkie reguły (krytyczne i ostrzeżenia), sortuje według wagi (krytyczne pierwsze), kolejności reguł (`daily_rest`, `daily_hours`, `weekly_hours`, `weekly_rest`, `weekly_norm`, `understaffed`), pracownika i klucza, i zwraca nową tablicę; wynik nie zależy od kolejności wejścia. Dodatkowo `summarizeViolations(violations): { critical: number; warning: number }` dla licznika w UI. Testy: kompletny grafik bez wskazań, grafik z pełnym zestawem wskazań (przypadek zbiorczy zapisany w teście jako tabela oczekiwanych kluczy i powodów), niezależność od kolejności przypisań, zmian, pracowników i komórek (`seededShuffle`), brak mutacji wejścia, unikalność kluczy, `expectDeterministic` na całości.

### Success Criteria:

#### Automated Verification:

- Testy reguł i silnika przechodzą w workerd: `npm test`
- Linting przechodzi: `npm run lint`
- Sprawdzanie typów przechodzi: `npx astro check`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 4: Widok wskazań

### Overview

Pokazać wskazania w widoku obsadzania: lista pod siatką, znaczniki w komórkach i kolumna "Wskazania", aktualizowane po każdym kliknięciu ze stanu optymistycznego. Istniejące kroki smoke zostają zielone (aktualizujemy tylko to, co zmienia się przez nowe elementy).

### Changes Required:

#### 1. Hook wskazań

**File**: `src/components/hooks/useViolations.ts` (nowy)

**Intent**: Policzyć wskazania ze stanu hooka obsadzania, w jednym `useMemo`, bez efektów ubocznych.

**Contract**: `useViolations({ schedule, shifts, employees, list })` zwraca `{ violations: Violation[]; counts: { critical: number; warning: number }; byEmployeeDay: Record<string, Violation[]>; byEmployee: Record<string, Violation[]> }` (klucze osoba/dzień jak `employeeDayKey`, wskazania z kotwicami przypisania trafiają do komórek ich osoby i dnia, wskazania bez kotwic i brak kadrowy do wiersza osoby albo tylko do listy); dane do `RuleInput` budowane z `ShiftOption` (minuty), `EmployeeOption` (etat), `Schedule` (`startDate`, `staffing`).

#### 2. Lista wskazań i znaczniki

**File**: `src/components/schedules/ViolationList.tsx` (nowy), `src/components/schedules/AssignmentGrid.tsx`

**Intent**: Czytelny powód i miejsce każdego wskazania, bez kolorów jako jedynego nośnika i bez naruszania struktury istniejących tabel.

**Contract**: `ViolationList` to `section` z nagłówkiem i listą `ul`: najpierw krytyczne, potem ostrzeżenia, każdy wpis z słowem wagi ("Krytyczne" lub "Ostrzeżenie"), powodem i wskazaniem osoby i dnia (lub zmiany i dnia przy braku kadrowym), z licznikiem w `aria-live="polite"` ("Wskazania: 1 krytyczne, 2 ostrzeżenia" albo "Brak wskazań"). `AssignmentGrid` dostaje w komórce osoby i dnia pod przyciskami znacznik tekstowy ("Krytyczne" lub "Ostrzeżenie" z liczbą, ikona dodatkiem) tylko gdy są wskazania, a po kolumnach dni dodatkową kolumnę `td` "Wskazania" z licznikiem wskazań osoby (tekst); nagłówek wiersza i `aria-label` przycisków pozostają bez zmian. Tekst pod tabelą obsady zmienia się z "To informacja o obsadzie, nie błąd" na zdanie, że brak obsady jest ostrzeżeniem widocznym na liście, a nadmiar informacją. Pod listą stały akapit: reguły oceniają ten grafik, odpoczynek na jego krawędziach (poprzedni i następny tydzień) nie jest sprawdzany, a Shiftly ostrzega i nie gwarantuje zgodności z prawem. Nic z tego nie używa `role="alert"` dla zwykłych wskazań (żeby nie anonsować się przy każdym kliknięciu); błędy zapisu zostają w istniejącym `ServerError`.

#### 3. Aktualizacja smoke

**File**: `scripts/smoke.mjs`

**Intent**: Dostosować istniejące kroki stron `/assign` do nowej struktury, bez osłabiania asercji.

**Contract**: `gridOf`, `cutAtCoverage`, `showsCoverage` i kroki, które liczą `td` w wierszu albo tekst pod tabelą obsady, uwzględniają dodatkową kolumnę i zmieniony tekst; grafik API (bez przypisań, z obsadą) ma teraz na stronie wskazania braku kadrowego, więc jego krok dostaje jawne oczekiwanie liczby i treści tych ostrzeżeń (każda komórka z brakiem), a grafik trasy przypisań (jedno przypisanie świadka) oczekuje dokładnie tych wskazań, które z niego wynikają (świadek sam; brak kadrowy zamiast naruszeń). Pomocniki dopisywać po istniejących, w środku bloku stron.

### Success Criteria:

#### Automated Verification:

- Bramka przechodzi: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- Smoke z istniejącymi i zaktualizowanymi krokami stron przechodzi lokalnie: `npm run smoke`

#### Manual Verification:

- W przeglądarce na desktopie: kliknięcie przypisujące zmianę wywołuje i usuwa wskazania od razu (lista, znaczniki w komórkach, kolumna "Wskazania", licznik), powody są czytelne i wskazują osobę i dzień, wycofanie przy błędzie przywraca poprzednie wskazania, kolory nie są jedynym nośnikiem wagi, obsługa klawiaturą i odczyt licznika przez czytnik
- Na telefonie (lub emulacji): strona się ładuje, lista wskazań jest czytelna, tabela przewija się poziomo bez rozjeżdżania strony

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 5: Smoke, dokumentacja i wdrożenie

### Overview

Dowieść wskazań w smoke na prawdziwych danych (asercje przyczyny: reguła, osoba, dzień i treść powodu), opisać je w dokumentacji i wdrożyć z pomiarem CPU renderu.

### Changes Required:

#### 1. Smoke: wskazania

**File**: `scripts/smoke.mjs`

**Intent**: Sprawdzić na prawdziwej sesji planisty, że wskazania powstają dla właściwych danych, z właściwym powodem i miejscem, i znikają dla sąsiadów bez naruszenia.

**Contract**: Osobny grafik `Smoke-<runId>-rules` utworzony przez `POST /api/schedules` z dwiema zmianami użytymi w istniejących danych smoke (22:00–07:00, 9 h, i 06:00–14:00, 8 h) i jedną osobą na scenariusz, z przypisaniami dodawanymi trasą przypisań. Kroki strony `/schedules/<id>/assign`, każdy z asercją reguły, osoby, dnia i dokładnej treści powodu: zmiana 22:00–07:00 sama (krytyczne `daily_hours` z komunikatem o systemie równoważnym); zmiana 06:00–14:00 i tego samego dnia 22:00–07:00 (krytyczne `daily_rest` z przerwą 8 h i `daily_hours`); zmiany tej samej osoby z przerwą dokładnie 11 h (zgodne, brak `daily_rest`); osoba z przypisaniami w siedmiu dniach (krytyczne `weekly_rest`); brak kadrowy (ostrzeżenie na komórkę); stan "komplet, nadmiar, brak, bez przypisań" w podsumowaniu obsady. Kroki "sąsiadów": wskazanie znika tylko dla właściwej osoby i dnia, a inna osoba tego dnia, ta sama osoba innego dnia i inna zmiana zostają bez zmian (po zdjęciu przypisania przez trasę i ponownym wczytaniu strony). Asercje sprawdzają tekst listy i znaczników, nie samą klasę statusu, a stały akapit o krawędziach i brak `role="alert"` dla wskazań.

#### 2. Dokumentacja

**File**: `CLAUDE.md`, `AGENTS.md`, `README.md`

**Intent**: Utrzymać dokumentację zgodną z kodem.

**Contract**: Nowe akapity (nie edycja istniejących długich linii) o regułach i wskazaniach (`src/lib/services/rules.ts`, `work-hours.ts`, `calendar.ts`, hook `useViolations`, lista wskazań), o decyzjach (norma tygodniowa jako ostrzeżenie, doba jako okno 24 h, tydzień to siedem dni grafiku, krawędzie niesprawdzone) i o tym, że wyspa dostaje etat; poprawka zdania o etacie wyspy ("never the FTE") w `CLAUDE.md` i `AGENTS.md`; uzupełnienie opisu `npm run smoke`; `README.md`: opis strony obsadzania. Nie dotykać fragmentów o service-role.

#### 3. Pomiar CPU

**File**: `context/deployment/deploy-plan.md`

**Intent**: Powtórzyć pomiar wymagany przez dokument po dodaniu walidatora reguł (`:140`).

**Contract**: Po wdrożeniu zmierzyć `wrangler tail` dla kilku wywołań strony `/schedules/<id>/assign` (pierwsze wywołanie w nowym izolacie i kolejne) i zapisać wynik w sekcji pomiarów dokumentu; jeśli wartości zbliżają się do 10 ms, zapisać to jako ryzyko dla S-09 (generator) i rozważyć przeniesienie obliczeń z renderu serwerowego (np. `client:only`) osobną zmianą.

### Success Criteria:

#### Automated Verification:

- Bramka przechodzi: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- Smoke z krokami wskazań przechodzi lokalnie: `npm run smoke`
- CI na pull requeście jest zielone (job `ci` i job `smoke`)

#### Manual Verification:

- Po wdrożeniu (`npm run build` i `npx wrangler deploy`, bez migracji) wskazania pojawiają się i znikają na produkcji; nie uruchamiać `npm run smoke` na produkcji
- Pomiar CPU renderu strony obsadzania po wdrożeniu mieści się w limicie 10 ms na żądanie (albo wynik jest zapisany w `deploy-plan.md` razem z decyzją)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Testing Strategy

### Unit Tests:

- `calendar.test.ts`, `work-hours.test.ts`, `rules.test.ts`, `schedule-options.test.ts`: granice co do minuty, przypadki z `work-time-rules.md`, wektory świąt i norm, powtarzalność (`expectDeterministic`, `seededShuffle`), brak mutacji wejścia (`Object.freeze`, `structuredClone`), niezależność od strefy czasowej (szpiegowanie lokalnych getterów `Date`).
- Brak testów komponentów i hooków (konwencja repo): `useViolations` ma tylko kod składający dane, a cała logika siedzi w czystych funkcjach.

### Integration Tests:

- Smoke stron (Fazy 4 i 5): istniejące kroki `/assign` po zmianie struktury, kroki wskazań z asercjami przyczyny, stany obsady i sąsiedzi, brak `role="alert"` dla wskazań.
- Kontrola celowego uszkodzenia w każdej fazie z testami lub smoke (reguła psuta celowo, test czerwony), jak w S-04.

### Manual Testing Steps:

1. W grafiku z dwiema zmianami (06:00–14:00, 22:00–07:00) przypisać jedną osobę do obu w tym samym dniu i sprawdzić wskazania odpoczynku i doby, ich powody i znaczniki.
2. Zdjąć jedno z przypisań i sprawdzić, że wskazania znikają bez odświeżania, a przy zasymulowanym błędzie (zatrzymany serwer) wracają razem z przyciskiem.
3. Przypisać jedną osobę do zmian w siedmiu dniach i sprawdzić wskazania odpoczynku tygodniowego, a potem zostawić jej jedną przerwę 35 h i sprawdzić, że wskazanie znika.
4. Sprawdzić ostrzeżenie względem normy w tygodniu ze świętem (np. od wt. 10.11.2026) i braki kadrowe przy świeżo utworzonym grafiku.
5. Sprawdzić licznik w czytniku ekranu, klawiaturę i telefon.

## Performance Considerations

Reguły liczone są w `useMemo` zależnym od `list`, więc przy każdym kliknięciu raz; danych jest rząd setek wpisów (30 osób × 7 dni × kilka zmian), a złożoność to O(n²) tylko w obrębie jednej osoby (do kilkunastu zmian). Ten sam kod liczy się też raz w Workerze przy renderze serwerowym wyspy (`client:load`), gdzie obowiązuje limit 10 ms CPU, a środowisko testowe go nie egzekwuje; pomiar po wdrożeniu jest jawnym wierszem planu. Jeśli wartości będą blisko limitu, przejście na `client:only` dla obliczeń jest osobną zmianą. Odczyt przypisań nadal ma strażnika 1000 wierszy z S-04.

## Migration Notes

Bez migracji i bez zmian w bazie. Wdrożenie to `npm run build` i `npx wrangler deploy`. Zmiana jest addytywna (dodatkowe pola w propsach wyspy i nowe elementy strony), więc wdrożenie nie wymaga kolejności względem bazy.

## Parallel Work Notes

Równolegle jest planowany S-06 (`workload-vs-norm`, plan w `context/changes/workload-vs-norm/`), którego implementacja zaczyna się po Fazie 1 tego planu (fundamenty: minuty i etat w wyspie, kalendarz, norma, sumy godzin, `list` z hooka). Wspólne pliki: `src/types.ts`, `src/lib/schedule-options.ts`, `AssignmentGrid.tsx`, `useAssignments.ts`, `assign.astro`, `scripts/smoke.mjs`, `CLAUDE.md`, `AGENTS.md`, `README.md`, roadmapa. Żeby kolejne scalenie było tanie: S-05 robi wszystkie wspólne zmiany danych w Fazie 1; S-06 dopisuje kolumnę "Godziny" po kolumnie "Wskazania" w osobnym komponencie; nowe typy w środku `types.ts`; kroki smoke wstawiać w środku bloku stron `/assign`; w dokumentacji nowe akapity zamiast edycji istniejących linii; w roadmapie każdy wycinek zmienia tylko swoje wiersze (sąsiednie wiersze S-05 i S-06 w tabeli mogą dać trywialny konflikt przy scaleniu). Poprawki z przeglądu S-03 (`context/changes/weekly-schedule-draft/follow-ups/review-fixes.md`) powinny być scalone przed implementacją, bo F2 i F9 dotykają `schedule-options.ts` i komparatora.

## References

- Roadmap: `context/foundation/roadmap.md` (S-05 i S-06, S-07, S-08, S-09, S-11), PRD: `context/foundation/prd.md` (FR-010, US-01, Guardrails, NFR), reguły: `context/foundation/work-time-rules.md` (D1 do D6, przypadki testowe `:51-66`)
- Dane i widok: `src/types.ts:31-137`, `src/lib/schedule-options.ts:8-20`, `src/lib/services/shift.ts:4-61`, `src/lib/services/schedule.ts:44-134`, `src/lib/services/assignment.ts:86-141`, `src/components/hooks/useAssignments.ts:71-128`, `src/components/schedules/AssignmentGrid.tsx:10-246`, `src/pages/schedules/[id]/assign.astro`
- Testy: `src/lib/testing/determinism.ts`, `src/lib/services/assignment.test.ts` (wzorzec), `src/lib/services/schedule.test.ts`
- Smoke: `scripts/smoke.mjs` (`gridOf`, `cutAtCoverage`, `showsCoverage`, kroki stron `/assign`), CPU: `context/deployment/deploy-plan.md:125-131, 140`
- Poprzednie zmiany: `context/archive/2026-11-24-manual-shift-assignment/plan.md` (kontrakt przypisań, decyzje o nadmiarze i kilku zmianach w dniu), `context/changes/weekly-schedule-draft/plan.md` (konwencja dnia startu zmiany nocnej) i `reviews/impl-review.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Fundamenty

#### Automated

- [x] 1.1 Testy fundamentów i opcji wyspy przechodzą w workerd: `npm test` — 85ef16d
- [x] 1.2 Linting przechodzi: `npm run lint` — 85ef16d
- [x] 1.3 Sprawdzanie typów przechodzi: `npx astro check` — 85ef16d

#### Manual

- [x] 1.4 Lista świąt (w tym ruchomych i Wigilia od 2025), wektory normy (176, 168, 176 h oraz 40, 32, 30 h) i definicja normy tygodniowej (40 h × etat − 8 h × etat za święto w dzień inny niż niedziela) zostały przejrzane i zatwierdzone przez autora — 85ef16d

### Phase 2: Reguły odpoczynku i godzin

#### Automated

- [x] 2.1 Testy reguł przechodzą w workerd: `npm test` — cf2bde0
- [x] 2.2 Linting przechodzi: `npm run lint` — cf2bde0
- [x] 2.3 Sprawdzanie typów przechodzi: `npx astro check` — cf2bde0

#### Manual

- [x] 2.4 Powody po polsku, przykłady z granicami (8 h i 11 h, 10 h w oknie doby, 35 h i 24 h) i zachowanie na krawędziach grafiku zostały przejrzane i zatwierdzone przez autora — cf2bde0

### Phase 3: Norma, brak kadrowy i silnik

#### Automated

- [x] 3.1 Testy reguł i silnika przechodzą w workerd: `npm test`
- [x] 3.2 Linting przechodzi: `npm run lint`
- [x] 3.3 Sprawdzanie typów przechodzi: `npx astro check`

### Phase 4: Widok wskazań

#### Automated

- [ ] 4.1 Bramka przechodzi: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- [ ] 4.2 Smoke z istniejącymi i zaktualizowanymi krokami stron przechodzi lokalnie: `npm run smoke`

#### Manual

- [ ] 4.3 W przeglądarce na desktopie: kliknięcie przypisujące zmianę wywołuje i usuwa wskazania od razu (lista, znaczniki w komórkach, kolumna "Wskazania", licznik), powody są czytelne i wskazują osobę i dzień, wycofanie przy błędzie przywraca poprzednie wskazania, kolory nie są jedynym nośnikiem wagi, obsługa klawiaturą i odczyt licznika przez czytnik
- [ ] 4.4 Na telefonie (lub emulacji): strona się ładuje, lista wskazań jest czytelna, tabela przewija się poziomo bez rozjeżdżania strony

### Phase 5: Smoke, dokumentacja i wdrożenie

#### Automated

- [ ] 5.1 Bramka przechodzi: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- [ ] 5.2 Smoke z krokami wskazań przechodzi lokalnie: `npm run smoke`
- [ ] 5.3 CI na pull requeście jest zielone (job `ci` i job `smoke`)

#### Manual

- [ ] 5.4 Po wdrożeniu (`npm run build` i `npx wrangler deploy`, bez migracji) wskazania pojawiają się i znikają na produkcji; nie uruchamiać `npm run smoke` na produkcji
- [ ] 5.5 Pomiar CPU renderu strony obsadzania po wdrożeniu mieści się w limicie 10 ms na żądanie (albo wynik jest zapisany w `deploy-plan.md` razem z decyzją)
