// Smoke test: proves the built app, the Cloudflare adapter, the Supabase auth flow and the role gate still work together,
// that the database role helpers read the role from the token, that only planners can read and write the employees
// and shifts tables through PostgREST (an employee with a linked account reads only their own employee row, and no
// session writes the user_id, invited_at and activated_at columns), that the function mark_account_active records the
// activation of the caller's own row only (an account without a role, an anonymous caller and another employee change
// nothing, the first activation stays), that the employee and shift API routes keep to the role gate, the
// validation and their status codes, that the employee and shift pages open for the planner only, that the invitation
// mails link to the set-password page, the whole invitation flow (invite, invite again, password reset, a foreign
// account, the tokens from the admin API instead of the mails, the new employee's session, the activation time that
// the first password set records and a reset keeps, and the locked e-mail), what the pages of that flow show (the
// account column and invite button of the employee list, the locked e-mail field of the edit page, the password form
// of the set-password page; read from the HTML the server renders), and that public registration stays closed. Zero
// dependencies on purpose. It creates real accounts and removes its own accounts, employee rows and shift rows with the
// service-role key, so it only runs against a LOCAL Supabase, and the app under test must read the same stack
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

const plannerReadsEmployee = (name, changes, describe) => [
  `${planner.label}: ${name}`,
  async () => employeesTable("GET", { token: await accessToken(planner), query: smokeRow() }),
  { status: 200, check: isSmokeEmployee(changes), describe },
];

// A signed-in account without planner rights: the table looks empty and writes are refused or hidden. The planner's read
// afterwards is the proof that the row did not change, whatever status PostgREST used to answer.
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
    { statusNotClass: 2 },
  ],
  [
    `${actor.label}: employees update is refused or hidden`,
    async () =>
      employeesTable("PATCH", {
        token: await accessToken(actor),
        query: smokeRow(),
        body: { fte_numerator: 1, fte_denominator: 1 },
      }),
    { statusNotClass: 5 },
  ],
  [
    `${actor.label}: employees delete is rejected`,
    async () => employeesTable("DELETE", { token: await accessToken(actor), query: smokeRow() }),
    { statusNotClass: 2 },
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

// A signed-in account without planner rights: the table looks empty and writes are refused or hidden. The planner's
// read afterwards is the proof that the rows did not change, whatever status PostgREST used to answer.
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
    { statusNotClass: 2 },
  ],
  [
    `${actor.label}: shifts update is refused or hidden`,
    async () =>
      shiftsTable("PATCH", { token: await accessToken(actor), query: smokeShiftRow(), body: { end_minute: 600 } }),
    { statusNotClass: 5 },
  ],
  [
    `${actor.label}: shifts delete is rejected`,
    async () => shiftsTable("DELETE", { token: await accessToken(actor), query: smokeShiftRow() }),
    { statusNotClass: 2 },
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
// A missing column privilege is SQLSTATE 42501 (403 for a signed-in caller). The planner passes every policy of the
// table, so a refusal with this code can only come from the column grants.
const isPermissionDenied = (error) => error?.code === "42501";

const plannerReadsOwnRow = (name, changes, describe) => [
  `${planner.label}: ${name}`,
  async () => employeesTable("GET", { token: await accessToken(planner), query: ownRow() }),
  { status: 200, check: isOwnRow(changes), describe },
];

// The planner writes a column only the service role may write: refused with a permission error, whatever the value.
// `build` returns the query and body when the step runs, because the row id is only known by then.
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

const steps = [
  // Anonymous: the gate answers 401 (never a redirect), JSON for API paths.
  visit(anonymous, "/", 200),
  visit(anonymous, "/dashboard", 401),
  visit(anonymous, "/planner", 401),
  visit(anonymous, "/employees", 401),
  visit(anonymous, "/employees/new", 401),
  visit(anonymous, "/shifts", 401),
  visit(anonymous, "/shifts/new", 401),
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
  signOut(employee),
  visit(employee, "/dashboard", 401),

  // Planner: everything the gate lets through. The API and page steps use the session cookie, so they run while the
  // planner is signed in; the list comes after the create step, because it has to show the new employee.
  signIn(planner),
  visit(planner, "/dashboard", 200),
  visit(planner, "/planner", 200, "Pracownicy"),
  visit(planner, "/planner", 200, "Zmiany"),
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
    () => request(planner, "/api/employees", { method: "POST", json: secondApiEmployee }),
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
    () => request(planner, "/api/shifts", { method: "POST", json: secondApiShift }),
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
  [`${anonymous.label}: rpc is_planner is rejected`, () => rpc("is_planner"), { statusNotClass: 2 }],
  [`${anonymous.label}: rpc current_app_role is rejected`, () => rpc("current_app_role"), { statusNotClass: 2 }],

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
    { statusNotClass: 2 },
  ],
  plannerReadsEmployee(
    "employees row still exists after the delete attempt",
    patchedFte,
    "the smoke employee with FTE 3/4",
  ),
  ...notPlannerEmployeeSteps(employee),
  ...notPlannerEmployeeSteps(noRole),
  [`${anonymous.label}: employees read is rejected`, () => employeesTable("GET"), { statusNotClass: 2 }],

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
    `${employee.label}: employees update of its own row is refused or hidden`,
    async () =>
      employeesTable("PATCH", {
        token: await accessToken(employee),
        query: ownRow(),
        body: { first_name: "Smoke-Changed" },
      }),
    { statusNotClass: 5 },
  ],
  [
    `${employee.label}: employees insert is rejected although its account is linked`,
    async () =>
      employeesTable("POST", {
        token: await accessToken(employee),
        body: { ...ownEmployee, email: `smoke-${runId}-employee-insert@example.com` },
      }),
    { statusNotClass: 2 },
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
  // Refused or a no-op: the control read below decides, whatever status PostgREST answers with.
  [
    `${noRole.label}: rpc mark_account_active is refused or changes nothing`,
    async () => rpc("mark_account_active", await accessToken(noRole)),
    { statusNotClass: 5 },
  ],
  [`${anonymous.label}: rpc mark_account_active is rejected`, () => rpc("mark_account_active"), { statusNotClass: 2 }],
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
    { statusNotClass: 2 },
  ],
  plannerReadsShifts(
    "shifts rows still exist after the delete attempt",
    patchedShift,
    "both smoke shifts, the first one ending at minute 420",
  ),
  ...notPlannerShiftSteps(employee),
  ...notPlannerShiftSteps(noRole),
  [`${anonymous.label}: shifts read is rejected`, () => shiftsTable("GET"), { statusNotClass: 2 }],

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
  // were before. The accounts go first: a row linked to one only loses its user_id, and the next step deletes it.
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
      expected.bodyCheck === undefined ? "" : `a page with ${expected.describe ?? "what its bodyCheck accepts"}`,
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
