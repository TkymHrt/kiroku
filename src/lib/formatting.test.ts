import { describe, expect, it } from "vite-plus/test";
import { formatSource, safeUrl } from "./formatting";
import { bodyBytes, isDiaryDate, tokyoToday } from "./types";

const apply = (
  text: string,
  action: Parameters<typeof formatSource>[3],
  from = 0,
  to = text.length,
) => {
  const edit = formatSource(text, from, to, action);
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
};

describe("source toolbar and date boundaries", () => {
  it("inserts into the first blank line without touching following text", () => {
    expect(apply("\n続き", "heading", 0, 0)).toBe("# \n続き");
  });
  it("cycles headings and toggles list kinds without stacking prefixes", () => {
    expect(apply("## 見出し", "heading")).toBe("### 見出し");
    expect(apply("### 見出し", "heading")).toBe("見出し");
    expect(apply("- 一行\n- 二行", "check")).toBe("- [ ] 一行\n- [ ] 二行");
    expect(apply("- [x] 一行\n- [ ] 二行", "check")).toBe("一行\n二行");
    expect(apply("一行\n二行", "number")).toBe("1. 一行\n2. 二行");
  });
  it("does not format the unselected line after a trailing newline", () => {
    expect(apply("一行\n二行", "bullet", 0, 3)).toBe("- 一行\n二行");
  });
  it("wraps and unwraps selections, keeping cursor inside an empty pair", () => {
    expect(apply("日記", "bold")).toBe("**日記**");
    expect(apply("**日記**", "bold", 2, 4)).toBe("日記");
    const empty = formatSource("", 0, 0, "italic");
    expect(empty).toMatchObject({ insert: "**", anchor: 1, head: 1 });
  });
  it("only permits safe explicit URL schemes", () => {
    expect(safeUrl("https://example.com")).toBe("https://example.com");
    expect(safeUrl("javascript:alert(1)")).toBe("");
    expect(safeUrl("java\nscript:alert(1)")).toBe("");
    expect(safeUrl("data:text/html,hello")).toBe("");
    expect(safeUrl("//example.com")).toBe("");
  });
  it("calculates today in Tokyo and validates actual calendar days", () => {
    expect(tokyoToday(new Date("2026-10-17T14:59:59Z"))).toBe("2026-10-17");
    expect(tokyoToday(new Date("2026-10-17T15:00:00Z"))).toBe("2026-10-18");
    expect(isDiaryDate("2024-02-29")).toBe(true);
    expect(isDiaryDate("2025-02-29")).toBe(false);
    expect(isDiaryDate("2026-13-01")).toBe(false);
    expect(bodyBytes("あ😀")).toBe(7);
  });
});
