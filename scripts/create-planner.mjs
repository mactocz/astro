// Creates the first planner on a Supabase project, or promotes an existing account to planner, through the admin API.
// Zero dependencies on purpose. Unlike smoke.mjs it is meant to run against hosted projects, so it has no local-only host
// guard: check the host it prints before the first request. The service-role key bypasses every policy, so give it to
// this command only, never through .env, .dev.vars or Worker secrets.
//   SUPABASE_URL=<project URL> SUPABASE_SERVICE_ROLE_KEY=<service-role key> [PLANNER_PASSWORD=<password>] \
//     node scripts/create-planner.mjs <email>
// PLANNER_PASSWORD is needed only to create a new account; an existing account keeps its password and is just promoted.
// Exit codes: 0 done (also when the account already was a planner), 1 API error or no matching account, 2 bad input.

const ROLE = "planner";
const PAGE_SIZE = 1000;
const USAGE =
  "usage: node scripts/create-planner.mjs <email> (env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PLANNER_PASSWORD)";
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PLANNER_PASSWORD } = process.env;
const email = process.argv[2]?.trim().toLowerCase() ?? "";
const password = PLANNER_PASSWORD ?? "";

function fail(code, message) {
  console.error(`create-planner: ${message}`);
  process.exit(code);
}

function parseHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Password rule from the PRD. Messages name the rule, never the value.
const meetsPasswordRule = (value) =>
  value.length >= 8 && /\p{Lu}/u.test(value) && /\d/.test(value) && /[^\p{L}\p{N}\s]/u.test(value);

// Everything is checked before the first request, so a typo cannot reach the project.
const problems = [];
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  problems.push("pass a valid e-mail address as the first argument");
}
if (password && !meetsPasswordRule(password)) {
  problems.push("PLANNER_PASSWORD needs at least 8 characters, an upper-case letter, a digit and a special character");
}
const supabaseUrl = SUPABASE_URL ? parseHttpUrl(SUPABASE_URL) : null;
if (!supabaseUrl) {
  problems.push(SUPABASE_URL ? "SUPABASE_URL is not a valid http(s) URL" : "SUPABASE_URL is not set");
}
if (!SUPABASE_SERVICE_ROLE_KEY) {
  problems.push("SUPABASE_SERVICE_ROLE_KEY is not set");
} else if (!/^[\x21-\x7e]+$/.test(SUPABASE_SERVICE_ROLE_KEY)) {
  // fetch would throw an error that quotes the offending header value, and that value is the key.
  problems.push("SUPABASE_SERVICE_ROLE_KEY contains whitespace or non-ASCII characters");
}
if (problems.length > 0) {
  for (const problem of problems) console.error(`create-planner: ${problem}`);
  console.error(USAGE);
  process.exit(2);
}

const { origin, host } = supabaseUrl;
console.log(`create-planner: target ${host}`);

async function adminRequest(method, path, body) {
  let response;
  let text;
  try {
    response = await fetch(`${origin}/auth/v1/admin/${path}`, {
      method,
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    text = await response.text();
  } catch (error) {
    // Only the error code is printed: other fields of a fetch error may quote request headers.
    fail(1, `cannot reach ${host} (${error.cause?.code ?? "network error"})`);
  }
  return { status: response.status, ok: response.ok, json: parseJson(text) };
}

// The same fields auth-js reads: `error_code` on older API versions, a string `code` on newer ones.
function errorCode({ json }) {
  const code = typeof json?.error_code === "string" ? json.error_code : json?.code;
  return typeof code === "string" && /^[a-z_]{1,64}$/.test(code) ? code : "";
}

// Status and error code only: the response body is never printed.
function describe(response) {
  const code = errorCode(response);
  return `status ${response.status}${code ? ` (${code})` : ""}`;
}

// The admin API cannot look an account up by e-mail, so page through the list until the address matches.
async function findUser() {
  for (let page = 1; ; page++) {
    const response = await adminRequest("GET", `users?page=${page}&per_page=${PAGE_SIZE}`);
    const users = response.json?.users;
    if (!response.ok || !Array.isArray(users)) {
      fail(1, `listing accounts failed with ${describe(response)}`);
    }
    const match = users.find((user) => user.email?.toLowerCase() === email);
    if (match) return match;
    if (users.length < PAGE_SIZE) return null;
  }
}

async function createOrPromote() {
  if (password) {
    const created = await adminRequest("POST", "users", {
      email,
      password,
      email_confirm: true,
      app_metadata: { role: ROLE },
    });
    if (created.ok) return `created planner ${email}`;
    if (created.status !== 422 || errorCode(created) !== "email_exists") {
      fail(1, `creating the account failed with ${describe(created)}`);
    }
    console.log(`create-planner: ${email} already exists, its password stays as it is`);
  }

  const user = await findUser();
  if (!user) {
    fail(
      1,
      password
        ? `the API reports ${email} as taken, but no such account is in the user list`
        : `no account for ${email}; set PLANNER_PASSWORD to create it`,
    );
  }
  if (user.app_metadata?.role === ROLE) return `${email} is already a planner`;

  const updated = await adminRequest("PUT", `users/${encodeURIComponent(user.id)}`, { app_metadata: { role: ROLE } });
  if (!updated.ok) {
    fail(1, `promoting the account failed with ${describe(updated)}`);
  }
  return `promoted ${email} to planner`;
}

console.log(`create-planner: ${await createOrPromote()}`);
