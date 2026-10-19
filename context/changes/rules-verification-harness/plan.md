# Rules verification harness Implementation Plan

## Overview

Dodajemy do Shiftly pierwszą automatyczną ścieżkę weryfikacji (fundament F-02 z roadmapy): runner testów jednostkowych uruchamiany lokalnie i w CI, który wykonuje testy w środowisku workerd (jak produkcja), oraz mały helper sprawdzający, że wynik funkcji jest powtarzalny i nie zależy od kolejności wejścia. To warunek bezpośredni dla S-05 (reguły czasu pracy na żywo) i S-09 (generator): zabezpieczenie z PRD "te same dane wejściowe dają ten sam wynik" jest dziś niesprawdzalne, bo w repozytorium nie ma żadnych testów. Same reguły czasu pracy nie są częścią tej zmiany.

## Current State Analysis

- Brak runnera testów: `AGENTS.md:24` mówi "No unit-test runner is configured", a `package.json:5-14` nie ma skryptu `test`. Jedyny test to bezzależnościowy `scripts/smoke.mjs`.
- CI (`.github/workflows/ci.yml:10-25`), job `ci`: `npm ci`, `astro sync`, `lint`, `astro check`, `build`. Nie ma kroku testów.
- `tsconfig.json:3` obejmuje `**/*`, a ESLint działa w trybie type-checked (`eslint.config.js:17-22`), więc każdy nowy plik TypeScript jest sprawdzany przez `astro check` i lint. `astro/tsconfigs/base` ustawia `skipLibCheck: true`.
- W projekcie jest Vite 8.3.0 (z Astro 7), `.nvmrc` to Node 22.14.0, a `wrangler.jsonc:5-6` ustala produkcyjną konfigurację runtime (`compatibility_date` 2026-05-08, flaga `nodejs_compat`).
- `package.json:73-77` (`allowScripts`) zatwierdza skrypty instalacyjne tylko dla `esbuild@0.28.2`, `esbuild@0.28.1` i `workerd@1.20260911.1`; `AGENTS.md:11` wymaga zatwierdzenia każdego nowego pakietu ze skryptami.
- W `src/lib/` są tylko `supabase.ts`, `utils.ts` i `config-status.ts`. `CLAUDE.md:42` każe trzymać logikę biznesową w `src/lib/services/`.
- W głównym katalogu leży lokalny, nieśledzony `.claude/skills/10x-plan/scripts/metadata-guard.test.mjs`, który domyślny glob Vitest by zebrał.

## Desired End State

- `npm test` uruchamia Vitest 5 w workerd (przez `@cloudflare/vitest-plugin`) na plikach `src/**/*.test.ts` i przechodzi lokalnie oraz w CI.
- W `src/lib/testing/` są `expectDeterministic` i `seededShuffle`, a przykładowe testy dowodzą, że helper wykrywa zależność od kolejności wejścia i niedeterminizm.
- Test sanity potwierdza, że testy faktycznie działają w workerd i że alias `@/*` oraz istniejący moduł projektu (`@/lib/utils`) importują się poprawnie.
- Job `ci` wykonuje `npm test` między `astro check` a `build`; `AGENTS.md` i `CLAUDE.md` opisują nowe polecenie.
- Weryfikacja: `npx astro sync && npm run lint && npx astro check && npm test && npm run build` przechodzi lokalnie, a przebieg CI na pull requeście jest zielony.

### Key Discoveries:

