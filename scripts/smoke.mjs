// Smoke test: proves the built app, the Cloudflare adapter, the Supabase auth flow and the role gate still work together,
// that the database role helpers read the role from the token, that only planners can read and write the employees,
// shifts and schedules tables through PostgREST and save a schedule atomically through the save_schedule function, that
// the employee, shift and schedule API routes keep to the role gate, the validation and their status codes, that the
// employee, shift and schedule pages open for the planner only (the schedule list and form show what the database holds),
// and that public registration stays closed. Zero dependencies on
// purpose. It creates real accounts and removes its own employee, shift and schedule rows with the service-role key, so
// it only runs against a LOCAL Supabase, and the app under test must read the same stack (.env / .dev.vars). Values
// come from `supabase status -o env`.
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

const anonymous = { label: "anonymous", jar: new Map() };
const noRole = await createAccount("no-role", null);
const employee = await createAccount("employee", "employee");
const planner = await createAccount("planner", "planner");

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

// The named arguments of save_schedule for a state; an `id` of null creates a schedule, any other replaces that one.
const saveScheduleArgs = (state, id = null) => ({
  p_schedule_id: id,
  p_start_date: state.startDate,
  p_label: state.label,
  p_staffing: state.staffing,
  p_employee_ids: state.employeeIds,
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
};
const plannerRejectsScheduleRow = (table, description, body, constraint) => [
  `${planner.label}: ${table} insert ${description} is rejected`,
  async () => scheduleTables[table]("POST", { token: await accessToken(planner), body: body() }),
  { statusNotClass: 2, check: violates(constraint), describe: `an error naming ${constraint}` },
];

// A signed-in account without planner rights: the tables look empty, a save and the inserts are refused, and updates and
// deletes of the child rows are refused or hidden. The planner's reads afterwards are the proof that nothing changed,
// whatever status PostgREST used to answer. The children have no id column, hence select=schedule_id.
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
  [
    `${actor.label}: rpc save_schedule creating a schedule is rejected`,
    async () =>
      rpc(
        "save_schedule",
        await accessToken(actor),
        saveScheduleArgs({ ...createdSchedule(), label: `Smoke-${runId}-${actor.label}-rpc-create` }),
      ),
    { statusNotClass: 2 },
  ],
  [
    `${actor.label}: rpc save_schedule replacing the schedule is rejected`,
    async () =>
      rpc(
        "save_schedule",
        await accessToken(actor),
        saveScheduleArgs({ ...createdSchedule(), label: `Smoke-${runId}-${actor.label}-rpc-replace` }, smokeScheduleId),
      ),
    { statusNotClass: 2 },
  ],
  [
    `${actor.label}: schedules insert is rejected`,
    async () =>
      schedulesTable("POST", {
        token: await accessToken(actor),
        body: { start_date: "2026-11-11", label: `Smoke-${runId}-${actor.label}-insert` },
      }),
    { statusNotClass: 2 },
  ],
  [
    `${actor.label}: schedule_staffing insert is rejected`,
    async () =>
      scheduleStaffingTable("POST", {
        token: await accessToken(actor),
        body: { schedule_id: smokeScheduleId, shift_id: sameNameShiftId, day_offset: 3, required_count: 1 },
      }),
    { statusNotClass: 2 },
  ],
  [
    `${actor.label}: schedule_employees insert is rejected`,
    async () =>
      scheduleEmployeesTable("POST", {
        token: await accessToken(actor),
        body: { schedule_id: smokeScheduleId, employee_id: apiEmployeeId },
      }),
    { statusNotClass: 2 },
  ],
  [
    `${actor.label}: schedules update is refused or hidden`,
    async () =>
      schedulesTable("PATCH", {
        token: await accessToken(actor),
        query: smokeScheduleRow(),
        body: { start_date: "2026-12-01" },
      }),
    { statusNotClass: 5 },
  ],
  [
    `${actor.label}: schedules delete is rejected`,
    async () => schedulesTable("DELETE", { token: await accessToken(actor), query: smokeScheduleRow() }),
    { statusNotClass: 2 },
  ],
  [
    `${actor.label}: schedule_staffing delete is refused or hidden`,
    async () => scheduleStaffingTable("DELETE", { token: await accessToken(actor), query: smokeScheduleChildren() }),
    { statusNotClass: 5 },
  ],
  [
    `${actor.label}: schedule_employees delete is refused or hidden`,
    async () => scheduleEmployeesTable("DELETE", { token: await accessToken(actor), query: smokeScheduleChildren() }),
    { statusNotClass: 5 },
  ],
  ...plannerReadsSchedule(
    `is unchanged after ${actor.label} write attempts`,
    replacedSchedule,
    "the replaced schedule, unchanged",
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
// of creation and the edit link, whose aria-label names the period and the label.
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
    cells[5] === "Edytuj" &&
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
  [
    `${anonymous.label}: PUT /api/schedules/<id>`,
    () => request(anonymous, unknownScheduleUrl, { method: "PUT", json: deniedApiSchedule }),
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
  [
    `${noRole.label}: POST /api/schedules`,
    () => request(noRole, "/api/schedules", { method: "POST", json: deniedApiSchedule }),
    { status: 403, contentType: "application/json" },
  ],
  [
    `${noRole.label}: PUT /api/schedules/<id>`,
    () => request(noRole, unknownScheduleUrl, { method: "PUT", json: deniedApiSchedule }),
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
  visitChecked(
    planner,
    "/schedules",
    200,
    listsApiSchedule,
    "the API schedule: period 15.11-21.11.2026, label, 2 people, total 8, a creation date and the edit link",
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
  visitApiSchedulePage(planner, 200, { bodyIncludes: apiScheduleLabel, cacheControl: "no-store" }),
  visitApiSchedulePage(planner, 200, { bodyCheck: hasD6Notice, describe: "the D6 notice", cacheControl: "no-store" }),
  visitApiSchedulePage(planner, 200, {
    bodyCheck: editsApiSchedule,
    describe: "the date, label, cells and people of the API schedule as the form state",
    cacheControl: "no-store",
  }),
  visit(planner, `/schedules/${unknownScheduleId}`, 404, notFoundScheduleMessage),
  visit(planner, "/schedules/not-a-uuid", 404, notFoundScheduleMessage),
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
    { statusNotClass: 2 },
  ],
  ...plannerReadsSchedule(
    "still exists after the delete attempt",
    replacedSchedule,
    "the replaced schedule, unchanged",
  ),
  // Anonymous: no table, no function. The planner's reads after the signed-in accounts below cover these attempts too.
  [`${anonymous.label}: schedules read is rejected`, () => schedulesTable("GET"), { statusNotClass: 2 }],
  [`${anonymous.label}: schedule_staffing read is rejected`, () => scheduleStaffingTable("GET"), { statusNotClass: 2 }],
  [
    `${anonymous.label}: schedule_employees read is rejected`,
    () => scheduleEmployeesTable("GET"),
    { statusNotClass: 2 },
  ],
  [
    `${anonymous.label}: schedules insert is rejected`,
    () => schedulesTable("POST", { body: { start_date: "2026-11-11", label: `Smoke-${runId}-anonymous-insert` } }),
    { statusNotClass: 2 },
  ],
  [
    `${anonymous.label}: schedule_staffing insert is rejected`,
    () =>
      scheduleStaffingTable("POST", {
        body: { schedule_id: smokeScheduleId, shift_id: sameNameShiftId, day_offset: 3, required_count: 1 },
      }),
    { statusNotClass: 2 },
  ],
  [
    `${anonymous.label}: schedule_employees insert is rejected`,
    () => scheduleEmployeesTable("POST", { body: { schedule_id: smokeScheduleId, employee_id: apiEmployeeId } }),
    { statusNotClass: 2 },
  ],
  [
    `${anonymous.label}: rpc save_schedule is rejected`,
    () =>
      rpc(
        "save_schedule",
        undefined,
        saveScheduleArgs({ ...createdSchedule(), label: `Smoke-${runId}-anonymous-rpc` }),
      ),
    { statusNotClass: 2 },
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

  // Always last: removes every row this and earlier runs left behind (the tables have no delete grant for the API, so
  // only the service-role key can), which keeps the next run from ending in a 409 and the app's lists as they were
  // before. The schedules go first: their foreign keys to shifts and employees are on delete restrict, and deleting a
  // schedule cascades to its cells and people.
  [
    "service role: delete the smoke schedules",
    () => schedulesTable("DELETE", { key: SUPABASE_SERVICE_ROLE_KEY, query: "?label=like.Smoke-*" }),
    { statusClass: 2 },
  ],
  [
    "service role: delete the smoke employees",
    () => employeesTable("DELETE", { key: SUPABASE_SERVICE_ROLE_KEY, query: "?email=like.smoke-*" }),
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
      expected.bodyIncludes === undefined ? "" : `a body with "${expected.bodyIncludes}"`,
      expected.bodyExcludes === undefined ? "" : `a body without "${expected.bodyExcludes}"`,
      expected.json === undefined ? "" : `a JSON body of ${JSON.stringify(expected.json)}`,
      expected.check === undefined ? "" : `a JSON body: ${expected.describe ?? "accepted by its check"}`,
      expected.bodyCheck === undefined ? "" : `a page that shows ${expected.describe ?? "what its check accepts"}`,
    ];
    console.log(`      expected ${wanted.filter(Boolean).join(" ")}`);
    if (expected.json !== undefined || expected.check !== undefined) console.log(`      got ${actual.body}`);
    if (hint) console.log(`      ${hint}`);
  }
}

console.log(failed ? `\n${failed} step(s) failed` : "\nAll smoke steps passed");
process.exit(failed ? 1 : 0);
