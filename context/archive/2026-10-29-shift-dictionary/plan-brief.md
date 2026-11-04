# Shift dictionary — Plan Brief

> Full plan: `context/changes/shift-dictionary/plan.md`

## What & Why

Planista Shiftly definiuje zmiany we wspólnym słowniku (nazwa, godzina rozpoczęcia, godzina zakończenia) i edytuje je na liście `/shifts`. To wycinek S-02 z roadmapy (FR-013): zmiany są wspólną jednostką dla grafików (S-03), obsady i reguł czasu pracy (S-05). Plan powiela sprawdzoną architekturę S-01 i rozstrzyga niewiadomą o zmianach przechodzących przez północ.

## Starting Point

S-01 dało kompletny wzorzec: czyste reguły w `src/lib/services/`, warstwę danych z RLS, trasy JSON, `PlannerLayout`, wyspę React z hookiem i smoke z tabelą, API i stronami. Bramka dostępu zamyka nowe trasy domyślnie. Brakuje tabeli zmian i wszystkiego powyżej niej; z `employees.ts` trzeba tylko wydzielić `isUuid` i logowanie błędów bazy.

## Desired End State

Planista z `/planner` wchodzi kafelkiem "Zmiany" na listę posortowaną chronologicznie (np. 06:00, 14:00, 22:00), z godzinami, znacznikiem "następnego dnia" i czasem trwania, dodaje i edytuje zmiany formularzem, który na żywo pokazuje czas trwania. Pracownik, konto bez roli i anonim nie widzą słownika (RLS w bazie, bramka w aplikacji), a nikt nie usuwa wierszy przez API.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Zmiana przez północ | Koniec wcześniejszy niż początek to następny dzień; koniec równy początkowi jest odrzucany | Jeden wzór `(koniec − początek + 1440) mod 1440` obsługuje 22:00–06:00 i 14:00–00:00 bez dodatkowego pola. | Wywiad |
| Edycja a zatwierdzone grafiki | Słownik edytowalny, S-08 kopiuje nazwę i godziny przy zatwierdzeniu | Szkice podążają za edycją (FR-013), a zatwierdzone grafiki i widok pracownika czytają własną kopię. | Wywiad |
| Unikalność nazw | Nazwy mogą się powtarzać | Wybór autora; S-03 musi pokazywać godziny obok nazwy. | Wywiad |
| Kolejność listy | Godzina rozpoczęcia, potem nazwa (polska kolejność), koniec, `createdAt`, `id` | Lista czyta się jak doba i jest powtarzalna niezależnie od kolejności wejścia. | Wywiad |
| Zapis godzin | Minuty od północy (`smallint` 0–1439) w bazie, `HH:MM` w API i formularzu | Prosta arytmetyka dla S-05 bez typu `time` i strefy. | Plan |
| Długość zmiany | Dozwolone zmiany dłuższe niż 8 godzin | Ocenę limitu robi S-05 (decyzja D3), słownik nie blokuje. | Plan |
| Podgląd w formularzu | Czas trwania i "kończy się następnego dnia" na żywo | Łapie literówkę typu 14:00–08:00, którą przyjmuje reguła następnego dnia. | Plan |
| Współdzielenie z S-01 | `isUuid` i logowanie błędów w `src/lib/postgrest.ts` | Moduł zmian nie importuje z modułu pracowników; zachowanie pracowników bez zmian. | Plan |
| Weryfikacja CI i wdrożenia | Po jednym wierszu na końcu (Faza 4), nie jeden CI na fazę | Mniej powtórzeń; wiersze zależne od PR i wdrożenia i tak odhaczamy po scaleniu (osobny commit albo archiwizacja z nimi jako oczekującymi). | Plan |

## Scope

**In scope:** tabela `shifts` z RLS tylko dla planisty; walidacja i normalizacja; API tworzenia i edycji; lista, formularze i kafelek w panelu; testy reguł i rozszerzony smoke (baza, API, strony); dokumentacja.

**Out of scope:** usuwanie i archiwizowanie (FR-018); unikalność nazw; egzekwowanie ochrony zatwierdzonych grafików (S-03, S-08, S-11); ocena reguł i limitu 8 godzin (S-05); przerwy w zmianie; zmiana czasu letniego/zimowego (S-05); stronicowanie i wyszukiwanie.

## Architecture / Approach

Od środka na zewnątrz: czyste reguły w `src/lib/services/shift.ts`, tabela z RLS dowiedziona w smoke na tokenach czterech aktorów, funkcje dostępu `src/lib/shifts.ts` z dwiema trasami API, na końcu strony Astro i wyspa React z hookiem `useShiftForm`. Dane płyną: formularz → `validateShiftInput` → `fetch` JSON → trasa API (ta sama walidacja) → PostgREST na sesji planisty → RLS.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Reguły zmiany | Typy, godziny `HH:MM`, czas trwania przez północ, sortowanie, walidacja, testy | Komunikaty i przykłady północy wymagają akceptacji autora |
| 2. Tabela i RLS | Migracja `shifts`, polityki planisty, smoke przez PostgREST | Domyślne uprawnienia Supabase dla `anon`; ograniczenia `check` muszą odpowiadać regułom |
| 3. Dostęp do danych i API | Wspólny moduł, `src/lib/shifts.ts`, `POST`/`PUT` z kodami 201, 200, 400, 404, 415, 422 | Wydzielenie z `employees.ts` dotyka kodu S-01 |
| 4. Strony planisty | Lista, formularze z podglądem, kafelek, smoke stron, dokumentacja | Brak testów komponentów; weryfikacja ręczna w przeglądarce i na telefonie (pola czasu) |

**Prerequisites:** F-01 i S-01 zamknięte (są); lokalny Supabase i Docker do `npx supabase db reset` i smoke; dostęp autora do hostowanego projektu (`npx supabase db push`).
**Estimated effort:** około 4 krótkich sesji, po jednej na fazę; krócej niż S-01, bo wzorzec jest gotowy.

## Open Risks & Assumptions

- Nazwy mogą się powtarzać, a omyłkowo dodana lub nieaktualna zmiana zostaje w słowniku (brak usuwania): S-03 musi pokazywać godziny obok nazwy i znieść nieaktualne wpisy.
- Reguła "koniec ≤ początek to następny dzień" czyni literówkę (14:00–08:00) poprawną 18-godzinną zmianą nocną; ograniczeniem szkody jest podgląd czasu trwania i widoczny czas na liście.
- Ochrona zatwierdzonych grafików przed edycją słownika jest tylko zobowiązaniem dla S-03/S-08/S-11 (kopia przy zatwierdzeniu); S-02 jej nie dowodzi.
- W noc zmiany czasu faktyczny czas zmiany nocnej bywa o godzinę inny niż różnica zegarowa; uwzględnia to S-05.

## Success Criteria (Summary)

- Planista dodaje zmianę 22:00–06:00 i widzi ją na liście jako "22:00–06:00", "następnego dnia", "8 h", w kolejności chronologicznej; równe godziny dają błąd przy polu bez utraty danych.
- Pracownik, konto bez roli i anonim dostają 403 lub 401 na stronach i w API, a na tabeli widzą pustą listę lub odmowę; nikt nie usuwa wierszy.
- Bramka `astro sync`, lint, `astro check`, testy i build przechodzi, a smoke przechodzi lokalnie i w CI.