- Aktualny pakiet to `@cloudflare/vitest-plugin` 1.4.4 (peer `vitest ^4.1.0 || ^5.0.0`); stara `@cloudflare/vitest-pool-workers` jest oznaczona w npm jako przemianowana i nieaktualizowana (wersja 0.23.0 wymaga Vitest ^4.1, więc nie pasuje do Vitest 5.0.5).
- Próba w izolowanym katalogu (vitest 5.0.5 + plugin 1.4.4, Vite 8.3.4, Node 24): konfiguracja **tylko z opcją `miniflare`** (`compatibilityDate`, `compatibilityFlags`) działa bez pliku wrangler; test potwierdził `navigator.userAgent === "Cloudflare-Workers"`, alias `@/*` przez `resolve.alias` działa, a `include: ["src/**/*.test.ts"]` pomija plik poza `src/`. Czas uruchomienia ok. 1,2 s (przy pierwszym starcie workerd ok. 4 s).
- Wskazanie `wrangler.configPath` na nasz `wrangler.jsonc` jest złym wyborem: `main` odsyła do `@astrojs/cloudflare/entrypoints/server`, a plugin próbuje analizować to wejście (ostrzeżenie `[vpw:warn] Failed to statically analyze the exports of the main Worker entry-point`); `assets.directory` to `./dist`, którego w CI przed buildem nie ma.
- Typowanie jest czyste przy `skipLibCheck: true` (jak w bazie Astro); bez niego `tsc` zgłasza błędy w `.d.ts` miniflare.
- Plugin dociąga własne `wrangler` 4.151.1, `miniflare` 5.20261012.1-beta i **nowy `workerd` 1.20261012.1** (w próbie 236 MB `node_modules`), który nie jest objęty `allowScripts`; `npm install` ostrzega, nie przerywa.
- Środowisko testowe workerd nie egzekwuje limitu 10 ms CPU z planu Workers Free, więc pomiar CPU dla S-05 i S-09 dalej wymaga wdrożenia (zob. `context/deployment/deploy-plan.md`).

## What We're NOT Doing

- Żadnych reguł czasu pracy ani fixtures prawnych (to S-05); helper jest ogólny, a przykładowe testy używają funkcji zastępczych zdefiniowanych w pliku testu.
- Żadnego progu pokrycia ani raportu coverage (natywne V8 coverage nie jest wspierane w tej integracji).
- Żadnego hooka pre-commit z testami (hook jest nieaktywny, a `lint-staged` ma zostać szybki).
- Żadnych testów czasu wykonania ani benchmarków CPU (workerd w testach nie egzekwuje limitu planu Free).
- Żadnej aktualizacji ani deduplikacji `wrangler` w projekcie (plugin ma własną kopię; wyrównanie wersji to osobna decyzja).
- Żadnych testów e2e ani testów powiązań Cloudflare (`cloudflare:test`, KV, Images).

## Implementation Approach

Jeden pakiet i jedna konfiguracja: Vitest 5 z pluginem `@cloudflare/vitest-plugin` w konfiguracji niezależnej od `wrangler.jsonc` i `dist/`. Testy leżą obok kodu (`src/lib/**/*.test.ts`), a logika reguł (od S-05) trafi do `src/lib/services/` jako czyste funkcje bez importów `astro:*` i `cloudflare:workers`. Helper determinizmu jest ogólny: wywołuje funkcję wielokrotnie na tym samym wejściu i na wariantach wejścia podanych przez wywołującego (np. przetasowana kolejność pracowników i zmian), porównując wyniki głęboko i z uwzględnieniem kolejności, co wymusza kanoniczną kolejność wskazań w wyniku. Fazy: runner (1), helper z przykładami (2), CI i dokumentacja (3), każda kończy się działającym, weryfikowalnym stanem.

## Critical Implementation Details

**Timing & lifecycle:** Worktree nie ma `node_modules`, więc przed Fazą 1 potrzebne jest `npm ci`. Zatwierdzenie `workerd@1.20261012.1` w `allowScripts` wykonuje człowiek (`npm install-scripts approve workerd@1.20261012.1`); nie używać `--dry-run`, bo ta wersja npm zapisuje wpisy do `package.json` mimo flagi. Wersję workerd należy odczytać z `npm install` (ostrzeżenie `install-scripts`) lub `npm install-scripts ls`, nie zgadywać.

**Debug & observability:** Dowód, że testy biegną w workerd, to test sanity sprawdzający `navigator.userAgent`; jeśli konfiguracja kiedyś wróci do Node, ten test ma pierwszy zgłosić problem.

