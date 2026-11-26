# Absence entry — Plan Brief

> Full plan: `context/changes/absence-entry/plan.md`

## What & Why

Planista Shiftly wpisuje nieobecności pracowników (urlop, L4, inna), a silnik reguł z S-05 wskazuje kolizję grafiku z nieobecnością: krytyczne naruszenie dla zatwierdzonej, ostrzeżenie dla jeszcze niezatwierdzonej (wycinek S-07 z roadmapy, FR-004, US-01). Zatwierdzone nieobecności obniżają też normę tygodniową (art. 130 § 3), więc ostrzeżenie `weekly_norm` i kolumna "Godziny" z S-06 czytają te same dane. To model, na którym oprą się S-13 do S-15, i dane wejściowe dla weryfikacji przy zatwierdzaniu (S-08), implementowanego po tej zmianie.

## Starting Point

W repozytorium nie ma żadnych danych o nieobecnościach. Silnik ma wejście bez nieobecności i reguły oparte na osi czasu zmian w minutach; norma tygodniowa liczy tylko święta; strona obsadzania ładuje zmiany, pracowników i przypisania i przekazuje je wyspie, która liczy reguły i godziny w Workerze (mediana CPU 4,8 ms przy limicie 10 ms). Wzorce do skopiowania są gotowe (słownik zmian: tabela z RLS dla planisty, moduł danych, trasy, strony z formularzem), ale smoke ma kruche pomocniki strony obsadzania (stała liczba komórek w wierszu, przypięte zdanie o nieobecnościach w "Godzinach", jedna tabela przed obsadą).

## Desired End State

Planista ma stronę `/absences` (lista, nowy wpis, edycja, usuwanie) z kartą w panelu. W obsadzaniu komórka dnia objętego nieobecnością ma tekst "Nieobecność: urlop"; przypisanie nakładające się na zatwierdzoną nieobecność daje krytyczne wskazanie `absence`, na niezatwierdzoną ostrzeżenie `absence_requested` (odrzucona jest ignorowana). Norma w ostrzeżeniu i w "Godzinach" jest pomniejszona o 8 h × etat za każdy dzień zatwierdzonej nieobecności od poniedziałku do piątku niebędący świętem.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Kolejność względem S-08 | S-07 pierwszy, S-08 po nim | Zatwierdzanie obejmuje nieobecności od pierwszego zatwierdzenia i kontrakt silnika jest ustalony przed nim. | Wywiad |
| Granularność | Całe dni (daty włącznie), godziny później | L4 i urlop zapisuje się w dniach, a reguła liczy na osi minut, więc godziny dojdą bez zmiany reguły. | Wywiad |
| Status i reguły | Kolumna `status` i dwie reguły (`absence`, `absence_requested`) od razu | Klucz wskazania nie zmienia się, gdy S-15 zamieni wniosek w zatwierdzoną nieobecność (S-08 potwierdza po kluczu). | Wywiad |
| Noc a nieobecność | Każde nałożenie zmiany na dni nieobecności | Nie pomija nocy, która wchodzi w pierwszy dzień nieobecności. | Wywiad |
| Norma | Korekta teraz, jedną regułą dla `weekly_norm` i "Godzin" (decyzja D7) | Bez niej osoba na urlopie wygląda na niedociążoną dokładnie tam, gdzie nieobecność istnieje. | Wywiad |
| Obsada | Bez zmian | Kolizja jest zgłaszana raz, a zmiana obsady dotknęłaby kod i smoke z S-04. | Wywiad |
| Zakres interfejsu | CRUD `/absences`, karta w panelu, znacznik w komórce | Wpis, poprawka i usunięcie pomyłki oraz kolizja widoczna tam, gdzie planista pracuje. | Wywiad |
| Zasady wpisu | Liberalne: nakładanie, daty wstecz, bez maksymalnej długości | L4 w trakcie urlopu i zaległe zwolnienia są zwykłe; silnik bierze najsilniejszą nieobecność. | Wywiad |
| Zapis statusu | Sesja zapisuje tylko `approved`; `requested` wstawia konto serwisowe w smoke | Precedens `schedule_assignments.source`; zapis `requested` dopiero w S-14. | Plan |
| Granice dat | 2020-2099 jak grafiki | Wartość spoza zakresu wyłączyłaby kontrolę reguł dla każdego grafiku (`RangeError`). | Plan |

## Scope

