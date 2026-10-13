---
bootstrapped_at: 2026-10-13T10:19:16Z
starter_id: 10x-astro-starter
starter_name: 10x Astro Starter (Astro + Supabase + Cloudflare)
project_name: shiftly
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: npm audit --json
---

# Bootstrap verification

## Hand-off

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: shiftly
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
```

### Why this stack

Aplikacja webowa Shiftly dla planisty i pracowników, z logowaniem kontem, w skali dziesiątek do stu osób i z harmonogramem 8 tygodni po godzinach. Dla aplikacji webowej w JavaScript / TypeScript rekomendowanym domyślnym wyborem jest 10x Astro Starter (Astro, React, TypeScript, Supabase, Cloudflare): logowanie, baza danych i wdrożenie brzegowe są dostępne od razu, a stos spełnia wszystkie cztery bramki jakości przyjazności dla agenta. Pewność bootstrappera to first-class, więc szkielet powstanie zwykle płynnie, z okazjonalnym ręcznym krokiem. Z PRD wykryto tylko logowanie; płatności, czas rzeczywisty, AI i zadania w tle nie występują. Zespół przyjęto domyślnie jako jednoosobowy, bo ścieżka standardowa nie pyta o jego profil. Dwie uwagi z karty startera: reguły dostępu do danych trzeba skonfigurować od początku (pracownik widzi tylko własne dane), a generowanie grafiku nie powinno być długim zadaniem w środowisku brzegowym. Wdrożenie na cloudflare-pages, CI na GitHub Actions z automatycznym wdrożeniem po scaleniu.

## Pre-scaffold verification

| Signal      | Value                                                               | Severity | Notes                                                                                            |
| ----------- | ------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| npm package | not run                                                             | n/a      | cmd_template starts with `git clone`; the npm step is skipped per pre-scaffold-verification.md |
| GitHub repo | przeprogramowani/10x-astro-starter last pushed 2026-09-12T21:16:08Z | fresh    | from card.docs_url; `gh` not installed, same endpoint queried via the public GitHub REST API   |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install` (run as one cmd.exe invocation because Windows PowerShell 5.1 has no `&&`)
**Strategy**: git-clone
**Exit code**: 0
**Files moved**: 30682 (node_modules/ (30680 files); scripts/ (1 files); loose files: AGENTS.md)
**Conflicts (.scaffold siblings)**: 47 - .github/workflows/ci.yml, .husky/pre-commit, .vscode/extensions.json, .vscode/launch.json, .vscode/settings.json, public/.assetsignore, public/favicon.png, public/template.png, src/components/auth/FormField.tsx, src/components/auth/PasswordToggle.tsx, src/components/auth/ServerError.tsx, src/components/auth/SignInForm.tsx, src/components/auth/SignUpForm.tsx, src/components/auth/SubmitButton.tsx, src/components/ui/button.tsx, src/components/ui/LibBadge.astro, src/components/Banner.astro, src/components/Topbar.astro, src/components/Welcome.astro, src/layouts/Layout.astro, src/lib/config-status.ts, src/lib/supabase.ts, src/lib/utils.ts, src/pages/api/auth/signin.ts, src/pages/api/auth/signout.ts, src/pages/api/auth/signup.ts, src/pages/auth/confirm-email.astro, src/pages/auth/signin.astro, src/pages/auth/signup.astro, src/pages/dashboard.astro, src/pages/index.astro, src/styles/global.css, src/env.d.ts, src/middleware.ts, supabase/config.toml, .env.example, .nvmrc, .prettierrc.json, astro.config.mjs, CLAUDE.md, components.json, eslint.config.js, package-lock.json, package.json, README.md, tsconfig.json, wrangler.jsonc
**.gitignore handling**: append-merged, 0 new lines (root `.gitignore` and `supabase/.gitignore`; every scaffold line was already present)
**.bootstrap-scaffold cleanup**: deleted
**Populated-cwd guard**: cwd already contained `package.json`; the user confirmed continuing. `context/` untouched (0 scaffold files dropped from `context/`).
**Notes**:
- `node_modules` was installed from the starter's own `package.json` (kept as `package.json.scaffold`, astro `^7.3.2`, installed 7.3.2). The existing `package.json` (astro `^6.3.1`) was preserved, so `node_modules` and the existing lockfile are out of sync until you run an install in this directory.
- npm 11 did not run 3 install scripts that are not yet covered by `allowScripts`: `esbuild@0.28.2`, `esbuild@0.28.1`, `workerd@1.20260911.1` (postinstall: `node install.js`). Review with `npm install-scripts ls` and approve deliberately.
- Local Node is v24.20.0; the starter pins `.nvmrc` 22.14.0 (no `engines` field, so npm did not refuse).
- The starter's own clean install reported 11 vulnerabilities (2 moderate, 9 high, 0 critical). The audit below ran against this directory's existing `package-lock.json` and therefore reports different numbers.

