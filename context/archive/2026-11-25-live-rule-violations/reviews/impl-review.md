<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Live rule violations Implementation Plan

- **Plan**: context/changes/live-rule-violations/plan.md
- **Scope**: Full plan (Phase 5 of 5)
- **Reviewed phases**: 1, 2, 3, 4, 5
- **Reviewed state**: head of PR #12, commit `68a1373` (base `93f75b6`), read in the worktree of the branch; `master` already contains later S-06 changes in some of the same files (`AssignmentGrid.tsx`, `smoke.mjs`, `types.ts`, docs)
- **Date**: 2026-11-26
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 7 observations

## Success criteria

- `npx astro sync`, `npm run lint`, `npx astro check` (107 files, 0/0/0), `npm test` (1497/1497), `npm run build` run on the PR head `68a1373`: pass.
- Smoke (632 steps, locally) and the CI jobs `ci` and `smoke` on PR #12 and on the `master` pushes after the merge: green.
- Manual rows 1.4, 2.4, 4.3 and 4.4 were approved by the author during implementation; rows 5.4 and 5.5 (production check and the CPU measurement, median 4.8 ms) were confirmed by the author on 2026-11-26 after the deployment of `80ff402`.
- Break-checks (mutations of the production code that must turn tests or smoke steps red) were run by the main agent in every phase; no artifact of them is stored in the repository.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Plan nie opisuje scalania przerw na granicy grafiku w odpoczynku tygodniowym

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: plan.md:58, 153 (kod: src/lib/services/rules.ts:343-388)
- **Detail**: Plan opisuje oś [0, 10080) z dwiema osobnymi przerwami brzegowymi (od 0 do pierwszej zmiany i od ostatniej zmiany do 10080), każda z progiem 2100, i zapewnia, że "krawędzie nigdy nie dają fałszywych krytycznych". Ten algorytm sprzeczny z własną gwarancją: osoba pracująca wt-sob 06:00-14:00 w grafiku od poniedziałku ma przerwę początkową 30 h i końcową 34 h, żadna nie sięga 35 h, więc dostałaby fałszywe krytyczne naruszenie, choć jej wolne na granicy to 64 h. Kod scala przerwę końcową i początkową w jedną przerwę przez granicę (założenie cykliczne), z progiem 35 h. Odchylenie jest ujawnione (commit cf2bde0, notka w widoku, CLAUDE.md, AGENTS.md, README) i zatwierdzone w wierszu 2.4, ale plan.md nie został zaktualizowany i dalej opisuje zachowanie, którego kod nie ma.
- **Fix**: Addendum w tym raporcie (poniżej), bez zmiany kodu.
- **Decision**: FIX NOW (done): addendum o scalaniu przerw na granicy grafiku jest w tym raporcie; bez zmiany kodu

### F2 — RULE_ORDER bez kontroli kompletności względem typu ViolationRule

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/rules.ts:46-55, 113-120
- **Detail**: `RULE_ORDER` jest tablicą `readonly ViolationRule[]`, a `compareViolations` używa `indexOf`. Gdy S-07, S-08 albo S-09 dodadzą regułę do unii `ViolationRule` i zapomną tablicy, `indexOf` zwróci -1 i nowa reguła po cichu posortuje się przed wszystkimi istniejącymi tej samej wagi. Jedyną ochroną jest test przypinający dzisiejsze sześć wartości. Precedens w repo to `as const satisfies Record<AssignmentField, string>` (assignment.ts:10), a `ViolationList.tsx` robi to już dla wagi (`Record<ViolationSeverity, …>`).
- **Fix**: Zamienić na `Record<ViolationRule, number>` (kolejność jako ranga) z `satisfies`, tak samo dla wagi, i użyć rang w `compareViolations`.
- **Decision**: FIX NOW (queued): rangi `Record<ViolationRule, number>` i wagi z `satisfies` zamiast `indexOf` w `compareViolations`

