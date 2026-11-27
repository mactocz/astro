# Do poprawy: strona obsadzania na telefonie

Zgłoszone przez autora przy weryfikacji ręcznej 4.4 (2026-11-27): widok mobilny grafiku i tabeli "Obsada zmian" jest
mało czytelny, bo trzeba przewijać w poziomie.

- Dotyczy `/schedules/<id>/assign`, szkicu i zatwierdzonego grafiku (`src/components/schedules/AssignmentGrid.tsx`:
  tabela osób ma `min-w-[68rem]`, tabela obsady `min-w-[44rem]`; przewija się kontener, nie cała strona).
- Układ pochodzi z S-04 i nie jest zmieniany w S-08; 4.4 zostało zatwierdzone z tą uwagą.
- Kierunek do rozważenia: poniżej `md` układ dzień po dniu (karty) zamiast siedmiu kolumn. Smoke porównuje wiersze i
  komórki tych tabel, więc drugi układ trzeba zaplanować razem z krokami smoke.
- Uwaga dla S-11: widok pracownika na telefonie (FR-014) nie powinien powielać tej siatki.
