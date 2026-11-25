# Review fixes: weekly-schedule-draft

Poprawki zakolejkowane w triage przeglądu implementacji (`reviews/impl-review.md`, 2026-11-25). Wszystkie mają decyzję "Fix now"; implementacja jest osobną pracą na `master` (S-03 jest scalone i wdrożone), a stan z S-04 (zmieniony `save_schedule`, hook formularza, widok obsadzania) trzeba uwzględnić.

| ID | Poprawka | Pliki (stan z S-04 na `master`) | Uwagi |
| --- | --- | --- | --- |
| F1 | Fix A: poprawić sformułowania na "przez aplikację" i dopisać, że niezmienniki (co najmniej 1 komórka i 1 pracownik, limit 350, kształt JSON, potwierdzenie usunięcia przypisań) są po stronie aplikacji | `CLAUDE.md`, `README.md` (komentarza w zastosowanej migracji nie edytować; addendum w raporcie) | bez zmiany kodu |
| F2 | Test jednostkowy `toEmployeeOptions` (dokładnie klucze `id` i `name`) i `bodyExcludes` z e-mailem w smoke na `/schedules/new`, `/schedules/<id>` i `/schedules/<id>/assign` | `src/lib/schedule-options.ts` (+ nowy test), `scripts/smoke.mjs` | |
| F3 | `EMPLOYEE_IDS_MAX` (np. 1000) przed pętlą w `parseEmployeeIds`, komunikat po polsku, przypadek w teście | `src/lib/services/schedule.ts`, `schedule.test.ts` | |
| F4 | Asercje przyczyny w krokach odmów bazy (create RPC: 403 z `42501`; replace RPC: 404 z `PT404`; anon: 401 z `42501`) i odczyt planisty po etykiecie `Smoke-<runId>-*rpc*` oczekujący listy pustej | `scripts/smoke.mjs` | kody sprawdzić na działającym stosie |
| F5 | Szpiegowanie lokalnych getterów `Date` w testach zmiany czasu i test idempotencji walidacji | `src/lib/services/schedule.test.ts` | |
| F6 | Niewidoczne znaki jako `\u`-escape w kodzie i testach, rozszerzenie klasy o niewidoczne `\p{Mn}` i odrzucenie `Cf` z zakresu bidi | `src/lib/services/schedule.ts`, `shift.ts` (wspólny wzorzec), ich testy | zmienia walidację etykiet i nazw zmian |
| F7 | `order` po `start_date` malejąco i `limit` z komunikatem o obcięciu; suma obsady po stronie bazy (widok lub funkcja SQL) | `src/lib/schedules.ts`, `src/pages/schedules/index.astro`, nowa migracja | wybór widoku lub funkcji do rozstrzygnięcia; migracja wymaga `db push` przed wdrożeniem |
| F8 | `try/catch` wokół walidacji w `submit`; limit etykiety po zwinięciu spacji; liczba tylko z cyfr; blokada ponownego wysłania po błędzie sieci | `src/components/hooks/useScheduleForm.ts` (po zmianach S-04) | |
| F9 | Jeden wyeksportowany komparator (także dla `assignment.ts`) i mapowanie błędów bazy w czystej funkcji z testem | `src/lib/schedules.ts`, `src/lib/services/schedule.ts`, `src/lib/services/assignment.ts` | |
| F10 | Addendum z korektami planu (zapisane w raporcie) i podpowiedź zakresu przy polu daty | `src/components/schedules/ScheduleForm.tsx` | addendum zrobione |