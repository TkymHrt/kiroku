/** Calendar arithmetic uses UTC so daylight saving and the device locale cannot move a day. */
export const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

export function dateParts(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

export function dateKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function calendarDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function boundedDate(date: Date): string {
  const year = date.getUTCFullYear();
  if (year < 1) return "0001-01-01";
  if (year > 9999) return "9999-12-31";
  return dateKey(year, date.getUTCMonth() + 1, date.getUTCDate());
}

export function monthLength(year: number, month: number): number {
  // setUTCFullYear avoids Date.UTC's special treatment of years 0–99.
  const date = new Date(0);
  date.setUTCFullYear(year, month, 0);
  return date.getUTCDate();
}

export function shiftCalendarDay(value: string, amount: number): string {
  const date = calendarDate(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return boundedDate(date);
}

export function shiftCalendarMonth(value: string, amount: number): string {
  const { year, month, day } = dateParts(value);
  const index = Math.max(
    0,
    Math.min(9999 * 12 - 1, (year - 1) * 12 + month - 1 + amount),
  );
  const nextYear = Math.floor(index / 12) + 1;
  const nextMonth = (index % 12) + 1;
  return dateKey(
    nextYear,
    nextMonth,
    Math.min(day, monthLength(nextYear, nextMonth)),
  );
}

/** A stable six-week grid; null cells only occur beyond the supported YYYY date bounds. */
export function calendarDays(value: string): (string | null)[] {
  const { year, month } = dateParts(value);
  const first = calendarDate(dateKey(year, month, 1));
  first.setUTCDate(1 - first.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(first);
    date.setUTCDate(first.getUTCDate() + index);
    if (date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) return null;
    return boundedDate(date);
  });
}

export function calendarKeyDate(
  value: string,
  key: string,
  shiftKey = false,
): string | null {
  switch (key) {
    case "ArrowLeft":
      return shiftCalendarDay(value, -1);
    case "ArrowRight":
      return shiftCalendarDay(value, 1);
    case "ArrowUp":
      return shiftCalendarDay(value, -7);
    case "ArrowDown":
      return shiftCalendarDay(value, 7);
    case "Home":
      return shiftCalendarDay(value, -calendarDate(value).getUTCDay());
    case "End":
      return shiftCalendarDay(value, 6 - calendarDate(value).getUTCDay());
    case "PageUp":
      return shiftCalendarMonth(value, shiftKey ? -12 : -1);
    case "PageDown":
      return shiftCalendarMonth(value, shiftKey ? 12 : 1);
    default:
      return null;
  }
}

export function calendarDayLabel(value: string): string {
  const { year, month, day } = dateParts(value);
  return `${year}年${month}月${day}日 ${WEEKDAYS[calendarDate(value).getUTCDay()]}曜日`;
}

/** Recenter on selection: distant years stay reachable without a 10,000-option mobile menu. */
export function calendarYears(year: number): number[] {
  const first = Math.max(1, year - 100);
  const last = Math.min(9999, year + 100);
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}
