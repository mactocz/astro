# Review fixes: live-rule-violations

Poprawki zakolejkowane w triage przeglądu implementacji (`reviews/impl-review.md`, 2026-11-26). Wszystkie mają decyzję "Fix now" (F3 w wariancie A); implementacja jest osobną pracą na własnej gałęzi (S-05 jest scalone i wdrożone), a stan z S-06 (kolumna "Godziny", `useWorkload`, `AssignmentGrid.tsx`) trzeba uwzględnić.

| ID | Poprawka | Pliki (stan z S-06 na `master`) | Uwagi |
| --- | --- | --- | --- |
| F1 | Addendum o scalaniu przerw na granicy grafiku | `reviews/impl-review.md` | zrobione, bez zmiany kodu |
| F2 | `RULE_ORDER` i `SEVERITY_ORDER` jako `Record<..., number>` z `satisfies`, ranga w `compareViolations` | `src/lib/services/rules.ts` (+test) | test kolejności zostaje zielony |
| F3 | Reguła ESLint `no-restricted-syntax` dla `new Date(` z wieloma argumentami i napisu bez `Z` w `src/lib/services/**`, wyjątki dla istniejących `Date.parse` (`shift.ts`, `employee.ts`), uwaga w nagłówku `local-time.ts` | `eslint.config.js`, `src/lib/testing/local-time.ts` | sprawdzić wszystkie wystąpienia `Date.parse`/`new Date(` w `src/lib/services/` |
| F4 | Dopisek "(przekroczona o ułamek minuty)" w powodzie `weekly_norm`, gdy przepracowane minuty równają się zaokrąglonemu limitowi | `src/lib/services/rules.ts` (+test) | zaktualizować przypięty test (3/7 etatu, 1029 min) |
| F5 | Święta tygodnia liczone raz w `prepare()` i przekazywane do liczenia normy | `src/lib/services/rules.ts`, `work-hours.ts` | wynik bez zmian, testy zielone |
| F6 | Poprawić zdanie w dokumentacji: wyspy stron grafiku też dostają etat i minuty zmian, nigdy e-mail | `CLAUDE.md`, `AGENTS.md`, `README.md` | bez zmiany kodu |
| F7 | `try/catch` wokół `evaluateSchedule` w hooku, jawny stan błędu i komunikat "Nie udało się policzyć wskazań", nigdy ciche "Brak wskazań" | `src/components/hooks/useViolations.ts`, `AssignmentGrid.tsx` | błąd nieosiągalny dziś (ograniczenia bazy) |
| F8 | Wspólny pomocnik `unavailableShift` zamiast dwóch kopii | `src/lib/schedule-options.ts`, `AssignmentGrid.tsx`, `ScheduleForm.tsx` | nigdy nie trafia do reguł |
| F9 | Klucz `daily_hours` kluczowany otwierającą zmianą okna (lista kotwic zostaje pełna) | `src/lib/services/rules.ts` (+test) | zaktualizować testy kluczy |
| F10 | Kontrast `/60`, zdanie w CLAUDE.md o niedoborze, komentarze smoke, wspólny typ `ViolationCounts` w `types.ts`, krótki test `fte.ts` | `ViolationList.tsx`, `AssignmentGrid.tsx`, `CLAUDE.md`, `scripts/smoke.mjs`, `src/types.ts`, `violation-view.ts`, `rules.ts`, nowy `fte.test.ts` | punkt 6 (test ścieżki klienckiej) zostaje jako znane ograniczenie |

## Status

F1 do F10 zrealizowane na gałęzi `change/review-fixes-s05` (2026-11-26), jednym commitem. Bramki: `astro sync`, lint (z nową regułą z F3), `astro check` (0/0/0), `npm test` (1597), build i pełny smoke (684 kroki). Kontrola celowego uszkodzenia (klucz `daily_hours`, ranga reguł, dopisek ułamka minuty, norma ze świętami liczonymi raz, `safeEvaluate`, wspólna atrapa zmiany) wywróciła właściwe testy; reguła ESLint zgłasza zabronione `new Date(y, m, d)` i `Date.parse` w serwisach. Poza kolejką: `useWorkload` dostał to samo zabezpieczenie przed `RangeError` co `useViolations` (uwaga agenta F7), a kolumna "Wskazania" pokazuje "nie policzono" zamiast "brak", gdy reguł nie dało się policzyć.