**Performance constraints:** Środowisko testowe nie egzekwuje limitu 10 ms CPU z planu Free; nie wnioskować z zielonych testów, że reguła zmieści się w limicie produkcyjnym.

## Phase 1: Runner w workerd

### Overview

Dodać Vitest 5 i `@cloudflare/vitest-plugin`, konfigurację niezależną od wrangler, skrypty `test` i `test:watch` oraz test sanity potwierdzający środowisko workerd i działanie aliasu.

### Changes Required:

#### 1. Zależności i skrypty

**File**: `package.json` (oraz `package-lock.json`)

**Intent**: Dodać `vitest` i `@cloudflare/vitest-plugin` jako `devDependencies`, skrypty uruchamiające testy oraz zatwierdzenie skryptu instalacyjnego dla nowego workerd, tak aby `npm ci` nie ostrzegał o niezatwierdzonych skryptach.

**Contract**: `devDependencies`: `vitest` `^5.0.5`, `@cloudflare/vitest-plugin` `^1.4.4`. `scripts`: `"test": "vitest run"` i `"test:watch": "vitest"`. `allowScripts`: dopisać `workerd@1.20261012.1: true` poleceniem `npm install-scripts approve workerd@1.20261012.1` (wykonuje człowiek).

#### 2. Konfiguracja Vitest

**File**: `vitest.config.ts` (nowy, w katalogu głównym)

**Intent**: Uruchamiać testy w workerd bez zależności od `wrangler.jsonc` i `dist/`, z aliasem `@/*` i wyszukiwaniem testów tylko w `src/`.

**Contract**: Plugin `cloudflareTest` z opcją `miniflare` (`compatibilityDate` i `compatibilityFlags` zgodne z `wrangler.jsonc:5-6`), `resolve.alias["@"]` na katalog `src`, `test.include` równe `["src/**/*.test.ts"]`. Pliki testów importują `describe`, `it`, `expect` jawnie z `vitest` (bez globalnych).

```ts
// vitest.config.ts: sprawdzone próbą w izolowanym katalogu; nie wskazywać wrangler.configPath na wrangler.jsonc
cloudflareTest({ miniflare: { compatibilityDate: "2026-05-08", compatibilityFlags: ["nodejs_compat"] } })
```

Komentarz w pliku ma przypominać, że data i flagi odzwierciedlają `wrangler.jsonc` i trzeba je zmieniać razem.

#### 3. Test sanity środowiska

**File**: `src/lib/testing/harness.test.ts` (nowy)

**Intent**: Udowodnić, że testy działają w workerd i że alias `@/*` oraz istniejący moduł projektu da się zaimportować w tym środowisku.

**Contract**: Dwa testy: (a) `navigator.userAgent` równe `"Cloudflare-Workers"`; (b) import `cn` z `@/lib/utils` i asercja na wyniku scalania klas.

### Success Criteria:

#### Automated Verification:

- Zależności instalują się z lockfile bez ostrzeżenia o niezatwierdzonych skryptach dla workerd: `npm ci`
- Testy sanity przechodzą w workerd: `npm test`
- Linting przechodzi: `npm run lint`
- Sprawdzanie typów przechodzi: `npx astro check`

#### Manual Verification:

- Wpis `workerd@1.20261012.1` w `allowScripts` został przejrzany i zatwierdzony przez autora

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Helper determinizmu

### Overview

Dodać ogólny helper sprawdzający powtarzalność i niezależność od kolejności wejścia, wraz z przykładowymi testami, które dowodzą, że helper wykrywa błędy obu rodzajów.

### Changes Required:

#### 1. Helper determinizmu

**File**: `src/lib/testing/determinism.ts` (nowy)

**Intent**: Dać S-05 i S-09 jedno narzędzie do testowania zabezpieczenia PRD "te same dane, ten sam wynik", w tym zależności wyniku od kolejności wejścia. Moduł jest wyłącznie testowy i nie jest importowany z kodu aplikacji.

