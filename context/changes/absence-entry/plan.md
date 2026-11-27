# Absence entry Implementation Plan

## Overview

Siódmy wycinek domenowy Shiftly (S-07 z roadmapy, FR-004, US-01): planista wpisuje nieobecności pracowników (urlop, L4, inna), a silnik reguł z S-05 wskazuje kolizję grafiku z nieobecnością: z zatwierdzoną jako krytyczne naruszenie, z jeszcze niezatwierdzoną (wniosek urlopowy w stanie "złożony", który dopiero powstanie w S-14) jako ostrzeżenie. Nieobecności zatwierdzone obniżają też normę tygodniową (art. 130 § 3), więc ostrzeżenie `weekly_norm` z S-05 i kolumna "Godziny" z S-06 czytają te same dane i muszą dawać te same liczby. Wycinek dostarcza model nieobecności, na którym oprą się S-13 (zgłoszenia pracownika), S-14 (wnioski urlopowe) i S-15 (akceptacja z wpływem na grafik), oraz dane wejściowe dla S-08 (weryfikacja przy zatwierdzaniu). Nie dodaje widoku pracownika: druga połowa FR-004 ("pracownik widzi nieobecności wpisane przez planistę") należy do S-13 i S-11. Zmiana jest implementowana przed S-08.

## Current State Analysis

- Brak jakichkolwiek danych o nieobecnościach w repozytorium. Silnik: `RuleInput` (`src/lib/services/rules.ts:75-82`) ma `startDate`, `staffing`, `assignments`, `shifts`, `employees`; `ViolationRule` to unia w `src/types.ts:125-126`; `RULE_RANK` jest `as const satisfies Record<ViolationRule, number>` (`rules.ts:51-58`), więc nowa reguła bez rangi nie kompiluje się; `evaluateSchedule` składa reguły i sortuje `compareViolations` (`:594-604`); `prepare()` (`:172-212`) buduje osie czasu osób z `shiftInterval` (`work-hours.ts:39-45`), a `Context` ma `nameOf`, `dayLabel`, `describe` (`:148-158`). Klucz wskazania to `<reguła>|<pracownik albo ->|<klucze kotwic>` (`violationKey`, `:96-103`). `safeEvaluate` (`safe-evaluate.ts`) zwraca `{ ok: false }` przy `RangeError`.
- Norma: `weeklyNormWithHolidays(holidays, fte)` (`work-hours.ts:87-97`) zwraca `{ baseMinutes, fte, holidays }`, a `baseMinutes = 2400 − 480 × liczba świąt`; `weeklyNorm(startDate, fte)` deleguje do niej; konsumenci to `weeklyNormWarnings` (`rules.ts:467-504`, tekst "po pomniejszeniu o …" w `:488`) i `summarizeWorkload` (`workload.ts:29-38`). Trzy testy sprawdzają dokładny kształt `toStrictEqual` (`work-hours.test.ts:292, :356, :561`), więc stały nowy klucz w `WeeklyNorm` by je złamał.
- Droga danych do wyspy: `src/pages/schedules/[id]/assign.astro:21-37` ładuje `getSchedule`, potem `Promise.all([listShifts, listEmployees, listAssignments])`; `schedule-options.ts` zamienia dane na `ShiftOption[]`/`EmployeeOption[]` (bez e-maila); `assign.astro:77-83` przekazuje propsy do `AssignmentGrid`, który woła `useViolations` (`AssignmentGrid.tsx:163`) i `useWorkload` (`:165`). Wyspa jest renderowana na serwerze (`client:load`), więc reguły liczą się w Workerze przy każdym załadowaniu strony (mediana 4,8 ms po S-05, limit Workers Free 10 ms).
- Konwencje bazy (`supabase/migrations/*.sql`): nazwy `YYYYMMDDHHmmss_opis.sql` (ostatnia `20261125120000_schedule_summaries.sql`); komentarz nagłówkowy, że CHECK-i powtarzają granice walidatora aplikacji; CHECK-i nazywane `<tabela>_<kolumna>_valid` (smoke sprawdza nazwy przez `violates("<constraint>")`, `smoke.mjs:384`); RLS: `enable row level security` i jedna polityka na operację `to authenticated using/with check ((select public.is_planner()))` (`employees.sql:32-37`, `schedule_assignments.sql:33-38`); zawsze `revoke all on table ... from anon, authenticated` i jawny grant; granty kolumnowe (`employee_accounts.sql:21-25`, `schedule_assignments.sql:56`); klucze: restrict dla `schedule_employees.employee_id`, kaskada dla dzieci grafiku, każdy klucz obcy z indeksem. Granice dat są nośne: `schedules.start_date between '2020-01-01' and '2099-12-31'` (`schedules.sql:13`), a `parseIsoDate` przyjmuje tylko 2020-2099, więc poza zakresem reguły rzucają `RangeError`, a `safeEvaluate` wyłącza kontrolę dla każdego grafiku.
- Wzorce warstwy danych i API (planner-only CRUD): `src/lib/shifts.ts` i `employees.ts` (kolumny, wiersz, mapowanie, `readFailure` i `writeFailure` przez `logDatabaseError`, `isUuid`, `23503` jako `unknown_reference`, strażnik `READ_LIMIT = 1000` z `assignments.ts:16`), walidacja wspólna dla formularza i trasy (`validateShiftInput`, zwykłe sprawdzenia; zod tylko w `employee.ts`, a kod w ścieżce reguł ma zostać wolny od zoda), trasy `src/pages/api/shifts/*.ts` (`readJsonBody`, 503 `not_configured`, 404 dla nie-UUID, 422 `{errors}`, `jsonResponse` z `no-store`), strony `src/pages/shifts/*` w `PlannerLayout`, wyspa `ShiftForm.tsx` z hookiem, przycisk-wyspa jak `InviteButton.tsx`. `access.ts` ma domyślną odmowę i listę tylko otwartych ścieżek, więc nowe `/absences*` i `/api/absences*` nie wymagają jego zmiany, a `access.test.ts` (ok. `:184-201`) trzeba uzupełnić o ich przypadki. Nawigacja planisty to karty w `src/pages/planner/index.astro:9-35`; `FormField` obsługuje `type="date"` z `min`/`max`; natywny `<select>` ma precedens w `StaffingGrid.tsx:169`, a w `components/ui` nie ma selecta.
- ESLint (po przeglądzie S-05): `src/lib/services/**` zabrania `Date.parse` i `new Date(...)` z wieloma argumentami (`eslint.config.js:93-143`, wyjątek plikowy `DATE_PARSE_FILES` `:127-132`); daty nieobecności liczymy więc wyłącznie przez `parseIsoDate`, `addDays` i arytmetykę UTC.
- Smoke jest kruchy względem nowych elementów strony obsadzania: stałe `GRID_ROW_CELLS = 9`, `HOURS_CELL`, `DAY_CELLS` (`smoke.mjs:2000-2002`) indeksują komórki po pozycji (nie dodawać kolumny); `gridHeadersOf` wymaga dokładnie jednej tabeli przed sekcją obsady; `dayCellMarkersOf` łapie słowa "Krytyczne" i "Ostrzeżenie" w komórkach dni (`:2207-2214`), a `showsViolationColumn` wymaga ich braku; `hasNeutralHoursColumn` wymaga w komórce "Godziny" dokładnie dwóch `div` (`:2265-2277`); `HOURS_NOTE` ("Nieobecności nie są jeszcze uwzględnione", `AssignmentGrid.tsx:45-46`) jest przypięte dosłownie w `smoke.mjs:2283` i `:4261`; `violationItemsOf` wymaga jednej listy `ul` w sekcji wskazań; strony z danymi pracowników muszą używać `EmployeeOption` (`plannerPageHidesEmails`, `:3075-3083`); lista `/employees` oczekuje dokładnie dwóch elementów `data-employee-id` na pracownika. Nowa treść ma więc iść do komórek dni jako tekst (bez nowej kolumny i bez nowej tabeli przed obsadą).

