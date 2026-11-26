import { describe, expect, it } from "vitest";
import { easterSunday, holidaysInWeek, isHoliday, isSunday, polishHolidays, weekdayOf } from "@/lib/services/calendar";
import { addDays } from "@/lib/services/schedule";
import { expectDeterministic, seededShuffle } from "@/lib/testing/determinism";
import { localDateMethodsCalledBy } from "@/lib/testing/local-time";

const pad2 = (value: number): string => String(value).padStart(2, "0");
const isoOf = (year: number, month: number, day: number): string => `${year}-${pad2(month)}-${pad2(day)}`;

// Every year the schedules cover.
const YEARS = Array.from({ length: 80 }, (_unused, index) => 2020 + index);

// What `parseIsoDate` rejects: not a real date, a year outside 2020 to 2099, another spelling, or not a date at all.
const INVALID_DATES = [
  "",
  "not a date",
  "2026-02-30",
  "2025-02-29",
  "2026-13-01",
  "2026-00-10",
  "2019-12-31",
  "2100-01-01",
  "2026-1-1",
  "20261110",
  " 2026-11-10",
  "2026-11-10\n",
  "2026-11-10T00:00:00Z",
];

describe("weekdayOf", () => {
  it.each<[string, number]>([
    ["2020-01-01", 3],
    ["2020-02-29", 6],
    ["2024-02-29", 4],
    ["2026-03-01", 0],
    ["2026-11-10", 2],
    ["2026-11-11", 3],
    ["2099-12-31", 4],
  ])("gives the day of the week of %s as %d (0 is Sunday)", (date, weekday) => {
    expect(weekdayOf(date)).toBe(weekday);
  });

  it("counts seven days from Sunday to Saturday", () => {
    const days = Array.from({ length: 7 }, (_unused, offset) => addDays("2026-11-01", offset));

    expect(days.map(weekdayOf)).toStrictEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("carries on over New Year and from Saturday to Sunday", () => {
    expect(weekdayOf("2026-12-26")).toBe(6);
    expect(weekdayOf("2026-12-27")).toBe(0);
    expect(weekdayOf("2026-12-31")).toBe(4);
    expect(weekdayOf("2027-01-01")).toBe(5);
  });
});

describe("isSunday", () => {
  it.each<[string, boolean]>([
    ["2026-05-03", true],
    ["2026-11-01", true],
    ["2026-11-02", false],
    ["2026-11-07", false],
  ])("says %s is a Sunday: %s", (date, expected) => {
    expect(isSunday(date)).toBe(expected);
  });
});

describe("the functions of a date", () => {
  const readers: [string, (isoDate: string) => unknown][] = [
    ["weekdayOf", weekdayOf],
    ["isSunday", isSunday],
    ["isHoliday", isHoliday],
    ["holidaysInWeek", holidaysInWeek],
  ];

  describe.each(readers)("%s", (_name, read) => {
    it.each(INVALID_DATES)("throws a RangeError for %j", (text) => {
      expect(() => read(text)).toThrow(RangeError);
    });
  });
});

describe("easterSunday", () => {
  it.each<[number, number, number]>([
    [2020, 4, 12],
    [2021, 4, 4],
    [2022, 4, 17],
    [2023, 4, 9],
    [2024, 3, 31],
    [2025, 4, 20],
    [2026, 4, 5],
    [2027, 3, 28],
    [2028, 4, 16],
    [2029, 4, 1],
    [2030, 4, 21],
    // The earliest and the latest Easter of the century.
    [2035, 3, 25],
    [2038, 4, 25],
  ])("puts Easter %d on month %d, day %d", (year, month, day) => {
    expect(easterSunday(year)).toStrictEqual({ month, day });
  });

  it("falls on a Sunday between 22 March and 25 April in every year from 2020 to 2099", () => {
    const wrong = YEARS.filter((year) => {
      const { month, day } = easterSunday(year);
      const date = isoOf(year, month, day);
      return weekdayOf(date) !== 0 || date < `${year}-03-22` || date > `${year}-04-25`;
    });

    expect(wrong).toStrictEqual([]);
  });

  it.each<[string, number]>([
    ["the year before 2020", 2019],
    ["the year after 2099", 2100],
    ["a year with a fraction", 2026.5],
    ["NaN", NaN],
  ])("throws a RangeError for %s", (_label, year) => {
    expect(() => easterSunday(year)).toThrow(RangeError);
  });
});

describe("polishHolidays", () => {
  it("lists the fourteen holidays of 2026, sorted", () => {
    expect(polishHolidays(2026)).toStrictEqual([
      "2026-01-01",
      "2026-01-06",
      "2026-04-05",
      "2026-04-06",
      "2026-05-01",
      "2026-05-03",
      "2026-05-24",
      "2026-06-04",
      "2026-08-15",
      "2026-11-01",
      "2026-11-11",
      "2026-12-24",
      "2026-12-25",
      "2026-12-26",
    ]);
  });

  it("lists thirteen holidays of 2024, with no 24 December", () => {
    expect(polishHolidays(2024)).toStrictEqual([
      "2024-01-01",
      "2024-01-06",
      "2024-03-31",
      "2024-04-01",
      "2024-05-01",
      "2024-05-03",
      "2024-05-19",
      "2024-05-30",
      "2024-08-15",
      "2024-11-01",
      "2024-11-11",
      "2024-12-25",
      "2024-12-26",
    ]);
  });

  it("makes 24 December a holiday from 2025 on and not before", () => {
    expect(polishHolidays(2024)).not.toContain("2024-12-24");
    expect(polishHolidays(2025)).toContain("2025-12-24");
    expect(YEARS.filter((year) => polishHolidays(year).includes(`${year}-12-24`))).toStrictEqual(
      YEARS.filter((year) => year >= 2025),
    );
  });

  it("takes Zielone Świątki and Boże Ciało from Easter, 49 and 60 days later", () => {
    // The two dates of 2026 are the ones of work-time-rules.md; the other years are the ones of the calendar.
    expect(polishHolidays(2026)).toContain("2026-05-24");
    expect(polishHolidays(2026)).toContain("2026-06-04");

    const movable: [number, string, string][] = [
      [2023, "2023-05-28", "2023-06-08"],
      [2024, "2024-05-19", "2024-05-30"],
      [2025, "2025-06-08", "2025-06-19"],
      [2027, "2027-05-16", "2027-05-27"],
      [2030, "2030-06-09", "2030-06-20"],
    ];
    for (const [year, pentecost, corpusChristi] of movable) {
      expect(polishHolidays(year)).toContain(pentecost);
      expect(polishHolidays(year)).toContain(corpusChristi);
    }
  });

  it("gives the first and the last year of the schedules their holidays", () => {
    const first = polishHolidays(2020);
    const last = polishHolidays(2099);

    expect([first[0], first[first.length - 1], first.length]).toStrictEqual(["2020-01-01", "2020-12-26", 13]);
    expect([last[0], last[last.length - 1], last.length]).toStrictEqual(["2099-01-01", "2099-12-26", 14]);
  });

  it("lists each year sorted, without a repeat, with 13 or 14 days and every one in that year", () => {
    for (const year of YEARS) {
      const holidays = polishHolidays(year);

      expect(holidays, `year ${year}`).toStrictEqual([...new Set(holidays)].sort());
      expect(holidays, `year ${year}`).toHaveLength(year >= 2025 ? 14 : 13);
      expect(
        holidays.every((date) => date.startsWith(`${year}-`)),
        `year ${year}`,
      ).toBe(true);
    }
  });

  it.each<[string, number]>([
    ["the year before 2020", 2019],
    ["the year after 2099", 2100],
    ["a year with a fraction", 2026.5],
    ["NaN", NaN],
  ])("throws a RangeError for %s", (_label, year) => {
    expect(() => polishHolidays(year)).toThrow(RangeError);
  });

  it("gives a new list on every call", () => {
    const first = polishHolidays(2026);
    first.length = 0;

    expect(polishHolidays(2026)).toHaveLength(14);
  });
});

describe("isHoliday", () => {
  it.each<[string, boolean]>([
    ["2026-01-01", true],
    ["2026-04-06", true],
    ["2026-05-24", true],
    ["2026-06-04", true],
    ["2026-11-11", true],
    ["2025-12-24", true],
    ["2024-12-24", false],
    ["2026-04-07", false],
    ["2026-05-02", false],
    ["2026-12-23", false],
    ["2026-06-05", false],
  ])("says %s is a holiday: %s", (date, expected) => {
    expect(isHoliday(date)).toBe(expected);
  });

  it("agrees with the list of the year for every day of 2026", () => {
    const holidays = new Set(polishHolidays(2026));
    const days = Array.from({ length: 365 }, (_unused, offset) => addDays("2026-01-01", offset));

    expect(days.filter(isHoliday)).toStrictEqual(days.filter((day) => holidays.has(day)));
    expect(days.filter(isHoliday)).toHaveLength(14);
  });
});

describe("holidaysInWeek", () => {
  it.each<[string, string, string[]]>([
    ["a week with one holiday on a Wednesday (the norm of 32 h)", "2026-11-10", ["2026-11-11"]],
    ["the same holiday in a week that starts on the Monday before", "2026-11-09", ["2026-11-11"]],
    ["a holiday on the seventh day of the week", "2026-11-05", ["2026-11-11"]],
    ["a holiday one day after the week", "2026-11-04", []],
    ["a holiday one day before the week", "2026-11-12", []],
    ["a week with no holiday", "2026-11-02", []],
    ["3 May on a Sunday, which does not count", "2026-05-02", []],
    ["1 November on a Sunday, which does not count", "2026-11-01", []],
    ["1 May on a Friday, with 3 May on a Sunday left out", "2026-04-27", ["2026-05-01"]],
    ["Easter Sunday left out and Easter Monday kept", "2026-04-01", ["2026-04-06"]],
    ["Boże Ciało on a Thursday", "2026-06-01", ["2026-06-04"]],
    [
      "Christmas on a Friday and a Saturday, with 24 December",
      "2026-12-21",
      ["2026-12-24", "2026-12-25", "2026-12-26"],
    ],
    ["24 December in 2025 on a Wednesday", "2025-12-22", ["2025-12-24", "2025-12-25", "2025-12-26"]],
    ["24 December in 2024, which is no holiday yet", "2024-12-23", ["2024-12-25", "2024-12-26"]],
    ["a week that crosses New Year", "2026-12-30", ["2027-01-01"]],
    ["Trzech Króli in the first week of a year", "2027-01-04", ["2027-01-06"]],
    ["the first day of the schedules", "2020-01-01", ["2020-01-01", "2020-01-06"]],
    ["the last day of the schedules, with the two holidays of 2100", "2099-12-31", ["2100-01-01", "2100-01-06"]],
  ])("finds the holidays of %s (from %s)", (_label, startDate, expected) => {
    expect(holidaysInWeek(startDate)).toStrictEqual(expected);
  });

  it("gives holidays that are not on a Sunday, inside the seven days and in order, for every start date of 2025 and 2026", () => {
    const wrong: string[] = [];
    for (let offset = 0; offset < 730; offset++) {
      const startDate = addDays("2025-01-01", offset);
      const endDate = addDays(startDate, 6);
      const found = holidaysInWeek(startDate);
      const fine =
        found.every((date) => isHoliday(date) && !isSunday(date) && date >= startDate && date <= endDate) &&
        found.every((date, index) => index === 0 || found[index - 1] < date);
      if (!fine) {
        wrong.push(startDate);
      }
    }

    expect(wrong).toStrictEqual([]);
  });

  it("gives every holiday that is not on a Sunday to the week it is in", () => {
    const withoutSundays = polishHolidays(2026).filter((date) => !isSunday(date));

    for (const date of withoutSundays) {
      expect(holidaysInWeek(date), `week from ${date}`).toContain(date);
      expect(holidaysInWeek(addDays(date, -6)), `week to ${date}`).toContain(date);
    }
  });
});

// The norm of a calendar month in hours for a full-time employee, counted the way art. 130 of the Labour Code words it:
// 40 h for each full week from the first day, 8 h for each of the days left over at the end that is a Monday to Friday,
// less 8 h for each holiday on a day other than Sunday. Built from `weekdayOf`, `isHoliday` and `isSunday` only.
function monthNormHours(year: number, month: number): number {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const weeks = Math.floor(daysInMonth / 7);
  let hours = weeks * 40;
  for (let day = weeks * 7 + 1; day <= daysInMonth; day++) {
    const weekday = weekdayOf(isoOf(year, month, day));
    if (weekday >= 1 && weekday <= 5) {
      hours += 8;
    }
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const date = isoOf(year, month, day);
    if (isHoliday(date) && !isSunday(date)) {
      hours -= 8;
    }
  }
  return hours;
}

describe("the norm of a month counted from the calendar", () => {
  it.each<[string, number, number, number]>([
    // The three cases of work-time-rules.md.
    ["March 2026", 2026, 3, 176],
    ["April 2026, with Easter Monday", 2026, 4, 168],
    ["October 2026", 2026, 10, 176],
    // Months that bring in the rest of the list: 24 December from 2025, Trzech Króli, and holidays that fall on a Sunday.
    ["December 2025, with 24, 25 and 26 December", 2025, 12, 160],
    ["January 2026, with 1 and 6 January", 2026, 1, 160],
    ["May 2026, with 1 May and 3 May on a Sunday", 2026, 5, 160],
    ["November 2026, with 1 November on a Sunday", 2026, 11, 160],
  ])("gives %s the norm of %d-%d: %d h", (_label, year, month, hours) => {
    expect(monthNormHours(year, month)).toBe(hours);
  });
});

describe("repeatability of the calendar", () => {
  it("gives the same holidays for repeated calls", () => {
    const holidays = expectDeterministic(polishHolidays, 2026);

    expect(holidays).toHaveLength(14);
  });

  it("gives the same week, weekday and Easter for repeated calls", () => {
    expect(expectDeterministic(holidaysInWeek, "2026-11-10")).toStrictEqual(["2026-11-11"]);
    expect(expectDeterministic(weekdayOf, "2026-11-10")).toBe(2);
    expect(expectDeterministic(easterSunday, 2026)).toStrictEqual({ month: 4, day: 5 });
  });

  it("gives each year the same holidays whatever the order the years are asked in", () => {
    const holidaysByYear = (years: readonly number[]) =>
      Object.fromEntries(years.map((year): [number, string[]] => [year, polishHolidays(year)]));

    const result = expectDeterministic(holidaysByYear, YEARS, {
      variants: [1, 2, 3, 4].map((seed) => seededShuffle(YEARS, seed)),
    });

    expect(Object.keys(result)).toHaveLength(YEARS.length);
  });

  it("gives each week the same holidays whatever the order the weeks are asked in", () => {
    const starts = Array.from({ length: 60 }, (_unused, offset) => addDays("2026-10-01", offset * 3));
    const holidaysByStart = (dates: readonly string[]) =>
      Object.fromEntries(dates.map((date): [string, string[]] => [date, holidaysInWeek(date)]));

    const result = expectDeterministic(holidaysByStart, starts, {
      variants: [1, 2, 3].map((seed) => seededShuffle(starts, seed)),
    });

    expect(Object.values(result).some((holidays) => holidays.length > 0)).toBe(true);
  });
});

describe("the time zone", () => {
  it("sees a call of a method of Date that reads the local time", () => {
    // Proof that the check below can fail: a local getter that is called is reported.
    expect(localDateMethodsCalledBy(() => new Date(0).getDate())).toStrictEqual(["getDate"]);
  });

  it("calls no method of Date that reads or writes the local time", () => {
    const called = localDateMethodsCalledBy(() => {
      weekdayOf("2026-11-10");
      isSunday("2026-11-01");
      easterSunday(2026);
      polishHolidays(2026);
      isHoliday("2026-04-06");
      holidaysInWeek("2026-11-10");
      holidaysInWeek("2099-12-31");
    });

    expect(called).toStrictEqual([]);
  });
});
