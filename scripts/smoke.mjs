// Smoke test: proves the built app, the Cloudflare adapter, the Supabase auth flow and the role gate still work together,
// that the database role helpers read the role from the token, that only planners can read and write the employees,
// shifts and schedules tables through PostgREST (an employee with a linked account reads only their own employee row,
// and no session writes the user_id, invited_at and activated_at columns; the refusals of the database name their cause,
// the status with the SQLSTATE and the message, so a missing table or a mistyped argument does not pass for one), that a
// schedule is saved atomically through the save_schedule function (a save changes only the difference, so it keeps the
// assignments of what stays and refuses to drop those of a removed cell or person without a confirmation), that an
// assignment keeps to its foreign keys and constraints and only a planner reads and changes it, that the function
// mark_account_active records the activation of the caller's own row only (an account without a role, an anonymous
// caller and another employee change nothing, the first activation stays), that the employee, shift and schedule API
// routes keep to the role gate, the validation and their status codes (the routes that add and remove one assignment of
// a schedule are idempotent, and the save of a schedule answers 409 with the number of assignments it would remove until
// the body confirms the removal), that the view behind the schedule list counts the people and the required staffing of
// each schedule, hides them from everyone but a planner and takes no write, that the employee, shift and schedule pages
// open for the planner only (the schedule list, form and assignment page show what the database holds, down to which
// shift button of which person is on, and the pages that list employees for the schedule form and the assignment grid
// carry no e-mail address), that the invitation mails link to the set-password page, the whole invitation flow (invite,
// invite again, password reset, a foreign account, the tokens from the admin API instead of the mails, the new
// employee's session, the activation time that the first password set records and a reset keeps, and the locked
// e-mail), what the pages of that flow show (the account column and invite button of the employee list, the locked
// e-mail field of the edit page, the password form of the set-password page; read from the HTML the server renders),
// and that public registration stays closed. Zero dependencies on purpose. It creates real accounts and removes its own
// accounts, employee, shift and schedule rows with the service-role key, so it only runs against a LOCAL Supabase, and
// the app under test must read the same stack (.env / .dev.vars), including SUPABASE_SERVICE_ROLE_KEY: the invitation
// route reads it from there. Values come from `supabase status -o env`.
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
const SUMMARY_COLUMNS = ["created_at", "employee_count", "id", "label", "start_date", "total_required"];
// Exactly one row for the schedule, with exactly the six columns of the view; the counts are numbers, compared strictly.
const isScheduleSummary = (id, expected) => (rows) =>
  Array.isArray(rows) &&
  rows.length === 1 &&
  sameItems(Object.keys(rows[0]), SUMMARY_COLUMNS) &&
  rows[0].id === id() &&
  typeof rows[0].created_at === "string" &&
  rows[0].start_date === expected().startDate &&
  rows[0].label === expected().label &&
  rows[0].employee_count === expected().employeeCount &&
  rows[0].total_required === expected().totalRequired;
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
    describe: `one row with the six columns of the view, for ${what}`,
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
    cells.length === 6 &&
    cells[0] === apiSchedulePeriod &&
    cells[1] === apiScheduleLabel &&
    cells[2] === String(state.employeeIds.length) &&
    cells[3] === String(state.staffing.reduce((sum, cell) => sum + cell.requiredCount, 0)) &&
    /^\d{2}\.\d{2}\.\d{4}$/.test(cells[4]) &&
    // The links are separate elements: removing their tags may leave a space or nothing between the two words.
    /^Edytuj\s*Obsadź$/.test(cells[5]) &&
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
// witness). Its island is rendered on the server, so the table of people and the coverage summary are in the HTML. A
// person's row is found by the text of its row header, never by a name anywhere in the page: Astro also writes the
// props of the island, names included, into the astro-island tag, and that proves nothing about a row. A shift button
// counts only as the pair of its aria-label (person, day, shift with its hours) and its aria-pressed in one tag.
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

// The island holds two tables: the people's table, then the section of the coverage summary, so the HTML is cut at
// the section. The body rows of a table come back as { header, cells }: the text of the row header (<th scope="row">)
// and each <td> element whole.
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
// have: `byDay` maps a day offset to its buttons.
const pressedButton = (label, pressed) => `${label} [aria-pressed=${pressed}]`;
const buttonsOfCell = (cell) =>
  tagsOf(cell, "button")
    .filter((tag) => hasAttribute(tag, "aria-pressed"))
    .map((tag) => pressedButton(attributeOf(tag, "aria-label"), attributeOf(tag, "aria-pressed")));
const byPerson = (a, b) => a.person.localeCompare(b.person);
const gridOf = (html) =>
  bodyRowsOf(cutAtCoverage(html)[0])
    .map(({ header, cells }) => ({ person: header, days: cells.map(buttonsOfCell) }))
    .sort(byPerson);
const personRow = (person, byDay) => ({ person, days: Array.from({ length: 7 }, (_unused, day) => byDay[day] ?? []) });
const showsGrid = (expected) => (html) => JSON.stringify(gridOf(html)) === JSON.stringify([...expected].sort(byPerson));
const gridExcerpt = (html) =>
  gridOf(html)
    .map(({ person, days }) => `${person}: ${JSON.stringify(days)}`)
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
  [
    `${noRole.label}: POST /api/schedules`,
    () => request(noRole, "/api/schedules", { method: "POST", json: deniedApiSchedule }),
    { status: 403, contentType: "application/json" },
  ],
  ...deniedAssignmentCalls(noRole, 403, "forbidden"),
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
  ...plannerDeletesRouteAssignment(
    "of the assignment of cell C of the second person takes the excess away",
    routeAssignmentsUrl,
    () => routeAssignment("C", secondApiEmployeeId),
    routeWitness,
    "the witness alone (cell C of the first person)",
  ),
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
  // The list asks for the newest first and a limit; four schedules of this run exist, so a limit of 2 must cut. The first step
  // is the query of the list, over every schedule there is; the second keeps to the schedules of this run, where the order is
  // known: the two of 2026-11-15 come first, the one created later (the schedule of the database steps) before the one
  // created earlier (the API schedule), and the schedules of 2026-11-11 and 2026-11-09 are cut off.
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

  // Always last: removes every account and row this and earlier runs left behind (the tables have no delete grant for the
  // API, so only the service-role key can), which keeps the next run from ending in a 409 and the app's lists as they
  // were before. The schedules go first: their foreign keys to shifts and employees are on delete restrict, and deleting
  // a schedule cascades to its cells, people and assignments. The accounts go next: a row linked to one only loses its
  // user_id, and the employee steps after them delete it. The shifts go last, once no schedule refers to them.
  [
    "service role: delete the smoke schedules",
    () => schedulesTable("DELETE", { key: SUPABASE_SERVICE_ROLE_KEY, query: "?label=like.Smoke-*" }),
    { statusClass: 2 },
  ],
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
