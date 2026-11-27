import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ABSENCE_LIST_LIMIT, assertCompleteRead, listAbsencesOverlapping, listAbsencesPage } from "@/lib/absences";

const ANNA = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("assertCompleteRead", () => {
  it.each<{ label: string; rows: number; count: number }>([
    { label: "as many rows as the database counted", rows: 12, count: 12 },
    { label: "no rows and none counted", rows: 0, count: 0 },
    { label: "more rows than counted (rows came in between the two readings)", rows: 5, count: 3 },
  ])("lets through $label", ({ rows, count }) => {
    expect(() => {
      assertCompleteRead(rows, count, "overlapping");
    }).not.toThrow();
  });

  it("refuses an answer that is shorter than the exact count, and says how much is missing and in which read", () => {
    expect(() => {
      assertCompleteRead(1000, 1203, "overlapping");
    }).toThrow("Reading absences failed (overlapping): the answer has 1000 of 1203 rows.");
  });

  it("refuses an answer cut off by a limit far below 1000 as well, so that it does not depend on the server's max_rows", () => {
    expect(() => {
      assertCompleteRead(100, 101, "overlapping");
    }).toThrow(/100 of 101 rows/);
  });

  it("refuses an answer with no exact count, as nothing then shows it to be complete", () => {
    expect(() => {
      assertCompleteRead(7, null, "overlapping");
    }).toThrow("Reading absences failed (overlapping): the database gave no exact count to check the answer against.");
  });
});

type Call = [method: string, ...args: unknown[]];