### F3 — Strażnik czasu lokalnego w testach nie widzi `new Date(y, m, d)` ani `Date.parse` bez strefy

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/testing/local-time.ts:6-29
- **Detail**: Pomocnik szpieguje tylko lokalne gettery i settery `Date.prototype`. Środowisko testowe (workerd) działa w UTC, więc ten strażnik jest jedyną ochroną przed błędami strefy czasowej. Nie widzi najczęstszych regresji: `new Date(y, m, d)` z komponentami, `new Date("2026-11-10T00:00:00")` i `Date.parse` napisu bez przesunięcia (oba w czasie lokalnym) oraz przestarzałych `getYear`/`setYear`. Kod w rodzaju `new Date(y, m, d).getTime()` przeszedłby wszystkie testy "nie woła metody lokalnej" i dał błędy dopiero na komputerze w innej strefie lub w innym środowisku.
- **Fix A ⭐ Recommended**: Reguła ESLint `no-restricted-syntax` zakazująca `new Date(` z wieloma argumentami i napisu bez `Z` w `src/lib/services/**`, plus uwaga o ograniczeniu w nagłówku pomocnika
  - Strength: Łapie to, czego testy w UTC nie mogą, już przy lincie.
  - Tradeoff: Istniejące uzasadnione `Date.parse` (shift.ts:135, employee.ts:130) wymagają wyjątku albo zawężenia reguły.
  - Confidence: MED — selektor dla wywołań z wieloma argumentami jest prosty, wyjątki trzeba przejrzeć.
  - Blind spot: Czy inne pliki spoza `services/` liczą daty.
- **Fix B**: Tylko uwaga o ograniczeniu w nagłówku `local-time.ts`
  - Strength: Zero ryzyka, jedna linia.
  - Tradeoff: Ochrona dalej opiera się na uważności autora.
  - Confidence: HIGH — nic nie zmienia w zachowaniu.
  - Blind spot: None significant.
- **Decision**: FIX A (queued): regula ESLint `no-restricted-syntax` dla `new Date(` z wieloma argumentami i napisu bez `Z` w `src/lib/services/**` z wyjatkami dla istniejacych `Date.parse` plus uwaga w naglowku `local-time.ts`

### F4 — Powód `weekly_norm` przy ułamkowym etacie brzmi sprzecznie

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/rules.ts:470-478 (pinned by rules.test.ts:915-919)
- **Detail**: Porównanie z normą jest dokładne, ale pokazany limit jest zaokrąglony do minuty. Dla etatu 3/7 i 1029 minut pracy ostrzeżenie czyta się "łączny czas pracy 17 h 9 min, norma tygodniowa (3/7 etatu) to 17 h 9 min": planista widzi ostrzeżenie, w którym obie liczby są równe. To samo dla każdego etatu, którego norma nie jest całkowita (1/7, 3/7 ze świętem: 823 min). Kolumna "Godziny" z S-06 w tym samym przypadku pokazuje "równo z normą" (zatwierdzone w 1.4 S-06), więc ostrzeżenie i kolumna są spójne co do liczb, ale ostrzeżenie nie tłumaczy, dlaczego się pojawia.
- **Fix**: Gdy przepracowane minuty równają się zaokrąglonemu limitowi (a dokładne porównanie jest przekroczone), dopisać do powodu "(przekroczona o ułamek minuty)"; zaktualizować przypięty test.
- **Decision**: FIX NOW (queued): dopisek `(przekroczona o ułamek minuty)` w powodzie `weekly_norm`, gdy przepracowane minuty równają się zaokrąglonemu limitowi, i aktualizacja przypiętego testu