## Desired End State

- Planista ma stronę `/absences` (tylko dla planisty): lista nieobecności (pracownik, typ, daty, status; najnowsze początki pierwsze), formularz nowej i edycji nieobecności (pracownik z listy, typ: urlop, zwolnienie lekarskie L4, inna nieobecność, data początku i końca włącznie), usuwanie błędnego wpisu i karta "Nieobecności" w panelu planisty.
- W widoku obsadzania w komórce osoby i dnia, na który przypada nieobecność, jest tekstowy znacznik "Nieobecność: urlop"; przyciski zmian się nie zmieniają. Przypisanie, którego zmiana nakłada się na dzień zatwierdzonej nieobecności, daje krytyczne wskazanie `absence` z powodem po polsku (osoba, zmiana, dzień, typ i daty nieobecności), a nakładające się tylko na niezatwierdzoną (`requested`) ostrzeżenie `absence_requested`; `rejected` jest ignorowana. Nakładanie liczy się na osi czasu w minutach: noc, która zaczyna się wieczorem przed nieobecnością i wchodzi w jej pierwszy dzień, też jest kolizją. Obsada ("x z y") zostaje bez zmian.
- Norma tygodniowa jest pomniejszona o 8 h × etat za każdy odrębny dzień zatwierdzonej nieobecności od poniedziałku do piątku, który nie jest świętem (z dolnym ograniczeniem 0), w ostrzeżeniu `weekly_norm` i w kolumnie "Godziny" z tych samych danych; zdanie pod tabelą osób mówi o tym zamiast "nieobecności nie są jeszcze uwzględnione" (decyzja D7).
- Baza odrzuca nieobecność poza 2020-2099, z końcem przed początkiem, z typem lub statusem spoza listy i dla nieistniejącego pracownika; pracownik, konto bez roli i anonim nie widzą ani nie zmieniają nieobecności.
- Weryfikacja: `npx astro sync && npm run lint && npx astro check && npm test && npm run build` przechodzi, smoke przechodzi lokalnie i w CI, a po wdrożeniu (z `db push` przed kodem) strona `/absences` i znaczniki w obsadzaniu działają na produkcji, a pomiar CPU strony obsadzania mieści się w limicie.

### Key Discoveries:

- PRD rozróżnia wagę kolizji: zatwierdzona nieobecność to krytyczne, niezatwierdzona to ostrzeżenie; S-08 potwierdza ostrzeżenia po kluczu. Gdyby to była jedna reguła ze zmienną wagą, klucz nie zmieniałby się, gdy S-15 zmieni wniosek w zatwierdzoną nieobecność, a ostrzeżenie zamieniłoby się w krytyczne pod tym samym kluczem. Dlatego dwie reguły (`absence`, `absence_requested`).
- Wniosek ze statusem "złożony" powstanie dopiero w S-14, więc w S-07 kolumna `status` (`requested`, `approved`, `rejected`) istnieje, ale sesja zapisuje tylko `approved` (domyślna wartość, kolumna poza grantem); wiersze `requested` smoke wstawia kontem serwisowym. To ten sam precedens co `schedule_assignments.source` (S-09 dopiero dopisze zapis).
- Okno nieobecności `RangeError`: nieobecność poza zakresem 2020-2099 wyłączyłaby kontrolę reguł dla każdego grafiku przez `safeEvaluate`, więc granice tabeli i walidatora są takie same jak dla grafików.
- Dołożenie pracownikowi dni usprawiedliwionej nieobecności do normy (art. 130 § 3 mówi o godzinach "przypadających do przepracowania według rozkładu") jest interpretacją: 8 h × etat za dzień pon.-pt. niebędący świętem, bo grafik tygodniowy nie zna "rozkładu" z dnia przed nieobecnością. Zapisane jako decyzja D7; dni, które już obniżyło święto albo niedziela, nie obniżają normy drugi raz.
- Okno zapytania o nieobecności do strony obsadzania to od początku grafiku do początku + 7 dni (nie +6), żeby ogon nocnej zmiany z dnia 6 był oceniony wobec nieobecności zaczynającej się w dniu 7; zapytanie zwraca nakładające się wiersze, a filtr po rosterze robi aplikacja (długi `in` w URL nie był sprawdzony).
- L4 to dane zdrowotne: brak pola tekstowego, strona planisty `no-store`, do wyspy trafiają tylko `employeeId`, daty, typ i status (nigdy notatka ani identyfikator konta).
- Obsada: `summarizeCoverage` liczy przypisanie osoby na urlopie jako obsadę; zostaje tak, bo kolizja jest zgłaszana raz, jako krytyczne wskazanie, a zmiana obsady dotknęłaby kod i kroki smoke z S-04.

## What We're NOT Doing

- Widoku nieobecności dla pracownika, zgłaszania przez pracownika i wniosków urlopowych (S-13, S-14, S-11), akceptacji lub odrzucenia z wpływem na grafik (S-15), powiadomień.
- Granularności godzinowej: tylko całe dni; kolumny `start_minute`/`end_minute` doda późniejsza zmiana bez ruszania reguły.
- Pola tekstowego, załączników i danych zdrowotnych ponad typ i daty.
- Blokowania nakładających się nieobecności (L4 w trakcie urlopu jest legalne; silnik bierze najsilniejszą), ograniczeń daty wstecz, maksymalnej długości.
- Zmiany obliczania obsady, zmian w `access.ts`, `ci.yml`, `package.json`, nowych zmiennych środowiskowych i użycia klucza service-role w Workerze (konto serwisowe tylko w smoke).
- Zmian w zatwierdzaniu (S-08): ta zmiana tylko dostarcza `absences.ts` i `RuleInput.absences`, na których S-08 oprze weryfikację.
- Sekcji nieobecności na stronie pracownika `/employees/<id>` (kruche kroki smoke konta i listy).
- Testów komponentów i hooków (konwencja repo): cała logika w czystych funkcjach.

## Implementation Approach

Od środka na zewnątrz, jak w S-05: czyste funkcje (Faza 1 i 2), baza i moduł danych (Faza 3), CRUD planisty (Faza 4), obsadzanie (Faza 5), dokumentacja i wdrożenie (Faza 6). Reguła i norma są dowiedzione testami deterministycznymi (granice, kolejność, brak mutacji, brak lokalnych metod `Date`), zanim ruszy baza.