// A client that records every call of the query chain and answers with `response`: the chain ends where the caller awaits it,
// as that of the real client does.
function fakeClient(response: { data: unknown; error?: unknown; count?: number | null }) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "gte", "lte", "order", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => unknown) => resolve({ error: null, count: null, ...response });
  const client = {
    from: (table: string) => {
      calls.push(["from", table]);
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

function row(id: string, startDate: string, endDate: string = startDate) {
  return {
    id,
    employee_id: ANNA,
    type: "vacation",
    status: "approved",
    start_date: startDate,
    end_date: endDate,
    created_at: "2026-11-01T10:00:00.000Z",
  };
}

const failure = { code: "XX000", message: "boom", details: "", hint: "" };

describe("listAbsencesPage", () => {
  it("asks the database for the latest start first, then the id, and for one row more than the limit", async () => {
    const { client, calls } = fakeClient({ data: [] });

    await listAbsencesPage(client, { limit: 20 });

    expect(calls).toStrictEqual([
      ["from", "absences"],
      ["select", expect.any(String)],
      ["order", "start_date", { ascending: false }],
      ["order", "id", { ascending: true }],
      ["limit", 21],
    ]);
  });

  it("reads 501 rows by default, for the limit of 500", async () => {
    const { client, calls } = fakeClient({ data: [] });

    await listAbsencesPage(client);

    expect(ABSENCE_LIST_LIMIT).toBe(500);
    expect(calls).toContainEqual(["limit", 501]);
  });

  it("filters on the end date only when it is asked to, and then asks for the absences that end on or after that day", async () => {
    const without = fakeClient({ data: [] });
    const withCutoff = fakeClient({ data: [] });

    await listAbsencesPage(without.client);
    await listAbsencesPage(withCutoff.client, { endingFrom: "2025-11-27" });

    expect(without.calls.some(([method]) => method === "gte")).toBe(false);
    expect(withCutoff.calls).toContainEqual(["gte", "end_date", "2025-11-27"]);
  });

  it("gives the absences as they are, in the order of sortAbsences, and no truncation for a list within the limit", async () => {
    const { client } = fakeClient({
      data: [
        row("b-2", "2026-11-03"),
        row("a-1", "2026-11-03"),
        row("c-3", "2026-12-01", "2026-12-04"),
        row("d-4", "2026-10-01"),
      ],
    });

    const { absences, truncated } = await listAbsencesPage(client, { limit: 4 });

    expect(truncated).toBe(false);
    expect(absences.map(({ id }) => id)).toStrictEqual(["c-3", "a-1", "b-2", "d-4"]);
    expect(absences[0]).toStrictEqual({
      id: "c-3",
      employeeId: ANNA,
      type: "vacation",
      status: "approved",
      startDate: "2026-12-01",
      endDate: "2026-12-04",
      createdAt: "2026-11-01T10:00:00.000Z",
    });
  });

  it("drops the row beyond the limit and says the list is truncated", async () => {
    const { client } = fakeClient({
      data: [row("a-1", "2026-12-01"), row("b-2", "2026-11-01"), row("c-3", "2026-10-01")],
    });

    const { absences, truncated } = await listAbsencesPage(client, { limit: 2 });

    expect(truncated).toBe(true);
    expect(absences.map(({ id }) => id)).toStrictEqual(["a-1", "b-2"]);
  });

  it("is not truncated when the answer has exactly the limit", async () => {
    const { client } = fakeClient({ data: [row("a-1", "2026-12-01"), row("b-2", "2026-11-01")] });

    const { absences, truncated } = await listAbsencesPage(client, { limit: 2 });

    expect(truncated).toBe(false);
    expect(absences).toHaveLength(2);
  });

  it("gives an empty list for no rows", async () => {
    const { client } = fakeClient({ data: [] });

    await expect(listAbsencesPage(client)).resolves.toStrictEqual({ absences: [], truncated: false });
  });

  it("throws when the database fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { client } = fakeClient({ data: null, error: failure });

    await expect(listAbsencesPage(client)).rejects.toThrow("Reading absences failed (list).");
  });

  it.each([0, -1, 1.5, 1000, 5000, Number.NaN])(
    "throws a RangeError for the limit %j, before it reads anything",
    async (limit) => {
      const { client, calls } = fakeClient({ data: [] });

      await expect(listAbsencesPage(client, { limit })).rejects.toThrow(RangeError);
      expect(calls).toStrictEqual([]);
    },
  );
});

describe("listAbsencesOverlapping", () => {
  it("asks for the exact count with the rows, and for the absences that share a day with the days", async () => {
    const { client, calls } = fakeClient({ data: [], count: 0 });

    await listAbsencesOverlapping(client, "2026-11-02", "2026-11-09");

    expect(calls).toStrictEqual([
      ["from", "absences"],
      ["select", expect.any(String), { count: "exact" }],
      ["lte", "start_date", "2026-11-09"],
      ["gte", "end_date", "2026-11-02"],
    ]);
  });

  it("gives the rows in the order of sortAbsences when the count matches", async () => {
    const { client } = fakeClient({ data: [row("a-1", "2026-11-03"), row("b-2", "2026-11-05")], count: 2 });

    const absences = await listAbsencesOverlapping(client, "2026-11-02", "2026-11-09");

    expect(absences.map(({ id }) => id)).toStrictEqual(["b-2", "a-1"]);
  });

  it("throws when the answer is shorter than the count, which is how a cut-off answer shows", async () => {
    const { client } = fakeClient({ data: [row("a-1", "2026-11-03")], count: 3 });

    await expect(listAbsencesOverlapping(client, "2026-11-02", "2026-11-09")).rejects.toThrow(
      "Reading absences failed (overlapping): the answer has 1 of 3 rows.",
    );
  });

  it("throws when the database gives no count", async () => {
    const { client } = fakeClient({ data: [row("a-1", "2026-11-03")], count: null });

    await expect(listAbsencesOverlapping(client, "2026-11-02", "2026-11-09")).rejects.toThrow(/no exact count/);
  });

  it("still refuses an answer that reaches the read limit of 1000 rows, although the count agrees", async () => {
    const rows = Array.from({ length: 1000 }, (_, index) => row(`id-${String(index).padStart(4, "0")}`, "2026-11-03"));
    const { client } = fakeClient({ data: rows, count: 1000 });

    await expect(listAbsencesOverlapping(client, "2026-11-02", "2026-11-09")).rejects.toThrow(
      /read limit of 1000 rows/,
    );
  });

  it("throws when the database fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { client } = fakeClient({ data: null, error: failure });

    await expect(listAbsencesOverlapping(client, "2026-11-02", "2026-11-09")).rejects.toThrow(
      "Reading absences failed (overlapping).",
    );
  });
});