## Post-scaffold audit

**Tool**: npm audit --json (exit code 1 is informational; npm exits non-zero whenever vulnerabilities exist)
**Summary**: 2 CRITICAL, 21 HIGH, 9 MODERATE, 2 LOW (total 34; dependencies: 895)
**Direct vs transitive**: 1/1/2/0 direct of total 2/21/9/2

#### CRITICAL findings

**astro** v6.3.1 (direct) - vulnerable range `<=7.2.7` - fix available (npm audit fix)
- GHSA-jrpj-wcv7-9fh9: Astro: XSS via Unescaped Attribute Names in Spread Props
- GHSA-f48w-9m4c-m7f5: Astro: XSS via unescaped spread attribute names in renderHTMLElement (incomplete fix for CVE-2026-54298)
- GHSA-7pw4-f3q4-r2p2: Astro: Cross-site scripting via unescaped transition:* directive values on hydrated islands
- GHSA-4g3v-8h47-v7g6: Astro: Reflected XSS via unescaped View Transition animation properties
- GHSA-2pvr-wf23-7pc7: Astro: Host header SSRF in prerendered error page fetch
- GHSA-8hv8-536x-4wqp: Astro: Reflected XSS via unescaped slot name
- GHSA-26w7-cxv4-gfx2: Astro: Remote code execution through AVIF image optimization
- GHSA-376h-93r7-7g6f: Astro: Authorization bypass from missing path-segment boundary check when stripping the configured base
- via dependency `esbuild`
- via dependency `sharp`

**tar** v7.5.13 (transitive) - vulnerable range `<=7.5.20` - fix available (npm audit fix)
- GHSA-vmf3-w455-68vh: node-tar applies PAX size override to intermediary GNU long-name/long-link headers, causing tar parser interpretation differential (file smuggling)
- GHSA-w8wr-v893-vjvp: node-tar: Process crash via PAX numeric path type confusion
- GHSA-23hp-3jrh-7fpw: node-tar: Decompression/parse DoS via unlimited input
- GHSA-8x88-c5mf-7j5w: node-tar: Negative tar entry size causes infinite loop in archive replace
- GHSA-gvwx-54wh-qm9j: node-tar: Uncaught Exception DoS via NUL byte in PAX path/linkpath records
- GHSA-r292-9mhp-454m: node-tar: Uncontrolled recursion in mapHas/filesFilter allows uncatchable stack-overflow DoS via crafted long-path tar with member selection


#### HIGH findings

**astro-eslint-parser** v1.4.0 (transitive) - vulnerable range `1.2.1 - 2.0.0` - fix: eslint-plugin-astro@3.2.1 (semver-major)
- via dependency `fast-glob`

**brace-expansion** v1.1.14 (transitive) - vulnerable range `<=1.1.20 || 3.0.0 - 5.0.11` - fix available (npm audit fix)
- GHSA-3jxr-9vmj-r5cp: brace-expansion: DoS via exponential-time expansion of consecutive non-expanding {} groups
- GHSA-mh99-v99m-4gvg: brace-expansion: DoS via unbounded expansion length causing an out-of-memory process crash
- GHSA-rgw5-rvv9-x895: brace-expansion: DoS via unbounded intermediate arrays, bypassing the CVE-2026-14257 mitigation
- GHSA-q2hr-2g5m-vwhr: brace-expansion: Quadratic-time expansion of the `{a},b}` rewrite causes CPU denial of service
- GHSA-qhr7-859c-m2p7: brace-expansion: DoS via uncontrolled recursion on nested brace groups causing stack exhaustion
- GHSA-6j4f-fj2g-mc7p: brace-expansion: DoS via uncontrolled recursion in parseCommaParts causing stack exhaustion

