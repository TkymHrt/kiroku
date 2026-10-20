import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { safeUrl } from "../lib/formatting";

interface MarkdownNode {
  type: string;
  checked?: boolean | null;
  position?: { start: { offset?: number } };
  data?: { hProperties?: Record<string, unknown> };
  children?: MarkdownNode[];
}

/** Source offsets identify task markers even when labels repeat or lists nest. */
function taskPositions() {
  return (tree: MarkdownNode, file: { value: unknown }) => {
    const source = String(file.value);
    const walk = (node: MarkdownNode) => {
      if (
        node.type === "listItem" &&
        typeof node.checked === "boolean" &&
        node.position?.start.offset !== undefined
      ) {
        const start = node.position.start.offset;
        const marker = source.slice(start).match(/^[\t ]*(?:[-+*]|\d+[.)])\s+\[([ xX])\]/);
        if (marker) {
          const offset = start + marker[0].lastIndexOf("[") + 1;
          node.data = {
            ...node.data,
            hProperties: {
              ...node.data?.hProperties,
              "data-task-offset": offset,
              "data-task-checked": node.checked,
            },
          };
        }
      }
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}

export function MarkdownPreview({
  body,
  onChange,
  readOnly = false,
}: {
  body: string;
  onChange: (body: string) => void;
  readOnly?: boolean;
}) {
  return (
    <article className="markdown-preview" aria-label="日記のプレビュー">
      {!body && <p className="empty-preview">まだ本文がありません。編集タブから記録できます。</p>}
      <Markdown
        remarkPlugins={[remarkGfm, remarkBreaks, taskPositions]}
        urlTransform={safeUrl}
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
          img: ({ src, alt }) =>
            src ? (
              <a href={safeUrl(src)} target="_blank" rel="noopener noreferrer">
                画像: {alt || src}
              </a>
            ) : (
              <span>画像: {alt || "リンクは無効です"}</span>
            ),
          input: () => null,
          li: ({ node, children, ...props }) => {
            const offset = node?.properties["data-task-offset"];
            if (offset === undefined) return <li {...props}>{children}</li>;
            const checked =
              node?.properties["data-task-checked"] === true ||
              node?.properties["data-task-checked"] === "true";
            return (
              <li className="task-list-item">
                <input
                  aria-label={checked ? "チェックを外す" : "チェックする"}
                  type="checkbox"
                  checked={checked}
                  disabled={readOnly}
                  onChange={() => {
                    const at = Number(offset);
                    if (body[at - 1] === "[" && body[at + 1] === "]")
                      onChange(body.slice(0, at) + (checked ? " " : "x") + body.slice(at + 1));
                  }}
                />
                <div>{children}</div>
              </li>
            );
          },
        }}
      >
        {body}
      </Markdown>
    </article>
  );
}
