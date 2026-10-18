import { describe, expect, it } from "vitest";
import {
  calendarDayLabel,
  calendarDays,
  calendarKeyDate,
  calendarYears,
  shiftCalendarMonth,
} from "./date-picker";
import { isDiaryDate } from "./types";

describe("calendar date selection", () => {
  it("shows valid leap days and adjacent-month days in Sunday-first weeks", () => {
    const days = calendarDays("2024-02-20");
    expect(days).toHaveLength(42);
    expect(days[0]).toBe("2024-01-28");
    expect(days).toContain("2024-02-29");
    expect(days.at(-1)).toBe("2024-03-09");
    expect(days.every((date) => date !== null && isDiaryDate(date))).toBe(true);
  });

  it("keeps month and keyboard navigation on real dates across leap years", () => {
    expect(shiftCalendarMonth("2024-01-31", 1)).toBe("2024-02-29");
    expect(shiftCalendarMonth("2024-02-29", 12)).toBe("2025-02-28");
    expect(calendarKeyDate("2026-12-31", "ArrowRight")).toBe("2027-01-01");
    expect(calendarKeyDate("2026-10-18", "Home")).toBe("2026-10-18");
    expect(calendarKeyDate("2026-10-18", "End")).toBe("2026-10-24");
    expect(calendarKeyDate("2024-02-29", "PageDown", true)).toBe("2025-02-28");
    expect(calendarKeyDate("2026-10-18", "Enter")).toBeNull();
  });

  it("supports years below 100 without Date.UTC's 1900-year offset", () => {
    expect(shiftCalendarMonth("0004-01-31", 1)).toBe("0004-02-29");
    expect(calendarDayLabel("0001-01-01")).toBe("1年1月1日 月曜日");
    expect(
      calendarDays("0099-02-01")
        .filter(Boolean)
        .every((date) => isDiaryDate(date!)),
    ).toBe(true);
  });

  it("never offers an unrepresentable day at the YYYY date boundaries", () => {
    for (const value of ["0001-01-01", "9999-12-31"]) {
      expect(
        calendarDays(value)
          .filter(Boolean)
          .every((date) => isDiaryDate(date!)),
      ).toBe(true);
    }
    expect(calendarKeyDate("0001-01-01", "ArrowLeft")).toBe("0001-01-01");
    expect(calendarKeyDate("9999-12-31", "ArrowRight")).toBe("9999-12-31");
    expect(shiftCalendarMonth("0001-01-31", -1)).toBe("0001-01-31");
    expect(shiftCalendarMonth("9999-12-31", 1)).toBe("9999-12-31");
  });

  it("recenters the year menu so long histories remain reachable with a small menu", () => {
    expect(calendarYears(2026)).toContain(2081);
    expect(calendarYears(1926)).toContain(1826);
    expect(calendarYears(1)[0]).toBe(1);
    expect(calendarYears(9999).at(-1)).toBe(9999);
    expect(calendarYears(2026)).toHaveLength(201);
  });
});