Decyzje z wywiadu: S-07 przed S-08; nieobecność w całych dniach; kolumna `status` i dwie reguły od razu; kolizja przy każdym nałożeniu zmiany na dni nieobecności; korekta normy teraz, jedną regułą dla `weekly_norm` i "Godzin"; obsada bez zmian; pełny CRUD z kartą w panelu i znacznikiem w komórce; zasady wpisu liberalne.

Rozstrzygnięte w planowaniu (do zakwestionowania przy zatwierdzaniu):
- Typy: `vacation` (Urlop), `sick_leave` (Zwolnienie lekarskie L4), `other` (Inna nieobecność); wszystkie zatwierdzone typy obniżają normę.
- Status i grant: kolumna `status` z domyślną `approved`, poza grantem insert/update sesji; sesja planisty wstawia `(employee_id, type, start_date, end_date)` i zmienia `(type, start_date, end_date)` (zmiana osoby to usunięcie i dodanie); polityka `delete` dla planisty; klucz `employee_id` z kaskadą (sprzątanie smoke usuwa pracowników po e-mailu, a nieobecność nie ma nazwy do wzorca) i indeks na `employee_id`.
- Ranga reguł: `daily_rest 0`, `daily_hours 1`, `weekly_hours 2`, `weekly_rest 3`, `absence 4`, `weekly_norm 5`, `understaffed 6`, `absence_requested 7` (zmiana rang jest bezpieczna, bo klucze i zapisane dane ich nie zawierają).
- Klucz `absence|<pracownik>|<kotwica przypisania>`, `absence_requested|<pracownik>|<kotwica>`; jedno wskazanie na przypisanie, z wagą najsilniejszej nakładającej się nieobecności; `actual` to minuty nakładania, `limit` 0, `unit` "minutes".
- Przypisanie do zmiany spoza słownika (bez godzin) jest pomijane przez regułę nieobecności jak przez reguły czasu.
- Lista `/absences` sortowana po `start_date` malejąco, a przy remisie po `id`; wpis w liście pokazuje imię i nazwisko z listy pracowników, nigdy e-mail.
- Znacznik w komórce dnia: "Nieobecność: urlop" (bez słów "Krytyczne" i "Ostrzeżenie"); gdy w dniu jest kilka nieobecności, pokazywana jest najsilniejsza (zatwierdzona przed niezatwierdzoną).
- Zdanie pod tabelą osób (`HOURS_NOTE`): "Godziny: suma zmian rozpoczętych w tym grafiku względem normy tygodniowej etatu (40 h pomniejszone o 8 h za każde święto i za każdy dzień zatwierdzonej nieobecności od poniedziałku do piątku, proporcjonalnie do etatu). Przekroczenie normy pokazuje lista wskazań." (komponent i smoke zmieniają się razem).

## Critical Implementation Details

- **Daty tylko przez arytmetykę UTC i istniejące pomocniki**: `parseIsoDate`, `addDays`, `dayColumns`, `weekdayOf`, `holidaysInWeek`; nowe `dayOffsetOf` liczy pełne dni przez `Date.UTC` i nie używa `Date.parse` (ESLint). Testy szpiegują lokalne gettery (`localDateMethodsCalledBy`).
- **Granice 2020-2099**: wspólne dla walidatora, CHECK-a tabeli i okna zapytania; wartość nieobecności spoza zakresu nigdy nie dociera do `evaluateSchedule`.
- **`RuleInput.absences` jest opcjonalne** (tablica tylko do odczytu), żeby `useViolations`, `safeEvaluate` i istniejące fikstury testów (`input()` w `rules.test.ts:72-74`) działały bez zmian; pomocnik `freeze()` w testach (`:1665-1675`) musi zamrażać nowe pole.
- **Testy, które zmieniają się świadomie**: `rules.test.ts:136-146` (lista reguł i unikalność rang), `:1585` i `:1658` (zbiór wszystkich reguł dla wejść bez nieobecności), `work-hours.test.ts` zostaje bez zmian (nowa funkcja zamiast zmiany `WeeklyNorm`).
- **Norma**: nowa funkcja `weeklyNormExcused` zamiast zmiany `WeeklyNorm`; jeden czysty pomocnik `excusedWeekdays` zasila `weeklyNormWarnings` i `summarizeWorkload`, żeby ostrzeżenie i kolumna nigdy nie rozjechały się; tylko `approved` obniża normę.
- **Smoke**: bez nowej kolumny w tabeli osób i bez nowej tabeli przed obsadą; znacznik jest tekstem w komórce dnia; sekcje i listy dodawane po sekcji obsady; nowe etykiety w smoke nie mogą być nadzbiorem istniejących (`tableRowWith` i wyszukiwanie `li` dopasowują przez `includes`).
- **Migracja**: znacznik później niż `20261125120000` (polecenie `supabase migration new`), bo `db push` odmawia starszego niż zastosowany; migracja S-08 dostanie późniejszy znacznik.

## Phase 1: Nieobecność jako dane i norma

### Overview

Dodać typy, walidację, pomocniki dat i korektę normy jako czyste funkcje z testami granic i determinizmu. Zachowanie aplikacji się nie zmienia.

### Changes Required:

#### 1. Typy

**File**: `src/types.ts`

**Intent**: Kontrakt nieobecności dla walidatora, bazy, silnika i interfejsu. Wstawić w środku pliku, w osobnym bloku.

**Contract**: `AbsenceType = "vacation" | "sick_leave" | "other"`, `AbsenceStatus = "requested" | "approved" | "rejected"`, `AbsenceInput { employeeId: string; type: AbsenceType; startDate: string; endDate: string }`, `Absence extends AbsenceInput { id: string; status: AbsenceStatus; createdAt: string }`, `AbsenceField = "employeeId" | "type" | "startDate" | "endDate"` i `AbsenceFieldErrors`, `AbsenceOption { employeeId: string; type: AbsenceType; status: AbsenceStatus; startDate: string; endDate: string }` (to, co trafia do wyspy, bez `id`).

#### 2. Walidacja i daty

**File**: `src/lib/services/absence.ts` (nowy), `src/lib/services/absence.test.ts` (nowy)

**Intent**: Walidacja wspólna dla formularza i trasy (zwykłe sprawdzenia, bez zoda) i pomocniki, na których oprze się silnik.

