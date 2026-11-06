# Weekly schedule draft — Plan Brief

> Full plan: `context/changes/weekly-schedule-draft/plan.md`

## What & Why

Planista Shiftly tworzy szkic grafiku tygodniowego (dowolna data początkowa, opcjonalna etykieta, siatka zmiana × 7 dni z wymaganą liczbą osób, skład pracowników), znajduje go na liście `/schedules` i edytuje. To wycinek S-03 z roadmapy (FR-008, FR-009 bez generowania, FR-013, FR-019): fundament pod ręczne obsadzanie (S-04), reguły (S-05) i zatwierdzanie (S-08). To pierwszy zasób relacyjny w projekcie.

## Starting Point

S-01 (pracownicy) i S-02 (słownik zmian) dały pełny wzorzec: czyste reguły w `src/lib/services/`, tabele z RLS dowiedzione w smoke, warstwę danych, trasy JSON, strony z wyspą React. Bramka dostępu zamyka nowe trasy domyślnie. Brakuje wszystkiego, co dotyczy grafiku, a w repo nie ma jeszcze kluczy obcych, kolumn dat, funkcji RPC ani zapisu wielu wierszy naraz.

## Desired End State

Planista z `/planner` kafelkiem "Grafiki" wchodzi na listę (okres, etykieta, liczba pracowników, suma obsady, najnowszy pierwszy), tworzy i edytuje grafik formularzem z siatką zmiana × 7 dni (przewijaną poziomo) i wyborem pracowników (domyślnie wszyscy), widząc informację D6, że grafik tygodniowy nie zastępuje formalnego rozkładu czasu pracy. Zapis jest atomowy (całość albo nic), a pracownik, konto bez roli i anonim nie widzą niczego.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Data początkowa | Dowolna data, 7 dni od niej; szkice mogą się nakładać | Zgodne z PRD i art. 128 § 3, a S-12 i tak tworzy wiele wersji okresu. | Wywiad |
| Obsada | Siatka zmiana × 7 dni, 0 znaczy brak zmiany; zapisywane tylko komórki 1 do 99 | Dokładnie FR-019 w jednym widoku, bez osobnego wyboru zmian obowiązujących. | Wywiad |
| Pracownicy | Wszyscy zaznaczeni, planista odznacza | Zespół ma 10–30 osób; wykluczenie osoby, która odeszła (brak FR-015), jest jawne. | Wywiad |
| Zapis | Funkcja SQL przez RPC, jedna transakcja, `security invoker` | PostgREST zapisuje jedną tabelę na żądanie, a brak `delete` na nagłówku uniemożliwia kompensację. | Wywiad |
| Lista | Okres plus opcjonalna etykieta (do 60 znaków) | Odróżnia nakładające się szkice i przyszłe wersje; autor wybrał to zamiast samego okresu. | Wywiad |
| Układ siatki | Bez zmiany `PlannerLayout`, przewijanie poziome z przyklejoną kolumną | NFR o telefonie dotyczy widoku pracownika; poszerzenie layoutu zrobi S-04, gdy będzie potrzebne. | Wywiad |
| Wspólne części | Wydzielanie odłożone, dług zapisany | Formularz jest strukturalnie inny, a równoległe S-10 zmienia kod pracowników i smoke. | Wywiad |
| Edycja szkicu | Pełna: data, siatka, skład; `delete` tylko na tabelach podrzędnych | Jedno zachowanie dla tworzenia i edycji; nagłówek nigdy nie jest usuwany. | Wywiad |
| Model obsady | `day_offset` 0 do 6 zamiast daty bezwzględnej | Zmiana daty nie przepisuje obsady, a ograniczenie `check` działa bez zapytań między tabelami. | Plan |
| Zmiana nocna | Obsada liczy się do dnia startu zmiany | Para zmiana i dzień startu jest jednoznaczna; granicę tygodnia ocenia S-05. | Plan |
| Zmiana w słowniku | Szkic czyta słownik na żywo | Zgodne z modelem S-02: kopię robi S-08 przy zatwierdzeniu. | Plan |