**braces** v3.0.3 (transitive) - vulnerable range `*` - fix: eslint-plugin-astro@3.2.1 (semver-major)
- GHSA-vfj7-8cjw-p6xm: braces vulnerable to stack-exhaustion denial of service through deeply nested patterns

**browserslist** v4.28.2 (transitive) - vulnerable range `<=4.28.6` - fix available (npm audit fix)
- GHSA-c83g-rgw3-j3cx: Browserslist: Unbounded memory growth (no cache eviction) via distinct query results, leading to eventual OOM
- GHSA-73wf-gq98-2v4g: Browserslist: Uncaught crash / prototype write via untrusted browserslist-stats.json custom stats (normalizeStats)

**devalue** v5.8.0 (transitive) - vulnerable range `<=5.9.2` - fix available (npm audit fix)
- GHSA-77vg-94rm-hx3p: Svelte devalue: DoS via sparse array deserialization
- GHSA-9rgm-9g3h-6x36: Svelte devalue: DoS via malformed input
- GHSA-j22f-vq7h-c4qm: devalue: `stringify`/`uneval` serialize shared memory
- GHSA-hx4r-w6wj-j8fg: devalue: Residual sparse-array CPU amplification in uneval
- GHSA-mcm9-63f2-9j32: devalue: Repeated primitive strings cause quadratic expansion in uneval
- GHSA-wf3x-273g-mvxv: devalue: Sparse arrays emitted by uneval cause eager allocation when evaluated
- GHSA-x5rw-q4pp-hg5g: devalue: stringifyAsync can cause an unhandled rejection despite a caught returned promise
- GHSA-4q55-j62x-fr9h: devalue: Malformed null-prototype object keys bypass __proto__ rejection via property-key coercion

**eslint-plugin-astro** v1.7.0 (direct) - vulnerable range `1.6.0 - 1.7.0` - fix: eslint-plugin-astro@3.2.1 (semver-major)
- via dependency `astro-eslint-parser`

**fast-glob** v3.3.3 (transitive) - vulnerable range `*` - fix: eslint-plugin-astro@3.2.1 (semver-major)
- via dependency `micromatch`

**fast-uri** v3.1.2 (transitive) - vulnerable range `3.0.0 - 3.1.7` - fix available (npm audit fix)
- GHSA-v2hh-gcrm-f6hx: fast-uri vulnerable to host confusion via literal backslash authority delimiter
- GHSA-7p8r-x3mc-p8w7: fast-uri vulnerable to host confusion via backslash authority introducer
- GHSA-f65p-4m7j-42xc: fast-uri vulnerable to server-side request forgery via malformed IPv6 normalization
- GHSA-fph4-wmhf-6fwf: fast-uri vulnerable to server-side request forgery via repeated hostname percent-decoding
- GHSA-jqff-g426-hqxp: fast-uri vulnerable to host confusion via percent-encoded scheme normalization
- GHSA-4c8g-83qw-93j6: fast-uri vulnerable to host confusion via failed IDN canonicalization
- GHSA-qw65-cvwx-89v3: fast-uri vulnerable to authority injection via an unvalidated port in serialize
- GHSA-hrr3-gc8f-f4qj: fast-uri vulnerable to inconsistent host case normalization via percent-encoded octets

**http-cache-semantics** v4.2.0 (transitive) - vulnerable range `<=4.2.0` - fix available (npm audit fix)
- GHSA-ch52-4w7c-c8xp: http-cache-semantics max-stale handling can disclose cross-user cached responses

**js-yaml** v4.1.1 (transitive) - vulnerable range `4.0.0 - 4.3.1` - fix available (npm audit fix)
- GHSA-h67p-54hq-rp68: JS-YAML: Quadratic-complexity DoS in merge key handling via repeated aliases
- GHSA-52cp-r559-cp3m: js-yaml: YAML merge-key chains can force quadratic CPU consumption
- GHSA-5p4m-2wfm-xmqj: JS-YAML: Quadratic CPU consumption in !!omap resolution (3.x and 4.x) — CVE-2026-59870 fix not backported
- GHSA-2883-xcg3-v3hh: js-yaml: maxTotalMergeKeys does not limit CPU use for empty merge sources

