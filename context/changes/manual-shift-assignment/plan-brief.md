# Manual shift assignment — Plan Brief

> Full plan: `context/changes/manual-shift-assignment/plan.md`

## What & Why

Planista Shiftly ręcznie przypisuje pracowników do zmian w szkicu grafiku tygodniowego z S-03 i poprawia te wpisy (wycinek S-04 z roadmapy, FR-011 w części ręcznej, US-01). Każde przypisanie ma znacznik pochodzenia (`source`), żeby późniejsze generowanie (S-09) nie nadpisało wpisów ręcznych. To fundament pod reguły na żywo (S-05), godziny (S-06) i zatwierdzanie (S-08), które czytają przypisania.

## Starting Point

S-03 dało szkic grafiku: nagłówek, obsadę (liczba osób na zmianę i dzień) i skład pracowników. Zapis grafiku (`save_schedule`) przy każdej edycji usuwa i wstawia obsadę oraz skład od nowa, więc przypisania z kluczami obcymi znikałyby przy każdym zapisie, nawet po zmianie samej etykiety. W repo nie ma jeszcze zapisu różnicowego, złożonych kluczy obcych ani kolumny pochodzenia wpisu.

## Desired End State

Z listy grafików planista wchodzi w widok "Obsadź": tabela pracownicy × dni, w komórce przyciski zmian z obsadą tego dnia; kliknięcie dodaje albo zdejmuje przypisanie od razu. Pod tabelą widać "x z y" dla każdej zmiany i dnia, jako informację. Edycja grafiku nie gubi przypisań, a usunięcie komórki lub osoby, która je ma, wymaga jawnego potwierdzenia z liczbą wpisów.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Widok | Osobna strona, pracownicy × dni, podsumowanie zmiana × dzień | Klasyczny grafik; wskazania S-05 i godziny S-06 mają miejsce w wierszu i dniu osoby. | Wywiad |
| Usunięcie komórki lub osoby z przypisaniami | Kaskada po potwierdzeniu w formularzu S-03 | Jeden ruch bez wędrowania między widokami; potwierdzenie wymusza baza (`PT409` z liczbą). | Wywiad |
| Zapis grafiku | Różnicowy, szósty parametr `p_confirm_removals` | Zachowuje przypisania przy zmianie etykiety, daty i liczby osób; chroni też przed nieaktualnym widokiem. | Plan |
| Integralność | Złożone klucze obce do obsady i składu | Baza gwarantuje, że przypisanie wskazuje istniejącą komórkę i osobę ze składu. | Plan |
| Wpis ręczny | Kolumna `source` z CHECK (`manual`, `generated`) | Rozpoznawalność od pierwszej migracji, bez backfillu w S-09. | Wywiad |
| Nadmiar obsady | Dozwolony, z licznikiem x z y | PRD definiuje tylko brak kadrowy, a ten należy do S-05. | Wywiad |
| Kilka zmian jednego dnia | Dozwolone, ocenia S-05 | PRD milczy; podzielony dzień pozostaje możliwy. | Wywiad |
| Zapis przypisań | Jedno żądanie na dodanie lub zdjęcie, zwykły insert i delete z RLS | Brak niezapisanego stanu i brak drugiej funkcji RPC; operacje idempotentne. | Wywiad |
| Zmiana daty grafiku z przypisaniami | Dozwolona z nieblokującą informacją | Zgodne z S-03 (wpis trzyma `day_offset`), planista wie, co się przesuwa. | Wywiad |
| Poprawianie wpisu | Zdjęcie i dodanie | Wpis ma tożsamość w kluczu; zamiana i przenoszenie to wygoda poza zakresem. | Plan |

## Scope

**In scope:** tabela `schedule_assignments` z RLS tylko dla planisty; różnicowy `save_schedule` z potwierdzeniem usunięcia; polityka i grant `update (required_count)` dla obsady; reguły i testy; trasy `POST` i `DELETE` przypisań, `PUT` grafiku z potwierdzeniem; zmiany w formularzu grafiku; strona `/schedules/<id>/assign` i szeroki wariant `PlannerLayout`; odnośniki; smoke (baza, RPC, API, strony); dokumentacja.

