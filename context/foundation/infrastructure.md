---
project: Shiftly
researched_at: 2026-10-13
recommended_platform: Cloudflare Workers (static assets)
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 7 (SSR) + React 19
  runtime: Cloudflare Workers (workerd)
---

## Recommendation

**Deploy on Cloudflare Workers (with static assets).**

Platforma dostała pełną punktację (10/10) w pięciu kryteriach przyjazności dla agenta i jest jedyną, pod którą stos jest już skonfigurowany: adapter `@astrojs/cloudflare` 14.3.x, `wrangler.jsonc`, powiązania KV (`SESSION`) i Images. Odpowiedzi z wywiadu (trwałe połączenia: nie wiem, koszt i DX po równo, brak silnej znajomości platform, zasięg nieznany, zewnętrzni dostawcy w porządku) nie faworyzują innej platformy, a Supabase zostaje zewnętrznym dostawcą bazy i logowania.

Uwaga wersyjna: `tech-stack.md` zapisuje `deployment_target: cloudflare-pages`, ale adapter `@astrojs/cloudflare` od v13 obsługuje **wyłącznie Workers** (wsparcie Pages zostało usunięte). Tę wartość należy czytać jako "Cloudflare Workers".

## Platform Comparison

Punktacja: P = pełne (2), ~ = częściowe (1), F = brak (0), maks. 10.

| Platforma | CLI-first | Managed/Serverless | Dokumentacja czytelna dla agenta | Stabilne API wdrożeniowe | MCP / integracja | Suma |
|---|---|---|---|---|---|---|
| Cloudflare Workers | P | P | P | P | P | **10** |
| Vercel | P | P | P | P | ~ | 9 |
| Netlify | P | P | ~ | P | ~ | 8 |
| Fly.io | P | ~ | P | P | ~ | 8 |
| Railway | P | P | ~ | P | ~ | 8 |
| Render | ~ | P | ~ | P | ~ | 7 |

Noty do punktacji (stan na 2026-10-13):

- **Cloudflare:** `wrangler deploy` / `wrangler rollback` / `wrangler secret put`; dokumentacja dostępna jako markdown; oficjalny serwer MCP (API Cloudflare, dokumentacja), na stronie nieoznaczony jako beta.
- **Vercel:** `vercel deploy --prebuilt`; adapter `@astrojs/vercel` 11.0.14 (peer `astro ^7.0.0`); Vercel MCP oficjalny ("available on all plans"), wcześniej w Public Beta. Plan Hobby jest ograniczony do użytku niekomercyjnego.
- **Netlify:** `netlify deploy`; adapter `@astrojs/netlify` 8.2.9 (peer `astro ^7.0.0`); MCP oficjalny, status w dokumentacji nieokreślony; format dokumentacji nie sprawdzony.
- **Fly.io:** `fly deploy`, wymaga kontenera (Dockerfile jest poza zakresem tego badania); `fly mcp` oznaczone jako experimental; brak darmowego planu dla nowych organizacji.
- **Railway:** CLI `railway`; oficjalny hostowany MCP (`mcp.railway.com`), status nieokreślony, wymaga CLI >= 5.44.0; format dokumentacji nie sprawdzony.
- **Render:** deploy hooks i API; oficjalny MCP z ograniczonymi operacjami (bez skalowania, ograniczone zmiany zasobów) i ostrzeżeniem, że sekrety mogą trafić do kontekstu modelu; darmowy plan usypia po 15 minutach.

Koszt dla 10–30 użytkowników (MVP):

