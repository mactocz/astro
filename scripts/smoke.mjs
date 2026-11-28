// Smoke test: proves the built app, the Cloudflare adapter, the Supabase auth flow and the role gate still work together,
// that the database role helpers read the role from the token, that only planners can read and write the employees,
// shifts and schedules tables through PostgREST (an employee with a linked account reads only their own employee row,
// and no session writes the user_id, invited_at and activated_at columns; the refusals of the database name their cause,
// the status with the SQLSTATE and the message, so a missing table or a mistyped argument does not pass for one), that a
// schedule is saved atomically through the save_schedule function (a save changes only the difference, so it keeps the
// assignments of what stays and refuses to drop those of a removed cell or person without a confirmation), that an
// assignment keeps to its foreign keys and constraints and only a planner reads and changes it, that an absence keeps to
// its constraints and column grants (no session writes its status, or the person of a row it changes), only a planner
// reads and changes it and it goes with its employee, that the absence API routes and pages open for the planner only (the
// routes keep to the validation and their status codes, a removal is idempotent, and the list and the forms show what the
// database holds, with no e-mail address), that the function mark_account_active records the activation of the
// caller's own row only (an account without a role, an anonymous caller and another employee change nothing, the first
// activation stays), that the employee, shift and schedule API
// routes keep to the role gate, the validation and their status codes (the routes that add and remove one assignment of
// a schedule are idempotent, and the save of a schedule answers 409 with the number of assignments it would remove until
// the body confirms the removal), that the view behind the schedule list counts the people and the required staffing of
// each schedule, hides them from everyone but a planner and takes no write, that the employee, shift and schedule pages
// open for the planner only (the schedule list, form and assignment page show what the database holds, down to which
// shift button of which person is on and which violations of the work-time rules the page lists for it: a schedule of
// four people, one for each rule scenario, is read down to the counter, every item with its reason, the marks of the
// day cells and what goes when one assignment is taken off, and, on schedules of their own, the hours of each person
// against the weekly norm of their FTE, down to the text of the column "Godziny", also in a week with a holiday, and, on
// two more schedules, the absences of the people (a shift on a day of an approved absence is a critical item, one on a day of
// a requested absence a warning, a rejected absence counts for nothing, an approved one lowers the norm, the day cells name
// the absence as text, and removing an absence takes away only what it caused); and
// the pages that list employees for the schedule form and the assignment grid carry no e-mail address), that the
// invitation mails link to the set-password page, the whole invitation flow (invite, invite again, password reset, a
// foreign account, the tokens from the admin API instead of the mails, the new employee's session, the activation time
// that the first password set records and a reset keeps, and the locked e-mail), what the pages of that flow show (the
// account column and invite button of the employee list, the locked e-mail field of the edit page, the password form of
// the set-password page; read from the HTML the server renders), that a schedule is approved only through the route or
// the function approve_schedule, which refuses stale data, critical findings and unconfirmed warnings, that an approved
// schedule takes no write (database and routes), keeps its copy of shifts and people and is read only on every page,
// that the routes of a generated proposal keep to the role gate, store it with the source generated only for a page that
// is up to date (all of it or nothing, an entry made by hand staying manual), remove only the generated entries and refuse
// an approved schedule, what the assignment page shows of the generator (the section "Generowanie" with its two buttons
// and the mark of a generated entry on a draft, none of it once approved), and that public registration stays closed. Zero
// dependencies on purpose. It creates real accounts and removes its own accounts, employee, shift and schedule rows
// with the service-role key, so it only runs against a LOCAL Supabase, and the app under test must read the same stack
// (.env / .dev.vars), including SUPABASE_SERVICE_ROLE_KEY: the invitation route reads it from there. Values come from
// `supabase status -o env`.
// Run against a live server:
//   BASE_URL=http://localhost:4321 SUPABASE_URL=<API_URL> SUPABASE_KEY=<ANON_KEY> SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY> \
//     node scripts/smoke.mjs

import { readFile } from "node:fs/promises";

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
// `form` sends a urlencoded body, `json` a JSON one, `jsonText` the given text under a JSON content type (to send what
// is not valid JSON); a request has at most one of them.
async function request(actor, path, { method = "GET", form, json, jsonText, accept } = {}) {
  const response = await fetch(BASE_URL + path, {
    method,
    redirect: "manual",
    headers: {
      Cookie: cookieHeader(actor.jar),
      Origin: BASE_URL,
      ...(accept ? { Accept: accept } : {}),
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(json === undefined && jsonText === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body:
      jsonText ??
      (json === undefined ? (form ? new URLSearchParams(form).toString() : undefined) : JSON.stringify(json)),
  });
  storeCookies(actor.jar, response);
  return {
    status: response.status,
    location: response.headers.get("location") ?? "",
    contentType: response.headers.get("content-type") ?? "",
    cacheControl: response.headers.get("cache-control") ?? "",
    referrerPolicy: response.headers.get("referrer-policy") ?? "",
    // The names of the cookies the response sets (the session cookie, for one).
    setCookies: response.headers.getSetCookie().map((raw) => raw.split("=")[0].trim()),
    body: await response.text(),
  };
}

// `email` replaces the default address of the account, for an account that must match an employee's e-mail.
async function createAccount(label, role, email = `smoke-${label}-${runId}@example.com`) {
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
  // The id links the account to an employee row in the account steps.
  const { id } = await response.json();
  return { label, email, id, jar: new Map() };
}

// Admin API calls with the service-role key; `path` continues after /auth/v1/admin/. `json` is sent as the body.
function adminRequest(method, path, json) {
  return fetch(`${supabaseOrigin}/auth/v1/admin/${path}`, {
    method,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      ...(json === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
}

const ACCOUNT_PAGE_SIZE = 1000;
const isSmokeAccount = (user) => /^smoke-[^@]+@example\.com$/.test(user?.email ?? "");

// Removes every account this and earlier runs left behind, whoever created it (createAccount here, the invitation route
// in the app): the e-mail starts with "smoke-" and ends with @example.com. Employee rows linked to an account keep
// existing (user_id is set to null); the next step deletes them by their own prefix. Answers like a response, so it can
// be a step.
async function deleteSmokeAccounts() {
  const ids = [];
  for (let page = 1; ; page++) {
    const response = await adminRequest("GET", `users?page=${page}&per_page=${ACCOUNT_PAGE_SIZE}`);
    const text = await response.text();
    const users = parseJson(text)?.users;
    if (!response.ok || !Array.isArray(users)) {
      return { status: response.ok ? 502 : response.status, location: "", contentType: "", body: text };
    }
    ids.push(...users.filter(isSmokeAccount).map((user) => user.id));
    if (users.length < ACCOUNT_PAGE_SIZE) break;
  }
  for (const id of ids) {
    const response = await adminRequest("DELETE", `users/${id}`);
    if (!response.ok) {
      return { status: response.status, location: "", contentType: "", body: await response.text() };
    }
  }
  return { status: 200, location: "", contentType: "", body: JSON.stringify({ deleted: ids.length }) };
}

// A mail template of the project, read from disk. Auth renders the mail itself; the step only proves the link in the file.
async function readTemplate(name) {
  try {
    const body = await readFile(new URL(`../supabase/templates/${name}`, import.meta.url), "utf8");
    return { status: 200, location: "", contentType: "", body };
  } catch {
    return { status: 404, location: "", contentType: "", body: "" };
  }
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

// Calls a database function through PostgREST; `args` is the object of named arguments (none for the role helpers).
// Without a token only the anon key is sent, like a client that never signed in.
async function rpc(name, token, args = {}) {
  const response = await fetch(`${supabaseOrigin}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${token ?? SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  return supabaseResult(response);
}

// Calls a table through PostgREST. Without a token only the anon key is sent, like a client that never signed in; `key`
// replaces the anon key in both headers (the service-role cleanup).
async function restTable(table, method, { token, key = SUPABASE_KEY, query = "", body, prefer } = {}) {
  const response = await fetch(`${supabaseOrigin}/rest/v1/${table}${query}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token ?? key}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return supabaseResult(response);
}

function employeesTable(method, options) {
  return restTable("employees", method, options);
}

function shiftsTable(method, options) {
  return restTable("shifts", method, options);
}

function schedulesTable(method, options) {
  return restTable("schedules", method, options);
}

function scheduleStaffingTable(method, options) {
  return restTable("schedule_staffing", method, options);
}

function scheduleEmployeesTable(method, options) {
  return restTable("schedule_employees", method, options);
}

function assignmentsTable(method, options) {
  return restTable("schedule_assignments", method, options);
}

function absencesTable(method, options) {
  return restTable("absences", method, options);
}

// The view the schedule list reads: one flat row per schedule with its two counts.
function scheduleSummariesTable(method, options) {
  return restTable("schedule_summaries", method, options);
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

// A predicate that throws on an unexpected body shape fails its step instead of crashing the whole run.
function passes(check, value) {
  try {
    return check(value) === true;
  } catch {
    return false;
  }
}

// The text a failed page step prints as what it got: the part of the page the check looked at, not the whole page.
function excerptOf(excerpt, body) {
  try {
    return excerpt(body);
  } catch {
    return "(no excerpt)";
  }
}

const anonymous = { label: "anonymous", jar: new Map() };
const noRole = await createAccount("no-role", null);
const employee = await createAccount("employee", "employee");
const planner = await createAccount("planner", "planner");
// An account without a role that already sits on the address of an employee (it dates from when sign-up was open): the
// invitation must refuse it instead of taking it over. Created here with the others; the final cleanup removes it.
const foreignEmail = `smoke-inv-${runId}-foreign@example.com`;
const foreignAccount = await createAccount("inv-foreign", null, foreignEmail);

const visit = (actor, path, status, bodyIncludes, cacheControl) => [
  `${actor.label}: GET ${path}`,
  () => request(actor, path),
  { status, bodyIncludes, cacheControl },
];

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

// The employees steps share one row. Its e-mail starts with "smoke-" and is lower case, because the table refuses
// anything else; the final cleanup step deletes by that prefix. The id is only known once the insert step has run.
const smokeEmployee = {
  first_name: "Smoke",
  last_name: `Smoke-${runId}`,
  email: `smoke-${runId}-roster@example.com`,
  fte_numerator: 1,
  fte_denominator: 2,
};
const patchedFte = { fte_numerator: 3, fte_denominator: 4 };
let smokeEmployeeId;
const smokeRow = () => `?id=eq.${smokeEmployeeId}`;

// `check` predicates receive the parsed body. A row from the database carries a random id and a timestamp, so it cannot
// be compared as a whole; every sent column is compared instead.
const isEmptyList = (rows) => Array.isArray(rows) && rows.length === 0;
const isSmokeEmployee = (changes) => (rows) =>
  Array.isArray(rows) &&
  rows.length === 1 &&
  typeof rows[0].id === "string" &&
  Object.entries({ ...smokeEmployee, ...changes }).every(([column, value]) => rows[0][column] === value);
// The error body names the violated constraint, so a rejection for any other reason does not pass.
const violates = (constraint) => (error) => typeof error?.message === "string" && error.message.includes(constraint);

// What a refusal by the database says about its cause. A status class proves little: a typo in an argument name or a stale
// schema cache answers 404 (PGRST202, PGRST205), which `statusNotClass` accepts as a refusal as well. So the refusals of the
// accounts without planner rights name the status, the SQLSTATE and the message that PostgREST gives for their cause (read
// from the local stack):
// - 42501 is a missing privilege, 403 for a signed-in caller and 401 for the anonymous one. A policy turns down the row of
//   an insert (`new row violates row-level security policy for table "<table>"`); a grant is missing (`permission denied
//   for table <table>`: nobody has delete on these tables, anon has nothing; `permission denied for function <name>`).
// - The policies hide the rows of an update or a delete from the caller. Nothing is refused, and no row is touched; the
//   request asks for the changed rows back (`Prefer: return=representation`), so the empty list that answers is the proof
//   of that (a bare 204 is also the answer of an update that worked).
// - PT404 (404) is a save of a schedule that the caller cannot see, which is the same as one that does not exist.
// The planner passes every policy of a table, so a refusal of the planner with 42501 can only come from the grants.
const isPermissionDenied = (error) => error?.code === "42501";
const messageIncludes = (error, text) => typeof error?.message === "string" && error.message.includes(text);
const isPolicyRefusal = (table) => (error) =>
  isPermissionDenied(error) && messageIncludes(error, `row-level security policy for table "${table}"`);
const isTableDenied = (table) => (error) =>
  isPermissionDenied(error) && messageIncludes(error, `permission denied for table ${table}`);
// Without execute the error names the function, while a caller that may execute it is stopped one step later, at the table
// (`permission denied for table schedules`). Only the first proves the revoke.
const isFunctionDeniedFor = (name) => (error) =>
  isPermissionDenied(error) && messageIncludes(error, `function ${name}`);
const isFunctionDenied = isFunctionDeniedFor("save_schedule");
// A view nobody may write (select is granted to signed-in users only). PostgreSQL words the error for a view as `permission
// denied for view <name>` and for a table as `permission denied for table <name>`, so either is accepted, as long as it
// names the view: a write refused one level down, at the table under the view, names that table instead.
const isViewDenied = (view) => (error) =>
  isPermissionDenied(error) && new RegExp(`permission denied for (?:view|table) ${view}\\b`).test(error?.message ?? "");
const isScheduleNotFound = (error) => error?.code === "PT404" && error?.message === "Schedule not found";

const policyTurnsDown = (table) => ({
  status: 403,
  check: isPolicyRefusal(table),
  describe: `a permission error (42501) from the row-level security policy of ${table}`,
});
const tableDenied = (table, status = 403) => ({
  status,
  check: isTableDenied(table),
  describe: `a permission error (42501) for the table ${table}`,
});
const anonymousTableDenied = (table) => tableDenied(table, 401);
const viewDenied = (view, status = 403) => ({
  status,
  check: isViewDenied(view),
  describe: `a permission error (42501) for the view ${view}`,
});
const anonymousViewDenied = (view) => viewDenied(view, 401);
const anonymousFunctionDenied = (name) => ({
  status: 401,
  check: isFunctionDeniedFor(name),
  describe: `a permission error (42501) for the function ${name}`,
});
const rowsHidden = {
  status: 200,
  check: isEmptyList,
  describe: "an empty list: the policies hide every row, so none is touched",
};
const scheduleHidden = {
  status: 404,
  check: isScheduleNotFound,
  describe: "an error with the code PT404 and the message Schedule not found",
};
const asksForChangedRows = "return=representation";

const plannerReadsEmployee = (name, changes, describe) => [
  `${planner.label}: ${name}`,
  async () => employeesTable("GET", { token: await accessToken(planner), query: smokeRow() }),
  { status: 200, check: isSmokeEmployee(changes), describe },
];

// A signed-in account without planner rights: the table looks empty, the policy turns down an insert, an update hides the
// row (nothing is touched) and nobody has the grant to delete. Each answer names its cause (see `policyTurnsDown`); the
// planner's read afterwards is the proof that the row did not change.
const notPlannerEmployeeSteps = (actor) => [
  [
    `${actor.label}: employees read returns an empty list`,
    async () => employeesTable("GET", { token: await accessToken(actor), query: "?select=id" }),
    { status: 200, check: isEmptyList, describe: "an empty list" },
  ],
  [
    `${actor.label}: employees insert is rejected`,
    async () =>
      employeesTable("POST", {
        token: await accessToken(actor),
        body: { ...smokeEmployee, email: `smoke-${runId}-${actor.label}@example.com` },
      }),
    policyTurnsDown("employees"),
  ],
  [
    `${actor.label}: employees update changes no row`,
    async () =>
      employeesTable("PATCH", {
        token: await accessToken(actor),
        query: smokeRow(),
        body: { fte_numerator: 1, fte_denominator: 1 },
        prefer: asksForChangedRows,
      }),
    rowsHidden,
  ],
  [
    `${actor.label}: employees delete is rejected`,
    async () => employeesTable("DELETE", { token: await accessToken(actor), query: smokeRow() }),
    tableDenied("employees"),
  ],
  plannerReadsEmployee(
    `employees row is unchanged after ${actor.label} write attempts`,
    patchedFte,
    "the smoke employee with FTE 3/4",
  ),
];

// The shifts steps share two rows with one name. The name starts with "Smoke-" because the final cleanup step
// deletes by that prefix. The first shift runs 22:00-06:00, which only a schema that lets the end be earlier than the
// start accepts; the second has other times, which only a schema without a unique name accepts. The ids are only known
// once the insert steps have run.
const smokeShift = { name: `Smoke-${runId}-db`, start_minute: 1320, end_minute: 360 };
const sameNameShift = { name: smokeShift.name, start_minute: 360, end_minute: 840 };
const patchedShift = { end_minute: 420 };
let smokeShiftId;
let sameNameShiftId;
const smokeShiftRow = () => `?id=eq.${smokeShiftId}`;

// A row from the database carries a random id and a timestamp, so every sent column is compared instead.
const hasColumns = (row, columns) => Object.entries(columns).every(([column, value]) => row?.[column] === value);
const isInsertedShift = (columns) => (rows) =>
  Array.isArray(rows) && rows.length === 1 && typeof rows[0].id === "string" && hasColumns(rows[0], columns);
// Both rows of the smoke name, each found by the id its insert step returned; `changes` replace the first row's
// columns.
const isSmokeShifts = (changes) => (rows) =>
  Array.isArray(rows) &&
  rows.length === 2 &&
  typeof smokeShiftId === "string" &&
  typeof sameNameShiftId === "string" &&
  hasColumns(
    rows.find((row) => row.id === smokeShiftId),
    { ...smokeShift, ...changes },
  ) &&
  hasColumns(
    rows.find((row) => row.id === sameNameShiftId),
    sameNameShift,
  );

const plannerReadsShifts = (name, changes, describe) => [
  `${planner.label}: ${name}`,
  async () => shiftsTable("GET", { token: await accessToken(planner), query: `?name=eq.${smokeShift.name}` }),
  { status: 200, check: isSmokeShifts(changes), describe },
];

// Each rejected insert breaks exactly one boundary, so the constraint named in the error is the proof of why.
const plannerRejectsShift = (description, body, constraint) => [
  `${planner.label}: shifts insert ${description} is rejected`,
  async () => shiftsTable("POST", { token: await accessToken(planner), body }),
  { statusNotClass: 2, check: violates(constraint), describe: `an error naming ${constraint}` },
];

// A signed-in account without planner rights: the table looks empty, the policy turns down an insert, an update hides the
// rows (nothing is touched) and nobody has the grant to delete. Each answer names its cause (see `policyTurnsDown`); the
// planner's read afterwards is the proof that the rows did not change.
const notPlannerShiftSteps = (actor) => [
  [
    `${actor.label}: shifts read returns an empty list`,
    async () => shiftsTable("GET", { token: await accessToken(actor), query: "?select=id" }),
    { status: 200, check: isEmptyList, describe: "an empty list" },
  ],
  [
    `${actor.label}: shifts insert is rejected`,
    async () =>
      shiftsTable("POST", {
        token: await accessToken(actor),
        body: { ...smokeShift, name: `Smoke-${runId}-${actor.label}` },
      }),
    policyTurnsDown("shifts"),
  ],
  [
    `${actor.label}: shifts update changes no row`,
    async () =>
      shiftsTable("PATCH", {
        token: await accessToken(actor),
        query: smokeShiftRow(),
        body: { end_minute: 600 },
        prefer: asksForChangedRows,
      }),
    rowsHidden,
  ],
  [
    `${actor.label}: shifts delete is rejected`,
    async () => shiftsTable("DELETE", { token: await accessToken(actor), query: smokeShiftRow() }),
    tableDenied("shifts"),
  ],
  plannerReadsShifts(
    `shifts rows are unchanged after ${actor.label} write attempts`,
    patchedShift,
    "both smoke shifts, the first one ending at minute 420",
  ),
];

// The employee account steps share two rows, each linked to an account by the service-role key, because only that key
// writes user_id and invited_at. The first row belongs to the employee account, the second to the account without a
// role. Their e-mails start with "smoke-" like every row the final cleanup step deletes. The ids are only known once the
// insert steps have run.
const ownEmployee = {
  first_name: "Smoke",
  last_name: `Smoke-${runId}-own`,
  email: `smoke-${runId}-own@example.com`,
  fte_numerator: 1,
  fte_denominator: 2,
};
const noRoleEmployee = {
  ...ownEmployee,
  last_name: `Smoke-${runId}-no-role`,
  email: `smoke-${runId}-no-role@example.com`,
};
// The invitation time the service role writes into the first row, and the one a planner then fails to write over it.
const invitedAt = "2026-11-01T08:00:00+00:00";
const plannerInvitedAt = "2026-11-02T08:00:00+00:00";
let ownEmployeeId;
let noRoleEmployeeId;
// The activation time the employee account gets from its own call of mark_account_active.
let ownActivatedAt;
const ownRow = () => `?id=eq.${ownEmployeeId}`;
const noRoleRow = () => `?id=eq.${noRoleEmployeeId}`;

// PostgREST writes a timestamp in its own notation, so instants are compared, not strings.
const sameInstant = (value, expected) => typeof value === "string" && Date.parse(value) === Date.parse(expected);
const isInsertedEmployee = (columns) => (rows) =>
  Array.isArray(rows) && rows.length === 1 && typeof rows[0].id === "string" && hasColumns(rows[0], columns);
// Exactly the first row, linked to the employee account and invited at the time the service role wrote; `changes`
// replace columns of the inserted row.
const isOwnRow = (changes) => (rows) =>
  Array.isArray(rows) &&
  rows.length === 1 &&
  typeof ownEmployeeId === "string" &&
  hasColumns(rows[0], { ...ownEmployee, ...changes, id: ownEmployeeId, user_id: employee.id }) &&
  sameInstant(rows[0].invited_at, invitedAt);
const isLinkedToNoRoleAccount = (rows) =>
  Array.isArray(rows) &&
  rows.length === 1 &&
  typeof noRoleEmployeeId === "string" &&
  hasColumns(rows[0], { id: noRoleEmployeeId, user_id: noRole.id });

const plannerReadsOwnRow = (name, changes, describe) => [
  `${planner.label}: ${name}`,
  async () => employeesTable("GET", { token: await accessToken(planner), query: ownRow() }),
  { status: 200, check: isOwnRow(changes), describe },
];

// The planner writes a column only the service role may write: refused with a permission error, whatever the value. The
// planner passes every policy of the table, so a refusal with this code can only come from the column grants. `build`
// returns the query and body when the step runs, because the row id is only known by then.
const plannerWriteIsDenied = (description, method, build) => [
  `${planner.label}: employees ${description} is refused`,
  async () => employeesTable(method, { token: await accessToken(planner), ...build() }),
  { statusNotClass: 2, check: isPermissionDenied, describe: "a permission error (42501)" },
];

// The API steps share one employee, created through the app by the planner. Names with Polish letters and a mixed-case
// e-mail on purpose: the app must keep the letters and answer with the e-mail in lower case (smoke-<runId>@example.com,
// which the final cleanup step deletes by prefix). The FTE 2/4 comes back reduced to 1/2. The id is only known once
// the create step has run.
const apiEmployee = {
  firstName: "Małgorzata",
  lastName: `Łukasz-Smoke-${runId}`,
  email: `Smoke-${runId}@Example.com`,
  fteNumerator: 2,
  fteDenominator: 4,
};
// A second employee, so the PUT conflict step has another person's e-mail to collide with.
const secondApiEmployee = { ...apiEmployee, firstName: "Zofia", email: `Smoke-${runId}-second@Example.com` };
const apiEmployeeUrl = () => `/api/employees/${apiEmployeeId}`;
// The gate answers before the route or the page runs, so the employee's requests may name an id that does not exist.
const unknownEmployeeId = "00000000-0000-4000-8000-000000000000";
const unknownEmployeeUrl = `/api/employees/${unknownEmployeeId}`;
const emailTakenMessage = "Ten adres e-mail jest już przypisany do innego pracownika.";
let apiEmployeeId;
// The id of the second employee, which the schedules API steps put next to the first one.
let secondApiEmployeeId;

// The form page of the employee the planner creates. Its address needs the id, which only exists once the create step
// has run, so it is built when the step runs.
const visitApiEmployeePage = (actor, status, bodyIncludes, cacheControl) => [
  `${actor.label}: GET /employees/<id>`,
  () => request(actor, `/employees/${apiEmployeeId}`),
  { status, bodyIncludes, cacheControl },
];
const notFoundMessage = "Nie znaleziono pracownika";

// The route answers with the camelCase employee: names as sent, the e-mail in lower case, the FTE in lowest terms.
const isApiEmployee = (fte) => (body) =>
  typeof body.employee.id === "string" &&
  body.employee.id === apiEmployeeId &&
  typeof body.employee.createdAt === "string" &&
  body.employee.firstName === apiEmployee.firstName &&
  body.employee.lastName === apiEmployee.lastName &&
  body.employee.email === apiEmployee.email.toLowerCase() &&
  body.employee.fte.numerator === fte.numerator &&
  body.employee.fte.denominator === fte.denominator;
const isEmailTaken = (body) => body.errors.email === emailTakenMessage;
const isSecondApiEmployee = (body) =>
  typeof body.employee.id === "string" &&
  body.employee.id !== apiEmployeeId &&
  body.employee.email === secondApiEmployee.email.toLowerCase();
const rejectsFteAndLastName = (body) =>
  typeof body.errors.fte === "string" &&
  typeof body.errors.lastName === "string" &&
  body.errors.firstName === undefined &&
  body.errors.email === undefined;
const isNotFound = (body) => body.error === "not_found";
const isInvalidJson = (body) => body.error === "invalid_json";

const plannerPutsEmployee = (name, path, expected) => [
  `${planner.label}: PUT ${name}`,
  () => request(planner, path(), { method: "PUT", json: { ...apiEmployee, fteNumerator: 3, fteDenominator: 4 } }),
  { contentType: "application/json", ...expected },
];

// The shift API steps share one shift, created through the app by the planner. Its name has Polish letters, a double
// space in the middle and a trailing space on purpose: the app must answer with the name trimmed and collapsed to single
// spaces (Smoke-<runId>-Nocna Łąka, which the final cleanup step deletes by prefix). It runs 22:00-06:00, so the end
// comes back as minute 360, earlier than the start at minute 1320. A second shift has the same name and other times,
// because a name is not unique. The id is only known once the create step has run.
const apiShift = { name: `Smoke-${runId}-Nocna  Łąka `, startTime: "22:00", endTime: "06:00" };
const apiShiftName = `Smoke-${runId}-Nocna Łąka`;
const secondApiShift = { ...apiShift, startTime: "06:00", endTime: "14:00" };
const changedApiShift = { ...apiShift, endTime: "07:00" };
const apiShiftUrl = () => `/api/shifts/${apiShiftId}`;
// A well-formed UUID that no row has; the gate answers before the route or the page runs, so the employee's requests may
// name it too.
const unknownShiftId = "00000000-0000-4000-8000-000000000000";
const unknownShiftUrl = `/api/shifts/${unknownShiftId}`;
let apiShiftId;
// The id of the second shift, which the schedules API steps put next to the first one.
let secondApiShiftId;

// The form page of the shift the planner creates. Its address needs the id, which only exists once the create step has
// run, so it is built when the step runs.
const visitApiShiftPage = (actor, status, bodyIncludes) => [
  `${actor.label}: GET /shifts/<id>`,
  () => request(actor, `/shifts/${apiShiftId}`),
  { status, bodyIncludes },
];
const notFoundShiftMessage = "Nie znaleziono zmiany";

// The route answers with the camelCase shift: the normalised name and the times as minutes after midnight.
const isApiShift = (endMinute) => (body) =>
  typeof body.shift.id === "string" &&
  body.shift.id === apiShiftId &&
  typeof body.shift.createdAt === "string" &&
  body.shift.name === apiShiftName &&
  body.shift.startMinute === 1320 &&
  body.shift.endMinute === endMinute;
const isSecondApiShift = (body) =>
  typeof body.shift.id === "string" &&
  body.shift.id !== apiShiftId &&
  body.shift.name === apiShiftName &&
  body.shift.startMinute === 360 &&
  body.shift.endMinute === 840;
const rejectsNameAndStartTime = (body) =>
  typeof body.errors.name === "string" &&
  typeof body.errors.startTime === "string" &&
  body.errors.endTime === undefined;
const rejectsEndTimeOnly = (body) =>
  typeof body.errors.endTime === "string" && body.errors.name === undefined && body.errors.startTime === undefined;

// A body that fails on the name and the start time at once, to be sent to POST and to PUT.
const invalidApiShift = { ...apiShift, name: "", startTime: "25:00" };

const plannerPutsShift = (name, path, expected, json = changedApiShift) => [
  `${planner.label}: PUT ${name}`,
  () => request(planner, path(), { method: "PUT", json }),
  { contentType: "application/json", ...expected },
];

// The schedules steps share one schedule, saved through the save_schedule function. Its label starts with "Smoke-"
// because the final cleanup step deletes by that prefix. The shifts and people it refers to are rows created earlier in
// this run (the two shifts and the employee of the database steps, the employee of the API steps), so their ids are
// only known once those steps have run, and every state below is a function. The schedule is created as
// `createdSchedule` (3 cells of 2 shifts, 2 people) and then replaced with `replacedSchedule`: another start date and
// label, one cell gone (first shift, day 1), one cell with another count (second shift, day 0), one cell new (second
// shift, day 6) and one person gone. `trimmedSchedule` is that state after the planner deletes the new cell directly.
const smokeScheduleLabel = `Smoke-${runId}-schedule`;
const unknownScheduleId = "00000000-0000-4000-8000-000000000000";
let smokeScheduleId;
const smokeScheduleRow = () => `?id=eq.${smokeScheduleId}`;
const smokeScheduleChildren = () => `?schedule_id=eq.${smokeScheduleId}`;

const createdSchedule = () => ({
  startDate: "2026-11-11",
  label: smokeScheduleLabel,
  staffing: [
    { shiftId: smokeShiftId, dayOffset: 0, requiredCount: 2 },
    { shiftId: smokeShiftId, dayOffset: 1, requiredCount: 3 },
    { shiftId: sameNameShiftId, dayOffset: 0, requiredCount: 1 },
  ],
  employeeIds: [smokeEmployeeId, apiEmployeeId],
});
const replacedSchedule = () => ({
  startDate: "2026-11-15",
  label: `Smoke-${runId}-replaced`,
  staffing: [
    { shiftId: smokeShiftId, dayOffset: 0, requiredCount: 2 },
    { shiftId: sameNameShiftId, dayOffset: 0, requiredCount: 4 },
    { shiftId: sameNameShiftId, dayOffset: 6, requiredCount: 5 },
  ],
  employeeIds: [smokeEmployeeId],
});
const trimmedSchedule = () => ({
  ...replacedSchedule(),
  staffing: replacedSchedule().staffing.filter((cell) => !(cell.shiftId === sameNameShiftId && cell.dayOffset === 6)),
});

// Saves that must fail as a whole, each with a different broken cell: a required count of 0, a shift that does not
// exist, and a required count of 0 in a replacement of the existing schedule (whose new date and label must not stick).
const zeroCountSchedule = () => ({
  ...createdSchedule(),
  label: `Smoke-${runId}-atomic-count`,
  staffing: [{ shiftId: smokeShiftId, dayOffset: 0, requiredCount: 0 }],
});
const unknownShiftSchedule = () => ({
  ...createdSchedule(),
  label: `Smoke-${runId}-atomic-shift`,
  staffing: [{ shiftId: unknownShiftId, dayOffset: 0, requiredCount: 1 }],
});
const failedReplacement = () => ({
  ...replacedSchedule(),
  startDate: "2026-12-02",
  label: `Smoke-${runId}-replace-fail`,
  staffing: [{ shiftId: smokeShiftId, dayOffset: 3, requiredCount: 0 }],
  employeeIds: [smokeEmployeeId, apiEmployeeId],
});

// The named arguments of save_schedule for a state; an `id` of null creates a schedule, any other saves over that one.
// `confirmRemovals` says whether the assignments of a removed cell or person may go with it; the function has no default
// arguments, so all six are always sent (an explicit null is the caller's to pass).
const saveScheduleArgs = (state, id = null, confirmRemovals = false) => ({
  p_schedule_id: id,
  p_start_date: state.startDate,
  p_label: state.label,
  p_staffing: state.staffing,
  p_employee_ids: state.employeeIds,
  p_confirm_removals: confirmRemovals,
});

// `check` predicates for the three tables, each given the state the schedule should be in and, as a function, the id of
// the schedule (the smoke schedule unless another one is named). The cells and the people come back in no promised
// order, so they are compared as sorted lists; a row from the database carries a timestamp, so the header is compared
// column by column.
const isUuidText = (value) =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const sameItems = (actual, expected) => JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
const cellKey = (shiftId, dayOffset, requiredCount) => `${shiftId}/${dayOffset}/${requiredCount}`;
const isScheduleHeader =
  (state, id = () => smokeScheduleId) =>
  (rows) =>
    Array.isArray(rows) &&
    rows.length === 1 &&
    rows[0].id === id() &&
    typeof rows[0].created_at === "string" &&
    rows[0].start_date === state().startDate &&
    rows[0].label === state().label;
const isScheduleCells =
  (state, id = () => smokeScheduleId) =>
  (rows) =>
    Array.isArray(rows) &&
    rows.every((row) => row.schedule_id === id()) &&
    sameItems(
      rows.map((row) => cellKey(row.shift_id, row.day_offset, row.required_count)),
      state().staffing.map((cell) => cellKey(cell.shiftId, cell.dayOffset, cell.requiredCount)),
    );
const isSchedulePeople =
  (state, id = () => smokeScheduleId) =>
  (rows) =>
    Array.isArray(rows) &&
    rows.every((row) => row.schedule_id === id()) &&
    sameItems(
      rows.map((row) => row.employee_id),
      state().employeeIds,
    );

// Reads the header, the cells and the people of a schedule back in three steps and compares each with `state`. The
// schedule is the smoke schedule unless `id` (a function, like `state`) names another one.
const plannerReadsSchedule = (name, state, what, id = () => smokeScheduleId) => [
  [
    `${planner.label}: schedules read ${name}`,
    async () => schedulesTable("GET", { token: await accessToken(planner), query: `?id=eq.${id()}` }),
    { status: 200, check: isScheduleHeader(state, id), describe: `the header of ${what}` },
  ],
  [
    `${planner.label}: schedule_staffing read ${name}`,
    async () => scheduleStaffingTable("GET", { token: await accessToken(planner), query: `?schedule_id=eq.${id()}` }),
    { status: 200, check: isScheduleCells(state, id), describe: `exactly the cells of ${what}` },
  ],
  [
    `${planner.label}: schedule_employees read ${name}`,
    async () => scheduleEmployeesTable("GET", { token: await accessToken(planner), query: `?schedule_id=eq.${id()}` }),
    { status: 200, check: isSchedulePeople(state, id), describe: `exactly the people of ${what}` },
  ],
];

// A save that must be rejected; the error names the broken constraint, so a rejection for any other reason does not
// pass. `id` is a function because the id of the smoke schedule is only known once the create step has run.
const plannerRejectsSave = (description, state, constraint, id = () => null) => [
  `${planner.label}: rpc save_schedule ${description} is rejected`,
  async () => rpc("save_schedule", await accessToken(planner), saveScheduleArgs(state(), id())),
  { statusNotClass: 2, check: violates(constraint), describe: `an error naming ${constraint}` },
];

// Each rejected insert breaks exactly one boundary, so the constraint named in the error is the proof of why. `body` is
// a function for the same reason as `id` above.
const scheduleTables = {
  schedules: schedulesTable,
  schedule_staffing: scheduleStaffingTable,
  schedule_employees: scheduleEmployeesTable,
  schedule_assignments: assignmentsTable,
};
const plannerRejectsScheduleRow = (table, description, body, constraint) => [
  `${planner.label}: ${table} insert ${description} is rejected`,
  async () => scheduleTables[table]("POST", { token: await accessToken(planner), body: body() }),
  { statusNotClass: 2, check: violates(constraint), describe: `an error naming ${constraint}` },
];

// A signed-in account without planner rights: the tables look empty, a save and the inserts are refused (the policy turns
// down a new schedule, and a save of the existing one finds no schedule), the updates and the deletes of the child rows
// touch no row (the policies hide them), and nobody has the grant to delete a schedule. Each answer names its cause (see
// `policyTurnsDown`). The planner's reads afterwards are the proof that nothing changed, and one of them that the refused
// saves left no schedule behind under their labels. The children have no id column, hence select=schedule_id.
const notPlannerScheduleSteps = (actor) => [
  [
    `${actor.label}: schedules read returns an empty list`,
    async () => schedulesTable("GET", { token: await accessToken(actor), query: "?select=id" }),
    { status: 200, check: isEmptyList, describe: "an empty list" },
  ],
  [
    `${actor.label}: schedule_staffing read returns an empty list`,
    async () => scheduleStaffingTable("GET", { token: await accessToken(actor), query: "?select=schedule_id" }),
    { status: 200, check: isEmptyList, describe: "an empty list" },
  ],
  [
    `${actor.label}: schedule_employees read returns an empty list`,
    async () => scheduleEmployeesTable("GET", { token: await accessToken(actor), query: "?select=schedule_id" }),
    { status: 200, check: isEmptyList, describe: "an empty list" },
  ],
  // The view is granted to every signed-in user and reads the three tables with the rights of the caller, so what keeps
  // the schedules from this caller is their policies: an empty list (200), not a permission error and not the rows.
  [
    `${actor.label}: schedule_summaries read returns an empty list`,
    async () => scheduleSummariesTable("GET", { token: await accessToken(actor), query: "?select=id" }),
    {
      status: 200,
      check: isEmptyList,
      describe: "an empty list: the policies of the tables under the view hide every schedule",
    },
  ],
  [
    `${actor.label}: rpc save_schedule creating a schedule is rejected`,
    async () =>
      rpc(
        "save_schedule",
        await accessToken(actor),
        saveScheduleArgs({ ...createdSchedule(), label: `Smoke-${runId}-${actor.label}-rpc-create` }),
      ),
    policyTurnsDown("schedules"),
  ],
  [
    `${actor.label}: rpc save_schedule replacing the schedule is rejected`,
    async () =>
      rpc(
        "save_schedule",
        await accessToken(actor),
        saveScheduleArgs({ ...createdSchedule(), label: `Smoke-${runId}-${actor.label}-rpc-replace` }, smokeScheduleId),
      ),
    scheduleHidden,
  ],
  // Both refused saves carry a label of this pattern: a refusal that stored a schedule anyway would show up here.
  [
    `${planner.label}: schedules read finds no schedule left by the rpc calls of ${actor.label}`,
    async () =>
      schedulesTable("GET", {
        token: await accessToken(planner),
        query: `?label=like.Smoke-${runId}-${actor.label}-rpc*`,
      }),
    { status: 200, check: isEmptyList, describe: "an empty list" },
  ],
  [
    `${actor.label}: schedules insert is rejected`,
    async () =>
      schedulesTable("POST", {
        token: await accessToken(actor),
        body: { start_date: "2026-11-11", label: `Smoke-${runId}-${actor.label}-insert` },
      }),
    policyTurnsDown("schedules"),
  ],
  [
    `${actor.label}: schedule_staffing insert is rejected`,
    async () =>
      scheduleStaffingTable("POST", {
        token: await accessToken(actor),
        body: { schedule_id: smokeScheduleId, shift_id: sameNameShiftId, day_offset: 3, required_count: 1 },
      }),
    policyTurnsDown("schedule_staffing"),
  ],
  [
    `${actor.label}: schedule_employees insert is rejected`,
    async () =>
      scheduleEmployeesTable("POST", {
        token: await accessToken(actor),
        body: { schedule_id: smokeScheduleId, employee_id: apiEmployeeId },
      }),
    policyTurnsDown("schedule_employees"),
  ],
  [
    `${actor.label}: schedules update changes no row`,
    async () =>
      schedulesTable("PATCH", {
        token: await accessToken(actor),
        query: smokeScheduleRow(),
        body: { start_date: "2026-12-01" },
        prefer: asksForChangedRows,
      }),
    rowsHidden,
  ],
  [
    `${actor.label}: schedules delete is rejected`,
    async () => schedulesTable("DELETE", { token: await accessToken(actor), query: smokeScheduleRow() }),
    tableDenied("schedules"),
  ],
  [
    `${actor.label}: schedule_staffing delete removes no row`,
    async () =>
      scheduleStaffingTable("DELETE", {
        token: await accessToken(actor),
        query: smokeScheduleChildren(),
        prefer: asksForChangedRows,
      }),
    rowsHidden,
  ],
  [
    `${actor.label}: schedule_employees delete removes no row`,
    async () =>
      scheduleEmployeesTable("DELETE", {
        token: await accessToken(actor),
        query: smokeScheduleChildren(),
        prefer: asksForChangedRows,
      }),
    rowsHidden,
  ],
  ...plannerReadsSchedule(
    `is unchanged after ${actor.label} write attempts`,
    replacedSchedule,
    "the replaced schedule, unchanged",
  ),
];

// The view schedule_summaries (what the schedule list reads): one flat row per schedule with the number of people on its
// roster and the sum of its required counts, worked out by the database. The steps read it for four schedules of this run
// whose numbers all differ, so a swapped, repeated or joined (cells x people) aggregate cannot pass: the schedule of the
// database steps (1 person, 6 = 2 + 4), the one of the API steps (2 people, 8 = 5 + 1 + 2), the one of the assignment routes
// (2 people, 1) and a schedule without cells and people, which the planner inserts into the table directly (the app never
// saves one, but the table allows it) and which the view must still list, with zeros. The last one is also the row the
// refused writes to the view aim at. Its id is only known once its insert step has run.
const emptyScheduleLabel = `Smoke-${runId}-empty`;
const emptyScheduleStartDate = "2026-11-09";
let emptyScheduleId;
// The labels that the refused writes to the view carry: a write that went through would leave a schedule under them.
const summaryWriteLabel = `Smoke-${runId}-view`;
const SUMMARY_COLUMNS = [
  "approved_at",
  "created_at",
  "employee_count",
  "id",
  "label",
  "start_date",
  "status",
  "total_required",
];
// Exactly one row for a draft, with exactly the eight columns of the view; the counts are numbers, compared strictly.
const isScheduleSummary = (id, expected) => (rows) =>
  Array.isArray(rows) &&
  rows.length === 1 &&
  sameItems(Object.keys(rows[0]), SUMMARY_COLUMNS) &&
  rows[0].id === id() &&
  typeof rows[0].created_at === "string" &&
  rows[0].start_date === expected().startDate &&
  rows[0].label === expected().label &&
  rows[0].employee_count === expected().employeeCount &&
  rows[0].total_required === expected().totalRequired &&
  rows[0].status === "draft" &&
  rows[0].approved_at === null;
// The rows of a read ordered newest first (start date, then creation time, both descending), cut at `limit`: exactly that
// many rows (the steps that use it know that more schedules exist), each not newer than the one before it.
const isNewestFirst = (limit) => (rows) =>
  Array.isArray(rows) &&
  rows.length === limit &&
  rows.every(
    (row, at) =>
      at === 0 ||
      rows[at - 1].start_date > row.start_date ||
      (rows[at - 1].start_date === row.start_date && Date.parse(rows[at - 1].created_at) >= Date.parse(row.created_at)),
  );
// The schedules of this run in that order (the label pattern keeps the schedules of other data out): the ids that must
// come back, newest first.
const hasScheduleIds = (ids) => (rows) =>
  Array.isArray(rows) && JSON.stringify(rows.map((row) => row.id)) === JSON.stringify(ids());

const plannerReadsSummary = (name, id, expected, what) => [
  `${planner.label}: schedule_summaries read ${name}`,
  async () => scheduleSummariesTable("GET", { token: await accessToken(planner), query: `?id=eq.${id()}` }),
  {
    status: 200,
    check: isScheduleSummary(id, expected),
    describe: `one row with the eight columns of the view, for ${what}`,
  },
];

// The assignment steps share a schedule of their own, so that they leave the one above alone. Its cells are named A to E:
// A and B are the first shift on days 0 and 1, C, D and E the second shift on days 0, 1 and 2. It covers the two people
// of the API steps. It is created as `createdAssignSchedule` (cells A to D, both people) and then saved over, each state
// differing from the one before in what its step is about: another label; another count and the new cell E; the count
// of B set directly (no save); cell A gone; one person gone. Six assignments sit on it: A and B once for each person, C
// and D for the API employee only. Removing a cell or a person is first refused (the label of such a save must not
// stick) and then confirmed. The label starts with "Smoke-" because the final cleanup step deletes by that prefix; the
// assignments go with the schedule by cascade. Every state is a function, because the ids in it are only known once
// earlier steps have run.
const assignScheduleLabel = `Smoke-${runId}-assign`;
let assignScheduleId;
const assignScheduleChildren = () => `?schedule_id=eq.${assignScheduleId}`;

const assignCellAt = (cell) =>
  ({
    A: [smokeShiftId, 0],
    B: [smokeShiftId, 1],
    C: [sameNameShiftId, 0],
    D: [sameNameShiftId, 1],
    E: [sameNameShiftId, 2],
  })[cell];
// `counts` maps a cell name to its required count; the people default to both of the API steps.
const assignState = (suffix, counts, employeeIds = [smokeEmployeeId, apiEmployeeId]) => ({
  startDate: "2026-11-11",
  label: `${assignScheduleLabel}${suffix}`,
  staffing: Object.entries(counts).map(([cell, requiredCount]) => {
    const [shiftId, dayOffset] = assignCellAt(cell);
    return { shiftId, dayOffset, requiredCount };
  }),
  employeeIds,
});
const createdAssignSchedule = () => assignState("", { A: 2, B: 3, C: 1, D: 2 });
const renamedAssignSchedule = () => assignState("-renamed", { A: 2, B: 3, C: 1, D: 2 });
const recountedAssignSchedule = () => assignState("-renamed", { A: 1, B: 3, C: 1, D: 2, E: 1 });
const patchedAssignSchedule = () => assignState("-renamed", { A: 1, B: 4, C: 1, D: 2, E: 1 });
const withoutCellAssignSchedule = () => assignState("-no-cell", { B: 4, C: 1, D: 2, E: 1 });
const withoutPersonAssignSchedule = () => assignState("-no-person", { B: 4, C: 1, D: 2, E: 1 }, [smokeEmployeeId]);
// Saves that the database must refuse as long as they are not confirmed. Each has a label of its own, which must not
// stick: the header is updated before the refusal, and the refusal has to undo that.
const refusedCellAssignSchedule = () => assignState("-refused-cell", { B: 4, C: 1, D: 2, E: 1 });
const refusedPersonAssignSchedule = () => assignState("-refused-person", { B: 4, C: 1, D: 2, E: 1 }, [smokeEmployeeId]);
const refusedBothAssignSchedule = () => assignState("-refused-both", { C: 1, D: 2, E: 1 }, [smokeEmployeeId]);
// The arguments of the signature that save_schedule had before S-04, which no longer exists.
const oldSignatureArgs = () => {
  const args = saveScheduleArgs({ ...createdAssignSchedule(), label: `${assignScheduleLabel}-old-signature` });
  delete args.p_confirm_removals;
  return args;
};

const assignmentIn = (cell, employeeId) => {
  const [shiftId, dayOffset] = assignCellAt(cell);
  return { cell, shiftId, dayOffset, employeeId };
};
// The six assignments, the first one added alone and the other five in one batch. What is left once cell A is gone, and
// once the API employee is gone as well, are filters of the same list.
const allAssignments = () => [
  assignmentIn("A", smokeEmployeeId),
  assignmentIn("A", apiEmployeeId),
  assignmentIn("B", smokeEmployeeId),
  assignmentIn("B", apiEmployeeId),
  assignmentIn("C", apiEmployeeId),
  assignmentIn("D", apiEmployeeId),
];
const firstAssignment = () => allAssignments().slice(0, 1);
const otherAssignments = () => allAssignments().slice(1);
const assignmentsWithoutCellA = () => allAssignments().filter((assignment) => assignment.cell !== "A");
const assignmentsOfSmokeEmployeeOnly = () =>
  assignmentsWithoutCellA().filter((assignment) => assignment.employeeId === smokeEmployeeId);
// The columns of the table for an assignment; `source` is left out, because the default is what S-04 relies on.
const assignmentRow = ({ shiftId, dayOffset, employeeId }) => ({
  schedule_id: assignScheduleId,
  shift_id: shiftId,
  day_offset: dayOffset,
  employee_id: employeeId,
});
const assignmentFilter = ({ shiftId, dayOffset, employeeId }) =>
  `${assignScheduleChildren()}&shift_id=eq.${shiftId}&day_offset=eq.${dayOffset}&employee_id=eq.${employeeId}`;
const cellFilter = (cell) => {
  const [shiftId, dayOffset] = assignCellAt(cell);
  return `${assignScheduleChildren()}&shift_id=eq.${shiftId}&day_offset=eq.${dayOffset}`;
};

// Rows that each break exactly one rule of the table, for the planner's attempts. The first sits on day 5, on which the
// schedule has no cell; the second is in cell B, but its person is in no roster of these steps (an employee of the API
// steps that the schedule does not cover); the third is valid but for its source (cell D exists, the person is in the
// roster and the key is free).
const assignmentInCellWithoutStaffing = () => assignmentRow({ ...assignmentIn("A", smokeEmployeeId), dayOffset: 5 });
const assignmentOfPersonOutsideRoster = () => assignmentRow(assignmentIn("B", secondApiEmployeeId));
const assignmentWithBogusSource = () => ({ ...assignmentRow(assignmentIn("D", smokeEmployeeId)), source: "bogus" });

// `check` predicates for the assignments of the schedule: exactly the expected ones (a function that lists them), each
// with the source the column defaults to. The rows come back in no promised order, so they are compared as sorted lists.
const assignmentKey = (shiftId, dayOffset, employeeId) => `${shiftId}/${dayOffset}/${employeeId}`;
const isAssignments = (expected) => (rows) =>
  Array.isArray(rows) &&
  rows.every((row) => row.schedule_id === assignScheduleId && row.source === "manual") &&
  sameItems(
    rows.map((row) => assignmentKey(row.shift_id, row.day_offset, row.employee_id)),
    expected().map((assignment) => assignmentKey(assignment.shiftId, assignment.dayOffset, assignment.employeeId)),
  );
// PT409 is the refusal of a save that would take assignments along; the count comes back as text in `details`.
const refusesRemoval = (count) => (error) =>
  error.code === "PT409" && error.message === "Assignments would be removed" && error.details === String(count);
const isAssignScheduleId = (id) => id === assignScheduleId;

const plannerReadsAssignments = (name, expected, what) => [
  `${planner.label}: schedule_assignments read ${name}`,
  async () => assignmentsTable("GET", { token: await accessToken(planner), query: assignScheduleChildren() }),
  {
    status: 200,
    check: isAssignments(expected),
    describe: `exactly the assignments of ${what}, all with source manual`,
  },
];
// The header, the cells, the people and the assignments of the assignment schedule, read back in four steps.
const plannerReadsAssignSchedule = (name, state, expected, what) => [
  ...plannerReadsSchedule(name, state, what, () => assignScheduleId),
  plannerReadsAssignments(name, expected, what),
];

// A save of the assignment schedule over itself that the planner makes; `confirmRemovals` is passed on as it is.
const plannerSavesAssignSchedule = (description, state, expected, confirmRemovals = false) => [
  `${planner.label}: rpc save_schedule ${description}`,
  async () =>
    rpc("save_schedule", await accessToken(planner), saveScheduleArgs(state(), assignScheduleId, confirmRemovals)),
  expected,
];
const savesAssignSchedule = { status: 200, check: isAssignScheduleId, describe: "the id of the same schedule" };
const refusesRemovalOf = (count) => ({
  status: 409,
  check: refusesRemoval(count),
  describe: `an error with the code PT409, the message "Assignments would be removed" and the details "${count}"`,
});

// A signed-in account without planner rights, at a time when the assignment schedule holds all six assignments: the table
// looks empty, the policy turns down an insert, a delete and an update of a required count touch no row (the policies hide
// them), and a save that would take assignments along with a removed cell finds no schedule, even though it carries the
// confirmation (so that only the policies stand in the way). Each answer names its cause (see `policyTurnsDown`). The
// planner's reads afterwards are the proof that nothing changed.
const notPlannerAssignmentSteps = (actor) => [
  [
    `${actor.label}: schedule_assignments read returns an empty list`,
    async () => assignmentsTable("GET", { token: await accessToken(actor), query: "?select=schedule_id" }),
    { status: 200, check: isEmptyList, describe: "an empty list" },
  ],
  [
    `${actor.label}: schedule_assignments insert is rejected`,
    async () =>
      assignmentsTable("POST", {
        token: await accessToken(actor),
        body: assignmentRow(assignmentIn("C", smokeEmployeeId)),
      }),
    policyTurnsDown("schedule_assignments"),
  ],
  [
    `${actor.label}: schedule_assignments delete removes no row`,
    async () =>
      assignmentsTable("DELETE", {
        token: await accessToken(actor),
        query: assignScheduleChildren(),
        prefer: asksForChangedRows,
      }),
    rowsHidden,
  ],
  [
    `${actor.label}: schedule_staffing update of the required count changes no row`,
    async () =>
      scheduleStaffingTable("PATCH", {
        token: await accessToken(actor),
        query: cellFilter("A"),
        body: { required_count: 9 },
        prefer: asksForChangedRows,
      }),
    rowsHidden,
  ],
  [
    `${actor.label}: rpc save_schedule dropping a cell with assignments and a confirmation is rejected`,
    async () =>
      rpc(
        "save_schedule",
        await accessToken(actor),
        saveScheduleArgs(assignState(`-${actor.label}-rpc`, { B: 3, C: 1, D: 2 }), assignScheduleId, true),
      ),
    scheduleHidden,
  ],
  ...plannerReadsAssignSchedule(
    `is unchanged after ${actor.label} write attempts`,
    createdAssignSchedule,
    allAssignments,
    "the assignment schedule, unchanged",
  ),
];

// The same for a caller that never signed in, which the database does not let near the table or the function at all.
const anonymousAssignmentSteps = [
  [
    `${anonymous.label}: schedule_assignments read is rejected`,
    () => assignmentsTable("GET"),
    anonymousTableDenied("schedule_assignments"),
  ],
  [
    `${anonymous.label}: schedule_assignments insert is rejected`,
    () => assignmentsTable("POST", { body: assignmentRow(assignmentIn("C", smokeEmployeeId)) }),
    anonymousTableDenied("schedule_assignments"),
  ],
  [
    `${anonymous.label}: schedule_assignments delete is rejected`,
    () => assignmentsTable("DELETE", { query: assignScheduleChildren() }),
    anonymousTableDenied("schedule_assignments"),
  ],
  [
    `${anonymous.label}: schedule_staffing update of the required count is rejected`,
    () => scheduleStaffingTable("PATCH", { query: cellFilter("A"), body: { required_count: 9 } }),
    anonymousTableDenied("schedule_staffing"),
  ],
  [
    `${anonymous.label}: rpc save_schedule dropping a cell with assignments and a confirmation is rejected`,
    () =>
      rpc(
        "save_schedule",
        undefined,
        saveScheduleArgs(assignState(`-${anonymous.label}-rpc`, { B: 3, C: 1, D: 2 }), assignScheduleId, true),
      ),
    { statusNotClass: 2, check: isFunctionDenied, describe: "a permission error (42501) for the function itself" },
  ],
  ...plannerReadsAssignSchedule(
    `is unchanged after ${anonymous.label} write attempts`,
    createdAssignSchedule,
    allAssignments,
    "the assignment schedule, unchanged",
  ),
];

// The absence steps (S-07) use rows of their own, all in 2090: no schedule of this or of another run reaches that far, so no
// page that reads absences ever sees them. They hang on employees of the database steps above, whose ids exist by then: `own`
// on the row linked to the employee account and `noRole` on the row linked to the account without a role (so that each of
// these accounts has an absence of its very own row to be kept from), `requested` on the roster employee (the service role
// writes it, because no session may write a status) and `crud` on the first API employee, which the planner changes and then
// removes. The table has no label that a cleanup could match, so the rows go with their employees (on delete cascade), and
// the last step proves that none is left. Every row is a function, because the ids in it are only known once the insert
// steps have run.
let ownAbsenceId;
let noRoleAbsenceId;
let requestedAbsenceId;
let crudAbsenceId;
let boundaryAbsenceId;
let absenceCascadeEmployeeId;
let cascadeAbsenceIds = [];
// The rows of the route and page steps (see the block before the steps): the absence the planner creates, corrects and
// removes through the app, its neighbour made through the app, and the two rows with a status that only the service role may
// write. They are on the second API employee, who is outside `absenceScope`.
let apiAbsenceId;
let neighbourAbsenceId;
let requestedApiAbsenceId;
let rejectedApiAbsenceId;

// What a session sends to insert an absence: the four columns it has a grant on, and nothing else. A status is what only the
// service role may write.
const ownAbsenceBody = () => ({
  employee_id: ownEmployeeId,
  type: "vacation",
  start_date: "2090-03-02",
  end_date: "2090-03-06",
});
const noRoleAbsenceBody = () => ({
  employee_id: noRoleEmployeeId,
  type: "sick_leave",
  start_date: "2090-03-09",
  end_date: "2090-03-09",
});
const requestedAbsenceBody = () => ({
  employee_id: smokeEmployeeId,
  type: "other",
  status: "requested",
  start_date: "2090-03-16",
  end_date: "2090-03-20",
});
const crudAbsenceBody = () => ({
  employee_id: apiEmployeeId,
  type: "vacation",
  start_date: "2090-04-06",
  end_date: "2090-04-10",
});
// The three columns a session may change.
const crudAbsenceChanges = { type: "sick_leave", start_date: "2090-04-07", end_date: "2090-04-08" };
// The widest absence the table accepts: the earliest day allowed to the latest one, both inclusive.
const boundaryAbsenceBody = () => ({ ...crudAbsenceBody(), start_date: "2020-01-01", end_date: "2099-12-31" });

// An absence as the table stores it: the status is the default of the column, approved, unless the body names one.
const storedAbsence = (id, body) => ({ status: "approved", ...body, id });
const ownAbsence = () => storedAbsence(ownAbsenceId, ownAbsenceBody());
const noRoleAbsence = () => storedAbsence(noRoleAbsenceId, noRoleAbsenceBody());
const requestedAbsence = () => storedAbsence(requestedAbsenceId, requestedAbsenceBody());
const crudAbsence = () => storedAbsence(crudAbsenceId, crudAbsenceBody());
const changedCrudAbsence = () => ({ ...crudAbsence(), ...crudAbsenceChanges });
// The absences of the four employees above in the states the steps pass through: all as inserted, the fourth one changed
// by the planner, and the fourth one removed.
const insertedAbsences = () => [ownAbsence(), noRoleAbsence(), requestedAbsence(), crudAbsence()];
const changedAbsences = () => [ownAbsence(), noRoleAbsence(), requestedAbsence(), changedCrudAbsence()];
const remainingAbsences = () => [ownAbsence(), noRoleAbsence(), requestedAbsence()];
// Every absence of those four employees. The filter keeps rows of other employees out (those of an earlier run that failed
// before its cleanup, or real ones), and it covers every row an attempt could touch, so that a policy that let one through
// shows in the planner's read afterwards.
const absenceScope = () =>
  `?employee_id=in.(${[ownEmployeeId, noRoleEmployeeId, smokeEmployeeId, apiEmployeeId].join(",")})`;

// The employee of the cascade steps. No schedule uses it, so the service role may delete it (the employees above are in
// rosters, whose foreign key restricts a delete). Its e-mail starts with "smoke-" like every row the final cleanup deletes,
// in case a failed step leaves it behind.
const absenceCascadeEmployee = {
  first_name: "Smoke",
  last_name: `Smoke-${runId}-absence-cascade`,
  email: `smoke-${runId}-absence-cascade@example.com`,
  fte_numerator: 1,
  fte_denominator: 1,
};
// Two absences of it with statuses no session may write, a rejected one and an approved one, which the service role writes.
// With the requested one above, the status check of the table has then accepted each of its three values.
const cascadeAbsenceBodies = () => [
  {
    employee_id: absenceCascadeEmployeeId,
    type: "vacation",
    status: "rejected",
    start_date: "2090-05-04",
    end_date: "2090-05-08",
  },
  {
    employee_id: absenceCascadeEmployeeId,
    type: "other",
    status: "approved",
    start_date: "2090-05-11",
    end_date: "2090-05-11",
  },
];
// The id of every absence of this run, for the check after the final cleanup. The neighbour and the two rows with a status of
// the route and page steps are still there until the employees go, so the cascade is what removes them.
const absenceIdsOfTheRun = () =>
  [
    ownAbsenceId,
    noRoleAbsenceId,
    requestedAbsenceId,
    crudAbsenceId,
    boundaryAbsenceId,
    ...cascadeAbsenceIds,
    apiAbsenceId,
    neighbourAbsenceId,
    requestedApiAbsenceId,
    rejectedApiAbsenceId,
    // The absence of 2021 of the list steps (the planner removed it; it is asked for as well, which does no harm).
    oldApiAbsenceId,
    // The absences of the two schedules of the assignment page steps (the ones the steps removed are asked for as well).
    ...Object.values(absAbsenceIds),
  ].filter(isUuidText);

// A row of the table has exactly these seven columns: there is no text column, an L4 is health data.
const ABSENCE_COLUMNS = ["created_at", "employee_id", "end_date", "id", "start_date", "status", "type"];
const hasAbsenceColumns = (row) => sameItems(Object.keys(row), ABSENCE_COLUMNS) && typeof row.created_at === "string";
const absenceKey = (row) =>
  JSON.stringify([row.id, row.employee_id, row.type, row.status, row.start_date, row.end_date]);
// The same without the id, for rows whose id is only known from the answer.
const absenceKeyWithoutId = (row) =>
  JSON.stringify([row.employee_id, row.type, row.status, row.start_date, row.end_date]);
// Exactly the expected absences (a function that lists them), in any order, each with every column as expected.
const isAbsences = (expected) => (rows) =>
  Array.isArray(rows) &&
  rows.length === expected().length &&
  rows.every((row) => hasAbsenceColumns(row)) &&
  sameItems(rows.map(absenceKey), expected().map(absenceKey));
// Exactly one row for each of the bodies (a function that lists them), as the table stores them and each with an id of its
// own: what an insert answers with.
const isAbsencesLike = (bodies) => (rows) =>
  Array.isArray(rows) &&
  rows.length === bodies().length &&
  rows.every((row) => hasAbsenceColumns(row) && isUuidText(row.id)) &&
  sameItems(
    rows.map(absenceKeyWithoutId),
    bodies().map((body) => absenceKeyWithoutId({ status: "approved", ...body })),
  );

// What the database says about a value it refuses, by cause. A rejected value names the constraint it breaks and carries the
// SQLSTATE of its kind, 23514 for a CHECK and 23503 for a foreign key, so a refusal for any other reason (a policy, a missing
// grant, a malformed value) does not pass.
const isCheckViolation = (constraint) => (error) => error?.code === "23514" && violates(constraint)(error);
const isForeignKeyViolation = (constraint) => (error) => error?.code === "23503" && violates(constraint)(error);
// A date that does not exist, such as the 30th of February: 22008, "date/time field value out of range".
const isImpossibleDate = (error) => error?.code === "22008" && messageIncludes(error, "out of range");
// A column the caller has no grant on: the privilege check comes before the policies, so the error is the 42501 of a
// permission, not the one of a policy, and it names the table (`permission denied for table absences`; a newer PostgreSQL
// may name the column and the relation instead).
const isColumnDenied = (table) => (error) =>
  isPermissionDenied(error) &&
  new RegExp(`permission denied for (?:table ${table}\\b|column "?\\w+"? of relation "?${table}\\b)`).test(
    error?.message ?? "",
  );
const columnDenied = (table) => ({
  status: 403,
  check: isColumnDenied(table),
  describe: `a permission error (42501) for the table ${table}, from a column without a grant and not from a policy`,
});

const asPlanner = async () => ({ token: await accessToken(planner) });
const asServiceRole = async () => ({ key: SUPABASE_SERVICE_ROLE_KEY });

// Inserts the rows of `bodies` (a function that lists them) as `who`, asks for them back and hands their ids to `keepIds`. The
// answer must be exactly those rows, each with an id of its own.
const insertsAbsences = (who, auth, name, bodies, keepIds, describe) => [
  `${who}: absences insert ${name}`,
  async () => {
    const result = await absencesTable("POST", { ...(await auth()), body: bodies(), prefer: "return=representation" });
    const rows = parseJson(result.body);
    keepIds(Array.isArray(rows) ? rows.map((row) => row.id) : []);
    return result;
  },
  { status: 201, check: isAbsencesLike(bodies), describe: `${describe}, echoed back` },
];
const plannerInsertsAbsences = (name, bodies, keepIds, describe) =>
  insertsAbsences(planner.label, asPlanner, name, bodies, keepIds, describe);
const serviceRoleInsertsAbsences = (name, bodies, keepIds, describe) =>
  insertsAbsences("service role", asServiceRole, name, bodies, keepIds, describe);

// The planner's read of the absences of the four employees, which must be exactly `expected` (a function that lists them).
const plannerReadsAbsences = (name, expected, describe) => [
  `${planner.label}: absences read ${name}`,
  async () => absencesTable("GET", { token: await accessToken(planner), query: absenceScope() }),
  {
    status: 200,
    check: isAbsences(expected),
    describe: `exactly ${describe}, each with the seven columns of the table`,
  },
];

// Each rejected insert breaks exactly one rule of the table and carries only the four columns a session may write, so the
// constraint named in the error is the proof of why. `body` is a function, because the ids in it are only known once earlier
// steps have run.
const plannerRejectsAbsence = (description, body, constraint) => [
  `${planner.label}: absences insert ${description} is rejected`,
  async () => absencesTable("POST", { token: await accessToken(planner), body: body() }),
  {
    statusNotClass: 2,
    check: isCheckViolation(constraint),
    describe: `an error with the code 23514 naming ${constraint}`,
  },
];

// The planner writes a column no session may write: refused with a permission error for the table, whatever the value. The
// planner passes every policy of the table and may write the other columns, so a refusal like this can only come from the
// column grants. `build` returns the query and body when the step runs, because the row id is only known by then.
const plannerWriteIsDeniedOnAbsences = (description, method, build) => [
  `${planner.label}: absences ${description} is refused`,
  async () => absencesTable(method, { token: await accessToken(planner), ...build() }),
  columnDenied("absences"),
];

// A signed-in account without planner rights, at a time when the four absences exist and one of them sits on the employee row
// linked to the account itself: the table looks empty (also when asked for that very row), the policy turns down an insert for
// that row, and an update and a delete touch no row (the account holds the grants for both, so only the policies stand in
// the way). Each answer names its cause (see `policyTurnsDown`). The update and the delete aim at every absence of the four
// employees, so one that went through would touch the others as well; the planner's read afterwards is the proof that nothing
// changed. `linkedEmployeeId` is a function for the same reason as the rows above.
const notPlannerAbsenceSteps = (actor, linkedEmployeeId) => [
  [
    `${actor.label}: absences read returns an empty list`,
    async () => absencesTable("GET", { token: await accessToken(actor), query: "?select=id" }),
    { status: 200, check: isEmptyList, describe: "an empty list" },
  ],
  [
    `${actor.label}: absences read of the absence of its own linked employee row returns an empty list`,
    async () =>
      absencesTable("GET", {
        token: await accessToken(actor),
        query: `?employee_id=eq.${linkedEmployeeId()}&select=id`,
      }),
    { status: 200, check: isEmptyList, describe: "an empty list, although that row has an absence" },
  ],
  [
    `${actor.label}: absences insert is rejected`,
    async () =>
      absencesTable("POST", {
        token: await accessToken(actor),
        body: {
          ...crudAbsenceBody(),
          employee_id: linkedEmployeeId(),
          start_date: "2090-08-03",
          end_date: "2090-08-04",
        },
      }),
    policyTurnsDown("absences"),
  ],
  [
    `${actor.label}: absences update changes no row`,
    async () =>
      absencesTable("PATCH", {
        token: await accessToken(actor),
        query: absenceScope(),
        body: { type: "other", start_date: "2090-09-01", end_date: "2090-09-02" },
        prefer: asksForChangedRows,
      }),
    rowsHidden,
  ],
  [
    `${actor.label}: absences delete removes no row`,
    async () =>
      absencesTable("DELETE", { token: await accessToken(actor), query: absenceScope(), prefer: asksForChangedRows }),
    rowsHidden,
  ],
  plannerReadsAbsences(
    `is unchanged after ${actor.label} write attempts`,
    changedAbsences,
    "the four absences, unchanged",
  ),
];

// The same for a caller that never signed in, which the database does not let near the table at all.
const anonymousAbsenceSteps = [
  [`${anonymous.label}: absences read is rejected`, () => absencesTable("GET"), anonymousTableDenied("absences")],
  [
    `${anonymous.label}: absences insert is rejected`,
    () => absencesTable("POST", { body: { ...crudAbsenceBody(), start_date: "2090-08-03", end_date: "2090-08-04" } }),
    anonymousTableDenied("absences"),
  ],
  [
    `${anonymous.label}: absences update is rejected`,
    () => absencesTable("PATCH", { query: absenceScope(), body: { type: "other" } }),
    anonymousTableDenied("absences"),
  ],
  [
    `${anonymous.label}: absences delete is rejected`,
    () => absencesTable("DELETE", { query: absenceScope() }),
    anonymousTableDenied("absences"),
  ],
  plannerReadsAbsences(
    `is unchanged after ${anonymous.label} write attempts`,
    changedAbsences,
    "the four absences, unchanged",
  ),
];

// The schedules API steps share one schedule, created through the app by the planner and then replaced. Its label starts
// with "Smoke-" because the final cleanup step deletes by that prefix, and so do the labels of the bodies that must be
// refused: a refused save that left a row behind would show up in the last read of the API steps. It refers to the two
// shifts and the two employees of the API steps (their ids are only known once those steps have run, so every state is
// a function). `apiSchedule` is created (3 cells of 2 shifts, 2 people) and then replaced with `changedApiSchedule`:
// another start date, one cell with another count (first shift, day 0), one cell gone (first shift, day 6) and one cell
// new (second shift, day 4); the people stay.
const apiScheduleLabel = `Smoke-${runId}-api`;
let apiScheduleId;
const apiScheduleUrl = () => `/api/schedules/${apiScheduleId}`;
const unknownScheduleUrl = `/api/schedules/${unknownScheduleId}`;

const apiSchedule = () => ({
  startDate: "2026-11-11",
  label: apiScheduleLabel,
  staffing: [
    { shiftId: apiShiftId, dayOffset: 0, requiredCount: 2 },
    { shiftId: apiShiftId, dayOffset: 6, requiredCount: 3 },
    { shiftId: secondApiShiftId, dayOffset: 3, requiredCount: 1 },
  ],
  employeeIds: [apiEmployeeId, secondApiEmployeeId],
});
const changedApiSchedule = () => ({
  startDate: "2026-11-15",
  label: apiScheduleLabel,
  staffing: [
    { shiftId: apiShiftId, dayOffset: 0, requiredCount: 5 },
    { shiftId: secondApiShiftId, dayOffset: 3, requiredCount: 1 },
    { shiftId: secondApiShiftId, dayOffset: 4, requiredCount: 2 },
  ],
  employeeIds: [apiEmployeeId, secondApiEmployeeId],
});

// Bodies the routes must refuse. The first one is wrong in four fields at once (a date that does not exist, a label of 61
// characters, no cells, no people), the second only in one (a cell for the same shift and day twice, the rest is valid).
// The other three are well-formed, so they pass the validation and the database refuses them: a shift or a person that
// does not exist, once in a new schedule and once in a replacement of the existing one, whose new date and label must
// not stick.
const invalidApiSchedule = () => ({ startDate: "2026-02-30", label: "x".repeat(61), staffing: [], employeeIds: [] });
const repeatedCellApiSchedule = () => ({
  ...apiSchedule(),
  label: `${apiScheduleLabel}-repeated`,
  staffing: [
    { shiftId: apiShiftId, dayOffset: 2, requiredCount: 1 },
    { shiftId: apiShiftId, dayOffset: 2, requiredCount: 2 },
  ],
});
const unknownShiftApiSchedule = () => ({
  ...apiSchedule(),
  label: `${apiScheduleLabel}-unknown-shift`,
  staffing: [{ shiftId: unknownShiftId, dayOffset: 0, requiredCount: 1 }],
});
const unknownEmployeeApiSchedule = () => ({
  ...apiSchedule(),
  label: `${apiScheduleLabel}-unknown-employee`,
  employeeIds: [unknownEmployeeId],
});
const failedApiReplacement = () => ({
  ...changedApiSchedule(),
  startDate: "2026-12-02",
  label: `${apiScheduleLabel}-replace-fail`,
  staffing: [{ shiftId: unknownShiftId, dayOffset: 0, requiredCount: 1 }],
});

// What the actors without planner rights send: a well-formed body that names a shift and a person that do not exist, so
// that nothing could be stored even if the gate let it through (the route would answer 422 instead of 401 or 403).
const deniedApiSchedule = {
  startDate: "2026-11-11",
  label: `Smoke-${runId}-denied`,
  staffing: [{ shiftId: unknownShiftId, dayOffset: 0, requiredCount: 1 }],
  employeeIds: [unknownEmployeeId],
};

// The routes answer with the id of the saved schedule and nothing else.
const isApiScheduleSaved = (body) => isUuidText(body.id) && body.id === apiScheduleId && Object.keys(body).length === 1;
const duplicateCellMessage = "Ta sama zmiana nie może mieć dwóch wpisów obsady na ten sam dzień.";
// The 422 body names exactly these fields, each with a message.
const hasErrorsOnFields =
  (...fields) =>
  (body) =>
    sameItems(Object.keys(body.errors), fields) && fields.every((field) => typeof body.errors[field] === "string");
const hasRepeatedCellError = (body) =>
  hasErrorsOnFields("staffing")(body) && body.errors.staffing === duplicateCellMessage;
const isUnknownReference = (body) => body.error === "unknown_reference";
// The schedules whose label starts like the API steps' labels: only the one saved through the API, no leftover of a
// refused save.
const isOnlyApiSchedule = (rows) => Array.isArray(rows) && rows.length === 1 && rows[0].id === apiScheduleId;

// `body` is a function that returns the `json`, `form` or `jsonText` option of the request, because the ids in it are
// only known once earlier steps have run.
const plannerPostsSchedule = (name, body, expected) => [
  `${planner.label}: POST /api/schedules ${name}`,
  () => request(planner, "/api/schedules", { method: "POST", ...body() }),
  { contentType: "application/json", ...expected },
];
const plannerPutsSchedule = (name, path, expected, json = changedApiSchedule) => [
  `${planner.label}: PUT ${name}`,
  () => request(planner, path(), { method: "PUT", json: json() }),
  { contentType: "application/json", ...expected },
];

// The schedule pages show the schedule saved through the API, in the state `changedApiSchedule` left it in. The HTML of a
// page is checked as text: the list through the cells of its table row, the form pages through the <input> tags of the
// island, which the server renders with the state it received (React writes the value and checked attributes into the
// markup). So these steps are the proof that listSchedules and getSchedule hand the pages the right data.
const notFoundScheduleMessage = "Nie znaleziono grafiku";
// formatPeriod("2026-11-15"): the en dash (U+2013) and the year once.
const apiSchedulePeriod = "15.11–21.11.2026";
// Two pieces of the notice of decision D6, which every schedule page carries; the rest of the sentence may be reworded.
const d6Fragments = ["To szkic grafiku tygodniowego", "art. 129 § 3 Kodeksu pracy"];
const hasD6Notice = (html) => d6Fragments.every((fragment) => html.includes(fragment));

// The attributes of every <input> tag of a page, one object each. React escapes quotes and angle brackets inside
// attribute values, so a tag ends at the first ">"; a boolean attribute such as checked has the value "".
const inputsOf = (html) =>
  [...html.matchAll(/<input\b([^>]*)>/g)].map(([, attributes]) =>
    Object.fromEntries(
      [...attributes.matchAll(/([^\s="'>]+)(?:="([^"]*)")?/g)].map(([, name, value]) => [name, value ?? ""]),
    ),
  );
const isGridCell = (input) => typeof input.id === "string" && input.id.startsWith("cell-");
const employeeBoxes = (inputs) => inputs.filter((input) => input.name === "employeeIds");
const isTicked = (box) => "checked" in box;

// The first table row (the chunk of the page that ends at a </tr>) that holds `text`, and the text of its cells.
const tableRowWith = (html, text) => html.split("</tr>").find((chunk) => chunk.includes(text));
const cellsOf = (row) =>
  [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(([, cell]) => cell.replace(/<[^>]*>/g, "").trim());

// The list row of the schedule: the period, the label, the number of people (2), the sum of the grid (5 + 1 + 2), the day
// of creation and the two links of the actions cell (edit and assign), the edit one with an aria-label that names the
// period and the label. The assign link has steps of its own (listsAssignLinkInRow and listsAssignLinkInCard).
const listsApiSchedule = (html) => {
  const row = tableRowWith(html, apiScheduleLabel);
  if (row === undefined) return false;
  const state = changedApiSchedule();
  const cells = cellsOf(row);
  return (
    cells.length === 7 &&
    cells[0] === apiSchedulePeriod &&
    cells[1] === apiScheduleLabel &&
    cells[2] === String(state.employeeIds.length) &&
    cells[3] === String(state.staffing.reduce((sum, cell) => sum + cell.requiredCount, 0)) &&
    /^\d{2}\.\d{2}\.\d{4}$/.test(cells[4]) &&
    cells[5] === "Szkic" &&
    // The links are separate elements: removing their tags may leave a space or nothing between the two words.
    /^Edytuj\s*Obsadź$/.test(cells[6]) &&
    row.includes(`href="/schedules/${apiScheduleId}"`) &&
    row.includes(`aria-label="Edytuj: ${apiSchedulePeriod}, ${apiScheduleLabel}"`)
  );
};

// The form of the stored schedule: the date, the label, the seven columns of the replaced start date (a Sunday), exactly
// the two rows of its shifts with the count of every cell (empty where there is none), and ticked exactly its two people.
const editsApiSchedule = (html) => {
  const inputs = inputsOf(html);
  const state = changedApiSchedule();
  const inputById = (id) => inputs.find((input) => input.id === id);
  const countAt = (shiftId, dayOffset) =>
    state.staffing.find((cell) => cell.shiftId === shiftId && cell.dayOffset === dayOffset)?.requiredCount;
  const cellsMatch = [apiShiftId, secondApiShiftId].every((shiftId) =>
    [0, 1, 2, 3, 4, 5, 6].every((dayOffset) => {
      const cell = inputById(`cell-${shiftId}-${dayOffset}`);
      return cell !== undefined && (cell.value ?? "") === String(countAt(shiftId, dayOffset) ?? "");
    }),
  );
  const boxes = employeeBoxes(inputs);
  return (
    inputById("startDate")?.value === state.startDate &&
    inputById("label")?.value === apiScheduleLabel &&
    html.includes(`Okres: ${apiSchedulePeriod}, 7 dni`) &&
    html.includes("niedz. 15.11") &&
    html.includes("sob. 21.11") &&
    cellsMatch &&
    inputs.filter(isGridCell).length === 14 &&
    state.employeeIds.every((id) => boxes.some((box) => box.value === id)) &&
    boxes.every((box) => isTicked(box) === state.employeeIds.includes(box.value))
  );
};

// The form of a new schedule: a date input with the range of the schedule rules, every employee ticked (the two of the API
// steps among them) and no grid row yet.
const offersNewSchedule = (html) => {
  const inputs = inputsOf(html);
  const date = inputs.find((input) => input.id === "startDate");
  const boxes = employeeBoxes(inputs);
  return (
    date?.type === "date" &&
    date.min === "2020-01-01" &&
    date.max === "2099-12-31" &&
    [apiEmployeeId, secondApiEmployeeId].every((id) => boxes.some((box) => box.value === id)) &&
    boxes.every(isTicked) &&
    !inputs.some(isGridCell)
  );
};

// A page step whose HTML must be accepted by `bodyCheck`, a predicate on the text of the page (the `check` of the other
// steps gets the parsed JSON); `describe` says what the page should show.
const visitChecked = (actor, path, status, bodyCheck, describe, cacheControl) => [
  `${actor.label}: GET ${path} shows ${describe}`,
  () => request(actor, path),
  { status, bodyCheck, describe, cacheControl },
];
// The form page of the schedule saved through the API; its address needs the id, which only exists once the create step
// has run, so it is built when the step runs.
const visitApiSchedulePage = (actor, status, expected) => [
  `${actor.label}: GET /schedules/<id>${expected.describe ? ` shows ${expected.describe}` : ""}`,
  () => request(actor, `/schedules/${apiScheduleId}`),
  { status, ...expected },
];

// The assignment routes (POST and DELETE /api/schedules/<id>/assignments) are tried on a schedule of their own, created
// through the app, so that the schedule above stays in the states its steps expect. Its label starts with "Smoke-" because
// the final cleanup step deletes by that prefix (its assignments go with it by cascade), and it must not start with the
// label of the schedule above: the read after the refused requests and the list page find that one by its prefix. It has
// three cells (A and B are the first API shift on days 0 and 1, C is the second one on day 0) and two people in the
// roster, the two API employees: the second one holds an assignment only in the block of steps that try DELETE (which
// needs a neighbour of another person in the same cell), every other step works with the first one. No employee of this
// run is left to be outside the roster (the employee of the database steps does not exist yet), so the steps for a person
// outside the roster name the id that no employee has: it breaks the same foreign key, the one to the roster. The saves
// that drop cells A and B, which then hold assignments, are refused (409) until the body confirms them with
// `confirmRemoval: true`. Every state is a function, because the ids in it are only known once earlier steps have run.
const routeScheduleLabel = `Smoke-${runId}-route-assign`;
let routeScheduleId;
const routeAssignmentsUrl = () => `/api/schedules/${routeScheduleId}/assignments`;
const routeScheduleUrl = () => `/api/schedules/${routeScheduleId}`;
const routeScheduleChildren = () => `?schedule_id=eq.${routeScheduleId}`;
const unknownAssignmentsUrl = `/api/schedules/${unknownScheduleId}/assignments`;
const malformedAssignmentsUrl = "/api/schedules/not-a-uuid/assignments";

const routeCellAt = (cell) => ({ A: [apiShiftId, 0], B: [apiShiftId, 1], C: [secondApiShiftId, 0] })[cell];
// `counts` maps a cell name to its required count.
const routeState = (suffix, counts) => ({
  startDate: "2026-11-11",
  label: `${routeScheduleLabel}${suffix}`,
  staffing: Object.entries(counts).map(([cell, requiredCount]) => {
    const [shiftId, dayOffset] = routeCellAt(cell);
    return { shiftId, dayOffset, requiredCount };
  }),
  employeeIds: [apiEmployeeId, secondApiEmployeeId],
});
const routeSchedule = () => routeState("", { A: 2, B: 1, C: 1 });
// What a save sends that drops cells A and B: once with a label that must not stick (the save is refused) and once to
// stay (the save is confirmed).
const refusedRouteSchedule = () => routeState("-refused", { C: 1 });
const trimmedRouteSchedule = () => routeState("-trimmed", { C: 1 });

// The edit page of the route schedule in the state the steps leave it in when the pages are visited: saved by the confirmed
// PUT (the label of `trimmedRouteSchedule`) and still holding the one assignment of cell C (the witness), so it is the page
// of a schedule that has assignments. Its address needs the id, which only exists once the create step has run, so it is
// built when the step runs.
const visitRouteSchedulePage = (actor, status, expected) => [
  `${actor.label}: GET /schedules/<id> of the schedule with an assignment${expected.describe ? ` shows ${expected.describe}` : ""}`,
  () => request(actor, `/schedules/${routeScheduleId}`),
  { status, ...expected },
];
const hasTrimmedRouteLabel = (html) =>
  inputsOf(html).find((input) => input.id === "label")?.value === trimmedRouteSchedule().label;

// The body of the assignment routes for a cell; the person is the one of the roster unless another is named.
const routeAssignment = (cell, employeeId = apiEmployeeId) => {
  const [shiftId, dayOffset] = routeCellAt(cell);
  return { shiftId, dayOffset, employeeId };
};
// The assignments the table should hold: those of the named cells, for the person of the roster. The witness is the one
// the refused requests must leave alone.
const routeAssignmentsOf =
  (...cells) =>
  () =>
    cells.map((cell) => routeAssignment(cell));
const routeWitness = routeAssignmentsOf("C");
// The same for assignments named one by one, as [cell, who] pairs: "first" is the person of the roster that
// `routeAssignment` names by default, "second" the other one (see the steps that try DELETE).
const routePersonOf = (who) => (who === "second" ? secondApiEmployeeId : apiEmployeeId);
const routeAssignmentsAmong =
  (...named) =>
  () =>
    named.map(([cell, who]) => routeAssignment(cell, routePersonOf(who)));

// A body that the gate must turn away before the route sees it. The cell and the person do not exist, so nothing could be
// stored even if the gate let it through (the route would answer 422 instead of 401 or 403).
const deniedAssignment = { shiftId: unknownShiftId, dayOffset: 0, employeeId: unknownEmployeeId };
// POST and DELETE of an actor without planner rights; `reason` is what the gate says (the 401 and the 403 differ in it).
const deniedAssignmentCalls = (actor, status, reason) =>
  ["POST", "DELETE"].map((method) => [
    `${actor.label}: ${method} /api/schedules/<id>/assignments`,
    () => request(actor, unknownAssignmentsUrl, { method, json: deniedAssignment }),
    {
      status,
      contentType: "application/json",
      cacheControl: "no-store",
      check: isError(reason),
      describe: `the error ${reason}`,
    },
  ]);

// Both routes answer a successful write with exactly { ok: true }.
const isAssignmentWritten = (body) => body.ok === true && Object.keys(body).length === 1;
const wasWritten = { status: 200, check: isAssignmentWritten, describe: "ok: true and nothing else" };
const isUnsupportedMediaType = (body) => body.error === "unsupported_media_type";
// The route does not take the confirmation of the save for one unless it is exactly true; the 409 says how many
// assignments it would have removed.
const wouldRemoveAssignments = (count) => (body) =>
  body.error === "assignments_would_be_removed" && body.removed === count && Object.keys(body).length === 2;
const isRouteScheduleSaved = (body) =>
  isUuidText(body.id) && body.id === routeScheduleId && Object.keys(body).length === 1;

// `check` predicate for the assignments of the route schedule: exactly the expected ones (a function that lists them),
// each with the source the column defaults to; the rows come back in no promised order.
const isRouteAssignments = (expected) => (rows) =>
  Array.isArray(rows) &&
  rows.every((row) => row.schedule_id === routeScheduleId && row.source === "manual") &&
  sameItems(
    rows.map((row) => assignmentKey(row.shift_id, row.day_offset, row.employee_id)),
    expected().map((assignment) => assignmentKey(assignment.shiftId, assignment.dayOffset, assignment.employeeId)),
  );

const plannerReadsRouteAssignments = (name, expected, what) => [
  `${planner.label}: schedule_assignments of the route schedule read ${name}`,
  async () => assignmentsTable("GET", { token: await accessToken(planner), query: routeScheduleChildren() }),
  {
    status: 200,
    check: isRouteAssignments(expected),
    describe: `exactly the assignments of ${what}, all with source manual`,
  },
];
// The header, the cells, the people and the assignments of the route schedule, read back in four steps.
const plannerReadsRouteSchedule = (name, state, expected, what) => [
  ...plannerReadsSchedule(name, state, what, () => routeScheduleId),
  plannerReadsRouteAssignments(name, expected, what),
];

// A call of the assignment routes by the planner. `url` is a function and `body` returns the `json`, `form` or `jsonText`
// option of the request, because the ids in them are only known once earlier steps have run.
const plannerCallsAssignments = (method, name, url, body, expected) => [
  `${planner.label}: ${method} /api/schedules/<id>/assignments ${name}`,
  () => request(planner, url(), { method, ...body() }),
  { contentType: "application/json", cacheControl: "no-store", ...expected },
];
// The same, followed by a read that shows that the table still holds the witness and nothing else, so a refused POST
// added nothing and a DELETE that found nothing took nothing away.
const plannerTriesAssignmentCall = (method, name, url, body, expected) => [
  plannerCallsAssignments(method, name, url, body, expected),
  plannerReadsRouteAssignments(`is unchanged after ${method} ${name}`, routeWitness, "the witness alone"),
];
// A DELETE by the planner followed by a read of the whole table, which must then hold exactly `expected` (`what` says
// what that is): the assignment the body names is gone, or was never there, and nothing else has gone with it. `url` and
// `assignment` are functions, like `url` and `body` above; `assignment` returns the body itself.
const plannerDeletesRouteAssignment = (name, url, assignment, expected, what) => [
  plannerCallsAssignments("DELETE", name, url, () => ({ json: assignment() }), wasWritten),
  plannerReadsRouteAssignments(`holds what is left after DELETE ${name}`, expected, what),
];
// What both methods must refuse in the same way, before the cell or the person is looked at.
const refusedRouteCalls = (method) => [
  ...plannerTriesAssignmentCall(
    method,
    "with a bad shift id, a day offset of 7 and a bad employee id",
    routeAssignmentsUrl,
    () => ({ json: { shiftId: "not-a-uuid", dayOffset: 7, employeeId: "nope" } }),
    {
      status: 422,
      check: hasErrorsOnFields("shiftId", "dayOffset", "employeeId"),
      describe: "errors for exactly the shiftId, dayOffset and employeeId fields",
    },
  ),
  ...plannerTriesAssignmentCall(
    method,
    "with a form body",
    routeAssignmentsUrl,
    () => ({ form: routeAssignment("A") }),
    {
      status: 415,
      check: isUnsupportedMediaType,
      describe: "the error unsupported_media_type",
    },
  ),
  ...plannerTriesAssignmentCall(
    method,
    "with a body that is not JSON",
    routeAssignmentsUrl,
    () => ({ jsonText: "{" }),
    {
      status: 400,
      check: isInvalidJson,
      describe: "the error invalid_json",
    },
  ),
  ...plannerTriesAssignmentCall(
    method,
    "on an id that is not a UUID",
    () => malformedAssignmentsUrl,
    () => ({ json: routeAssignment("A") }),
    { status: 404, check: isNotFound, describe: "the error not_found" },
  ),
];

// The invitation steps share three employees the planner creates through the app: one that gets invited, one without an
// e-mail, and one whose address belongs to the account without a role (foreignAccount). Their e-mails start with
// "smoke-inv-", like every account the final cleanup removes; the one without an address is removed by its last name.
// The tokens for the set-password page come from the admin API (generate_link), because this test never reads a mail:
// for an account that never confirmed, the invite type works; for a confirmed one only the recovery type does. The ids
// and tokens are only known once the steps that produce them have run.
const inviteeInput = {
  firstName: "Józef",
  lastName: `Smoke-${runId}-Invitee`,
  email: `smoke-inv-${runId}-main@example.com`,
  fteNumerator: 1,
  fteDenominator: 1,
};
const noEmailInput = { ...inviteeInput, lastName: `Smoke-${runId}-NoEmail`, email: null };
const foreignInput = { ...inviteeInput, lastName: `Smoke-${runId}-Foreign`, email: foreignEmail };
const inviteePassword = "Smoke-Invitee-Passw0rd!";
const inviteeNewPassword = "Smoke-Reset-Passw0rd!";
const emailLockedMessage = "E-mail jest zablokowany po zaproszeniu konta";
let inviteeId;
let noEmailId;
let foreignId;
let inviteeUserId;
let firstInvitedAt;
let inviteeActivatedAt;
let inviteToken;
let recoveryToken;
// The new employee opens the link and then holds the session the set-password route gave; later steps sign in again
// with separate actors, so that session stays as it was.
const invitee = { label: "invited employee", jar: new Map() };
const inviteeReset = { label: "invited employee (password reset)", jar: new Map() };
const inviteeLogin = { label: "invited employee (sign-in)", jar: new Map() };

const inviteUrl = (id) => `/api/employees/${id}/invite`;
// The gate answers before the route runs, so the steps of the other roles may name an employee that does not exist.
const unknownInviteUrl = inviteUrl(unknownEmployeeId);
const isError = (error) => (body) => body.error === error;
const isInviteStatus = (status) => (body) => body.status === status;
const hasOk = (body) => body.ok === true;

const plannerCreatesEmployee = (name, input, remember) => [
  `${planner.label}: POST /api/employees creates ${name}`,
  async () => {
    const result = await request(planner, "/api/employees", { method: "POST", json: input });
    remember(parseJson(result.body)?.employee?.id);
    return result;
  },
  {
    status: 201,
    contentType: "application/json",
    check: (body) => typeof body.employee.id === "string",
    describe: "the created employee",
  },
];

// `id` is a function because the employee id is only known once its create step has run.
const plannerInvites = (name, id, expected, hint) => [
  `${planner.label}: POST /api/employees/<id>/invite ${name}`,
  () => request(planner, inviteUrl(id()), { method: "POST" }),
  { contentType: "application/json", cacheControl: "no-store", ...expected },
  hint,
];

const serviceRoleReadsEmployee = (name, id, expected) => [
  `service role: ${name}`,
  async () => employeesTable("GET", { key: SUPABASE_SERVICE_ROLE_KEY, query: `?id=eq.${id()}` }),
  { status: 200, ...expected },
];

const generateTokenStep = (name, type, email, remember) => [
  `service role: generate_link issues ${name}`,
  async () => {
    const result = await supabaseResult(await adminRequest("POST", "generate_link", { type, email }));
    remember(parseJson(result.body)?.hashed_token);
    return result;
  },
  {
    status: 200,
    check: (link) =>
      typeof link.hashed_token === "string" && link.hashed_token !== "" && link.verification_type === type,
    describe: `a ${type} link with a hashed_token`,
  },
];

const setPasswordPath = (tokenHash, type) =>
  `/auth/set-password?token_hash=${encodeURIComponent(tokenHash)}&type=${type}`;
const visitSetPassword = (name, path, expected) => [
  `${invitee.label}: GET /auth/set-password ${name}`,
  () => request(invitee, path()),
  expected,
];
const openedLink = {
  status: 200,
  bodyIncludes: "data-set-password-form",
  cacheControl: "no-store",
  referrerPolicy: "no-referrer",
};
const refusedLink = { status: 400, bodyIncludes: "Link jest nieprawidłowy", cacheControl: "no-store" };

const postSetPassword = (actor, name, body, expected) => [
  `${actor.label}: POST /api/auth/set-password ${name}`,
  () => request(actor, "/api/auth/set-password", { method: "POST", json: body() }),
  { contentType: "application/json", ...expected },
];
const setsPassword = {
  status: 200,
  setsCookie: "auth-token",
  check: hasOk,
  describe: "ok: true, with a session cookie",
};
const refusesLink = { status: 400, check: isError("invalid_link"), describe: "the error invalid_link" };

// The invitation UI is read from the HTML the server renders: the React islands are rendered on the server, so their
// buttons and fields are in the page before any script runs. These helpers cut the pieces out of it. The attribute part
// of a tag allows quoted values, which may hold a ">" (the Tailwind classes of a button do).
const TAG_ATTRIBUTES = `(?:"[^"]*"|'[^']*'|[^>"'])*`;
const tagsOf = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b${TAG_ATTRIBUTES}>`, "g"))].map((m) => m[0]);
const hasAttribute = (tag, name) => new RegExp(`\\s${name}(?=[\\s=/>]|$)`, "i").test(tag);
const attributeOf = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`, "i").exec(tag)?.[1];
const inputById = (html, id) => tagsOf(html, "input").find((tag) => attributeOf(tag, "id") === id);

// The first button of a piece of HTML: its text and whether it is disabled (the attribute, not aria-disabled).
function firstButton(html) {
  const match = new RegExp(`<button\\b(${TAG_ATTRIBUTES})>([^<]*)</button>`).exec(html);
  return match ? { disabled: hasAttribute(match[1], "disabled"), label: match[2].trim() } : undefined;
}

// What the list and the edit page show of an employee's account: the state label, the button of the invitation island
// and, only for a button that is disabled for want of an e-mail, the hint next to it. `excludes` is text that must not
// appear (the label of the other state).
const noEmailHint = "Dodaj e-mail pracownika";
const showsAccount =
  ({ account, button, disabled, excludes }) =>
  (html) => {
    const found = firstButton(html);
    return (
      (typeof account === "string" ? html.includes(account) : account.test(html)) &&
      (excludes === undefined || !html.includes(excludes)) &&
      found?.label === button &&
      found.disabled === disabled &&
      html.includes(noEmailHint) === disabled
    );
  };
// A link that is still valid: "Zaproszony 23.11.2026 (link ważny do 30.11.2026)".
const validInviteLabel = /Zaproszony \d{2}\.\d{2}\.\d{4} \(link ważny do \d{2}\.\d{2}\.\d{4}\)/;
// An account that has set its password: "Zarejestrowany 23.11.2026".
const activeLabel = /Zarejestrowany \d{2}\.\d{2}\.\d{4}/;

// The employee list renders each employee twice: as a table row and as a card of the narrow layout. Both carry the id.
const employeeListItems = (html, id) =>
  [...html.matchAll(new RegExp(`<(tr|li)\\b[^>]*\\bdata-employee-id="${id}"[^>]*>[\\s\\S]*?</\\1>`, "g"))].map(
    (match) => match[0],
  );
const plannerListsEmployee = (name, id, account, describe) => [
  `${planner.label}: GET /employees shows ${name}`,
  () => request(planner, "/employees"),
  {
    status: 200,
    cacheControl: "no-store",
    bodyCheck: (html) => {
      const items = employeeListItems(html, id());
      return items.length === 2 && items.every(showsAccount(account));
    },
    describe: `two list items (the table row and the card), each with ${describe}`,
    excerpt: (html) => employeeListItems(html, id()).join("\n"),
  },
];

// The account section of the edit page: the part of the page between the heading "Konto" and the form.
const accountSection = (html) =>
  /<section\b[^>]*aria-labelledby="account-heading"[^>]*>[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
const plannerEditPageShows = (name, id, description, bodyCheck, excerpt) => [
  `${planner.label}: GET /employees/<id> of ${name}`,
  () => request(planner, `/employees/${id()}`),
  { status: 200, cacheControl: "no-store", bodyCheck, describe: description, excerpt },
];
const emailFieldOf = (html) => inputById(html, "email") ?? "(no e-mail input)";

// The set-password page renders the React form island, not a plain form: the password rule list exists only there.
const hasPasswordFormIsland = (html) => {
  const form = tagsOf(html, "form").find((tag) => hasAttribute(tag, "data-set-password-form"));
  return (
    form !== undefined &&
    ["password", "passwordRepeat"].every((id) => {
      const input = inputById(html, id);
      return (
        input !== undefined &&
        attributeOf(input, "type") === "password" &&
        attributeOf(input, "autocomplete") === "new-password"
      );
    }) &&
    html.includes('id="password-rules"')
  );
};

// The assignment page (/schedules/<id>/assign) is visited for two schedules: the API schedule (three cells with a
// required count, two people, no assignment) and the route schedule (one cell, two people, one assignment: the
// witness). Its island is rendered on the server, so the table of people, the list of violations and the coverage summary
// are in the HTML. A person's row is found by the text of its row header, never by a name anywhere in the page: Astro also
// writes the props of the island, names included, into the astro-island tag, and that proves nothing about a row. A shift
// button counts only as the pair of its aria-label (person, day, shift with its hours) and its aria-pressed in one tag.
const MINUS = "\u2212"; // U+2212, the minus sign of the shortage mark (not a hyphen)
// What a screen reader gets in the coverage table on a day on which the shift does not run, in place of a counter.
const noCellWords = "brak tej zmiany tego dnia";

// The elements with a tag name that do not nest (rows, cells, list items, links, paragraphs), each cut out whole.
const elementsOf = (html, name) =>
  [...html.matchAll(new RegExp(`<${name}\\b${TAG_ATTRIBUTES}>[\\s\\S]*?</${name}>`, "g"))].map(([element]) => element);
const textOf = (html) => html.replace(/<[^>]*>/g, "").trim();
const textsOf = (html, name) => elementsOf(html, name).map(textOf);
// The <a> elements of a piece of HTML, each as { href, label, text }: the address, the aria-label and the text.
const linksOf = (html) =>
  elementsOf(html, "a").map((link) => {
    const [tag] = tagsOf(link, "a");
    return { href: attributeOf(tag, "href"), label: attributeOf(tag, "aria-label"), text: textOf(link) };
  });

// The link from a row or a card of the schedule list to the assignment page of the API schedule: the address, an
// aria-label that names the period and the label like the one of the edit link, and the text.
const hasAssignLink = (part) =>
  linksOf(part).some(
    (link) =>
      link.href === `/schedules/${apiScheduleId}/assign` &&
      link.label === `Obsadź: ${apiSchedulePeriod}, ${apiScheduleLabel}` &&
      link.text === "Obsadź",
  );
// The list has the schedule twice, as a table row (wide layout) and as a card (narrow layout), and each has the link.
const listsAssignLinkInRow = (html) => {
  const row = elementsOf(html, "tr").find((element) => element.includes(apiScheduleLabel));
  return row !== undefined && hasAssignLink(row);
};
const listsAssignLinkInCard = (html) => {
  const card = elementsOf(html, "li").find((element) => element.includes(apiScheduleLabel));
  return card !== undefined && hasAssignLink(card);
};
// The edit page leads to the assignment page of its schedule.
const linksToAssignPage = (html) =>
  linksOf(html).some(
    (link) => link.href === `/schedules/${apiScheduleId}/assign` && link.text === "Obsadź pracowników",
  );

// The page says what it is: the title and the only <h1>, then the period and the label of the schedule, each in a
// paragraph of its own.
const showsAssignHeading = (period, label) => (html) => {
  const headings = textsOf(html, "h1");
  const paragraphs = textsOf(html, "p");
  return (
    headings.length === 1 &&
    headings[0] === "Obsadzanie grafiku" &&
    textsOf(html, "title")[0] === "Obsadzanie grafiku" &&
    paragraphs.includes(period) &&
    paragraphs.includes(label)
  );
};
const headingExcerpt = (html) =>
  ["title", "h1", "p"].map((name) => `${name}: ${textsOf(html, name).slice(0, 3).join(" | ")}`).join("\n");
// The way back: to the edit page of the API schedule and to the list.
const linksBackFromAssignPage = (html) => {
  const links = linksOf(html);
  return (
    links.some((link) => link.href === `/schedules/${apiScheduleId}` && link.text === "Edytuj grafik") &&
    links.some((link) => link.href === "/schedules" && link.text === "Lista grafików")
  );
};

// The island holds the people's table, then the section of the list of violations (no table, so no row header in it), then
// the section of the coverage summary with its own table, so the HTML is cut at the coverage section. The body rows of a
// table come back as { header, cells }: the text of the row header (<th scope="row">) and each <td> element whole.
const cutAtCoverage = (html) => {
  const at = html.indexOf('aria-labelledby="coverage-heading"');
  return at === -1 ? [html, ""] : [html.slice(0, at), html.slice(at)];
};
const bodyRowsOf = (html) =>
  elementsOf(html, "tr").flatMap((row) => {
    const header = elementsOf(row, "th").find((th) => attributeOf(tagsOf(th, "th")[0], "scope") === "row");
    return header === undefined ? [] : [{ header: textOf(header), cells: elementsOf(row, "td") }];
  });

// The people's table, as one entry per person (in the order of their names, whatever the order of the rows) with a list
// of buttons for each of the seven days; a day without a button (the dash of a day without a shift) has an empty list.
// A button is "<aria-label> [aria-pressed=true|false]". `personRow` writes the same shape for what a person should
// have: `byDay` maps a day offset to its buttons. A row has nine cells in all, the seven days, then the column "Wskazania"
// (the violations of the person) and the column "Godziny" (the hours of the person against the norm); the days are the first
// seven, and `cells` is the number the row has, so a row with a cell too few or too many still fails the comparison. The two
// last cells have steps of their own (`violationColumnOf` and `hoursColumnOf`).
const DAY_CELLS = 7;
const HOURS_CELL = DAY_CELLS + 1;
const GRID_ROW_CELLS = DAY_CELLS + 2;
const pressedButton = (label, pressed) => `${label} [aria-pressed=${pressed}]`;
const buttonsOfCell = (cell) =>
  tagsOf(cell, "button")
    .filter((tag) => hasAttribute(tag, "aria-pressed"))
    .map((tag) => pressedButton(attributeOf(tag, "aria-label"), attributeOf(tag, "aria-pressed")));
const byPerson = (a, b) => a.person.localeCompare(b.person);
const gridOf = (html) =>
  bodyRowsOf(cutAtCoverage(html)[0])
    .map(({ header, cells }) => ({
      person: header,
      days: cells.slice(0, DAY_CELLS).map(buttonsOfCell),
      cells: cells.length,
    }))
    .sort(byPerson);
const personRow = (person, byDay) => ({
  person,
  days: Array.from({ length: DAY_CELLS }, (_unused, day) => byDay[day] ?? []),
  cells: GRID_ROW_CELLS,
});
const showsGrid = (expected) => (html) => JSON.stringify(gridOf(html)) === JSON.stringify([...expected].sort(byPerson));
const gridExcerpt = (html) =>
  gridOf(html)
    .map(({ person, days, cells }) => `${person}: ${JSON.stringify(days)} (${cells} cells)`)
    .join("\n");

// The coverage table has exactly one row for each of `expected`, a [hours, counters] pair: the row of a shift is the
// one whose header starts with the shift name and holds its hours (the two API shifts share a name). `counters` maps a
// day offset to the text of the cell, the counter with its mark for a shortage or an excess as the tags leave it; every
// other day must say that the shift does not run.
const coverageRowsOf = (html) =>
  bodyRowsOf(cutAtCoverage(html)[1]).map(({ header, cells }) => ({ header, cells: cells.map(textOf) }));
const showsCoverage = (expected) => (html) => {
  const rows = coverageRowsOf(html);
  return (
    rows.length === expected.length &&
    expected.every(([times, counters]) => {
      const found = rows.filter((row) => row.header.startsWith(apiShiftName) && row.header.includes(times));
      return (
        found.length === 1 &&
        found[0].cells.length === 7 &&
        found[0].cells.every((text, day) => (day in counters ? text === counters[day] : text.endsWith(noCellWords)))
      );
    })
  );
};
const coverageExcerpt = (html) => JSON.stringify(coverageRowsOf(html));

// The page lists people as "Nazwisko Imię", and a button is named "<person>, <day>, <shift name> <hours>". The two API
// shifts share a name, so the hours tell them apart: the first runs 22:00-07:00 (the shift steps moved its end from
// 06:00), the second 06:00-14:00.
const personName = (employee) => `${employee.lastName} ${employee.firstName}`;
const apiEmployeeName = personName(apiEmployee);
const secondApiEmployeeName = personName(secondApiEmployee);
const apiShiftTitle = `${apiShiftName} 22:00–07:00`;
const secondApiShiftTitle = `${apiShiftName} 06:00–14:00`;
const buttonLabel = (person, day, shiftTitle) => `${person}, ${day}, ${shiftTitle}`;

// The route schedule when the pages are visited: the period 11.11 (a Wednesday) to 17.11.2026, the label of the
// confirmed PUT, and a single cell, the second API shift on day 0 with a count of 1. The first person holds the witness
// assignment there (the button is on), the second does not (the button is off), and the coverage is 1 of 1 without a
// mark.
const routeSchedulePeriod = "11.11–17.11.2026";
const routeGrid = [
  personRow(apiEmployeeName, {
    0: [pressedButton(buttonLabel(apiEmployeeName, "śr. 11.11", secondApiShiftTitle), "true")],
  }),
  personRow(secondApiEmployeeName, {
    0: [pressedButton(buttonLabel(secondApiEmployeeName, "śr. 11.11", secondApiShiftTitle), "false")],
  }),
];
const routeCoverage = [["06:00–14:00", { 0: "1 z 1" }]];
// The same schedule with the second person on cell C as well: two people where one is needed, so both buttons are on
// and the counter reads 2 z 1 with the excess mark +1 (U+002B) and the words for a screen reader, and no shortage mark.
const routeGridWithSurplus = [
  personRow(apiEmployeeName, {
    0: [pressedButton(buttonLabel(apiEmployeeName, "śr. 11.11", secondApiShiftTitle), "true")],
  }),
  personRow(secondApiEmployeeName, {
    0: [pressedButton(buttonLabel(secondApiEmployeeName, "śr. 11.11", secondApiShiftTitle), "true")],
  }),
];
const routeCoverageWithSurplus = [["06:00–14:00", { 0: "2 z 1+1nadmiar 1" }]];

// The API schedule when the pages are visited: the period 15.11 (a Sunday) to 21.11.2026 and no assignment. Its cells
// are the first shift on day 0 (5 people), the second shift on day 3 (1 person) and on day 4 (2 people), so each person
// has three buttons, all off, and every counter is short by the whole count.
const apiGridOf = (person) =>
  personRow(person, {
    0: [pressedButton(buttonLabel(person, "niedz. 15.11", apiShiftTitle), "false")],
    3: [pressedButton(buttonLabel(person, "śr. 18.11", secondApiShiftTitle), "false")],
    4: [pressedButton(buttonLabel(person, "czw. 19.11", secondApiShiftTitle), "false")],
  });
const apiGrid = [apiGridOf(apiEmployeeName), apiGridOf(secondApiEmployeeName)];
const apiCoverage = [
  ["22:00–07:00", { 0: `0 z 5${MINUS}5brakuje 5` }],
  ["06:00–14:00", { 3: `0 z 1${MINUS}1brakuje 1`, 4: `0 z 2${MINUS}2brakuje 2` }],
];

// The violations of the live check (S-05) on the assignment page. The list is a section of its own between the people's
// table and the coverage section: a heading, a counter (the one paragraph with aria-live="polite"), a list (`ul`) with an
// item for each violation, and a fixed note on what is not checked. Every text below is one string in the page (React
// writes a template literal as one text node), so no comment node splits it. An item reads as the weight, a space and the
// reason ("Krytyczne <reason>" or "Ostrzeżenie <reason>"), critical ones first; the reason names the person, the day and the
// numbers. The list holds what the rules say about the schedule as it stands, so every step states it in full: here the
// shortages (a warning for each staffing cell with fewer people than it needs), and for a person only what their own
// assignments cause.
const EN_DASH = String.fromCharCode(0x2013); // U+2013, the dash between the start and the end of a shift
const shiftHours = (start, end) => `${start}${EN_DASH}${end}`;
const warningItem = (reason) => `Ostrzeżenie ${reason}`;
const understaffedReason = (shiftName, dayLabel, hours, assigned, required) =>
  `Brak obsady: zmiana ${shiftName} (${dayLabel}, ${hours}): przypisano ${assigned} z ${required}, brakuje ${required - assigned}.`;
const noViolationsCounter = "Brak wskazań";
const edgesNote =
  "Reguły oceniają ten grafik. Odpoczynek na jego krawędziach (poprzedni i następny tydzień) nie jest sprawdzany: wolne na końcu i na początku grafiku liczy się jako jedna przerwa. Shiftly ostrzega i nie gwarantuje zgodności z prawem.";
const coverageNote = "Brak obsady jest ostrzeżeniem na liście wskazań, a nadmiar tylko informacją.";

// The section: from its own opening tag (so that an attribute on the tag itself, such as a role, is part of it) to its closing
// tag (it holds no other section, and the coverage section follows it), or undefined when the page has none.
const violationSectionOf = (html) => {
  const at = html.indexOf('aria-labelledby="violations-heading"');
  const start = at === -1 ? -1 : html.lastIndexOf("<section", at);
  const end = at === -1 ? -1 : html.indexOf("</section>", at);
  return start === -1 || end === -1 ? undefined : html.slice(start, end);
};
const violationCounterOf = (html) => {
  const section = violationSectionOf(html);
  const counter =
    section === undefined
      ? undefined
      : elementsOf(section, "p").find((paragraph) => attributeOf(tagsOf(paragraph, "p")[0], "aria-live") === "polite");
  return counter === undefined ? undefined : textOf(counter);
};
// The text of every item of the list; none when the section has no list (the page leaves it out when there is nothing to
// list), undefined when there is no section or more than one list.
const violationItemsOf = (html) => {
  const section = violationSectionOf(html);
  const lists = section === undefined ? undefined : elementsOf(section, "ul");
  return lists === undefined || lists.length > 1 ? undefined : lists.length === 0 ? [] : textsOf(lists[0], "li");
};
const violationsExcerpt = (html) =>
  JSON.stringify({ counter: violationCounterOf(html), items: violationItemsOf(html) }, null, 1);
// The counter and the items must be exactly these, in this order.
const showsViolations = (items, counter) => (html) =>
  violationCounterOf(html) === counter && JSON.stringify(violationItemsOf(html)) === JSON.stringify(items);
// The section is there with its heading, the heading is the label the section points to, and the section comes after the
// people's table and before the coverage section.
const hasViolationSection = (html) => {
  const section = violationSectionOf(html);
  const at = html.indexOf('aria-labelledby="violations-heading"');
  return (
    section !== undefined &&
    html.includes('id="violations-heading"') &&
    JSON.stringify(textsOf(section, "h2")) === JSON.stringify(["Wskazania"]) &&
    html.indexOf("</table>") < at &&
    at < html.indexOf('aria-labelledby="coverage-heading"')
  );
};
const violationSectionExcerpt = (html) =>
  violationSectionOf(html) ?? "(no section with aria-labelledby violations-heading)";
const hasEdgesNote = (html) => {
  const section = violationSectionOf(html);
  return section !== undefined && textsOf(section, "p").includes(edgesNote);
};
// A change of the list must not be announced as an alert: the section has no role="alert" and no assertive live region
// (the errors of saving are the ones that have role="alert", in their own element above the table).
const hasNoViolationAlert = (html) => {
  const section = violationSectionOf(html);
  return section !== undefined && !section.includes('role="alert"') && !section.includes('aria-live="assertive"');
};

// The people's table has one header cell for each of the seven days between the person and the columns "Wskazania" and
// "Godziny", in that order.
const gridHeadersOf = (html) => {
  const tables = elementsOf(cutAtCoverage(html)[0], "table");
  return tables.length === 1
    ? elementsOf(tables[0], "th")
        .filter((th) => attributeOf(tagsOf(th, "th")[0], "scope") === "col")
        .map(textOf)
    : undefined;
};
const showsGridHeaders = (expected) => (html) => JSON.stringify(gridHeadersOf(html)) === JSON.stringify(expected);
const apiGridHeaders = [
  "Pracownik",
  "niedz. 15.11",
  "pon. 16.11",
  "wt. 17.11",
  "śr. 18.11",
  "czw. 19.11",
  "pt. 20.11",
  "sob. 21.11",
  "Wskazania",
  "Godziny",
];

// The cell after the seven days in each person's row (the column "Wskazania") holds the count of the violations about that
// person in words, or "brak"; the cells of the days hold a marker ("Krytyczne: n", "Ostrzeżenie: n") only when a violation sits on that
// person and day.
const violationColumnOf = (html) =>
  bodyRowsOf(cutAtCoverage(html)[0])
    .map(({ header, cells }) => ({
      person: header,
      violations: cells.length === GRID_ROW_CELLS ? textOf(cells[DAY_CELLS]) : null,
    }))
    .sort(byPerson);
const dayCellMarkersOf = (html) =>
  bodyRowsOf(cutAtCoverage(html)[0]).flatMap(({ header, cells }) =>
    cells
      .slice(0, DAY_CELLS)
      .map(textOf)
      .filter((text) => /Krytyczne|Ostrzeżenie/.test(text))
      .map((text) => `${header}: ${text}`),
  );
const showsViolationColumn = (expected) => (html) =>
  JSON.stringify(violationColumnOf(html)) === JSON.stringify([...expected].sort(byPerson)) &&
  dayCellMarkersOf(html).length === 0;
const violationColumnExcerpt = (html) =>
  JSON.stringify({ column: violationColumnOf(html), cellMarkers: dayCellMarkersOf(html) }, null, 1);
// Both people of the API steps with nothing to report about them.
const noPersonalViolations = [apiEmployeeName, secondApiEmployeeName].map((person) => ({
  person,
  violations: "brak",
}));

// The column "Godziny" (S-06) is the last cell of each person's row: the hours of the schedule against the weekly norm of the
// person's FTE, on two lines (two divs, with one space between them in the markup), so that the text of the cell without its
// tags reads "<worked> z <norm> <difference>", for instance "8 h z 32 h mniej o 24 h". The worked hours are the full durations
// of the shifts that start in the schedule (a night shift on the last day counts in full), the norm is 40 h of a full FTE less
// 8 h for each holiday on a day other than Sunday in the seven days (and, since S-07, for each day from Monday to Friday that is
// no holiday and that an approved absence of the person covers), times the FTE, and the difference is in words ("mniej o",
// "więcej o", or "równo z normą"). A person without a shift reads "0 min z <norm>". Every step writes the texts out for the
// data of its schedule, so a wrong person, sum, norm or difference fails.
const hoursColumnOf = (html) =>
  bodyRowsOf(cutAtCoverage(html)[0])
    .map(({ header, cells }) => ({
      person: header,
      hours: cells.length === GRID_ROW_CELLS ? textOf(cells[HOURS_CELL]) : null,
    }))
    .sort(byPerson);
const showsHoursColumn = (expected) => (html) =>
  JSON.stringify(hoursColumnOf(html)) === JSON.stringify([...expected].sort(byPerson));
const hoursColumnExcerpt = (html) => JSON.stringify(hoursColumnOf(html), null, 1);
// What a step says it expects: each person with the text of the cell. `describeHours` takes the texts by the key of a scenario
// (`who: text`), `describeHoursRows` the { person, hours } entries the page is compared with.
const describeHoursRows = (rows) =>
  `the column "Godziny" reading ${rows.map(({ person, hours }) => `"${hours}" for ${person}`).join(", ")}`;
const describeHours = (hours) =>
  describeHoursRows(Object.entries(hours).map(([who, text]) => ({ person: who, hours: text })));

// The column carries numbers and nothing else: its header and its cells have no role, no live region, no icon and no colour of
// a status (the red, amber and sky of the other columns), and each cell has exactly the two lines, which the text of the cell
// is made of. Exceeding the norm is the warning of the list, not something this column says.
const STATUS_COLOUR = /\b(?:red|amber|orange|yellow|lime|green|emerald|rose|sky)-\d/;
const hoursCellsOf = (html) => bodyRowsOf(cutAtCoverage(html)[0]).map(({ cells }) => cells[HOURS_CELL]);
const hoursHeaderOf = (html) =>
  elementsOf(cutAtCoverage(html)[0], "th").find(
    (th) => attributeOf(tagsOf(th, "th")[0], "scope") === "col" && textOf(th) === "Godziny",
  );
const isNeutralHoursElement = (element) =>
  typeof element === "string" &&
  !/\srole=/.test(element) &&
  !/\saria-live=/.test(element) &&
  !element.includes("<svg") &&
  !STATUS_COLOUR.test(element);
const hasTwoLines = (cell) => {
  const lines = textsOf(cell, "div");
  return lines.length === 2 && lines.every((line) => line !== "") && textOf(cell) === lines.join(" ");
};
const hasNeutralHoursColumn = (people) => (html) => {
  const cells = hoursCellsOf(html);
  const header = hoursHeaderOf(html);
  return (
    cells.length === people &&
    isNeutralHoursElement(header) &&
    cells.every((cell) => isNeutralHoursElement(cell) && hasTwoLines(cell))
  );
};
const hoursCellsExcerpt = (html) => JSON.stringify({ header: hoursHeaderOf(html), cells: hoursCellsOf(html) }, null, 1);

// The paragraph under the people's table: what the column is made of and what it leaves out. It is one text node, so the page
// holds it as one string, between the people's table and the section of the list of violations.
const hoursNote =
  "Godziny: suma zmian rozpoczętych w tym grafiku względem normy tygodniowej etatu (40 h pomniejszone o 8 h za każde święto w dzień inny niż niedziela i za każdy dzień zatwierdzonej nieobecności od poniedziałku do piątku, proporcjonalnie do etatu). Przekroczenie normy pokazuje lista wskazań.";
const hasHoursNote = (html) => {
  const at = html.indexOf(hoursNote);
  const sectionAt = html.indexOf('aria-labelledby="violations-heading"');
  return (
    textsOf(cutAtCoverage(html)[0], "p").filter((paragraph) => paragraph === hoursNote).length === 1 &&
    html.indexOf("</table>") < at &&
    at < sectionAt
  );
};
const hoursNoteExcerpt = (html) => JSON.stringify(textsOf(cutAtCoverage(html)[0], "p"), null, 1);

// The hours on the two schedules of the API and route steps. The API schedule (15.11-21.11.2026) has no holiday, so the norm
// of a full FTE is 40 h; the first person has an FTE of 3/4 (30 h, the employee steps changed it from 1/2) and the second one
// of 1/2 (20 h), and nobody is assigned. The route schedule (11.11-17.11.2026) has the holiday of Wednesday 11.11, so a full
// FTE is 32 h: 24 h for 3/4 and 16 h for 1/2. Its one assignment is the second API shift of 8 h (the witness, the first person),
// and in the state with an excess the second person is on it as well.
const apiHours = [
  { person: apiEmployeeName, hours: "0 min z 30 h mniej o 30 h" },
  { person: secondApiEmployeeName, hours: "0 min z 20 h mniej o 20 h" },
];
const routeHours = [
  { person: apiEmployeeName, hours: "8 h z 24 h mniej o 16 h" },
  { person: secondApiEmployeeName, hours: "0 min z 16 h mniej o 16 h" },
];
const routeHoursWithSurplus = [
  { person: apiEmployeeName, hours: "8 h z 24 h mniej o 16 h" },
  { person: secondApiEmployeeName, hours: "8 h z 16 h mniej o 8 h" },
];

// The explanation under the coverage table: a shortage is a warning on the list, an excess is only information. The old
// sentence ("nie błąd") is gone.
const explainsCoverageNote = (html) => {
  const [explanation] = textsOf(cutAtCoverage(html)[1], "p");
  return explanation !== undefined && explanation.includes(coverageNote) && !explanation.includes("nie błąd");
};

// The shortages of the API schedule when the pages are visited, in the order of the list (the rule, then the key, which
// starts with the day): a warning for each of its three cells, none for a person (nobody is assigned, so no hours).
const apiFirstHours = shiftHours("22:00", "07:00");
const apiSecondHours = shiftHours("06:00", "14:00");
const apiViolationItems = [
  warningItem(understaffedReason(apiShiftName, "niedz. 15.11", apiFirstHours, 0, 5)),
  warningItem(understaffedReason(apiShiftName, "śr. 18.11", apiSecondHours, 0, 1)),
  warningItem(understaffedReason(apiShiftName, "czw. 19.11", apiSecondHours, 0, 2)),
];
const apiViolationCounter = "Wskazania: 3 ostrzeżenia";

// The container that PlannerLayout puts around every planner page, as its class tokens: `max-w-7xl` for a page that
// gets the `wide` prop (the assignment page), `max-w-4xl` for the others. The classes are read from this element and
// not from anywhere in the page, because a stylesheet that is inlined into the page holds both of them.
const layoutClassesOf = (html) =>
  tagsOf(html, "div")
    .map((tag) => (attributeOf(tag, "class") ?? "").split(/\s+/))
    .find((classes) => classes.includes("mx-auto") && classes.includes("w-full"));
const hasWideLayout = (html) => {
  const classes = layoutClassesOf(html);
  return classes !== undefined && classes.includes("max-w-7xl") && !classes.includes("max-w-4xl");
};
const hasNarrowLayout = (html) => {
  const classes = layoutClassesOf(html);
  return classes !== undefined && classes.includes("max-w-4xl") && !classes.includes("max-w-7xl");
};
const layoutExcerpt = (html) => `the layout container has the classes ${JSON.stringify(layoutClassesOf(html))}`;

// The assignment page of a schedule the steps above saved; its address needs the id, which only exists once the create
// step has run, so it is built when the step runs. `which` names the schedule in the step; the page is not cached.
const visitAssignPage = (which, id, expected) => [
  `${planner.label}: GET /schedules/<id>/assign of ${which} shows ${expected.describe}`,
  () => request(planner, `/schedules/${id()}/assign`),
  { status: 200, cacheControl: "no-store", ...expected },
];
const visitApiAssignPage = (expected) => visitAssignPage("the API schedule", () => apiScheduleId, expected);
const visitRouteAssignPage = (expected) =>
  visitAssignPage("the schedule with an assignment", () => routeScheduleId, expected);

// The live rules on real data (S-05). The rules schedule has a week of its own, 02.11-08.11.2026: a Monday to a Sunday with no
// holiday in it, so the weekly norm of a full-time employee is 40 h. It has four employees, all with a full FTE, one for each
// scenario below, and three shifts: M and N are the shifts of the API steps (06:00-14:00, 8 h, and 22:00-07:00, 9 h; they
// share a name, the hours tell them apart) and E is a shift of 01:00-09:00 (8 h) that the steps create. The planner puts the
// people on the cells through the assignment route, and the page steps read what the rules say of that in the HTML: the counter
// and every item of the list (the weight and the whole reason, in the order of the rules), the column "Wskazania" and the marks
// of the day cells, the column "Godziny" (the hours of each person against the norm of 40 h), the coverage table and the
// buttons that are pressed.
//   alfa  (a)  N on day 0 alone: 9 h in the day that starts with it, and a shift longer than 8 h
//   beta  (b)  M and N on day 0: a break of 8 h between them and 16 h in the day that starts with M; N alone on day 3
//   gamma (c)  M on day 4 and E on day 5: a break of exactly 11 h, which is allowed, but 13 h in the day that starts with M
//   delta (d)  M on all seven days: 56 h in the week (more than 48 h), no break of 35 h and more than the norm of 40 h
// The staffing: M needs 2 people on days 0, 4 and 6 and 1 on the others, N needs 1 on days 0 and 3 and E needs 2 on day 2 and
// 1 on day 5. So N on day 0 has an excess (alfa and beta), M on day 6 a shortage (delta alone), E on day 2 nobody (a cell
// without any assignment), and every other cell is complete. The people and the cells are named by the keys below
// (`alfa/N/0` is alfa on shift N on day 0), the ids only exist once the steps that create the rows have run.
const rulesScheduleLabel = `Smoke-${runId}-rules`;
const rulesStartDate = "2026-11-02";
const rulesPeriod = `02.11${EN_DASH}08.11.2026`;
const rulesDays = ["pon. 02.11", "wt. 03.11", "śr. 04.11", "czw. 05.11", "pt. 06.11", "sob. 07.11", "niedz. 08.11"];
const rulesEarlyShiftName = `Smoke-${runId}-Wczesna`;
const rulesEarlyShift = { name: rulesEarlyShiftName, startTime: "01:00", endTime: "09:00" };
let rulesEarlyShiftId;
let rulesScheduleId;
const rulesIds = {};
const rulesShifts = {
  M: { name: apiShiftName, hours: shiftHours("06:00", "14:00"), id: () => secondApiShiftId },
  N: { name: apiShiftName, hours: shiftHours("22:00", "07:00"), id: () => apiShiftId },
  E: { name: rulesEarlyShiftName, hours: shiftHours("01:00", "09:00"), id: () => rulesEarlyShiftId },
};
// The e-mails start with "smoke-" and are lower case, so the final cleanup deletes the rows by that prefix.
const rulesPeople = Object.fromEntries(
  ["alfa", "beta", "gamma", "delta"].map((who) => [
    who,
    {
      firstName: "Ola",
      lastName: `Smoke-${runId}-${who}`,
      email: `smoke-${runId}-rules-${who}@example.com`,
      fteNumerator: 1,
      fteDenominator: 1,
    },
  ]),
);
const rulesName = (who) => personName(rulesPeople[who]);
const rulesAssignmentsUrl = () => `/api/schedules/${rulesScheduleId}/assignments`;

// [shift, day, required count] of every cell of the staffing grid.
const rulesStaffing = [
  ["M", 0, 2],
  ["M", 1, 1],
  ["M", 2, 1],
  ["M", 3, 1],
  ["M", 4, 2],
  ["M", 5, 1],
  ["M", 6, 2],
  ["N", 0, 1],
  ["N", 3, 1],
  ["E", 2, 2],
  ["E", 5, 1],
];
const rulesSchedule = () => ({
  startDate: rulesStartDate,
  label: rulesScheduleLabel,
  staffing: rulesStaffing.map(([shift, dayOffset, requiredCount]) => ({
    shiftId: rulesShifts[shift].id(),
    dayOffset,
    requiredCount,
  })),
  employeeIds: Object.values(rulesIds),
});

// [person, shift, day] of the thirteen assignments the steps add, one request each, and what is left of them once the
// assignments of `removed` have been taken off.
const rulesAssignments = [
  ["alfa", "N", 0],
  ["beta", "M", 0],
  ["beta", "N", 0],
  ["beta", "N", 3],
  ["gamma", "M", 4],
  ["gamma", "E", 5],
  ...[0, 1, 2, 3, 4, 5, 6].map((day) => ["delta", "M", day]),
];
const rulesTag = ([who, shift, day]) => `${who}/${shift}/${day}`;
const rulesWithout = (removed) =>
  rulesAssignments.filter((assignment) => !removed.some((other) => rulesTag(other) === rulesTag(assignment)));
const rulesBody = ([who, shift, day]) => ({
  shiftId: rulesShifts[shift].id(),
  dayOffset: day,
  employeeId: rulesIds[who],
});

// `check` predicate for the assignments of the rules schedule: exactly the expected ones (a function that lists them), each
// with the source the column defaults to; the rows come back in no promised order.
const isRulesAssignments = (expected) => (rows) =>
  Array.isArray(rows) &&
  rows.every((row) => row.schedule_id === rulesScheduleId && row.source === "manual") &&
  sameItems(
    rows.map((row) => assignmentKey(row.shift_id, row.day_offset, row.employee_id)),
    expected().map((assignment) => {
      const { shiftId, dayOffset, employeeId } = rulesBody(assignment);
      return assignmentKey(shiftId, dayOffset, employeeId);
    }),
  );
const plannerReadsRulesAssignments = (name, expected, what) => [
  `${planner.label}: schedule_assignments of the rules schedule read ${name}`,
  async () =>
    assignmentsTable("GET", { token: await accessToken(planner), query: `?schedule_id=eq.${rulesScheduleId}` }),
  {
    status: 200,
    check: isRulesAssignments(expected),
    describe: `exactly the assignments of ${what}, all with source manual`,
  },
];
const plannerAddsRulesAssignment = (assignment) =>
  plannerCallsAssignments(
    "POST",
    `adds ${rulesTag(assignment)}`,
    rulesAssignmentsUrl,
    () => ({ json: rulesBody(assignment) }),
    wasWritten,
  );
// A DELETE of one assignment followed by a read of the whole table, which must hold exactly what `removed` leaves.
const plannerTakesOffRulesAssignment = (assignment, removed) => [
  plannerCallsAssignments(
    "DELETE",
    `takes off ${rulesTag(assignment)}`,
    rulesAssignmentsUrl,
    () => ({ json: rulesBody(assignment) }),
    wasWritten,
  ),
  plannerReadsRulesAssignments(
    `holds what is left after DELETE ${rulesTag(assignment)}`,
    () => rulesWithout(removed),
    `the rules schedule without ${removed.map(rulesTag).join(", ")}`,
  ),
];

// What the list must say, written the way the rules word it (src/lib/services/rules.ts). An expected item has what the page
// sorts by (the weight, the rule, the person and the day of its first anchor, or of its cell for a shortage) and the reason.
// The order is that of the rules: the weight (critical first), the rule, the person by id (a shortage has none and comes last),
// then the key, which starts with the day of the first anchor. No two items of one person and one rule share a day here.
const SEVERITY_WORDS = { critical: "Krytyczne", warning: "Ostrzeżenie" };
const SEVERITY_ORDER = ["critical", "warning"];
const RULES_ORDER = ["daily_rest", "daily_hours", "weekly_hours", "weekly_rest", "weekly_norm", "understaffed"];
const ruleItem = (severity, rule, who, day, reason) => ({ severity, rule, who, day, reason });
const compareIds = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const compareItems = (a, b) =>
  SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
  RULES_ORDER.indexOf(a.rule) - RULES_ORDER.indexOf(b.rule) ||
  Number(a.who === null) - Number(b.who === null) ||
  (a.who === null || b.who === null ? 0 : compareIds(rulesIds[a.who], rulesIds[b.who])) ||
  a.day - b.day;
// The text of each list item: the weight, a space and the reason.
const listOf = (items) =>
  [...items].sort(compareItems).map((item) => `${SEVERITY_WORDS[item.severity]} ${item.reason}`);

const longShiftNote =
  "Zmiana dłuższa niż 8 h wymaga systemu równoważnego czasu pracy (art. 135), którego Shiftly nie obsługuje.";
const cellDescription = (shift, day) => `${rulesShifts[shift].name} (${rulesDays[day]}, ${rulesShifts[shift].hours})`;
// More than 8 h of work in the 24 hours from the start of a shift: `day` and `start` are those of the shift that opens the
// day, `worked` what the person works in it; a shift longer than 8 h in the day adds the sentence about art. 135.
const dailyHoursItem = (who, day, start, worked, longShift) =>
  ruleItem(
    "critical",
    "daily_hours",
    who,
    day,
    `${rulesName(who)}: w dobie liczonej od ${rulesDays[day]}, ${start} przepracowane ${worked}, dopuszczalne najwyżej 8 h.${longShift ? ` ${longShiftNote}` : ""}`,
  );
// A break of less than 11 h between two shifts of one day.
const dailyRestItem = (who, day, gap, earlierShift, nextShift) =>
  ruleItem(
    "critical",
    "daily_rest",
    who,
    day,
    `${rulesName(who)}: przerwa ${gap} między zmianami ${cellDescription(earlierShift, day)} i ${cellDescription(nextShift, day)}, wymagane co najmniej 11 h.`,
  );
const weeklyHoursItem = (who, total) =>
  ruleItem(
    "critical",
    "weekly_hours",
    who,
    0,
    `${rulesName(who)}: w tygodniu grafiku (${rulesPeriod}) łączny czas pracy ${total}, dopuszczalne najwyżej 48 h.`,
  );
const weeklyRestItem = (who, longest, where) =>
  ruleItem(
    "critical",
    "weekly_rest",
    who,
    0,
    `${rulesName(who)}: w tygodniu grafiku (${rulesPeriod}) najdłuższa przerwa trwa ${longest} (${where}), wymagany odpoczynek tygodniowy co najmniej 35 h.`,
  );
// The norm of the week has no holiday to lower it, and the FTE is full.
const weeklyNormItem = (who, total) =>
  ruleItem(
    "warning",
    "weekly_norm",
    who,
    0,
    `${rulesName(who)}: w tygodniu grafiku (${rulesPeriod}) łączny czas pracy ${total}, norma tygodniowa (pełny etat) to 40 h.`,
  );
const shortageItem = (shift, day, assigned, required) =>
  ruleItem(
    "warning",
    "understaffed",
    null,
    day,
    understaffedReason(rulesShifts[shift].name, rulesDays[day], rulesShifts[shift].hours, assigned, required),
  );

const alfaHours = () => dailyHoursItem("alfa", 0, "22:00", "9 h", true);
const betaRest = () => dailyRestItem("beta", 0, "8 h", "M", "N");
const betaHoursOnDay0 = () => dailyHoursItem("beta", 0, "06:00", "16 h", true);
const betaHoursOnDay3 = () => dailyHoursItem("beta", 3, "22:00", "9 h", true);
const gammaHours = () => dailyHoursItem("gamma", 4, "06:00", "13 h", false);
const deltaWeeklyHours = () => weeklyHoursItem("delta", "56 h");
// 7 x 8 h with 16 h between two days: every break is 16 h, the one across the edge of the schedule (from the end of the shift
// on day 6 to the start of the one on day 0) is the first of the list, so it is the one the reason names.
const deltaWeeklyRest = () =>
  weeklyRestItem(
    "delta",
    "16 h",
    `od ${rulesDays[6]}, 14:00 do końca grafiku i od początku grafiku do ${rulesDays[0]}, 06:00`,
  );

// The coverage table of the rules schedule: the counters of N on day 0 and of M on day 6 change from state to state.
const rulesCoverage = ({ n0, m6 }) => [
  ["M", { 0: "2 z 2", 1: "1 z 1", 2: "1 z 1", 3: "1 z 1", 4: "2 z 2", 5: "1 z 1", 6: m6 }],
  ["N", { 0: n0, 3: "1 z 1" }],
  ["E", { 2: `0 z 2${MINUS}2brakuje 2`, 5: "1 z 1" }],
];
const inExcess = "2 z 1+1nadmiar 1";
const shortBy = (assigned, required) =>
  `${assigned} z ${required}${MINUS}${required - assigned}brakuje ${required - assigned}`;

// The four states of the rules schedule the steps read. The first has all thirteen assignments; each next one takes one more
// assignment off, so what changes is what that assignment caused and nothing else. A state lists the items of the list (a
// function, as the ids are not known yet), the counter, the text of the column "Wskazania" of each person, the text of the
// column "Godziny" of each person, the marks of the day cells (a day and its text, for the people who have one) and the
// coverage table.
const rulesStates = [
  {
    what: "with all thirteen assignments",
    removed: [],
    counter: "Wskazania: 7 krytycznych, 3 ostrzeżenia",
    items: () => [
      alfaHours(),
      betaRest(),
      betaHoursOnDay0(),
      betaHoursOnDay3(),
      gammaHours(),
      deltaWeeklyHours(),
      deltaWeeklyRest(),
      weeklyNormItem("delta", "56 h"),
      shortageItem("E", 2, 0, 2),
      shortageItem("M", 6, 1, 2),
    ],
    columns: { alfa: "1 krytyczne", beta: "3 krytyczne", gamma: "1 krytyczne", delta: "2 krytyczne, 1 ostrzeżenie" },
    // The week has no holiday, so everyone's norm is 40 h: alfa works N (9 h), beta M, N and N (8 + 9 + 9 = 26 h), gamma M and
    // E (8 + 8 = 16 h) and delta M on seven days (7 x 8 = 56 h).
    hours: {
      alfa: "9 h z 40 h mniej o 31 h",
      beta: "26 h z 40 h mniej o 14 h",
      gamma: "16 h z 40 h mniej o 24 h",
      delta: "56 h z 40 h więcej o 16 h",
    },
    marks: {
      alfa: { 0: "Krytyczne: 1" },
      beta: { 0: "Krytyczne: 2", 3: "Krytyczne: 1" },
      gamma: { 4: "Krytyczne: 1", 5: "Krytyczne: 1" },
    },
    coverage: rulesCoverage({ n0: inExcess, m6: shortBy(1, 2) }),
    listDescribe:
      'the counter "Wskazania: 7 krytycznych, 3 ostrzeżenia" and the ten items in the order of the rules: critical (the rest of beta, the hours of alfa, of beta on days 0 and 3 and of gamma, the weekly hours and the weekly rest of delta), then the warnings (delta over the norm, the shortages of E on day 2 and of M on day 6)',
    placesDescribe:
      'the column "Wskazania" reading "1 krytyczne" for alfa, "3 krytyczne" for beta, "1 krytyczne" for gamma and "2 krytyczne, 1 ostrzeżenie" for delta, and the marks "Krytyczne: 1" on day 0 of alfa, "Krytyczne: 2" on day 0 and "Krytyczne: 1" on day 3 of beta, "Krytyczne: 1" on days 4 and 5 of gamma and no mark for delta',
    coverageDescribe:
      "the coverage table with every cell complete except N on day 0 in excess (2 z 1, +1), M on day 6 short (1 z 2, -1) and E on day 2 with nobody (0 z 2, -2)",
  },
  {
    what: "after beta's N on day 0 is taken off",
    removed: [["beta", "N", 0]],
    counter: "Wskazania: 5 krytycznych, 3 ostrzeżenia",
    items: () => [
      alfaHours(),
      betaHoursOnDay3(),
      gammaHours(),
      deltaWeeklyHours(),
      deltaWeeklyRest(),
      weeklyNormItem("delta", "56 h"),
      shortageItem("E", 2, 0, 2),
      shortageItem("M", 6, 1, 2),
    ],
    columns: { alfa: "1 krytyczne", beta: "1 krytyczne", gamma: "1 krytyczne", delta: "2 krytyczne, 1 ostrzeżenie" },
    // Only beta's hours move: without the N on day 0 they are M and N on day 3 (8 + 9 = 17 h).
    hours: {
      alfa: "9 h z 40 h mniej o 31 h",
      beta: "17 h z 40 h mniej o 23 h",
      gamma: "16 h z 40 h mniej o 24 h",
      delta: "56 h z 40 h więcej o 16 h",
    },
    marks: {
      alfa: { 0: "Krytyczne: 1" },
      beta: { 3: "Krytyczne: 1" },
      gamma: { 4: "Krytyczne: 1", 5: "Krytyczne: 1" },
    },
    coverage: rulesCoverage({ n0: "1 z 1", m6: shortBy(1, 2) }),
    listDescribe:
      'the counter "Wskazania: 5 krytycznych, 3 ostrzeżenia" and the list without the rest and the 16 h of beta on day 0, while the hours of alfa (the same shift on the same day, another person) and of beta on day 3 stay',
    placesDescribe:
      'beta reading "1 krytyczne" with the mark "Krytyczne: 1" on day 3 only (none on day 0), and alfa, gamma and delta as before',
    coverageDescribe: "N on day 0 complete now (1 z 1, the excess is gone) and every other counter as before",
  },
  {
    what: "after delta's M on day 6 is taken off too",
    removed: [
      ["beta", "N", 0],
      ["delta", "M", 6],
    ],
    counter: "Wskazania: 3 krytyczne, 3 ostrzeżenia",
    items: () => [
      alfaHours(),
      betaHoursOnDay3(),
      gammaHours(),
      weeklyNormItem("delta", "48 h"),
      shortageItem("E", 2, 0, 2),
      shortageItem("M", 6, 0, 2),
    ],
    columns: { alfa: "1 krytyczne", beta: "1 krytyczne", gamma: "1 krytyczne", delta: "1 ostrzeżenie" },
    // Only delta's hours move: six days of M are 48 h, which is 8 h over the norm.
    hours: {
      alfa: "9 h z 40 h mniej o 31 h",
      beta: "17 h z 40 h mniej o 23 h",
      gamma: "16 h z 40 h mniej o 24 h",
      delta: "48 h z 40 h więcej o 8 h",
    },
    marks: {
      alfa: { 0: "Krytyczne: 1" },
      beta: { 3: "Krytyczne: 1" },
      gamma: { 4: "Krytyczne: 1", 5: "Krytyczne: 1" },
    },
    coverage: rulesCoverage({ n0: "1 z 1", m6: shortBy(0, 2) }),
    listDescribe:
      'the counter "Wskazania: 3 krytyczne, 3 ostrzeżenia": delta keeps only the warning about the norm, now with 48 h (48 h in the week is the limit itself, and the free time at the end and at the start of the schedule is one break of 40 h), and M on day 6 is short by 2',
    placesDescribe: 'delta reading "1 ostrzeżenie", alfa, beta and gamma as before',
    coverageDescribe: "M on day 6 with nobody now (0 z 2, -2) and every other counter as before",
  },
  {
    what: "after alfa's N on day 0 is taken off too",
    removed: [
      ["beta", "N", 0],
      ["delta", "M", 6],
      ["alfa", "N", 0],
    ],
    counter: "Wskazania: 2 krytyczne, 4 ostrzeżenia",
    items: () => [
      betaHoursOnDay3(),
      gammaHours(),
      weeklyNormItem("delta", "48 h"),
      shortageItem("N", 0, 0, 1),
      shortageItem("E", 2, 0, 2),
      shortageItem("M", 6, 0, 2),
    ],
    columns: { alfa: "brak", beta: "1 krytyczne", gamma: "1 krytyczne", delta: "1 ostrzeżenie" },
    // Only alfa's hours move: nothing is left of the N, so the sum is the zero that reads "0 min" and the person is short by the
    // whole norm.
    hours: {
      alfa: "0 min z 40 h mniej o 40 h",
      beta: "17 h z 40 h mniej o 23 h",
      gamma: "16 h z 40 h mniej o 24 h",
      delta: "48 h z 40 h więcej o 8 h",
    },
    marks: { beta: { 3: "Krytyczne: 1" }, gamma: { 4: "Krytyczne: 1", 5: "Krytyczne: 1" } },
    coverage: rulesCoverage({ n0: shortBy(0, 1), m6: shortBy(0, 2) }),
    listDescribe:
      'the counter "Wskazania: 2 krytyczne, 4 ostrzeżenia": no item about alfa any more, and N on day 0 short by 1, the first of the shortages (ahead of day 2 and day 6)',
    placesDescribe: 'alfa reading "brak" with no mark, and beta, gamma and delta as before',
    coverageDescribe: "N on day 0 with nobody now (0 z 1, -1) and every other counter as before",
  },
];

// The page of the rules schedule; its address needs the id, which only exists once the create step has run.
const visitRulesAssignPage = (expected) => visitAssignPage("the rules schedule", () => rulesScheduleId, expected);

// The items that are about one person: their reason starts with the person's name, right after the weight.
const itemsAbout = (items, who) =>
  items.filter((item) => Object.values(SEVERITY_WORDS).some((word) => item.startsWith(`${word} ${rulesName(who)}: `)));
// The marks of the day cells, as { person, marks } for each person who has one, marks being { day: text }. The text is what is
// left of the cell without its buttons: the mark ("Krytyczne: 2"), or nothing for a cell without one.
const withoutButtons = (cell) => cell.replace(/<button\b[\s\S]*?<\/button>/g, "");
const dayMarksOf = (html) =>
  bodyRowsOf(cutAtCoverage(html)[0])
    .map(({ header, cells }) => ({
      person: header,
      marks: Object.fromEntries(
        cells
          .slice(0, DAY_CELLS)
          .map((cell, day) => [day, textOf(withoutButtons(cell))])
          .filter(([, text]) => /^(?:Krytyczne|Ostrzeżenie)/.test(text)),
      ),
    }))
    .filter(({ marks }) => Object.keys(marks).length > 0)
    .sort(byPerson);

// What the page says about one person, and what it must say.
const rulesPersonView = (who) => (html) => ({
  items: itemsAbout(violationItemsOf(html) ?? [], who),
  column: violationColumnOf(html).find((row) => row.person === rulesName(who))?.violations,
  marks: dayMarksOf(html).find((row) => row.person === rulesName(who))?.marks ?? {},
});
const showsRulesPerson = (who, expected) => (html) =>
  violationItemsOf(html) !== undefined &&
  JSON.stringify(rulesPersonView(who)(html)) ===
    JSON.stringify({ items: listOf(expected.items()), column: expected.column, marks: expected.marks });
const rulesPersonExcerpt = (who) => (html) => JSON.stringify(rulesPersonView(who)(html), null, 1);
const rulesPersonStep = (who, expected, describe) =>
  visitRulesAssignPage({ bodyCheck: showsRulesPerson(who, expected), describe, excerpt: rulesPersonExcerpt(who) });

// The column "Wskazania" of every person and the marks of every day cell, together: who has what, and where.
const expectedColumns = (state) =>
  Object.entries(state.columns)
    .map(([who, violations]) => ({ person: rulesName(who), violations }))
    .sort(byPerson);
const expectedMarks = (state) =>
  Object.entries(state.marks)
    .map(([who, marks]) => ({ person: rulesName(who), marks }))
    .sort(byPerson);
// The column "Godziny" of every person, as the page is compared with it.
const expectedRulesHours = (state) =>
  Object.entries(state.hours).map(([who, hours]) => ({ person: rulesName(who), hours }));
const showsRulesPlaces = (state) => (html) =>
  JSON.stringify(violationColumnOf(html)) === JSON.stringify(expectedColumns(state)) &&
  JSON.stringify(dayMarksOf(html)) === JSON.stringify(expectedMarks(state));
const rulesPlacesExcerpt = (html) =>
  JSON.stringify({ column: violationColumnOf(html), marks: dayMarksOf(html) }, null, 1);

// The coverage table has exactly one row for each of `expected`, a [shift key, counters] pair: the row of a shift is the one
// whose header starts with the shift name and holds its hours (M and N share a name); `counters` maps a day to the text of its
// cell, and every other day must say that the shift does not run.
const showsRulesCoverage = (expected) => (html) => {
  const rows = coverageRowsOf(html);
  return (
    rows.length === expected.length &&
    expected.every(([shift, counters]) => {
      const { name, hours } = rulesShifts[shift];
      const found = rows.filter((row) => row.header.startsWith(name) && row.header.includes(hours));
      return (
        found.length === 1 &&
        found[0].cells.length === 7 &&
        found[0].cells.every((text, day) => (day in counters ? text === counters[day] : text.endsWith(noCellWords)))
      );
    })
  );
};

// The buttons that are on (aria-pressed="true"), by their aria-label, in sorted order: one for each assignment that is there.
const pressedLabelsOf = (html) =>
  tagsOf(cutAtCoverage(html)[0], "button")
    .filter((tag) => attributeOf(tag, "aria-pressed") === "true")
    .map((tag) => attributeOf(tag, "aria-label"))
    .sort();
const pressedLabelsFor = (assignments) =>
  assignments
    .map(([who, shift, day]) =>
      buttonLabel(rulesName(who), rulesDays[day], `${rulesShifts[shift].name} ${rulesShifts[shift].hours}`),
    )
    .sort();

// The five steps that read one state: the counter and the list, the places (column and marks), the column "Godziny" (the hours
// of each person, which move only for the person whose assignment was taken off), the coverage table and the pressed buttons,
// which show that the assignment that was taken off is really gone from the page.
const rulesStateSteps = (state) => [
  visitRulesAssignPage({
    bodyCheck: (html) => showsViolations(listOf(state.items()), state.counter)(html),
    describe: `${state.what}: ${state.listDescribe}`,
    excerpt: violationsExcerpt,
  }),
  visitRulesAssignPage({
    bodyCheck: showsRulesPlaces(state),
    describe: `${state.what}: ${state.placesDescribe}`,
    excerpt: rulesPlacesExcerpt,
  }),
  visitRulesAssignPage({
    bodyCheck: showsHoursColumn(expectedRulesHours(state)),
    describe: `${state.what}: ${describeHours(state.hours)}`,
    excerpt: hoursColumnExcerpt,
  }),
  visitRulesAssignPage({
    bodyCheck: showsRulesCoverage(state.coverage),
    describe: `${state.what}: ${state.coverageDescribe}`,
    excerpt: coverageExcerpt,
  }),
  visitRulesAssignPage({
    bodyCheck: (html) =>
      JSON.stringify(pressedLabelsOf(html)) === JSON.stringify(pressedLabelsFor(rulesWithout(state.removed))),
    describe: `${state.what}: a pressed button for each of the ${rulesAssignments.length - state.removed.length} assignments that are left, and for no other`,
    excerpt: (html) => JSON.stringify(pressedLabelsOf(html), null, 1),
  }),
];

// The hours against the norm on real data (S-06). The hours schedule starts on Tuesday 10.11.2026 and Wednesday 11.11 is a
// holiday, so the weekly norm of a full FTE is 32 h (40 h less 8 h) and that of a half FTE 16 h. It has seven people, all with
// a full FTE but one, and the two shifts of the API steps: M (06:00-14:00, 8 h) on days 0 to 4 and N (22:00-07:00, 9 h) on days
// 5 and 6, one shift a day, so a person has one button a day. The planner puts the people on the cells through the assignment
// route, and the page steps read the column "Godziny" in the HTML. The worked hours are the full durations of the shifts that
// start in the schedule; what the column must say for each person, written out:
//   one    (full)  M on day 0                    8 h of 32 h, 24 h short
//   two    (full)  M on day 0 and N on day 5     17 h of 32 h, 15 h short (two shifts on different days)
//   night  (full)  N on day 6                    9 h of 32 h, 23 h short (the night shift of the last day counts in full)
//   none   (full)  nothing                       0 min of 32 h, 32 h short
//   half   (1/2)   M on day 0                    8 h of 16 h, 8 h short
//   equal  (full)  M on days 0 to 3              32 h of 32 h, equal to the norm
//   over   (full)  M on days 0 to 4              40 h of 32 h, 8 h over
// The neighbour steps then take one assignment off through `DELETE` at a time and read the page again: the text of the person
// it belongs to changes (the one above the norm to equal, one of two shifts to one, the night shift to nothing) and the texts
// of the other six stay. The staffing of every cell equals the people put on it, which keeps the coverage out of the way; the
// violations of the live rules that this data causes are not what these steps look at.
const hoursScheduleLabel = `Smoke-${runId}-hours`;
const hoursStartDate = "2026-11-10";
const hoursPeriod = `10.11${EN_DASH}16.11.2026`;
const hoursDays = ["wt. 10.11", "śr. 11.11", "czw. 12.11", "pt. 13.11", "sob. 14.11", "niedz. 15.11", "pon. 16.11"];
let hoursScheduleId;
const hoursIds = {};
// [who, FTE numerator, FTE denominator]. The e-mails start with "smoke-" and are lower case, so the final cleanup deletes the
// rows by that prefix.
const hoursPeople = Object.fromEntries(
  [
    ["one", 1, 1],
    ["two", 1, 1],
    ["night", 1, 1],
    ["none", 1, 1],
    ["half", 1, 2],
    ["equal", 1, 1],
    ["over", 1, 1],
  ].map(([who, fteNumerator, fteDenominator]) => [
    who,
    {
      firstName: "Hania",
      lastName: `Smoke-${runId}-hours-${who}`,
      email: `smoke-${runId}-hours-${who}@example.com`,
      fteNumerator,
      fteDenominator,
    },
  ]),
);
const hoursName = (who) => personName(hoursPeople[who]);
const hoursAssignmentsUrl = () => `/api/schedules/${hoursScheduleId}/assignments`;

// [shift, day, required count] of every cell of the staffing grid; each day has one shift, and the count is the number of
// people put on the cell.
const hoursStaffing = [
  ["M", 0, 5],
  ["M", 1, 2],
  ["M", 2, 2],
  ["M", 3, 2],
  ["M", 4, 1],
  ["N", 5, 1],
  ["N", 6, 1],
];
const hoursShiftOfDay = (day) => hoursStaffing.find(([, at]) => at === day)[0];
const hoursSchedule = () => ({
  startDate: hoursStartDate,
  label: hoursScheduleLabel,
  staffing: hoursStaffing.map(([shift, dayOffset, requiredCount]) => ({
    shiftId: rulesShifts[shift].id(),
    dayOffset,
    requiredCount,
  })),
  employeeIds: Object.values(hoursIds),
});

// [person, shift, day] of the fourteen assignments the steps add, one request each.
const hoursAssignments = [
  ["one", "M", 0],
  ["two", "M", 0],
  ["two", "N", 5],
  ["night", "N", 6],
  ["half", "M", 0],
  ...[0, 1, 2, 3].map((day) => ["equal", "M", day]),
  ...[0, 1, 2, 3, 4].map((day) => ["over", "M", day]),
];
const hoursTag = ([who, shift, day]) => `${who}/${shift}/${day}`;
const hoursWithout = (removed) =>
  hoursAssignments.filter((assignment) => !removed.some((other) => hoursTag(other) === hoursTag(assignment)));
const hoursBody = ([who, shift, day]) => ({
  shiftId: rulesShifts[shift].id(),
  dayOffset: day,
  employeeId: hoursIds[who],
});

// `check` predicate for the assignments of the hours schedule: exactly the expected ones (a function that lists them), each
// with the source the column defaults to; the rows come back in no promised order.
const isHoursAssignments = (expected) => (rows) =>
  Array.isArray(rows) &&
  rows.every((row) => row.schedule_id === hoursScheduleId && row.source === "manual") &&
  sameItems(
    rows.map((row) => assignmentKey(row.shift_id, row.day_offset, row.employee_id)),
    expected().map((assignment) => {
      const { shiftId, dayOffset, employeeId } = hoursBody(assignment);
      return assignmentKey(shiftId, dayOffset, employeeId);
    }),
  );
const plannerReadsHoursAssignments = (name, expected, what) => [
  `${planner.label}: schedule_assignments of the hours schedule read ${name}`,
  async () =>
    assignmentsTable("GET", { token: await accessToken(planner), query: `?schedule_id=eq.${hoursScheduleId}` }),
  {
    status: 200,
    check: isHoursAssignments(expected),
    describe: `exactly the assignments of ${what}, all with source manual`,
  },
];
const plannerAddsHoursAssignment = (assignment) =>
  plannerCallsAssignments(
    "POST",
    `adds ${hoursTag(assignment)}`,
    hoursAssignmentsUrl,
    () => ({ json: hoursBody(assignment) }),
    wasWritten,
  );
// A DELETE of one assignment followed by a read of the whole table, which must hold exactly what `removed` leaves.
const plannerTakesOffHoursAssignment = (assignment, removed) => [
  plannerCallsAssignments(
    "DELETE",
    `takes off ${hoursTag(assignment)}`,
    hoursAssignmentsUrl,
    () => ({ json: hoursBody(assignment) }),
    wasWritten,
  ),
  plannerReadsHoursAssignments(
    `holds what is left after DELETE ${hoursTag(assignment)}`,
    () => hoursWithout(removed),
    `the hours schedule without ${removed.map(hoursTag).join(", ")}`,
  ),
];

// What the column says for each person in the four states the steps read: the text of the cell, written out (see above). A
// state differs from the one before only in the person whose assignment was taken off.
const hoursAllText = {
  one: "8 h z 32 h mniej o 24 h",
  two: "17 h z 32 h mniej o 15 h",
  night: "9 h z 32 h mniej o 23 h",
  none: "0 min z 32 h mniej o 32 h",
  half: "8 h z 16 h mniej o 8 h",
  equal: "32 h z 32 h równo z normą",
  over: "40 h z 32 h więcej o 8 h",
};
const hoursAfterOverText = { ...hoursAllText, over: "32 h z 32 h równo z normą" };
const hoursAfterTwoText = { ...hoursAfterOverText, two: "8 h z 32 h mniej o 24 h" };
const hoursAfterNightText = { ...hoursAfterTwoText, night: "0 min z 32 h mniej o 32 h" };
const hoursStates = [
  { what: "with all fourteen assignments", removed: [], hours: hoursAllText },
  { what: "after over's M on day 4 is taken off", removed: [["over", "M", 4]], hours: hoursAfterOverText },
  {
    what: "after two's N on day 5 is taken off too",
    removed: [
      ["over", "M", 4],
      ["two", "N", 5],
    ],
    hours: hoursAfterTwoText,
  },
  {
    what: "after night's N on day 6 is taken off too",
    removed: [
      ["over", "M", 4],
      ["two", "N", 5],
      ["night", "N", 6],
    ],
    hours: hoursAfterNightText,
  },
];
const expectedHoursOf = (hours) =>
  Object.entries(hours).map(([who, text]) => ({ person: hoursName(who), hours: text }));

// The people's table of the hours schedule for the assignments that are there: a row for each person with the button of the
// shift that runs each day (M on days 0 to 4, N on days 5 and 6), pressed where the assignment is there.
const hoursGridOf = (assignments) =>
  Object.keys(hoursPeople).map((who) =>
    personRow(
      hoursName(who),
      Object.fromEntries(
        hoursDays.map((day, offset) => {
          const shift = hoursShiftOfDay(offset);
          const pressed = assignments.some(([person, other, at]) => person === who && other === shift && at === offset);
          const title = `${rulesShifts[shift].name} ${rulesShifts[shift].hours}`;
          return [offset, [pressedButton(buttonLabel(hoursName(who), day, title), String(pressed))]];
        }),
      ),
    ),
  );

// The page of the hours schedule; its address needs the id, which only exists once the create step has run.
const visitHoursAssignPage = (expected) => visitAssignPage("the hours schedule", () => hoursScheduleId, expected);
// The two steps that read one state: the column "Godziny" of everyone, and the people's table with the buttons that are on,
// which shows that the assignment that was taken off is really gone from the page.
const hoursStateSteps = (state) => [
  visitHoursAssignPage({
    bodyCheck: showsHoursColumn(expectedHoursOf(state.hours)),
    describe: `${state.what}: ${describeHours(state.hours)}`,
    excerpt: hoursColumnExcerpt,
  }),
  visitHoursAssignPage({
    bodyCheck: showsGrid(hoursGridOf(hoursWithout(state.removed))),
    describe: `${state.what}: a row for each of the seven people with the button of the shift that runs each day, aria-pressed true for the ${hoursAssignments.length - state.removed.length} assignments that are left and for no other`,
    excerpt: gridExcerpt,
  }),
];

// The planner pages that hand the employees to an island (the new and the edit form of a schedule, and the assignment
// page) list people by name and id only (toEmployeeOptions), so an e-mail address never travels into the page, where the
// props of the island are written as text. One step for each of the two employees of the API steps, who are on all three
// pages, asks for the page with the person's name on it (so that a page that lists nobody cannot pass) and without the
// address the app stored for them (in lower case). `path` is a function because the id of the API schedule is only known
// once its create step has run.
const plannerPageHidesEmails = (pattern, path) =>
  [
    ["first", apiEmployee],
    ["second", secondApiEmployee],
  ].map(([which, person]) => [
    `${planner.label}: GET ${pattern} lists the ${which} API employee without the e-mail address`,
    () => request(planner, path()),
    { status: 200, bodyIncludes: personName(person), bodyExcludes: person.email.toLowerCase() },
  ]);

// The routes and pages of the absences (S-07), as the planner and the other roles meet them. The rows are all in 2090, where
// no schedule of any run reaches, and they hang on the second API employee, who is outside the scope of the database steps
// (`absenceScope`), so a row that a failed step leaves here cannot disturb those steps. A is the absence the planner
// creates, corrects and removes through the app. Its neighbours are N, made through the app (with a status, an id and a
// note in the body, none of which is stored), and R (requested) and J (rejected), written by the service role, because no
// session may write a status. Every step that changes A is followed by a read of the whole set of that person in the
// database and by a page that shows it, so a write that touches a neighbour shows. N, R and J stay until the final
// cleanup removes them with their employee (on delete cascade), and the last step of the run proves that none is left.
const unknownAbsenceId = "00000000-0000-4000-8000-000000000000";
const unknownAbsenceUrl = `/api/absences/${unknownAbsenceId}`;
const apiAbsenceUrl = () => `/api/absences/${apiAbsenceId}`;

// A in the three states it passes through, as the routes take and answer them, and the days of N.
const absenceStates = {
  created: { type: "vacation", startDate: "2090-06-01", endDate: "2090-06-05" },
  changed: { type: "sick_leave", startDate: "2090-06-02", endDate: "2090-06-03" },
  moved: { type: "other", startDate: "2090-06-08", endDate: "2090-06-12" },
};
const neighbourState = { type: "other", startDate: "2090-07-13", endDate: "2090-07-13" };
const absenceInput = (state) => ({ employeeId: secondApiEmployeeId, ...state });
// The same as a row of the table, for the writes of the service role and for `isAbsences`.
const absenceBody = (state) => ({
  employee_id: secondApiEmployeeId,
  type: state.type,
  start_date: state.startDate,
  end_date: state.endDate,
});
const requestedApiAbsenceBody = () => ({
  ...absenceBody({ type: "sick_leave", startDate: "2090-08-03", endDate: "2090-08-07" }),
  status: "requested",
});
const rejectedApiAbsenceBody = () => ({
  ...absenceBody({ type: "vacation", startDate: "2090-09-07", endDate: "2090-09-09" }),
  status: "rejected",
});

// Every absence of the second API employee as the table must hold it while A is in `state` (null: A is removed). A function
// of a function, because the ids in the rows are only known once the create steps have run.
const apiAbsenceRows = (state) => () => [
  ...(state === null ? [] : [storedAbsence(apiAbsenceId, absenceBody(state))]),
  storedAbsence(neighbourAbsenceId, absenceBody(neighbourState)),
  storedAbsence(requestedApiAbsenceId, requestedApiAbsenceBody()),
  storedAbsence(rejectedApiAbsenceId, rejectedApiAbsenceBody()),
];
const plannerReadsApiAbsences = (name, state, describe) => [
  `${planner.label}: absences read ${name}`,
  async () =>
    absencesTable("GET", { token: await accessToken(planner), query: `?employee_id=eq.${secondApiEmployeeId}` }),
  {
    status: 200,
    check: isAbsences(apiAbsenceRows(state)),
    describe: `exactly ${describe}, each with the seven columns of the table`,
  },
];

// The answer of the create and update routes: { absence } with exactly these seven fields, on the second API employee, always
// approved, in `state` and with the id of the row (a function, because the id is only known once the create step has run).
const ABSENCE_JSON_KEYS = ["createdAt", "employeeId", "endDate", "id", "startDate", "status", "type"];
const isApiAbsence = (state, id) => (body) =>
  sameItems(Object.keys(body), ["absence"]) &&
  sameItems(Object.keys(body.absence), ABSENCE_JSON_KEYS) &&
  isUuidText(body.absence.id) &&
  body.absence.id === id() &&
  typeof body.absence.createdAt === "string" &&
  body.absence.employeeId === secondApiEmployeeId &&
  body.absence.status === "approved" &&
  body.absence.type === state.type &&
  body.absence.startDate === state.startDate &&
  body.absence.endDate === state.endDate;
const answersAbsence = (state, id, describe) => ({
  check: isApiAbsence(state, id),
  describe: `{ absence } with the seven fields: ${describe}`,
});

// The 422 body names exactly the fields of `expected`, each with exactly its message, and nothing else. The messages are
// written out here, so a validator that answers with another cause for a field does not pass.
const absenceRangeText = "od 2020-01-01 do 2099-12-31";
const absenceMessages = {
  employeeId: "Wybierz pracownika.",
  type: "Wybierz rodzaj nieobecności: urlop, zwolnienie lekarskie (L4) albo inną nieobecność.",
  startDate: `Podaj poprawną datę początku nieobecności (RRRR-MM-DD, ${absenceRangeText}).`,
  endDate: `Podaj poprawną datę końca nieobecności (RRRR-MM-DD, ${absenceRangeText}).`,
  endDateBeforeStart: "Data końca nie może być wcześniejsza niż data początku.",
};
const hasAbsenceErrors = (expected) => (body) =>
  sameItems(Object.keys(body), ["errors"]) &&
  sameItems(Object.keys(body.errors), Object.keys(expected)) &&
  Object.entries(expected).every(([field, message]) => body.errors[field] === message);
const refusesAbsence = (expected) => ({
  status: 422,
  check: hasAbsenceErrors(expected),
  describe: `errors for exactly the fields ${Object.keys(expected).join(", ")}, each with its message`,
});
const isOnlyError = (error) => (body) => body.error === error && Object.keys(body).length === 1;
const unknownEmployeeRefused = {
  status: 422,
  check: isOnlyError("unknown_reference"),
  describe: "the error unknown_reference and nothing else",
};
const notFoundRefused = {
  status: 404,
  check: isOnlyError("not_found"),
  describe: "the error not_found and nothing else",
};

// What the actors without planner rights send: a well-formed body for a person that does not exist, so that nothing could be
// stored even if the gate let it through (the route would answer 422 instead of 401 or 403; a DELETE would answer 200).
const deniedAbsence = {
  employeeId: unknownEmployeeId,
  type: "vacation",
  startDate: "2090-06-01",
  endDate: "2090-06-02",
};
const deniedAbsenceCalls = (actor, status, reason) =>
  [
    ["POST", "/api/absences", { json: deniedAbsence }],
    ["PUT", unknownAbsenceUrl, { json: deniedAbsence }],
    ["DELETE", unknownAbsenceUrl, {}],
  ].map(([method, path, options]) => [
    `${actor.label}: ${method} ${path === unknownAbsenceUrl ? "/api/absences/<id>" : path}`,
    () => request(actor, path, { method, ...options }),
    {
      status,
      contentType: "application/json",
      cacheControl: "no-store",
      check: isError(reason),
      describe: `the error ${reason}`,
    },
  ]);
// The pages are turned away with the page of the denial, which says why (the sign-in prompt for the anonymous visitor, the
// role for a signed-in one) and carries nothing of the page asked for (the planner layout has "Panel planisty").
const deniedAbsencePages = (actor, status, cause) =>
  ["/absences", "/absences/new", `/absences/${unknownAbsenceId}`].map((path) => [
    `${actor.label}: GET ${path.replace(unknownAbsenceId, "<id>")} is turned away`,
    () => request(actor, path),
    { status, bodyIncludes: cause, bodyExcludes: "Panel planisty" },
  ]);

// Calls of the planner. `options` returns the `json`, `form` or `jsonText` option of the request, because the ids in it are
// only known once earlier steps have run.
const plannerCreatesAbsence = (name, options, remember, expected) => [
  `${planner.label}: POST /api/absences ${name}`,
  async () => {
    const result = await request(planner, "/api/absences", { method: "POST", ...options() });
    remember(parseJson(result.body)?.absence?.id);
    return result;
  },
  { status: 201, contentType: "application/json", cacheControl: "no-store", ...expected },
];
const plannerPostsAbsence = (name, options, expected) => [
  `${planner.label}: POST /api/absences ${name}`,
  () => request(planner, "/api/absences", { method: "POST", ...options() }),
  { contentType: "application/json", cacheControl: "no-store", ...expected },
];
const plannerPutsAbsence = (name, path, options, expected) => [
  `${planner.label}: PUT ${name}`,
  () => request(planner, path(), { method: "PUT", ...options() }),
  { contentType: "application/json", cacheControl: "no-store", ...expected },
];
const plannerDeletesAbsence = (name, path, expected) => [
  `${planner.label}: DELETE ${name}`,
  () => request(planner, path(), { method: "DELETE" }),
  { contentType: "application/json", cacheControl: "no-store", ...expected },
];

// The pages. The HTML is read as text, as the pages of the other lists and forms are: the islands are rendered on the server,
// so the fields of the form are in the page before any script runs. An absence stands in the list twice, as a table row and
// as a card of the narrow layout, and both carry its id.
const sameList = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);
const absencePersonName = personName(secondApiEmployee);
const EMPTY_ABSENCE_LIST = "Nie wpisano jeszcze żadnej nieobecności.";
const absenceListItems = (html, id) =>
  [...html.matchAll(new RegExp(`<(tr|li)\\b[^>]*\\bdata-absence-id="${id}"[^>]*>[\\s\\S]*?</\\1>`, "g"))].map(
    (match) => match[0],
  );
const listedRowIds = (html) => [...html.matchAll(/<tr\b[^>]*\bdata-absence-id="([^"]+)"/g)].map((match) => match[1]);

// What the list says of each row: the person, the type, the days (an en dash between the two days, the year once at the end),
// and the status as words. A is listed in its three states; R and J carry the statuses that only the service role writes.
const absenceTypeLabels = { vacation: "Urlop", sick_leave: "Zwolnienie lekarskie (L4)", other: "Inna nieobecność" };
const absenceDays = {
  created: `01.06${EN_DASH}05.06.2090`,
  changed: `02.06${EN_DASH}03.06.2090`,
  moved: `08.06${EN_DASH}12.06.2090`,
};
// The number of days (both ends included) that the list writes after the range, in the cell and on the card; the label of the
// edit link names the range alone.
const absenceLengths = { created: "5 dni", changed: "2 dni", moved: "5 dni" };
const listedA = (stateName) => ({
  id: () => apiAbsenceId,
  type: absenceTypeLabels[absenceStates[stateName].type],
  days: absenceDays[stateName],
  length: absenceLengths[stateName],
  status: "Zatwierdzona",
});
const listedNeighbour = {
  id: () => neighbourAbsenceId,
  type: absenceTypeLabels.other,
  days: "13.07.2090",
  length: "1 dzień",
  status: "Zatwierdzona",
};
const listedRequested = {
  id: () => requestedApiAbsenceId,
  type: absenceTypeLabels.sick_leave,
  days: `03.08${EN_DASH}07.08.2090`,
  length: "5 dni",
  status: "Wnioskowana",
};
const listedRejected = {
  id: () => rejectedApiAbsenceId,
  type: absenceTypeLabels.vacation,
  days: `07.09${EN_DASH}09.09.2090`,
  length: "3 dni",
  status: "Odrzucona",
};
const showsListedAbsence = (listed) => (html) => {
  const items = absenceListItems(html, listed.id());
  const row = items.find((item) => item.startsWith("<tr"));
  const card = items.find((item) => item.startsWith("<li"));
  const daysText = `${listed.days} (${listed.length})`;
  const edit = [
    {
      href: `/absences/${listed.id()}`,
      label: `Edytuj: ${absencePersonName}, ${listed.type}, ${listed.days}`,
      text: "Edytuj",
    },
  ];
  return (
    items.length === 2 &&
    row !== undefined &&
    card !== undefined &&
    sameList(cellsOf(row), [absencePersonName, listed.type, daysText, listed.status, "Edytuj"]) &&
    sameList(textsOf(card, "p"), [absencePersonName, listed.type, daysText, `Status: ${listed.status}`]) &&
    sameList(linksOf(row), edit) &&
    sameList(linksOf(card), edit)
  );
};
const listedExcerpt = (listed) => (html) => absenceListItems(html, listed.id()).join("\n") || "(no item with this id)";

// The rows of the list, newest start first (the order of `sortAbsences`), as far as `ids` (a function that lists them in that
// order) names them: the database returns them in the order they were written, which is the opposite one.
const listsInStartOrder = (ids) => (html) =>
  sameList(
    listedRowIds(html).filter((id) => ids().includes(id)),
    ids(),
  );
// The frame of the list: the heading counts the rows that the table has, the title, the link to the new form, and no message
// that the list is empty while it has rows.
const showsAbsenceListFrame = (html) => {
  const headings = textsOf(html, "h1");
  const count = /^Nieobecności \((\d+)\)$/.exec(headings[0] ?? "");
  return (
    headings.length === 1 &&
    count !== null &&
    Number(count[1]) === listedRowIds(html).length &&
    listedRowIds(html).length > 0 &&
    textsOf(html, "title")[0] === "Nieobecności" &&
    linksOf(html).some((link) => link.href === "/absences/new" && link.text === "Dodaj nieobecność") &&
    !html.includes(EMPTY_ABSENCE_LIST)
  );
};
const hidesAbsenceEmails = (html) =>
  [apiEmployee, secondApiEmployee].every((person) => !html.includes(person.email.toLowerCase()));

// The two views of the list: by default the absences that ended in the last twelve months or are still going on, and with
// "?all=1" every absence. Each says which one it is (a paragraph with data-absence-view-note) and links to the other one (the
// link with data-absence-view-link); a list cut at 500 rows adds a note of its own (data-absence-truncated-note), which a
// short list never has.
const RECENT_VIEW_NOTE = "Pokazano nieobecności zakończone w ostatnich 12 miesiącach lub trwające.";
const ALL_VIEW_NOTE = "Pokazano wszystkie nieobecności.";
const recentViewLink = { href: "/absences?all=1", text: "Pokaż starsze" };
const allViewLink = { href: "/absences", text: "Pokaż tylko ostatnie 12 miesięcy" };
const elementsWithAttribute = (html, name, attribute) =>
  elementsOf(html, name).filter((element) => hasAttribute(tagsOf(element, name)[0], attribute));
const viewNotesOf = (html) => elementsWithAttribute(html, "p", "data-absence-view-note").map(textOf);
const viewLinksOf = (html) =>
  elementsWithAttribute(html, "a", "data-absence-view-link").map((link) => ({
    href: attributeOf(tagsOf(link, "a")[0], "href"),
    text: textOf(link),
  }));
const hasNoTruncatedNote = (html) =>
  elementsWithAttribute(html, "p", "data-absence-truncated-note").length === 0 && !html.includes("Lista jest obcięta");
// The row of an absence of 2021 (long over), written by the service role for the second API employee: it is outside the default
// view and inside the full one. `recentViewRows` is the number of rows the default view had, read before the full view is.
let oldApiAbsenceId;
let recentViewRows;
const oldApiAbsenceBody = () => absenceBody({ type: "vacation", startDate: "2021-05-03", endDate: "2021-05-14" });
const listedOld = {
  id: () => oldApiAbsenceId,
  type: absenceTypeLabels.vacation,
  days: `03.05${EN_DASH}14.05.2021`,
  length: "12 dni",
  status: "Zatwierdzona",
};
const isNotInList = (html, id) => !listedRowIds(html).includes(id) && absenceListItems(html, id).length === 0;
const showsRecentAbsenceView = (html) =>
  showsAbsenceListFrame(html) &&
  sameList(viewNotesOf(html), [RECENT_VIEW_NOTE]) &&
  sameList(viewLinksOf(html), [recentViewLink]) &&
  hasNoTruncatedNote(html) &&
  isNotInList(html, oldApiAbsenceId);
const showsAllAbsenceView = (html) =>
  showsAbsenceListFrame(html) &&
  sameList(viewNotesOf(html), [ALL_VIEW_NOTE]) &&
  sameList(viewLinksOf(html), [allViewLink]) &&
  hasNoTruncatedNote(html) &&
  listedRowIds(html).length === recentViewRows + 1 &&
  listsInStartOrder(() => [rejectedApiAbsenceId, requestedApiAbsenceId, neighbourAbsenceId, oldApiAbsenceId])(html) &&
  showsListedAbsence(listedOld)(html);
const absenceViewExcerpt = (html) =>
  JSON.stringify({
    h1: textsOf(html, "h1"),
    notes: viewNotesOf(html),
    links: viewLinksOf(html),
    rows: listedRowIds(html).length,
    old: listedRowIds(html).includes(oldApiAbsenceId),
  });

// The lists of a form: the entries of a <select> (the value, the text and whether it is the selected one), or undefined when
// the page has no <select> with this id.
const selectOptionsOf = (html, id) => {
  const select = elementsOf(html, "select").find((element) => attributeOf(tagsOf(element, "select")[0], "id") === id);
  return select === undefined
    ? undefined
    : elementsOf(select, "option").map((option) => {
        const [tag] = tagsOf(option, "option");
        return { value: attributeOf(tag, "value"), label: textOf(option), selected: hasAttribute(tag, "selected") };
      });
};
const plainOptions = (options) => options?.map(({ value, label }) => ({ value, label }));
const absenceTypeOptions = [
  { value: "", label: "Wybierz rodzaj nieobecności" },
  ...Object.entries(absenceTypeLabels).map(([value, label]) => ({ value, label })),
];
const absenceFormLabels = ["Pracownik", "Rodzaj nieobecności", "Data początku", "Data końca"];
const absenceRangeHint =
  "Dozwolone daty: 2020-01-01 do 2099-12-31. Nieobecność obejmuje cały pierwszy i cały ostatni dzień.";
const hasRangeHint = (html) =>
  elementsOf(html, "p").some(
    (element) => attributeOf(tagsOf(element, "p")[0], "id") === "absence-range" && textOf(element) === absenceRangeHint,
  );
// The hint under the list of types (it says what "Inna nieobecność" does to the norm) and the list that points to it: the
// paragraph has the id absence-type-hint and exactly this text, and the aria-describedby of the select holds that id.
const absenceTypeHint =
  "Inna nieobecność jest traktowana jak usprawiedliwiona: obniża normę tygodniową tak samo jak urlop.";
const hasTypeHint = (html) => {
  const select = tagsOf(html, "select").find((tag) => attributeOf(tag, "id") === "type");
  const hints = elementsOf(html, "p").filter(
    (element) => attributeOf(tagsOf(element, "p")[0], "id") === "absence-type-hint",
  );
  return (
    select !== undefined &&
    (attributeOf(select, "aria-describedby") ?? "").split(" ").includes("absence-type-hint") &&
    hints.length === 1 &&
    textOf(hints[0]) === absenceTypeHint
  );
};
// A date field: type date with the bounds of the schedule rules, the value it should hold, and the range hint that describes it.
const isDateField = (html, id, value) => {
  const tag = inputById(html, id);
  return (
    tag !== undefined &&
    attributeOf(tag, "type") === "date" &&
    attributeOf(tag, "min") === "2020-01-01" &&
    attributeOf(tag, "max") === "2099-12-31" &&
    (attributeOf(tag, "value") ?? "") === value &&
    (attributeOf(tag, "aria-describedby") ?? "").split(" ").includes("absence-range")
  );
};
const hasCancelLink = (html) => linksOf(html).some((link) => link.href === "/absences" && link.text === "Anuluj");
const formExcerpt = (html) =>
  JSON.stringify(
    {
      h1: textsOf(html, "h1"),
      labels: textsOf(html, "label"),
      person: selectOptionsOf(html, "employeeId") ?? inputById(html, "employeeId"),
      type: selectOptionsOf(html, "type"),
      typeHint: elementsOf(html, "p").filter((element) =>
        (attributeOf(tagsOf(element, "p")[0], "id") ?? "").startsWith("absence-type"),
      ),
      typeSelect: tagsOf(html, "select").find((tag) => attributeOf(tag, "id") === "type"),
      status: statusLineOf(html),
      startDate: inputById(html, "startDate"),
      endDate: inputById(html, "endDate"),
      buttons: textsOf(html, "button"),
    },
    null,
    1,
  );

// The form that adds an absence: a list of the people (the two API employees among them, by name and id), a list of the three
// types, two empty date fields with the range hint, and nothing picked yet.
const showsNewAbsenceForm = (html) => {
  const people = selectOptionsOf(html, "employeeId");
  const types = selectOptionsOf(html, "type");
  const plainPeople = plainOptions(people);
  return (
    sameList(textsOf(html, "h1"), ["Dodaj nieobecność"]) &&
    textsOf(html, "title")[0] === "Dodaj nieobecność" &&
    sameList(textsOf(html, "label"), absenceFormLabels) &&
    inputById(html, "employeeId") === undefined &&
    plainPeople !== undefined &&
    sameList(plainPeople.slice(0, 1), [{ value: "", label: "Wybierz pracownika" }]) &&
    [
      [apiEmployeeId, apiEmployee],
      [secondApiEmployeeId, secondApiEmployee],
    ].every(([id, person]) =>
      plainPeople.some((option) => option.value === id && option.label === personName(person)),
    ) &&
    sameList(plainOptions(types), absenceTypeOptions) &&
    [...people, ...types].every((option) => !option.selected || option.value === "") &&
    hasTypeHint(html) &&
    isDateField(html, "startDate", "") &&
    isDateField(html, "endDate", "") &&
    hasRangeHint(html) &&
    textsOf(html, "button").includes("Zapisz") &&
    hasCancelLink(html)
  );
};
// The status of the absence on the edit page, as words and read-only: one paragraph with data-absence-status, "Status: ..."
// between the heading and the form (the first field of the form is the label of the person).
const statusLineOf = (html) => elementsWithAttribute(html, "p", "data-absence-status").map(textOf);
const showsStatusLine = (status) => (html) => {
  const heading = html.indexOf("<h1");
  const line = html.indexOf("data-absence-status");
  const form = html.indexOf('for="employeeId"');
  return sameList(statusLineOf(html), [`Status: ${status}`]) && heading !== -1 && heading < line && line < form;
};
// The form that corrects A, in the state `stateName`: the person as read-only text (no list), the type selected, the two days,
// the range hint, the button that saves, the button that starts the removal and not the question that follows it, and the
// status of A (always approved) as read-only words.
const showsEditAbsenceForm = (stateName) => (html) => {
  const state = absenceStates[stateName];
  const person = inputById(html, "employeeId");
  const types = selectOptionsOf(html, "type");
  const buttons = textsOf(html, "button");
  return (
    sameList(textsOf(html, "h1"), ["Edytuj nieobecność"]) &&
    textsOf(html, "title")[0] === "Edytuj nieobecność" &&
    sameList(textsOf(html, "label"), absenceFormLabels) &&
    person !== undefined &&
    attributeOf(person, "type") === "text" &&
    attributeOf(person, "value") === absencePersonName &&
    hasAttribute(person, "readonly") &&
    selectOptionsOf(html, "employeeId") === undefined &&
    sameList(plainOptions(types), absenceTypeOptions) &&
    sameList(
      types.filter((option) => option.selected).map((option) => option.value),
      [state.type],
    ) &&
    hasTypeHint(html) &&
    showsStatusLine("Zatwierdzona")(html) &&
    isDateField(html, "startDate", state.startDate) &&
    isDateField(html, "endDate", state.endDate) &&
    hasRangeHint(html) &&
    buttons.includes("Zapisz") &&
    buttons.includes("Usuń nieobecność") &&
    !buttons.includes("Tak, usuń") &&
    hasCancelLink(html)
  );
};
// Only the person of the absence reaches the page, by name: no e-mail address and nobody else of the roster.
const showsOnlyItsPerson = (html) => hidesAbsenceEmails(html) && !html.includes(personName(apiEmployee));
const showsNoAbsence = (html) =>
  sameList(textsOf(html, "h1"), ["Nie znaleziono nieobecności"]) &&
  textsOf(html, "title")[0] === "Nie znaleziono nieobecności" &&
  linksOf(html).some((link) => link.href === "/absences" && link.text === "Wróć do listy nieobecności") &&
  inputById(html, "startDate") === undefined;
// The card of the panel: one link to the list, headed "Nieobecności", that does not borrow the words the other three cards
// are asserted by (so the assertions of those stay meaningful).
const hasAbsencesCard = (html) => {
  const cards = elementsOf(html, "a").filter((link) => attributeOf(tagsOf(link, "a")[0], "href") === "/absences");
  return (
    cards.length === 1 &&
    sameList(textsOf(cards[0], "h2"), ["Nieobecności"]) &&
    !/Pracownicy|Zmiany|Grafiki/.test(textOf(cards[0]))
  );
};

// A page of the planner: always sent with `no-store` (the names and the kinds of absences are personal data, an L4 is
// health data). `path` is a function, because the id in it is only known once the create step has run.
const visitAbsencePage = (name, path, expected) => [
  `${planner.label}: GET ${name}`,
  () => request(planner, path()),
  { cacheControl: "no-store", ...expected },
];
const absenceListPage = (describe, bodyCheck, excerpt) =>
  visitAbsencePage(`/absences shows ${describe}`, () => "/absences", { status: 200, bodyCheck, describe, excerpt });
const listsAbsence = (name, listed) =>
  absenceListPage(
    `${name} as a table row and as a card: the person, the type, the days with their number ("(5 dni)", "(1 dzień)"), the status as words and the edit link (whose label names the range alone)`,
    showsListedAbsence(listed),
    listedExcerpt(listed),
  );
const absenceEditPage = (describe, stateName, bodyCheck, excerpt = formExcerpt) =>
  visitAbsencePage(`/absences/<id> shows ${describe}`, () => `/absences/${apiAbsenceId}`, {
    status: 200,
    bodyCheck: bodyCheck ?? showsEditAbsenceForm(stateName),
    describe,
    excerpt,
  });

const absenceRouteSteps = [
  // A and N through the app: the answer holds exactly the seven fields, approved, with an id the database gave (not the one
  // of the body), and no note.
  plannerCreatesAbsence(
    "creates an absence",
    () => ({ json: absenceInput(absenceStates.created) }),
    (id) => {
      apiAbsenceId = id;
    },
    answersAbsence(absenceStates.created, () => apiAbsenceId, "vacation on 2090-06-01 to 2090-06-05, approved"),
  ),
  plannerCreatesAbsence(
    "creates a neighbour; the status, the id and the note of the body are not stored",
    () => ({
      json: { ...absenceInput(neighbourState), status: "rejected", id: unknownAbsenceId, note: "L4 do konca miesiaca" },
    }),
    (id) => {
      neighbourAbsenceId = id;
    },
    {
      check: (body) =>
        isApiAbsence(neighbourState, () => neighbourAbsenceId)(body) && body.absence.id !== unknownAbsenceId,
      describe: "{ absence } with the seven fields: other on 2090-07-13, approved, with an id of its own and no note",
    },
  ),
  // R and J by the service role. The table is then read as the planner sees it: N is approved although its body said rejected.
  serviceRoleInsertsAbsences(
    "writes a requested absence for the second API employee",
    () => [requestedApiAbsenceBody()],
    ([id]) => {
      requestedApiAbsenceId = id;
    },
    "the requested absence of the second API employee",
  ),
  serviceRoleInsertsAbsences(
    "writes a rejected absence for the second API employee",
    () => [rejectedApiAbsenceBody()],
    ([id]) => {
      rejectedApiAbsenceId = id;
    },
    "the rejected absence of the second API employee",
  ),
  plannerReadsApiAbsences(
    "shows A, its neighbour N (approved) and R and J with their statuses",
    absenceStates.created,
    "the four absences of the second API employee: A as created, N approved, R requested and J rejected",
  ),

  // The list: every row stands in it twice, as a table row and as a card, with the person as "Last name First name", the
  // days with an en dash, and the status as words. Nothing here is an e-mail address.
  listsAbsence("A (created)", listedA("created")),
  listsAbsence("N (approved, a single day)", listedNeighbour),
  listsAbsence("R (requested)", listedRequested),
  listsAbsence("J (rejected)", listedRejected),
  absenceListPage(
    "the rows J, R, N and A in that order: the latest start first, the opposite of the order they were written in",
    listsInStartOrder(() => [rejectedApiAbsenceId, requestedApiAbsenceId, neighbourAbsenceId, apiAbsenceId]),
    (html) => JSON.stringify(listedRowIds(html)),
  ),
  absenceListPage(
    'the title and the only heading "Nieobecności (n)" with n the number of rows of the table, the link "Dodaj nieobecność" to /absences/new and no message that the list is empty',
    showsAbsenceListFrame,
    (html) => JSON.stringify({ h1: textsOf(html, "h1"), rows: listedRowIds(html).length }),
  ),
  absenceListPage("no e-mail address of the two API employees", hidesAbsenceEmails, (html) =>
    JSON.stringify(textsOf(html, "td")),
  ),
  // The default view says which view it is and links to the full one, and no note says the list is cut at 500 rows.
  absenceListPage(
    `the default view: the note "${RECENT_VIEW_NOTE}" and the link "Pokaż starsze" to /absences?all=1`,
    (html) =>
      showsAbsenceListFrame(html) &&
      sameList(viewNotesOf(html), [RECENT_VIEW_NOTE]) &&
      sameList(viewLinksOf(html), [recentViewLink]) &&
      hasNoTruncatedNote(html),
    absenceViewExcerpt,
  ),
  visitAbsencePage("/absences/new shows the form that adds an absence", () => "/absences/new", {
    status: 200,
    bodyCheck: showsNewAbsenceForm,
    describe:
      "the lists of the people and of the three types with nothing picked, the hint under the list of types (absence-type-hint, named by the aria-describedby of the list), two empty date fields from 2020-01-01 to 2099-12-31 with the range hint, and the buttons",
    excerpt: formExcerpt,
  }),
  visitAbsencePage("/absences/new lists the people without an e-mail address", () => "/absences/new", {
    status: 200,
    bodyCheck: hidesAbsenceEmails,
    describe: "no e-mail address of the two API employees",
    excerpt: formExcerpt,
  }),
  absenceEditPage(
    "the stored values of A: its status as read-only words (Status: Zatwierdzona, between the heading and the form), the person as read-only text, the type with its hint, the two days, the range hint and the removal button",
    "created",
  ),
  // The status of the two rows that only the service role can write, on the edit page of each: shown as words, read-only.
  visitAbsencePage("/absences/<id> of R shows the status Wnioskowana", () => `/absences/${requestedApiAbsenceId}`, {
    status: 200,
    bodyCheck: showsStatusLine("Wnioskowana"),
    describe: 'exactly one paragraph "Status: Wnioskowana" between the heading and the form',
    excerpt: formExcerpt,
  }),
  visitAbsencePage("/absences/<id> of J shows the status Odrzucona", () => `/absences/${rejectedApiAbsenceId}`, {
    status: 200,
    bodyCheck: showsStatusLine("Odrzucona"),
    describe: 'exactly one paragraph "Status: Odrzucona" between the heading and the form',
    excerpt: formExcerpt,
  }),
  absenceEditPage(
    "only the person of the absence by name, no e-mail address and nobody else of the roster",
    "created",
    showsOnlyItsPerson,
  ),
  visitAbsencePage(
    "/absences/<unknown UUID> shows the page of a missing absence",
    () => `/absences/${unknownAbsenceId}`,
    {
      status: 404,
      bodyCheck: showsNoAbsence,
      describe: 'the heading "Nie znaleziono nieobecności", the link back to the list and no form',
      excerpt: (html) => JSON.stringify({ h1: textsOf(html, "h1"), links: linksOf(html) }),
    },
  ),
  visitAbsencePage("/absences/not-a-uuid shows the page of a missing absence", () => "/absences/not-a-uuid", {
    status: 404,
    bodyCheck: showsNoAbsence,
    describe: 'the heading "Nie znaleziono nieobecności", the link back to the list and no form',
    excerpt: (html) => JSON.stringify({ h1: textsOf(html, "h1"), links: linksOf(html) }),
  }),
  [
    `${planner.label}: GET /planner shows the card "Nieobecności" that links to /absences`,
    () => request(planner, "/planner"),
    {
      status: 200,
      bodyCheck: hasAbsencesCard,
      describe:
        'exactly one link to /absences, headed "Nieobecności", whose text has none of the words Pracownicy, Zmiany and Grafiki',
      excerpt: (html) => JSON.stringify(linksOf(html)),
    },
  ],

  // What POST refuses, each for one cause: the 422 names exactly the fields that are wrong, each with its message. The table
  // is read afterwards: nothing was stored.
  plannerPostsAbsence(
    "with a start before 2020",
    () => ({ json: absenceInput({ ...absenceStates.created, startDate: "2019-12-31" }) }),
    refusesAbsence({ startDate: absenceMessages.startDate }),
  ),
  plannerPostsAbsence(
    "with an end after 2099",
    () => ({ json: absenceInput({ ...absenceStates.created, endDate: "2100-01-01" }) }),
    refusesAbsence({ endDate: absenceMessages.endDate }),
  ),
  plannerPostsAbsence(
    "with a day that does not exist (30 February)",
    () => ({ json: absenceInput({ ...absenceStates.created, startDate: "2090-02-30", endDate: "2090-03-02" }) }),
    refusesAbsence({ startDate: absenceMessages.startDate }),
  ),
  plannerPostsAbsence(
    "with an end before the start",
    () => ({ json: absenceInput({ ...absenceStates.created, startDate: "2090-06-10", endDate: "2090-06-09" }) }),
    refusesAbsence({ endDate: absenceMessages.endDateBeforeStart }),
  ),
  plannerPostsAbsence(
    "with a type that is not on the list",
    () => ({ json: absenceInput({ ...absenceStates.created, type: "holiday" }) }),
    refusesAbsence({ type: absenceMessages.type }),
  ),
  plannerPostsAbsence(
    "with an employee that is not a UUID",
    () => ({ json: { ...absenceInput(absenceStates.created), employeeId: "nope" } }),
    refusesAbsence({ employeeId: absenceMessages.employeeId }),
  ),
  plannerPostsAbsence(
    "with an empty object: every field is refused",
    () => ({ json: {} }),
    refusesAbsence({
      employeeId: absenceMessages.employeeId,
      type: absenceMessages.type,
      startDate: absenceMessages.startDate,
      endDate: absenceMessages.endDate,
    }),
  ),
  plannerPostsAbsence(
    "with a well-formed employee that does not exist",
    () => ({ json: { ...absenceInput(absenceStates.created), employeeId: unknownEmployeeId } }),
    unknownEmployeeRefused,
  ),
  plannerPostsAbsence("with a form body", () => ({ form: absenceInput(absenceStates.created) }), {
    status: 415,
    check: isUnsupportedMediaType,
    describe: "the error unsupported_media_type",
  }),
  plannerPostsAbsence("with a body that is not JSON", () => ({ jsonText: "{" }), {
    status: 400,
    check: isInvalidJson,
    describe: "the error invalid_json",
  }),
  plannerReadsApiAbsences(
    "is unchanged after the refused POSTs",
    absenceStates.created,
    "the four absences as before: the refused requests stored nothing",
  ),

  // PUT changes the type and the two days, and keeps the person and the status: the first call changes all three, the second
  // names another person and a status in the body, which are ignored. After each call the table and the pages show A changed
  // and its three neighbours as they were.
  plannerPutsAbsence(
    "/api/absences/<id> changes the type and the days",
    apiAbsenceUrl,
    () => ({ json: absenceInput(absenceStates.changed) }),
    answersAbsence(absenceStates.changed, () => apiAbsenceId, "sick_leave on 2090-06-02 to 2090-06-03, approved"),
  ),
  plannerReadsApiAbsences(
    "shows A changed and its three neighbours as they were",
    absenceStates.changed,
    "the four absences: A as changed, N, R and J untouched",
  ),
  plannerPutsAbsence(
    "/api/absences/<id> with another employee and a status in the body keeps the person and the status",
    apiAbsenceUrl,
    () => ({ json: { ...absenceInput(absenceStates.moved), employeeId: apiEmployeeId, status: "rejected" } }),
    answersAbsence(
      absenceStates.moved,
      () => apiAbsenceId,
      "other on 2090-06-08 to 2090-06-12, still the second employee, approved",
    ),
  ),
  plannerReadsApiAbsences(
    "shows A moved, still on the second API employee and approved, and its three neighbours as they were",
    absenceStates.moved,
    "the four absences: A as moved (the person and the status as before), N, R and J untouched",
  ),
  plannerPutsAbsence(
    "/api/absences/<id> with an employee, a type and a start that are wrong",
    apiAbsenceUrl,
    () => ({ json: { employeeId: "nope", type: "holiday", startDate: "2019-12-31", endDate: "2090-06-12" } }),
    refusesAbsence({
      employeeId: absenceMessages.employeeId,
      type: absenceMessages.type,
      startDate: absenceMessages.startDate,
    }),
  ),
  plannerPutsAbsence(
    "/api/absences/<unknown UUID>",
    () => unknownAbsenceUrl,
    () => ({ json: absenceInput(absenceStates.changed) }),
    notFoundRefused,
  ),
  plannerPutsAbsence(
    "/api/absences/not-a-uuid",
    () => "/api/absences/not-a-uuid",
    () => ({ json: absenceInput(absenceStates.changed) }),
    notFoundRefused,
  ),
  plannerPutsAbsence(
    "/api/absences/<id> with a form body",
    apiAbsenceUrl,
    () => ({ form: absenceInput(absenceStates.changed) }),
    { status: 415, check: isUnsupportedMediaType, describe: "the error unsupported_media_type" },
  ),
  plannerPutsAbsence("/api/absences/<id> with a body that is not JSON", apiAbsenceUrl, () => ({ jsonText: "{" }), {
    status: 400,
    check: isInvalidJson,
    describe: "the error invalid_json",
  }),
  plannerReadsApiAbsences(
    "is unchanged after the refused PUTs",
    absenceStates.moved,
    "the four absences as before: A as moved, N, R and J untouched",
  ),
  listsAbsence("A (moved) with the new type and days", listedA("moved")),
  listsAbsence("N unchanged next to it", listedNeighbour),
  absenceEditPage("the values of A after the update", "moved"),

  // DELETE is idempotent: an absence that is gone answers 200 as well, so the second call changes nothing. An id that is not
  // a UUID is no absence and gets 404. The neighbours are read after every call.
  plannerDeletesAbsence("/api/absences/not-a-uuid", () => "/api/absences/not-a-uuid", notFoundRefused),
  plannerReadsApiAbsences(
    "is unchanged after the DELETE of an id that is not a UUID",
    absenceStates.moved,
    "the four absences as before",
  ),
  plannerDeletesAbsence("/api/absences/<id> removes the absence", apiAbsenceUrl, wasWritten),
  plannerReadsApiAbsences(
    "shows N, R and J and not A after the DELETE",
    null,
    "the three neighbours N, R and J: only A is gone",
  ),
  plannerDeletesAbsence("/api/absences/<id> of the absence that is gone answers 200 again", apiAbsenceUrl, wasWritten),
  plannerReadsApiAbsences("is unchanged after the repeated DELETE", null, "the three neighbours N, R and J, as before"),
  plannerDeletesAbsence(
    "/api/absences/<unknown UUID> answers 200 and removes nothing",
    () => unknownAbsenceUrl,
    wasWritten,
  ),
  plannerReadsApiAbsences(
    "is unchanged after the DELETE of an absence that never existed",
    null,
    "the three neighbours N, R and J, as before",
  ),
  absenceListPage(
    "the three neighbours J, R and N in that order and no row of A",
    (html) =>
      !listedRowIds(html).includes(apiAbsenceId) &&
      absenceListItems(html, apiAbsenceId).length === 0 &&
      listsInStartOrder(() => [rejectedApiAbsenceId, requestedApiAbsenceId, neighbourAbsenceId])(html) &&
      [listedNeighbour, listedRequested, listedRejected].every((listed) => showsListedAbsence(listed)(html)),
    (html) => JSON.stringify(listedRowIds(html)),
  ),
  visitAbsencePage(
    "/absences/<id> of the removed absence shows the page of a missing one",
    () => `/absences/${apiAbsenceId}`,
    {
      status: 404,
      bodyCheck: showsNoAbsence,
      describe: 'the heading "Nie znaleziono nieobecności", the link back to the list and no form',
      excerpt: (html) => JSON.stringify({ h1: textsOf(html, "h1"), links: linksOf(html) }),
    },
  ),

  // The two views of the list. An absence of 2021 (long over) is written for the second API employee by the service role: the
  // default view (the absences that ended in the last twelve months or still go on) leaves it out, the full view (?all=1) shows
  // it, last, with its days and their number, and each view links to the other one. The planner then removes it again, so the
  // exact reads of the absences of that person that follow are not disturbed, and the final check asks for its id as well.
  serviceRoleInsertsAbsences(
    "writes an absence of 2021 for the second API employee",
    () => [oldApiAbsenceBody()],
    ([id]) => {
      oldApiAbsenceId = id;
    },
    "the vacation of 2021-05-03 to 2021-05-14 of the second API employee, approved",
  ),
  [
    `${planner.label}: GET /absences leaves the absence of 2021 out of the default view`,
    async () => {
      const result = await request(planner, "/absences");
      recentViewRows = listedRowIds(result.body).length;
      return result;
    },
    {
      status: 200,
      cacheControl: "no-store",
      bodyCheck: showsRecentAbsenceView,
      describe:
        'the default view: the heading "Nieobecności (n)" with n the rows of the table, the note and the link "Pokaż starsze" (/absences?all=1), no note of a cut list and no row of the absence of 2021',
      excerpt: absenceViewExcerpt,
    },
  ],
  visitAbsencePage(
    "/absences?all=1 shows the absence of 2021 as well, last, and links back to the default view",
    () => "/absences?all=1",
    {
      status: 200,
      bodyCheck: showsAllAbsenceView,
      describe: `the full view: the heading "Nieobecności (n)" with n the rows of the table, which are the rows of the default view and the one of 2021 (n + 1), the note "${ALL_VIEW_NOTE}", the link "Pokaż tylko ostatnie 12 miesięcy" (/absences), the rows J, R, N and the one of 2021 in that order, and that row with its days "03.05${EN_DASH}14.05.2021 (12 dni)"`,
      excerpt: absenceViewExcerpt,
    },
  ),
  visitAbsencePage(
    "/absences?all=true is the default view: only the value 1 asks for the full one",
    () => "/absences?all=true",
    {
      status: 200,
      bodyCheck: showsRecentAbsenceView,
      describe: "the default view again: its note and link, and no row of the absence of 2021",
      excerpt: absenceViewExcerpt,
    },
  ),
  plannerDeletesAbsence(
    "/api/absences/<id> removes the absence of 2021",
    () => `/api/absences/${oldApiAbsenceId}`,
    wasWritten,
  ),
  plannerReadsApiAbsences(
    "is back to N, R and J after the absence of 2021 is removed",
    null,
    "the three neighbours N, R and J: only the absence of 2021 is gone",
  ),
  visitAbsencePage("/absences?all=1 no longer shows the absence of 2021", () => "/absences?all=1", {
    status: 200,
    bodyCheck: (html) =>
      showsAbsenceListFrame(html) &&
      sameList(viewNotesOf(html), [ALL_VIEW_NOTE]) &&
      isNotInList(html, oldApiAbsenceId) &&
      listedRowIds(html).length === recentViewRows,
    describe: "the full view with exactly the rows of the default view: the absence of 2021 is gone",
    excerpt: absenceViewExcerpt,
  }),
];

// The absences on the assignment page (S-07). Two schedules of their own, with people of their own (the e-mails and names start
// with "smoke-" / "Smoke-", so the final cleanup finds them), all on a full FTE and one shift a day or two. Both start before
// 2026-11-15, so the steps of the schedule list keep their result. The week of Monday 02.11.2026 has no holiday (the norm of a
// full FTE is 40 h), the week from Tuesday 10.11.2026 has the holiday of Wednesday 11.11 (32 h). The planner puts the people on
// the cells through the assignment route and writes the approved absences through the app (`POST /api/absences`); the
// requested and the rejected ones can only be written by the service role, as no session may write a status. The page steps read
// the HTML of `/schedules/<id>/assign` and compare it with the data written out here: the counter and every item of the list
// (the weight and the whole reason, in the order of the rules), the column "Wskazania", the notes under the buttons of the day
// cells (the absence as text, then the mark of a violation), and the column "Godziny". A first state, before any absence is
// written, shows that the absences are what changes the page; the neighbour steps then remove one absence at a time
// (`DELETE /api/absences/<id>`) and read the page again, so what goes is what that absence caused and nothing else.
// The week schedule (M is the shift of the API steps, 06:00-14:00, V ends exactly at midnight, 16:00-00:00, and U runs across it,
// 18:00-02:00, both of 8 h and made by the steps):
//   hit     (a)  M on days 0 and 2, vacation 03.11-05.11 approved: day 2 is critical, day 0 is not; the norm is 16 h (3 days)
//   req     (b)  M on day 1, vacation 03.11-04.11 requested: a warning, and the norm stays 40 h
//   rej     (c)  M on days 1 and 2, vacation 02.11-06.11 rejected: nothing at all, and the norm stays 40 h
//   night   (d)  U on day 1 (18:00 to 02:00 on day 2), other 04.11-05.11 approved: the night runs into the first day of the
//                absence, so it is critical although the cell of day 1 is not a day of absence
//   edge    (d)  V on day 2 (ends at 00:00 of day 3), sick leave 05.11-06.11 approved: it ends exactly where the absence starts,
//                so there is nothing
//   tail    (d)  U on day 6 (runs to 02:00 of day 7), vacation 09.11-10.11 approved, outside the seven days: critical (the
//                absences are read for the day after the schedule as well) and the norm stays 40 h
//   mix     (e)  M on days 2 and 3, vacation 02.11-08.11 requested and other 04.11 approved: day 2 is critical (the approved
//                absence is the strongest), day 3 a warning; the day cells name the approved one on day 2
//   two     (e)  M on days 2 and 4, vacation 03.11-05.11 and sick leave 04.11-06.11, both approved: one item for each shift
//                (the one that starts earlier is named on day 2), the norm is 8 h (4 days, each counted once) and 16 h is over it
//   norm    (f)  M on days 0, 4 and 5, vacation 03.11-05.11 approved: the norm is 16 h and 24 h is over it (a warning)
//   weekend (f)  M on days 0 and 1, other 07.11-08.11 approved (Saturday and Sunday): the norm stays 40 h
//   none         nobody and nothing: the person with no absence and no shift
// The holiday schedule (M on days 4 and 6, that is Saturday 14.11 and Monday 16.11):
//   hol     (f)  M on day 4, vacation 10.11-13.11 approved (a holiday in the middle): 40 h less the holiday and the 3 other
//                working days is 8 h, so 8 h is equal to the norm
//   holover (f)  M on days 4 and 6, sick leave 10.11-13.11 approved: 16 h is over the same norm of 8 h (a warning that names both)
//   holonly (f)  M on day 4, other 11.11 approved, the day of the holiday only: the holiday is counted once, so the norm is 32 h
const absScheduleLabel = `Smoke-${runId}-absences`;
const absHolidayScheduleLabel = `Smoke-${runId}-absences-holiday`;
const absWeek = {
  startDate: "2026-11-02",
  period: `02.11${EN_DASH}08.11.2026`,
  days: ["pon. 02.11", "wt. 03.11", "śr. 04.11", "czw. 05.11", "pt. 06.11", "sob. 07.11", "niedz. 08.11"],
};
const absHoliday = {
  startDate: "2026-11-10",
  period: `10.11${EN_DASH}16.11.2026`,
  days: ["wt. 10.11", "śr. 11.11", "czw. 12.11", "pt. 13.11", "sob. 14.11", "niedz. 15.11", "pon. 16.11"],
};
let absScheduleId;
let absHolidayScheduleId;
const absScheduleIdOf = () => absScheduleId;
const absHolidayScheduleIdOf = () => absHolidayScheduleId;

// The two shifts the steps make: one that ends at 00:00 (the end is the start of the next day, a boundary the absence must not
// cross) and one that crosses midnight and is no longer than 8 h (so that no rule of the hours of a day joins the list).
const absEveningShift = { name: `Smoke-${runId}-Wieczorna`, startTime: "16:00", endTime: "00:00" };
const absNightShift = { name: `Smoke-${runId}-Nocka`, startTime: "18:00", endTime: "02:00" };
let absEveningShiftId;
let absNightShiftId;
const absShifts = {
  M: rulesShifts.M,
  V: { name: absEveningShift.name, hours: shiftHours("16:00", "00:00"), id: () => absEveningShiftId },
  U: { name: absNightShift.name, hours: shiftHours("18:00", "02:00"), id: () => absNightShiftId },
};
const plannerCreatesAbsShift = (what, input, startMinute, endMinute, remember) => [
  `${planner.label}: POST /api/shifts creates ${what}`,
  async () => {
    const result = await request(planner, "/api/shifts", { method: "POST", json: input });
    remember(parseJson(result.body)?.shift?.id);
    return result;
  },
  {
    status: 201,
    contentType: "application/json",
    check: (body) =>
      typeof body.shift.id === "string" &&
      body.shift.name === input.name &&
      body.shift.startMinute === startMinute &&
      body.shift.endMinute === endMinute,
    describe: `the shift ${input.startTime}-${input.endTime} (minutes ${startMinute} to ${endMinute}) with its own id`,
  },
];

const absWeekRoster = ["hit", "req", "rej", "night", "edge", "tail", "mix", "two", "norm", "weekend", "none"];
const absHolidayRoster = ["hol", "holover", "holonly"];
const absPeople = Object.fromEntries(
  [...absWeekRoster, ...absHolidayRoster].map((who) => [
    who,
    {
      firstName: "Ala",
      lastName: `Smoke-${runId}-abs-${who}`,
      email: `smoke-${runId}-abs-${who}@example.com`,
      fteNumerator: 1,
      fteDenominator: 1,
    },
  ]),
);
const absIds = {};
const absName = (who) => personName(absPeople[who]);

// [person, shift, day] of the assignments the steps add, one request each. The staffing of every cell is the number of people
// put on it, so no shortage and no excess is in the way of what the steps look at.
const absAssignments = [
  ["hit", "M", 0],
  ["hit", "M", 2],
  ["req", "M", 1],
  ["rej", "M", 1],
  ["rej", "M", 2],
  ["night", "U", 1],
  ["edge", "V", 2],
  ["tail", "U", 6],
  ["mix", "M", 2],
  ["mix", "M", 3],
  ["two", "M", 2],
  ["two", "M", 4],
  ["norm", "M", 0],
  ["norm", "M", 4],
  ["norm", "M", 5],
  ["weekend", "M", 0],
  ["weekend", "M", 1],
];
const absHolidayAssignments = [
  ["hol", "M", 4],
  ["holover", "M", 4],
  ["holover", "M", 6],
  ["holonly", "M", 4],
];
const absStaffing = (assignments) => {
  const counts = new Map();
  for (const [, shift, day] of assignments) {
    counts.set(`${shift}/${day}`, (counts.get(`${shift}/${day}`) ?? 0) + 1);
  }
  return [...counts].map(([cell, count]) => {
    const [shift, day] = cell.split("/");
    return { shiftId: absShifts[shift].id(), dayOffset: Number(day), requiredCount: count };
  });
};
const absSchedule = () => ({
  startDate: absWeek.startDate,
  label: absScheduleLabel,
  staffing: absStaffing(absAssignments),
  employeeIds: absWeekRoster.map((who) => absIds[who]),
});
const absHolidaySchedule = () => ({
  startDate: absHoliday.startDate,
  label: absHolidayScheduleLabel,
  staffing: absStaffing(absHolidayAssignments),
  employeeIds: absHolidayRoster.map((who) => absIds[who]),
});
const plannerCreatesAbsSchedule = (what, state, remember) => [
  `${planner.label}: POST /api/schedules creates ${what}`,
  async () => {
    const result = await request(planner, "/api/schedules", { method: "POST", json: state() });
    remember(parseJson(result.body)?.id);
    return result;
  },
  {
    status: 201,
    contentType: "application/json",
    cacheControl: "no-store",
    check: (body) => isUuidText(body.id) && Object.keys(body).length === 1,
    describe: "the id of the new schedule and nothing else",
  },
];

const absAssignmentsUrl = (id) => () => `/api/schedules/${id()}/assignments`;
const absBody = ([who, shift, day]) => ({
  shiftId: absShifts[shift].id(),
  dayOffset: day,
  employeeId: absIds[who],
});
const absTag = ([who, shift, day]) => `${who}/${shift}/${day}`;
const plannerAddsAbsAssignment = (id, assignment) =>
  plannerCallsAssignments(
    "POST",
    `adds ${absTag(assignment)}`,
    absAssignmentsUrl(id),
    () => ({ json: absBody(assignment) }),
    wasWritten,
  );
// The rows of the assignment table of a schedule are exactly `expected`, each with the source the column defaults to.
const isAbsAssignments = (id, expected) => (rows) =>
  Array.isArray(rows) &&
  rows.every((row) => row.schedule_id === id() && row.source === "manual") &&
  sameItems(
    rows.map((row) => assignmentKey(row.shift_id, row.day_offset, row.employee_id)),
    expected.map((assignment) => {
      const { shiftId, dayOffset, employeeId } = absBody(assignment);
      return assignmentKey(shiftId, dayOffset, employeeId);
    }),
  );
const plannerReadsAbsAssignments = (id, name, expected, what) => [
  `${planner.label}: schedule_assignments of ${name} read`,
  async () => assignmentsTable("GET", { token: await accessToken(planner), query: `?schedule_id=eq.${id()}` }),
  {
    status: 200,
    check: isAbsAssignments(id, expected),
    describe: `exactly the assignments of ${what}, all with source manual`,
  },
];

// The absences. `who` is a person, `status` is what the table holds. The ids are only known once the create steps have run.
const absAbsences = {
  hit: { who: "hit", type: "vacation", status: "approved", startDate: "2026-11-03", endDate: "2026-11-05" },
  req: { who: "req", type: "vacation", status: "requested", startDate: "2026-11-03", endDate: "2026-11-04" },
  rej: { who: "rej", type: "vacation", status: "rejected", startDate: "2026-11-02", endDate: "2026-11-06" },
  night: { who: "night", type: "other", status: "approved", startDate: "2026-11-04", endDate: "2026-11-05" },
  edge: { who: "edge", type: "sick_leave", status: "approved", startDate: "2026-11-05", endDate: "2026-11-06" },
  tail: { who: "tail", type: "vacation", status: "approved", startDate: "2026-11-09", endDate: "2026-11-10" },
  mixReq: { who: "mix", type: "vacation", status: "requested", startDate: "2026-11-02", endDate: "2026-11-08" },
  mixOk: { who: "mix", type: "other", status: "approved", startDate: "2026-11-04", endDate: "2026-11-04" },
  twoVac: { who: "two", type: "vacation", status: "approved", startDate: "2026-11-03", endDate: "2026-11-05" },
  twoSick: { who: "two", type: "sick_leave", status: "approved", startDate: "2026-11-04", endDate: "2026-11-06" },
  norm: { who: "norm", type: "vacation", status: "approved", startDate: "2026-11-03", endDate: "2026-11-05" },
  weekend: { who: "weekend", type: "other", status: "approved", startDate: "2026-11-07", endDate: "2026-11-08" },
  hol: { who: "hol", type: "vacation", status: "approved", startDate: "2026-11-10", endDate: "2026-11-13" },
  holover: { who: "holover", type: "sick_leave", status: "approved", startDate: "2026-11-10", endDate: "2026-11-13" },
  holonly: { who: "holonly", type: "other", status: "approved", startDate: "2026-11-11", endDate: "2026-11-11" },
};
const absAbsenceIds = {};
const absAllKeys = Object.keys(absAbsences);
const absApprovedKeys = absAllKeys.filter((key) => absAbsences[key].status === "approved");
const absWithout = (removed) => absAllKeys.filter((key) => !removed.includes(key));
// The same absence as the app takes it, and as the table holds it (a row has the id and every column).
const absAbsenceJson = (key) => {
  const { who, type, startDate, endDate } = absAbsences[key];
  return { employeeId: absIds[who], type, startDate, endDate };
};
const absAbsenceBody = (key) => {
  const { who, type, status, startDate, endDate } = absAbsences[key];
  return { employee_id: absIds[who], type, status, start_date: startDate, end_date: endDate };
};
const absAbsenceRow = (key) => storedAbsence(absAbsenceIds[key], absAbsenceBody(key));
const plannerAddsAbsAbsence = (key) =>
  plannerCreatesAbsence(
    `creates the absence ${key} of the absence schedules`,
    () => ({ json: absAbsenceJson(key) }),
    (id) => {
      absAbsenceIds[key] = id;
    },
    {
      check: (body) =>
        isUuidText(body.absence.id) &&
        body.absence.status === "approved" &&
        body.absence.employeeId === absIds[absAbsences[key].who] &&
        body.absence.type === absAbsences[key].type &&
        body.absence.startDate === absAbsences[key].startDate &&
        body.absence.endDate === absAbsences[key].endDate,
      describe: `{ absence } of ${absAbsences[key].who}: ${absAbsences[key].type} on ${absAbsences[key].startDate} to ${absAbsences[key].endDate}, approved`,
    },
  );
// A status other than approved is what no session may write, so the service role writes it.
const serviceRoleAddsAbsAbsence = (key) =>
  serviceRoleInsertsAbsences(
    `writes the ${absAbsences[key].status} absence ${key} of the absence schedules`,
    () => [absAbsenceBody(key)],
    ([id]) => {
      absAbsenceIds[key] = id;
    },
    `the ${absAbsences[key].status} ${absAbsences[key].type} of ${absAbsences[key].who}`,
  );
// Every absence of the people of both schedules, which must be exactly the ones of `keys`.
const plannerReadsAbsAbsences = (name, keys, what) => [
  `${planner.label}: absences of the absence schedules read ${name}`,
  async () =>
    absencesTable("GET", {
      token: await accessToken(planner),
      query: `?employee_id=in.(${Object.values(absIds).join(",")})`,
    }),
  {
    status: 200,
    check: isAbsences(() => keys.map(absAbsenceRow)),
    describe: `exactly ${what}, each with the seven columns of the table`,
  },
];
// The absences the neighbour steps remove, in this order: the week schedule first, then the holiday one. A step removes one more
// and reads the table: only that absence is gone, and every other row is there with every column as it was.
const absRemovalOrder = ["hit", "twoVac", "mixOk", "night", "tail", "holover"];
const absRemovedUpTo = (key) => absRemovalOrder.slice(0, absRemovalOrder.indexOf(key) + 1);
const plannerRemovesAbsAbsence = (key) => [
  plannerDeletesAbsence(
    `/api/absences/<id> removes the absence ${key}`,
    () => `/api/absences/${absAbsenceIds[key]}`,
    wasWritten,
  ),
  plannerReadsAbsAbsences(
    `holds the rest after the DELETE of ${key}`,
    absWithout(absRemovedUpTo(key)),
    `the ${absAllKeys.length - absRemovedUpTo(key).length} absences that are left: every one but ${absRemovedUpTo(key).join(", ")}`,
  ),
];

// What the page must say, written out the way the rules word it (src/lib/services/rules.ts): the type of an absence after
// "przypada na", in the middle of a sentence and in the marker of a cell, and the days of an absence for people.
const absAccusative = { vacation: "urlop", sick_leave: "zwolnienie lekarskie (L4)", other: "inną nieobecność" };
const absLowerLabel = { vacation: "urlop", sick_leave: "zwolnienie lekarskie (L4)", other: "inna nieobecność" };
const absDate = (isoDate) => `${isoDate.slice(8, 10)}.${isoDate.slice(5, 7)}`;
const absRange = ({ startDate, endDate }) =>
  startDate === endDate
    ? `${absDate(startDate)}.${startDate.slice(0, 4)}`
    : `${absDate(startDate)}${EN_DASH}${absDate(endDate)}.${endDate.slice(0, 4)}`;
// What a day cell says of the absence: the type in words, and "(niezatwierdzona)" for one that is not approved yet.
const absMarker = ({ type, status }) =>
  `Nieobecność: ${absLowerLabel[type]}${status === "approved" ? "" : " (niezatwierdzona)"}`;
// The marker of the absence `key` on each of `days`, as { day: text }.
const awayOf = (key, days) => Object.fromEntries(days.map((day) => [day, absMarker(absAbsences[key])]));

const ABS_RULES_ORDER = [
  "daily_rest",
  "daily_hours",
  "weekly_hours",
  "weekly_rest",
  "absence",
  "weekly_norm",
  "understaffed",
  "absence_requested",
];
// The order of the rules (the weight, the rule, the person by id, then the day of the first anchor), as `compareItems` has it
// for the rules schedule.
const absCompareItems = (a, b) =>
  SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
  ABS_RULES_ORDER.indexOf(a.rule) - ABS_RULES_ORDER.indexOf(b.rule) ||
  compareIds(absIds[a.who], absIds[b.who]) ||
  a.day - b.day;
const absListOf = (items) =>
  [...items].sort(absCompareItems).map((item) => `${SEVERITY_WORDS[item.severity]} ${item.reason}`);
const absCell = (shift, day) => `${absShifts[shift].name} (${absWeek.days[day]}, ${absShifts[shift].hours})`;
// A shift that overlaps an absence of its person: critical for an approved one, a warning for a requested one.
const absCollisionItem = (who, shift, day, key) => {
  const absence = absAbsences[key];
  const approved = absence.status === "approved";
  const head = `${absName(who)}: zmiana ${absCell(shift, day)} przypada na`;
  return ruleItem(
    approved ? "critical" : "warning",
    approved ? "absence" : "absence_requested",
    who,
    day,
    approved
      ? `${head} ${absAccusative[absence.type]} (${absRange(absence)}).`
      : `${head} nieobecność jeszcze niezatwierdzoną (${absLowerLabel[absence.type]}, ${absRange(absence)}).`,
  );
};
// The week above the norm that an approved absence (and a holiday) has lowered; the FTE is full.
const absNormItem = (who, total, limit, lowered, period = absWeek.period) =>
  ruleItem(
    "warning",
    "weekly_norm",
    who,
    0,
    `${absName(who)}: w tygodniu grafiku (${period}) łączny czas pracy ${total}, norma tygodniowa (pełny etat) to ${limit} po pomniejszeniu o ${lowered}.`,
  );
const absItems = {
  hit: () => absCollisionItem("hit", "M", 2, "hit"),
  req: () => absCollisionItem("req", "M", 1, "req"),
  night: () => absCollisionItem("night", "U", 1, "night"),
  tail: () => absCollisionItem("tail", "U", 6, "tail"),
  mixOkOnDay2: () => absCollisionItem("mix", "M", 2, "mixOk"),
  mixReqOnDay2: () => absCollisionItem("mix", "M", 2, "mixReq"),
  mixReqOnDay3: () => absCollisionItem("mix", "M", 3, "mixReq"),
  twoVacOnDay2: () => absCollisionItem("two", "M", 2, "twoVac"),
  twoSickOnDay2: () => absCollisionItem("two", "M", 2, "twoSick"),
  twoSickOnDay4: () => absCollisionItem("two", "M", 4, "twoSick"),
  norm: () => absNormItem("norm", "24 h", "16 h", "nieobecność (3 dni: 03.11, 04.11, 05.11)"),
  twoNorm: () => absNormItem("two", "16 h", "8 h", "nieobecność (4 dni: 03.11, 04.11, 05.11, 06.11)"),
  holoverNorm: () =>
    absNormItem("holover", "16 h", "8 h", "święto 11.11 i nieobecność (3 dni: 10.11, 12.11, 13.11)", absHoliday.period),
};

// What the page says about each person in a state: the text of the column "Wskazania", the marks of the cells ({ day: text },
// the violations that sit on an assignment of that day), the markers of the absences ({ day: text }) and the column "Godziny".
const quiet = { column: "brak", marks: {}, away: {} };
// Before any absence is written: no item, nobody is away, and the norm of everybody is the 40 h of the week.
const absBaselinePeople = {
  hit: { ...quiet, hours: "16 h z 40 h mniej o 24 h" },
  req: { ...quiet, hours: "8 h z 40 h mniej o 32 h" },
  rej: { ...quiet, hours: "16 h z 40 h mniej o 24 h" },
  night: { ...quiet, hours: "8 h z 40 h mniej o 32 h" },
  edge: { ...quiet, hours: "8 h z 40 h mniej o 32 h" },
  tail: { ...quiet, hours: "8 h z 40 h mniej o 32 h" },
  mix: { ...quiet, hours: "16 h z 40 h mniej o 24 h" },
  two: { ...quiet, hours: "16 h z 40 h mniej o 24 h" },
  norm: { ...quiet, hours: "24 h z 40 h mniej o 16 h" },
  weekend: { ...quiet, hours: "16 h z 40 h mniej o 24 h" },
  none: { ...quiet, hours: "0 min z 40 h mniej o 40 h" },
};
const absAllPeople = {
  ...absBaselinePeople,
  // (a) day 2 is on the absence and critical, day 0 is not; the 3 days take the norm down to 16 h, which 16 h equals.
  hit: {
    column: "1 krytyczne",
    marks: { 2: "Krytyczne: 1" },
    away: awayOf("hit", [1, 2, 3]),
    hours: "16 h z 16 h równo z normą",
  },
  // (b) a requested absence warns and lowers nothing.
  req: {
    column: "1 ostrzeżenie",
    marks: { 1: "Ostrzeżenie: 1" },
    away: awayOf("req", [1, 2]),
    hours: "8 h z 40 h mniej o 32 h",
  },
  // (c) a rejected absence is nowhere: the baseline of the person stays.
  // (d) the mark is on day 1 (the shift), the absence markers on days 2 and 3 (the absence); 2 days take 16 h off the norm.
  night: {
    column: "1 krytyczne",
    marks: { 1: "Krytyczne: 1" },
    away: awayOf("night", [2, 3]),
    hours: "8 h z 24 h mniej o 16 h",
  },
  // (d) a shift that ends exactly where the absence starts is no violation; the absence still lowers the norm by its 2 days.
  edge: { ...quiet, away: awayOf("edge", [3, 4]), hours: "8 h z 24 h mniej o 16 h" },
  // (d) the absence is outside the seven days: no marker, no lower norm, but the night of day 6 runs into it.
  tail: { column: "1 krytyczne", marks: { 6: "Krytyczne: 1" }, away: {}, hours: "8 h z 40 h mniej o 32 h" },
  // (e) the approved absence is the strongest on day 2 and is named in the cell; the rest of the week is the requested one.
  mix: {
    column: "1 krytyczne, 1 ostrzeżenie",
    marks: { 2: "Krytyczne: 1", 3: "Ostrzeżenie: 1" },
    away: { ...awayOf("mixReq", [0, 1, 3, 4, 5, 6]), ...awayOf("mixOk", [2]) },
    hours: "16 h z 32 h mniej o 16 h",
  },
  // (e) the vacation starts earlier, so it is the one named on days 1 to 3; the sick leave is on day 4 alone. The union of the
  // two is 4 working days, counted once each: the norm is 8 h.
  two: {
    column: "2 krytyczne, 1 ostrzeżenie",
    marks: { 2: "Krytyczne: 1", 4: "Krytyczne: 1" },
    away: { ...awayOf("twoVac", [1, 2, 3]), ...awayOf("twoSick", [4]) },
    hours: "16 h z 8 h więcej o 8 h",
  },
  // (f) 3 working days of absence: the norm is 16 h and 24 h is a warning against it; the shifts are on other days.
  norm: {
    column: "1 ostrzeżenie",
    marks: {},
    away: awayOf("norm", [1, 2, 3]),
    hours: "24 h z 16 h więcej o 8 h",
  },
  // (f) an absence on Saturday and Sunday is marked and takes nothing off the norm.
  weekend: { ...quiet, away: awayOf("weekend", [5, 6]), hours: "16 h z 40 h mniej o 24 h" },
};

// The states of the week schedule the steps read: the one before any absence, the one with every absence, and then one state
// for each absence removed (cumulatively), each differing from the one before it in the person of that absence only.
const absWeekStates = [
  {
    what: "before any absence is written",
    people: absBaselinePeople,
    counter: noViolationsCounter,
    items: () => [],
    listDescribe: 'the counter "Brak wskazań" and no item: the same shifts and nobody away',
  },
  {
    what: "with all twelve absences of the week",
    people: absAllPeople,
    counter: "Wskazania: 6 krytycznych, 4 ostrzeżenia",
    items: () => [
      absItems.hit(),
      absItems.night(),
      absItems.tail(),
      absItems.mixOkOnDay2(),
      absItems.twoVacOnDay2(),
      absItems.twoSickOnDay4(),
      absItems.norm(),
      absItems.twoNorm(),
      absItems.req(),
      absItems.mixReqOnDay3(),
    ],
    listDescribe:
      'the counter "Wskazania: 6 krytycznych, 4 ostrzeżenia" and the ten items in the order of the rules: critical absences (hit on day 2, night on day 1 across midnight, tail on day 6 into the day after the schedule, mix on day 2 with the approved absence, two on days 2 and 4 each with the absence that starts earlier there), then the warnings (norm and two over the lowered norm, then the requested absences of req on day 1 and of mix on day 3); none for rej, edge and weekend',
  },
  {
    what: "after the absence of hit is removed",
    removed: ["hit"],
    people: { ...absAllPeople, hit: absBaselinePeople.hit },
    counter: "Wskazania: 5 krytycznych, 4 ostrzeżenia",
    items: () => [
      absItems.night(),
      absItems.tail(),
      absItems.mixOkOnDay2(),
      absItems.twoVacOnDay2(),
      absItems.twoSickOnDay4(),
      absItems.norm(),
      absItems.twoNorm(),
      absItems.req(),
      absItems.mixReqOnDay3(),
    ],
    listDescribe:
      'the counter "Wskazania: 5 krytycznych, 4 ostrzeżenia": the item of hit is gone and the nine others are as before',
  },
  {
    what: "after the vacation of two is removed too",
    removed: ["hit", "twoVac"],
    people: {
      ...absAllPeople,
      hit: absBaselinePeople.hit,
      two: {
        column: "2 krytyczne",
        marks: { 2: "Krytyczne: 1", 4: "Krytyczne: 1" },
        away: awayOf("twoSick", [2, 3, 4]),
        hours: "16 h z 16 h równo z normą",
      },
    },
    counter: "Wskazania: 5 krytycznych, 3 ostrzeżenia",
    items: () => [
      absItems.night(),
      absItems.tail(),
      absItems.mixOkOnDay2(),
      absItems.twoSickOnDay2(),
      absItems.twoSickOnDay4(),
      absItems.norm(),
      absItems.req(),
      absItems.mixReqOnDay3(),
    ],
    listDescribe:
      'the counter "Wskazania: 5 krytycznych, 3 ostrzeżenia": two still has two critical items, now both with the sick leave (04.11-06.11), and the warning about its norm is gone (3 days: 16 h of 16 h)',
  },
  {
    what: "after the approved absence of mix is removed too",
    removed: ["hit", "twoVac", "mixOk"],
    people: {
      ...absAllPeople,
      hit: absBaselinePeople.hit,
      two: {
        column: "2 krytyczne",
        marks: { 2: "Krytyczne: 1", 4: "Krytyczne: 1" },
        away: awayOf("twoSick", [2, 3, 4]),
        hours: "16 h z 16 h równo z normą",
      },
      mix: {
        column: "2 ostrzeżenia",
        marks: { 2: "Ostrzeżenie: 1", 3: "Ostrzeżenie: 1" },
        away: awayOf("mixReq", [0, 1, 2, 3, 4, 5, 6]),
        hours: "16 h z 40 h mniej o 24 h",
      },
    },
    counter: "Wskazania: 4 krytyczne, 4 ostrzeżenia",
    items: () => [
      absItems.night(),
      absItems.tail(),
      absItems.twoSickOnDay2(),
      absItems.twoSickOnDay4(),
      absItems.norm(),
      absItems.req(),
      absItems.mixReqOnDay2(),
      absItems.mixReqOnDay3(),
    ],
    listDescribe:
      'the counter "Wskazania: 4 krytyczne, 4 ostrzeżenia": only the requested absence is left to mix, so both of its shifts are warnings with the requested absence (02.11-08.11) and the critical item is gone',
  },
  {
    what: "after the absence of night is removed too",
    removed: ["hit", "twoVac", "mixOk", "night"],
    people: {
      ...absAllPeople,
      hit: absBaselinePeople.hit,
      night: absBaselinePeople.night,
      two: {
        column: "2 krytyczne",
        marks: { 2: "Krytyczne: 1", 4: "Krytyczne: 1" },
        away: awayOf("twoSick", [2, 3, 4]),
        hours: "16 h z 16 h równo z normą",
      },
      mix: {
        column: "2 ostrzeżenia",
        marks: { 2: "Ostrzeżenie: 1", 3: "Ostrzeżenie: 1" },
        away: awayOf("mixReq", [0, 1, 2, 3, 4, 5, 6]),
        hours: "16 h z 40 h mniej o 24 h",
      },
    },
    counter: "Wskazania: 3 krytyczne, 4 ostrzeżenia",
    items: () => [
      absItems.tail(),
      absItems.twoSickOnDay2(),
      absItems.twoSickOnDay4(),
      absItems.norm(),
      absItems.req(),
      absItems.mixReqOnDay2(),
      absItems.mixReqOnDay3(),
    ],
    listDescribe:
      'the counter "Wskazania: 3 krytyczne, 4 ostrzeżenia": the night across midnight of night is gone with its absence',
  },
  {
    what: "after the absence of tail is removed too",
    removed: ["hit", "twoVac", "mixOk", "night", "tail"],
    people: {
      ...absAllPeople,
      hit: absBaselinePeople.hit,
      night: absBaselinePeople.night,
      tail: absBaselinePeople.tail,
      two: {
        column: "2 krytyczne",
        marks: { 2: "Krytyczne: 1", 4: "Krytyczne: 1" },
        away: awayOf("twoSick", [2, 3, 4]),
        hours: "16 h z 16 h równo z normą",
      },
      mix: {
        column: "2 ostrzeżenia",
        marks: { 2: "Ostrzeżenie: 1", 3: "Ostrzeżenie: 1" },
        away: awayOf("mixReq", [0, 1, 2, 3, 4, 5, 6]),
        hours: "16 h z 40 h mniej o 24 h",
      },
    },
    counter: "Wskazania: 2 krytyczne, 4 ostrzeżenia",
    items: () => [
      absItems.twoSickOnDay2(),
      absItems.twoSickOnDay4(),
      absItems.norm(),
      absItems.req(),
      absItems.mixReqOnDay2(),
      absItems.mixReqOnDay3(),
    ],
    listDescribe:
      'the counter "Wskazania: 2 krytyczne, 4 ostrzeżenia": the item of tail (the night of day 6 into the day after the schedule) is gone, and the hours of tail are as before because that absence was outside the seven days',
  },
];

// The holiday week: the two states of it, with every absence and after the one of holover is removed.
const absHolidayPeople = {
  hol: { ...quiet, away: awayOf("hol", [0, 1, 2, 3]), hours: "8 h z 8 h równo z normą" },
  holover: {
    column: "1 ostrzeżenie",
    marks: {},
    away: awayOf("holover", [0, 1, 2, 3]),
    hours: "16 h z 8 h więcej o 8 h",
  },
  holonly: { ...quiet, away: awayOf("holonly", [1]), hours: "8 h z 32 h mniej o 24 h" },
};
const absHolidayStates = [
  {
    what: "with the three absences",
    people: absHolidayPeople,
    counter: "Wskazania: 1 ostrzeżenie",
    items: () => [absItems.holoverNorm()],
    listDescribe:
      'the counter "Wskazania: 1 ostrzeżenie" and one item: holover over the norm of 8 h, lowered by the holiday 11.11 and by 3 days of absence (10.11, 12.11 and 13.11, the holiday not counted again)',
  },
  {
    what: "after the absence of holover is removed",
    removed: ["holover"],
    people: {
      ...absHolidayPeople,
      holover: { ...quiet, away: {}, hours: "16 h z 32 h mniej o 16 h" },
    },
    counter: noViolationsCounter,
    items: () => [],
    listDescribe: 'the counter "Brak wskazań" and no item: 16 h is under the norm of 32 h (the holiday only)',
  },
];

// What a state says, as the page is compared with it.
const absColumnsOf = (state) =>
  Object.entries(state.people)
    .map(([who, view]) => ({ person: absName(who), violations: view.column }))
    .sort(byPerson);
const absHoursOf = (state) =>
  Object.entries(state.people).map(([who, view]) => ({ person: absName(who), hours: view.hours }));
// The notes under the buttons of each day cell, as { person, notes } for each person who has one, notes being { day: [texts] }:
// the absence first, then the mark of the violations, as the cell lays them out.
const absNotesExpected = (state) =>
  Object.entries(state.people)
    .map(([who, view]) => ({
      person: absName(who),
      notes: Object.fromEntries(
        Array.from({ length: DAY_CELLS }, (_unused, day) => [
          day,
          [view.away[day], view.marks[day]].filter((text) => text !== undefined),
        ]).filter(([, texts]) => texts.length > 0),
      ),
    }))
    .filter(({ notes }) => Object.keys(notes).length > 0)
    .sort(byPerson);
// The same read from the page. A note is one element (a div) in the cell next to the container of the buttons, so the text of the
// cell without its buttons, taken element by element, is what the cell says: no two notes run into each other.
const cellNotesOf = (cell) => textsOf(withoutButtons(cell), "div").filter((text) => text !== "");
const absNotesOnPage = (html) =>
  bodyRowsOf(cutAtCoverage(html)[0])
    .map(({ header, cells }) => ({
      person: header,
      notes: Object.fromEntries(
        cells
          .slice(0, DAY_CELLS)
          .map((cell, day) => [day, cellNotesOf(cell)])
          .filter(([, texts]) => texts.length > 0),
      ),
    }))
    .filter(({ notes }) => Object.keys(notes).length > 0)
    .sort(byPerson);
const describeAbsColumns = (state) =>
  `the column "Wskazania" reading ${Object.entries(state.people)
    .map(([who, view]) => `"${view.column}" for ${who}`)
    .join(", ")}`;

const visitAbsWeekPage = (expected) => visitAssignPage("the absences schedule", absScheduleIdOf, expected);
const visitAbsHolidayPage = (expected) =>
  visitAssignPage("the absences schedule with a holiday", absHolidayScheduleIdOf, expected);

// The four steps that read one state: the counter and the list, the column "Wskazania", the notes of the day cells and the
// column "Godziny".
const absStateSteps = (visitPage, state) => [
  visitPage({
    bodyCheck: (html) => showsViolations(absListOf(state.items()), state.counter)(html),
    describe: `${state.what}: ${state.listDescribe}`,
    excerpt: violationsExcerpt,
  }),
  visitPage({
    bodyCheck: (html) => JSON.stringify(violationColumnOf(html)) === JSON.stringify(absColumnsOf(state)),
    describe: `${state.what}: ${describeAbsColumns(state)}`,
    excerpt: (html) => JSON.stringify(violationColumnOf(html), null, 1),
  }),
  visitPage({
    bodyCheck: (html) => JSON.stringify(absNotesOnPage(html)) === JSON.stringify(absNotesExpected(state)),
    describe: `${state.what}: the notes under the buttons of the day cells exactly ${JSON.stringify(absNotesExpected(state))}`,
    excerpt: (html) => JSON.stringify(absNotesOnPage(html), null, 1),
  }),
  visitPage({
    bodyCheck: showsHoursColumn(absHoursOf(state)),
    describe: `${state.what}: ${describeHoursRows(absHoursOf(state))}`,
    excerpt: hoursColumnExcerpt,
  }),
];

// What the page is, whatever the state: a row of nine cells for each person (the markers are text in the cells of the days, so
// no cell and no table is added), the people's table with no role and no live region, and no id of an absence or e-mail address
// in the page (the island gets the person, the type, the status and the two days of an absence, and nothing else).
const absRowsOf = (roster) => (html) =>
  JSON.stringify(gridOf(html).map(({ person, cells }) => ({ person, cells }))) ===
  JSON.stringify(roster.map((who) => ({ person: absName(who), cells: GRID_ROW_CELLS })).sort(byPerson));
const absTableOf = (html) => elementsOf(cutAtCoverage(html)[0], "table")[0] ?? "";
const hasNoLiveRegionInTable = (html) => {
  const table = absTableOf(html);
  return table !== "" && !/\srole=/.test(table) && !/\saria-live=/.test(table);
};
const hidesAbsenceData = (roster) => (html) => {
  const ids = Object.values(absAbsenceIds);
  return (
    ids.length === absAllKeys.length &&
    ids.every((id) => isUuidText(id) && !html.includes(id)) &&
    roster.every((who) => !html.toLowerCase().includes(absPeople[who].email))
  );
};
const absPressedFor = (assignments, days) =>
  assignments
    .map(([who, shift, day]) =>
      buttonLabel(absName(who), days[day], `${absShifts[shift].name} ${absShifts[shift].hours}`),
    )
    .sort();
const showsAbsPressed = (assignments, days) => (html) =>
  JSON.stringify(pressedLabelsOf(html)) === JSON.stringify(absPressedFor(assignments, days));
// The coverage table counts the people on the cells whether they are away or not ("x z y" does not change): one row for each of
// `expected`, a [shift key, counters] pair, found by the name and the hours of its shift.
const showsAbsCoverage = (expected) => (html) => {
  const rows = coverageRowsOf(html);
  return (
    rows.length === expected.length &&
    expected.every(([shift, counters]) => {
      const { name, hours } = absShifts[shift];
      const found = rows.filter((row) => row.header.startsWith(name) && row.header.includes(hours));
      return (
        found.length === 1 &&
        found[0].cells.length === 7 &&
        found[0].cells.every((text, day) => (day in counters ? text === counters[day] : text.endsWith(noCellWords)))
      );
    })
  );
};
const absCoverage = [
  ["M", { 0: "3 z 3", 1: "3 z 3", 2: "4 z 4", 3: "1 z 1", 4: "2 z 2", 5: "1 z 1" }],
  ["V", { 2: "1 z 1" }],
  ["U", { 1: "1 z 1", 6: "1 z 1" }],
];

const absencePageSteps = [
  // The shifts, the people and the two schedules, made through the app like the schedules above.
  plannerCreatesAbsShift(
    "the evening shift of the absence schedules, which ends exactly at midnight",
    absEveningShift,
    960,
    0,
    (id) => {
      absEveningShiftId = id;
    },
  ),
  plannerCreatesAbsShift(
    "the night shift of the absence schedules, of 8 h across midnight",
    absNightShift,
    1080,
    120,
    (id) => {
      absNightShiftId = id;
    },
  ),
  ...[...absWeekRoster, ...absHolidayRoster].map((who) =>
    plannerCreatesEmployee(`the employee ${who} of the absence schedules`, absPeople[who], (id) => {
      absIds[who] = id;
    }),
  ),
  plannerCreatesAbsSchedule("the absences schedule", absSchedule, (id) => {
    absScheduleId = id;
  }),
  ...plannerReadsSchedule(
    "shows the absences schedule",
    absSchedule,
    "the absences schedule (the cells of 3 shifts, 11 people)",
    absScheduleIdOf,
  ),
  plannerCreatesAbsSchedule("the absences schedule with a holiday", absHolidaySchedule, (id) => {
    absHolidayScheduleId = id;
  }),
  ...plannerReadsSchedule(
    "shows the absences schedule with a holiday",
    absHolidaySchedule,
    "the absences schedule with a holiday (2 cells of 1 shift, 3 people)",
    absHolidayScheduleIdOf,
  ),
  ...absAssignments.map((assignment) => plannerAddsAbsAssignment(absScheduleIdOf, assignment)),
  plannerReadsAbsAssignments(
    absScheduleIdOf,
    "the absences schedule",
    absAssignments,
    "the absences schedule: seventeen assignments of ten people (none for none)",
  ),
  ...absHolidayAssignments.map((assignment) => plannerAddsAbsAssignment(absHolidayScheduleIdOf, assignment)),
  plannerReadsAbsAssignments(
    absHolidayScheduleIdOf,
    "the absences schedule with a holiday",
    absHolidayAssignments,
    "the absences schedule with a holiday: four assignments of three people",
  ),

  // The page before any absence exists: no item, no marker, and the norm of everybody is the 40 h of the week. What the steps
  // below show is then what the absences changed.
  ...absStateSteps(visitAbsWeekPage, absWeekStates[0]),

  // The absences: the approved ones through the app, the requested and the rejected ones by the service role.
  ...absApprovedKeys.map(plannerAddsAbsAbsence),
  ...absAllKeys.filter((key) => !absApprovedKeys.includes(key)).map(serviceRoleAddsAbsAbsence),
  plannerReadsAbsAbsences(
    "shows all fifteen absences",
    absAllKeys,
    "the fifteen absences of the people of the two schedules (twelve approved, req and mixReq requested, rej rejected)",
  ),

  // The page with every absence: what the page is, then each state.
  visitAbsWeekPage({
    bodyCheck: showsAssignHeading(absWeek.period, absScheduleLabel),
    describe: `the title and heading "Obsadzanie grafiku", the period ${absWeek.period} and the label of the absences schedule`,
    excerpt: headingExcerpt,
  }),
  visitAbsWeekPage({
    bodyCheck: showsGridHeaders(["Pracownik", ...absWeek.days, "Wskazania", "Godziny"]),
    describe: `the header row of the people's table: "Pracownik", the seven days from ${absWeek.days[0]} to ${absWeek.days[6]}, then the columns "Wskazania" and "Godziny" last, and no other table before the coverage section`,
    excerpt: (html) => JSON.stringify(gridHeadersOf(html)),
  }),
  visitAbsWeekPage({
    bodyCheck: absRowsOf(absWeekRoster),
    describe: `a row for each of the eleven people, each of exactly ${GRID_ROW_CELLS} cells: the seven days, "Wskazania" and "Godziny" (the markers of the absences add no cell)`,
    excerpt: gridExcerpt,
  }),
  visitAbsWeekPage({
    bodyCheck: showsAbsPressed(absAssignments, absWeek.days),
    describe: `a pressed button for each of the ${absAssignments.length} assignments and for no other (an absence changes no button)`,
    excerpt: (html) => JSON.stringify(pressedLabelsOf(html), null, 1),
  }),
  visitAbsWeekPage({
    bodyCheck: hasViolationSection,
    describe:
      'the section of the list of violations with the heading "Wskazania", after the people\'s table and before the coverage section',
    excerpt: violationSectionExcerpt,
  }),
  visitAbsWeekPage({
    bodyCheck: hasHoursNote,
    describe:
      "the paragraph under the people's table that says the norm is lowered by the holidays and by the days of an approved absence from Monday to Friday, once",
    excerpt: hoursNoteExcerpt,
  }),
  visitAbsWeekPage({
    bodyCheck: hasNeutralHoursColumn(absWeekRoster.length),
    describe:
      'the header "Godziny" and the eleven cells of the column with no role, no aria-live, no icon and no red, amber or sky colour class, each of exactly two lines of text',
    excerpt: hoursCellsExcerpt,
  }),
  visitAbsWeekPage({
    bodyCheck: (html) => hasNoLiveRegionInTable(html) && hasNoViolationAlert(html),
    describe:
      'no role and no aria-live in the people\'s table (the markers of the absences are plain text), and no role="alert" and no assertive live region in the list of violations',
    excerpt: (html) => absTableOf(html).slice(0, 400),
  }),
  visitAbsWeekPage({
    bodyCheck: hidesAbsenceData(absWeekRoster),
    describe: "no id of an absence of the run and no e-mail address of the eleven people anywhere in the page",
    excerpt: () => "(the page is not printed)",
  }),
  visitAbsWeekPage({
    bodyCheck: showsAbsCoverage(absCoverage),
    describe:
      'the coverage table with every counter complete ("3 z 3", "4 z 4" and so on): the people who are away count on their cells, the coverage does not change',
    excerpt: coverageExcerpt,
  }),
  ...absStateSteps(visitAbsWeekPage, absWeekStates[1]),

  // The neighbours: one absence at a time is removed through the route, and the page is read again. The table is read after
  // each DELETE, so that what the page shows is tied to what the database holds.
  ...plannerRemovesAbsAbsence("hit"),
  ...absStateSteps(visitAbsWeekPage, absWeekStates[2]),
  ...plannerRemovesAbsAbsence("twoVac"),
  ...absStateSteps(visitAbsWeekPage, absWeekStates[3]),
  ...plannerRemovesAbsAbsence("mixOk"),
  ...absStateSteps(visitAbsWeekPage, absWeekStates[4]),
  ...plannerRemovesAbsAbsence("night"),
  ...absStateSteps(visitAbsWeekPage, absWeekStates[5]),
  ...plannerRemovesAbsAbsence("tail"),
  ...absStateSteps(visitAbsWeekPage, absWeekStates[6]),
  // The assignments did not move while the absences did.
  visitAbsWeekPage({
    bodyCheck: showsAbsPressed(absAssignments, absWeek.days),
    describe: `still a pressed button for each of the ${absAssignments.length} assignments and for no other, now that five absences are gone`,
    excerpt: (html) => JSON.stringify(pressedLabelsOf(html), null, 1),
  }),
  visitAbsWeekPage({
    bodyCheck: showsAbsCoverage(absCoverage),
    describe: "the coverage table as before: the counters do not depend on the absences",
    excerpt: coverageExcerpt,
  }),
  plannerReadsAbsAssignments(
    absScheduleIdOf,
    "the absences schedule after the DELETEs of the absences",
    absAssignments,
    "the absences schedule, all seventeen: removing an absence removes no assignment",
  ),

  // The week with a holiday.
  visitAbsHolidayPage({
    bodyCheck: showsAssignHeading(absHoliday.period, absHolidayScheduleLabel),
    describe: `the title and heading "Obsadzanie grafiku", the period ${absHoliday.period} and the label of the absences schedule with a holiday`,
    excerpt: headingExcerpt,
  }),
  visitAbsHolidayPage({
    bodyCheck: absRowsOf(absHolidayRoster),
    describe: `a row for each of the three people, each of exactly ${GRID_ROW_CELLS} cells`,
    excerpt: gridExcerpt,
  }),
  visitAbsHolidayPage({
    bodyCheck: hidesAbsenceData(absHolidayRoster),
    describe: "no id of an absence of the run and no e-mail address of the three people anywhere in the page",
    excerpt: () => "(the page is not printed)",
  }),
  ...absStateSteps(visitAbsHolidayPage, absHolidayStates[0]),
  ...plannerRemovesAbsAbsence("holover"),
  ...absStateSteps(visitAbsHolidayPage, absHolidayStates[1]),
];

// Schedule approval (S-08) in the database. A schedule, a shift and an employee of its own (all under the "Smoke-" prefix
// the cleanup deletes by): one cell for two people on Monday 2 November 2026 with one person on it, and a vacation on the
// day after the seven (the edge of the window the approval reads). The steps call approve_schedule the way the app does,
// first with every kind of refusal (the cause is asserted: status, code and message), then successfully, and afterwards try
// every write to the approved schedule, edit the dictionary to prove the snapshot, and let the cleanup prove the cascade.
const APPROVAL_TABLES = ["schedule_approvals", "schedule_approval_shifts", "schedule_approval_employees"];
const approvalLabel = `Smoke-${runId}-approval`;
let approvalEmployeeId;
let approvalShiftId;
let approvalScheduleId;
let approvalTime;
const approvalChildren = () => `?schedule_id=eq.${approvalScheduleId}`;
const approvalEmployee = {
  first_name: "Smoke",
  last_name: approvalLabel,
  email: `smoke-${runId}-approval@example.com`,
  fte_numerator: 1,
  fte_denominator: 1,
};
const approvalShift = { name: approvalLabel, start_minute: 360, end_minute: 840 };
const approvalState = () => ({
  startDate: "2026-11-02",
  label: approvalLabel,
  staffing: [{ shiftId: approvalShiftId, dayOffset: 0, requiredCount: 2 }],
  employeeIds: [approvalEmployeeId],
});
const approvalAssignment = (dayOffset = 0) => ({
  schedule_id: approvalScheduleId,
  shift_id: approvalShiftId,
  day_offset: dayOffset,
  employee_id: approvalEmployeeId,
});
const approvalAbsence = () => ({
  employeeId: approvalEmployeeId,
  type: "vacation",
  status: "approved",
  startDate: "2026-11-09",
  endDate: "2026-11-09",
});
const approvalPerson = () => ({
  id: approvalEmployeeId,
  name: `${approvalLabel} Smoke`,
  fte: { numerator: 1, denominator: 1 },
});
const approvalShiftInput = () => ({ id: approvalShiftId, name: approvalLabel, startMinute: 360, endMinute: 840 });
const approvalInputs = () => ({
  startDate: "2026-11-02",
  staffing: approvalState().staffing,
  employeeIds: [approvalEmployeeId],
  assignments: [{ shiftId: approvalShiftId, dayOffset: 0, employeeId: approvalEmployeeId }],
  shifts: [approvalShiftInput()],
  employees: [approvalPerson()],
  absences: [approvalAbsence()],
});
const approvalWarning = () => ({
  key: `understaffed|-|0:${approvalShiftId}:-`,
  severity: "warning",
  rule: "understaffed",
  employeeId: null,
  anchors: [{ shiftId: approvalShiftId, dayOffset: 0, employeeId: null }],
  reason: "Smoke: brakuje 1 osoby",
  actual: 1,
  limit: 2,
  unit: "people",
});
// A key that no finding has any more stays among the confirmed ones, like after a shortage that was filled.
const approvalConfirmedKeys = () => [approvalWarning().key, "understaffed|-|gone"];
const approvalHours = () => [{ employeeId: approvalEmployeeId, workedMinutes: 480, normMinutes: 2400 }];
const approveArgs = (changes = {}) => ({
  p_schedule_id: approvalScheduleId,
  p_inputs: approvalInputs(),
  p_violations: [approvalWarning()],
  p_confirmed_keys: approvalConfirmedKeys(),
  p_workload: approvalHours(),
  ...changes,
});

const refusedWith = (status, code, message) => ({
  status,
  check: (error) => error?.code === code && error?.message === message,
  describe: `an error with the code ${code} and the message ${message}`,
});
const scheduleChanged = refusedWith(412, "PT412", "Schedule data has changed");
const findingsRefused = refusedWith(422, "PT422", "Findings do not allow an approval");
const alreadyApproved = refusedWith(423, "PT423", "Schedule is approved");
const approverRefused = refusedWith(403, "42501", "Only a planner can approve a schedule");

const plannerApprovesWith = (description, changes, expected) => [
  `${planner.label}: rpc approve_schedule ${description}`,
  async () => rpc("approve_schedule", await accessToken(planner), approveArgs(changes())),
  expected,
];
const changedInputs = (changes) => () => ({ p_inputs: { ...approvalInputs(), ...changes() } });

const isApprovalRecord = (rows) =>
  Array.isArray(rows) &&
  rows.length === 1 &&
  rows[0].schedule_id === approvalScheduleId &&
  rows[0].approved_by === planner.id &&
  rows[0].approved_by_email === planner.email &&
  Date.parse(rows[0].approved_at) === Date.parse(approvalTime) &&
  rows[0].violations.length === 1 &&
  rows[0].violations[0].key === approvalWarning().key &&
  rows[0].violations[0].reason === approvalWarning().reason &&
  sameItems(rows[0].confirmed_keys, approvalConfirmedKeys()) &&
  rows[0].critical_count === 0 &&
  rows[0].warning_count === 1;
const isSnapshotShifts = (rows) =>
  Array.isArray(rows) &&
  rows.length === 1 &&
  rows[0].shift_id === approvalShiftId &&
  hasColumns(rows[0], approvalShift);
const isSnapshotEmployees = (rows) =>
  Array.isArray(rows) &&
  rows.length === 1 &&
  hasColumns(rows[0], {
    employee_id: approvalEmployeeId,
    display_name: `${approvalLabel} Smoke`,
    fte_numerator: 1,
    fte_denominator: 1,
    worked_minutes: 480,
    norm_minutes: 2400,
  });
const plannerReadsApproval = (when) =>
  [
    ["schedule_approvals", isApprovalRecord, "one record with the findings, the keys, the counts and the approver"],
    ["schedule_approval_shifts", isSnapshotShifts, "the shift as it was approved"],
    ["schedule_approval_employees", isSnapshotEmployees, "the person as approved, with the hours"],
  ].map(([table, check, describe]) => [
    `${planner.label}: ${table} read ${when}`,
    async () => restTable(table, "GET", { token: await accessToken(planner), query: approvalChildren() }),
    { status: 200, check, describe },
  ]);

// The writes to an approved schedule. The policies hide its rows from an update or a delete (an empty list) and turn down
// an insert.
const plannerChangesNoApprovedRow = (table, method, query, body) => [
  `${planner.label}: ${table} ${method} on the approved schedule touches no row`,
  async () =>
    restTable(table, method, {
      token: await accessToken(planner),
      query: query(),
      body: body?.(),
      prefer: asksForChangedRows,
    }),
  rowsHidden,
];
const plannerInsertIsTurnedDown = (table, body) => [
  `${planner.label}: ${table} insert into the approved schedule is rejected`,
  async () => restTable(table, "POST", { token: await accessToken(planner), body: body() }),
  policyTurnsDown(table),
];

const plannerInsertsKeepingId = (what, table, body, keepId) => [
  `${planner.label}: ${table} insert of ${what}`,
  async () => {
    const result = await restTable(table, "POST", {
      token: await accessToken(planner),
      body: body(),
      prefer: "return=representation",
    });
    keepId(parseJson(result.body)?.[0]?.id);
    return result;
  },
  { status: 201 },
];

const approvalDatabaseSteps = [
  plannerInsertsKeepingId(
    "the employee of the approval steps",
    "employees",
    () => approvalEmployee,
    (id) => (approvalEmployeeId = id),
  ),
  plannerInsertsKeepingId(
    "the shift of the approval steps",
    "shifts",
    () => approvalShift,
    (id) => (approvalShiftId = id),
  ),
  [
    `${planner.label}: rpc save_schedule creates the schedule of the approval steps`,
    async () => {
      const result = await rpc("save_schedule", await accessToken(planner), saveScheduleArgs(approvalState()));
      approvalScheduleId = parseJson(result.body);
      return result;
    },
    { status: 200, check: isUuidText },
  ],
  [
    `${planner.label}: schedule_assignments insert of the assignment of the approval steps`,
    async () => assignmentsTable("POST", { token: await accessToken(planner), body: approvalAssignment() }),
    { status: 201 },
  ],
  [
    `${planner.label}: absences insert of the vacation of the approval steps`,
    async () =>
      absencesTable("POST", {
        token: await accessToken(planner),
        body: { employee_id: approvalEmployeeId, type: "vacation", start_date: "2026-11-09", end_date: "2026-11-09" },
      }),
    { status: 201 },
  ],

  // The status is written by no session.
  [
    `${planner.label}: schedules update of the status is rejected`,
    async () =>
      schedulesTable("PATCH", {
        token: await accessToken(planner),
        query: `?id=eq.${approvalScheduleId}`,
        body: { status: "approved" },
      }),
    tableDenied("schedules"),
  ],
  [
    `${planner.label}: schedules insert with a status is rejected`,
    async () =>
      schedulesTable("POST", {
        token: await accessToken(planner),
        body: { start_date: "2026-11-02", label: `${approvalLabel}-status`, status: "approved" },
      }),
    tableDenied("schedules"),
  ],
  [
    `${planner.label}: schedule_approvals insert is rejected`,
    async () =>
      restTable("schedule_approvals", "POST", {
        token: await accessToken(planner),
        body: {
          schedule_id: approvalScheduleId,
          approved_by: planner.id,
          approved_by_email: planner.email,
          violations: [],
          confirmed_keys: [],
          critical_count: 0,
          warning_count: 0,
        },
      }),
    tableDenied("schedule_approvals"),
  ],

  // Only a planner gets through the one door.
  ...[employee, noRole].map((actor) => [
    `${actor.label}: rpc approve_schedule is rejected`,
    async () => rpc("approve_schedule", await accessToken(actor), approveArgs()),
    approverRefused,
  ]),
  [
    `${anonymous.label}: rpc approve_schedule is rejected`,
    () => rpc("approve_schedule", undefined, approveArgs()),
    anonymousFunctionDenied("approve_schedule"),
  ],

  plannerApprovesWith(
    "of an unknown schedule is not found",
    () => ({ p_schedule_id: unknownScheduleId }),
    scheduleHidden,
  ),
  plannerApprovesWith(
    "with another start date",
    changedInputs(() => ({ startDate: "2026-11-03" })),
    scheduleChanged,
  ),
  plannerApprovesWith(
    "without the assignment",
    changedInputs(() => ({ assignments: [] })),
    scheduleChanged,
  ),
  plannerApprovesWith(
    "with another required count",
    changedInputs(() => ({ staffing: [{ ...approvalState().staffing[0], requiredCount: 1 }] })),
    scheduleChanged,
  ),
  plannerApprovesWith(
    "with nobody on the roster",
    changedInputs(() => ({ employeeIds: [] })),
    scheduleChanged,
  ),
  plannerApprovesWith(
    "with other hours of a shift",
    changedInputs(() => ({ shifts: [{ ...approvalShiftInput(), endMinute: 900 }] })),
    scheduleChanged,
  ),
  plannerApprovesWith(
    "with another FTE",
    changedInputs(() => ({ employees: [{ ...approvalPerson(), fte: { numerator: 1, denominator: 2 } }] })),
    scheduleChanged,
  ),
  plannerApprovesWith(
    "without the absence on the day after the seven",
    changedInputs(() => ({ absences: [] })),
    scheduleChanged,
  ),
  plannerApprovesWith(
    "without a list of its inputs",
    changedInputs(() => ({ absences: undefined })),
    refusedWith(422, "PT422", "Approval arguments are not valid"),
  ),
  plannerApprovesWith(
    "with a critical finding",
    () => ({ p_violations: [{ ...approvalWarning(), severity: "critical" }] }),
    findingsRefused,
  ),
  plannerApprovesWith("with an unconfirmed warning", () => ({ p_confirmed_keys: [] }), findingsRefused),
  plannerApprovesWith(
    "without the hours of the roster",
    () => ({ p_workload: [] }),
    refusedWith(422, "PT422", "Hours do not match the roster"),
  ),
  plannerReadsSummary(
    "still shows a draft after the refused approvals",
    () => approvalScheduleId,
    () => ({ startDate: "2026-11-02", label: approvalLabel, employeeCount: 1, totalRequired: 2 }),
    "the schedule of the approval steps",
  ),

  [
    `${planner.label}: rpc approve_schedule approves the schedule`,
    async () => {
      const result = await rpc("approve_schedule", await accessToken(planner), approveArgs());
      approvalTime = parseJson(result.body);
      return result;
    },
    {
      status: 200,
      check: (time) => typeof time === "string" && !Number.isNaN(Date.parse(time)),
      describe: "the time of the approval",
    },
  ],
  plannerApprovesWith("a second time is rejected", () => ({}), alreadyApproved),
  ...plannerReadsApproval("after the approval"),
  [
    `${planner.label}: schedule_summaries read shows the approved schedule`,
    async () =>
      scheduleSummariesTable("GET", { token: await accessToken(planner), query: `?id=eq.${approvalScheduleId}` }),
    {
      status: 200,
      check: (rows) =>
        rows.length === 1 &&
        sameItems(Object.keys(rows[0]), SUMMARY_COLUMNS) &&
        rows[0].status === "approved" &&
        Date.parse(rows[0].approved_at) === Date.parse(approvalTime),
      describe: "the status approved with the time of the approval",
    },
  ],

  // The record exists, and the findings in it can name the kind of an absence: nobody but the planner reads any of it.
  ...APPROVAL_TABLES.flatMap((table) => [
    ...[employee, noRole].map((actor) => [
      `${actor.label}: ${table} read returns an empty list`,
      async () => restTable(table, "GET", { token: await accessToken(actor), query: approvalChildren() }),
      { status: 200, check: isEmptyList, describe: "an empty list" },
    ]),
    [
      `${anonymous.label}: ${table} read is rejected`,
      () => restTable(table, "GET", { query: approvalChildren() }),
      anonymousTableDenied(table),
    ],
    [
      `${planner.label}: ${table} delete is rejected`,
      async () => restTable(table, "DELETE", { token: await accessToken(planner), query: approvalChildren() }),
      tableDenied(table),
    ],
    [
      `${planner.label}: ${table} update is rejected`,
      async () =>
        restTable(table, "PATCH", {
          token: await accessToken(planner),
          query: approvalChildren(),
          body: { schedule_id: approvalScheduleId },
        }),
      tableDenied(table),
    ],
  ]),
  ...["schedule_approval_shifts", "schedule_approval_employees"].map((table) => [
    `${planner.label}: ${table} insert is rejected`,
    async () =>
      restTable(table, "POST", { token: await accessToken(planner), body: { schedule_id: approvalScheduleId } }),
    tableDenied(table),
  ]),

  // Every write to the approved schedule.
  plannerChangesNoApprovedRow(
    "schedules",
    "PATCH",
    () => `?id=eq.${approvalScheduleId}`,
    () => ({ label: `${approvalLabel}-changed` }),
  ),
  plannerChangesNoApprovedRow("schedule_staffing", "PATCH", approvalChildren, () => ({ required_count: 5 })),
  plannerChangesNoApprovedRow("schedule_assignments", "DELETE", approvalChildren),
  plannerChangesNoApprovedRow("schedule_staffing", "DELETE", approvalChildren),
  plannerChangesNoApprovedRow("schedule_employees", "DELETE", approvalChildren),
  plannerInsertIsTurnedDown("schedule_staffing", () => ({
    schedule_id: approvalScheduleId,
    shift_id: approvalShiftId,
    day_offset: 3,
    required_count: 1,
  })),
  plannerInsertIsTurnedDown("schedule_employees", () => ({
    schedule_id: approvalScheduleId,
    employee_id: apiEmployeeId,
  })),
  plannerInsertIsTurnedDown("schedule_assignments", () => approvalAssignment(3)),
  [
    `${planner.label}: rpc save_schedule on the approved schedule is rejected`,
    async () =>
      rpc("save_schedule", await accessToken(planner), saveScheduleArgs(approvalState(), approvalScheduleId, true)),
    alreadyApproved,
  ],
  ...plannerReadsSchedule(
    "is unchanged after the writes to the approved schedule",
    approvalState,
    "the approved schedule, unchanged",
    () => approvalScheduleId,
  ),
  [
    `${planner.label}: schedule_assignments read still finds the assignment of the approved schedule`,
    async () => assignmentsTable("GET", { token: await accessToken(planner), query: approvalChildren() }),
    { status: 200, check: (rows) => rows.length === 1, describe: "one assignment" },
  ],

  // The dictionary and the roster stay editable, and the approved copy keeps what was approved.
  [
    `${planner.label}: shifts update of the shift of the approved schedule works`,
    async () =>
      shiftsTable("PATCH", {
        token: await accessToken(planner),
        query: `?id=eq.${approvalShiftId}`,
        body: { name: `${approvalLabel}-edited`, start_minute: 420 },
        prefer: asksForChangedRows,
      }),
    { status: 200, check: (rows) => rows.length === 1, describe: "the changed shift" },
  ],
  [
    `${planner.label}: employees update of the person of the approved schedule works`,
    async () =>
      employeesTable("PATCH", {
        token: await accessToken(planner),
        query: `?id=eq.${approvalEmployeeId}`,
        body: { last_name: `${approvalLabel}-edited`, fte_denominator: 2 },
        prefer: asksForChangedRows,
      }),
    { status: 200, check: (rows) => rows.length === 1, describe: "the changed employee" },
  ],
  ...plannerReadsApproval("after the edits of the dictionary and the roster"),
];

// The approval route (S-08), on a schedule of its own: the week of 2 November 2026 (no holiday, so the norm of a full-time
// employee is 40 h), a shift 06:00-14:00 needed by two people on Monday with one person on it, and a 10 h shift needed by
// one on Tuesday. With the person on the long shift the day has more than 8 h, a critical violation; without that
// assignment two shortages (warnings) are all that is left. The route counts the rules from the database, so the steps
// send no findings, only the keys they confirm. The person and the first shift are rows of this block too.
const approveRouteLabel = `Smoke-${runId}-approve-route`;
let approveRouteEmployeeId;
let approveRouteShiftId;
let approveRouteLongShiftId;
let approveRouteScheduleId;
let approveRouteTime;
const approveRouteUrl = (id = approveRouteScheduleId) => `/api/schedules/${id}/approve`;
const approveRouteChildren = () => `?schedule_id=eq.${approveRouteScheduleId}`;
const approveRouteState = () => ({
  startDate: "2026-11-02",
  label: approveRouteLabel,
  staffing: [
    { shiftId: approveRouteShiftId, dayOffset: 0, requiredCount: 2 },
    { shiftId: approveRouteLongShiftId, dayOffset: 1, requiredCount: 1 },
  ],
  employeeIds: [approveRouteEmployeeId],
});
const approveRouteAssignment = (long) => ({
  shiftId: long ? approveRouteLongShiftId : approveRouteShiftId,
  dayOffset: long ? 1 : 0,
  employeeId: approveRouteEmployeeId,
});
const shortageKeys = () => [
  `understaffed|-|0:${approveRouteShiftId}:-`,
  `understaffed|-|1:${approveRouteLongShiftId}:-`,
];
const longDayKey = () => `daily_hours|${approveRouteEmployeeId}|1:${approveRouteLongShiftId}:${approveRouteEmployeeId}`;

const refusesApproval = (error, keys) => (body) =>
  body.error === error &&
  sameItems(
    body.violations.map((violation) => violation.key),
    keys(),
  );
const answersError = (error) => (body) => body.error === error && Object.keys(body).length === 1;

const approveCall = (actor, what, options, expected) => [
  `${actor.label}: POST /api/schedules/<id>/approve ${what}`,
  () => request(actor, approveRouteUrl(options.id?.()), { method: "POST", ...options.send() }),
  { contentType: "application/json", ...expected },
];
// What the page shows: its fingerprint (read from the approval section) and its assignments. Before the first visit of the
// page there is no fingerprint, and the steps that run then are refused before it is compared.
let approveRouteBasis = "";
const approveBody = (confirmedKeys, long = false) => ({
  confirmedKeys,
  basis: approveRouteBasis,
  assignments: [approveRouteAssignment(false), ...(long ? [approveRouteAssignment(true)] : [])],
});
const plannerApproveRoute = (what, keys, expected, long) =>
  approveCall(planner, what, { send: () => ({ json: approveBody(keys(), long) }) }, expected);

const plannerWritesRoute = (what, method, url, json, expected) => [
  `${planner.label}: ${method} ${what}`,
  () => request(planner, url(), { method, json: json() }),
  { contentType: "application/json", ...expected },
];

const plannerInsertsShiftRow = (what, body, keepId) => plannerInsertsKeepingId(what, "shifts", () => body, keepId);

// What the pages show for the schedule of the approval route steps: first as a draft with a critical violation and then
// with warnings only (the approval section under the coverage table), and after the approval read only, from the copies
// and the findings stored with it, also after the shift and the person have been edited.
let approveRouteGridHeaders;
let approveRouteViolations;
const approveRoutePeriod = "02.11–08.11.2026";
const approvalDayOf = (time) =>
  new Intl.DateTimeFormat("pl-PL", {
    timeZone: "Europe/Warsaw",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(time));
const visitApproveRoute = (what, path, bodyCheck, describe) => [
  `${planner.label}: GET ${what}`,
  () => request(planner, path()),
  { status: 200, bodyCheck, describe },
];
const approveRouteAssignPage = () => `/schedules/${approveRouteScheduleId}/assign`;

const approvalSectionOf = (html) => {
  const at = html.indexOf(`aria-labelledby="approval-heading"`);
  return at === -1 || at < html.indexOf(`aria-labelledby="coverage-heading"`)
    ? undefined
    : html.slice(html.lastIndexOf("<section", at), html.indexOf("</section>", at));
};
const approveButtonOf = (html) =>
  elementsOf(approvalSectionOf(html), "button").find((button) => textOf(button) === "Zatwierdź grafik");
const isDisabledElement = (element, name) => hasAttribute(tagsOf(element, name)[0], "disabled");
const approvalBlockedText = "Nie można zatwierdzić: lista wskazań ma krytyczne naruszenia.";
// The confirmation is opened by a click, so the HTML the server renders never carries it.
const hasNoConfirmation = (html) => !html.includes("Zatwierdzenie jest ostateczne");

const basisOf = (html) => attributeOf(tagsOf(approvalSectionOf(html), "section")[0], "data-approval-basis") ?? "";
const isBasis = (value) => /^[0-9a-f]{64}$/.test(value);
const keepsApprovalBasis = (html) => {
  approveRouteBasis = basisOf(html);
  return isBasis(approveRouteBasis);
};

const showsBlockedApproval = (html) =>
  keepsApprovalBasis(html) &&
  textsOf(approvalSectionOf(html), "h2")[0] === "Zatwierdzanie" &&
  isDisabledElement(approveButtonOf(html), "button") &&
  textsOf(approvalSectionOf(html), "p").includes(approvalBlockedText) &&
  hasNoConfirmation(html);
const showsOpenApproval = (html) => {
  approveRouteGridHeaders = gridHeadersOf(html);
  return (
    keepsApprovalBasis(html) &&
    !isDisabledElement(approveButtonOf(html), "button") &&
    !html.includes(approvalBlockedText) &&
    hasNoConfirmation(html) &&
    hasD6Notice(html)
  );
};

// The two buttons of the one person: the Monday shift is on, the Tuesday one is off.
const approvedShiftButtons = (html) =>
  tagsOf(cutAtCoverage(html)[0], "button").filter((tag) => attributeOf(tag, "aria-pressed") !== undefined);
const approvedHoursOf = (html) => textOf(bodyRowsOf(cutAtCoverage(html)[0])[0].cells[8]);
const hasApprovedNotice = (html) =>
  html.includes("Zatwierdzony grafik tygodniowy.") &&
  html.includes("art. 129 § 3") &&
  !html.includes("To szkic grafiku tygodniowego");

const showsApprovedAssignPage = (html) =>
  textsOf(html, "p").includes(`Grafik zatwierdzony ${approvalDayOf(approveRouteTime)}, przez ${planner.email}`) &&
  hasApprovedNotice(html) &&
  JSON.stringify(gridHeadersOf(html)) === JSON.stringify(approveRouteGridHeaders) &&
  JSON.stringify(
    approvedShiftButtons(html).map((tag) => [attributeOf(tag, "aria-pressed"), hasAttribute(tag, "disabled")]),
  ) ===
    JSON.stringify([
      ["true", true],
      ["false", true],
    ]) &&
  violationCounterOf(html) === "Wskazania: 2 ostrzeżenia" &&
  JSON.stringify(violationItemsOf(html)) ===
    JSON.stringify(approveRouteViolations.map((violation) => `Ostrzeżenie ${violation.reason}`)) &&
  !violationSectionOf(html).includes(`role="alert"`) &&
  approvedHoursOf(html) === "8 h z 40 h mniej o 32 h" &&
  textsOf(html, "p").includes(
    "Normy są z chwili zatwierdzenia: uwzględniają zatwierdzone wtedy nieobecności, których ten widok nie pokazuje.",
  ) &&
  !html.includes(`aria-labelledby="approval-heading"`) &&
  !linksOf(html).some((link) => link.text === "Edytuj grafik") &&
  linksOf(html).some((link) => link.href === "/schedules" && link.text === "Lista grafików");

const listsApprovedSchedule = (html) => {
  const row = tableRowWith(html, approveRouteLabel);
  const cells = cellsOf(row);
  return (
    cells.length === 7 &&
    cells[5] === `Zatwierdzony ${approvalDayOf(approveRouteTime)}` &&
    cells[6] === "Podgląd" &&
    row.includes(`href="/schedules/${approveRouteScheduleId}/assign"`) &&
    row.includes(`aria-label="Podgląd: ${approveRoutePeriod}, ${approveRouteLabel}"`) &&
    !row.includes(`href="/schedules/${approveRouteScheduleId}"`)
  );
};

const showsLockedEditPage = (html) =>
  textsOf(html, "p").includes("Ten grafik jest zatwierdzony i nie można go edytować.") &&
  linksOf(html).some((link) => link.href === approveRouteAssignPage() && link.text === "Zobacz zatwierdzony grafik") &&
  hasApprovedNotice(html) &&
  inputsOf(html).length === 0;

// After the edits the page still names the shift, its hours and the person as they were approved.
const keepsTheApprovedCopy = (html) =>
  showsApprovedAssignPage(html) &&
  html.includes(`${approveRouteLabel} 06:00–14:00`) &&
  html.includes(`${approveRouteLabel} Smoke`) &&
  !html.includes(`${approveRouteLabel}-renamed`);

const approvalRouteSteps = [
  plannerInsertsKeepingId(
    "the employee of the approval route steps",
    "employees",
    () => ({
      first_name: "Smoke",
      last_name: approveRouteLabel,
      email: `smoke-${runId}-approve-route@example.com`,
      fte_numerator: 1,
      fte_denominator: 1,
    }),
    (id) => (approveRouteEmployeeId = id),
  ),
  plannerInsertsShiftRow(
    "the 8 h shift of the approval route steps",
    { name: approveRouteLabel, start_minute: 360, end_minute: 840 },
    (id) => (approveRouteShiftId = id),
  ),
  plannerInsertsShiftRow(
    "the 10 h shift of the approval route steps",
    { name: `${approveRouteLabel}-long`, start_minute: 360, end_minute: 960 },
    (id) => (approveRouteLongShiftId = id),
  ),
  signIn(planner),
  [
    `${planner.label}: POST /api/schedules creates the schedule of the approval route steps`,
    async () => {
      const result = await request(planner, "/api/schedules", { method: "POST", json: approveRouteState() });
      approveRouteScheduleId = parseJson(result.body)?.id;
      return result;
    },
    { status: 201 },
  ],
  ...[false, true].map((long) =>
    plannerWritesRoute(
      `/api/schedules/<id>/assignments adds the ${long ? "10 h" : "8 h"} shift`,
      "POST",
      () => `/api/schedules/${approveRouteScheduleId}/assignments`,
      () => approveRouteAssignment(long),
      { status: 200 },
    ),
  ),

  // The role gate.
  approveCall(
    anonymous,
    "is refused",
    { send: () => ({ json: approveBody([]) }) },
    { status: 401, check: isError("unauthenticated") },
  ),
  signIn(employee),
  approveCall(
    employee,
    "is refused",
    { send: () => ({ json: approveBody([]) }) },
    { status: 403, check: isError("forbidden") },
  ),
  signOut(employee),
  signIn(noRole),
  approveCall(
    noRole,
    "is refused",
    { send: () => ({ json: approveBody([]) }) },
    { status: 403, check: isError("forbidden") },
  ),
  signOut(noRole),

  // The shape of the request.
  approveCall(
    planner,
    "with a form body is refused",
    { send: () => ({ form: { confirmedKeys: "x" } }) },
    { status: 415, check: answersError("unsupported_media_type") },
  ),
  approveCall(
    planner,
    "with broken JSON is refused",
    { send: () => ({ jsonText: "{" }) },
    { status: 400, check: answersError("invalid_json") },
  ),
  approveCall(
    planner,
    "without a list of keys is refused",
    { send: () => ({ json: approveBody("all") }) },
    { status: 422, check: answersError("invalid_body") },
  ),
  approveCall(
    planner,
    "without what the page shows is refused",
    { send: () => ({ json: { confirmedKeys: [] } }) },
    { status: 422, check: answersError("invalid_body") },
  ),
  ...["not-a-uuid", unknownScheduleId].map((id) =>
    approveCall(
      planner,
      `of the schedule ${id} is not found`,
      { id: () => id, send: () => ({ json: approveBody([]) }) },
      { status: 404, check: answersError("not_found") },
    ),
  ),

  visitApproveRoute(
    "the assignment page of a draft with a critical violation blocks the approval",
    approveRouteAssignPage,
    showsBlockedApproval,
    "the section after the coverage table with a disabled button and the reason",
  ),

  // A critical violation refuses, whatever is confirmed.
  plannerApproveRoute(
    "with a critical violation is refused",
    () => [longDayKey(), ...shortageKeys()],
    {
      status: 409,
      check: refusesApproval("critical_violations", () => [longDayKey()]),
      describe: "critical_violations with exactly the long day",
    },
    true,
  ),
  plannerWritesRoute(
    "/api/schedules/<id>/assignments takes the 10 h shift off",
    "DELETE",
    () => `/api/schedules/${approveRouteScheduleId}/assignments`,
    () => approveRouteAssignment(true),
    { status: 200 },
  ),

  visitApproveRoute(
    "the assignment page of a draft with warnings only offers the approval",
    approveRouteAssignPage,
    showsOpenApproval,
    "an enabled button, no confirmation yet and the draft notice",
  ),

  // What the page shows must still be what the database holds.
  ...[
    ["with a stale fingerprint", () => ({ basis: "0".repeat(64) })],
    ["with assignments the database does not hold", () => ({ assignments: [] })],
    ["with an assignment taken off since the page was loaded", () => approveBody(shortageKeys(), true)],
  ].map(([what, change]) =>
    approveCall(
      planner,
      `${what} is refused`,
      { send: () => ({ json: { ...approveBody(shortageKeys()), ...change() } }) },
      { status: 409, check: answersError("schedule_changed") },
    ),
  ),

  // Warnings need every one of their keys.
  plannerApproveRoute("without a confirmation asks for it", () => [], {
    status: 409,
    check: refusesApproval("confirmation_required", shortageKeys),
    describe: "confirmation_required with exactly the two shortages",
  }),
  plannerApproveRoute("with one of two warnings confirmed asks again", () => shortageKeys().slice(0, 1), {
    status: 409,
    check: refusesApproval("confirmation_required", shortageKeys),
    describe: "confirmation_required with exactly the two shortages",
  }),
  [
    `${planner.label}: schedules read shows a draft after the refused approvals`,
    async () =>
      schedulesTable("GET", {
        token: await accessToken(planner),
        query: `?id=eq.${approveRouteScheduleId}&select=status`,
      }),
    { status: 200, check: (rows) => rows.length === 1 && rows[0].status === "draft" },
  ],
  [
    `${planner.label}: POST /api/schedules/<id>/approve with every warning confirmed approves`,
    async () => {
      const result = await request(planner, approveRouteUrl(), {
        method: "POST",
        json: approveBody(shortageKeys()),
      });
      approveRouteTime = parseJson(result.body)?.approvedAt;
      return result;
    },
    {
      status: 200,
      contentType: "application/json",
      check: (body) => !Number.isNaN(Date.parse(body.approvedAt)) && Object.keys(body).length === 1,
      describe: "the time of the approval",
    },
  ],
  [
    `${planner.label}: schedule_approvals read shows the record the route stored`,
    async () =>
      restTable("schedule_approvals", "GET", { token: await accessToken(planner), query: approveRouteChildren() }),
    {
      status: 200,
      check: ([record]) =>
        (approveRouteViolations = record.violations) !== undefined &&
        record.approved_by === planner.id &&
        Date.parse(record.approved_at) === Date.parse(approveRouteTime) &&
        record.critical_count === 0 &&
        record.warning_count === 2 &&
        sameItems(record.confirmed_keys, shortageKeys()) &&
        sameItems(
          record.violations.map((violation) => violation.key),
          shortageKeys(),
        ) &&
        record.violations.every((violation) => violation.severity === "warning" && violation.reason.length > 0),
      describe: "the two shortages, their keys, the counts and the planner",
    },
  ],
  [
    `${planner.label}: schedule_approval_employees read shows the hours the route counted`,
    async () =>
      restTable("schedule_approval_employees", "GET", {
        token: await accessToken(planner),
        query: approveRouteChildren(),
      }),
    {
      status: 200,
      check: (rows) =>
        rows.length === 1 &&
        hasColumns(rows[0], { display_name: `${approveRouteLabel} Smoke`, worked_minutes: 480, norm_minutes: 2400 }),
      describe: "8 h worked of a norm of 40 h",
    },
  ],

  // Approved: every route that writes the schedule answers 409.
  plannerApproveRoute("a second time is refused", shortageKeys, {
    status: 409,
    check: answersError("schedule_approved"),
  }),
  plannerWritesRoute(
    "/api/schedules/<id> of the approved schedule is refused",
    "PUT",
    () => `/api/schedules/${approveRouteScheduleId}`,
    () => ({ ...approveRouteState(), label: `${approveRouteLabel}-changed`, confirmRemoval: true }),
    { status: 409, check: answersError("schedule_approved") },
  ),
  ...[
    ["POST", "adding to", true],
    ["POST", "adding what is already in", false],
    ["DELETE", "removing from", false],
    ["DELETE", "removing what is not in", true],
  ].map(([method, what, long]) =>
    plannerWritesRoute(
      `/api/schedules/<id>/assignments ${what} the approved schedule is refused`,
      method,
      () => `/api/schedules/${approveRouteScheduleId}/assignments`,
      () => approveRouteAssignment(long),
      { status: 409, check: answersError("schedule_approved") },
    ),
  ),
  ...plannerReadsSchedule(
    "is unchanged after the refused route calls",
    approveRouteState,
    "the approved route schedule, unchanged",
    () => approveRouteScheduleId,
  ),
  [
    `${planner.label}: schedule_assignments read still finds exactly the approved assignment`,
    async () => assignmentsTable("GET", { token: await accessToken(planner), query: approveRouteChildren() }),
    {
      status: 200,
      check: (rows) => rows.length === 1 && rows[0].shift_id === approveRouteShiftId && rows[0].day_offset === 0,
      describe: "the one assignment of Monday",
    },
  ],

  // The pages of the approved schedule.
  visitApproveRoute(
    "/schedules lists the approved schedule with its status and one link",
    () => "/schedules",
    listsApprovedSchedule,
    "the status with the day of the approval and only the link Podgląd",
  ),
  visitApproveRoute(
    "the assignment page of the approved schedule is read only",
    approveRouteAssignPage,
    showsApprovedAssignPage,
    "the banner, disabled buttons, the stored findings and hours, no approval section",
  ),
  visitApproveRoute(
    "/schedules/<id> of the approved schedule has no form",
    () => `/schedules/${approveRouteScheduleId}`,
    showsLockedEditPage,
    "the message and the link to the approved schedule",
  ),
  plannerWritesRoute(
    "/api/shifts/<id> renames and moves a shift of the approved schedule",
    "PUT",
    () => `/api/shifts/${approveRouteShiftId}`,
    () => ({ name: `${approveRouteLabel}-renamed`, startTime: "07:00", endTime: "14:00" }),
    { status: 200 },
  ),
  plannerWritesRoute(
    "/api/employees/<id> renames the person of the approved schedule",
    "PUT",
    () => `/api/employees/${approveRouteEmployeeId}`,
    () => ({
      firstName: "Smoke",
      lastName: `${approveRouteLabel}-renamed`,
      email: `smoke-${runId}-approve-route@example.com`,
      fteNumerator: 1,
      fteDenominator: 2,
    }),
    { status: 200 },
  ),
  visitApproveRoute(
    "the assignment page of the approved schedule keeps the approved copy after the edits",
    approveRouteAssignPage,
    keepsTheApprovedCopy,
    "the old shift name and hours, the old name of the person and the old norm",
  ),
  visitApproveRoute(
    "/shifts/<id> says that approved schedules keep their copy",
    () => `/shifts/${approveRouteShiftId}`,
    (html) =>
      textsOf(html, "p").includes(
        "Zatwierdzone grafiki zachowują własną kopię danych zmiany, więc ta edycja ich nie zmieni.",
      ),
    "the note about the copy",
  ),
  signOut(planner),
];

// The routes that store and remove a generated proposal (POST and DELETE /api/schedules/<id>/generated, S-09), on a
// schedule of their own: the week of 2 November 2026 and one shift 06:00-14:00, needed by two people on Monday and by one
// on Tuesday and on Wednesday, with two people in the roster. The generator runs in the browser and not here, so the steps
// send the proposal themselves, with the fingerprint read from the assignment page. One assignment is made by hand first:
// the proposal names it too, and it must stay manual. At the end the schedule is approved with the generated entries on it.
const generateLabel = `Smoke-${runId}-generate`;
let generateFirstId;
let generateSecondId;
let generateShiftId;
let generateScheduleId;
// What the page shows; before its visit there is no fingerprint, and the calls made then are refused before it is compared.
let generateBasis = "";
const generatedUrl = (id = generateScheduleId) => `/api/schedules/${id}/generated`;
const generateAssignmentsUrl = () => `/api/schedules/${generateScheduleId}/assignments`;
const generateState = () => ({
  startDate: "2026-11-02",
  label: generateLabel,
  staffing: [
    { shiftId: generateShiftId, dayOffset: 0, requiredCount: 2 },
    { shiftId: generateShiftId, dayOffset: 1, requiredCount: 1 },
    { shiftId: generateShiftId, dayOffset: 2, requiredCount: 1 },
  ],
  employeeIds: [generateFirstId, generateSecondId],
});
// An assignment is named [day, who].
const generateAssignment = ([day, who]) => ({
  shiftId: generateShiftId,
  dayOffset: day,
  employeeId: who === "first" ? generateFirstId : generateSecondId,
});
const generateManual = [0, "first"];
const generateProposed = [
  [0, "second"],
  [1, "first"],
];
const generateBody = (assignments, additions) => ({
  basis: generateBasis,
  assignments: assignments.map(generateAssignment),
  additions: additions.map(generateAssignment),
});
// The proposal as a page that shows the hand-made assignment alone sends it, that assignment among the additions.
const firstProposal = () => generateBody([generateManual], [generateManual, ...generateProposed]);
// One more person on Wednesday, from a page that is up to date once the proposal is stored: nothing but the gate or the
// approval stands in its way.
const nextProposal = () => generateBody([generateManual, ...generateProposed], [[2, "second"]]);

const manualAlone = [[...generateManual, "manual"]];
const manualAndProposed = [...manualAlone, ...generateProposed.map((entry) => [...entry, "generated"])];
const isGenerateAssignments = (expected) => (rows) =>
  Array.isArray(rows) &&
  sameItems(
    rows.map((row) => `${assignmentKey(row.shift_id, row.day_offset, row.employee_id)}/${row.source}`),
    expected.map(([day, who, source]) => {
      const { shiftId, dayOffset, employeeId } = generateAssignment([day, who]);
      return `${assignmentKey(shiftId, dayOffset, employeeId)}/${source}`;
    }),
  );
const plannerReadsGenerateAssignments = (when, expected) => [
  `${planner.label}: schedule_assignments of the generation schedule read ${when}`,
  async () =>
    assignmentsTable("GET", { token: await accessToken(planner), query: `?schedule_id=eq.${generateScheduleId}` }),
  {
    status: 200,
    check: isGenerateAssignments(expected),
    describe: `exactly ${JSON.stringify(expected)} as day, person and source`,
  },
];

// `options.id` replaces the id of the schedule, `options.send` gives the `json`, `form` or `jsonText` of the request.
const generatedCall = (actor, method, what, options, expected) => [
  `${actor.label}: ${method} /api/schedules/<id>/generated ${what}`,
  () => request(actor, generatedUrl(options.id?.()), { method, ...options.send?.() }),
  { contentType: "application/json", cacheControl: "no-store", ...expected },
];
const plannerGenerates = (what, send, expected) => generatedCall(planner, "POST", what, { send }, expected);
const plannerRemovesGenerated = (what, expected) => generatedCall(planner, "DELETE", what, {}, expected);
const answersCount = (name, count) => ({
  status: 200,
  check: (body) => body[name] === count && Object.keys(body).length === 1,
  describe: `${name}: ${count} and nothing else`,
});
const answersRefusal = (status, error) => ({ status, check: answersError(error), describe: `the error ${error}` });
const deniedGeneratedCalls = (actor, status, error) => [
  generatedCall(actor, "POST", "is refused", { send: () => ({ json: nextProposal() }) }, answersRefusal(status, error)),
  generatedCall(actor, "DELETE", "is refused", {}, answersRefusal(status, error)),
];

// What the assignment page shows of the generator. A draft has the section "Generowanie" above the people's table, with no
// table of its own, the two buttons ("Usuń wygenerowane" disabled while the grid has no generated entry) and the one
// hidden description; a generated shift button points to that description and has an icon besides the tick, and its
// aria-label and text are those of any other button. An approved schedule has none of it. The pressed buttons are read
// with the helpers of the other page steps, which must go on working with the section in the page.
const generatedEntryId = "generated-entry-description";
const generatedNote =
  "Ikona gwiazdek przy zmianie oznacza wpis wygenerowany. „Usuń wygenerowane” usuwa tylko takie wpisy, a ręczne zostawia.";
const generateDays = ["pon. 02.11", "wt. 03.11", "śr. 04.11"];
const generateButtonLabel = ([day, who]) =>
  buttonLabel(`${generateLabel}-${who} Smoke`, generateDays[day], `${generateLabel} ${shiftHours("06:00", "14:00")}`);
const generateButtonLabels = (entries) => entries.map(generateButtonLabel).sort();
const generationSectionOf = (html) => {
  const at = html.indexOf('aria-labelledby="generation-heading"');
  return at === -1 ? undefined : html.slice(html.lastIndexOf("<section", at), html.indexOf("</section>", at));
};
// The pressed shift buttons of the people's table, each with whether it points to the description and its icon count.
const pressedMarksOf = (html) =>
  elementsOf(cutAtCoverage(html)[0], "button")
    .map((button) => ({ button, tag: tagsOf(button, "button")[0] }))
    .filter(({ tag }) => attributeOf(tag, "aria-pressed") === "true")
    .map(({ button, tag }) => ({
      label: attributeOf(tag, "aria-label"),
      describedBy: attributeOf(tag, "aria-describedby") ?? null,
      icons: tagsOf(button, "svg").length,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
const hasGenerationMarks = (html, pressed, generated) => {
  const marked = new Set(generateButtonLabels(generated));
  return (
    JSON.stringify(pressedLabelsOf(html)) === JSON.stringify(generateButtonLabels(pressed)) &&
    pressedMarksOf(html).every(
      ({ label, describedBy, icons }) =>
        describedBy === (marked.has(label) ? generatedEntryId : null) && icons === (marked.has(label) ? 2 : 1),
    )
  );
};
const showsDraftGeneration = (pressed, generated) => (html) => {
  const section = generationSectionOf(html);
  if (section === undefined) {
    return false;
  }
  const buttons = elementsOf(section, "button");
  return (
    JSON.stringify(textsOf(section, "h2")) === JSON.stringify(["Generowanie"]) &&
    html.indexOf('aria-labelledby="generation-heading"') < html.indexOf("<table") &&
    tagsOf(section, "table").length === 0 &&
    JSON.stringify(buttons.map((button) => [textOf(button), isDisabledElement(button, "button")])) ===
      JSON.stringify([
        ["Wygeneruj", false],
        ["Usuń wygenerowane", generated.length === 0],
      ]) &&
    tagsOf(section, "span").some((tag) => attributeOf(tag, "id") === generatedEntryId) &&
    textsOf(section, "span").includes("wpis wygenerowany") &&
    textsOf(cutAtCoverage(html)[0], "p").includes(generatedNote) &&
    hasGenerationMarks(html, pressed, generated)
  );
};
const showsNoGeneration = (pressed) => (html) =>
  generationSectionOf(html) === undefined &&
  !html.includes(generatedEntryId) &&
  !textsOf(html, "button").some((text) => text === "Wygeneruj" || text === "Usuń wygenerowane") &&
  !textsOf(html, "p").includes(generatedNote) &&
  hasGenerationMarks(html, pressed, []);
const visitGenerationPage = (what, bodyCheck, describe) => [
  `${planner.label}: GET the assignment page of the generation schedule ${what}`,
  () => request(planner, `/schedules/${generateScheduleId}/assign`),
  {
    status: 200,
    cacheControl: "no-store",
    bodyCheck,
    describe,
    excerpt: (html) =>
      JSON.stringify({ section: generationSectionOf(html) ?? null, pressed: pressedMarksOf(html) }, null, 1),
  },
];

const generationRouteSteps = [
  ...["first", "second"].map((who) =>
    plannerInsertsKeepingId(
      `the ${who} employee of the generation steps`,
      "employees",
      () => ({
        first_name: "Smoke",
        last_name: `${generateLabel}-${who}`,
        email: `smoke-${runId}-generate-${who}@example.com`,
        fte_numerator: 1,
        fte_denominator: 1,
      }),
      (id) => (who === "first" ? (generateFirstId = id) : (generateSecondId = id)),
    ),
  ),
  plannerInsertsShiftRow(
    "the shift of the generation steps",
    { name: generateLabel, start_minute: 360, end_minute: 840 },
    (id) => (generateShiftId = id),
  ),
  signIn(planner),
  [
    `${planner.label}: POST /api/schedules creates the schedule of the generation steps`,
    async () => {
      const result = await request(planner, "/api/schedules", { method: "POST", json: generateState() });
      generateScheduleId = parseJson(result.body)?.id;
      return result;
    },
    { status: 201 },
  ],
  plannerWritesRoute(
    "/api/schedules/<id>/assignments adds the assignment made by hand",
    "POST",
    generateAssignmentsUrl,
    () => generateAssignment(generateManual),
    { status: 200 },
  ),
  [
    `${planner.label}: GET the assignment page of the generation schedule`,
    () => request(planner, `/schedules/${generateScheduleId}/assign`),
    {
      status: 200,
      bodyCheck: (html) => isBasis((generateBasis = basisOf(html))),
      describe: "the fingerprint of the data it shows",
    },
  ],
  visitGenerationPage(
    "with an assignment made by hand",
    showsDraftGeneration([generateManual], []),
    'the section "Generowanie" with "Usuń wygenerowane" disabled and no entry marked as generated',
  ),

  // The shape of the request.
  plannerGenerates("with a form body", () => ({ form: { basis: "x" } }), answersRefusal(415, "unsupported_media_type")),
  plannerGenerates("with broken JSON", () => ({ jsonText: "{" }), answersRefusal(400, "invalid_json")),
  ...["not-a-uuid", unknownScheduleId].map((id) =>
    generatedCall(
      planner,
      "POST",
      `of the schedule ${id}`,
      { id: () => id, send: () => ({ json: firstProposal() }) },
      answersRefusal(404, "not_found"),
    ),
  ),
  generatedCall(
    planner,
    "DELETE",
    "of an id that is not a UUID",
    { id: () => "not-a-uuid" },
    answersRefusal(404, "not_found"),
  ),
  ...[
    ["without a fingerprint", () => ({ ...firstProposal(), basis: undefined })],
    ["with nothing to add", () => generateBody([generateManual], [])],
    [
      "with more additions than the staffing asks for",
      () => generateBody([generateManual], [generateManual, ...generateProposed, [1, "second"], [2, "first"]]),
    ],
  ].map(([what, json]) => plannerGenerates(what, () => ({ json: json() }), answersRefusal(422, "invalid_body"))),

  // What the page shows must still be what the database holds.
  ...[
    ["with a stale fingerprint", () => ({ ...firstProposal(), basis: "0".repeat(64) })],
    ["from a page without the assignment made by hand", () => ({ ...firstProposal(), assignments: [] })],
    [
      "from a page with an assignment the database does not hold",
      () => generateBody([generateManual, [2, "second"]], generateProposed),
    ],
  ].map(([what, json]) => plannerGenerates(what, () => ({ json: json() }), answersRefusal(409, "schedule_changed"))),

  // One statement: a cell without staffing takes the rest of its list down with it.
  plannerGenerates(
    "with a cell without staffing among the additions",
    () => ({
      json: generateBody(
        [generateManual],
        [
          [0, "second"],
          [5, "first"],
        ],
      ),
    }),
    answersRefusal(422, "unknown_reference"),
  ),
  plannerReadsGenerateAssignments("after the refused calls", manualAlone),

  plannerGenerates("stores the proposal", () => ({ json: firstProposal() }), answersCount("added", 2)),
  plannerReadsGenerateAssignments("after the proposal", manualAndProposed),
  visitGenerationPage(
    "with the stored proposal",
    showsDraftGeneration([generateManual, ...generateProposed], generateProposed),
    '"Usuń wygenerowane" enabled and exactly the two generated entries described and marked with an icon',
  ),
  plannerGenerates(
    "sent again from the same page",
    () => ({ json: firstProposal() }),
    answersRefusal(409, "schedule_changed"),
  ),

  // The role gate, with entries that a call let through would change.
  ...deniedGeneratedCalls(anonymous, 401, "unauthenticated"),
  signIn(employee),
  ...deniedGeneratedCalls(employee, 403, "forbidden"),
  signOut(employee),
  signIn(noRole),
  ...deniedGeneratedCalls(noRole, 403, "forbidden"),
  signOut(noRole),
  plannerReadsGenerateAssignments("after the calls of the others", manualAndProposed),

  plannerRemovesGenerated("takes the generated entries off", answersCount("removed", 2)),
  plannerReadsGenerateAssignments("after the removal", manualAlone),
  plannerRemovesGenerated("with nothing left to remove", answersCount("removed", 0)),
  plannerReadsGenerateAssignments("after the repeated removal", manualAlone),

  // Approved, with generated entries on it: both methods answer 409 and nothing changes. The one warning left is the
  // shortage of Wednesday.
  plannerGenerates("stores the proposal again", () => ({ json: firstProposal() }), answersCount("added", 2)),
  [
    `${planner.label}: POST /api/schedules/<id>/approve approves the generation schedule`,
    () =>
      request(planner, `/api/schedules/${generateScheduleId}/approve`, {
        method: "POST",
        json: {
          confirmedKeys: [`understaffed|-|2:${generateShiftId}:-`],
          basis: generateBasis,
          assignments: [generateManual, ...generateProposed].map(generateAssignment),
        },
      }),
    { status: 200, contentType: "application/json" },
  ],
  plannerGenerates(
    "of the approved schedule",
    () => ({ json: nextProposal() }),
    answersRefusal(409, "schedule_approved"),
  ),
  plannerRemovesGenerated("of the approved schedule", answersRefusal(409, "schedule_approved")),
  plannerReadsGenerateAssignments("of the approved schedule", manualAndProposed),
  visitGenerationPage(
    "once it is approved",
    showsNoGeneration([generateManual, ...generateProposed]),
    "no generation section, no mark and no note, with the three assignments still on",
  ),
  signOut(planner),
];

const steps = [
  // Anonymous: the gate answers 401 (never a redirect), JSON for API paths.
  visit(anonymous, "/", 200),
  visit(anonymous, "/dashboard", 401),
  visit(anonymous, "/planner", 401),
  visit(anonymous, "/employees", 401),
  visit(anonymous, "/employees/new", 401),
  visit(anonymous, "/shifts", 401),
  visit(anonymous, "/shifts/new", 401),
  visit(anonymous, "/schedules", 401),
  visit(anonymous, "/schedules/new", 401),
  // The gate answers before the page runs, so the id may be one that no schedule has: a planner would get a 404 there.
  visit(anonymous, `/schedules/${unknownScheduleId}/assign`, 401),
  ...deniedAbsencePages(anonymous, 401, "Zaloguj się, aby uzyskać dostęp do tej strony."),
  [
    `${anonymous.label}: GET /api/employees`,
    () => request(anonymous, "/api/employees", { accept: "application/json" }),
    { status: 401, contentType: "application/json" },
  ],
  [
    `${anonymous.label}: POST /api/employees`,
    () => request(anonymous, "/api/employees", { method: "POST", json: apiEmployee }),
    { status: 401, contentType: "application/json" },
  ],
  [
    `${anonymous.label}: POST /api/shifts`,
    () => request(anonymous, "/api/shifts", { method: "POST", json: apiShift }),
    { status: 401, contentType: "application/json" },
  ],
  [
    `${anonymous.label}: POST /api/schedules`,
    () => request(anonymous, "/api/schedules", { method: "POST", json: deniedApiSchedule }),
    { status: 401, contentType: "application/json" },
  ],
  ...deniedAssignmentCalls(anonymous, 401, "unauthenticated"),
  ...deniedAbsenceCalls(anonymous, 401, "unauthenticated"),
  [
    `${anonymous.label}: PUT /api/schedules/<id>`,
    () => request(anonymous, unknownScheduleUrl, { method: "PUT", json: deniedApiSchedule }),
    { status: 401, contentType: "application/json" },
  ],
  [
    `${anonymous.label}: POST /api/employees/<id>/invite`,
    () => request(anonymous, unknownInviteUrl, { method: "POST" }),
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
  visit(noRole, "/schedules", 403),
  visit(noRole, "/schedules/new", 403),
  visit(noRole, `/schedules/${unknownScheduleId}/assign`, 403),
  ...deniedAbsencePages(noRole, 403, "Rola: brak roli"),
  [
    `${noRole.label}: POST /api/schedules`,
    () => request(noRole, "/api/schedules", { method: "POST", json: deniedApiSchedule }),
    { status: 403, contentType: "application/json" },
  ],
  ...deniedAssignmentCalls(noRole, 403, "forbidden"),
  ...deniedAbsenceCalls(noRole, 403, "forbidden"),
  [
    `${noRole.label}: PUT /api/schedules/<id>`,
    () => request(noRole, unknownScheduleUrl, { method: "PUT", json: deniedApiSchedule }),
    { status: 403, contentType: "application/json" },
  ],
  [
    `${noRole.label}: POST /api/employees/<id>/invite`,
    () => request(noRole, unknownInviteUrl, { method: "POST" }),
    { status: 403, contentType: "application/json" },
  ],
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
  visit(employee, "/employees/new", 403),
  visit(employee, `/employees/${unknownEmployeeId}`, 403),
  visit(employee, "/shifts", 403),
  visit(employee, "/shifts/new", 403),
  visit(employee, `/shifts/${unknownShiftId}`, 403),
  visit(employee, "/schedules", 403),
  visit(employee, "/schedules/new", 403),
  visit(employee, `/schedules/${unknownScheduleId}`, 403),
  visit(employee, `/schedules/${unknownScheduleId}/assign`, 403),
  ...deniedAbsencePages(employee, 403, "Rola: pracownik"),
  [
    `${employee.label}: POST /api/employees`,
    () => request(employee, "/api/employees", { method: "POST", json: apiEmployee }),
    { status: 403, contentType: "application/json" },
  ],
  [
    `${employee.label}: PUT /api/employees/<id>`,
    () => request(employee, unknownEmployeeUrl, { method: "PUT", json: apiEmployee }),
    { status: 403, contentType: "application/json" },
  ],
  [
    `${employee.label}: POST /api/employees/<id>/invite`,
    () => request(employee, unknownInviteUrl, { method: "POST" }),
    { status: 403, contentType: "application/json" },
  ],
  [
    `${employee.label}: POST /api/shifts`,
    () => request(employee, "/api/shifts", { method: "POST", json: apiShift }),
    { status: 403, contentType: "application/json" },
  ],
  [
    `${employee.label}: PUT /api/shifts/<id>`,
    () => request(employee, unknownShiftUrl, { method: "PUT", json: apiShift }),
    { status: 403, contentType: "application/json" },
  ],
  [
    `${employee.label}: POST /api/schedules`,
    () => request(employee, "/api/schedules", { method: "POST", json: deniedApiSchedule }),
    { status: 403, contentType: "application/json" },
  ],
  ...deniedAssignmentCalls(employee, 403, "forbidden"),
  ...deniedAbsenceCalls(employee, 403, "forbidden"),
  [
    `${employee.label}: PUT /api/schedules/<id>`,
    () => request(employee, unknownScheduleUrl, { method: "PUT", json: deniedApiSchedule }),
    { status: 403, contentType: "application/json" },
  ],
  signOut(employee),
  visit(employee, "/dashboard", 401),

  // Planner: everything the gate lets through. The API and page steps use the session cookie, so they run while the
  // planner is signed in; the list comes after the create step, because it has to show the new employee.
  signIn(planner),
  visit(planner, "/dashboard", 200),
  visit(planner, "/planner", 200, "Pracownicy"),
  visit(planner, "/planner", 200, "Zmiany"),
  visit(planner, "/planner", 200, "Grafiki"),
  visit(planner, "/planner", 200, 'href="/schedules"'),
  visit(planner, "/planner/", 200),
  [
    `${planner.label}: POST /api/employees creates an employee`,
    async () => {
      const result = await request(planner, "/api/employees", { method: "POST", json: apiEmployee });
      apiEmployeeId = parseJson(result.body)?.employee?.id;
      return result;
    },
    {
      status: 201,
      contentType: "application/json",
      check: isApiEmployee({ numerator: 1, denominator: 2 }),
      describe: "the employee with a lower-case e-mail and FTE 1/2",
    },
  ],
  [
    `${planner.label}: POST /api/employees with a taken e-mail in other letter case`,
    () =>
      request(planner, "/api/employees", {
        method: "POST",
        json: { ...apiEmployee, email: apiEmployee.email.toUpperCase() },
      }),
    {
      status: 409,
      contentType: "application/json",
      check: isEmailTaken,
      describe: "errors.email, the taken-address text",
    },
  ],
  [
    `${planner.label}: POST /api/employees with an FTE of 3/2 and an empty last name`,
    () =>
      request(planner, "/api/employees", {
        method: "POST",
        json: { ...apiEmployee, lastName: "", fteNumerator: 3, fteDenominator: 2 },
      }),
    {
      status: 422,
      contentType: "application/json",
      check: rejectsFteAndLastName,
      describe: "errors for exactly the fte and lastName fields",
    },
  ],
  [
    `${planner.label}: POST /api/employees with a form body`,
    () => request(planner, "/api/employees", { method: "POST", form: apiEmployee }),
    { status: 415, contentType: "application/json" },
  ],
  [
    `${planner.label}: POST /api/employees with a body that is not JSON`,
    () => request(planner, "/api/employees", { method: "POST", jsonText: "{" }),
    { status: 400, contentType: "application/json", check: isInvalidJson, describe: "the error invalid_json" },
  ],
  plannerPutsEmployee("/api/employees/<id> changes the FTE", apiEmployeeUrl, {
    status: 200,
    check: isApiEmployee({ numerator: 3, denominator: 4 }),
    describe: "the same employee with FTE 3/4",
  }),
  plannerPutsEmployee("/api/employees/<unknown UUID>", () => unknownEmployeeUrl, {
    status: 404,
    check: isNotFound,
    describe: "the error not_found",
  }),
  plannerPutsEmployee("/api/employees/not-a-uuid", () => "/api/employees/not-a-uuid", {
    status: 404,
    check: isNotFound,
    describe: "the error not_found",
  }),
  [
    `${planner.label}: POST /api/employees creates a second employee`,
    async () => {
      const result = await request(planner, "/api/employees", { method: "POST", json: secondApiEmployee });
      secondApiEmployeeId = parseJson(result.body)?.employee?.id;
      return result;
    },
    {
      status: 201,
      contentType: "application/json",
      check: isSecondApiEmployee,
      describe: "a second employee with its own id and e-mail",
    },
  ],
  [
    `${planner.label}: PUT /api/employees/<id> with the e-mail of another employee`,
    () =>
      request(planner, apiEmployeeUrl(), {
        method: "PUT",
        json: { ...apiEmployee, email: secondApiEmployee.email },
      }),
    {
      status: 409,
      contentType: "application/json",
      check: isEmailTaken,
      describe: "errors.email, the taken-address text",
    },
  ],
  [
    `${planner.label}: POST /api/shifts creates a shift`,
    async () => {
      const result = await request(planner, "/api/shifts", { method: "POST", json: apiShift });
      apiShiftId = parseJson(result.body)?.shift?.id;
      return result;
    },
    {
      status: 201,
      contentType: "application/json",
      cacheControl: "no-store",
      check: isApiShift(360),
      describe: "the shift with its name trimmed and collapsed, from minute 1320 to 360",
    },
  ],
  [
    `${planner.label}: POST /api/shifts with the same name creates a second shift`,
    async () => {
      const result = await request(planner, "/api/shifts", { method: "POST", json: secondApiShift });
      secondApiShiftId = parseJson(result.body)?.shift?.id;
      return result;
    },
    {
      status: 201,
      contentType: "application/json",
      check: isSecondApiShift,
      describe: "a second shift with its own id, the same name and the times 06:00-14:00",
    },
  ],
  [
    `${planner.label}: POST /api/shifts with an empty name and a start of 25:00`,
    () => request(planner, "/api/shifts", { method: "POST", json: invalidApiShift }),
    {
      status: 422,
      contentType: "application/json",
      check: rejectsNameAndStartTime,
      describe: "errors for exactly the name and startTime fields",
    },
  ],
  [
    `${planner.label}: POST /api/shifts with equal start and end times`,
    () =>
      request(planner, "/api/shifts", { method: "POST", json: { ...apiShift, startTime: "08:00", endTime: "08:00" } }),
    {
      status: 422,
      contentType: "application/json",
      check: rejectsEndTimeOnly,
      describe: "an error for exactly the endTime field",
    },
  ],
  [
    `${planner.label}: POST /api/shifts with a form body`,
    () => request(planner, "/api/shifts", { method: "POST", form: apiShift }),
    { status: 415, contentType: "application/json" },
  ],
  [
    `${planner.label}: POST /api/shifts with a body that is not JSON`,
    () => request(planner, "/api/shifts", { method: "POST", jsonText: "{" }),
    { status: 400, contentType: "application/json", check: isInvalidJson, describe: "the error invalid_json" },
  ],
  plannerPutsShift("/api/shifts/<id> changes the end time", apiShiftUrl, {
    status: 200,
    cacheControl: "no-store",
    check: isApiShift(420),
    describe: "the same shift ending at minute 420",
  }),
  plannerPutsShift(
    "/api/shifts/<id> with an empty name and a start of 25:00",
    apiShiftUrl,
    {
      status: 422,
      check: rejectsNameAndStartTime,
      describe: "errors for exactly the name and startTime fields",
    },
    invalidApiShift,
  ),
  plannerPutsShift("/api/shifts/<unknown UUID>", () => unknownShiftUrl, {
    status: 404,
    check: isNotFound,
    describe: "the error not_found",
  }),
  plannerPutsShift("/api/shifts/not-a-uuid", () => "/api/shifts/not-a-uuid", {
    status: 404,
    check: isNotFound,
    describe: "the error not_found",
  }),
  // The absence routes and pages (see absenceRouteSteps): they need the second API employee, which exists by now.
  ...absenceRouteSteps,
  // The schedules API: a schedule is created and replaced through the app, the database shows exactly what was sent, and
  // every refused request leaves nothing behind. The schedule refers to the two shifts and the two employees above.
  [
    `${planner.label}: POST /api/schedules creates a schedule`,
    async () => {
      const result = await request(planner, "/api/schedules", { method: "POST", json: apiSchedule() });
      apiScheduleId = parseJson(result.body)?.id;
      return result;
    },
    {
      status: 201,
      contentType: "application/json",
      cacheControl: "no-store",
      check: isApiScheduleSaved,
      describe: "the id of the new schedule and nothing else",
    },
  ],
  ...plannerReadsSchedule(
    "shows the schedule created through the API",
    apiSchedule,
    "the schedule created through the API (3 cells, 2 people)",
    () => apiScheduleId,
  ),
  plannerPutsSchedule("/api/schedules/<id> changes the date and the staffing", apiScheduleUrl, {
    status: 200,
    cacheControl: "no-store",
    check: isApiScheduleSaved,
    describe: "the id of the same schedule and nothing else",
  }),
  ...plannerReadsSchedule(
    "shows exactly the schedule replaced through the API",
    changedApiSchedule,
    "the replaced schedule (another date, a cell changed, removed and added, the same 2 people)",
    () => apiScheduleId,
  ),
  plannerPostsSchedule(
    "with a date that does not exist, a label of 61 characters, no cells and no people",
    () => ({ json: invalidApiSchedule() }),
    {
      status: 422,
      check: hasErrorsOnFields("startDate", "label", "staffing", "employeeIds"),
      describe: "errors for exactly the startDate, label, staffing and employeeIds fields",
    },
  ),
  plannerPostsSchedule("with a cell repeated for the same shift and day", () => ({ json: repeatedCellApiSchedule() }), {
    status: 422,
    check: hasRepeatedCellError,
    describe: "an error for exactly the staffing field, the repeated-cell text",
  }),
  plannerPostsSchedule("with a shift that does not exist", () => ({ json: unknownShiftApiSchedule() }), {
    status: 422,
    check: isUnknownReference,
    describe: "the error unknown_reference",
  }),
  plannerPostsSchedule("with an employee that does not exist", () => ({ json: unknownEmployeeApiSchedule() }), {
    status: 422,
    check: isUnknownReference,
    describe: "the error unknown_reference",
  }),
  plannerPostsSchedule("with a form body", () => ({ form: apiSchedule() }), { status: 415 }),
  plannerPostsSchedule("with a body that is not JSON", () => ({ jsonText: "{" }), {
    status: 400,
    check: isInvalidJson,
    describe: "the error invalid_json",
  }),
  plannerPutsSchedule(
    "/api/schedules/<id> with a date that does not exist, a label of 61 characters, no cells and no people",
    apiScheduleUrl,
    {
      status: 422,
      check: hasErrorsOnFields("startDate", "label", "staffing", "employeeIds"),
      describe: "errors for exactly the startDate, label, staffing and employeeIds fields",
    },
    invalidApiSchedule,
  ),
  plannerPutsSchedule(
    "/api/schedules/<id> with a shift that does not exist",
    apiScheduleUrl,
    {
      status: 422,
      check: isUnknownReference,
      describe: "the error unknown_reference",
    },
    failedApiReplacement,
  ),
  plannerPutsSchedule("/api/schedules/<unknown UUID>", () => unknownScheduleUrl, {
    status: 404,
    check: isNotFound,
    describe: "the error not_found",
  }),
  plannerPutsSchedule("/api/schedules/not-a-uuid", () => "/api/schedules/not-a-uuid", {
    status: 404,
    check: isNotFound,
    describe: "the error not_found",
  }),
  // The assignment routes, on a schedule of their own (see routeSchedule). An assignment is added and removed by one
  // request each, and both are idempotent: adding what is there and removing what is gone answer 200 and change nothing.
  [
    `${planner.label}: POST /api/schedules creates the schedule for the assignment routes`,
    async () => {
      const result = await request(planner, "/api/schedules", { method: "POST", json: routeSchedule() });
      routeScheduleId = parseJson(result.body)?.id;
      return result;
    },
    {
      status: 201,
      contentType: "application/json",
      cacheControl: "no-store",
      check: (body) => isUuidText(body.id) && Object.keys(body).length === 1,
      describe: "the id of the new schedule and nothing else",
    },
  ],
  ...plannerReadsRouteSchedule(
    "shows the schedule created for the assignment routes",
    routeSchedule,
    () => [],
    "the route schedule (3 cells, 2 people, no assignments)",
  ),
  plannerCallsAssignments(
    "POST",
    "adds an assignment",
    routeAssignmentsUrl,
    () => ({ json: routeAssignment("A") }),
    wasWritten,
  ),
  plannerReadsRouteAssignments("shows the assignment just added", routeAssignmentsOf("A"), "the assignment just added"),
  plannerCallsAssignments(
    "POST",
    "again accepts the assignment that is there",
    routeAssignmentsUrl,
    () => ({ json: routeAssignment("A") }),
    wasWritten,
  ),
  plannerReadsRouteAssignments(
    "still shows one assignment after the repeated POST",
    routeAssignmentsOf("A"),
    "the one assignment, not repeated",
  ),
  plannerCallsAssignments(
    "DELETE",
    "removes the assignment",
    routeAssignmentsUrl,
    () => ({ json: routeAssignment("A") }),
    wasWritten,
  ),
  plannerReadsRouteAssignments("shows no assignment after the DELETE", () => [], "none (the assignment is gone)"),
  plannerCallsAssignments(
    "DELETE",
    "again accepts the removal of what is gone",
    routeAssignmentsUrl,
    () => ({ json: routeAssignment("A") }),
    wasWritten,
  ),
  plannerReadsRouteAssignments("still shows no assignment after the repeated DELETE", () => [], "none"),
  // From here on one assignment, in cell C, is always there: the witness that the requests below must leave alone. The
  // block after it gives the witness neighbours and takes them away again, so that it is alone again when the block is over.
  plannerCallsAssignments(
    "POST",
    "adds the witness",
    routeAssignmentsUrl,
    () => ({ json: routeAssignment("C") }),
    wasWritten,
  ),
  plannerReadsRouteAssignments("shows the witness", routeWitness, "the witness alone"),
  // A DELETE takes exactly the assignment its body names, by the whole key (schedule, shift, day, person), and nothing next
  // to it. Every part of the key has a neighbour that a filter missing that part would take along: the assignment A of the
  // first person is joined by the same person on the same day and another shift (the witness C), by the same person on the
  // same shift and another day (B) and by another person in the same cell (A of the second person). For the schedule, the
  // same key is sent to a schedule that does not exist while the assignment is there. Each DELETE is followed by a read of
  // the whole table, so what is taken, and what is not, shows. A DELETE of what is already gone is tried with the
  // neighbours there as well; the removals that follow it leave the witness alone in the table.
  plannerCallsAssignments(
    "POST",
    "adds the assignment of cell A for the first person",
    routeAssignmentsUrl,
    () => ({ json: routeAssignment("A") }),
    wasWritten,
  ),
  plannerCallsAssignments(
    "POST",
    "adds the assignment of cell A for the second person",
    routeAssignmentsUrl,
    () => ({ json: routeAssignment("A", secondApiEmployeeId) }),
    wasWritten,
  ),
  plannerCallsAssignments(
    "POST",
    "adds the assignment of cell B for the first person",
    routeAssignmentsUrl,
    () => ({ json: routeAssignment("B") }),
    wasWritten,
  ),
  plannerReadsRouteAssignments(
    "shows the witness with the three neighbours of cell A",
    routeAssignmentsAmong(["A", "first"], ["A", "second"], ["B", "first"], ["C", "first"]),
    "cells A, B and C of the first person and cell A of the second person",
  ),
  ...plannerDeletesRouteAssignment(
    "with the key of the assignment of cell A of the first person, on a schedule that does not exist",
    () => unknownAssignmentsUrl,
    () => routeAssignment("A"),
    routeAssignmentsAmong(["A", "first"], ["A", "second"], ["B", "first"], ["C", "first"]),
    "cells A, B and C of the first person and cell A of the second person (nothing is taken)",
  ),
  ...plannerDeletesRouteAssignment(
    "of the assignment of cell A of the first person takes that one only",
    routeAssignmentsUrl,
    () => routeAssignment("A"),
    routeAssignmentsAmong(["A", "second"], ["B", "first"], ["C", "first"]),
    "cell A of the second person and cells B and C of the first person (the one of cell A of the first person is gone)",
  ),
  ...plannerDeletesRouteAssignment(
    "of the assignment of cell A of the first person again finds nothing, the neighbours stay",
    routeAssignmentsUrl,
    () => routeAssignment("A"),
    routeAssignmentsAmong(["A", "second"], ["B", "first"], ["C", "first"]),
    "cell A of the second person and cells B and C of the first person (as before)",
  ),
  ...plannerDeletesRouteAssignment(
    "of the assignment of cell A of the second person takes that one only",
    routeAssignmentsUrl,
    () => routeAssignment("A", secondApiEmployeeId),
    routeAssignmentsAmong(["B", "first"], ["C", "first"]),
    "cells B and C of the first person",
  ),
  ...plannerDeletesRouteAssignment(
    "of the assignment of cell B of the first person takes that one only",
    routeAssignmentsUrl,
    () => routeAssignment("B"),
    routeWitness,
    "the witness alone",
  ),
  ...refusedRouteCalls("POST"),
  ...refusedRouteCalls("DELETE"),
  // A well-formed body that names a cell without staffing, a person outside the roster or a schedule that does not exist
  // breaks a foreign key (422 unknown_reference when adding); a removal of such an assignment finds nothing and is a 200.
  ...plannerTriesAssignmentCall(
    "POST",
    "in a cell without staffing",
    routeAssignmentsUrl,
    () => ({ json: { shiftId: apiShiftId, dayOffset: 3, employeeId: apiEmployeeId } }),
    { status: 422, check: isUnknownReference, describe: "the error unknown_reference" },
  ),
  ...plannerTriesAssignmentCall(
    "POST",
    "for a person outside the roster",
    routeAssignmentsUrl,
    // Both API employees are in the roster by now, and no other employee exists at this point of the run: the id that no
    // employee has breaks the same foreign key (schedule_assignments_employee_fkey, to the roster of the schedule).
    () => ({ json: routeAssignment("A", unknownEmployeeId) }),
    { status: 422, check: isUnknownReference, describe: "the error unknown_reference" },
  ),
  ...plannerTriesAssignmentCall(
    "POST",
    "on a schedule that does not exist",
    () => unknownAssignmentsUrl,
    () => ({ json: routeAssignment("A") }),
    { status: 422, check: isUnknownReference, describe: "the error unknown_reference" },
  ),
  ...plannerTriesAssignmentCall(
    "DELETE",
    "of an assignment in a cell without staffing finds nothing",
    routeAssignmentsUrl,
    () => ({ json: { shiftId: apiShiftId, dayOffset: 3, employeeId: apiEmployeeId } }),
    wasWritten,
  ),
  ...plannerTriesAssignmentCall(
    "DELETE",
    "on a schedule that does not exist finds nothing",
    () => unknownAssignmentsUrl,
    // The key of the witness, which is in the table: only the schedule of the request tells it from the assignment there.
    () => ({ json: routeAssignment("C") }),
    wasWritten,
  ),
  // The save of the schedule over the routes: it refuses to drop cells A and B once they hold an assignment each, unless
  // the body confirms it with exactly `confirmRemoval: true`. A refused save changes nothing, its label included.
  plannerCallsAssignments(
    "POST",
    "adds an assignment in cell A",
    routeAssignmentsUrl,
    () => ({ json: routeAssignment("A") }),
    wasWritten,
  ),
  plannerCallsAssignments(
    "POST",
    "adds an assignment in cell B",
    routeAssignmentsUrl,
    () => ({ json: routeAssignment("B") }),
    wasWritten,
  ),
  ...plannerReadsRouteSchedule(
    "shows the three assignments, one in each cell",
    routeSchedule,
    routeAssignmentsOf("A", "B", "C"),
    "the route schedule, with an assignment in each of its three cells",
  ),
  plannerPutsSchedule(
    "/api/schedules/<id> dropping two cells with assignments is refused without a confirmation",
    routeScheduleUrl,
    {
      status: 409,
      cacheControl: "no-store",
      check: wouldRemoveAssignments(2),
      describe: "the error assignments_would_be_removed and removed: 2, nothing else",
    },
    refusedRouteSchedule,
  ),
  ...plannerReadsRouteSchedule(
    "is unchanged after the refused PUT",
    routeSchedule,
    routeAssignmentsOf("A", "B", "C"),
    "the route schedule, unchanged, with the label of before the refused save",
  ),
  plannerPutsSchedule(
    '/api/schedules/<id> with confirmRemoval "yes" is refused like no confirmation',
    routeScheduleUrl,
    {
      status: 409,
      cacheControl: "no-store",
      check: wouldRemoveAssignments(2),
      describe: "the error assignments_would_be_removed and removed: 2, nothing else",
    },
    () => ({ ...refusedRouteSchedule(), confirmRemoval: "yes" }),
  ),
  ...plannerReadsRouteSchedule(
    'is unchanged after the PUT with confirmRemoval "yes"',
    routeSchedule,
    routeAssignmentsOf("A", "B", "C"),
    "the route schedule, unchanged, with the label of before the refused save",
  ),
  plannerPutsSchedule(
    "/api/schedules/<id> with confirmRemoval true drops the cells and their assignments",
    routeScheduleUrl,
    {
      status: 200,
      cacheControl: "no-store",
      check: isRouteScheduleSaved,
      describe: "the id of the same schedule and nothing else",
    },
    () => ({ ...trimmedRouteSchedule(), confirmRemoval: true }),
  ),
  ...plannerReadsRouteSchedule(
    "shows the schedule without cells A and B and only the assignment of cell C",
    trimmedRouteSchedule,
    routeWitness,
    "the route schedule with the single cell C, and its assignment (those of the dropped cells are gone)",
  ),
  // A view that was loaded before the save still offers cell A: adding there now breaks the foreign key.
  ...plannerTriesAssignmentCall(
    "POST",
    "in a cell that a save has just dropped",
    routeAssignmentsUrl,
    () => ({ json: routeAssignment("A") }),
    { status: 422, check: isUnknownReference, describe: "the error unknown_reference" },
  ),
  ...plannerReadsSchedule(
    "is unchanged after the refused requests",
    changedApiSchedule,
    "the replaced schedule, unchanged",
    () => apiScheduleId,
  ),
  [
    `${planner.label}: schedules read finds only the schedule of the API steps`,
    async () => schedulesTable("GET", { token: await accessToken(planner), query: `?label=like.${apiScheduleLabel}*` }),
    { status: 200, check: isOnlyApiSchedule, describe: "only the schedule saved through the API" },
  ],
  // The pages with names and e-mail addresses must not be cached.
  visit(planner, "/employees", 200, apiEmployee.lastName, "no-store"),
  visit(planner, "/employees/new", 200, undefined, "no-store"),
  visitApiEmployeePage(planner, 200, apiEmployee.lastName, "no-store"),
  visit(planner, `/employees/${unknownEmployeeId}`, 404, notFoundMessage),
  visit(planner, "/employees/not-a-uuid", 404, notFoundMessage),
  // The shift pages: the list shows the shift created above, the form page carries its name.
  visit(planner, "/shifts", 200, apiShiftName),
  visit(planner, "/shifts/new", 200),
  visitApiShiftPage(planner, 200, apiShiftName),
  visit(planner, `/shifts/${unknownShiftId}`, 404, notFoundShiftMessage),
  visit(planner, "/shifts/not-a-uuid", 404, notFoundShiftMessage),
  // The schedule pages: the list shows the schedule saved through the API above with its period, people and total, the form
  // page shows its cells and people, and every one of them carries the D6 notice and is not cached.
  visit(planner, "/schedules", 200, 'href="/schedules/new"', "no-store"),
  // The list holds the few schedules of this run, far below its limit of 100, so it has rows and no note that older
  // schedules were left out ("Pokazano 100 najnowszych grafików."). Only the absent case is covered here: the note itself
  // needs more than 100 schedules, which is too slow to create in a smoke test.
  [
    `${planner.label}: GET /schedules lists the API schedule without the note about older schedules left out`,
    () => request(planner, "/schedules"),
    { status: 200, bodyIncludes: apiScheduleLabel, bodyExcludes: "Pokazano", cacheControl: "no-store" },
  ],
  visitChecked(
    planner,
    "/schedules",
    200,
    listsApiSchedule,
    "the API schedule: period 15.11-21.11.2026, label, 2 people, total 8, a creation date, the edit link and an assign link",
    "no-store",
  ),
  // The link "Obsadź" to the assignment page, in the table row and in the card of the narrow layout, each named by the
  // period and the label like the edit link.
  visitChecked(
    planner,
    "/schedules",
    200,
    listsAssignLinkInRow,
    'in the table row of the API schedule, the link "Obsadź" to /schedules/<id>/assign with the aria-label "Obsadź: <period>, <label>"',
    "no-store",
  ),
  visitChecked(
    planner,
    "/schedules",
    200,
    listsAssignLinkInCard,
    'in the card of the API schedule, the link "Obsadź" to /schedules/<id>/assign with the aria-label "Obsadź: <period>, <label>"',
    "no-store",
  ),
  visitChecked(planner, "/schedules", 200, hasD6Notice, "the D6 notice", "no-store"),
  visit(planner, "/schedules/new", 200, "Nowy grafik", "no-store"),
  visitChecked(planner, "/schedules/new", 200, hasD6Notice, "the D6 notice", "no-store"),
  visitChecked(
    planner,
    "/schedules/new",
    200,
    offersNewSchedule,
    "a date input from 2020-01-01 to 2099-12-31, every employee ticked and no grid row",
    "no-store",
  ),
  ...plannerPageHidesEmails("/schedules/new", () => "/schedules/new"),
  visitApiSchedulePage(planner, 200, { bodyIncludes: apiScheduleLabel, cacheControl: "no-store" }),
  visitApiSchedulePage(planner, 200, { bodyCheck: hasD6Notice, describe: "the D6 notice", cacheControl: "no-store" }),
  visitApiSchedulePage(planner, 200, {
    bodyCheck: editsApiSchedule,
    describe: "the date, label, cells and people of the API schedule as the form state",
    cacheControl: "no-store",
  }),
  visitApiSchedulePage(planner, 200, {
    bodyCheck: linksToAssignPage,
    describe: 'the link "Obsadź pracowników" to /schedules/<id>/assign',
    cacheControl: "no-store",
  }),
  // A page without the `wide` prop keeps the narrow container; only the assignment page gets the wide one (see below).
  visitApiSchedulePage(planner, 200, {
    bodyCheck: hasNarrowLayout,
    describe: "the narrow layout container (max-w-4xl, not max-w-7xl), as every page without the wide prop",
    excerpt: layoutExcerpt,
    cacheControl: "no-store",
  }),
  ...plannerPageHidesEmails("/schedules/<id>", () => `/schedules/${apiScheduleId}`),
  // The edit page of a schedule that has assignments: the page counts them for the form (the number lets the form tell the
  // planner that a new date moves them) and must still render the form. The confirmation block and the date note are
  // client state, so the browser review shows them, not this step.
  visitRouteSchedulePage(planner, 200, {
    bodyCheck: hasTrimmedRouteLabel,
    describe: "the label of the route schedule, saved last by the confirmed PUT, in the label field",
    cacheControl: "no-store",
  }),
  // The assignment page of the API schedule, which has no assignment: every button is off and every counter of the
  // coverage table is short by the whole required count. Each step proves one thing, so a failure names its cause.
  visitApiAssignPage({
    bodyCheck: showsAssignHeading(apiSchedulePeriod, apiScheduleLabel),
    describe:
      'the title and heading "Obsadzanie grafiku", the period 15.11–21.11.2026 and the label of the API schedule',
    excerpt: headingExcerpt,
  }),
  visitApiAssignPage({
    bodyCheck: linksBackFromAssignPage,
    describe: 'the links "Edytuj grafik" to the edit page of the schedule and "Lista grafików" to the list',
    excerpt: (html) => JSON.stringify(linksOf(html)),
  }),
  visitApiAssignPage({ bodyCheck: hasD6Notice, describe: "the D6 notice" }),
  visitApiAssignPage({
    bodyCheck: showsGrid(apiGrid),
    describe:
      "a row for each of the two people with, on days 0, 3 and 4, the button of the shift that runs that day and nothing else, every aria-pressed false",
    excerpt: gridExcerpt,
  }),
  visitApiAssignPage({
    bodyCheck: showsCoverage(apiCoverage),
    describe: `the coverage table with 0 z 5 and the shortage mark ${MINUS}5 for the first shift on day 0, 0 z 1 and ${MINUS}1 on day 3 and 0 z 2 and ${MINUS}2 on day 4 for the second one, and no counter on the other days`,
    excerpt: coverageExcerpt,
  }),
  // The violations of the live check on the page of the API schedule, which has no assignment: a shortage is a warning for
  // each of its three cells (listed with the reason that names the shift, the day and the headcount), and nobody has a
  // violation of their own. Each step proves one thing, so a failure names its cause.
  visitApiAssignPage({
    bodyCheck: showsGridHeaders(apiGridHeaders),
    describe:
      'the header row of the people\'s table: "Pracownik", the seven days from niedz. 15.11 to sob. 21.11, then the columns "Wskazania" and "Godziny" last',
    excerpt: (html) => JSON.stringify(gridHeadersOf(html)),
  }),
  visitApiAssignPage({
    bodyCheck: hasViolationSection,
    describe:
      'the section of the list of violations with the heading "Wskazania", after the people\'s table and before the coverage section',
    excerpt: violationSectionExcerpt,
  }),
  visitApiAssignPage({
    bodyCheck: showsViolations(apiViolationItems, apiViolationCounter),
    describe:
      'the counter "Wskazania: 3 ostrzeżenia" and exactly three items "Ostrzeżenie Brak obsady: zmiana <shift> (<day>, <hours>): przypisano 0 z <n>, brakuje <n>." for the cells on days 0, 3 and 4, in that order',
    excerpt: violationsExcerpt,
  }),
  visitApiAssignPage({
    bodyCheck: showsViolationColumn(noPersonalViolations),
    describe:
      'the column "Wskazania" reading "brak" in the row of each of the two people, and no marker "Krytyczne" or "Ostrzeżenie" in any cell of a day',
    excerpt: violationColumnExcerpt,
  }),
  // The hours of the two people with nobody assigned: 0 min of the norm of their FTE (3/4 and 1/2 of 40 h), short by all of it.
  visitApiAssignPage({
    bodyCheck: showsHoursColumn(apiHours),
    describe: describeHoursRows(apiHours),
    excerpt: hoursColumnExcerpt,
  }),
  visitApiAssignPage({
    bodyCheck: hasEdgesNote,
    describe:
      "the fixed note under the list: the rules judge this schedule alone and the rest at its edges is not checked",
    excerpt: violationSectionExcerpt,
  }),
  visitApiAssignPage({
    bodyCheck: hasNoViolationAlert,
    describe: 'no role="alert" and no assertive live region in the list of violations (a click must not announce one)',
    excerpt: violationSectionExcerpt,
  }),
  visitApiAssignPage({
    bodyCheck: explainsCoverageNote,
    describe:
      "under the coverage table the sentence that a shortage is a warning on the list and an excess is only information, without the old sentence",
    excerpt: (html) => textsOf(cutAtCoverage(html)[1], "p")[0] ?? "(no coverage section)",
  }),
  // The table needs the room: the assignment page has the wide container, not the narrow one of the other pages.
  visitApiAssignPage({
    bodyCheck: hasWideLayout,
    describe: "the wide layout container (max-w-7xl, not max-w-4xl)",
    excerpt: layoutExcerpt,
  }),
  ...plannerPageHidesEmails("/schedules/<id>/assign", () => `/schedules/${apiScheduleId}/assign`),
  // The assignment page of the route schedule, which holds one assignment (the witness): the first person's button is
  // on, the second person's button for the same cell is off, and the single counter is full. Its label is the one of
  // the confirmed PUT; reading it from trimmedRouteSchedule needs no ids, so it can be taken before the steps have run.
  visitRouteAssignPage({
    bodyCheck: showsAssignHeading(routeSchedulePeriod, trimmedRouteSchedule().label),
    describe:
      'the title and heading "Obsadzanie grafiku", the period 11.11–17.11.2026 and the label of the route schedule',
    excerpt: headingExcerpt,
  }),
  visitRouteAssignPage({ bodyCheck: hasD6Notice, describe: "the D6 notice" }),
  visitRouteAssignPage({
    bodyCheck: showsGrid(routeGrid),
    describe:
      "a row for each of the two people with only the button of the single cell on day 0: aria-pressed true for the person with the assignment and false for the other",
    excerpt: gridExcerpt,
  }),
  visitRouteAssignPage({
    bodyCheck: showsCoverage(routeCoverage),
    describe: `the coverage table with a single row whose day 0 reads 1 z 1 without a shortage (${MINUS}) or excess (+) mark and no counter on the other days`,
    excerpt: coverageExcerpt,
  }),
  // The witness alone breaks no rule: one shift of 8 h (the limit itself is allowed), a break of more than 35 h around it,
  // and 8 h is far under the norm of a half-time week with a holiday (11.11) that is 16 h. The cell is complete (1 z 1),
  // so nothing is short either: the list says so and the people have nothing of their own.
  visitRouteAssignPage({
    bodyCheck: showsViolations([], noViolationsCounter),
    describe:
      'the counter "Brak wskazań" and no list item: the witness alone breaks no rule and the only cell is complete',
    excerpt: violationsExcerpt,
  }),
  visitRouteAssignPage({
    bodyCheck: showsViolationColumn(noPersonalViolations),
    describe:
      'the column "Wskazania" reading "brak" in the row of each of the two people, and no marker in any cell of a day',
    excerpt: violationColumnExcerpt,
  }),
  // The week of the route schedule has a holiday (Wednesday 11.11), so the norm of 3/4 and of 1/2 is 24 h and 16 h, and the
  // witness (8 h) is short by 16 h of the first and by all 16 h of the second person.
  visitRouteAssignPage({
    bodyCheck: showsHoursColumn(routeHours),
    describe: describeHoursRows(routeHours),
    excerpt: hoursColumnExcerpt,
  }),
  visitRouteAssignPage({
    bodyCheck: hasEdgesNote,
    describe: "the fixed note under the list, also when the list is empty",
    excerpt: violationSectionExcerpt,
  }),
  // An excess: a second person on cell C, which needs one. No schedule above has more people than it needs, so this is
  // the only place that shows the excess mark. The steps end with the witness alone again, the state that the rest of
  // the run (and the cleanup) expects of this schedule.
  plannerCallsAssignments(
    "POST",
    "adds the assignment of cell C for the second person, one more than the cell needs",
    routeAssignmentsUrl,
    () => ({ json: routeAssignment("C", secondApiEmployeeId) }),
    wasWritten,
  ),
  plannerReadsRouteAssignments(
    "shows cell C for both people after the second POST",
    routeAssignmentsAmong(["C", "first"], ["C", "second"]),
    "exactly two assignments, cell C of the first and of the second person",
  ),
  visitRouteAssignPage({
    bodyCheck: showsGrid(routeGridWithSurplus),
    describe:
      "two people on cell C: a row for each with only the button of the cell on day 0, both with aria-pressed true",
    excerpt: gridExcerpt,
  }),
  visitRouteAssignPage({
    bodyCheck: showsCoverage(routeCoverageWithSurplus),
    describe: `two people on cell C: the coverage row whose day 0 reads 2 z 1 with the excess mark +1 and the words nadmiar 1, and no shortage mark (${MINUS}, brakuje)`,
    excerpt: coverageExcerpt,
  }),
  // The excess is information on the coverage table and not a violation: both people work 8 h under the norm and nothing is
  // short, so the list stays empty and the people's column still reads "brak".
  visitRouteAssignPage({
    bodyCheck: showsViolations([], noViolationsCounter),
    describe: 'the counter "Brak wskazań" and no list item: an excess of staff (2 z 1) is no violation',
    excerpt: violationsExcerpt,
  }),
  visitRouteAssignPage({
    bodyCheck: showsViolationColumn(noPersonalViolations),
    describe:
      'the column "Wskazania" reading "brak" for both people, now that both are on cell C, and no marker in any cell of a day',
    excerpt: violationColumnExcerpt,
  }),
  // Only the second person's hours move: they have the 8 h of cell C now, the first person's text is as before.
  visitRouteAssignPage({
    bodyCheck: showsHoursColumn(routeHoursWithSurplus),
    describe: describeHoursRows(routeHoursWithSurplus),
    excerpt: hoursColumnExcerpt,
  }),
  ...plannerDeletesRouteAssignment(
    "of the assignment of cell C of the second person takes the excess away",
    routeAssignmentsUrl,
    () => routeAssignment("C", secondApiEmployeeId),
    routeWitness,
    "the witness alone (cell C of the first person)",
  ),

  // The live rules on real data (see rulesPeople): a schedule of its own, four people (one for each scenario of the rules) and
  // a shift for the break of exactly 11 h, all made through the app like the schedules above. Their e-mails and names start
  // with "smoke-" / "Smoke-", so the final cleanup finds them.
  [
    `${planner.label}: POST /api/shifts creates the early shift of the rules schedule`,
    async () => {
      const result = await request(planner, "/api/shifts", { method: "POST", json: rulesEarlyShift });
      rulesEarlyShiftId = parseJson(result.body)?.shift?.id;
      return result;
    },
    {
      status: 201,
      contentType: "application/json",
      check: (body) =>
        typeof body.shift.id === "string" &&
        body.shift.name === rulesEarlyShiftName &&
        body.shift.startMinute === 60 &&
        body.shift.endMinute === 540,
      describe: "the shift 01:00-09:00 (minutes 60 to 540) with its own id",
    },
  ],
  ...Object.entries(rulesPeople).map(([who, input]) =>
    plannerCreatesEmployee(`the employee ${who} of the rules schedule`, input, (id) => {
      rulesIds[who] = id;
    }),
  ),
  [
    `${planner.label}: POST /api/schedules creates the rules schedule`,
    async () => {
      const result = await request(planner, "/api/schedules", { method: "POST", json: rulesSchedule() });
      rulesScheduleId = parseJson(result.body)?.id;
      return result;
    },
    {
      status: 201,
      contentType: "application/json",
      cacheControl: "no-store",
      check: (body) => isUuidText(body.id) && Object.keys(body).length === 1,
      describe: "the id of the new schedule and nothing else",
    },
  ],
  ...plannerReadsSchedule(
    "shows the rules schedule",
    rulesSchedule,
    "the rules schedule (11 cells of 3 shifts, 4 people)",
    () => rulesScheduleId,
  ),
  ...rulesAssignments.map(plannerAddsRulesAssignment),
  plannerReadsRulesAssignments(
    "shows the thirteen assignments",
    () => rulesAssignments,
    "the rules schedule: 1 of alfa, 3 of beta, 2 of gamma and 7 of delta",
  ),
  // The page with all thirteen assignments. First what the page is (the schedule, the seven days and the column of the
  // violations last), then the list for each scenario with its person (the reason, the column and the marks of that person
  // only), then the whole list, the places of all the people, the coverage table and the pressed buttons together.
  visitRulesAssignPage({
    bodyCheck: showsAssignHeading(rulesPeriod, rulesScheduleLabel),
    describe: `the title and heading "Obsadzanie grafiku", the period ${rulesPeriod} and the label of the rules schedule`,
    excerpt: headingExcerpt,
  }),
  visitRulesAssignPage({
    bodyCheck: showsGridHeaders(["Pracownik", ...rulesDays, "Wskazania", "Godziny"]),
    describe: `the header row of the people's table: "Pracownik", the seven days from ${rulesDays[0]} to ${rulesDays[6]}, then the columns "Wskazania" and "Godziny" last`,
    excerpt: (html) => JSON.stringify(gridHeadersOf(html)),
  }),
  visitRulesAssignPage({
    bodyCheck: hasViolationSection,
    describe:
      'the section of the list of violations with the heading "Wskazania", after the people\'s table and before the coverage section',
    excerpt: violationSectionExcerpt,
  }),
  // (a) One shift of 9 h alone: more than 8 h in the day that starts with it, with the sentence about art. 135. No break
  // between shifts, no week above 48 h, no missing weekly rest and no week above the norm, so it is the only item.
  rulesPersonStep(
    "alfa",
    { items: () => [alfaHours()], column: "1 krytyczne", marks: { 0: "Krytyczne: 1" } },
    'alfa (N on day 0 alone, 9 h): the one item "Krytyczne ... w dobie liczonej od pon. 02.11, 22:00 przepracowane 9 h, dopuszczalne najwyżej 8 h." with the sentence about the system of equivalent working time (art. 135), the column "1 krytyczne" and the mark "Krytyczne: 1" on day 0 only',
  ),
  // (b) M and N on one day: 8 h between the end of M and the start of N is less than 11 h, and the day that starts with M holds
  // 8 h of M and 8 h of N (the window ends at 06:00 of the next day), 16 h in all, with the sentence for the 9 h shift. Both
  // items sit on the cell of day 0, so it carries "Krytyczne: 2". N on day 3 alone is a violation of its own on its own day.
  rulesPersonStep(
    "beta",
    {
      items: () => [betaRest(), betaHoursOnDay0(), betaHoursOnDay3()],
      column: "3 krytyczne",
      marks: { 0: "Krytyczne: 2", 3: "Krytyczne: 1" },
    },
    'beta (M and N on day 0, N alone on day 3): in this order the rest "przerwa 8 h między zmianami ... i ..., wymagane co najmniej 11 h.", the hours "od pon. 02.11, 06:00 przepracowane 16 h" and the hours "od czw. 05.11, 22:00 przepracowane 9 h", the column "3 krytyczne" and the marks "Krytyczne: 2" on day 0 and "Krytyczne: 1" on day 3',
  ),
  // (c) A break of exactly 11 h (M ends at 14:00 on day 4, E starts at 01:00 on day 5) is allowed, so there is no item about the
  // rest. The day that starts with M still holds 8 h of M and the 5 h of E before 06:00 of the next day, 13 h, so that is the
  // one item, on the cells of both days, and no shift is longer than 8 h, so there is no sentence about art. 135.
  rulesPersonStep(
    "gamma",
    {
      items: () => [gammaHours()],
      column: "1 krytyczne",
      marks: { 4: "Krytyczne: 1", 5: "Krytyczne: 1" },
    },
    'gamma (M on day 4 and E on day 5, a break of exactly 11 h, which is allowed): no item about the rest, the one item "od pt. 06.11, 06:00 przepracowane 13 h" without the sentence about art. 135, the column "1 krytyczne" and the mark "Krytyczne: 1" on days 4 and 5',
  ),
  // (d) M on all seven days: 56 h in the week, and the breaks are 16 h each (the free time at both edges of the schedule is one
  // break of 16 h, the first named), so the weekly rest is missing; 56 h is also above the norm of 40 h. No day has more than
  // 8 h and no break between two days is shorter than 11 h. The items belong to no cell, so no day carries a mark.
  rulesPersonStep(
    "delta",
    {
      items: () => [deltaWeeklyHours(), deltaWeeklyRest(), weeklyNormItem("delta", "56 h")],
      column: "2 krytyczne, 1 ostrzeżenie",
      marks: {},
    },
    'delta (M on all seven days): in this order the weekly hours "łączny czas pracy 56 h, dopuszczalne najwyżej 48 h", the weekly rest "najdłuższa przerwa trwa 16 h (od niedz. 08.11, 14:00 do końca grafiku i od początku grafiku do pon. 02.11, 06:00)" and the warning about the norm "56 h, norma tygodniowa (pełny etat) to 40 h", the column "2 krytyczne, 1 ostrzeżenie" and no mark in any day',
  ),
  // (e) A shortage is one warning for each cell with fewer people than it needs, whoever is in it: E on day 2 has nobody (0 of
  // 2) and M on day 6 only delta (1 of 2). N on day 0 (2 of 1) is in excess, and the complete cells give no item.
  visitRulesAssignPage({
    bodyCheck: (html) =>
      JSON.stringify(
        (violationItemsOf(html) ?? []).filter((item) => item.startsWith(`${SEVERITY_WORDS.warning} Brak obsady:`)),
      ) === JSON.stringify(listOf([shortageItem("E", 2, 0, 2), shortageItem("M", 6, 1, 2)])),
    describe:
      'the shortages: exactly two items "Ostrzeżenie Brak obsady: zmiana ... (śr. 04.11, 01:00-09:00): przypisano 0 z 2, brakuje 2." and "... (niedz. 08.11, 06:00-14:00): przypisano 1 z 2, brakuje 1.", and none for the cell in excess or for a complete one',
    excerpt: violationsExcerpt,
  }),
  ...rulesStateSteps(rulesStates[0]),
  visitRulesAssignPage({
    bodyCheck: hasEdgesNote,
    describe:
      "the fixed note under the list: the rules judge this schedule alone and the rest at its edges is not checked",
    excerpt: violationSectionExcerpt,
  }),
  visitRulesAssignPage({
    bodyCheck: hasNoViolationAlert,
    describe:
      'no role="alert" and no assertive live region in the list of violations, which has ten items (a click must not announce one)',
    excerpt: violationSectionExcerpt,
  }),
  // The neighbours: one assignment at a time is taken off through the route, and the page is read again. Only what that
  // assignment caused goes (or changes); the other person on the same shift and day, the same person on another day, and the
  // other items stay. The table is read after each DELETE, so that what the page shows is tied to what the database holds.
  ...plannerTakesOffRulesAssignment(["beta", "N", 0], rulesStates[1].removed),
  ...rulesStateSteps(rulesStates[1]),
  // Delta without M on day 6 works 48 h, the limit itself, so the weekly hours go; the free time at the end of the schedule (34
  // h) and at its start (6 h) is one break of 40 h, which is enough for the weekly rest though neither part is, so that goes
  // too. The norm of 40 h is still exceeded (48 h), now with the new total in its reason, and M on day 6 has nobody.
  ...plannerTakesOffRulesAssignment(["delta", "M", 6], rulesStates[2].removed),
  ...rulesStateSteps(rulesStates[2]),
  ...plannerTakesOffRulesAssignment(["alfa", "N", 0], rulesStates[3].removed),
  ...rulesStateSteps(rulesStates[3]),

  // The hours against the norm on real data (see hoursPeople): a schedule of its own in a week with a holiday, seven people (one
  // of them on half an FTE) made through the app like the schedules above, the two shifts of the API steps, and the people put
  // on the cells through the assignment route. The names and e-mails start with "Smoke-" / "smoke-", so the final cleanup finds
  // them. First what the page is, the paragraph under the table and the neutrality of the column, then the column for the
  // seven people, then the neighbours: one assignment at a time is taken off and only the person it belongs to changes.
  ...Object.entries(hoursPeople).map(([who, input]) =>
    plannerCreatesEmployee(`the employee ${who} of the hours schedule`, input, (id) => {
      hoursIds[who] = id;
    }),
  ),
  [
    `${planner.label}: POST /api/schedules creates the hours schedule`,
    async () => {
      const result = await request(planner, "/api/schedules", { method: "POST", json: hoursSchedule() });
      hoursScheduleId = parseJson(result.body)?.id;
      return result;
    },
    {
      status: 201,
      contentType: "application/json",
      cacheControl: "no-store",
      check: (body) => isUuidText(body.id) && Object.keys(body).length === 1,
      describe: "the id of the new schedule and nothing else",
    },
  ],
  ...plannerReadsSchedule(
    "shows the hours schedule",
    hoursSchedule,
    "the hours schedule (7 cells of 2 shifts, 7 people)",
    () => hoursScheduleId,
  ),
  ...hoursAssignments.map(plannerAddsHoursAssignment),
  plannerReadsHoursAssignments(
    "shows the fourteen assignments",
    () => hoursAssignments,
    "the hours schedule: 1 of one, 2 of two, 1 of night, 1 of half, 4 of equal and 5 of over",
  ),
  visitHoursAssignPage({
    bodyCheck: showsAssignHeading(hoursPeriod, hoursScheduleLabel),
    describe: `the title and heading "Obsadzanie grafiku", the period ${hoursPeriod} and the label of the hours schedule`,
    excerpt: headingExcerpt,
  }),
  visitHoursAssignPage({
    bodyCheck: showsGridHeaders(["Pracownik", ...hoursDays, "Wskazania", "Godziny"]),
    describe: `the header row of the people's table: "Pracownik", the seven days from ${hoursDays[0]} to ${hoursDays[6]}, then the columns "Wskazania" and "Godziny" last`,
    excerpt: (html) => JSON.stringify(gridHeadersOf(html)),
  }),
  visitHoursAssignPage({
    bodyCheck: hasHoursNote,
    describe:
      'the paragraph "Godziny: suma zmian rozpoczętych w tym grafiku względem normy tygodniowej etatu (40 h pomniejszone o 8 h za każde święto w dzień inny niż niedziela i za każdy dzień zatwierdzonej nieobecności od poniedziałku do piątku, proporcjonalnie do etatu). Przekroczenie normy pokazuje lista wskazań." once, after the people\'s table and before the section of the list of violations',
    excerpt: hoursNoteExcerpt,
  }),
  visitHoursAssignPage({
    bodyCheck: hasViolationSection,
    describe:
      'the section of the list of violations with the heading "Wskazania", still after the people\'s table and before the coverage section',
    excerpt: violationSectionExcerpt,
  }),
  // People below the norm, one at it and one above it are on the page, and the column does not tell them apart by role, live
  // region, icon or colour: each cell is the two lines of text.
  visitHoursAssignPage({
    bodyCheck: hasNeutralHoursColumn(Object.keys(hoursPeople).length),
    describe:
      'the header "Godziny" and the seven cells of the column with no role, no aria-live, no icon and no red, amber or sky colour class, each cell of exactly two lines of text',
    excerpt: hoursCellsExcerpt,
  }),
  ...hoursStateSteps(hoursStates[0]),
  // The neighbours: the person above the norm goes to equal, the one with two shifts to one, the one with the night shift of the
  // last day to nothing. The page is read after each DELETE, and the table too, so that what the page shows is tied to what
  // the database holds.
  ...plannerTakesOffHoursAssignment(["over", "M", 4], hoursStates[1].removed),
  ...hoursStateSteps(hoursStates[1]),
  ...plannerTakesOffHoursAssignment(["two", "N", 5], hoursStates[2].removed),
  ...hoursStateSteps(hoursStates[2]),
  ...plannerTakesOffHoursAssignment(["night", "N", 6], hoursStates[3].removed),
  ...hoursStateSteps(hoursStates[3]),

  // The absences on the assignment page (see absWeekRoster): two schedules of their own, with the shifts and the people the
  // steps make. The names and e-mails start with "Smoke-" / "smoke-", so the final cleanup finds them, and the absences go with
  // their employees (on delete cascade); the last steps prove that none is left.
  ...absencePageSteps,
  visit(planner, `/schedules/${unknownScheduleId}/assign`, 404, notFoundScheduleMessage, "no-store"),
  visit(planner, "/schedules/not-a-uuid/assign", 404, notFoundScheduleMessage, "no-store"),
  visit(planner, `/schedules/${unknownScheduleId}`, 404, notFoundScheduleMessage),
  visit(planner, "/schedules/not-a-uuid", 404, notFoundScheduleMessage),

  // Invitations (S-10), with the planner's session. A: a new employee gets an account with the employee role, linked to
  // the row.
  plannerCreatesEmployee("the employee to invite", inviteeInput, (id) => {
    inviteeId = id;
  }),
  plannerCreatesEmployee("the employee whose address belongs to a foreign account", foreignInput, (id) => {
    foreignId = id;
  }),
  plannerCreatesEmployee("an employee without an e-mail", noEmailInput, (id) => {
    noEmailId = id;
  }),
  plannerInvites(
    "creates the account",
    () => inviteeId,
    { status: 200, check: isInviteStatus("invited"), describe: "the status invited" },
    "brak SUPABASE_SERVICE_ROLE_KEY w .dev.vars lub .env aplikacji pod testem (trasa odpowiada 503 not_configured)",
  ),
  [
    "service role: the invited employee is linked to an account and has an invitation time",
    async () => {
      const result = await employeesTable("GET", { key: SUPABASE_SERVICE_ROLE_KEY, query: `?id=eq.${inviteeId}` });
      const row = parseJson(result.body)?.[0];
      inviteeUserId = row?.user_id;
      firstInvitedAt = row?.invited_at;
      return result;
    },
    {
      status: 200,
      check: (rows) =>
        rows.length === 1 && typeof rows[0].user_id === "string" && typeof rows[0].invited_at === "string",
      describe: "one row with a user_id and an invited_at",
    },
  ],
  [
    "service role: the new account has the employee role and the e-mail of the employee",
    async () => supabaseResult(await adminRequest("GET", `users/${inviteeUserId}`)),
    {
      status: 200,
      check: (user) =>
        user.id === inviteeUserId && user.email === inviteeInput.email && user.app_metadata.role === "employee",
      describe: "the account with the employee role in app_metadata and the address of the employee",
    },
  ],

  // B: inviting again before the password is set sends a new link; the token of the page comes from generate_link.
  plannerInvites("again sends a new link to the pending account", () => inviteeId, {
    status: 200,
    check: isInviteStatus("reinvited"),
    describe: "the status reinvited",
  }),
  serviceRoleReadsEmployee("the second invitation moves invited_at forward and keeps the link", () => inviteeId, {
    check: (rows) =>
      rows.length === 1 &&
      rows[0].user_id === inviteeUserId &&
      Date.parse(rows[0].invited_at) > Date.parse(firstInvitedAt),
    describe: "the same user_id and a later invited_at",
  }),
  // Activation (the decision change of 2026-11-23): the account is pending until the employee sets a password, so the
  // activation time is still empty here and the list shows the invitation, not a registration. These two list steps ask
  // for the invited label and the "Wyślij ponownie" button, which only a pending account has, so they run before the
  // password is set.
  serviceRoleReadsEmployee("the pending account has no activation time yet", () => inviteeId, {
    check: (rows) => rows.length === 1 && rows[0].user_id === inviteeUserId && rows[0].activated_at === null,
    describe: "the linked row with an activated_at of null",
  }),
  plannerListsEmployee(
    "the invited employee with the invitation date and the Wyślij ponownie button",
    () => inviteeId,
    { account: validInviteLabel, button: "Wyślij ponownie", disabled: false, excludes: "Zarejestrowany" },
    'the label "Zaproszony dd.mm.rrrr (link ważny do dd.mm.rrrr)" and the enabled button "Wyślij ponownie"',
  ),
  plannerEditPageShows(
    "the invited employee, with the account section",
    () => inviteeId,
    'an account section with the label "Zaproszony dd.mm.rrrr (link ważny do dd.mm.rrrr)" and the button "Wyślij ponownie"',
    (html) =>
      showsAccount({
        account: validInviteLabel,
        button: "Wyślij ponownie",
        disabled: false,
        excludes: "Zarejestrowany",
      })(accountSection(html)),
    accountSection,
  ),
  generateTokenStep("an invite token for the pending account", "invite", inviteeInput.email, (token) => {
    inviteToken = token;
  }),
  visitSetPassword("opens with the form", () => setPasswordPath(inviteToken, "invite"), openedLink),
  visitSetPassword(
    "opens again, because opening spends nothing",
    () => setPasswordPath(inviteToken, "invite"),
    openedLink,
  ),
  // Still the same unspent token, and the page is the React form island of the set-password page, not a plain form.
  visitSetPassword("renders the password form island with both fields", () => setPasswordPath(inviteToken, "invite"), {
    status: 200,
    bodyCheck: hasPasswordFormIsland,
    describe: "the set-password form with two new-password fields and the rule list of the island",
    excerpt: (html) => tagsOf(html, "input").join("\n"),
  }),
  visitSetPassword("without a token is refused", () => "/auth/set-password?type=invite", refusedLink),
  visitSetPassword(
    "with an unknown link type is refused",
    () => setPasswordPath(inviteToken, "magiclink"),
    refusedLink,
  ),
  postSetPassword(
    invitee,
    "with a weak password is refused and spends nothing",
    () => ({ tokenHash: inviteToken, type: "invite", password: "weak" }),
    {
      status: 422,
      check: (body) => typeof body.errors.password === "string",
      describe: "an error for the password field",
    },
  ),
  serviceRoleReadsEmployee("a refused weak password does not activate the account", () => inviteeId, {
    check: (rows) => rows.length === 1 && rows[0].activated_at === null,
    describe: "the row with an activated_at of null",
  }),
  postSetPassword(
    invitee,
    "with an unknown token is refused",
    () => ({ tokenHash: "0".repeat(56), type: "invite", password: inviteePassword }),
    refusesLink,
  ),
  postSetPassword(
    invitee,
    "with an unknown link type is refused",
    () => ({ tokenHash: inviteToken, type: "magiclink", password: inviteePassword }),
    refusesLink,
  ),
  postSetPassword(
    invitee,
    "with the token and a valid password sets the password and signs in",
    () => ({ tokenHash: inviteToken, type: "invite", password: inviteePassword }),
    { ...setsPassword, cacheControl: "no-store" },
  ),
  // The route called mark_account_active with the session of the link: the first password set activates the account.
  [
    "service role: setting the password has activated the account",
    async () => {
      const result = await employeesTable("GET", { key: SUPABASE_SERVICE_ROLE_KEY, query: `?id=eq.${inviteeId}` });
      inviteeActivatedAt = parseJson(result.body)?.[0]?.activated_at;
      return result;
    },
    {
      status: 200,
      check: (rows) =>
        rows.length === 1 &&
        rows[0].user_id === inviteeUserId &&
        typeof rows[0].activated_at === "string" &&
        !Number.isNaN(Date.parse(rows[0].activated_at)),
      describe: "the linked row with an activated_at timestamp",
    },
  ],
  postSetPassword(
    anonymous,
    "with the spent token is refused",
    () => ({ tokenHash: inviteToken, type: "invite", password: inviteePassword }),
    refusesLink,
  ),
  visit(invitee, "/dashboard", 200, inviteeInput.email),
  visit(invitee, "/employees", 403),
  visit(invitee, "/shifts", 403),
  [
    `${invitee.label}: GET /api/employees`,
    () => request(invitee, "/api/employees", { accept: "application/json" }),
    { status: 403, contentType: "application/json" },
  ],
  [
    `${invitee.label}: POST /api/employees/<id>/invite`,
    () => request(invitee, inviteUrl(inviteeId), { method: "POST" }),
    { status: 403, contentType: "application/json" },
  ],

  // C: inviting the same account again, now that it is active, sends a password reset; its token sets a new password.
  plannerInvites("again sends a password reset to the active account", () => inviteeId, {
    status: 200,
    check: isInviteStatus("password_reset"),
    describe: "the status password_reset",
  }),
  generateTokenStep("a recovery token for the active account", "recovery", inviteeInput.email, (token) => {
    recoveryToken = token;
  }),
  postSetPassword(
    inviteeReset,
    "with the recovery token sets a new password and signs in",
    () => ({ tokenHash: recoveryToken, type: "recovery", password: inviteeNewPassword }),
    setsPassword,
  ),
  // The reset ran mark_account_active again (the route calls it for every link type), and the first activation won.
  serviceRoleReadsEmployee("a password reset keeps the first activation time", () => inviteeId, {
    check: (rows) => rows.length === 1 && sameInstant(rows[0].activated_at, inviteeActivatedAt),
    describe: "the activated_at of the first password set, unchanged",
  }),
  [
    `${inviteeLogin.label}: signin accepts the new password`,
    () =>
      request(inviteeLogin, "/api/auth/signin", {
        method: "POST",
        form: { email: inviteeInput.email, password: inviteeNewPassword },
      }),
    { status: 302, location: "/" },
  ],
  [
    `${inviteeLogin.label}: signin rejects the old password`,
    () =>
      request(inviteeLogin, "/api/auth/signin", {
        method: "POST",
        form: { email: inviteeInput.email, password: inviteePassword },
      }),
    { status: 302, locationPrefix: "/auth/signin?error=" },
  ],

  // D: a foreign account on the address is refused and left alone, an employee without an e-mail cannot be invited, an
  // id that is unknown or not a UUID is a 404, and the e-mail of a linked employee is locked.
  plannerInvites("is refused for an address that belongs to a foreign account", () => foreignId, {
    status: 409,
    check: isError("account_exists"),
    describe: "the error account_exists",
  }),
  serviceRoleReadsEmployee("the employee with the foreign account stays without a link", () => foreignId, {
    check: (rows) => rows.length === 1 && rows[0].user_id === null && rows[0].invited_at === null,
    describe: "one row without a user_id and without an invited_at",
  }),
  [
    "service role: the foreign account keeps its missing role",
    async () => supabaseResult(await adminRequest("GET", `users/${foreignAccount.id}`)),
    {
      status: 200,
      check: (user) => user.id === foreignAccount.id && user.app_metadata.role === undefined,
      describe: "the account without a role in app_metadata",
    },
  ],
  plannerInvites("is refused for an employee without an e-mail", () => noEmailId, {
    status: 422,
    check: isError("no_email"),
    describe: "the error no_email",
  }),
  plannerInvites("answers 404 for an unknown id", () => unknownEmployeeId, {
    status: 404,
    check: isNotFound,
    describe: "the error not_found",
  }),
  plannerInvites("answers 404 for an id that is not a UUID", () => "not-a-uuid", {
    status: 404,
    check: isNotFound,
    describe: "the error not_found",
  }),
  // What the planner sees (S-10): the account column and the invite button in the list, the locked e-mail on the edit
  // page. They run before the employee without an e-mail gets one (the PUT below), so that row still shows the disabled
  // button.
  [
    `${planner.label}: GET /employees has the Konto column`,
    () => request(planner, "/employees"),
    {
      status: 200,
      cacheControl: "no-store",
      bodyCheck: (html) => /<th\b[^>]*>\s*Konto\s*<\/th>/.test(html),
      describe: "a Konto column header",
    },
  ],
  plannerListsEmployee(
    "an employee without an account and the Zaproś button",
    () => foreignId,
    { account: "Bez konta", button: "Zaproś", disabled: false },
    'the label "Bez konta" and the enabled button "Zaproś"',
  ),
  // The invitee has set a password by now (B, C above), so the list shows a registration and a password reset, not the
  // invitation the steps before the password was set looked for.
  plannerListsEmployee(
    "the registered employee with the registration date and the Resetuj hasło button",
    () => inviteeId,
    { account: activeLabel, button: "Resetuj hasło", disabled: false, excludes: "Zaproszony" },
    'the label "Zarejestrowany dd.mm.rrrr" (no "Zaproszony") and the enabled button "Resetuj hasło" (not "Wyślij ponownie")',
  ),
  plannerListsEmployee(
    "an employee without an e-mail and a disabled button with the hint",
    () => noEmailId,
    { account: "Bez konta", button: "Zaproś", disabled: true },
    `the label "Bez konta", the disabled button "Zaproś" and the hint "${noEmailHint}"`,
  ),
  plannerEditPageShows(
    "the invited employee, with the e-mail locked",
    () => inviteeId,
    "a read-only e-mail field with the address, described by the locked hint, and the text of that hint",
    (html) => {
      const field = inputById(html, "email");
      return (
        field !== undefined &&
        hasAttribute(field, "readonly") &&
        attributeOf(field, "value") === inviteeInput.email &&
        attributeOf(field, "aria-describedby")?.split(" ").includes("email-locked") === true &&
        html.includes(emailLockedMessage)
      );
    },
    (html) => `${emailFieldOf(html)}\nlocked hint in the page: ${html.includes(emailLockedMessage)}`,
  ),
  plannerEditPageShows(
    "the registered employee, with the account section",
    () => inviteeId,
    'an account section with the label "Zarejestrowany dd.mm.rrrr" (no "Zaproszony") and the button "Resetuj hasło"',
    (html) =>
      showsAccount({ account: activeLabel, button: "Resetuj hasło", disabled: false, excludes: "Zaproszony" })(
        accountSection(html),
      ),
    accountSection,
  ),
  plannerEditPageShows(
    "an employee without an account, with the e-mail editable",
    () => foreignId,
    'an e-mail field that is not read-only, no locked hint, and an account section with "Bez konta" and the button "Zaproś"',
    (html) => {
      const field = inputById(html, "email");
      return (
        field !== undefined &&
        !hasAttribute(field, "readonly") &&
        attributeOf(field, "value") === foreignEmail &&
        !html.includes(emailLockedMessage) &&
        showsAccount({ account: "Bez konta", button: "Zaproś", disabled: false })(accountSection(html))
      );
    },
    (html) => `${emailFieldOf(html)}\n${accountSection(html)}`,
  ),
  plannerEditPageShows(
    "an employee without an e-mail, with the invite button disabled",
    () => noEmailId,
    `an account section with "Bez konta", the disabled button "Zaproś" and the hint "${noEmailHint}"`,
    (html) => showsAccount({ account: "Bez konta", button: "Zaproś", disabled: true })(accountSection(html)),
    accountSection,
  ),
  [
    `${planner.label}: PUT /api/employees/<id> with a changed e-mail of an invited employee`,
    () =>
      request(planner, `/api/employees/${inviteeId}`, {
        method: "PUT",
        json: { ...inviteeInput, email: `smoke-inv-${runId}-changed@example.com` },
      }),
    {
      status: 422,
      contentType: "application/json",
      check: (body) => body.errors.email === emailLockedMessage,
      describe: "errors.email, the locked-address text",
    },
  ],
  [
    `${planner.label}: PUT /api/employees/<id> with a changed first name of an invited employee`,
    () =>
      request(planner, `/api/employees/${inviteeId}`, {
        method: "PUT",
        json: { ...inviteeInput, firstName: "Józefa" },
      }),
    {
      status: 200,
      contentType: "application/json",
      check: (body) =>
        body.employee.firstName === "Józefa" &&
        body.employee.email === inviteeInput.email &&
        body.employee.userId === inviteeUserId &&
        typeof body.employee.invitedAt === "string",
      describe: "the renamed employee with the same e-mail, still linked and invited",
    },
  ],
  [
    `${planner.label}: PUT /api/employees/<id> with a new e-mail of an employee without an account`,
    () =>
      request(planner, `/api/employees/${noEmailId}`, {
        method: "PUT",
        json: { ...noEmailInput, email: `smoke-inv-${runId}-late@example.com` },
      }),
    {
      status: 200,
      contentType: "application/json",
      check: (body) =>
        body.employee.email === `smoke-inv-${runId}-late@example.com` &&
        body.employee.userId === null &&
        body.employee.invitedAt === null,
      describe: "the employee with the new e-mail and no account",
    },
  ],
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
  [`${anonymous.label}: rpc is_planner is rejected`, () => rpc("is_planner"), anonymousFunctionDenied("is_planner")],
  [
    `${anonymous.label}: rpc current_app_role is rejected`,
    () => rpc("current_app_role"),
    anonymousFunctionDenied("current_app_role"),
  ],

  // Employees table: only the planner reads, adds and edits rows, nobody deletes them, and the constraints hold even for
  // the planner. These steps send bearer tokens straight to PostgREST, without the app.
  [
    `${planner.label}: employees insert returns the new row`,
    async () => {
      const result = await employeesTable("POST", {
        token: await accessToken(planner),
        body: smokeEmployee,
        prefer: "return=representation",
      });
      smokeEmployeeId = parseJson(result.body)?.[0]?.id;
      return result;
    },
    { status: 201, check: isSmokeEmployee(), describe: "the inserted smoke employee, echoed back" },
  ],
  plannerReadsEmployee("employees read shows the new row", undefined, "the smoke employee as inserted"),
  [
    `${planner.label}: employees insert with a taken e-mail is rejected`,
    async () => employeesTable("POST", { token: await accessToken(planner), body: smokeEmployee }),
    { status: 409 },
  ],
  [
    `${planner.label}: employees insert with an upper-case e-mail is rejected`,
    async () =>
      employeesTable("POST", {
        token: await accessToken(planner),
        body: { ...smokeEmployee, email: `smoke-${runId}-Upper@Example.com` },
      }),
    { statusNotClass: 2, check: violates("employees_email_valid"), describe: "an error naming employees_email_valid" },
  ],
  [
    `${planner.label}: employees insert with an FTE of 3/2 is rejected`,
    async () =>
      employeesTable("POST", {
        token: await accessToken(planner),
        body: { ...smokeEmployee, email: `smoke-${runId}-fte@example.com`, fte_numerator: 3, fte_denominator: 2 },
      }),
    { statusNotClass: 2, check: violates("employees_fte_valid"), describe: "an error naming employees_fte_valid" },
  ],
  [
    `${planner.label}: employees update changes the FTE`,
    async () => employeesTable("PATCH", { token: await accessToken(planner), query: smokeRow(), body: patchedFte }),
    { statusClass: 2 },
  ],
  plannerReadsEmployee("employees read shows the new FTE", patchedFte, "the smoke employee with FTE 3/4"),
  [
    `${planner.label}: employees delete is rejected`,
    async () => employeesTable("DELETE", { token: await accessToken(planner), query: smokeRow() }),
    tableDenied("employees"),
  ],
  plannerReadsEmployee(
    "employees row still exists after the delete attempt",
    patchedFte,
    "the smoke employee with FTE 3/4",
  ),
  ...notPlannerEmployeeSteps(employee),
  ...notPlannerEmployeeSteps(noRole),
  [`${anonymous.label}: employees read is rejected`, () => employeesTable("GET"), anonymousTableDenied("employees")],

  // Employee accounts: user_id links a row to an Auth account and invited_at records the latest invitation. An employee
  // reads only their own row and changes nothing, an account without a role reads nothing even when linked, one account
  // belongs to at most one row, and no session writes the two columns, the planner's included: only the service role does.
  [
    `${planner.label}: employees insert returns the row for the employee account`,
    async () => {
      const result = await employeesTable("POST", {
        token: await accessToken(planner),
        body: ownEmployee,
        prefer: "return=representation",
      });
      ownEmployeeId = parseJson(result.body)?.[0]?.id;
      return result;
    },
    { status: 201, check: isInsertedEmployee(ownEmployee), describe: "the inserted row, echoed back" },
  ],
  [
    "service role: link the employee account to its row and set the invitation time",
    () =>
      employeesTable("PATCH", {
        key: SUPABASE_SERVICE_ROLE_KEY,
        query: ownRow(),
        body: { user_id: employee.id, invited_at: invitedAt },
      }),
    { statusClass: 2 },
  ],
  [
    `${employee.label}: employees read returns only its own row`,
    async () => employeesTable("GET", { token: await accessToken(employee) }),
    { status: 200, check: isOwnRow(), describe: "exactly the row linked to its account, with the invitation time" },
  ],
  [
    `${employee.label}: employees read of every other row returns an empty list`,
    async () => employeesTable("GET", { token: await accessToken(employee), query: `?id=neq.${ownEmployeeId}` }),
    { status: 200, check: isEmptyList, describe: "an empty list" },
  ],
  [
    `${employee.label}: employees update of its own row changes no row`,
    async () =>
      employeesTable("PATCH", {
        token: await accessToken(employee),
        query: ownRow(),
        body: { first_name: "Smoke-Changed" },
        prefer: asksForChangedRows,
      }),
    rowsHidden,
  ],
  [
    `${employee.label}: employees insert is rejected although its account is linked`,
    async () =>
      employeesTable("POST", {
        token: await accessToken(employee),
        body: { ...ownEmployee, email: `smoke-${runId}-employee-insert@example.com` },
      }),
    policyTurnsDown("employees"),
  ],
  plannerReadsOwnRow(
    "employees row of the account is unchanged after employee write attempts",
    undefined,
    "the linked row as inserted",
  ),
  [
    `${planner.label}: employees insert returns the row for the account without a role`,
    async () => {
      const result = await employeesTable("POST", {
        token: await accessToken(planner),
        body: noRoleEmployee,
        prefer: "return=representation",
      });
      noRoleEmployeeId = parseJson(result.body)?.[0]?.id;
      return result;
    },
    { status: 201, check: isInsertedEmployee(noRoleEmployee), describe: "the inserted row, echoed back" },
  ],
  [
    "service role: linking a second row to the same account is rejected",
    () =>
      employeesTable("PATCH", { key: SUPABASE_SERVICE_ROLE_KEY, query: noRoleRow(), body: { user_id: employee.id } }),
    { status: 409, check: violates("employees_user_id_key"), describe: "an error naming employees_user_id_key" },
  ],
  [
    "service role: link the account without a role to the second row",
    () => employeesTable("PATCH", { key: SUPABASE_SERVICE_ROLE_KEY, query: noRoleRow(), body: { user_id: noRole.id } }),
    { statusClass: 2 },
  ],
  [
    `${planner.label}: employees read shows the second row linked to the account without a role`,
    async () => employeesTable("GET", { token: await accessToken(planner), query: noRoleRow() }),
    { status: 200, check: isLinkedToNoRoleAccount, describe: "the second row with the user_id of that account" },
  ],
  [
    `${noRole.label}: employees read returns an empty list although its account is linked`,
    async () => employeesTable("GET", { token: await accessToken(noRole), query: "?select=id" }),
    { status: 200, check: isEmptyList, describe: "an empty list" },
  ],
  [
    `${planner.label}: employees update changes the first name`,
    async () =>
      employeesTable("PATCH", {
        token: await accessToken(planner),
        query: ownRow(),
        body: { first_name: "Smoke-Renamed" },
      }),
    { statusClass: 2 },
  ],
  plannerWriteIsDenied("update of user_id", "PATCH", () => ({ query: ownRow(), body: { user_id: planner.id } })),
  plannerWriteIsDenied("update of invited_at", "PATCH", () => ({
    query: ownRow(),
    body: { invited_at: plannerInvitedAt },
  })),
  plannerWriteIsDenied("insert with a user_id", "POST", () => ({
    body: { ...ownEmployee, email: `smoke-${runId}-planner-link@example.com`, user_id: planner.id },
  })),
  plannerReadsOwnRow(
    "employees row keeps its link and invitation time after planner write attempts",
    { first_name: "Smoke-Renamed" },
    "the renamed row, still linked to the employee account and invited at the service-role time",
  ),

  // Account activation: employees.activated_at is written only by the function mark_account_active() (security
  // definer), which touches the row of the caller's own account and only for the employee role. The employee account of
  // the steps above is linked to ownEmployee, the account without a role to noRoleEmployee. No session writes the
  // column directly, the planner's included.
  [
    `${employee.label}: employees read shows no activation time before the first call`,
    async () => employeesTable("GET", { token: await accessToken(employee) }),
    {
      status: 200,
      check: (rows) => rows.length === 1 && rows[0].id === ownEmployeeId && rows[0].activated_at === null,
      describe: "its own row with an activated_at of null",
    },
  ],
  // A no-op for the account without a role: the function exists and may be executed, finds no employee row of that account
  // to change and returns nothing (204, the answer of a void function). A missing function would answer 404 and a refused
  // one 403, which the exact status tells apart; that the call changed nothing is proven by the control read below.
  [
    `${noRole.label}: rpc mark_account_active changes nothing`,
    async () => rpc("mark_account_active", await accessToken(noRole)),
    { status: 204 },
  ],
  [
    `${anonymous.label}: rpc mark_account_active is rejected`,
    () => rpc("mark_account_active"),
    anonymousFunctionDenied("mark_account_active"),
  ],
  [
    "service role: both linked rows are still not active after the calls of the account without a role and of the anonymous caller",
    () =>
      employeesTable("GET", {
        key: SUPABASE_SERVICE_ROLE_KEY,
        query: `?id=in.(${ownEmployeeId},${noRoleEmployeeId})&select=id,activated_at`,
      }),
    {
      status: 200,
      check: (rows) => rows.length === 2 && rows.every((row) => row.activated_at === null),
      describe: "two rows, both with an activated_at of null",
    },
  ],
  [
    `${employee.label}: rpc mark_account_active activates its own row`,
    async () => rpc("mark_account_active", await accessToken(employee)),
    { statusClass: 2 },
  ],
  [
    `${employee.label}: employees read shows its own activation time`,
    async () => {
      const result = await employeesTable("GET", { token: await accessToken(employee) });
      ownActivatedAt = parseJson(result.body)?.[0]?.activated_at;
      return result;
    },
    {
      status: 200,
      check: (rows) =>
        rows.length === 1 &&
        rows[0].id === ownEmployeeId &&
        typeof rows[0].activated_at === "string" &&
        !Number.isNaN(Date.parse(rows[0].activated_at)),
      describe: "its own row with an activated_at timestamp",
    },
  ],
  [
    "service role: the call of one employee left the row of the other linked account alone",
    () => employeesTable("GET", { key: SUPABASE_SERVICE_ROLE_KEY, query: noRoleRow() }),
    {
      status: 200,
      check: (rows) => rows.length === 1 && rows[0].user_id === noRole.id && rows[0].activated_at === null,
      describe: "the row of the account without a role, still with an activated_at of null",
    },
  ],
  plannerWriteIsDenied("update of activated_at", "PATCH", () => ({ query: ownRow(), body: { activated_at: null } })),
  [
    `${employee.label}: a second rpc mark_account_active call is accepted`,
    async () => rpc("mark_account_active", await accessToken(employee)),
    { statusClass: 2 },
  ],
  [
    `${employee.label}: employees read still shows the first activation time`,
    async () => employeesTable("GET", { token: await accessToken(employee) }),
    {
      status: 200,
      check: (rows) => rows.length === 1 && sameInstant(rows[0].activated_at, ownActivatedAt),
      describe: "its own row with the activated_at of the first call",
    },
  ],

  // Shifts table: only the planner reads, adds and edits rows, nobody deletes them, and the constraints hold even for
  // the planner. A name is not unique, and a shift may end after midnight.
  [
    `${planner.label}: shifts insert returns the new row`,
    async () => {
      const result = await shiftsTable("POST", {
        token: await accessToken(planner),
        body: smokeShift,
        prefer: "return=representation",
      });
      smokeShiftId = parseJson(result.body)?.[0]?.id;
      return result;
    },
    { status: 201, check: isInsertedShift(smokeShift), describe: "the inserted 22:00-06:00 shift, echoed back" },
  ],
  [
    `${planner.label}: shifts insert with the same name is accepted`,
    async () => {
      const result = await shiftsTable("POST", {
        token: await accessToken(planner),
        body: sameNameShift,
        prefer: "return=representation",
      });
      sameNameShiftId = parseJson(result.body)?.[0]?.id;
      return result;
    },
    { status: 201, check: isInsertedShift(sameNameShift), describe: "the inserted second shift, echoed back" },
  ],
  plannerReadsShifts("shifts read shows both rows", undefined, "both smoke shifts as inserted"),
  plannerRejectsShift(
    "with equal start and end times",
    { name: `Smoke-${runId}-equal`, start_minute: 480, end_minute: 480 },
    "shifts_times_differ",
  ),
  plannerRejectsShift(
    "with a start of minute 1440",
    { name: `Smoke-${runId}-start`, start_minute: 1440, end_minute: 360 },
    "shifts_start_minute_valid",
  ),
  plannerRejectsShift(
    "with an end of minute 1440",
    { name: `Smoke-${runId}-end`, start_minute: 360, end_minute: 1440 },
    "shifts_end_minute_valid",
  ),
  plannerRejectsShift("with an empty name", { name: "", start_minute: 360, end_minute: 840 }, "shifts_name_valid"),
  plannerRejectsShift(
    "with a leading space in the name",
    { name: ` Smoke-${runId}-space`, start_minute: 360, end_minute: 840 },
    "shifts_name_valid",
  ),
  [
    `${planner.label}: shifts update changes the end time`,
    async () => shiftsTable("PATCH", { token: await accessToken(planner), query: smokeShiftRow(), body: patchedShift }),
    { statusClass: 2 },
  ],
  plannerReadsShifts(
    "shifts read shows the new end time",
    patchedShift,
    "both smoke shifts, the first one ending at minute 420",
  ),
  [
    `${planner.label}: shifts delete is rejected`,
    async () => shiftsTable("DELETE", { token: await accessToken(planner), query: smokeShiftRow() }),
    tableDenied("shifts"),
  ],
  plannerReadsShifts(
    "shifts rows still exist after the delete attempt",
    patchedShift,
    "both smoke shifts, the first one ending at minute 420",
  ),
  ...notPlannerShiftSteps(employee),
  ...notPlannerShiftSteps(noRole),
  [`${anonymous.label}: shifts read is rejected`, () => shiftsTable("GET"), anonymousTableDenied("shifts")],

  // Schedules tables and the save_schedule function: only the planner reads and saves, a save is atomic, the constraints
  // and foreign keys hold even for the planner, and nobody deletes a schedule. These steps send bearer tokens straight
  // to PostgREST, without the app. They use the shifts and employees of the steps above, so they come after them.
  [
    `${planner.label}: rpc save_schedule creates a schedule`,
    async () => {
      const result = await rpc("save_schedule", await accessToken(planner), saveScheduleArgs(createdSchedule()));
      smokeScheduleId = parseJson(result.body);
      return result;
    },
    { status: 200, check: isUuidText, describe: "the id of the new schedule" },
  ],
  ...plannerReadsSchedule("shows the created schedule", createdSchedule, "the created schedule (3 cells, 2 people)"),
  [
    `${planner.label}: rpc save_schedule replaces the schedule`,
    async () => rpc("save_schedule", await accessToken(planner), saveScheduleArgs(replacedSchedule(), smokeScheduleId)),
    { status: 200, check: (id) => id === smokeScheduleId, describe: "the id of the same schedule" },
  ],
  ...plannerReadsSchedule(
    "shows exactly the replaced schedule",
    replacedSchedule,
    "the replaced schedule (another date, a cell removed, changed and added, 1 person)",
  ),
  plannerRejectsSave("with a required count of 0", zeroCountSchedule, "schedule_staffing_required_count_valid"),
  plannerRejectsSave("with a shift that does not exist", unknownShiftSchedule, "schedule_staffing_shift_id_fkey"),
  [
    `${planner.label}: schedules read finds no schedule left by the rejected saves`,
    async () =>
      schedulesTable("GET", { token: await accessToken(planner), query: `?label=like.Smoke-${runId}-atomic*` }),
    { status: 200, check: isEmptyList, describe: "an empty list" },
  ],
  plannerRejectsSave(
    "replacing the schedule with a required count of 0",
    failedReplacement,
    "schedule_staffing_required_count_valid",
    () => smokeScheduleId,
  ),
  ...plannerReadsSchedule(
    "is unchanged after the rejected replacement",
    replacedSchedule,
    "the replaced schedule, unchanged",
  ),
  [
    `${planner.label}: rpc save_schedule with an unknown schedule id returns 404`,
    async () =>
      rpc("save_schedule", await accessToken(planner), saveScheduleArgs(createdSchedule(), unknownScheduleId)),
    { status: 404, check: (error) => error.code === "PT404", describe: "an error with the code PT404" },
  ],
  plannerRejectsScheduleRow(
    "schedules",
    "with a start date of 2019-12-31",
    () => ({ start_date: "2019-12-31", label: `Smoke-${runId}-date` }),
    "schedules_start_date_valid",
  ),
  plannerRejectsScheduleRow(
    "schedules",
    "with an empty label",
    () => ({ start_date: "2026-11-11", label: "" }),
    "schedules_label_valid",
  ),
  plannerRejectsScheduleRow(
    "schedules",
    "with a leading space in the label",
    () => ({ start_date: "2026-11-11", label: ` Smoke-${runId}-space` }),
    "schedules_label_valid",
  ),
  plannerRejectsScheduleRow(
    "schedule_staffing",
    "with a day offset of 7",
    () => ({ schedule_id: smokeScheduleId, shift_id: smokeShiftId, day_offset: 7, required_count: 1 }),
    "schedule_staffing_day_offset_valid",
  ),
  plannerRejectsScheduleRow(
    "schedule_staffing",
    "with a required count of 100",
    () => ({ schedule_id: smokeScheduleId, shift_id: smokeShiftId, day_offset: 2, required_count: 100 }),
    "schedule_staffing_required_count_valid",
  ),
  plannerRejectsScheduleRow(
    "schedule_staffing",
    "with a repeated primary key",
    () => ({ schedule_id: smokeScheduleId, shift_id: smokeShiftId, day_offset: 0, required_count: 1 }),
    "schedule_staffing_pkey",
  ),
  plannerRejectsScheduleRow(
    "schedule_employees",
    "with a repeated primary key",
    () => ({ schedule_id: smokeScheduleId, employee_id: smokeEmployeeId }),
    "schedule_employees_pkey",
  ),
  [
    `${planner.label}: schedules delete is rejected`,
    async () => schedulesTable("DELETE", { token: await accessToken(planner), query: smokeScheduleRow() }),
    tableDenied("schedules"),
  ],
  ...plannerReadsSchedule(
    "still exists after the delete attempt",
    replacedSchedule,
    "the replaced schedule, unchanged",
  ),
  // Anonymous: no table, no function. The planner's reads after the signed-in accounts below cover these attempts too.
  // Every answer is a 401 with 42501 and the name of the table or of the function, so a missing table or function (404)
  // or a call that got further than the privileges does not pass for a refusal.
  [`${anonymous.label}: schedules read is rejected`, () => schedulesTable("GET"), anonymousTableDenied("schedules")],
  [
    `${anonymous.label}: schedule_staffing read is rejected`,
    () => scheduleStaffingTable("GET"),
    anonymousTableDenied("schedule_staffing"),
  ],
  [
    `${anonymous.label}: schedule_employees read is rejected`,
    () => scheduleEmployeesTable("GET"),
    anonymousTableDenied("schedule_employees"),
  ],
  // The view has no grant for anon at all, so the privilege itself is what stops the read (not the policies below it).
  [
    `${anonymous.label}: schedule_summaries read is rejected`,
    () => scheduleSummariesTable("GET"),
    anonymousViewDenied("schedule_summaries"),
  ],
  [
    `${anonymous.label}: schedules insert is rejected`,
    () => schedulesTable("POST", { body: { start_date: "2026-11-11", label: `Smoke-${runId}-anonymous-insert` } }),
    anonymousTableDenied("schedules"),
  ],
  [
    `${anonymous.label}: schedule_staffing insert is rejected`,
    () =>
      scheduleStaffingTable("POST", {
        body: { schedule_id: smokeScheduleId, shift_id: sameNameShiftId, day_offset: 3, required_count: 1 },
      }),
    anonymousTableDenied("schedule_staffing"),
  ],
  [
    `${anonymous.label}: schedule_employees insert is rejected`,
    () => scheduleEmployeesTable("POST", { body: { schedule_id: smokeScheduleId, employee_id: apiEmployeeId } }),
    anonymousTableDenied("schedule_employees"),
  ],
  [
    `${anonymous.label}: rpc save_schedule is rejected`,
    () =>
      rpc(
        "save_schedule",
        undefined,
        saveScheduleArgs({ ...createdSchedule(), label: `Smoke-${runId}-anonymous-rpc` }),
      ),
    anonymousFunctionDenied("save_schedule"),
  ],
  // The refused save carried a label of this pattern: a refusal that stored a schedule anyway would show up here.
  [
    `${planner.label}: schedules read finds no schedule left by the rpc call of ${anonymous.label}`,
    async () =>
      schedulesTable("GET", {
        token: await accessToken(planner),
        query: `?label=like.Smoke-${runId}-anonymous-rpc*`,
      }),
    { status: 200, check: isEmptyList, describe: "an empty list" },
  ],
  ...notPlannerScheduleSteps(employee),
  ...notPlannerScheduleSteps(noRole),
  // The child rows are the one thing a planner may delete directly; a single cell goes, the rest stays.
  [
    `${planner.label}: schedule_staffing delete removes one cell`,
    async () =>
      scheduleStaffingTable("DELETE", {
        token: await accessToken(planner),
        query: `${smokeScheduleChildren()}&shift_id=eq.${sameNameShiftId}&day_offset=eq.6`,
      }),
    { statusClass: 2 },
  ],
  ...plannerReadsSchedule(
    "shows the schedule without the deleted cell",
    trimmedSchedule,
    "the replaced schedule without the cell of the second shift on day 6",
  ),
  // The view the schedule list reads (see isScheduleSummary): the counts of four schedules whose numbers differ, the order and
  // the limit the list asks for, and the refusal of every write to it. The schedules of the three groups of steps above
  // are in their final state here (the replaced one has just lost its cell on day 6).
  [
    `${planner.label}: schedules insert returns a schedule without cells and people`,
    async () => {
      const result = await schedulesTable("POST", {
        token: await accessToken(planner),
        body: { start_date: emptyScheduleStartDate, label: emptyScheduleLabel },
        prefer: "return=representation",
      });
      emptyScheduleId = parseJson(result.body)?.[0]?.id;
      return result;
    },
    {
      status: 201,
      check: (rows) =>
        Array.isArray(rows) && rows.length === 1 && isUuidText(rows[0].id) && rows[0].label === emptyScheduleLabel,
      describe: "the inserted schedule, echoed back",
    },
  ],
  plannerReadsSummary(
    "shows the schedule of the database steps with 1 person and a total of 6",
    () => smokeScheduleId,
    () => ({
      startDate: trimmedSchedule().startDate,
      label: trimmedSchedule().label,
      employeeCount: 1,
      totalRequired: 6,
    }),
    "the schedule saved through the function: 1 person, 2 + 4 required",
  ),
  plannerReadsSummary(
    "shows the schedule of the API steps with 2 people and a total of 8",
    () => apiScheduleId,
    () => ({
      startDate: changedApiSchedule().startDate,
      label: changedApiSchedule().label,
      employeeCount: 2,
      totalRequired: 8,
    }),
    "the schedule saved through the API: 2 people, 5 + 1 + 2 required",
  ),
  plannerReadsSummary(
    "shows the schedule of the assignment routes with 2 people and a total of 1",
    () => routeScheduleId,
    () => ({
      startDate: trimmedRouteSchedule().startDate,
      label: trimmedRouteSchedule().label,
      employeeCount: 2,
      totalRequired: 1,
    }),
    "the schedule of the assignment routes: 2 people, 1 required",
  ),
  plannerReadsSummary(
    "shows the schedule without cells and people with zeros",
    () => emptyScheduleId,
    () => ({ startDate: emptyScheduleStartDate, label: emptyScheduleLabel, employeeCount: 0, totalRequired: 0 }),
    "the schedule without cells and people: 0 people, 0 required",
  ),
  // The list asks for the newest first and a limit. The first step is the query of the list, over every schedule there is;
  // it relies on there being at least two of them, so that a limit of 2 must cut (this run alone has more, the schedules
  // of the rules and hours steps among them). The second keeps to the schedules of this run, where the order is known: it
  // relies on the two newest start dates being those of the schedule of the database steps and of the API schedule, both
  // 2026-11-15, the one created later (the database steps) before the one created earlier (the API schedule); every other
  // schedule of this run starts earlier (2026-11-11, 2026-11-10, 2026-11-09 and 2026-11-02; the two schedules of the absence
  // steps start on 2026-11-02 and 2026-11-10), so the limit cuts them off.
  [
    `${planner.label}: schedule_summaries read ordered newest first with a limit of 2 returns two rows`,
    async () =>
      scheduleSummariesTable("GET", {
        token: await accessToken(planner),
        query: "?order=start_date.desc,created_at.desc&limit=2",
      }),
    { status: 200, check: isNewestFirst(2), describe: "exactly two rows, each not newer than the one before it" },
  ],
  [
    `${planner.label}: schedule_summaries read of this run ordered newest first with a limit of 2 returns the two newest`,
    async () =>
      scheduleSummariesTable("GET", {
        token: await accessToken(planner),
        query: `?label=like.Smoke-${runId}-*&order=start_date.desc,created_at.desc&limit=2&select=id,start_date,created_at`,
      }),
    {
      status: 200,
      check: hasScheduleIds(() => [smokeScheduleId, apiScheduleId]),
      describe: "the schedule of the database steps, then the schedule of the API steps, and no other",
    },
  ],
  // Nothing writes to the view: select is the only privilege that signed-in users have on it. The planner passes every policy
  // of the tables under it and has insert and update on `schedules`, so a 403 that names the view is its missing grant. A
  // write that got through would show in the read of the labels below and in the row of the schedule it aims at.
  [
    `${planner.label}: schedule_summaries insert is refused`,
    async () =>
      scheduleSummariesTable("POST", {
        token: await accessToken(planner),
        body: { start_date: "2026-11-11", label: `${summaryWriteLabel}-insert` },
      }),
    viewDenied("schedule_summaries"),
  ],
  [
    `${planner.label}: schedule_summaries update is refused`,
    async () =>
      scheduleSummariesTable("PATCH", {
        token: await accessToken(planner),
        query: `?id=eq.${emptyScheduleId}`,
        body: { label: `${summaryWriteLabel}-update` },
      }),
    viewDenied("schedule_summaries"),
  ],
  [
    `${planner.label}: schedule_summaries delete is refused`,
    async () =>
      scheduleSummariesTable("DELETE", { token: await accessToken(planner), query: `?id=eq.${emptyScheduleId}` }),
    viewDenied("schedule_summaries"),
  ],
  [
    `${planner.label}: schedules read finds no schedule left by the refused writes to the view`,
    async () =>
      schedulesTable("GET", { token: await accessToken(planner), query: `?label=like.${summaryWriteLabel}*` }),
    { status: 200, check: isEmptyList, describe: "an empty list" },
  ],
  plannerReadsSummary(
    "still shows the schedule without cells and people after the refused writes",
    () => emptyScheduleId,
    () => ({ startDate: emptyScheduleStartDate, label: emptyScheduleLabel, employeeCount: 0, totalRequired: 0 }),
    "the schedule without cells and people, unchanged",
  ),
  // Absences (S-07): only a planner reads and changes them. A session writes the person, the type and the two days of a new
  // one and the type and the two days of an existing one, and never the status or the person of an existing one (the column
  // grants); the constraints hold even for the planner; and an absence goes with its employee. These steps send bearer
  // tokens straight to PostgREST, without the app. They use the employees of the steps above (see absenceScope), so they
  // come after them.
  plannerInsertsAbsences(
    "returns the absence of the row linked to the employee account",
    () => [ownAbsenceBody()],
    ([id]) => {
      ownAbsenceId = id;
    },
    "the vacation of that row, with the status approved that the column defaults to",
  ),
  plannerInsertsAbsences(
    "returns the absence of the row linked to the account without a role",
    () => [noRoleAbsenceBody()],
    ([id]) => {
      noRoleAbsenceId = id;
    },
    "the sick leave of that row, of one day",
  ),
  // No session may write a status, so the service role writes the one of a leave request that S-14 will bring.
  serviceRoleInsertsAbsences(
    "writes an absence with the status requested",
    () => [requestedAbsenceBody()],
    ([id]) => {
      requestedAbsenceId = id;
    },
    "the absence of the roster employee, with the status requested",
  ),
  plannerInsertsAbsences(
    "returns the absence that the update and delete steps work on",
    () => [crudAbsenceBody()],
    ([id]) => {
      crudAbsenceId = id;
    },
    "the vacation of the first API employee",
  ),
  plannerReadsAbsences(
    "shows the four absences, the one of the service role with the status requested",
    insertedAbsences,
    "the four absences as inserted",
  ),
  // The update changes the three columns it has a grant on and only the row it names; the other three rows are the proof.
  [
    `${planner.label}: absences update changes the type and the days`,
    async () =>
      absencesTable("PATCH", {
        token: await accessToken(planner),
        query: `?id=eq.${crudAbsenceId}`,
        body: crudAbsenceChanges,
        prefer: asksForChangedRows,
      }),
    {
      status: 200,
      check: isAbsences(() => [changedCrudAbsence()]),
      describe: "exactly the changed absence, with the same person and the same status",
    },
  ],
  plannerReadsAbsences(
    "shows the changed absence and the three others as they were",
    changedAbsences,
    "the fourth absence with its new type and days next to the three untouched ones",
  ),
  // No grant on the status or on the person of an existing absence, and none on the status of a new one.
  plannerWriteIsDeniedOnAbsences("update of the status", "PATCH", () => ({
    query: `?id=eq.${crudAbsenceId}`,
    body: { status: "rejected" },
  })),
  plannerWriteIsDeniedOnAbsences("update of the person", "PATCH", () => ({
    query: `?id=eq.${crudAbsenceId}`,
    body: { employee_id: smokeEmployeeId },
  })),
  plannerWriteIsDeniedOnAbsences("insert with a status", "POST", () => ({
    body: { ...crudAbsenceBody(), start_date: "2090-07-06", end_date: "2090-07-07", status: "requested" },
  })),
  plannerReadsAbsences(
    "is unchanged after the refused writes of the status and the person",
    changedAbsences,
    "the four absences, unchanged",
  ),
  // The date bounds are checked on each day of the absence: a start before 2020, an end after 2099 and a start after 2099
  // each break the same constraint, and none of them breaks the one about the order of the days.
  plannerRejectsAbsence(
    "with a start date of 2019-12-31",
    () => ({ ...crudAbsenceBody(), start_date: "2019-12-31", end_date: "2020-01-02" }),
    "absences_dates_valid",
  ),
  plannerRejectsAbsence(
    "with an end date of 2100-01-01",
    () => ({ ...crudAbsenceBody(), start_date: "2099-12-30", end_date: "2100-01-01" }),
    "absences_dates_valid",
  ),
  plannerRejectsAbsence(
    "with a start date of 2100-01-01",
    () => ({ ...crudAbsenceBody(), start_date: "2100-01-01", end_date: "2100-01-01" }),
    "absences_dates_valid",
  ),
  plannerRejectsAbsence(
    "with an end date before the start date",
    () => ({ ...crudAbsenceBody(), start_date: "2090-05-12", end_date: "2090-05-11" }),
    "absences_range_valid",
  ),
  plannerRejectsAbsence(
    "with a type that is not on the list",
    () => ({ ...crudAbsenceBody(), type: "holiday" }),
    "absences_type_valid",
  ),
  [
    `${planner.label}: absences insert with a date that does not exist is rejected`,
    async () =>
      absencesTable("POST", {
        token: await accessToken(planner),
        body: { ...crudAbsenceBody(), start_date: "2090-02-30", end_date: "2090-03-02" },
      }),
    {
      statusNotClass: 2,
      check: isImpossibleDate,
      describe: "an error with the code 22008 (date/time field value out of range)",
    },
  ],
  [
    `${planner.label}: absences insert for an employee that does not exist is rejected`,
    async () =>
      absencesTable("POST", {
        token: await accessToken(planner),
        body: { ...crudAbsenceBody(), employee_id: unknownEmployeeId },
      }),
    {
      statusNotClass: 2,
      check: isForeignKeyViolation("absences_employee_id_fkey"),
      describe: "an error with the code 23503 naming absences_employee_id_fkey",
    },
  ],
  // The session has no grant on the status, so the check of the status can only be reached with the service-role key.
  [
    "service role: absences insert with a status that is not on the list is rejected",
    () => absencesTable("POST", { key: SUPABASE_SERVICE_ROLE_KEY, body: { ...crudAbsenceBody(), status: "pending" } }),
    {
      statusNotClass: 2,
      check: isCheckViolation("absences_status_valid"),
      describe: "an error with the code 23514 naming absences_status_valid",
    },
  ],
  // The other side of the date bounds: the earliest and the latest day are allowed, so the constraint is not one day too
  // narrow at either end. The absence is removed again at once, with the planner's delete.
  plannerInsertsAbsences(
    "from 2020-01-01 to 2099-12-31 is accepted",
    () => [boundaryAbsenceBody()],
    ([id]) => {
      boundaryAbsenceId = id;
    },
    "the absence that spans the whole range the table allows",
  ),
  [
    `${planner.label}: absences delete removes the absence of the widest range`,
    async () =>
      absencesTable("DELETE", {
        token: await accessToken(planner),
        query: `?id=eq.${boundaryAbsenceId}`,
        prefer: asksForChangedRows,
      }),
    {
      status: 200,
      check: isAbsencesLike(() => [boundaryAbsenceBody()]),
      describe: "exactly the absence that was removed",
    },
  ],
  plannerReadsAbsences(
    "is unchanged after the rejected inserts",
    changedAbsences,
    "the four absences, unchanged, with nothing left by the rejected inserts",
  ),
  ...notPlannerAbsenceSteps(employee, () => ownEmployeeId),
  ...notPlannerAbsenceSteps(noRole, () => noRoleEmployeeId),
  ...anonymousAbsenceSteps,
  // The planner removes the changed absence: the delete names one row, and its three neighbours stay. A second delete of the
  // same row finds nothing and answers without an error (the route of S-07 treats it the same way).
  [
    `${planner.label}: absences delete removes the absence`,
    async () =>
      absencesTable("DELETE", {
        token: await accessToken(planner),
        query: `?id=eq.${crudAbsenceId}`,
        prefer: asksForChangedRows,
      }),
    {
      status: 200,
      check: isAbsences(() => [changedCrudAbsence()]),
      describe: "exactly the absence that was removed",
    },
  ],
  [
    `${planner.label}: absences delete of the same absence again removes no row`,
    async () =>
      absencesTable("DELETE", {
        token: await accessToken(planner),
        query: `?id=eq.${crudAbsenceId}`,
        prefer: asksForChangedRows,
      }),
    { status: 200, check: isEmptyList, describe: "an empty list: there is nothing left to remove" },
  ],
  plannerReadsAbsences(
    "shows the three others after the delete",
    remainingAbsences,
    "the three absences that were not deleted",
  ),
  // The cascade: an absence goes with its employee. The employee here is in no schedule, so the service role may delete it.
  [
    `${planner.label}: employees insert returns the employee of the cascade steps`,
    async () => {
      const result = await employeesTable("POST", {
        token: await accessToken(planner),
        body: absenceCascadeEmployee,
        prefer: "return=representation",
      });
      absenceCascadeEmployeeId = parseJson(result.body)?.[0]?.id;
      return result;
    },
    { status: 201, check: isInsertedEmployee(absenceCascadeEmployee), describe: "the inserted employee, echoed back" },
  ],
  serviceRoleInsertsAbsences(
    "writes a rejected and an approved absence for that employee",
    cascadeAbsenceBodies,
    (ids) => {
      cascadeAbsenceIds = ids;
    },
    "the two absences of the employee of the cascade steps, with the statuses rejected and approved",
  ),
  [
    `${planner.label}: absences read shows the rejected and the approved absence of that employee`,
    async () =>
      absencesTable("GET", {
        token: await accessToken(planner),
        query: `?employee_id=eq.${absenceCascadeEmployeeId}`,
      }),
    {
      status: 200,
      check: isAbsencesLike(cascadeAbsenceBodies),
      describe: "exactly the two absences of that employee, the rejected one among them",
    },
  ],
  [
    "service role: employees delete removes the employee of the cascade steps",
    () => employeesTable("DELETE", { key: SUPABASE_SERVICE_ROLE_KEY, query: `?id=eq.${absenceCascadeEmployeeId}` }),
    { statusClass: 2 },
  ],
  [
    "service role: absences read finds no absence of the deleted employee",
    () => absencesTable("GET", { key: SUPABASE_SERVICE_ROLE_KEY, query: `?id=in.(${cascadeAbsenceIds.join(",")})` }),
    { status: 200, check: isEmptyList, describe: "an empty list: the cascade removed both absences" },
  ],
  plannerReadsAbsences(
    "keeps the absences of the other people after the cascade",
    remainingAbsences,
    "the three absences of the other people, untouched",
  ),

  // Assignments: a planner puts people on the cells of a schedule, and the database keeps the rules of the table. The cell
  // and the person must belong to the schedule (composite foreign keys), the source is manual or generated, an entry is
  // never updated, and nobody but a planner sees or changes one. A save of the schedule changes only the difference: it
  // keeps the assignments of every cell and person that stays, and it takes those of a removed cell or person along only
  // when the caller confirms (PT409 otherwise, with nothing changed). These steps use a schedule of their own (see
  // assignState), after the shifts and people above.
  [
    `${planner.label}: rpc save_schedule creates the schedule for the assignment steps`,
    async () => {
      const result = await rpc("save_schedule", await accessToken(planner), saveScheduleArgs(createdAssignSchedule()));
      assignScheduleId = parseJson(result.body);
      return result;
    },
    { status: 200, check: isUuidText, describe: "the id of the new schedule" },
  ],
  ...plannerReadsAssignSchedule(
    "shows the new schedule without assignments",
    createdAssignSchedule,
    () => [],
    "the new assignment schedule (4 cells, 2 people, no assignments)",
  ),
  // The function has six parameters and no defaults; the signature of five was dropped, so a call of the old shape finds
  // no function (PostgREST: PGRST202) and, above all, creates nothing.
  [
    `${planner.label}: rpc save_schedule with the five arguments of the old signature is rejected`,
    async () => rpc("save_schedule", await accessToken(planner), oldSignatureArgs()),
    {
      statusNotClass: 2,
      check: (error) => error.code === "PGRST202",
      describe: "an error with the code PGRST202 (no such function)",
    },
  ],
  [
    `${planner.label}: schedules read finds no schedule left by the old signature`,
    async () =>
      schedulesTable("GET", { token: await accessToken(planner), query: `?label=like.${assignScheduleLabel}-old*` }),
    { status: 200, check: isEmptyList, describe: "an empty list" },
  ],
  [
    `${planner.label}: schedule_assignments insert adds an assignment`,
    async () =>
      assignmentsTable("POST", { token: await accessToken(planner), body: assignmentRow(firstAssignment()[0]) }),
    { status: 201 },
  ],
  plannerReadsAssignments("shows the new assignment with source manual", firstAssignment, "the assignment just added"),
  plannerRejectsScheduleRow(
    "schedule_assignments",
    "with a repeated primary key",
    () => assignmentRow(firstAssignment()[0]),
    "schedule_assignments_pkey",
  ),
  plannerRejectsScheduleRow(
    "schedule_assignments",
    "in a cell without staffing",
    assignmentInCellWithoutStaffing,
    "schedule_assignments_cell_fkey",
  ),
  plannerRejectsScheduleRow(
    "schedule_assignments",
    "for a person outside the roster",
    assignmentOfPersonOutsideRoster,
    "schedule_assignments_employee_fkey",
  ),
  plannerRejectsScheduleRow(
    "schedule_assignments",
    "with a source of bogus",
    assignmentWithBogusSource,
    "schedule_assignments_source_valid",
  ),
  plannerReadsAssignments("is unchanged after the rejected inserts", firstAssignment, "the assignment just added"),
  // No update grant at all: even a value that the source constraint would accept is refused, with a permission error.
  [
    `${planner.label}: schedule_assignments update is refused`,
    async () =>
      assignmentsTable("PATCH", {
        token: await accessToken(planner),
        query: assignmentFilter(firstAssignment()[0]),
        body: { source: "generated" },
      }),
    { statusNotClass: 2, check: isPermissionDenied, describe: "a permission error (42501)" },
  ],
  plannerReadsAssignments(
    "is unchanged after the update attempt",
    firstAssignment,
    "the assignment just added, still with source manual",
  ),
  [
    `${planner.label}: schedule_assignments insert adds five more in one request`,
    async () =>
      assignmentsTable("POST", {
        token: await accessToken(planner),
        body: otherAssignments().map((assignment) => assignmentRow(assignment)),
      }),
    { status: 201 },
  ],
  plannerReadsAssignments("shows all six assignments", allAssignments, "the six assignments"),
  ...notPlannerAssignmentSteps(employee),
  ...notPlannerAssignmentSteps(noRole),
  ...anonymousAssignmentSteps,
  // A save that changes the schedule but removes nothing needs no confirmation and keeps every assignment, also those of
  // a cell whose count it sets: the cell keeps its row, so nothing cascades.
  plannerSavesAssignSchedule(
    "changing only the label keeps every assignment",
    renamedAssignSchedule,
    savesAssignSchedule,
  ),
  ...plannerReadsAssignSchedule(
    "shows the new label and all six assignments",
    renamedAssignSchedule,
    allAssignments,
    "the renamed assignment schedule",
  ),
  plannerSavesAssignSchedule(
    "changing a required count and adding a cell keeps every assignment",
    recountedAssignSchedule,
    savesAssignSchedule,
  ),
  ...plannerReadsAssignSchedule(
    "shows the new count, the new cell and all six assignments",
    recountedAssignSchedule,
    allAssignments,
    "the assignment schedule with cell A at 1 (two people in it) and cell E added",
  ),
  // The same column grant, used directly: the planner may set a required count, and nothing else of a cell.
  [
    `${planner.label}: schedule_staffing update changes the required count of a cell`,
    async () =>
      scheduleStaffingTable("PATCH", {
        token: await accessToken(planner),
        query: cellFilter("B"),
        body: { required_count: 4 },
      }),
    { statusClass: 2 },
  ],
  ...plannerReadsAssignSchedule(
    "shows the count set directly and all six assignments",
    patchedAssignSchedule,
    allAssignments,
    "the assignment schedule with cell B at 4",
  ),
  [
    `${planner.label}: schedule_staffing update of the shift is refused`,
    async () =>
      scheduleStaffingTable("PATCH", {
        token: await accessToken(planner),
        query: cellFilter("B"),
        body: { shift_id: sameNameShiftId },
      }),
    { statusNotClass: 2, check: isPermissionDenied, describe: "a permission error (42501)" },
  ],
  ...plannerReadsAssignSchedule(
    "is unchanged after the refused update of the shift",
    patchedAssignSchedule,
    allAssignments,
    "the assignment schedule, unchanged",
  ),
  // Removing a cell or a person that holds assignments: refused without a confirmation, with the count in the error and
  // nothing changed (the label of the refused save included), then done with it, as the planner, and only those
  // assignments go. Cell A holds two assignments, the API employee three of the four that are left after it, and a save
  // that drops cell B and the API employee together touches four (not five: an assignment is counted once).
  plannerSavesAssignSchedule(
    "dropping a cell with assignments is refused without a confirmation",
    refusedCellAssignSchedule,
    refusesRemovalOf(2),
  ),
  ...plannerReadsAssignSchedule(
    "is unchanged after the refused removal of a cell",
    patchedAssignSchedule,
    allAssignments,
    "the assignment schedule, unchanged, with the label of before the refused save",
  ),
  plannerSavesAssignSchedule(
    "dropping the cell with a confirmation removes its assignments",
    withoutCellAssignSchedule,
    savesAssignSchedule,
    true,
  ),
  ...plannerReadsAssignSchedule(
    "shows the schedule without cell A and the two assignments in it",
    withoutCellAssignSchedule,
    assignmentsWithoutCellA,
    "the assignment schedule without cell A, and four assignments (those of the other cells stay)",
  ),
  plannerSavesAssignSchedule(
    "dropping a person with assignments is refused without a confirmation",
    refusedPersonAssignSchedule,
    refusesRemovalOf(3),
  ),
  ...plannerReadsAssignSchedule(
    "is unchanged after the refused removal of a person",
    withoutCellAssignSchedule,
    assignmentsWithoutCellA,
    "the assignment schedule, unchanged, with the label of before the refused save",
  ),
  plannerSavesAssignSchedule(
    "dropping a cell and a person is refused when the confirmation is null, and counts each assignment once",
    refusedBothAssignSchedule,
    refusesRemovalOf(4),
    null,
  ),
  ...plannerReadsAssignSchedule(
    "is unchanged after the refused removal of a cell and a person",
    withoutCellAssignSchedule,
    assignmentsWithoutCellA,
    "the assignment schedule, unchanged, with the label of before the refused save",
  ),
  plannerSavesAssignSchedule(
    "dropping the person with a confirmation removes their assignments",
    withoutPersonAssignSchedule,
    savesAssignSchedule,
    true,
  ),
  ...plannerReadsAssignSchedule(
    "shows the schedule without the API employee and the three assignments of that person",
    withoutPersonAssignSchedule,
    assignmentsOfSmokeEmployeeOnly,
    "the assignment schedule with one person, and one assignment (the other person's assignments are gone)",
  ),
  // The foreign keys are on delete restrict: no shift or employee that a schedule uses can be removed, not even with the
  // service-role key. The planner's reads show that the rows are still there.
  [
    "service role: delete of a shift used by a schedule is rejected",
    () => shiftsTable("DELETE", { key: SUPABASE_SERVICE_ROLE_KEY, query: smokeShiftRow() }),
    {
      statusNotClass: 2,
      check: violates("schedule_staffing_shift_id_fkey"),
      describe: "an error naming schedule_staffing_shift_id_fkey",
    },
  ],
  plannerReadsShifts(
    "shifts rows still exist after the service role delete attempt",
    patchedShift,
    "both smoke shifts, the first one ending at minute 420",
  ),
  [
    "service role: delete of an employee used by a schedule is rejected",
    () => employeesTable("DELETE", { key: SUPABASE_SERVICE_ROLE_KEY, query: smokeRow() }),
    {
      statusNotClass: 2,
      check: violates("schedule_employees_employee_id_fkey"),
      describe: "an error naming schedule_employees_employee_id_fkey",
    },
  ],
  plannerReadsEmployee(
    "employees row still exists after the service role delete attempt",
    patchedFte,
    "the smoke employee with FTE 3/4",
  ),

  // Mail templates: each link goes to the app's set-password page with the token hash and the type of its mail.
  [
    "templates: invite.html links to /auth/set-password with type=invite",
    () => readTemplate("invite.html"),
    { status: 200, bodyIncludes: "{{ .SiteURL }}/auth/set-password?token_hash={{ .TokenHash }}&type=invite" },
  ],
  [
    "templates: recovery.html links to /auth/set-password with type=recovery",
    () => readTemplate("recovery.html"),
    { status: 200, bodyIncludes: "{{ .SiteURL }}/auth/set-password?token_hash={{ .TokenHash }}&type=recovery" },
  ],

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

  ...approvalDatabaseSteps,
  ...approvalRouteSteps,
  ...generationRouteSteps,

  // Always last: removes every account and row this and earlier runs left behind (the tables have no delete grant for the
  // API, so only the service-role key can), which keeps the next run from ending in a 409 and the app's lists as they
  // were before. The schedules go first: their foreign keys to shifts and employees are on delete restrict, and deleting
  // a schedule cascades to its cells, people and assignments. The accounts go next: a row linked to one only loses its
  // user_id, and the employee steps after them delete it. The absences have no name to match, so they go with their
  // employees (on delete cascade). The shifts go last, once no schedule refers to them.
  [
    "service role: delete the smoke schedules",
    () => schedulesTable("DELETE", { key: SUPABASE_SERVICE_ROLE_KEY, query: "?label=like.Smoke-*" }),
    { statusClass: 2 },
  ],
  // The approved schedules had records and snapshots, which only the cascade from a schedule can have removed.
  ...APPROVAL_TABLES.map((table) => [
    `service role: no row of ${table} is left for the approved smoke schedules`,
    () =>
      restTable(table, "GET", {
        key: SUPABASE_SERVICE_ROLE_KEY,
        query: `?schedule_id=in.(${approvalScheduleId},${approveRouteScheduleId},${generateScheduleId})`,
      }),
    { status: 200, check: isEmptyList, describe: "an empty list" },
  ]),
  // The assignment schedule still held an assignment, which only the cascade through its cell and its person can have
  // removed.
  [
    "service role: no assignment of the smoke schedule is left",
    () => assignmentsTable("GET", { key: SUPABASE_SERVICE_ROLE_KEY, query: assignScheduleChildren() }),
    { status: 200, check: isEmptyList, describe: "an empty list" },
  ],
  ["service role: delete the smoke accounts", deleteSmokeAccounts, { statusClass: 2 }],
  [
    "service role: delete the smoke employees",
    () => employeesTable("DELETE", { key: SUPABASE_SERVICE_ROLE_KEY, query: "?email=like.smoke-*" }),
    { statusClass: 2 },
  ],
  // Many absences of the run still existed until the employees went (the others were removed by the steps themselves and
  // are asked for as well, which does no harm), so only the cascade can have removed those: the three of the database steps,
  // the neighbour and the two rows with a status of the route and page steps, and the nine of the absence schedules that the
  // neighbour steps left (the requested and the rejected ones among them).
  [
    "service role: no absence of the smoke employees is left",
    () => absencesTable("GET", { key: SUPABASE_SERVICE_ROLE_KEY, query: `?id=in.(${absenceIdsOfTheRun().join(",")})` }),
    { status: 200, check: isEmptyList, describe: "an empty list: the cascade removed every absence of the run" },
  ],
  // An employee without an e-mail has no address to match the step above, so it goes by its last name.
  [
    "service role: delete the smoke employees without an e-mail",
    () => employeesTable("DELETE", { key: SUPABASE_SERVICE_ROLE_KEY, query: "?email=is.null&last_name=like.Smoke-*" }),
    { statusClass: 2 },
  ],
  [
    "service role: delete the smoke shifts",
    () => shiftsTable("DELETE", { key: SUPABASE_SERVICE_ROLE_KEY, query: "?name=like.Smoke-*" }),
    { statusClass: 2 },
  ],
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
    (expected.cacheControl === undefined || actual.cacheControl.includes(expected.cacheControl)) &&
    (expected.referrerPolicy === undefined || actual.referrerPolicy === expected.referrerPolicy) &&
    (expected.setsCookie === undefined || actual.setCookies.some((name) => name.includes(expected.setsCookie))) &&
    (expected.bodyIncludes === undefined || actual.body.includes(expected.bodyIncludes)) &&
    (expected.bodyExcludes === undefined || !actual.body.includes(expected.bodyExcludes)) &&
    (expected.json === undefined || parseJson(actual.body) === expected.json) &&
    (expected.check === undefined || passes(expected.check, parseJson(actual.body))) &&
    (expected.bodyCheck === undefined || passes(expected.bodyCheck, actual.body));
  const seen = [actual.status, actual.location, expected.contentType === undefined ? "" : actual.contentType];
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  -> ${seen.join(" ").trim()}`);
  if (!ok) {
    failed++;
    const wanted = [
      expected.status ?? (expected.statusClass === undefined ? "" : `${expected.statusClass}xx`),
      expected.statusNotClass === undefined ? "" : `anything but ${expected.statusNotClass}xx`,
      expected.location ?? expected.locationPrefix ?? "",
      expected.contentType ?? "",
      expected.cacheControl === undefined ? "" : `Cache-Control: ${expected.cacheControl}`,
      expected.referrerPolicy === undefined ? "" : `Referrer-Policy: ${expected.referrerPolicy}`,
      expected.setsCookie === undefined ? "" : `a Set-Cookie named *${expected.setsCookie}*`,
      expected.bodyIncludes === undefined ? "" : `a body with "${expected.bodyIncludes}"`,
      expected.bodyExcludes === undefined ? "" : `a body without "${expected.bodyExcludes}"`,
      expected.json === undefined ? "" : `a JSON body of ${JSON.stringify(expected.json)}`,
      expected.check === undefined ? "" : `a JSON body: ${expected.describe ?? "accepted by its check"}`,
      expected.bodyCheck === undefined ? "" : `a page that shows ${expected.describe ?? "what its bodyCheck accepts"}`,
    ];
    console.log(`      expected ${wanted.filter(Boolean).join(" ")}`);
    if (expected.json !== undefined || expected.check !== undefined) console.log(`      got ${actual.body}`);
    // A page is too long to print, so a page step names the part it looked at.
    if (expected.bodyCheck !== undefined && expected.excerpt !== undefined) {
      console.log(`      got ${excerptOf(expected.excerpt, actual.body)}`);
    }
    if (hint) console.log(`      ${hint}`);
  }
}

console.log(failed ? `\n${failed} step(s) failed` : "\nAll smoke steps passed");
process.exit(failed ? 1 : 0);