**micromatch** v4.0.8 (transitive) - vulnerable range `>=0.2.0` - fix: eslint-plugin-astro@3.2.1 (semver-major)
- via dependency `braces`

**miniflare** v4.20260507.1 (transitive) - vulnerable range `<=0.0.0-fff677e35 || 3.20250204.0 - 5.20260801.0-alpha` - fix available (npm audit fix)
- via dependency `sharp`
- via dependency `undici`
- via dependency `ws`

**nanoid** v3.3.12 (transitive) - vulnerable range `<=3.3.17` - fix available (npm audit fix)
- GHSA-28wg-ghj8-5hjv: nanoid: non-secure generators can loop indefinitely with negative size
- GHSA-2v37-7h3g-55p8: nanoid: custom generators can loop indefinitely when size is zero

**postcss** v8.5.14 (transitive) - vulnerable range `<=8.5.22` - fix available (npm audit fix)
- GHSA-fxqj-rqcc-2cmp: PostCSS: incomplete fix of GHSA-6g55-p6wh-862q — attacker-controlled sourceMappingURL reads arbitrary .map files when `from` is unset
- GHSA-r28c-9q8g-f849: PostCSS: Path Traversal in Previous Source Map Auto-Loading (sourceMappingURL) leads to Arbitrary .map File Disclosure

**sharp** v0.34.5 (transitive) - vulnerable range `<=0.35.5-rc.1` - fix available (npm audit fix)
- GHSA-f88m-g3jw-g9cj: sharp inherited vulnerabilities in libvips: CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591
- GHSA-rgj7-g3m4-5g8c: sharp: Vulnerabilities in libheif: GHSA-g89c-p67h-r497 and GHSA-2jg2-4ch7-h545
- GHSA-wq5f-xc86-pv6w: sharp : Vulnerability in librsvg dependency CVE-2026-96889

**smol-toml** v1.6.1 (transitive) - vulnerable range `<=1.8.0` - fix available (npm audit fix)
- GHSA-7w5x-hrqm-74c2: smol-toml: Denial of Service via malformed TOML documents
- GHSA-r4xh-jqrq-34v2: smol-toml: Quadratic-time parse() from parseKey rescanning to end of document on each key line

**source-map-js** v1.2.1 (transitive) - vulnerable range `1.0.0 - 1.2.1` - fix available (npm audit fix)
- GHSA-68fv-2mgg-jv7q: source-map-js allows event-loop denial of service through indexed source-map section offsets

**svgo** v4.0.1 (transitive) - vulnerable range `4.0.0 - 4.0.2` - fix available (npm audit fix)
- GHSA-2p49-hgcm-8545: SVGO removeScripts plugin leaves some executable scripts intact
- GHSA-w27v-7q3p-w38r: SVGO: removeScripts allows executable links through namespace and control-character bypasses
- GHSA-4vpr-x523-8j87: SVGO: removeScripts incompletely sanitizes executable HTML in SVG foreignObject elements

