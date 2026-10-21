<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Role based access Implementation Plan

- **Plan**: context/changes/role-based-access/plan.md
- **Mode**: Deep
- **Date**: 2026-10-20
- **Verdict**: REVISE
- **Findings**: 1 critical, 2 warnings, 6 observations
- **Triage**: 9 FIXED (F1–F9, wszystkie przez "Fix in plan"); werdykt po poprawkach: SOUND

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | FAIL |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

Grounding: 24/24 istniejących ścieżek ✓, nowe cele (src/types.ts, src/lib/services/, supabase/migrations/, access-denied, planner) nieobecne ✓, odwołania do linii (middleware 4,18-22; env.d.ts; smoke 38-59; ci.yml 43,47; eslint 73-78; config.toml 160,171,216; AGENTS.md 15,23,30; CLAUDE.md 14,29-31; Topbar 27-29; Welcome 35-40,64; signin.astro 15-20; README 146-147) ✓, brief↔plan ✓, Progress↔Phase ✓ (1 `## Progress`, 4 faz, 25 wierszy 1:1 z kryteriami, brak `- [ ]` poza Progress). Przegląd głęboki: jeden sub-agent sprawdził ryzykowne twierdzenia względem Astro 7.3.2, @astrojs/cloudflare 14.3.1, @supabase/auth-js 2.116.0, @supabase/ssr 0.12.7 i Supabase CLI 2.117.0. Potwierdzone: `context.rewrite()` ponownie wchodzi w middleware ze wspólnym `locals` (F1); `next("/access-denied")` nie wchodzi ponownie, zachowuje `locals` i ciasteczka, a status ustawiony w frontmatterze strony dociera do klienta; middleware widzi znormalizowaną ścieżkę, a routing i polityka zgadzają się wszędzie tam, gdzie trasa faktycznie pasuje (brak obejścia); pliki statyczne omijają Workera (wrangler.jsonc:7-11); mapowanie `[auth] enable_signup` → `GOTRUE_DISABLE_SIGNUP`, `[auth.email] enable_signup` → `GOTRUE_EXTERNAL_EMAIL_ENABLED`; `ANON_KEY`/`SERVICE_ROLE_KEY` są domyślnymi nazwami w CLI 2.117.0. Niezweryfikowane (obraz Docker GoTrue lub CI na `latest`): skutek `enable_signup = false` dla API administracyjnego i grantu hasła (dowodzi go smoke, jak zakłada plan), format wyjścia `supabase status -o env` w nowszym CLI.

## Findings

### F1 — Rozróżnienie 401/403 ginie: `context.rewrite()` ponownie uruchamia middleware i zeruje `locals.denial`

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Faza 2 — zmiany 1 (Typy Astro.locals), 2 (Middleware), 3 (Strona odmowy)
- **Detail**: Plan ustawia `locals.denial = null` przy każdym przebiegu middleware, ustawia je przy odmowie i wywołuje `context.rewrite("/access-denied")`, a strona wyprowadza 401/403 z `locals.denial`. W Astro 7.3.2 `rewrite()` idzie przez `executeRewrite` → `handleMiddleware(state, handlePages)` (node_modules/astro/dist/core/rewrites/handler.js:53-62), czyli middleware użytkownika uruchamia się drugi raz na `/access-denied` (publiczna, dozwolona). `locals` to jeden obiekt na żądanie (core/fetch/fetch-state.js:234, getter :875-880; `invalidateContexts()` go nie rusza), więc `denial = null` z drugiego przebiegu kasuje powód. Skutek: strona zawsze odpowiada 403, anonim nigdy nie dostaje wybranego 401, a asercje smoke w Fazie 2 zmiana 5 (anonim → 401) nie przechodzą. Drugi przebieg powtarza też `createClient` + `getUser()` (kolejna runda do Supabase na każde odrzucone żądanie) i czyta ciasteczka z nagłówka żądania, więc po odświeżeniu tokenu w pierwszym przebiegu używa starych tokenów (`refresh_token_reuse_interval = 10` lokalnie, config.toml:169; hostowana wartość niezweryfikowana).
- **Fix**: Wyprowadzić status w stronie ze stanu, który przetrwa przepisanie: w `access-denied.astro` ustawić 403, gdy `Astro.locals.user` jest ustawiony, a w przeciwnym razie 401; usunąć `locals.denial` i pole `denial` z `Locals` w `env.d.ts` (typ `AccessDenial` zostaje w `access.ts`, bo używa go `decideAccess` i JSON dla `/api/*`); w middleware zwracać `next("/access-denied")` zamiast `context.rewrite("/access-denied")`. Zweryfikowane w źródle Astro: `next(payload)` nie wchodzi ponownie w middleware (core/middleware/astro-middleware.js:22-33, bez zwiększenia `counter`), strona dostaje ten sam `Astro.locals` z `user` (fetch-state.js:395), `state.cookies` zostaje tym samym obiektem, do którego pisze `setAll` (handler.js:34-40, bez `mergeCookies`), a `Astro.response.status` ustawiony we frontmatterze trafia do odpowiedzi (render/astro/render.js:191-203, page.js:68-82). Niezweryfikowane: uruchomienie w workerd; pokrywa to smoke (statusy i ciasteczka) oraz kontrola w przeglądarce 2.6. Bezpośrednie wejście na `/access-denied` da wtedy 401 dla anonima i 403 dla zalogowanego; dopisać to do kontraktu strony.
- **Decision**: FIXED (Fix in plan)

