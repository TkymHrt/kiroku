import { commonmarkLanguage, insertNewlineContinueMarkupCommand } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { ChangeSet, Text, type StateCommand } from "@codemirror/state";

export type FormatAction = "heading" | "bullet" | "number" | "check" | "bold" | "italic";
export interface FormatEdit {
  from: number;
  to: number;
  insert: string;
  anchor: number;
  head: number;
}

const continueMarkup = insertNewlineContinueMarkupCommand({ nonTightLists: false });

/** Leave IME event handling to CodeMirror, including Android's synthesized Enter events. */
export const continueNumberedList: StateCommand = (target) => {
  if (target.state.readOnly) return false;
  for (const range of target.state.selection.ranges) {
    if (!range.empty) return false;
    let node = syntaxTree(target.state).resolveInner(range.head, -1);
    while (node.name !== "ListItem") {
      if (node.name === "FencedCode" || node.name === "CodeBlock" || !node.parent) return false;
      node = node.parent;
    }
    if (node.parent?.name !== "OrderedList") return false;
  }
  return continueMarkup(target);
};

/** Number only the selected items and an already consecutive run after them. */
function numberSelection(body: string, edit: FormatEdit, originalLines: string[]): FormatEdit {
  const candidate = body.slice(0, edit.from) + edit.insert + body.slice(edit.to);
  const selected = new Map<number, { original: number | null; next: number }>();
  let offset = edit.from;
  for (const [index, line] of edit.insert.split("\n").entries()) {
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const original = originalLines[index].trimStart().match(/^(\d+)\. /);
    selected.set(offset + indent, {
      original: original ? Number(original[1]) : null,
      next: index + 1,
    });
    offset += line.length + 1;
  }
  const replacements = new Map<number, number>();
  commonmarkLanguage.parser.parse(candidate).iterate({
    enter(ref) {
      if (ref.name !== "OrderedList") return;
      let previousOriginal = 0;
      let previousNext = 0;
      let adjusting = false;
      for (let item = ref.node.firstChild; item; item = item.nextSibling) {
        if (item.name !== "ListItem") continue;
        const marker = candidate.slice(item.from, item.from + 12).match(/^(\d+)[.)]/);
        if (!marker) continue;
        const original = Number(marker[1]);
        const chosen = selected.get(item.from);
        let next = original;
        if (chosen) {
          next = previousNext + 1;
          chosen.next = next;
          if (chosen.original !== null) previousOriginal = chosen.original;
          adjusting = true;
        } else {
          if (adjusting && original === previousOriginal + 1) next = previousNext + 1;
          else adjusting = false;
          previousOriginal = original;
        }
        if (next !== original) replacements.set(item.from, next);
        previousNext = next;
      }
    },
  });
  for (const [from, chosen] of selected) replacements.set(from, chosen.next);
  const changes = [...replacements].map(([from, next]) => ({
    from,
    to: from + (candidate.slice(from, from + 12).match(/^\d+/)?.[0].length ?? 0),
    insert: String(next),
  }));
  const extent = changes.reduce(
    (end, change) => Math.max(end, change.to),
    edit.from + edit.insert.length,
  );
  const numbering = ChangeSet.of(changes, candidate.length);
  const numbered = numbering.apply(Text.of(candidate.split("\n"))).toString();
  return {
    from: edit.from,
    to: edit.to + extent - (edit.from + edit.insert.length),
    insert: numbered.slice(edit.from, numbering.mapPos(extent, 1)),
    anchor: numbering.mapPos(edit.anchor, 1),
    head: numbering.mapPos(edit.head, 1),
  };
}

/** Pure source edits, shared by the CodeMirror toolbar and its boundary tests. */
export function formatSource(
  body: string,
  from: number,
  to: number,
  action: FormatAction,
): FormatEdit {
  if (action === "bold" || action === "italic") {
    const mark = action === "bold" ? "**" : "*";
    const selected = body.slice(from, to);
    if (
      selected.startsWith(mark) &&
      selected.endsWith(mark) &&
      selected.length >= mark.length * 2
    ) {
      const insert = selected.slice(mark.length, -mark.length);
      return { from, to, insert, anchor: from, head: from + insert.length };
    }
    if (
      body.slice(Math.max(0, from - mark.length), from) === mark &&
      body.slice(to, to + mark.length) === mark
    ) {
      return {
        from: from - mark.length,
        to: to + mark.length,
        insert: selected,
        anchor: from - mark.length,
        head: to - mark.length,
      };
    }
    return {
      from,
      to,
      insert: mark + selected + mark,
      anchor: from + mark.length,
      head: to + mark.length,
    };
  }
  const start = from === 0 ? 0 : body.lastIndexOf("\n", from - 1) + 1;
  const endPoint = to > from && body[to - 1] === "\n" ? to - 1 : to;
  const newline = body.indexOf("\n", endPoint);
  const end = newline < 0 ? body.length : newline;
  const lines = body.slice(start, end).split("\n");
  const patterns = {
    heading: /^#{1,6} /,
    bullet: /^[-+*] (?!\[)/,
    number: /^\d+\. /,
    check: /^[-+*] \[[ xX]\] /,
  };
  const allActive = lines.every((line) => patterns[action].test(line.trimStart()));
  const changes = lines.map((line) => {
    const indent = line.match(/^\s*/)?.[0] ?? "";
    const rest = line.slice(indent.length);
    const prefix = rest.match(/^(?:#{1,6} |[-+*] \[[ xX]\] |[-+*] |\d+\. )/)?.[0] ?? "";
    let next = "";
    if (action === "heading") {
      const level = rest.match(/^(#{1,6}) /)?.[1].length ?? 0;
      next = level >= 3 ? "" : "#".repeat(level + 1) + " ";
    } else if (!allActive)
      next = action === "bullet" ? "- " : action === "number" ? "1. " : "- [ ] ";
    return {
      text: indent + next + rest.slice(prefix.length),
      delta: next.length - prefix.length,
    };
  });
  const insert = changes.map((line) => line.text).join("\n");
  const beforeSelection = body.slice(start, from).split("\n").length - 1;
  const endLine = body.slice(start, endPoint).split("\n").length - 1;
  const deltaBefore = changes
    .slice(0, beforeSelection + 1)
    .reduce((sum, line) => sum + line.delta, 0);
  const deltaEnd = changes.slice(0, endLine + 1).reduce((sum, line) => sum + line.delta, 0);
  const edit = {
    from: start,
    to: end,
    insert,
    anchor: Math.max(start, from + deltaBefore),
    head: Math.max(start, to + deltaEnd),
  };
  return action === "number" && !allActive ? numberSelection(body, edit, lines) : edit;
}

export function safeUrl(url: string): string {
  // oxlint-disable-next-line no-control-regex -- Strip control characters before checking the URL scheme to reject obfuscated unsafe URLs.
  const normalized = url.replace(/[\u0000-\u0020\u007f]/g, "");
  if (/^(https?:|mailto:)/i.test(normalized) || normalized.startsWith("#")) return url;
  return "";
}