**Contract**: `seededShuffle<T>(items: readonly T[], seed: number): T[]` zwraca nową, powtarzalnie przetasowaną tablicę (ten sam seed daje ten sam wynik, wejście nie jest mutowane). `expectDeterministic<I, O>(fn: (input: I) => O, input: I, options?: { runs?: number; variants?: readonly I[] }): O` wywołuje `fn` `runs` razy (domyślnie 5) na `input` i wymaga równości głębokiej z pierwszym wynikiem, a następnie wymaga takiej samej równości dla `fn(variant)` każdego wariantu z `variants`; zwraca wynik bazowy. Porównanie uwzględnia kolejność elementów tablic w wyniku, co wymusza kanoniczną kolejność wskazań. Warianty buduje wywołujący (kształt wejścia jest domenowy), np. z użyciem `seededShuffle`.

#### 2. Testy przykładowe helpera

**File**: `src/lib/testing/determinism.test.ts` (nowy)

**Intent**: Pokazać wzorzec użycia dla S-05 i udowodnić, że helper naprawdę wykrywa naruszenia, zamiast tylko przechodzić.

**Contract**: Przypadki: (a) czysta funkcja niezależna od kolejności przechodzi z wariantami; (b) funkcja zależna od kolejności (np. zwracająca pierwszy element) jest wykryta na jawnie podanym wariancie o odwróconej kolejności (`toThrow`); (c) funkcja niedeterministyczna (licznik zewnętrzny) jest wykryta przy powtórzeniach; (d) `seededShuffle` jest powtarzalna dla tego samego seed, nie mutuje wejścia i zachowuje te same elementy.

### Success Criteria:

#### Automated Verification:

- Testy determinizmu przechodzą (helper wykrywa zależność od kolejności i niedeterminizm): `npm test`
- Linting przechodzi: `npm run lint`
- Sprawdzanie typów przechodzi: `npx astro check`

#### Manual Verification:

- Sygnatury w `determinism.ts` są czytelne i wystarczające dla zastosowania w S-05 (przegląd przez autora)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 3: CI i dokumentacja

### Overview

Włączyć testy do bramki CI i opisać nowe polecenie w dokumentach dla agentów, a następnie zweryfikować całą bramkę lokalnie i w CI.

### Changes Required:

#### 1. Krok testów w CI

**File**: `.github/workflows/ci.yml`

**Intent**: Uruchamiać testy w CI zaraz po sprawdzeniu typów, przed buildem, aby błąd testu zatrzymywał pipeline wcześnie.

**Contract**: W jobie `ci` dodać krok `npm test` między `npx astro check` (linia 21) a `npm run build` (linia 22). Job `smoke` bez zmian.

#### 2. Dokumentacja dla agentów

**File**: `AGENTS.md` oraz `CLAUDE.md`

**Intent**: Usunąć nieaktualne twierdzenie o braku runnera i opisać nowy sposób testowania, w tym konwencję, że logika reguł to czyste funkcje w `src/lib/services/` bez importów `astro:*` i `cloudflare:workers`.

**Contract**: `AGENTS.md:22` (kolejność bramki CI) uzupełnić o `npm test` po `npx astro check`; `AGENTS.md:24` zastąpić opisem `npm test` (Vitest w workerd, testy w `src/**/*.test.ts`, helper `src/lib/testing/determinism.ts`). W `CLAUDE.md` dodać `npm test` do listy poleceń (sekcja Commands, linie 5-13) oraz zmienić opis CI (linia 55) na "lint + tests + build".

### Success Criteria:

#### Automated Verification:

- Cała bramka przechodzi lokalnie w kolejności CI: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- Plik `ci.yml` uruchamia `npm test` między `astro check` a `build`: `Select-String -Path .github/workflows/ci.yml -Pattern 'npm test'`
- `AGENTS.md` nie zawiera już twierdzenia o braku runnera testów: `Select-String -Path AGENTS.md -Pattern 'No unit-test runner'` nie zwraca dopasowań

#### Manual Verification:

- Przebieg CI na pull requeście jest zielony, włącznie z nowym krokiem testów
- `npm test` działa w głównym katalogu autora po `npm ci`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Testing Strategy

### Unit Tests:

- `harness.test.ts`: środowisko workerd i działanie aliasu (2 testy).
- `determinism.test.ts`: wykrywanie zależności od kolejności i niedeterminizmu oraz właściwości `seededShuffle` (4 przypadki).

### Integration Tests:

- Przebieg CI na pull requeście (job `ci`) jest jedynym testem integracyjnym tej zmiany.

### Manual Testing Steps:

1. Po `npm ci` uruchomić `npm test` w głównym katalogu i sprawdzić, że wszystkie testy przechodzą.
2. Celowo zepsuć jedną asercję w `determinism.test.ts` i sprawdzić, że `npm test` kończy się kodem niezerowym; cofnąć zmianę.
3. Otworzyć pull request z tą zmianą i sprawdzić krok testów w jobie `ci`.

## Performance Considerations

Uruchomienie w workerd kosztuje ok. 4 s przy pierwszym starcie i ok. 1 s kolejnych; `npm ci` rośnie o własną kopię `wrangler`, `miniflare` i `workerd` (w próbie 236 MB `node_modules`). Środowisko testowe nie egzekwuje limitu 10 ms CPU z planu Workers Free, więc pomiar wydajności reguł w produkcji pozostaje poza zakresem tej zmiany.

## Migration Notes

Brak danych do migracji. Wycofanie: cofnąć commity zmiany (zależności, `vitest.config.ts`, skrypty, krok CI); nic poza repozytorium nie jest zmieniane.

## References

- Roadmapa: `context/foundation/roadmap.md` (F-02, `rules-verification-harness`; odblokowuje S-05 i S-09)
- Przypadki testowe i decyzje prawne dla S-05: `context/foundation/work-time-rules.md`
- Zabezpieczenia PRD (powtarzalny wynik): `context/foundation/prd.md`, sekcja Success Criteria, Guardrails
- Decyzja o planie Free i limicie CPU: `context/deployment/deploy-plan.md`
- Plugin: https://developers.cloudflare.com/workers/testing/vitest-integration/ oraz pakiet `@cloudflare/vitest-plugin` w npm (1.4.4)
- Podobny wzorzec w repozytorium: `scripts/smoke.mjs` (test bez zależności, dla przepływu logowania; nie dla logiki jednostkowej)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Runner w workerd

#### Automated

- [x] 1.1 Zależności instalują się z lockfile bez ostrzeżenia o niezatwierdzonych skryptach dla workerd: `npm ci`
- [x] 1.2 Testy sanity przechodzą w workerd: `npm test`
- [x] 1.3 Linting przechodzi: `npm run lint`
- [x] 1.4 Sprawdzanie typów przechodzi: `npx astro check`

#### Manual

- [x] 1.5 Wpis `workerd@1.20261012.1` w `allowScripts` został przejrzany i zatwierdzony przez autora

### Phase 2: Helper determinizmu

#### Automated

- [ ] 2.1 Testy determinizmu przechodzą (helper wykrywa zależność od kolejności i niedeterminizm): `npm test`
- [ ] 2.2 Linting przechodzi: `npm run lint`
- [ ] 2.3 Sprawdzanie typów przechodzi: `npx astro check`

#### Manual

- [ ] 2.4 Sygnatury w `determinism.ts` są czytelne i wystarczające dla zastosowania w S-05 (przegląd przez autora)

### Phase 3: CI i dokumentacja

#### Automated

- [ ] 3.1 Cała bramka przechodzi lokalnie w kolejności CI: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- [ ] 3.2 Plik `ci.yml` uruchamia `npm test` między `astro check` a `build`: `Select-String -Path .github/workflows/ci.yml -Pattern 'npm test'`
- [ ] 3.3 `AGENTS.md` nie zawiera już twierdzenia o braku runnera testów: `Select-String -Path AGENTS.md -Pattern 'No unit-test runner'` nie zwraca dopasowań

#### Manual

- [ ] 3.4 Przebieg CI na pull requeście jest zielony, włącznie z nowym krokiem testów
- [ ] 3.5 `npm test` działa w głównym katalogu autora po `npm ci`