**Contract**: `ABSENCE_TYPES` (kolejność i polskie etykiety: "Urlop", "Zwolnienie lekarskie (L4)", "Inna nieobecność"), `validateAbsenceInput(raw: unknown): { ok: true; value: AbsenceInput } | { ok: false; errors: AbsenceFieldErrors }` (id pracownika to UUID, typ z listy, daty przez `parseIsoDate` w zakresie `SCHEDULE_MIN_DATE`..`SCHEDULE_MAX_DATE`, koniec nie przed początkiem; jedna polska wiadomość na pole w stylu sąsiednich walidatorów; dane wejściowe nie są mutowane); `dayOffsetOf(startDate: string, isoDate: string): number` (pełne dni UTC, może być ujemne); `absenceInterval(startDate, absence): { start: number; end: number }` (minuty od północy dnia 0: `start = dayOffsetOf(startDate, absence.startDate) × 1440`, `end = (dayOffsetOf(startDate, absence.endDate) + 1) × 1440`); `rangesOverlap(a, b)` (półotwarte przedziały); `formatAbsenceRange(absence): string` (np. "02.11-06.11.2026" albo "02.11.2026" dla jednego dnia) i `absenceTypeLabel(type)`; `excusedWeekdays(startDate: string, absences: readonly { startDate; endDate; status }[], holidays: readonly string[]): string[]` (posortowane daty `YYYY-MM-DD` w siedmiu dniach grafiku, w których jest zatwierdzona nieobecność i które są dniem od poniedziałku do piątku niebędącym świętem); `sortAbsences(absences)` (po `startDate` malejąco, potem `id`, porządek jednostek kodowych przez `compareText`). Testy tabelaryczne (`it.each`): granice 2020-01-01 i 2099-12-31 oraz poza zakresem, koniec równy początkowi i przed początkiem, zły typ, nie-UUID, jeden dzień, nieobecność zaczynająca się przed grafikiem i kończąca w jego środku, po jego końcu, całkowicie poza, tydzień ze świętem 11.11.2026 w środku nieobecności (święto nie liczy się drugi raz), nieobecność tylko w sobotę i niedzielę (nic nie obniża), `rejected` i `requested` pomijane przez `excusedWeekdays`, `expectDeterministic` z wariantami z `seededShuffle`, brak mutacji (`Object.freeze`, `structuredClone`) i test, że żadna lokalna metoda `Date` nie jest wołana (`localDateMethodsCalledBy`).

#### 3. Korekta normy

**File**: `src/lib/services/work-hours.ts`, `src/lib/services/work-hours.test.ts`

**Intent**: Obniżyć normę tygodniową o dni zatwierdzonej nieobecności bez zmiany kształtu `WeeklyNorm` i bez łamania wywołujących.

**Contract**: `weeklyNormExcused(holidays: readonly string[], excusedDays: readonly string[], fte: Fte): WeeklyNorm & { excusedDays: string[] }` z `baseMinutes = max(0, 2400 − 480 × holidays.length − 480 × excusedDays.length)`, kopiami list, tym samym sprawdzeniem etatu co `weeklyNormWithHolidays` (`RangeError` dla etatu spoza `1 <= licznik <= mianownik`); `weeklyNormWithHolidays` i `weeklyNorm` zostają bez zmian. Nowe testy: wektory (pełny etat bez nieobecności 40 h, jeden dzień 32 h, pięć dni 0 h, siedem dni (z sobotą i niedzielą) 0 h, tydzień od wt. 10.11.2026 ze świętem 11.11 i nieobecnością w pon.-pt. tego tygodnia: 24 h, nieobecność w święto nie obniża drugi raz, etat 3/4 i 1/2 i 3/7 z dokładnym porównaniem `exceedsNorm`, dolne ograniczenie 0), identyczność z `weeklyNormWithHolidays` przy braku nieobecności (`toStrictEqual` poza polem `excusedDays`), `RangeError` dla złego etatu.

### Success Criteria:

#### Automated Verification:

- Testy czystych funkcji przechodzą w workerd: `npm test`
- Linting przechodzi: `npm run lint`
- Sprawdzanie typów przechodzi: `npx astro check`

#### Manual Verification:

- Decyzja D7 (norma pomniejszona o 8 h × etat za dzień zatwierdzonej nieobecności od poniedziałku do piątku niebędący świętem, z dolnym ograniczeniem 0), polskie etykiety typów i komunikaty walidacji oraz wektory normy zostały przejrzane i zatwierdzone przez autora

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Reguły nieobecności w silniku

### Overview

Dodać regułę kolizji do silnika z S-05, a `weekly_norm` i sumy godzin przestawić na normę z korektą. Czyste funkcje z testami; widok się nie zmienia (nieobecności nie są jeszcze wczytywane).

### Changes Required:

#### 1. Typy reguł

**File**: `src/types.ts`

**Intent**: Dwie nowe reguły w unii `ViolationRule`.

**Contract**: do `ViolationRule` dochodzą `"absence"` i `"absence_requested"`.

#### 2. Silnik

**File**: `src/lib/services/rules.ts`, `src/lib/services/rules.test.ts`, `src/lib/services/violation-view.ts` (jeśli zależy od listy reguł)

**Intent**: Wskazać kolizję przypisania z nieobecnością jedną regułą krytyczną i jedną ostrzegawczą, bez zmiany pozostałych reguł.

**Contract**: `RuleInput.absences?: readonly AbsenceOption[]`; `RULE_RANK` rozszerzone o `absence: 4`, `weekly_norm: 5`, `understaffed: 6`, `absence_requested: 7` (reszta bez zmian); w `prepare()` mapa nieobecności po pracowniku z osią `absenceInterval(startDate, absence)` (pomija `rejected`); `absenceViolations(input): Violation[]`: dla każdego segmentu (przypisanie z godzinami) test `segment.start < absence.end && absence.start < segment.end` względem nieobecności tej osoby; JEDNO wskazanie na przypisanie, `critical` z regułą `absence`, gdy nakłada się jakakolwiek `approved`, w przeciwnym razie `warning` z regułą `absence_requested`; kotwica to przypisanie; powód po polsku z nazwiskiem, opisem zmiany i dnia (`ctx.describe`), typem i zakresem nieobecności (np. "Kowalska Anna: zmiana Poranna (pon. 02.11, 06:00-14:00) przypada na urlop (02.11-06.11.2026)."); `actual` = minuty nakładania, `limit` 0, `unit` "minutes"; przypisanie do zmiany spoza słownika jest pomijane; `evaluateSchedule` składa wszystkie reguły z nową; `weeklyNormWarnings` liczy normę przez `weeklyNormExcused` z `excusedWeekdays` osoby (zatwierdzone nieobecności), a powód rozszerza zdanie "po pomniejszeniu o …" o dni nieobecności ("… i nieobecność (3 dni: 02.11, 03.11, 05.11)"); `weeklyNormWithHolidays` i `weekly_norm` bez nieobecności dają dokładnie dotychczasowe wyniki i teksty. Testy: kolizja zatwierdzona (krytyczne) i niezatwierdzona (ostrzeżenie), `rejected` ignorowana, nakładanie najsilniejszej przy kilku nieobecnościach, noc z dnia poprzedzającego nieobecność wchodząca w jej pierwszy dzień (kolizja), noc zaczynająca się w ostatnim dniu nieobecności (kolizja), noc kończąca się dokładnie o północy nieobecności (brak), nieobecność poza grafikiem (brak), nieobecność zaczynająca się przed grafikiem, osoba bez nieobecności, przypisanie do zmiany spoza słownika, klucze unikalne i niezależne od kolejności wejścia i godzin, kolejność kanoniczna z nowymi rangami, `weekly_norm` z nieobecnością (norma niższa, ostrzeżenie przy pracy powyżej niższej normy, tekst z dniami), `expectDeterministic` z `seededShuffle` (także po nieobecnościach), `Object.freeze` i `structuredClone` wejścia z nieobecnościami, test lokalnych getterów `Date`.

#### 3. Sumy godzin

**File**: `src/lib/services/workload.ts`, `src/lib/services/workload.test.ts`

**Intent**: Kolumna "Godziny" liczy normę z tych samych danych co `weekly_norm`.

