import { describe, expect, it } from "vite-plus/test";
import { EditorSelection, EditorState, type Transaction } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { history, redo, undo } from "@codemirror/commands";
import { continueNumberedList, formatSource, safeUrl } from "./formatting";
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
  it("continues toolbar numbering through wrapped text and nested items", () => {
    const body = "8. 親\n   続き\n   1. 子\n次の項目\nその次";
    const from = body.indexOf("次の項目");
    expect(apply(body, "number", from)).toBe("8. 親\n   続き\n   1. 子\n9. 次の項目\n10. その次");
    const nested = "1. 親\n   3. 子\n   次の子\n2. 次の親";
    const nestedFrom = nested.indexOf("次の子");
    expect(apply(nested, "number", nestedFrom, nestedFrom)).toBe(
      "1. 親\n   3. 子\n   4. 次の子\n2. 次の親",
    );
  });
  it("numbers each selected hierarchy independently and keeps toggling intact", () => {
    expect(apply("親\n   子\n   次の子\n次の親", "number")).toBe(
      "1. 親\n   1. 子\n   2. 次の子\n2. 次の親",
    );
    expect(apply("1. 親\n2. 次の親", "number")).toBe("親\n次の親");
  });
  it("shifts consecutive following items but preserves deliberately different numbers", () => {
    const body = "1. 前\n追加\n2. 次\n3. その次\n20. 手入力\n21. 続き";
    const from = body.indexOf("追加");
    expect(apply(body, "number", from, from)).toBe(
      "1. 前\n2. 追加\n3. 次\n4. その次\n20. 手入力\n21. 続き",
    );
  });
  it("starts at one outside a list and does not use numbers from fenced code", () => {
    for (const body of ["9. 前\n\n別の段落\n\n次", "```\n9. コード\n```\n次"]) {
      expect(apply(body, "number", body.length - 1, body.length)).toBe(body.slice(0, -1) + "1. 次");
    }
  });
  it("maps the cursor and trailing selection when a continued number gains a digit", () => {
    const body = "9. 前\n次\nその次";
    const from = body.indexOf("次");
    const to = body.indexOf("その次");
    const edit = formatSource(body, from, to, "number");
    expect(body.slice(0, edit.from) + edit.insert + body.slice(edit.to)).toBe(
      "9. 前\n10. 次\nその次",
    );
    expect(edit.anchor).toBe(from + 4);
    expect(edit.head).toBe(to + 4);
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

describe("numbered list Enter", () => {
  const pressEnter = (body: string, cursor = body.length, readOnly = false) => {
    let state = EditorState.create({
      doc: body,
      selection: EditorSelection.cursor(cursor),
      extensions: [
        markdown({ addKeymap: false, completeHTMLTags: false }),
        history(),
        EditorState.readOnly.of(readOnly),
      ],
    });
    const target = {
      get state() {
        return state;
      },
      dispatch(transaction: Transaction) {
        state = transaction.state;
      },
    };
    const handled = continueNumberedList(target);
    return { target, handled };
  };

  it("appends the next number and can undo and redo the entire edit", () => {
    const { target, handled } = pressEnter("9. 記録");
    expect(handled).toBe(true);
    expect(target.state.doc.toString()).toBe("9. 記録\n10. ");
    expect(target.state.selection.main.head).toBe(target.state.doc.length);
    expect(undo(target)).toBe(true);
    expect(target.state.doc.toString()).toBe("9. 記録");
    expect(redo(target)).toBe(true);
    expect(target.state.doc.toString()).toBe("9. 記録\n10. ");
  });
  it("ends an empty item immediately and shifts following numbers", () => {
    expect(pressEnter("1. 記録\n2. ").target.state.doc.toString()).toBe("1. 記録\n");
    const body = "1. 記録\n2. \n3. 続き";
    expect(pressEnter(body, body.indexOf("\n3.")).target.state.doc.toString()).toBe(
      "1. 記録\n\n2. 続き",
    );
  });
  it("renumbers only the same list level after inserting in the middle", () => {
    const body = "1. 前\n   1. 子\n2. 次\n3. その次";
    expect(pressEnter(body, body.indexOf("\n")).target.state.doc.toString()).toBe(
      "1. 前\n2. \n   1. 子\n3. 次\n4. その次",
    );
    expect(pressEnter("1. 親\n   1. 子").target.state.doc.toString()).toBe(
      "1. 親\n   1. 子\n   2. ",
    );
  });
  it("leaves ordinary text, other list types, code and read-only documents to the default handler", () => {
    for (const body of ["記録", "- 記録", "- [ ] 記録", "> 記録", "1. 親\n   - 子"]) {
      const { target, handled } = pressEnter(body);
      expect(handled).toBe(false);
      expect(target.state.doc.toString()).toBe(body);
    }
    expect(pressEnter("```\n1. コード\n```", 10).handled).toBe(false);
    expect(pressEnter("1. 記録", undefined, true).handled).toBe(false);
  });
  it("preserves existing repeated-one markers when adding an item", () => {
    expect(pressEnter("1. 前\n1. 次").target.state.doc.toString()).toBe("1. 前\n1. 次\n2. ");
  });
});