### F2 — Kryterium 3.2 nie może przejść, bo test (d) z Fazy 1 zawiera `/auth/signup`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Faza 3 — kryterium 3.2 vs Faza 1 — zmiana 3, przypadek (d)
- **Detail**: 3.2 wymaga, by `Get-ChildItem src -Recurse -File | Select-String -Pattern 'auth/signup|confirm-email|SignUpForm'` nie zwracało dopasowań. Przypadek (d) ("usunięta trasa `/auth/signup` jest tylko dla planisty") wstawia dosłowne `/auth/signup` do `src/lib/services/access.test.ts`, więc 3.2 zawsze dopasuje ten plik, niezależnie od tego, jak dobrze usunięto trasy.
- **Fix**: Usunąć przypadek (d) z kontraktu testów Fazy 1; jest zbędny wobec (c), gdzie przyszła ścieżka `/employees` już dowodzi warstwy domyślnej odmowy. Zadbać też, by żaden komentarz ani tabela w `src` nie zawierały tych literałów.
- **Decision**: FIXED (Fix in plan)

### F3 — Dokumentacja: plan pomija miejsca w README opisujące mechanizm, który znika

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Faza 2 — zmiana 7 (Dokumentacja); Faza 3 — zmiana 5; kryterium 3.2
- **Detail**: Faza 2 zmiana 7 obejmuje `CLAUDE.md` i `AGENTS.md`, a Faza 3 zmiana 5 z README tylko tabelę tras (linie 146-147). README pozostaje sprzeczne z nowym modelem: linia 148 ("redirects to `/auth/signin` if unauthenticated"), 150 ("Add paths to the `PROTECTED_ROUTES` array there to require authentication" — tablicy już nie będzie, a nowa strona jest domyślnie tylko dla planisty), 131-139 ("sign in immediately after sign-up"), 172 i 179 (opis smoke przez rejestrację, "email confirmation disabled"), 58 (opis `npm run smoke`). Kryterium 3.2 sprawdza tylko `src`, więc nikt tego nie wychwyci.
- **Fix**: Dodać README do Fazy 2 zmiana 7 (linie 58, 148, 150, 172, 179: domyślna odmowa, role, zmienne smoke) i rozszerzyć Fazę 3 zmiana 5 o linie 131-139; rozszerzyć kryterium 3.2 do `Get-ChildItem src,README.md,CLAUDE.md,AGENTS.md -Recurse -File | Select-String -Pattern 'auth/signup|confirm-email|SignUpForm|PROTECTED_ROUTES'` i zmienić tytuł wiersza 3.2 w Progress identycznie.
- **Decision**: FIXED (Fix in plan)

### F4 — `/planner` opisano jako stronę startową po logowaniu, ale nic tam planisty nie kieruje

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Faza 2 — zmiana 4; plan-brief.md (Key Decisions "Dowód bramki planisty")
- **Detail**: Faza 2 nazywa `/planner` "punktem startowym planisty po logowaniu", a brief powtarza "punkt startowy planisty". Logowanie nadal przekierowuje na `/` (src/pages/api/auth/signin.ts:19, smoke to asertuje), `/` pokazuje tylko stronę startową szablonu, a jedyny odnośnik do `/planner` jest na `/dashboard`. Strona jest celem bramki, nie stroną startową.
- **Fix**: Przeformułować na "cel dla smoke i strona dostępna z `/dashboard` dla planisty" w Fazie 2 zmiana 4 i w tabeli decyzji briefu; przekierowanie po logowaniu zostaje bez zmian.
- **Decision**: FIXED (Fix in plan)

### F5 — Domyślna odmowa zamyka dla anonima także nieznane ścieżki i wewnętrzne trasy Astro

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Faza 1 — zmiana 2 (tabela polityki); Desired End State
- **Detail**: Żądania bez pasującej trasy trafiają do domyślnej trasy `/404`, która przechodzi przez middleware (core/routing/route-table.js:4-6, fetch-state.js:744-749, routing/handler.js:80). Anonimowe `/favicon.ico` i `/robots.txt` (brak ich w `dist/client`, więc idą do Workera) oraz `/auth/signup` i `/auth/confirm-email` po usunięciu zwrócą 401 zamiast 404. Astro wstrzykuje też `/_image` i `/_server-islands/[name]` (core/routing/create-manifest.js:529-534, oba `prerender: false`); dziś `src` nie używa `<Image>` ani `server:defer`, ale przyszła publiczna strona, która je użyje, przestanie działać dla anonima bez oczywistej przyczyny. Pliki statyczne (`/_astro/*`, `favicon.png`) są obsługiwane przez ASSETS przed Workerem, więc ich to nie dotyczy.
- **Fix**: Dopisać jedno zdanie do kontraktu polityki w Fazie 1: nieznane ścieżki i wewnętrzne trasy Astro (`/_image`, `/_server-islands/*`) są tylko dla planisty, dopóki wycinek, który ich potrzebuje, nie wpisze konkretnej ścieżki do tabeli. Bez zmian w kodzie.
- **Decision**: FIXED (Fix in plan)

