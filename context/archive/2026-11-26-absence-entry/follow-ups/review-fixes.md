# Review fixes queue: absence-entry (S-07)

Źródło: `context/changes/absence-entry/reviews/impl-review.md` (przegląd pełny, 2026-11-27). Wszystkie punkty poniżej mają decyzję autora z triage. Poprawki kodu wchodzą jedną zmianą (`change/review-fixes-s07`), bez migracji bazy; wdrożenie to `npm run build` i `npx wrangler deploy`.

## 1. F1: lista `/absences` bez limitu (Fix B)

- Obie postacie listy czytają z bazy posortowane (`start_date` malejąco, potem `id`) i z limitem `LIST_LIMIT` (500) plus jeden wiersz na wykrycie "jest więcej"; strona pokazuje notkę, gdy lista jest obcięta ("Pokazano najnowsze 500 nieobecności.").
- Domyślnie lista pokazuje nieobecności z `end_date >= dziś - 365 dni` (dziś w UTC, `addDays` z `schedule.ts`); link "Pokaż starsze" (`/absences?all=1`) pokazuje wszystkie (nadal z limitem); na widoku pełnym link wraca do domyślnego ("Pokaż tylko ostatnie 12 miesięcy").
- Nagłówek "Nieobecności (n)" liczy wiersze widoczne w danym widoku; notka mówi, który widok jest aktywny.
- Rzucający `READ_LIMIT` zostaje tylko dla odczytów zasilających reguły (`listAbsencesOverlapping`).
- Smoke: kroki listy zostają (fixtury w 2090 mieszczą się w domyślnym widoku); nowe kroki: nieobecność z 2021 roku wstawiona kontem serwisowym dla pracownika smoke jest ukryta w widoku domyślnym i widoczna w `?all=1`, linki między widokami, notka widoku.

## 2. F2: dowód wdrożenia w `deploy-plan.md`

- Dopisać linię do sekcji "Czas CPU strony obsadzania po S-07": 2026-11-27 autor potwierdził, że `/absences` i znaczniki w komórkach działają na produkcji. p99 i zimny izolat: zadanie dla S-08 (już zapisane).

## 3. F3: wykrywanie obcięcia niezależne od `max_rows`

- `listAbsencesOverlapping`: `select(COLUMNS, { count: "exact" })`, błąd gdy `count > data.length`; `READ_LIMIT` zostaje drugą strażą. Logika sprawdzenia jako czysta, eksportowana funkcja z testem jednostkowym (obcięty odczyt, równy, `count` równe `null`).
- `assignments.ts` ma ten sam wzorzec (poza zakresem tej poprawki; uwaga w CLAUDE.md lub follow-up przy S-08).

## 4. F4: dane zdrowotne w zamrożonym powodzie (S-08, S-11)

- Bez zmian w kodzie S-07. Ograniczenie zapisane w planie S-08 (`context/changes/schedule-approval/plan.md` i `plan-brief.md`, worktree `schedule-approval`): powód wskazania `absence` i `absence_requested` niesie rodzaj nieobecności (w tym "zwolnienie lekarskie (L4)") obok nazwiska; zamrożone wskazania zostają tylko dla planisty albo rodzaj jest redagowany do "nieobecność" w tym, co czyta pracownik (S-11); do zdecydowania i przetestowania w S-08.

## 5. F5: znacznik a powód przy nocy

- Test dryfu w `absence.test.ts` dostaje przypadek nocny przypinający obecne zachowanie (znacznik wskazuje najsilniejszą nieobecność pokrywającą dzień, powód najsilniejszą nakładającą się na zmianę); zdanie w CLAUDE.md zmienione na "dla zmiany w obrębie jednego dnia".

## 6. F6: wyczerpujące mapowanie statusu

- `rules.ts` i `absence.ts` (`absenceMarkers`, `formatAbsenceMarker`, siła nieobecności): status mapowany przez `Record<AbsenceStatus, ...>` albo `switch` z kontrolą `never`, tak że nowy status nie skompiluje się bez decyzji; testy pokazują zachowanie dla trzech dzisiejszych statusów.

## 7. F7: rodzaj `other` i absurdalna długość

- Pod polem rodzaju podpowiedź: "Inna nieobecność jest traktowana jak usprawiedliwiona: obniża normę tygodniową tak samo jak urlop." (`aria-describedby`); lista pokazuje liczbę dni obok zakresu ("24.11-26.11.2026 (3 dni)", "(1 dzień)"), liczba dni kalendarzowych obu końców włącznie, czysta funkcja z testami (rok przestępny, przełom roku). Bez ograniczeń w bazie.

## 8. F8: status na stronie edycji i notatki do S-14

- Strona `/absences/[id]` pokazuje status tylko do odczytu ("Status: Zatwierdzona") przy formularzu.
- Notatki do S-14 (bez kodu teraz): (b) `PUT` wymaga `employeeId` i go ignoruje; zdecydować, czy wymagać go nadal; (c) `employee_id` kaskaduje: przy funkcji usuwania lub archiwizacji pracownika preferować soft delete zamiast kaskady, bo kaskada kasuje historię L4; decyzja, czy wiersze inne niż `approved` są edytowalne przez planistę.

## 9. F10: pomocniki, lokalizacja filtra, dokumentacja

- `lowerFirst` i formater dzień-miesiąc wyeksportowane z `absence.ts` i użyte w `rules.ts`; `absencesOfRoster` przeniesione do `src/lib/services/absence.ts` (testy razem z nim, import w `assign.astro`); `AGENTS.md:23` poprawione (`excusedWeekdays` jest w `absence.ts`, w `work-hours.ts` tylko `weeklyNormExcused`); w trzech zdaniach z S-05 (CLAUDE.md "Decisions of the rules" i "definition of the weekly norm", AGENTS.md "Decisions of the column", README akapit o "Godziny") dopisane "(a od S-07 także zatwierdzone nieobecności, patrz niżej)".

## Pominięte

- F9: wynoszenie obliczeń dni tygodnia z `excusedWeekdays` poza pętlę na osobę (przy najbliższej zmianie tych plików) i pomiar p99 strony obsadzania przed S-08.