**Contract**: `WorkloadInput.absences?: readonly AbsenceOption[]`; `summarizeWorkload` używa `weeklyNormExcused` z `excusedWeekdays` osoby (bez nieobecności wynik identyczny jak dziś); testy: osoba z nieobecnością ma niższą normę i różnicę liczoną od niej, osoba bez nieobecności bez zmian, ta sama norma co w `weekly_norm` dla tych samych wejść (test krzyżowy), norma 0 przy tygodniu nieobecności ("mniej o" nie występuje, praca daje "więcej o"), determinizm i brak mutacji.

### Success Criteria:

#### Automated Verification:

- Testy reguł, normy i sum godzin przechodzą w workerd: `npm test`
- Linting przechodzi: `npm run lint`
- Sprawdzanie typów przechodzi: `npx astro check`

#### Manual Verification:

- Polskie powody wskazań nieobecności, ranga i klucze reguł oraz tekst normy pomniejszonej o nieobecność zostały przejrzane i zatwierdzone przez autora

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 3: Baza i moduł danych

### Overview

Dodać tabelę `absences` z RLS tylko dla planisty i moduł danych, z dowodem w smoke na tokenach czterech aktorów. Aplikacja zmienia się tylko o moduł (bez stron).

### Changes Required:

#### 1. Migracja

**File**: `supabase/migrations/<znacznik>_absences.sql` (nowy; znacznik z `npx supabase migration new absences`, późniejszy niż `20261125120000`)

**Intent**: Tabela nieobecności z ograniczeniami zgodnymi z walidatorem i politykami jak sąsiednie tabele.

**Contract**: nagłówek komentarza (CHECK-i powtarzają granice walidatora; dlaczego `status` i dlaczego sesja nie zapisuje go w S-07; dlaczego granice dat 2020-2099 są nośne); tabela `public.absences`: `id uuid primary key default gen_random_uuid()`, `employee_id uuid not null references public.employees on delete cascade`, `type text not null`, `status text not null default 'approved'`, `start_date date not null`, `end_date date not null`, `created_at timestamptz not null default now()`; CHECK-i `absences_type_valid` (`vacation`, `sick_leave`, `other`), `absences_status_valid` (`requested`, `approved`, `rejected`), `absences_dates_valid` (obie daty w 2020-01-01..2099-12-31), `absences_range_valid` (`end_date >= start_date`); indeks `absences_employee_idx` na `employee_id`; `enable row level security`; cztery polityki dla planisty (select, insert, update, delete) przez `(select public.is_planner())`; `revoke all ... from anon, authenticated`, `grant select, delete`, `grant insert (employee_id, type, start_date, end_date)`, `grant update (type, start_date, end_date)` dla `authenticated`.

#### 2. Moduł danych

**File**: `src/lib/absences.ts` (nowy), `src/lib/absences.test.ts` (nowy, jeśli jest czysta logika mapowania)

**Intent**: Jedyny moduł znający nazwy tabeli i kolumn nieobecności, na sesji użytkownika (RLS decyduje).

**Contract**: stałe `COLUMNS` i `READ_LIMIT = 1000` (strażnik jak w `assignments.ts:16`: odczyt dobijający do limitu kończy się błędem, nie obcięciem), typy wiersza i mapowanie na `Absence`; `listAbsences(supabase): Promise<Absence[]>` (posortowane `sortAbsences`), `listAbsencesOverlapping(supabase, from: string, to: string): Promise<Absence[]>` (`.lte("start_date", to).gte("end_date", from)`; filtr po rosterze robi wywołujący), `getAbsence(supabase, id)` (null dla nie-UUID i niewidocznego), `createAbsence(supabase, input)` / `updateAbsence(supabase, id, input)` / `deleteAbsence(supabase, id)` z wynikami `{ ok: true, ... } | { ok: false, error: "not_found" | "unknown_reference" | "failed" }` (`23503` to `unknown_reference`, usunięcie nieistniejącego daje `not_found`), `readFailure` i `writeFailure` przez `logDatabaseError("absences", ...)` (kod i komunikat, nigdy szczegóły).

#### 3. Smoke bazy

**File**: `scripts/smoke.mjs`

**Intent**: Udowodnić RLS, ograniczenia, granty i kaskadę na prawdziwej bazie, z asercjami przyczyny.

**Contract**: pomocnik `absencesTable` i kroki w środku bloku kroków bazy (wzorzec `notPlannerAssignmentSteps` i `anonymousAssignmentSteps`): planista tworzy, czyta, zmienia `(type, start_date, end_date)` i usuwa; odrzucenia z nazwą ograniczenia (`absences_dates_valid` dla 2019-12-31 i 2100-01-01, `absences_range_valid`, `absences_type_valid`, `absences_status_valid` przez konto serwisowe, bo sesja nie ma grantu na `status`) oraz brak grantu na zapis `status` i `employee_id` przez sesję (42501); pracownik i konto bez roli: lista pusta przy istniejącej nieobecności jego własnego wiersza pracownika (dowód RLS, nie pustej tabeli), insert odrzucony (403, 42501, polityka), update i delete ukryte (`rowsHidden`: 200 `[]` z `return=representation`); anonim: 401 `anonymousTableDenied` dla każdej operacji; kaskada: usunięcie pracownika kontem serwisowym usuwa jego nieobecności; krok końcowy "no absence left" po sprzątaniu; wiersz `requested` wstawiony kontem serwisowym jest widoczny dla planisty. Nowe nazwy w smoke z prefiksem `Smoke-<runId>-`.

### Success Criteria:

#### Automated Verification:

- Bramka przechodzi: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- Migracja stosuje się na świeżej bazie: `npx supabase db reset`
- Smoke z krokami bazy przechodzi lokalnie: `npm run smoke`

#### Manual Verification:

- Treść migracji (kolumny, granty, polityki, nazwy ograniczeń, kaskada) została przejrzana i zatwierdzona przez autora

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 4: API i strony planisty

### Overview

Dodać trasy CRUD nieobecności i strony `/absences` z formularzem, listą i usuwaniem oraz kartę w panelu planisty. Dowód w smoke API i stron.

### Changes Required:

#### 1. Trasy

**File**: `src/pages/api/absences/index.ts` (nowy), `src/pages/api/absences/[id].ts` (nowy)

**Intent**: Zapis nieobecności przez aplikację, z tą samą walidacją co formularz.

**Contract**: `export const prerender = false`; `POST /api/absences` (201 `{ absence }`), `PUT /api/absences/[id]` (200), `DELETE /api/absences/[id]` (200 `{ ok: true }`, idempotentne jak trasa przypisań: usunięcie nieistniejącej też 200); kolejność jak w trasach słownika zmian: `readJsonBody` (415/400), 503 `not_configured`, 404 dla nie-UUID, `validateAbsenceInput` (422 `{ errors }` z dokładnym zbiorem pól), wywołanie modułu danych (404 `not_found`, 422 `unknown_reference` dla nieistniejącego pracownika, 500 `failed`); wszystko przez `jsonResponse` (`no-store`).

#### 2. Strony i wyspy

**File**: `src/pages/absences/index.astro`, `new.astro`, `[id].astro` (nowe), `src/components/absences/AbsenceForm.tsx` (nowy), `src/components/hooks/useAbsenceForm.ts` (nowy), `src/components/absences/DeleteAbsenceButton.tsx` z hookiem (nowe), `src/pages/planner/index.astro`