| Platforma | Realny koszt | Uwaga |
|---|---|---|
| Cloudflare | Free lub Paid $5/mies. | Free: 10 ms CPU na żądanie i 100 000 żądań/dobę; Paid: 10 mln żądań i 30 mln ms CPU w cenie; statyczne zasoby bezpłatne |
| Vercel | Hobby $0 (tylko niekomercyjnie) lub Pro $20/użytkownika/mies. | produkt dla firm to zastosowanie komercyjne |
| Railway | Hobby $5/mies. (zawiera $5 użycia) | CPU $20/vCPU/mies., RAM $10/GB/mies., egress $0,05/GB |
| Fly.io | ok. $2,19/mies. za 256 MB (shared-cpu-1x) plus egress | brak darmowego planu, wymagana karta |
| Render | Free (usypia) lub Starter $7/mies. | wolny start ok. minuty na planie Free |
| Netlify | Free: 300 kredytów/mies. wg źródeł zewnętrznych | oficjalna strona cen niezweryfikowana |

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Pełna punktacja, najniższy koszt zmiany (stos już pod Cloudflare), `wrangler` pokrywa cały cykl wdrożenia i wycofania bez przeglądarki, statyczne zasoby są bezpłatne. Słabość: darmowy plan ma limit 10 ms CPU na żądanie, więc na produkcję planować plan Paid ($5/mies.).

#### 2. Vercel

Drugi wynik (9/10). Różnica wobec rekomendacji to MCP o nieco bardziej niejednoznacznym statusie oraz konieczność planu Pro przy użyciu komercyjnym ($20/użytkownika/mies.) i wymiana adaptera z `@astrojs/cloudflare` na `@astrojs/vercel`.

#### 3. Railway

Wynik 8/10, ale jedyna z listy zabezpieczająca odpowiedź "nie wiem" na pytanie o trwałe połączenia: działa jako zawsze aktywny proces (adapter `@astrojs/node`), $5/mies. Wymaga wymiany adaptera i rezygnacji z powiązań Cloudflare. Dokumentacja i status MCP nie zostały zweryfikowane do końca.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **Darmowy plan: 10 ms CPU na żądanie.** Dokumentacja podaje, że SSR "typically use 10–20 ms". Generowanie lub sprawdzanie grafiku może przekroczyć limit i zwrócić błąd, więc realnie potrzebny jest plan Paid.
2. **Uzależnienie od dostawcy.** Sesje na KV (`SESSION`), obrazy na `IMAGES` i importy `cloudflare:workers` są specyficzne dla Cloudflare. Wyjście oznacza wymianę adaptera i tych powiązań.
3. **`workerd` to nie Node.** Zależności CommonJS mogą wymagać prekompilacji (dokumentacja adaptera), a część API Node jest dostępna tylko przez `nodejs_compat`.
4. **Wycofanie nie cofa danych.** `wrangler rollback` zmienia tylko kod (do 100 ostatnich wersji); schemat Supabase i zasoby powiązane zostają.
5. **Opóźnienie sumujące się z bazą (wniosek z architektury, nie ze źródła).** Worker działa blisko użytkownika, a Supabase w jednym regionie; middleware z zapytaniem do bazy na każde żądanie mnoży rundy sieciowe.

### Pre-Mortem — How This Could Fail

Zespół wdrożył Shiftly na darmowym planie Workers, bo "stos był gotowy". W pierwszym tygodniu pilotażu planista wygenerował grafik tygodniowy dla 25 osób: reguły czasu pracy sprawdzały się w pętli po pracownikach i dniach, więc żądanie przekroczyło 10 ms CPU i zwróciło błąd. Zespół uznał to za błąd w kodzie i przez dwa dni optymalizował algorytm, zamiast zmienić plan. Dodatkowo zaproszenia e-mailowe do pracowników nie dochodziły, bo domyślny SMTP Supabase ma niski limit wysyłek, a nikt nie skonfigurował własnego nadawcy. Po drugiej awarii wycofano wersję przez `wrangler rollback`, ale baza miała już nowszą migrację, więc stara wersja kodu pękała na nowym schemacie. Planista wrócił do arkusza kalkulacyjnego. Błędne założenia: że darmowy plan wystarczy dla obliczeń, że e-mail "po prostu działa" i że cofnięcie kodu cofa też dane.

### Unknown Unknowns