**In scope:** czyste funkcje (walidacja, daty, korekta normy), dwie reguły w silniku, `weekly_norm` i "Godziny" z nieobecnościami, migracja `absences` z RLS tylko dla planisty, moduł danych, trasy i strony CRUD, karta w panelu, wczytanie nieobecności na stronie obsadzania, znaczniki w komórkach, smoke (baza, trasy, strony, scenariusze), dokumentacja, wdrożenie z pomiarem CPU.

**Out of scope:** widok i zgłoszenia pracownika (S-13, S-11), wnioski urlopowe i ich akceptacja (S-14, S-15), godziny, pole tekstowe i dane zdrowotne, blokowanie nakładania, zmiana obsady, zmiany `access.ts`, zatwierdzanie (S-08), sekcja na stronie pracownika, testy komponentów.

## Architecture / Approach

Od środka na zewnątrz: czyste funkcje i silnik dowiedzione testami (Fazy 1 i 2), migracja i moduł danych z dowodem na tokenach czterech aktorów (Faza 3), CRUD planisty (Faza 4), wczytanie i znaczniki w obsadzaniu ze smoke scenariuszy (Faza 5), dokumentacja i wdrożenie z `db push` przed kodem (Faza 6). Ładowanie i mapowanie nieobecności leży w `src/lib/absences.ts` i `absence.ts`, żeby trasa zatwierdzania S-08 użyła ich bez kopiowania.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Nieobecność jako dane i norma | Typy, walidacja, daty, korekta normy jako czyste funkcje | Interpretacja art. 130 § 3 (D7) wymaga akceptacji autora |
| 2. Reguły w silniku | `absence`, `absence_requested`, `weekly_norm` i "Godziny" z nieobecnościami | Klucze, rangi i noc na granicy nieobecności; zmienione testy S-05 |
| 3. Baza i moduł danych | Migracja, RLS, granty, `absences.ts`, smoke bazy | Granty kolumnowe i dowód RLS (nie pusta tabela) |
| 4. API i strony planisty | Trasy, `/absences`, formularz, usuwanie, karta | Kruche kroki smoke dla `/planner` i dostępu |
| 5. Obsadzanie z nieobecnościami | Wczytanie, wyspa, znaczniki, scenariusze smoke | Kruche pomocniki strony obsadzania i przypięty `HOURS_NOTE` |
| 6. Dokumentacja i wdrożenie | Dokumentacja, `db push`, wdrożenie, pomiar CPU | CPU renderu z nieobecnościami (limit 10 ms) |

**Prerequisites:** S-05 i S-06 w `master` (zrobione); lokalny Supabase i Docker; dostęp autora do hostowanego projektu (`npx supabase db push`).
**Estimated effort:** około 6 sesji, po jednej na fazę.

## Open Risks & Assumptions

- Korekta normy to interpretacja prawna (8 h na dzień roboczy), zapisana jako D7; narzędzie ostrzega i nie gwarantuje zgodności z prawem.
- `db push` musi poprzedzić wdrożenie kodu strony obsadzania; bez tabeli zapytanie o nieobecności zawiedzie.
- Smoke ma kruche pomocniki (liczba komórek w wierszu, jedna tabela przed obsadą, dokładny tekst "Godzin"); plan wskazuje, czego nie dotykać.
- CPU renderu z nieobecnościami nie jest zmierzony; mediana po S-05 to 4,8 ms bez p99 i bez zimnego izolatu.
- Konflikty z S-08 w `types.ts`, `rules.ts`, `assign.astro`, `AssignmentGrid.tsx`, smoke i dokumentacji są przewidywalne; S-08 startuje po scaleniu tej zmiany.
- Brak testów komponentów: widok i usuwanie opierają się na przeglądzie w przeglądarce.

## Success Criteria (Summary)

- Planista wpisuje, poprawia i usuwa nieobecności, a przypisanie w dniu zatwierdzonej nieobecności daje krytyczne wskazanie z powodem i znacznikiem, na niezatwierdzoną ostrzeżenie, od razu po kliknięciu i po usunięciu nieobecności.
- Norma w ostrzeżeniu i w "Godzinach" jest ta sama i pomniejszona o dni zatwierdzonej nieobecności; granice, noce i klucze są dowiedzione testami co do minuty.
- Bramka, smoke i CI przechodzą, a po wdrożeniu (z `db push` przed kodem) pomiar CPU strony obsadzania mieści się w limicie.