### F5 — Obliczenia w Workerze: święta liczone osobno dla każdej osoby, O(n²) w `daily_hours`

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/rules.ts:466, 288-301; work-hours.ts:77-88; calendar.ts:131-140
- **Detail**: `weeklyNorm(startDate, fte)` wywołuje `holidaysInWeek(startDate)` dla każdej osoby z godzinami: dwa wywołania `holidaysOf` (obliczenie Wielkanocy, kilkanaście napisów, sortowanie, `Set`, siedem obiektów `Date`). Lista świąt zależy tylko od `startDate`, więc przy 30 osobach to około 30 zbędnych obliczeń, co przy zimnym izolacie (10 ms CPU) ma znaczenie; pomiar produkcyjny (mediana 4,8 ms) tego przypadku nie rozstrzyga. `dailyHours` jest O(n²) w liczbie zmian jednej osoby (realnie około 21 zmian, ok. 13 tys. iteracji dla 30 osób; patologiczny skład 350 zmian jednej osoby to ok. 122 tys. iteracji na osobę).
- **Fix**: Policzyć święta tygodnia raz w `prepare()` i przekazać do liczenia normy; przy ponownym pomiarze CPU (S-09) użyć ciężkiego grafiku, nie tylko typowego.
- **Decision**: FIX NOW (queued): swieta tygodnia liczone raz w `prepare()` i przekazywane do liczenia normy; ciezki grafik przy pomiarze CPU w S-09

### F6 — Wyspa formularza grafiku też dostaje etat i minuty zmian, a dokumentacja mówi tylko o wyspie obsadzania

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/lib/schedule-options.ts:13-26; src/pages/schedules/new.astro:17-18; src/pages/schedules/[id].astro:33-34; CLAUDE.md i AGENTS.md (dodane akapity)
- **Detail**: `toShiftOptions` i `toEmployeeOptions` są współdzielone z wyspami formularza, więc `/schedules/new` i `/schedules/<id>` także serializują do strony etat każdego pracownika i minuty każdej zmiany, choć potrzebuje ich tylko strona obsadzania. Strony są tylko dla planisty i `no-store`, adres e-mail nadal nigdy nie trafia do strony, więc to nie jest wyciek, ale plan omawiał tylko wyspę obsadzania, a dokumentacja ("The assignment island now receives each employee's FTE…") jest przez to niepełna.
- **Fix**: Poprawić zdanie w dokumentacji (wyspy stron grafiku też dostają etat i minuty zmian, nigdy e-mail); zostawić wspólne mapowanie.
- **Decision**: FIX NOW (queued): poprawka zdania w CLAUDE.md, AGENTS.md i README.md (wyspy stron grafiku tez dostaja etat i minuty zmian, nigdy e-mail); wspolne mapowanie zostaje

### F7 — Reguły rzucają RangeError przy złej dacie lub etacie, a wyspa nie ma zabezpieczenia

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/hooks/useViolations.ts:29-37; src/components/schedules/AssignmentGrid.tsx:141
- **Detail**: Kontrakt reguł to `RangeError` dla daty spoza zakresu 2020-2099 albo etatu spoza `1 <= licznik <= mianownik <= 100`. Ograniczenia bazy są tym samym predykatem (`schedules_start_date_valid`, `employees_fte_valid`), więc błąd jest dziś nieosiągalny. Bez ochrony wyjątek w `useMemo` zepsułby render serwerowy (500) albo odmontował całą wyspę, czyli jedyną powierzchnię edycji, gdyby przyszła migracja poluzowała ograniczenia.
- **Fix**: Owinąć `evaluateSchedule` w `try/catch` w hooku i zwracać jawny stan błędu pokazywany jako komunikat ("Nie udało się policzyć wskazań"), nigdy jako "Brak wskazań" (ciche zero to fałszywa zgodność).
- **Decision**: FIX NOW (queued): `try/catch` wokol `evaluateSchedule` w `useViolations` z jawnym stanem bledu i komunikatem, nigdy cichym "Brak wskazan"

### F8 — Atrapa "(niedostępne)" jest typowana jak poprawna zmiana i zdublowana w dwóch plikach

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/components/schedules/AssignmentGrid.tsx:45-47; src/components/schedules/ScheduleForm.tsx:41-43
- **Detail**: Atrapa zmiany usuniętej ze słownika jest zwykłym `ShiftOption` z `startMinute: 0, endMinute: 0`, czyli zmianą o zerowej długości, którą walidator i baza zabraniają. Jedyną ochroną przed przekazaniem jej do reguł jest komentarz w `useViolations` (hook dostaje tylko prop `shifts`). Gdyby trafiła do reguł, segment 00:00-00:00 obok zmiany 06:00 dałby fałszywy `daily_rest` 6 h. Pomocnik jest zdublowany w dwóch plikach. Niski priorytet, bo zmian nie da się usunąć (brak polityki delete, `on delete restrict`).
- **Fix**: Jeden wspólny pomocnik `unavailableShift` (np. w `schedule-options.ts`) z opisem, że nigdy nie trafia do reguł.
- **Decision**: FIX NOW (queued): jeden wspolny pomocnik `unavailableShift` w `schedule-options.ts`, usuniecie duplikatu

