export type FormatAction = "heading" | "bullet" | "number" | "check" | "bold" | "italic";
export interface FormatEdit {
  from: number;
  to: number;
  insert: string;
  anchor: number;
  head: number;
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
  const changes = lines.map((line, index) => {
    const indent = line.match(/^\s*/)?.[0] ?? "";
    const rest = line.slice(indent.length);
    const prefix = rest.match(/^(?:#{1,6} |[-+*] \[[ xX]\] |[-+*] |\d+\. )/)?.[0] ?? "";
    let next = "";
    if (action === "heading") {
      const level = rest.match(/^(#{1,6}) /)?.[1].length ?? 0;
      next = level >= 3 ? "" : "#".repeat(level + 1) + " ";
    } else if (!allActive)
      next = action === "bullet" ? "- " : action === "number" ? `${index + 1}. ` : "- [ ] ";
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
  return {
    from: start,
    to: end,
    insert,
    anchor: Math.max(start, from + deltaBefore),
    head: Math.max(start, to + deltaEnd),
  };
}

export function safeUrl(url: string): string {
  // oxlint-disable-next-line no-control-regex -- Strip control characters before checking the URL scheme to reject obfuscated unsafe URLs.
  const normalized = url.replace(/[\u0000-\u0020\u007f]/g, "");
  if (/^(https?:|mailto:)/i.test(normalized) || normalized.startsWith("#")) return url;
  return "";
}