**undici** v7.24.8 (transitive) - vulnerable range `7.0.0 - 7.29.0` - fix available (npm audit fix)
- GHSA-vmh5-mc38-953g: undici vulnerable to TLS certificate validation bypass via dropped requestTls in SOCKS5 ProxyAgent
- GHSA-p88m-4jfj-68fv: undici vulnerable to HTTP header injection via Set-Cookie percent-decoding
- GHSA-vxpw-j846-p89q: undici WebSocket client vulnerable to denial of service via fragment count bypass
- GHSA-hm92-r4w5-c3mj: undici vulnerable to cross-origin request routing via SOCKS5 proxy pool reuse
- GHSA-g8m3-5g58-fq7m: undici vulnerable to Set-Cookie SameSite attribute downgrade via permissive substring matching
- GHSA-pr7r-676h-xcf6: undici vulnerable to cross-user information disclosure via shared cache whitespace bypass
- GHSA-8xcm-r25x-g524: undici vulnerable to downstream response desynchronization via retry interceptor
- GHSA-4cwx-7wf7-3272: undici vulnerable to cross-user information disclosure and parse-time crash via degenerate private cache directives
- GHSA-m8rv-5g2x-5cg5: undici vulnerable to CRLF Injection via blob-like body 'type' property
- GHSA-jr45-8vmc-qm54: undici vulnerable to cross-user information disclosure via whitespace around equals in Cache-Control directives
- GHSA-v3r7-h72x-cjcm: undici vulnerable to cookie attribute injection via unsanitized domain and unparsed setCookie fields
- GHSA-35p6-xmwp-9g52: undici vulnerable to HTTP response queue poisoning via keep-alive socket reuse
- GHSA-pmjh-fq2x-6v4x: undici vulnerable to Denial of Service via orphaned RetryHandler response body
- GHSA-r53p-7pc4-xj5r: undici vulnerable to downstream response splitting via retry interceptor
- GHSA-rfgv-xxqx-mfg5: undici vulnerable to Denial of Service via unrequested WebSocket subprotocol
- GHSA-3xpg-4rpp-hhhm: undici vulnerable to Denial of Service via unbounded decompression of compressed responses
- GHSA-2jfj-6hjv-fm6j: undici vulnerable to cross-user cookie disclosure via Set-Cookie caching in shared caches
- GHSA-2gqq-gqf2-x968: undici vulnerable to response truncation via oversized chunked responses in the dump interceptor
- GHSA-w293-vg96-wgc3: undici vulnerable to TLS certificate validation bypass via dropped connect options in BalancedPool
- GHSA-8436-99hf-9mmv: undici vulnerable to caching and replay of unsafe HTTP method responses
- GHSA-rx4f-c7p8-82vq: undici vulnerable to Denial of Service via WebSocketStream unclean close

**vite** v7.3.3 (transitive) - vulnerable range `7.0.0 - 7.3.3` - fix available (npm audit fix)
- GHSA-v6wh-96g9-6wx3: launch-editor: NTLMv2 hash disclosure via UNC path handling on Windows
- GHSA-fx2h-pf6j-xcff: vite: `server.fs.deny` bypass on Windows alternate paths

**ws** v8.18.0 (transitive) - vulnerable range `8.0.0 - 8.20.1` - fix available (npm audit fix)
- GHSA-58qx-3vcg-4xpx: ws: Uninitialized memory disclosure
- GHSA-96hv-2xvq-fx4p: ws: Memory exhaustion DoS from tiny fragments and data chunks


#### MODERATE findings

**@astrojs/language-server** v2.16.8 (transitive) - vulnerable range `2.14.0 - 2.16.10` - fix available (npm audit fix)
- via dependency `volar-service-yaml`

**@cloudflare/vite-plugin** v1.36.3 (transitive) - vulnerable range `<=0.0.0-fff677e35 || 0.0.7 - 1.41.0` - fix available (npm audit fix)
- via dependency `miniflare`
- via dependency `wrangler`
- via dependency `ws`

**baseline-browser-mapping** v2.10.27 (transitive) - vulnerable range `>=2.0.0 <2.11.0` - fix available (npm audit fix)
- GHSA-w5vr-8v7q-w6rv: baseline-browser-mapping process termination on invalid input causes denial of service

**postcss-selector-parser** v7.1.1 (transitive) - vulnerable range `<=7.1.5` - fix available (npm audit fix)
- GHSA-w9m9-85wc-3x92: postcss-selector-parser allows denial of service through uncontrolled AST recursion
- GHSA-rj75-hqrm-r3gf: PostCSS: Quadratic complexity in flat selector parsing allows CPU exhaustion

**supabase** v2.98.2 (direct) - vulnerable range `1.1.6 - 2.98.2` - fix available (npm audit fix)
- via dependency `tar`

**volar-service-yaml** v0.0.70 (transitive) - vulnerable range `<=0.0.70` - fix available (npm audit fix)
- via dependency `yaml-language-server`

**wrangler** v4.90.0 (direct) - vulnerable range `<=0.0.0-kickoff-demo || 3.108.0 - 4.101.0` - fix available (npm audit fix)
- via dependency `esbuild`
- via dependency `miniflare`

