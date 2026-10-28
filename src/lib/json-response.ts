const JSON_CONTENT_TYPE = /^\s*application\/json\s*(?:;|$)/i;

/** A JSON response that is never cached, the shape every answer of the employee API routes has. */
export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/**
 * The parsed JSON body, or the 415 / 400 response to send back. The media type is compared ignoring letter case and
 * parameters (`application/json; charset=utf-8` is accepted); a missing Content-Type header is a 415.
 */
export async function readJsonBody(
  request: Request,
): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  if (!JSON_CONTENT_TYPE.test(request.headers.get("content-type") ?? "")) {
    return { ok: false, response: jsonResponse(415, { error: "unsupported_media_type" }) };
  }
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false, response: jsonResponse(400, { error: "invalid_json" }) };
  }
}
