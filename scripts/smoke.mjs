// Smoke test: proves the built app, the Cloudflare adapter, the Supabase auth flow and the role gate still work together,
// that the database role helpers read the role from the token, and that public registration stays closed. Zero
// dependencies on purpose. It creates real accounts with the service-role key, so it only runs against a LOCAL
// Supabase, and the app under test must read the same stack (.env / .dev.vars). Values come from `supabase status -o env`.
// Run against a live server:
//   BASE_URL=http://localhost:4321 SUPABASE_URL=<API_URL> SUPABASE_KEY=<ANON_KEY> SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY> \
//     node scripts/smoke.mjs

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4321";
const { SUPABASE_URL, SUPABASE_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const password = "Smoke-Test-Passw0rd!";
const runId = Date.now();
const throwawayEmail = `smoke-closed-${runId}@example.com`;

function abort(message) {
  console.error(`smoke: ${message}`);
  process.exit(1);
}

// Runs before the first request, so the service-role key can never reach a hosted project.
function requireLocalSupabase() {
  // SUPABASE_KEY (anon) is the app's own variable; the direct sign-up step sends it the way any client holding it could.
  const missing = ["SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_SERVICE_ROLE_KEY"].filter((name) => !process.env[name]);
  if (missing.length > 0) {
    abort(`missing environment variable(s): ${missing.join(", ")}`);
  }
  let url;
  try {
    url = new URL(SUPABASE_URL);
  } catch {
    abort("SUPABASE_URL is not a valid URL");
  }
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    abort(`refusing to run: SUPABASE_URL host must be 127.0.0.1 or localhost (got ${url.hostname})`);
  }
  return url.origin;
}

const supabaseOrigin = requireLocalSupabase();

