# Schedule approval — Plan Brief

> Full plan: `context/changes/schedule-approval/plan.md`

## What & Why

Planista zatwierdza grafik: krytyczne naruszenie blokuje zatwierdzenie, ostrzeżenie wymaga jawnego potwierdzenia, a zatwierdzony grafik jest ostateczny, zablokowany do edycji i ma zapisane wskazania (wycinek S-08 z roadmapy, FR-012, FR-013, US-01). To zabezpieczenie z PRD: naruszenie nigdy nie jest zatwierdzane po cichu. Blokada jest wymuszana w bazie, a nie tylko w aplikacji, a późniejsza edycja słownika zmian lub pracowników nie zmienia zatwierdzonego grafiku (migawka). Dane zatwierdzenia odczyta S-11 (widok pracownika) i skopiuje S-12 (nowa wersja). Implementacja zaczyna się po scaleniu S-07, żeby zatwierdzenie obejmowało nieobecności od pierwszego razu.

## Starting Point

Grafik jest dziś zawsze edytowalny: `schedules` ma tabelowy grant `insert, update` (kolumna statusu byłaby objęta), przypisania nie mają klucza do `schedules`, a zapisy idą kilkoma ścieżkami (RPC `save_schedule`, trasy przypisań, bezpośredni PostgREST, kaskady, konto serwisowe). Reguły są w TypeScripcie (`safeEvaluate`), więc baza ich nie powtórzy. Powody wskazań to tekst z nazwiskami i godzinami, które można dziś zmienić edycją słownika. Jedyną funkcją `security definer` jest `mark_account_active`. Smoke ma kruche pomocniki listy i strony obsadzania (stała liczba komórek, jedna tabela przed obsadą, tekst szkicu D6).

## Desired End State

Szkic ma po sekcji obsady sekcję "Zatwierdzanie" z panelem potwierdzenia (lista ostrzeżeń, zdanie o nieodwracalności, bezpieczny przycisk "Wróć"); zatwierdzony grafik jest tylko do odczytu na stronach obsadzania, edycji i listy (baner, zapisane wskazania, sumy godzin z migawki, wariant komunikatu D6, kolumna statusu). Baza odrzuca każdy zapis do zatwierdzonego grafiku, a zatwierdzenie robi wyłącznie funkcja `approve_schedule`, która sprawdza rolę, blokuje grafik, porównuje dane wejściowe trasy z bieżącymi i zapisuje niemodyfikowalny rekord z migawkami. Trasa przelicza reguły na serwerze i odpowiada precyzyjnymi kodami.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Kolejność względem S-07 | S-08 po S-07 | Zatwierdzenie obejmuje nieobecności od pierwszego razu, a migracje i kontrakt silnika układają się w jednej kolejności. | Wywiad |
| Mechanizm blokady | Status + RLS na czterech tabelach + granty kolumnowe | Baza odmawia każdej ścieżki zapisu, także tokenowi planisty omijającemu aplikację, a konto serwisowe i kaskady (sprzątanie smoke) działają. | Wywiad |
| Funkcja zatwierdzenia | Druga `security definer` (`approve_schedule`) | Jedne drzwi: nie da się zatwierdzić bez blokady, weryfikacji i kopii migawki. | Wywiad |
| Weryfikacja i wyścig | Trasa wysyła ładunek, funkcja porównuje zbiory pod blokadą | Styl `save_schedule`, bez kanonizacji odcisku w dwóch językach; jeden obiekt jsonb rozszerza się o dane bez zmiany sygnatury. | Wywiad |
| Edycja słownika (FR-013) | Migawka przy zatwierdzeniu, edycja otwarta | Użytej zmiany nie można by nigdy poprawić, a pracownika nie da się zablokować. | Wywiad |
| Potwierdzenie | Jeden panel dla wszystkich ostrzeżeń, zawsze pokazywany | Nieodwracalna czynność wymaga świadomego kroku, a setki ostrzeżeń o brakach nie mogą być checkboxami. | Wywiad |
| Zatwierdzony grafik na ekranie | Te same strony w trybie tylko do odczytu | Brak drugiej, klienckiej ścieżki kodu; stan rozstrzyga serwer. | Wywiad |
| Warunki zatwierdzenia | Każdy szkic o policzalnych regułach bez krytycznych | Dokładnie reguły PRD; porażka reguł to 503, nigdy zatwierdzenie bez kontroli. | Wywiad |
| Późna nieobecność | Zatwierdzony grafik zostaje zamrożony | "Zatwierdzony" znaczy to, co sprawdzono; reakcją jest nowa wersja (S-12). | Wywiad |
| Komunikat D6 | Wariant dla zatwierdzonych z zachowanym zastrzeżeniem prawnym | Zastrzeżenie nie znika, gdy grafik wygląda na ostateczny, a słowo "szkic" nie pada. | Wywiad |
| Rekord zatwierdzenia | Wskazania, potwierdzenie, zatwierdzający (uuid i e-mail bez klucza do kont), czas | Wszystko, czego wymaga zabezpieczenie i czytają S-11 i S-12; bez wersji reguł bez czytelnika. | Wywiad |
| Kody błędów bazy | `PT423`, `PT412`, `PT422` (nie `PT409`) | `classifySaveFailure` traktuje `PT409` tylko z liczbą w `detail`. | Plan |

## Scope