**Intent**: Planista wpisuje, poprawia i usuwa nieobecności; strona działa na desktopie i telefonie.

**Contract**: wzorzec stron słownika zmian w `PlannerLayout`; lista (tabela od `md`, karty poniżej) z kolumnami pracownik, typ, daty (`formatAbsenceRange`), status (tekst) i linkiem "Edytuj", posortowana `sortAbsences`, z komunikatem o braku wpisów; pracownik w liście to "Nazwisko Imię" z `listEmployees` (nigdy e-mail); `new` i `[id]` ładują pracowników jako `EmployeeOption` i dają formularz (pole pracownika `<select>` natywny jak w `StaffingGrid.tsx:169`, typ `<select>`, dwa pola `type="date"` z `min` i `max` z `SCHEDULE_MIN_DATE`/`SCHEDULE_MAX_DATE`, widoczna podpowiedź zakresu, błędy pól przez `readFieldErrors` i `focusFirstInvalid`, 401/403 jako komunikat o sesji, po zapisie przekierowanie na listę); przy edycji pole pracownika jest tylko do odczytu (zmiana osoby to usunięcie i dodanie); `[id]` ustawia 404 i własny blok dla nieistniejącej; przycisk "Usuń" z jawnym potwierdzeniem (dwukrok) i odświeżeniem listy; wszystkie strony `Cache-Control: no-store`; karta "Nieobecności" w `planner/index.astro` (nie używa słów "Pracownicy" ani "Zmiany" jako dopasowania, które smoke sprawdza w tej stronie).

#### 3. Dostęp i smoke

**File**: `src/lib/services/access.test.ts`, `scripts/smoke.mjs`

**Intent**: Potwierdzić, że nowe ścieżki są tylko dla planisty, i dowieść tras i stron na prawdziwych danych.

**Contract**: przypadki `access.test.ts` dla `/absences`, `/absences/new`, `/absences/<uuid>`, `/api/absences`, `/api/absences/<uuid>` (planista tak, pracownik 403, anonim 401, konto bez roli 403); w smoke macierz ról dla stron i tras (anonim 401 na trasach JSON i `/access-denied` na stronach, pracownik i konto bez roli 403), kroki planisty: POST 201 z dokładnym ciałem, 422 z dokładnym zbiorem pól dla każdej złej wartości (data poza zakresem, koniec przed początkiem, zły typ, nie-UUID, nieistniejący pracownik jako `unknown_reference`), PUT zmienia daty i typ, DELETE idempotentny, lista `/absences` pokazuje dokładnie oczekiwany wiersz (pracownik, typ, daty) bez e-maila, strona `new` ma formularz z podpowiedzią zakresu, `[id]` nieistniejące 404, karta w `/planner`, `Cache-Control: no-store`.

### Success Criteria:

#### Automated Verification:

- Bramka przechodzi: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- Smoke z krokami tras i stron przechodzi lokalnie: `npm run smoke`

#### Manual Verification:

- W przeglądarce na desktopie: dodanie, edycja i usunięcie nieobecności, komunikaty błędów pól, podpowiedź zakresu dat, karta w panelu, czytelność i klawiatura
- Na telefonie (lub emulacji): lista i formularz są czytelne, strona nie ma poziomego przewijania dokumentu

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 5: Obsadzanie z nieobecnościami

### Overview

Wczytać nieobecności na stronie obsadzania, przekazać je silnikowi i kolumnie "Godziny" oraz pokazać znaczniki w komórkach. Dowód w smoke na prawdziwych danych: kolizje, normy i sąsiedzi.

### Changes Required:

#### 1. Wczytanie i propsy

**File**: `src/pages/schedules/[id]/assign.astro`, `src/lib/absences.ts`, `src/lib/schedule-options.ts`

**Intent**: Dostarczyć wyspie nieobecności roster na oknie grafiku, bez wycieku więcej niż potrzeba.

**Contract**: w `Promise.all` strony obsadzania dochodzi `listAbsencesOverlapping(supabase, schedule.startDate, addDays(schedule.startDate, 7))`; filtr po `schedule.employeeIds` w module danych (funkcja `absencesOfRoster` albo parametr), strażnik `READ_LIMIT`; do wyspy trafia `absences: AbsenceOption[]` (wyłącznie `employeeId`, `type`, `status`, `startDate`, `endDate`; nigdy `id`, notatki ani konto), strona nadal `no-store`; wspólny mapper w `schedule-options.ts`.

#### 2. Wyspa i znaczniki

**File**: `src/components/schedules/AssignmentGrid.tsx`, `src/components/hooks/useViolations.ts`, `src/components/hooks/useWorkload.ts`, `src/lib/services/absence.ts` (pomocnik do znaczników)

**Intent**: Nieobecności zasilają reguły i sumy po stronie wyspy i są widoczne w siatce.

**Contract**: `AssignmentGrid` dostaje prop `absences`; `useViolations` przekazuje je do `safeEvaluate` (nowa zależność `useMemo`), `useWorkload` do `summarizeWorkload`; czysty `absenceMarkers(startDate, absences): Record<string, AbsenceOption>` (klucz `employeeDayKey`, dla każdego dnia grafiku najsilniejsza nieobecność: `approved` przed `requested`, `rejected` pominięta) z testami; w komórce osoby i dnia pod przyciskami tekst "Nieobecność: <etykieta typu>" tylko gdy dzień jest objęty nieobecnością (bez słów "Krytyczne" i "Ostrzeżenie", bez zmiany `th scope="row"` i `aria-label` przycisków, bez nowej kolumny i tabeli); `HOURS_NOTE` zmienia się na tekst z "Rozstrzygnięte w planowaniu"; reszta obsady bez zmian.

#### 3. Smoke scenariuszy

**File**: `scripts/smoke.mjs`

**Intent**: Dowieść kolizji, wag, noce, norm i sąsiadów na prawdziwych danych, z asercjami dokładnego tekstu.

**Contract**: zaktualizować przypięte zdanie `HOURS_NOTE` (`smoke.mjs:2283` i `:4261`) i wszystkie kroki, które asertują stronę obsadzania istniejących grafików (nieobecności nie istnieją w ich danych, więc wskazania i liczby się nie zmieniają); nowy grafik `Smoke-<runId>-absences` (data startu przed 2026-11-15, żeby krok "dwóch najnowszych" nie zmienił wyniku) utworzony trasą grafików, z własnymi osobami i istniejącymi zmianami smoke (06:00-14:00, 22:00-07:00, 01:00-09:00); nieobecności przez `POST /api/absences` (zatwierdzone) i, dla `requested` i `rejected`, kontem serwisowym; kroki strony `/schedules/<id>/assign` z dokładnym licznikiem, uporządkowaną listą (waga i pełny powód), kolumną "Wskazania", znacznikami w komórkach i tekstem kolumny "Godziny": (a) zatwierdzona nieobecność i przypisanie w jej dniu: krytyczne `absence` z typem i datami; (b) tylko `requested`: ostrzeżenie `absence_requested`; (c) `rejected`: brak wskazania, brak obniżenia normy; (d) noc z wieczoru przed nieobecnością (kolizja) i zmiana kończąca się dokładnie o północy początku nieobecności (brak); (e) dwie nałożone nieobecności: wskazanie jedno, z wagą najsilniejszej, a w komórce znacznik zatwierdzonej; (f) korekta normy: osoba z trzema dniami zatwierdzonej nieobecności w tygodniu bez święta ma w "Godziny" normę 16 h (pełny etat) i `weekly_norm` liczy względem niej, osoba z nieobecnością w święto nie obniża drugi raz, nieobecność tylko w weekend nic nie zmienia; (g) kroki "sąsiadów": usunięcie nieobecności trasą `DELETE /api/absences/<id>` i ponowne wczytanie strony usuwa tylko wskazanie i znacznik tej osoby, a inne osoby i inne dni zostają bez zmian; asercje sprawdzają tekst, nie klasę, i potwierdzają brak `role="alert"` w kolumnach.

