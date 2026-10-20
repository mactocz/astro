# Rules verification harness — Plan Brief

> Full plan: `context/changes/rules-verification-harness/plan.md`

## What & Why

Dodajemy do Shiftly pierwszą automatyczną ścieżkę weryfikacji: runner testów, który uruchamia je w środowisku workerd (jak produkcja), oraz helper sprawdzający, że wynik funkcji jest powtarzalny i nie zależy od kolejności wejścia. To fundament F-02 z roadmapy i bezpośredni warunek dla S-05 (reguły czasu pracy na żywo): zabezpieczenie z PRD "te same dane, ten sam wynik" jest dziś niesprawdzalne, bo w repozytorium nie ma żadnych testów.

## Starting Point

Brak runnera (`AGENTS.md:24`: "No unit-test runner is configured"), skrypt `test` nie istnieje, a CI (`ci.yml`) ma lint, `astro check` i build. Jedyny test to bezzależnościowy `scripts/smoke.mjs` dla logowania. W projekcie jest już Vite 8.3.0, Node 22.14 w `.nvmrc` i produkcyjna konfiguracja runtime w `wrangler.jsonc`.

## Desired End State

`npm test` uruchamia testy w workerd lokalnie i w CI. W `src/lib/testing/` jest helper `expectDeterministic`, a przykładowe testy dowodzą, że wykrywa zależność od kolejności wejścia i niedeterminizm. Test sanity potwierdza, że kod naprawdę działa w workerd. Dokumenty dla agentów opisują nowe polecenie.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Środowisko testów | Vitest w workerd | Testy w tym samym runtime co produkcja (wybór autora zamiast Node). | Plan (pytanie) |
| Pakiet | `@cloudflare/vitest-plugin` 1.4.4 + `vitest` 5.0.5 | Stara pula jest przemianowana i nieaktualizowana, a plugin wspiera Vitest 5 i Vite 8. | Plan (npm) |
| Konfiguracja | Tylko opcja `miniflare`, bez `wrangler.jsonc` | `main` wskazuje wejście adaptera, a `assets` zależy od `dist/`; próba potwierdziła, że to działa. | Plan (próba) |
| Układ plików | Testy obok kodu w `src/lib/**/*.test.ts`, logika reguł w `src/lib/services/` | Zgodne z konwencją z `CLAUDE.md` i z jednym globem ograniczonym do `src/`. | Plan (pytanie) |
| Determinizm | Powtórzenia + niezależność od kolejności, warianty podaje wywołujący | Wykrywa ukryte zależności od kolejności; wymusza kanoniczną kolejność wskazań. | Plan (pytanie) |
| Przykładowy przypadek | Testy samego helpera na funkcjach zastępczych | Roadmapa zastrzega, że reguły dochodzą dopiero w S-05. | Roadmap |
| CI | Krok `npm test` w jobie `ci` po `astro check` | Najprostsze i zatrzymuje pipeline przed buildem. | Plan |

## Scope

**In scope:** runner i konfiguracja, skrypty `test` i `test:watch`, test sanity środowiska, helper determinizmu z testami, krok CI, aktualizacja `AGENTS.md` i `CLAUDE.md`.

**Out of scope:** same reguły czasu pracy i fixtures prawne (S-05), coverage, hook pre-commit, benchmarki CPU, aktualizacja `wrangler`, testy e2e i powiązań Cloudflare.

## Architecture / Approach

Vitest 5 z pluginem Cloudflare uruchamia pliki `src/**/*.test.ts` w workerd przy konfiguracji niezależnej od `wrangler.jsonc` (data zgodności i flaga `nodejs_compat` przepisane ręcznie), z aliasem `@/*`. Helper przyjmuje funkcję, wejście i opcjonalne warianty wejścia, wywołuje funkcję wielokrotnie i na wariantach, a wyniki porównuje głęboko, z uwzględnieniem kolejności.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Runner w workerd | Zależności, `vitest.config.ts`, skrypty, test sanity | Nowy `workerd` 1.20261012.1 wymaga zatwierdzenia w `allowScripts`; ciężka instalacja (własny wrangler i miniflare beta) |
| 2. Helper determinizmu | `expectDeterministic`, `seededShuffle` i testy dowodzące wykrywania | Kształt API ma wystarczyć dla S-05 bez przeróbek |
| 3. CI i dokumentacja | Krok CI, `AGENTS.md`, `CLAUDE.md`, pełna bramka | CI na innym Node niż lokalny (22.x vs 24) może wymagać poprawki |

**Prerequisites:** `npm ci` w katalogu, w którym uruchamiana jest implementacja (worktree nie ma `node_modules`); zgoda autora na wpis w `allowScripts`.
**Estimated effort:** 3 fazy, każda mieści się w jednej sesji agenta.

## Open Risks & Assumptions

- Plugin trzyma `miniflare` w wersji beta i własną kopię `wrangler`; aktualizacje mogą wymagać dopasowania wersji.
- Środowisko testowe nie egzekwuje limitu 10 ms CPU z planu Free; pomiar wydajności reguł pozostaje do zrobienia na wdrożeniu.
- Próba była na Node 24 lokalnie; CI używa Node 22.x (Vitest 5 wymaga `^22.12`), co potwierdzi dopiero przebieg CI.

## Success Criteria (Summary)

- `npm test` przechodzi lokalnie i w CI, a test sanity potwierdza uruchomienie w workerd.
- Helper wykrywa zarówno zależność od kolejności wejścia, jak i niedeterminizm (dowód w testach).
- Bramka `astro sync`, lint, `astro check`, testy i build przechodzi w kolejności CI.