## Scope

**In scope:** trzy tabele z RLS tylko dla planisty i funkcja `save_schedule`; walidacja i normalizacja; API tworzenia i edycji; lista, formularz z siatką i wyborem pracowników, kafelek w panelu, informacja D6; testy reguł i rozszerzony smoke (baza, RPC, API, strony); dokumentacja.

**Out of scope:** usuwanie grafików (FR-018); status, zatwierdzanie, wersje (S-08, S-12); obsadzanie pracownikami (S-04); reguły i braki obsady (S-05); generowanie (S-09); zamrażanie danych w szkicu; poszerzony layout i widok mobilny z kartami; wydzielanie wspólnego kodu.

## Architecture / Approach

Od środka na zewnątrz: czyste reguły w `src/lib/services/schedule.ts` (daty jako `YYYY-MM-DD` z arytmetyką UTC, walidacja, sortowanie), tabele z RLS i funkcja `save_schedule` dowiedzione w smoke na tokenach czterech aktorów, `src/lib/schedules.ts` z dwiema trasami API, na końcu strony Astro i wyspa React z hookiem `useScheduleForm`. Dane płyną: formularz → `validateScheduleInput` → `fetch` JSON → trasa API (ta sama walidacja) → RPC na sesji planisty → RLS.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Reguły grafiku | Typy, daty i dni od dnia startu, walidacja, sortowanie, testy deterministyczne | Komunikaty i format okresu wymagają akceptacji autora |
| 2. Tabele, RLS i funkcja zapisu | Migracja trzech tabel i `save_schedule`, smoke przez PostgREST i RPC | Pierwsza funkcja SQL, klucze obce i domyślny `execute` dla `PUBLIC` |
| 3. Dostęp do danych i API | `schedules.ts`, `POST` i `PUT` z kodami 201, 200, 400, 404, 415, 422, smoke API | Mapowanie błędów bazy (`PT404`, `23503`) na odpowiedzi |
| 4. Strony planisty | Lista, formularz z siatką i wyborem, kafelek, D6, smoke stron, dokumentacja | Brak testów komponentów; siatka na telefonie sprawdzana ręcznie |

**Prerequisites:** F-01, S-01, S-02 zamknięte (są); lokalny Supabase i Docker do `npx supabase db reset` i smoke; dostęp autora do hostowanego projektu (`npx supabase db push`).
**Estimated effort:** około 4 do 5 sesji, po jednej na fazę; dłużej niż S-02 przez pierwszą relację i funkcję SQL.

## Open Risks & Assumptions

- Zmiana lub pracownik, który odszedł, zostaje na listach wyboru (brak FR-015 i usuwania); w edycji takie wpisy są pokazane jako "(niedostępne)", a nie gubione po cichu.
- Obsada zapisywana rzadko oznacza, że zmiana dodana do siatki, ale z samymi zerami, znika po zapisie; to świadome uproszczenie.
- Podział pracy z S-10: wspólne pliki (`smoke.mjs`, `types.ts`, dokumentacja, kolejność migracji) wymagają rebase przy drugim scaleniu.
- Dług: wydzielenie wspólnego hooka formularza, tras API i kroków RLS w smoke (zapowiedziane w review S-02) czeka na po S-10.
- Treść informacji D6 wymaga akceptacji autora; narzędzie ostrzega, nie certyfikuje zgodności z prawem.

## Success Criteria (Summary)

- Planista tworzy grafik od środy z siatką 2 zmiany × 7 dni i 2 pracownikami, widzi go na liście z okresem `11.11–17.11.2026`, edytuje datę, siatkę i skład, a zapis niepoprawnego payloadu nie zostawia niczego w bazie.
- Pracownik, konto bez roli i anonim dostają 403 lub 401 na stronach i w API, a przez PostgREST widzą pustą listę lub odmowę; nikt nie usuwa grafików.
- Bramka `astro sync`, lint, `astro check`, testy i build przechodzi, a smoke przechodzi lokalnie i w CI.