function cookieHeader(jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function storeCookies(jar, response) {
  for (const raw of response.headers.getSetCookie()) {
    const [pair, ...attrs] = raw.split(";");
    const [name, ...rest] = pair.split("=");
    const expired = attrs.some((a) => /max-age=0/i.test(a.trim()));
    if (expired) jar.delete(name.trim());
    else jar.set(name.trim(), rest.join("="));
  }
}

// The path goes to fetch as a plain string on purpose: new URL(path, base) would rewrite "//planner" and "/%70lanner".
async function request(actor, path, { method = "GET", form, accept } = {}) {
  const response = await fetch(BASE_URL + path, {
    method,
    redirect: "manual",
    headers: {
      Cookie: cookieHeader(actor.jar),
      Origin: BASE_URL,
      ...(accept ? { Accept: accept } : {}),
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  storeCookies(actor.jar, response);
  return {
    status: response.status,
    location: response.headers.get("location") ?? "",
    contentType: response.headers.get("content-type") ?? "",
    body: await response.text(),
  };
}

async function createAccount(label, role) {
  const email = `smoke-${label}-${runId}@example.com`;
  let response;
  try {
    response = await fetch(`${supabaseOrigin}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password, email_confirm: true, ...(role ? { app_metadata: { role } } : {}) }),
    });
  } catch (error) {
    abort(`cannot reach SUPABASE_URL (${error.cause?.code ?? error.message})`);
  }
  if (!response.ok) {
    abort(`creating the ${label} account failed with status ${response.status}`);
  }
  return { label, email, jar: new Map() };
}

async function supabaseResult(response) {
  return {
    status: response.status,
    location: "",
    contentType: response.headers.get("content-type") ?? "",
    body: await response.text(),
  };
}

// The anon key is public, so Supabase must refuse sign-up even when the app is bypassed. Same headers as supabase-js.
async function supabaseSignup() {
  const response = await fetch(`${supabaseOrigin}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: throwawayEmail, password }),
  });
  return supabaseResult(response);
}

// The account's access token from a password grant, independent of the app's cookie jar. Fetched on first use and then
// reused, to stay well under the sign-in rate limit of the local Auth service.
async function accessToken(actor) {
  if (actor.token === undefined) {
    const response = await fetch(`${supabaseOrigin}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email: actor.email, password }),
    });
    if (!response.ok) {
      abort(`password grant for the ${actor.label} account failed with status ${response.status}`);
    }
    actor.token = (await response.json()).access_token;
  }
  return actor.token;
}

// Calls a database function through PostgREST. Without a token only the anon key is sent, like a client that never
// signed in.
async function rpc(name, token) {
  const response = await fetch(`${supabaseOrigin}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${token ?? SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  return supabaseResult(response);
}

// Every signed-in user may edit their own user_metadata, so Supabase is expected to accept this; the role must still
// come only from app_metadata.
async function forgeRole(actor, role) {
  const response = await fetch(`${supabaseOrigin}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${await accessToken(actor)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ data: { role } }),
  });
  // The cached token carries the old user_metadata; the next call signs in again and gets one with the forged role.
  actor.token = undefined;
  return supabaseResult(response);
}

function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

const anonymous = { label: "anonymous", jar: new Map() };
const noRole = await createAccount("no-role", null);
const employee = await createAccount("employee", "employee");
const planner = await createAccount("planner", "planner");

const visit = (actor, path, status) => [`${actor.label}: GET ${path}`, () => request(actor, path), { status }];

const signIn = (actor, hint) => [
  `${actor.label}: signin accepts correct password`,
  () => request(actor, "/api/auth/signin", { method: "POST", form: { email: actor.email, password } }),
  { status: 302, location: "/" },
  hint,
];

const signOut = (actor) => [
  `${actor.label}: signout clears session`,
  () => request(actor, "/api/auth/signout", { method: "POST" }),
  { status: 302, location: "/" },
];

// `json` is the exact value PostgREST must return; a SQL null comes back as the JSON literal null.
const rpcStep = (actor, name, json, note = "") => [
  `${actor.label}: rpc ${name} returns ${JSON.stringify(json)}${note}`,
  async () => rpc(name, await accessToken(actor)),
  { status: 200, json },
];

const steps = [
  // Anonymous: the gate answers 401 (never a redirect), JSON for API paths.
  visit(anonymous, "/", 200),
  visit(anonymous, "/dashboard", 401),
  visit(anonymous, "/planner", 401),
  visit(anonymous, "/employees", 401),
  [
    `${anonymous.label}: GET /api/employees`,
    () => request(anonymous, "/api/employees", { accept: "application/json" }),
    { status: 401, contentType: "application/json" },
  ],

  // Registration is closed, in the app and in Supabase itself.
  [
    `${anonymous.label}: POST /api/auth/signup`,
    () => request(anonymous, "/api/auth/signup", { method: "POST", form: { email: throwawayEmail, password } }),
    { status: 401, contentType: "application/json" },
  ],
  [`${anonymous.label}: Supabase rejects a direct sign-up`, supabaseSignup, { statusClass: 4 }],

  // Signed in without a role: every gated page is forbidden. This is the first sign-in against the app under test.
  signIn(noRole, "aplikacja pod testem nie używa SUPABASE_URL (sprawdź .env i .dev.vars)"),
  visit(noRole, "/dashboard", 403),
  visit(noRole, "/planner", 403),
  signOut(noRole),
  visit(noRole, "/dashboard", 401),

  // Employee: dashboard only; every spelling of the planner path stays closed.
  [
    `${employee.label}: signin rejects wrong password`,
    () => request(employee, "/api/auth/signin", { method: "POST", form: { email: employee.email, password: "wrong" } }),
    { status: 302, locationPrefix: "/auth/signin?error=" },
  ],
  signIn(employee),
  visit(employee, "/dashboard", 200),
  visit(employee, "/planner", 403),
  visit(employee, "/planner/", 403),
  visit(employee, "/%70lanner", 403),
  // The local preview server reads "//planner" as a protocol-relative URL and serves "/", so only the content is asserted:
  // whatever the status (403 where the path reaches the gate, 200 with the home page here), the planner page never shows.
  [
    `${employee.label}: GET //planner never serves the planner page`,
    () => request(employee, "//planner"),
    { bodyExcludes: "Panel planisty" },
  ],
  visit(employee, "/employees", 403),
  signOut(employee),
  visit(employee, "/dashboard", 401),

  // Planner: everything the gate lets through; /employees has no page, so it is a 404 rather than a 401/403.
  signIn(planner),
  visit(planner, "/dashboard", 200),
  visit(planner, "/planner", 200),
  visit(planner, "/planner/", 200),
  visit(planner, "/employees", 404),
  signOut(planner),
  visit(planner, "/dashboard", 401),

  // Database side: the same roles read from the token by the functions every RLS policy will call. The functions are
  // closed to the bare anon key.
  rpcStep(planner, "is_planner", true),
  rpcStep(planner, "current_app_role", "planner"),
  rpcStep(employee, "is_planner", false),
  rpcStep(employee, "current_app_role", "employee"),
  rpcStep(noRole, "is_planner", false),
  rpcStep(noRole, "current_app_role", null),
  [`${anonymous.label}: rpc is_planner is rejected`, () => rpc("is_planner"), { statusNotClass: 2 }],
  [`${anonymous.label}: rpc current_app_role is rejected`, () => rpc("current_app_role"), { statusNotClass: 2 }],

  // A forged role: editing user_metadata succeeds, and still grants nothing in the database or in the app.
  [
    `${employee.label}: Supabase accepts a user_metadata role edit`,
    () => forgeRole(employee, "planner"),
    { statusClass: 2 },
  ],
  rpcStep(employee, "is_planner", false, " after forging user_metadata"),
  rpcStep(employee, "current_app_role", "employee", " after forging user_metadata"),
  signIn(employee),
  visit(employee, "/planner", 403),
  signOut(employee),
];

let failed = 0;
for (const [name, run, expected, hint] of steps) {
  const actual = await run();
  const ok =
    (expected.status === undefined || actual.status === expected.status) &&
    (expected.statusClass === undefined || Math.floor(actual.status / 100) === expected.statusClass) &&
    (expected.statusNotClass === undefined || Math.floor(actual.status / 100) !== expected.statusNotClass) &&
    (expected.location === undefined || actual.location === expected.location) &&
    (expected.locationPrefix === undefined || actual.location.startsWith(expected.locationPrefix)) &&
    (expected.contentType === undefined || actual.contentType.startsWith(expected.contentType)) &&
    (expected.bodyExcludes === undefined || !actual.body.includes(expected.bodyExcludes)) &&
    (expected.json === undefined || parseJson(actual.body) === expected.json);
  const seen = [actual.status, actual.location, expected.contentType === undefined ? "" : actual.contentType];
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  -> ${seen.join(" ").trim()}`);
  if (!ok) {
    failed++;
    const wanted = [
      expected.status ?? (expected.statusClass === undefined ? "" : `${expected.statusClass}xx`),
      expected.statusNotClass === undefined ? "" : `anything but ${expected.statusNotClass}xx`,
      expected.location ?? expected.locationPrefix ?? "",
      expected.contentType ?? "",
      expected.bodyExcludes === undefined ? "" : `a body without "${expected.bodyExcludes}"`,
      expected.json === undefined ? "" : `a JSON body of ${JSON.stringify(expected.json)}`,
    ];
    console.log(`      expected ${wanted.filter(Boolean).join(" ")}`);
    if (expected.json !== undefined) console.log(`      got ${actual.body}`);
    if (hint) console.log(`      ${hint}`);
  }
}

console.log(failed ? `\n${failed} step(s) failed` : "\nAll smoke steps passed");
process.exit(failed ? 1 : 0);