**yaml** v2.8.4 (transitive) - vulnerable range `2.0.0 - 2.8.2` - fix available (npm audit fix)
- GHSA-48c2-rrv3-qjmp: yaml is vulnerable to Stack Overflow via deeply nested YAML collections

**yaml-language-server** v1.20.0 (transitive) - vulnerable range `1.11.1-08d5f7b.0 - 1.21.1-f1f5a94.0 || 1.22.1-0ae5603.0 - 1.22.1-fc5f874.0` - fix available (npm audit fix)
- via dependency `yaml`


#### LOW / INFO findings

**@babel/core** v7.29.0 (transitive) - vulnerable range `<=7.29.0` - fix available (npm audit fix)
- GHSA-4x5r-pxfx-6jf8: @babel/core: Arbitrary File Read via sourceMappingURL Comment

**esbuild** v0.27.7 (transitive) - vulnerable range `0.27.3 - 0.28.0` - fix available (npm audit fix)
- GHSA-g7r4-m6w7-qqqr: esbuild allows arbitrary file read when running the development server on Windows


## Hints recorded but not acted on

| Hint                    | Value                |
| ----------------------- | -------------------- |
| bootstrapper_confidence | first-class          |
| quality_override        | false                |
| path_taken              | standard             |
| self_check_answers      | null                 |
| team_size               | solo                 |
| deployment_target       | cloudflare-pages     |
| ci_provider             | github-actions       |
| ci_default_flow         | auto-deploy-on-merge |
| has_auth                | true                 |
| has_payments            | false                |
| has_realtime            | false                |
| has_ai                  | false                |
| has_background_jobs     | false                |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified - happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review any `.scaffold` siblings the conflict policy created and decide which version of each file to keep.
- Address audit findings per your project's risk tolerance - the full breakdown is in this log.
## Post-bootstrap follow-up

Recorded 2026-10-13, after the user chose to adopt the starter's dependency set (option A).

**Reconciliation of the 47 `.scaffold` siblings**

- 12 files replaced by the starter's versions: `package.json`, `package-lock.json`, `eslint.config.js`, `tsconfig.json`, `.github/workflows/ci.yml`, `src/components/{Topbar,Welcome}.astro`, `src/layouts/Layout.astro`, `src/pages/auth/{signin,signup,confirm-email}.astro`, `src/lib/supabase.ts`. The diffs held only formatter changes, version bumps and compatibility fixes; no project-specific application code existed yet.
- `README.md` and `CLAUDE.md` were kept as they were. They still say Astro 6 / TypeScript 5, and `CLAUDE.md` lacks the `npm run smoke` line; the starter copies differ only by those lines.
- 33 identical copies and the 2 retained copies were deleted; no `.scaffold` file remains.
- Added `AGENTS.md` (a symlink to `CLAUDE.md`, as upstream) and `scripts/smoke.mjs`.

**Verification after adoption** (Windows, Node v24.20.0, placeholder `SUPABASE_URL` / `SUPABASE_KEY`)

| Gate                | Result                                                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ls --depth=0`  | consistent with the lockfile (exit 0)                                                                                                               |
| `astro sync`        | ok                                                                                                                                                  |
| `astro check`       | 0 errors, 0 warnings, 0 hints (29 files)                                                                                                            |
| `npm run build`     | ok (server output, Cloudflare adapter)                                                                                                              |
| `npm run lint`      | 1086 `prettier/prettier` errors, all "Delete ␍": the working tree is CRLF (`core.autocrlf=true`) and Prettier expects LF. With `endOfLine: auto` lint exits 0 |
| `npm audit`         | 0 CRITICAL, 9 HIGH, 2 MODERATE, 0 LOW (was 2/21/9/2 on the old lockfile); direct: `wrangler` (HIGH, non-major fix available)                       |
| `npm run smoke`     | not run (needs a reachable Supabase instance, e.g. Docker + Supabase CLI)                                                                           |
| esbuild / workerd   | binaries run (0.28.2 / 2026-09-11); their postinstall scripts are still not approved in `allowScripts`                                              |