# Employee roster — Plan Brief

> Full plan: `context/changes/employee-roster/plan.md`

## What & Why

Planista Shiftly dodaje pracowników (imię, nazwisko, opcjonalny e-mail, etat jako ułamek) i edytuje ich dane na liście `/employees`. To wycinek S-01 z roadmapy (FR-001, FR-003): pracownik istnieje bez konta, a lista jest podstawą dla zmian, grafików i reguł czasu pracy. To pierwsza tabela z danymi osobowymi, więc ustawia wzorzec modelu danych, RLS i dostępu do danych dla kolejnych wycinków.

## Starting Point

F-01 dał bramkę dostępu (`decideAccess`, domyślna odmowa, role w `app_metadata`) i funkcje `is_planner()` z wzorcem RLS, ale nie ma żadnej tabeli domenowej, `zod`, hooków ani udostępnionego klienta Supabase. `/planner` to placeholder, a smoke zakłada, że `/employees` daje planiście 404.

## Desired End State

Planista przechodzi z `/dashboard` przez panel `/planner` do listy pracowników posortowanej po nazwisku (polska kolejność liter), dodaje i edytuje pracowników formularzem z błędami przy polach. Pracownik, konto bez roli i anonim nie widzą danych (RLS w bazie, bramka w aplikacji), a nikt nie usuwa wierszy przez API.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Imię i nazwisko | Dwa wymagane pola, lista po nazwisku, potem imieniu | Planista sortuje po nazwisku, a widok telefonu może skracać imię bez zgadywania. | Wywiad |
| E-mail | Opcjonalny, małe litery, unikalny | Zgodne z FR-001 (konto opcjonalne) i chroni zaproszenia w S-10 przed duplikatem. | Wywiad |
| Etat | Ułamek licznik/mianownik, `1 ≤ licznik ≤ mianownik ≤ 100`, zapis nieskracalny | Norma w S-06 liczy się dokładnie (1/3 etatu bez błędu zaokrąglenia procentu). | Wywiad |
| Nawigacja | `/planner` jako panel z kafelkiem "Pracownicy", wspólny układ stron planisty | Realizuje zapowiedź F-01 i daje S-02 i S-03 miejsce na kolejne kafelki. | Wywiad |
| Dostęp do tras | Bez zmian w `OPEN_PATHS` (domyślna odmowa), nowe ścieżki dopisane do testów | Nowa trasa jest zamknięta, dopóki ktoś jej nie otworzy świadomie. | Plan |
| Klient Supabase | Jeden na żądanie w `Astro.locals.supabase`, sesja użytkownika | Drugi klient odświeżałby token podwójnie, a RLS wymaga sesji użytkownika, nie service-role. | Plan |
| Zapis formularza | `fetch` JSON do `POST /api/employees` i `PUT /api/employees/[id]`; tylko `application/json` (415) | Przekierowanie z `?error=` gubiłoby dane i wystawiało dane osobowe w adresie. | Plan |
| Walidacja | Jedna funkcja `validateEmployeeInput` (zod) po stronie klienta i serwera, baza powtarza granice w `check` | Te same reguły i komunikaty wszędzie; wiersz z pominięciem aplikacji też je spełnia. | Plan |
| Usuwanie i konta | Brak usuwania (uprawnienie `delete` odebrane), brak `user_id` | Żaden FR nie przewiduje usuwania pracowników; powiązanie z kontem to S-10. | PRD |
| Sortowanie | `Intl.Collator("pl")`, remis: `createdAt`, potem `id` | Sprawdzone w workerd; kolejność powtarzalna i niezależna od wejścia. | Plan |

## Scope

**In scope:** tabela `employees` z RLS tylko dla planisty; walidacja i normalizacja; API tworzenia i edycji; panel, lista, formularze dodawania i edycji; testy jednostkowe reguł i rozszerzony smoke (baza, API, strony); dokumentacja.

**Out of scope:** konta, zaproszenia i `user_id` (S-10); polityka "własny wiersz" pracownika (S-11); usuwanie i blokowanie (FR-015 zaparkowane); historia etatu; norma godzin (S-06); stronicowanie, wyszukiwanie, import; zmiana `lang` w `Layout`.

## Architecture / Approach

Od środka na zewnątrz: czyste reguły w `src/lib/services/employee.ts` (walidacja, etat, sortowanie), tabela z RLS dowiedziona w smoke na tokenach czterech aktorów, funkcje dostępu `src/lib/employees.ts` z dwiema trasami API, na końcu strony Astro i wyspa React z hookiem `useEmployeeForm`. Dane płyną: formularz → `validateEmployeeInput` → `fetch` JSON → trasa API (ta sama walidacja) → PostgREST na sesji planisty → RLS.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Reguły pracownika | Typy, zod, walidacja, etat, sortowanie, testy | Granice etatu i komunikaty wymagają akceptacji autora |
| 2. Tabela i RLS | Migracja `employees`, polityki planisty, smoke przez PostgREST | Domyślne uprawnienia Supabase dla `anon`; migracja na hostowanym projekcie przed kodem |
| 3. Dostęp do danych i API | `locals.supabase`, `src/lib/employees.ts`, `POST`/`PUT` z kodami 201, 200, 404, 409, 415, 422 | Zmiana middleware dotyka wszystkich żądań |
| 4. Strony planisty | Układ, panel, lista, formularze, dokumentacja, smoke stron | Brak testów komponentów; weryfikacja ręczna w przeglądarce i na telefonie |

**Prerequisites:** F-01 zamknięte (jest); lokalny Supabase i Docker do `npx supabase db reset` i smoke; dostęp autora do hostowanego projektu (`npx supabase db push`).
**Estimated effort:** około 4 sesji, po jednej na fazę; Faza 4 największa.

## Open Risks & Assumptions

- Omyłkowo dodany pracownik zostaje na liście (brak usuwania i blokowania); autor usuwa go ręcznie w panelu Supabase. Rośnie to z każdym wycinkiem, który odwoła się do pracowników kluczem obcym.
- Edycja etatu nie ma historii: S-06 i S-08 muszą zapisać normę lub wskazania w chwili zatwierdzenia grafiku, inaczej edycja zmieniłaby zatwierdzone grafiki wstecz.
- Brak testów jednostkowych hooka i komponentów (nie ma biblioteki do ich testowania); ryzyko ograniczone przez cienką logikę hooka i ręczny przegląd w Fazie 4.
- Statusy PostgREST dla odmów (200 z pustą listą albo 4xx) mogą różnić się od oczekiwań, dlatego smoke dowodzi skutku (wiersz niezmieniony), a nie konkretnego kodu.

## Success Criteria (Summary)

- Planista dodaje i edytuje pracownika z etatem 2/4 (zapisanym jako 1/2) i widzi go na liście w polskiej kolejności; zajęty e-mail w innej wielkości liter daje błąd przy polu bez utraty danych.
- Pracownik, konto bez roli i anonim dostają 403 lub 401 na stronach i w API, a na tabeli widzą pustą listę lub odmowę; nikt nie usuwa wierszy.
- Bramka `astro sync`, lint, `astro check`, testy i build przechodzi, a smoke przechodzi lokalnie i w CI.
