# Schedule generation — Plan Brief

> Full plan: `context/changes/schedule-generation/plan.md`

## What & Why

S-09: planista jednym kliknięciem dostaje propozycję grafiku, którą potem poprawia. To skraca ręczne układanie, nie tworząc grafiku, którego nie dałoby się zatwierdzić.

## Starting Point

Strona obsadzania ma ręczne przypisania, reguły czasu pracy liczone w przeglądarce, sumy godzin i zatwierdzanie. W bazie jest już miejsce na wpisy wygenerowane (`source = generated`).

## Desired End State

Przyciski „Wygeneruj” i „Usuń wygenerowane” na szkicu. Propozycja od razu się zapisuje, jest oznaczona w siatce i opisana komunikatem (dodano, brakuje, ponad normę, mimo wniosku). Wpisy ręczne nigdy się nie zmieniają.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Gdzie liczy generator | W przeglądarce; serwer tylko zapisuje | Zostajemy na planie Free z limitem 10 ms CPU. |
| Nie da się obsadzić bez krytycznego naruszenia | Zostaje brak | Propozycja nie dokłada nic, co blokuje zatwierdzenie. |
| Norma etatu | Przekraczana w ostateczności | Mniej braków; to tylko ostrzeżenie. |
| Niezatwierdzony wniosek | Tylko gdy brakuje ludzi, po nadgodzinach | Prośba pracownika jest szanowana przed decyzją. |
| Równe obciążenie | Najniższe wykorzystanie normy (%) | Uczciwe względem etatu i zgodne z kolumną „Godziny”. |
| Ponowne generowanie | Tylko dopełnia; osobne „Usuń wygenerowane” | Nic nie znika bez wyraźnego działania. |
| Zapis | Od razu, jednym zapytaniem | Jak dzisiejsze klikanie, bez stanu „niezapisane”. |
| Nieaktualna strona | Odmowa przez `basis` i listę przypisań | Mechanizm z przeglądu S-08. |
| Renderowanie strony na serwerze (p99) | Osobna zmiana po pomiarze | Dzisiejsze liczby nie wskazują winnej trasy. |

## Scope

**In scope:** czysty generator z testami, trasa `generated` (`POST`, `DELETE`), przyciski, oznaczenia, podsumowanie, smoke, dokumentacja, pomiar po wdrożeniu.

**Out of scope:** optymalność i przestawianie osób, podgląd przed zapisem, pamiętanie odrzuceń, preferencje, sąsiednie tygodnie, migracje, przenoszenie renderowania.

## Architecture / Approach

Wyspa: `generateSchedule` (te same reguły, oceniane dla jednej osoby; zachłannie w czterech przebiegach, bez losowości) → `POST /api/schedules/<id>/generated` → kontrola aktualności → jeden hurtowy zapis w Supabase pod istniejącymi politykami.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Generator | Czysta funkcja i testy | Czas liczenia i zbyt wiele braków |
| 2. Zapis | Trasa i smoke API | Atomowość i nieaktualne dane |
| 3. Interfejs i dokumentacja | Przyciski, oznaczenia, komunikaty | Kruche asercje smoke siatki |
| 4. Wdrożenie | Produkcja i pomiar | p99 ponad limit |

**Prerequisites:** S-05, S-07, F-02 (zrobione).
**Estimated effort:** około 3-4 sesje na 4 fazy.

## Open Risks & Assumptions

- Algorytm zachłanny może zostawić brak, który dałoby się zapełnić po przestawieniu osób.
- Osoba z istniejącym naruszeniem dobowym lub tygodniowym nie dostaje od generatora nic.
- Przyjęte ryzyko (przegląd planu, F1): od 1000 przypisań w jednym grafiku strona obsadzania przestaje się otwierać, a generator może do tego doprowadzić jednym kliknięciem; osiągalne przy około 100-200 osobach, naprawa tylko ręczna.
- Czas 3 s jest sprawdzany dla 30 osób i 100 komórek; znacznie większe grafiki liczą się dłużej.
- Serwer nie sprawdza reguł przy zapisie propozycji; błąd generatora zobaczy planista na liście wskazań, a zatwierdzenie i tak go zablokuje.
- p99 czasu CPU już dziś przekracza limit 10 ms; S-09 tego nie naprawia.
- Smoke nie uruchamia generatora w przeglądarce; jego działanie w interfejsie sprawdza się ręcznie.

## Success Criteria (Summary)

- Na typowym grafiku propozycja nie ma krytycznych naruszeń, nie zmienia wpisów ręcznych i wyrównuje obciążenie.
- Te same dane dają tę samą propozycję.
- Planista rozumie z komunikatu, czego generator nie obsadził.