- **`cloudflare-pages` jest nieaktualne** dla adaptera v14: polecenia z tutoriali dla Pages (`wrangler pages deploy`) nie pasują; właściwe to `npx astro build` i `npx wrangler deploy`.
- **Serwer deweloperski Astro 6+ już działa na `workerd`**, więc osobne `wrangler dev` nie jest potrzebne; do testu zbliżonego do produkcji służy `astro preview`.
- **Sekrety są opcjonalne w schemacie `astro:env`** (`SUPABASE_URL`, `SUPABASE_KEY` z `optional: true`), więc ich brak nie przerwie budowania, tylko pojawi się baner o braku konfiguracji w działającej aplikacji.
- **Powiązania `SESSION` (KV) i `IMAGES`** są włączane przez adapter automatycznie. Zweryfikowane 2026-10-14: pierwszy `wrangler deploy` utworzył namespace KV `shiftly-session`, a `--dry-run` listuje `env.SESSION`, `env.IMAGES`, `env.ASSETS`. Uwaga: `--dry-run` nie wypisuje nazwy Workera, nazwę sprawdza się w `dist/server/wrangler.json` (musi być przebudowany po zmianie `name`).
- **Brak kroku wdrożenia w CI:** `tech-stack.md` zakłada "auto-deploy-on-merge", a `.github/workflows/ci.yml` go nie ma; potrzebny Workers Builds albo job z `CLOUDFLARE_API_TOKEN` i `CLOUDFLARE_ACCOUNT_ID`.

## Operational Story

- **Preview deploys**: `npx wrangler deploy` po wysłaniu wersji wypisuje adres podglądu (workers.dev). Workers Builds buduje po pushu (`npx astro build`, deploy `npx wrangler deploy`); podglądy per gałąź nie są opisane w sprawdzonych źródłach, do zweryfikowania.
- **Secrets**: `npx wrangler secret put SUPABASE_URL` i `SUPABASE_KEY`; lokalnie `.dev.vars` (w `.gitignore`); zmienne niewrażliwe w bloku `vars` pliku `wrangler.jsonc`. Dostęp do wartości wynika z uprawnień konta Cloudflare.
- **Rollback**: `npx wrangler rollback` (interaktywnie lub z ID wersji) albo Dashboard > Workers & Pages > Deployments > Rollback; wersja staje się aktywna natychmiast. Dotyczy tylko kodu (ostatnie 100 wersji), nie schematu bazy ani sekretów.
- **Approval**: człowiek zatwierdza wdrożenie na produkcję, rotację kluczy Supabase, zmianę planu i migracje bazy; agent może bez nadzoru budować (`astro build`), lintować i sprawdzać (`astro check`). Reguła proponowana, nie wynika ze źródeł platformy.
- **Logs**: `observability.enabled: true` jest już w `wrangler.jsonc` (Workers Logs w dashboardzie). Zweryfikowane 2026-10-14 na wrangler 4.131.1: `npx wrangler tail shiftly --format json` zwraca zdarzenia z polami `outcome`, `cpuTime`, `wallTime`, `exceptions`, `scriptVersion` (JSON wielowierszowy, parsować jako strumień obiektów). Do odczytu tylko do odczytu przez agenta.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Przekroczenie 10 ms CPU na darmowym planie | Devil's advocate / Research finding | H | H | Plan Paid ($5/mies.) przed pilotażem; test czasu generowania grafiku dla 30 osób. Pomiar 2026-10-14: 17 do 28 ms CPU przy pierwszym renderze stron auth, wynik `ok`; plan konta do ustalenia (zob. `context/deployment/deploy-plan.md`) |
| Uzależnienie od powiązań Cloudflare (KV, Images) | Devil's advocate | M | M | Trzymać logikę domeny (walidator) w czystych funkcjach bez zależności od `cloudflare:workers` |
| Zależność CommonJS nie działa w `workerd` | Devil's advocate / Research finding | M | M | Wybierać biblioteki ESM; testować w `astro dev` (workerd) od pierwszego dnia |
| Rollback kodu niezgodny ze schematem bazy | Pre-mortem | M | H | Migracje wstecznie zgodne; nowy kod i migracja w osobnych wdrożeniach |
| Zaproszenia e-mail nie docierają (limit domyślnego SMTP) | Pre-mortem / Unknown unknowns | H | H | Własny nadawca SMTP w Supabase przed pilotażem; test wysyłki FR-001 i FR-006 |
| Nieaktualna wartość `cloudflare-pages` w `tech-stack.md` | Unknown unknowns | H | L | Zaktualizować `deployment_target` na Workers; nie używać `wrangler pages deploy` |
| Brak automatycznego wdrożenia po scaleniu | Unknown unknowns | H | M | Wybrać Workers Builds albo dodać job wdrożeniowy z tokenem API |
| Opóźnienie Worker–Supabase (jeden region bazy) | Devil's advocate (wniosek z architektury) | M | M | Region Supabase blisko użytkowników (UE); zmierzyć czas odpowiedzi względem NFR < 3 s |
| Brak powiązań `SESSION`/`IMAGES` po pierwszym wdrożeniu | Unknown unknowns | M | M | Sprawdzić zasoby na koncie i logi po pierwszym `wrangler deploy` |