### Success Criteria:

#### Automated Verification:

- Bramka przechodzi: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- Smoke ze scenariuszami nieobecności przechodzi lokalnie: `npm run smoke`

#### Manual Verification:

- W przeglądarce na desktopie: znaczniki "Nieobecność: ..." w komórkach, wskazania kolizji (krytyczne i ostrzeżenie) pojawiają się i znikają po kliknięciu i po usunięciu nieobecności, kolumna "Godziny" i zdanie pod tabelą pokazują pomniejszoną normę, wycofanie przy błędzie przywraca poprzednie wskazania
- Na telefonie (lub emulacji): strona obsadzania ładuje się, znaczniki i lista są czytelne, strona nie ma poziomego przewijania dokumentu

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 6: Dokumentacja i wdrożenie

### Overview

Opisać nieobecności i decyzję D7 w dokumentacji, wdrożyć (z `db push` przed kodem) i zmierzyć CPU strony obsadzania z nieobecnościami.

### Changes Required:

#### 1. Dokumentacja

**File**: `CLAUDE.md`, `AGENTS.md`, `README.md`, `context/foundation/work-time-rules.md`

**Intent**: Dokumentacja zgodna z kodem i decyzja D7 w dokumencie reguł.

**Contract**: nowe akapity (nie edycja istniejących długich linii) o nieobecnościach: tabela i jej granty, moduły (`absence.ts`, `absences.ts`, trasy, strony, `AbsenceOption`), dwie reguły i ich wagi, kolizja na osi czasu (noc), korekta normy, brak godzin i brak pola tekstowego, dane zdrowotne, to, że sesja zapisuje tylko `approved`; uzupełnienie opisu `npm run smoke` o kroki nieobecności; w `work-time-rules.md` dopisek decyzji D7 (8 h × etat za dzień pon.-pt. niebędący świętem, tylko `approved`, ograniczenie 0, interpretacja art. 130 § 3). Nie dotykać fragmentów o service-role.

#### 2. Pomiar CPU

**File**: `context/deployment/deploy-plan.md`

**Intent**: Powtórzyć pomiar po dodaniu danych nieobecności do ścieżki renderu strony obsadzania.

**Contract**: po wdrożeniu odczyt CPU strony `/schedules/<id>/assign` (panel Cloudflare, mediana i p99, najlepiej na grafiku z nieobecnościami i kilkunastoma przypisaniami, osobno pierwsze żądanie w nowym izolacie) i zapis wyniku z decyzją; jeśli blisko 10 ms, zapisać ryzyko dla S-08 i S-09.

### Success Criteria:

#### Automated Verification:

- Bramka przechodzi: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- Smoke przechodzi lokalnie: `npm run smoke`
- CI na pull requeście jest zielone (job `ci` i job `smoke`)

#### Manual Verification:

- Migracja nieobecności została zastosowana na hostowanym projekcie (`npx supabase db push`, przed wdrożeniem kodu)
- Po wdrożeniu (`npm run build` i `npx wrangler deploy`) strona `/absences` i znaczniki nieobecności w obsadzaniu działają na produkcji; nie uruchamiać `npm run smoke` na produkcji
- Pomiar CPU strony obsadzania po wdrożeniu mieści się w limicie 10 ms na żądanie albo wynik jest zapisany w `deploy-plan.md` razem z decyzją

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Testing Strategy

### Unit Tests:

- `absence.test.ts`, `work-hours.test.ts`, `rules.test.ts`, `workload.test.ts`: granice (daty 2020 i 2099, koniec = początek), noc na granicy nieobecności, kolejność kanoniczna z nowymi rangami, wektory normy (pełny etat, 3/4, 1/2, 3/7, święto i nieobecność w jednym tygodniu, dolne ograniczenie 0), `expectDeterministic`, `seededShuffle`, brak mutacji (`Object.freeze`, `structuredClone`), niezależność od strefy (szpiegowanie lokalnych getterów `Date`).
- Brak testów komponentów i hooków (konwencja repo): logika w czystych funkcjach, `absenceMarkers` testowane osobno.

### Integration Tests:

- Smoke (Fazy 3, 4, 5): macierz RLS i granty na czterech aktorach, ograniczenia z nazwami, kaskada, trasy z dokładnymi 422, strony z dokładnymi wierszami, scenariusze obsadzania z dokładnymi tekstami i krokami sąsiadów.
- Kontrola celowego uszkodzenia w każdej fazie z testami lub smoke (reguła lub granica psuta celowo, test czerwony), jak w S-05.

### Manual Testing Steps:

1. Wpisać urlop pracownikowi na trzy dni robocze, przypisać go do zmiany w tym dniu i sprawdzić krytyczne wskazanie, znacznik w komórce i pomniejszoną normę w "Godziny".
2. Zmienić zakres lub usunąć nieobecność i sprawdzić, że wskazanie i znacznik znikają po odświeżeniu.
3. Przypisać noc z wieczoru przed nieobecnością i sprawdzić kolizję.
4. Sprawdzić listę, formularz i usuwanie na telefonie oraz klawiaturą.

## Performance Considerations

Nieobecności dochodzą do ścieżki renderu strony obsadzania jednym dodatkowym zapytaniem (czekanie na sieć, nie CPU), parsowaniem kilku wierszy JSON i pracą O(przypisania × nieobecności osoby) w `useMemo` na obu stronach (serwer i klient). Ścieżka renderu liczy reguły w Workerze (limit 10 ms CPU; mediana 4,8 ms po S-05 bez p99 i bez pierwszego żądania w nowym izolacie), więc pomiar po wdrożeniu jest wierszem planu. Odczyt dobijający do 1000 wierszy kończy się błędem, nie obcięciem.

## Migration Notes

Jedna migracja dodająca tabelę `absences` (z kolejnym znacznikiem); `npx supabase db push` przed wdrożeniem kodu strony obsadzania, bo bez tabeli zapytanie o nieobecności zawiedzie. Zmiana jest addytywna (stary kod nie czyta tabeli), więc samo `db push` jest bezpieczne dla działającej wersji.

## Parallel Work Notes