**Out of scope:** reguły, braki i kolizje (S-05); godziny (S-06); nieobecności (S-07); zatwierdzanie i zamrażanie (S-08); generowanie i zmiana `source` (S-09); zamiana osoby, przenoszenie, kopiowanie tygodnia; usuwanie grafików; wykrywanie równoległych edycji; widok planisty na telefonie; testy komponentów.

## Architecture / Approach

Od środka na zewnątrz: czyste reguły w `src/lib/services/assignment.ts`, migracja z tabelą i nową `save_schedule` dowiedziona w smoke na tokenach czterech aktorów, moduł `src/lib/assignments.ts` z trasami `/api/schedules/<id>/assignments`, zmiany w `useScheduleForm`, na końcu strona z wyspą `AssignmentGrid`. Przypisania czyta osobne zapytanie (złożone klucze obce nie dają bezpośredniej relacji z `schedules`), a odczyt dobijający do limitu 1000 wierszy kończy się błędem, nie obcięciem.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Reguły przypisań | Typy, walidacja, grupowanie, podsumowanie obsady, testy deterministyczne | Komunikaty i reguły liczenia wymagają akceptacji autora |
| 2. Baza | Tabela, klucze z kaskadą, RLS, nowa `save_schedule`, smoke bazy | Zmiana sygnatury funkcji z S-03 i kolejność wdrożenia (`db push`, od razu deploy) |
| 3. Dane i API | Moduł przypisań, `POST` i `DELETE`, 409 w `PUT`, smoke API | Mapowanie `PT409` z liczbą i współistnienie tras `[id].ts` i `[id]/` |
| 4. Formularz grafiku | Blok potwierdzenia usunięcia, informacja o zmianie daty | Stan klienta nietestowany w smoke, tylko przeglądarką |
| 5. Widok obsadzania | Strona pracownicy × dni, liczniki, szeroki układ, odnośniki, dokumentacja | Tabela z wieloma przyciskami; płynność i telefon sprawdzane ręcznie |

**Prerequisites:** S-03 i S-10 w bazie gałęzi (S-03 scalone do `master`, S-10 na `59f3bef` z PR #7 czekającym na scalenie); lokalny Supabase i Docker (`npx supabase db reset`, smoke); dostęp autora do hostowanego projektu (`npx supabase db push`).
**Estimated effort:** około 5 sesji, po jednej na fazę; więcej niż S-03 przez przepisanie funkcji zapisu i dwuetapowe potwierdzenie.

## Open Risks & Assumptions

- Zmiana sygnatury `save_schedule` oznacza krótkie okno między `db push` a wdrożeniem, w którym zapis grafiku ze starej wersji aplikacji zawodzi; wdrożyć od razu po `db push`.
- Kaskada po potwierdzeniu jest nieodwracalna; baza wymusza potwierdzenie, ale decyzję podejmuje planista. Zabezpieczenie PRD dotyczy automatycznego generowania, nie jawnego usunięcia przez planistę.
- Zmiana daty grafiku przesuwa kalendarzowe daty przypisań (wpis trzyma `day_offset`); S-05 i S-07 liczą po datach, więc muszą czytać datę z nagłówka.
- Konflikty ze S-10 w `scripts/smoke.mjs`, `src/types.ts` i dokumentacji są przewidywalne; punkty wstawiania wskazuje plan, a migrację tworzy się poleceniem `supabase migration new`, żeby jej znacznik był późniejszy niż migracje S-10.
- Brak testów komponentów: widok, blok potwierdzenia i informacja o dacie opierają się na przeglądzie w przeglądarce.

## Success Criteria (Summary)

- Planista przypisuje i zdejmuje pracowników w widoku "Obsadź" (w tym dwie zmiany jednej osoby w dniu), widzi "x z y" z brakiem i nadmiarem, a stan zostaje po odświeżeniu.
- Edycja etykiety, daty i liczby osób zachowuje przypisania; usunięcie komórki lub osoby z przypisaniami pokazuje liczbę i usuwa je dopiero po potwierdzeniu; baza odrzuca przypisanie spoza obsady lub składu.
- Pracownik, konto bez roli i anonim dostają 403 lub 401 na stronie i w API, a przez PostgREST widzą pustą listę lub odmowę; bramka (`astro sync`, lint, `astro check`, testy, build) i smoke przechodzą lokalnie i w CI.