### F9 — Klucz wskazania `daily_hours` zawiera pełny zbiór kotwic okna

- **Severity**: 👁 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: src/lib/services/rules.ts:312, 88-95
- **Detail**: Klucz to `reguła|osoba|posortowane klucze kotwic`, a kotwice `daily_hours` to wszystkie przypisania zachodzące na okno. Dołożenie kolejnej zmiany do już zgłoszonego okna zmienia klucz "tego samego" wskazania. Testy dowodzą stabilności klucza względem godzin i kolejności wejścia, nie względem rosnącego zbioru kotwic. Dla krytycznych wskazań to bez znaczenia (nie da się ich potwierdzić), ale S-08 ma zapisywać i zamrażać wskazania; klucze ostrzeżeń (`weekly_norm` bez kotwic, `understaffed` z kotwicą komórki) są stabilne.
- **Fix**: Zapisać w planie S-08, że potwierdzanie dotyczy kluczy ostrzeżeń, albo już teraz kluczować `daily_hours` otwierającą zmianą okna (lista kotwic zostaje pełna); do rozstrzygnięcia przy planowaniu S-08.
- **Decision**: FIX NOW (queued): klucz `daily_hours` otwierajaca zmiana okna (lista kotwic bez zmian) i aktualizacja testow kluczy

### F10 — Drobne niedoróbki: kontrast, zdania w dokumentacji i komentarzach, duplikaty, brak testu `fte.ts`

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/schedules/ViolationList.tsx:63; AssignmentGrid.tsx:128; CLAUDE.md (akapit o przypisaniach); scripts/smoke.mjs (komentarz nagłówkowy, komentarz "four schedules"); src/lib/services/calendar.ts:7, 31-39; violation-view.ts:9-12; fte.ts
- **Detail**: (1) Kontrast: `text-blue-100/50` (zastrzeżenie o zgodności z prawem, 12 px) to ok. 4,2:1, a `/40` ("brak") ok. 3,2:1, poniżej AA 4,5:1 (szacunek, nie pomiar); istniejąca notka o obsadzie używa `/50`, więc to spójne, ale nie lepsze. (2) CLAUDE.md w akapicie o przypisaniach dalej mówi, że "x z y" z `−n`/`+n` to "information and not an error": prawdziwe dla nadmiaru, a niedobór jest teraz ostrzeżeniem na liście. (3) Komentarz nagłówkowy smoke został zmieniony w uszkodzoną, zbyt długą linię; komentarz przy kroku z limitem 2 mówi "four schedules of this run", a grafik reguł jest piątym. (4) `calendar.ts` powiela prywatne `pad2`, `requireDate`, `DAY_MS` z `schedule.ts`, a `ViolationCounts` powiela typ zwracany `summarizeViolations` bez wymuszenia zgodności. (5) `fte.ts` nie ma pliku testowego (`formatFteLabel` jest testowane przez re-eksport w `employee.test.ts`). (6) Ścieżka kliencka ("liczone od nowa po każdym kliknięciu", wycofanie przy błędzie) nie ma żadnego testu automatycznego (konwencja repo zabrania testów komponentów), a dokumentacja ją reklamuje; pokrywają ją wiersze ręczne 4.3.
- **Fix**: Jeden commit porządkowy: podnieść kontrast do `/60`, doprecyzować zdanie w CLAUDE.md o niedoborze, naprawić komentarze smoke, współdzielić typ `ViolationCounts` w `types.ts`, dodać krótki test `fte.ts`; pozostałe zostawić.
- **Decision**: FIX NOW (queued): jeden commit porzadkowy: kontrast `/60`, zdanie w CLAUDE.md o niedoborze, komentarze smoke, wspolny typ `ViolationCounts` w `types.ts`, test `fte.ts`; punkt 6 (brak testu sciezki klienckiej) zostaje jako znane ograniczenie