Planowany równolegle jest S-08 (`schedule-approval`), implementowany po scaleniu tego wycinka. Wspólne pliki: `src/types.ts`, `rules.ts`, `assign.astro`, `AssignmentGrid.tsx`, `useViolations.ts`, `scripts/smoke.mjs` (w tym komentarz nagłówkowy), `CLAUDE.md`, `AGENTS.md`, `README.md`, roadmapa i numeracja migracji. Żeby scalenie było tanie: nowe typy w osobnym bloku `types.ts`; ładowanie i mapowanie nieobecności w `src/lib/absences.ts` i `absence.ts`, żeby trasa zatwierdzania S-08 użyła ich bez kopiowania; kroki smoke wstawiać w środku bloków (nowy grafik `Smoke-<runId>-absences` z datą startu przed 2026-11-15); w dokumentacji nowe akapity zamiast edycji istniejących linii; w roadmapie każdy wycinek zmienia tylko swoje wiersze.

## References

- Roadmap: `context/foundation/roadmap.md` (S-07, S-08, S-13, S-14, S-15), PRD: `context/foundation/prd.md` (FR-004, US-01, Guardrails, NFR o wskazaniach), reguły: `context/foundation/work-time-rules.md` (art. 130 § 3, decyzje D1-D6)
- Silnik i norma: `src/lib/services/rules.ts:51-58, 75-82, 148-212, 594-604`, `work-hours.ts:39-45, 77-97`, `workload.ts:29-38`, `safe-evaluate.ts`, `calendar.ts`, `schedule.ts` (`parseIsoDate`, `addDays`, `dayColumns`)
- Strona i wyspa: `src/pages/schedules/[id]/assign.astro:21-37, 77-83`, `AssignmentGrid.tsx:45-46, 163-165`, `useViolations.ts`, `useWorkload.ts`, `schedule-options.ts`
- Wzorce bazy, danych i API: `supabase/migrations/20261102071038_shifts.sql`, `20261124152716_schedule_assignments.sql`, `src/lib/shifts.ts`, `assignments.ts`, `src/pages/api/shifts/*.ts`, `src/pages/shifts/*`, `ShiftForm.tsx`, `useShiftForm.ts`, `InviteButton.tsx`, `src/lib/postgrest.ts`, `access.ts`, `PlannerLayout.astro`, `planner/index.astro`
- Smoke: `scripts/smoke.mjs` (`GRID_ROW_CELLS`, `gridHeadersOf`, `dayCellMarkersOf`, `hasNeutralHoursColumn`, `HOURS_NOTE`, macierz ról, sprzątanie), CPU: `context/deployment/deploy-plan.md`
- Poprzednie zmiany: `context/archive/2026-11-25-live-rule-violations/plan.md` (silnik, klucze, wzorzec smoke scenariuszy) i jego `reviews/impl-review.md`, `context/archive/2026-11-25-workload-vs-norm/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Nieobecność jako dane i norma

#### Automated

- [x] 1.1 Testy czystych funkcji przechodzą w workerd: `npm test` — 958851c
- [x] 1.2 Linting przechodzi: `npm run lint` — 958851c
- [x] 1.3 Sprawdzanie typów przechodzi: `npx astro check` — 958851c

#### Manual

- [x] 1.4 Decyzja D7 (norma pomniejszona o 8 h × etat za dzień zatwierdzonej nieobecności od poniedziałku do piątku niebędący świętem, z dolnym ograniczeniem 0), polskie etykiety typów i komunikaty walidacji oraz wektory normy zostały przejrzane i zatwierdzone przez autora — 958851c

### Phase 2: Reguły nieobecności w silniku

#### Automated

- [x] 2.1 Testy reguł, normy i sum godzin przechodzą w workerd: `npm test` — bbd75e3
- [x] 2.2 Linting przechodzi: `npm run lint` — bbd75e3
- [x] 2.3 Sprawdzanie typów przechodzi: `npx astro check` — bbd75e3

#### Manual

- [x] 2.4 Polskie powody wskazań nieobecności, ranga i klucze reguł oraz tekst normy pomniejszonej o nieobecność zostały przejrzane i zatwierdzone przez autora — bbd75e3

### Phase 3: Baza i moduł danych

#### Automated

- [x] 3.1 Bramka przechodzi: `npx astro sync && npm run lint && npx astro check && npm test && npm run build` — bd41ec5
- [x] 3.2 Migracja stosuje się na świeżej bazie: `npx supabase db reset` — bd41ec5
- [x] 3.3 Smoke z krokami bazy przechodzi lokalnie: `npm run smoke` — bd41ec5

#### Manual

- [x] 3.4 Treść migracji (kolumny, granty, polityki, nazwy ograniczeń, kaskada) została przejrzana i zatwierdzona przez autora — bd41ec5

### Phase 4: API i strony planisty

#### Automated

- [x] 4.1 Bramka przechodzi: `npx astro sync && npm run lint && npx astro check && npm test && npm run build` — a2f414b
- [x] 4.2 Smoke z krokami tras i stron przechodzi lokalnie: `npm run smoke` — a2f414b

#### Manual

- [x] 4.3 W przeglądarce na desktopie: dodanie, edycja i usunięcie nieobecności, komunikaty błędów pól, podpowiedź zakresu dat, karta w panelu, czytelność i klawiatura — a2f414b
- [x] 4.4 Na telefonie (lub emulacji): lista i formularz są czytelne, strona nie ma poziomego przewijania dokumentu — a2f414b

### Phase 5: Obsadzanie z nieobecnościami

#### Automated

- [x] 5.1 Bramka przechodzi: `npx astro sync && npm run lint && npx astro check && npm test && npm run build` — cbf7aeb
- [x] 5.2 Smoke ze scenariuszami nieobecności przechodzi lokalnie: `npm run smoke` — cbf7aeb

#### Manual

- [x] 5.3 W przeglądarce na desktopie: znaczniki "Nieobecność: ..." w komórkach, wskazania kolizji (krytyczne i ostrzeżenie) pojawiają się i znikają po kliknięciu i po usunięciu nieobecności, kolumna "Godziny" i zdanie pod tabelą pokazują pomniejszoną normę, wycofanie przy błędzie przywraca poprzednie wskazania — cbf7aeb
- [x] 5.4 Na telefonie (lub emulacji): strona obsadzania ładuje się, znaczniki i lista są czytelne, strona nie ma poziomego przewijania dokumentu — cbf7aeb

### Phase 6: Dokumentacja i wdrożenie

#### Automated

- [x] 6.1 Bramka przechodzi: `npx astro sync && npm run lint && npx astro check && npm test && npm run build` — b4635c8
- [x] 6.2 Smoke przechodzi lokalnie: `npm run smoke` — b4635c8
- [x] 6.3 CI na pull requeście jest zielone (job `ci` i job `smoke`) — 5c23944

#### Manual

- [ ] 6.4 Migracja nieobecności została zastosowana na hostowanym projekcie (`npx supabase db push`, przed wdrożeniem kodu)
- [ ] 6.5 Po wdrożeniu (`npm run build` i `npx wrangler deploy`) strona `/absences` i znaczniki nieobecności w obsadzaniu działają na produkcji; nie uruchamiać `npm run smoke` na produkcji
- [ ] 6.6 Pomiar CPU strony obsadzania po wdrożeniu mieści się w limicie 10 ms na żądanie albo wynik jest zapisany w `deploy-plan.md` razem z decyzją