### F6 — Strażnik smoke sprawdza tylko własny `SUPABASE_URL` smoke'a, nie Supabase używany przez testowaną aplikację

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Faza 2 — zmiana 5 (smoke) i kryterium 2.2
- **Detail**: Strażnik (host 127.0.0.1/localhost) słusznie chroni hostowany projekt przed tworzeniem kont. Kryterium 2.2 wymienia jednak tylko `supabase start`, `build`, `preview` i trzy zmienne smoke; podgląd czyta `.env`/`.dev.vars`, których w worktree nie ma, a w checkoucie autora mogą wskazywać hostowany projekt (jak przy wdrożeniu, deploy-plan.md:50-52). CI zapisuje je z lokalnego stosu (ci.yml:44-48). Przy niezgodności pierwszy krok logowania kończy się niejasnym "invalid credentials" i implementator traci czas.
- **Fix**: Zapisać w 2.2 i w kontrakcie smoke, że `.env`/`.dev.vars` muszą wskazywać lokalny stos (wartości z `supabase status -o env`, jak w ci.yml:44-48), a pierwszy krok logowania ma przy porażce konta utworzonego przez API administracyjne wypisać "aplikacja pod testem nie używa SUPABASE_URL".
- **Decision**: FIXED (Fix in plan)

### F7 — `create-planner.mjs` nie mówi, jak znajduje istniejące konto do awansowania

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Faza 3 — zmiana 3
- **Detail**: Kontrakt mówi, że skrypt awansuje istniejące konto "gdy adres już istnieje", ale API administracyjne (klient admin w auth-js ma `getUserById` i `listUsers`) nie ma odpowiednika wyszukiwania po e-mailu, więc implementator musi wybrać sposób. Awans istniejących kont testowych z produkcji to główne zastosowanie tej gałęzi, więc błędne założenie (porównanie z uwzględnieniem wielkości liter, brak paginacji) po cichu utworzy albo pominie konto.
- **Fix**: Określić: po odpowiedzi `email_exists` na `POST /auth/v1/admin/users` przejść `GET /auth/v1/admin/users?page=N&per_page=1000`, aż e-mail zapisany małymi literami się zgodzi, następnie `PUT /auth/v1/admin/users/{id}` z `app_metadata: { role: "planner" }`; brak dopasowania kończy się kodem niezerowym.
- **Decision**: FIXED (Fix in plan)

### F8 — Między Fazą 2 a 3 odnośniki do rejestracji są martwe, a krok smoke z Fazy 3 nie dowodzi usunięcia

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Faza 2 — zmiana 5 ("trasa jeszcze istnieje do Fazy 3"); Faza 3 — zmiana 4
- **Detail**: Po Fazie 2 bramka domyślnej odmowy już blokuje `/auth/signup`, `/auth/confirm-email` i `POST /api/auth/signup` dla anonima, więc odnośniki "Sign up" w Topbar.astro:27, Welcome.astro:36 i signin.astro:17 prowadzą na "Brak dostępu" aż do usunięcia w Fazie 3. Zdanie, że trasa "jeszcze istnieje", jest prawdziwe tylko w systemie plików. Krok smoke z Fazy 3 (`POST /api/auth/signup` → 401) przechodzi już po Fazie 2, więc dowodzi bramki, nie usunięcia; usunięcie dowodzi 3.2.
- **Fix**: Zapisać w planie, że Fazy 2 i 3 trafiają do tego samego PR/wdrożenia (nie wdrażać samej Fazy 2), przeformułować Fazę 2 zmiana 5 na "trasa jest już zablokowana bramką, usuwana w Fazie 3" i oznaczyć krok smoke z Fazy 3 jako sprawdzenie bramki.
- **Decision**: FIXED (Fix in plan)

### F9 — Samodzielnie zarejestrowane konta na produkcji zostają po zamknięciu rejestracji

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Migration Notes; Key Discoveries (ostatni punkt)
- **Detail**: Plan zauważa, że publiczna rejestracja jest przyczyną kont bez roli na produkcji, i zostawia je (po wdrożeniu widzą tylko strony publiczne). Nie rozstrzyga jednak, czy przejrzeć listę i usunąć konta, których autor nie rozpoznaje. Strona działa publicznie od 2026-10-14, więc mogą tam być obce konta; zaproszenie pracownika po adresie e-mail w S-10 trafi na `email_exists` (ten sam kod, na którym plan opiera awans w F7) dla adresu, który ktoś już zarejestrował z własnym hasłem.
- **Fix**: Dodać w Migration Notes krok przed (1): w panelu Supabase (Authentication → Users) przejrzeć konta hostowanego projektu i usunąć te, których autor nie rozpoznaje; konta do zachowania awansować skryptem.
- **Decision**: FIXED (Fix in plan)
