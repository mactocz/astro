# Podmiana SHA przed archiwizacją: workload-vs-norm

- **Data:** 2026-11-26
- **Cel integracji:** `origin/master` w repozytorium `mactocz/astro`, migawka `80ff402ce00cb3bf5e574595740ff295913148c4`
- **Commit integracji:** `5f240e7` "feat(workload-vs-norm): Suma godzin i porównanie z normą (p1)" (`5f240e76a2c264cf099493603ac830a621c3c159`), w historii `origin/master` przez scalenie PR #13 (`80ff402`)
- **PR:** https://github.com/mactocz/astro/pull/13 (scalony, baza `master`)
- **Dowód:** commit `99bc869` (`99bc86917856dd080d934738802133be43f8b7aa`) został przepisany rebase'em przy układaniu gałęzi S-06 na gałęzi S-05 przed otwarciem PR; ma ten sam temat i identyczny `patch-id` (0b0aded1dc2f3dd6379ece879f7d86c9145208b6) co `5f240e7`, czyli ten sam diff na innej bazie. Stary commit nie jest w historii `origin/master`, nowy jest.
- **Decyzja użytkownika:** "Zaktualizuj i archiwizuj" (2026-11-26), po przedstawieniu mapowania i ostrzeżeń (brak impl-review dla faz 1 i 2).

| Wiersz | Stary sufiks (rozwiązany OID) | Nowy SHA |
| --- | --- | --- |
| 1.1 | 99bc869 (`99bc86917856dd080d934738802133be43f8b7aa`) | 5f240e7 |
| 1.2 | 99bc869 (`99bc86917856dd080d934738802133be43f8b7aa`) | 5f240e7 |
| 1.3 | 99bc869 (`99bc86917856dd080d934738802133be43f8b7aa`) | 5f240e7 |
| 1.4 | 99bc869 (`99bc86917856dd080d934738802133be43f8b7aa`) | 5f240e7 |

Podmieniono 4 wiersze. To jest zapis pochodzenia, nie przegląd implementacji i nie pokrycie przeglądu.