## Addendum: korekty planu i odchylenia (F1)

Plan jest po archiwizacji tylko do odczytu, więc korekty są tutaj. Kod S-05 odpowiada zamierzeniom planu we wszystkich wpisach "Changes Required" faz 1 do 5 (MATCH); nie ma brakujących elementów ani naruszeń sekcji "What We're NOT Doing" (brak migracji, tras API, zmian w `access.ts`, `ci.yml`, `package.json`, brak zapisu wskazań i odczytu sąsiednich grafików, brak testów komponentów). Poniżej odchylenia i wady samego planu.

- **Odpoczynek tygodniowy (plan.md:58, 153):** plan opisuje dwie osobne przerwy brzegowe z progiem 35 h każda i jednocześnie obiecuje brak fałszywych krytycznych na krawędziach; te dwie rzeczy są sprzeczne (wt-sob w grafiku od poniedziałku: 30 h + 34 h). Obowiązuje wersja z kodu: przerwa na końcu grafiku i na jego początku liczy się jako jedna przerwa (założenie cykliczne, nic nie jest czytane spoza grafiku), próg 35 h bez wyjątku 24 h; przerwa tylko początkowa albo tylko końcowa zostaje osobno. Remis najdłuższych przerw wskazuje przerwę scaloną.
- **Trzecia zmiana w smoke (plan Faza 5 pkt 1):** plan mówi o dwóch zmianach z istniejących danych (22:00-07:00 i 06:00-14:00); z nich nie da się zbudować przerwy dokładnie 11 h, więc kroki tworzą jeszcze zmianę 01:00-09:00 (14:00 do 01:00 następnego dnia to dokładnie 11 h). Uzasadnione.
- **Zdanie o etacie wyspy (plan Faza 5 pkt 2):** plan każe poprawić zdanie "never the FTE" w CLAUDE.md i AGENTS.md; takiego zdania w tych plikach nie było (istniał tylko komentarz w `types.ts:132`, poprawiony w Fazie 1). Dodano nowe akapity.
- **Kroki "brak kadrowy zamiast naruszeń" dla grafiku trasy (plan Faza 4 pkt 3):** jedyna komórka tego grafiku jest kompletna (1 z 1), więc strona poprawnie pokazuje "Brak wskazań", i dokładnie to asertuje smoke.
- **`schedule-options.test.ts`:** plan nazywa go "nowym", ale istniał od poprawek F2 przeglądu S-03 (plan dopuszczał aktualizację).
- **Faza 3** ma uwagę "wstrzymaj się na ręczne potwierdzenie", ale nie ma wierszy ręcznych, więc nic nie było bramkowane.
- **Wskazanie `understaffed` dla komórki ze zmianą spoza słownika** pokazuje id zmiany, podczas gdy siatka pokazuje "(niedostępne)"; plan wymieniał tylko nazwę, godziny i dzień.
- **Dodatki poza planem (uzasadnione):** `violation-view.ts` z testem (czysta logika widoku, liczby mnogie, grupowanie), `fte.ts` (formatowanie etatu bez zoda w paczce wyspy), `src/lib/testing/local-time.ts` (wspólny strażnik czasu lokalnego), `startMinute`/`endMinute` w atrapach `unavailableShift` w `AssignmentGrid.tsx` i `ScheduleForm.tsx` (wymuszone nowymi polami), edycje roadmapy S-05 (status, Outcome z "pułap 48 h i ostrzeżenie o normie", rozstrzygnięta niewiadoma).
- **Kalendarz** liczy święta bez ograniczenia roku wewnątrz (`holidaysOf`), więc tydzień zaczynający się 2099-12-31 liczy święta 2100 (nadzbiór zakresu 2020-2099; `polishHolidays` nadal go egzekwuje).