## Getting Started

Polecenia zgodne z zainstalowanymi wersjami (Astro 7.3.2, `@astrojs/cloudflare` 14.3.1, `wrangler` 4.131.x), nie z ogólnymi tutorialami:

1. Załóż konto Cloudflare i zaloguj `wrangler` (lokalna zależność projektu): `npx wrangler login`.
2. Załóż hostowany projekt Supabase w regionie blisko użytkowników (UE) i ustaw w nim adres witryny oraz dozwolone adresy przekierowań na docelowy adres Workers.
3. Zbuduj i wdróż: `npm run build`, potem `npx wrangler deploy` (Astro 6+ nie wymaga `wrangler dev` do pracy lokalnej).
4. Po pierwszym wdrożeniu ustaw sekrety: `npx wrangler secret put SUPABASE_URL` i `npx wrangler secret put SUPABASE_KEY`, a następnie sprawdź w logach, czy powiązania `SESSION` i `IMAGES` działają.
5. Przejdź na plan Workers Paid przed pilotażem i zmierz czas generowania grafiku dla zespołu 25–30 osób.
6. Zdecyduj o automatycznym wdrożeniu: Workers Builds w dashboardzie albo job w GitHub Actions z `CLOUDFLARE_API_TOKEN` i `CLOUDFLARE_ACCOUNT_ID` (ta decyzja jest poza zakresem tego badania).

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup
- Production-scale architecture (multi-region, HA, DR)

## Sources

- [Astro: @astrojs/cloudflare adapter](https://docs.astro.build/en/guides/integrations-guide/cloudflare/)
- [Astro: deploy to Cloudflare](https://docs.astro.build/en/guides/deploy/cloudflare/)
- [Cloudflare Workers: limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare Workers: pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Cloudflare Workers: rollbacks](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/)
- [Cloudflare: MCP servers](https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/)
- [Cloudflare: migrate from Pages to Workers](https://developers.cloudflare.com/workers/static-assets/migrate-from-pages/)
- [Vercel: Hobby plan](https://vercel.com/docs/plans/hobby)
- [Vercel: MCP](https://vercel.com/docs/mcp/vercel-mcp)
- [Fly.io: pricing](https://docs.fly.io/about/pricing)
- [Railway: plans](https://docs.railway.com/pricing/plans)
- [Railway: MCP server](https://docs.railway.com/ai/mcp-server)
- [Render: free tier](https://render.com/docs/free)
- [Render: MCP server](https://render.com/docs/mcp-server)
- [Netlify: MCP server](https://docs.netlify.com/build/build-with-ai/netlify-mcp-server/)
- Adaptery (peer `astro`, npm, 2026-10-13): `@astrojs/cloudflare` 14.3.4 (`^7.2.0`), `@astrojs/vercel` 11.0.14 (`^7.0.0`), `@astrojs/netlify` 8.2.9 (`^7.0.0`), `@astrojs/node` 11.1.7 (`^7.2.1`).
