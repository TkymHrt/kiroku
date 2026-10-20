import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";

const preview = (body: string, onChange = vi.fn()) =>
  renderToStaticMarkup(createElement(MarkdownPreview, { body, onChange }));

describe("diary Markdown preview line breaks", () => {
  it.each(["\n", "\r\n"])("shows a single %j newline without changing the source", (newline) => {
    const body = `一行目${newline}二行目${newline}**三行目**`;
    const onChange = vi.fn();
    const html = preview(body, onChange);

    expect(html).toContain("<p>一行目<br/>\n二行目<br/>\n<strong>三行目</strong></p>");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("retains paragraphs and existing explicit Markdown breaks", () => {
    const html = preview("一行目\n二行目\n\n別の段落  \n空白による改行\\\nエスケープによる改行");

    expect(html.match(/<p>/g)).toHaveLength(2);
    expect(html.match(/<br\/>/g)).toHaveLength(3);
    expect(html).toContain("二行目</p>\n<p>別の段落<br/>");
  });

  it("preserves code blocks, inline code, and list item structure", () => {
    const html = preview(
      "```text\n一行目\n二行目\n```\n\n`inline`\n次の行\n\n- 項目一\n  続きの行\n- 項目二",
    );

    expect(html).toContain('<pre><code class="language-text">一行目\n二行目\n</code></pre>');
    expect(html).toContain("<code>inline</code><br/>\n次の行");
    expect(html).toContain("<li>項目一<br/>\n続きの行</li>\n<li>項目二</li>");
    expect(html.match(/<br\/>/g)).toHaveLength(2);
  });

  it("keeps duplicate and nested task markers addressable after soft breaks", () => {
    const body = "前文\n続き\n\n- [ ] 同じ項目\n  説明の続き\n- [x] 同じ項目\n  - [ ] 同じ項目";
    const html = preview(body);

    expect(html.match(/type="checkbox"/g)).toHaveLength(3);
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).toContain("前文<br/>\n続き");
    expect(html).toContain("同じ項目<br/>\n説明の続き");
  });
});