**In scope:** typy, czyste funkcje decyzji i ładunku; migracja (status, granty kolumnowe, polityki, tabele zatwierdzeń i migawek, `approve_schedule`, przepisana `save_schedule`, widok ze statusem); moduł danych i trasa `POST /api/schedules/[id]/approve`; 409 `schedule_approved` w trasach zapisu; sekcja i panel zatwierdzania, tryb tylko do odczytu (obsadzanie, edycja, lista), migawki, wariant D6; smoke (baza, trasy, strony); dokumentacja; wdrożenie z pomiarem CPU.

**Out of scope:** cofnięcie zatwierdzenia, wersje i unikalność okresu (S-12), widok pracownika (S-11), generator (S-09), blokowanie edycji słownika, wersja reguł, potwierdzanie pojedynczych ostrzeżeń, wymóg minimalnej liczby przypisań, ponowne sprawdzanie zatwierdzonego grafiku wobec późniejszych nieobecności, usuwanie grafików, testy komponentów.

## Architecture / Approach

Od środka na zewnątrz: czyste funkcje (Faza 1), baza z blokadą i funkcją dowiedziona w smoke i testem dwoma połączeniami (Faza 2), dane i trasa (Faza 3), interfejs i tryb tylko do odczytu (Faza 4), smoke stron i dokumentacja (Faza 5), wdrożenie (Faza 6). Blokada dwuwarstwowa: polityki sprawdzają status, a funkcja zamyka wyścig blokadą wiersza grafiku i tabel dzieci oraz porównaniem ładunku. Zatwierdzenie przelicza reguły na serwerze z danych bazy, a zapisane wskazania i sumy godzin są zamrożone jako tekst i liczby.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Czyste funkcje zatwierdzania | Typy, `decideApproval`, `buildApprovalPayload`, komunikaty | Kolejność sprawdzeń i kształt ładunku wymagają akceptacji autora |
| 2. Baza | Status, granty, polityki, rekord i migawki, `approve_schedule`, `save_schedule`, widok, smoke bazy | Przebudowa grantów, blokady tabel (zachowanie PostgreSQL z pamięci), druga funkcja definer |
| 3. Dane i trasa | `approvals.ts`, trasa zatwierdzania, 409 w trasach zapisu | Cichy `DELETE` pod RLS i mapowanie 42501 |
| 4. Interfejs | Sekcja i panel, tryb tylko do odczytu, migawki, D6 | Kilka stron z nową gałęzią, brak testów komponentów (przegląd w przeglądarce) |
| 5. Smoke stron i dokumentacja | Kroki stron zatwierdzonego grafiku, dokumentacja | Kruche pomocniki listy i strony obsadzania |
| 6. Wdrożenie | `db push`, wdrożenie, pomiar CPU | Zatwierdzenie na produkcji jest nieodwracalne; CPU trasy i strony (limit 10 ms) |

**Prerequisites:** S-07 w `master` (nieobecności w ładunku, późniejszy znacznik migracji); S-05 i S-06 gotowe; lokalny Supabase i Docker; dostęp autora do hostowanego projektu (`npx supabase db push`).
**Estimated effort:** około 6 sesji, po jednej na fazę; więcej niż S-05 przez bazę i blokady.

## Open Risks & Assumptions

- Przy bezpośrednim wywołaniu RPC przez zaufanego planistę możliwa jest zafałszowana lista wskazań (baza nie powtórzy reguł); funkcja odrzuca krytyczne i niepotwierdzone ostrzeżenia i zapisuje zatwierdzającego; ryzyko jest udokumentowane.
- Druga funkcja `security definer` w projekcie (zgoda autora z wywiadu); sprawdzenie roli jako pierwsza instrukcja jest testowane w smoke dla pracownika, konta bez roli i anonima.
- Zachowania PostgreSQL pod blokadami (uprawnienia do `LOCK TABLE`, migawka po oczekiwaniu na blokadę w PostgREST) były z pamięci; Faza 2 ma test dwoma połączeniami i zapis wyniku.
- Zatwierdzenie jest nieodwracalne, a grafik testowy na produkcji nie da się usunąć.
- Konflikty z S-07 w `types.ts`, `rules.ts`, `assign.astro`, `AssignmentGrid.tsx`, smoke i dokumentacji; plan zakłada nazwy z S-07 (`absences.ts`, `AbsenceOption`, `RuleInput.absences`) i wymaga ich sprawdzenia w `master`.
- Brak testów komponentów: tryb tylko do odczytu i panel opierają się na przeglądzie w przeglądarce.
- Dane zdrowotne: powody wskazań o nieobecnościach niosą rodzaj (w tym L4) obok nazwiska; zamrożone w zatwierdzeniu mogłyby trafić do pracowników w S-11, więc zostają tylko dla planisty albo rodzaj jest redagowany (ustalenie z przeglądu S-07, do rozstrzygnięcia w tej zmianie).

## Success Criteria (Summary)

- Planista zatwierdza szkic po jawnym potwierdzeniu ostrzeżeń, krytyczne naruszenie blokuje zatwierdzenie, a zatwierdzony grafik jest tylko do odczytu na każdej stronie, z zapisanymi wskazaniami i sumami godzin z migawki.
- Baza odrzuca każdy zapis do zatwierdzonego grafiku (też przez PostgREST), nie pozwala zatwierdzić inaczej niż przez `approve_schedule`, a edycja zmiany lub pracownika nie zmienia zatwierdzonego grafiku.
- Bramka, smoke i CI przechodzą, a po wdrożeniu (z `db push` przed kodem) zatwierdzanie działa na produkcji, a pomiar CPU trasy i strony mieści się w limicie.
