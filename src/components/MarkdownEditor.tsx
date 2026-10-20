import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Annotation, EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  placeholder,
  highlightActiveLine,
  drawSelection,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, undo, redo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { Bold, Italic, Heading, List, ListOrdered, ListTodo, Undo2, Redo2 } from "lucide-react";
import { formatSource, type FormatAction } from "../lib/formatting";

interface Props {
  value: string;
  onChange: (value: string) => void;
  hidden: boolean;
  readOnly?: boolean;
}
const externalChange = Annotation.define<boolean>();

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "16px", backgroundColor: "transparent" },
  ".cm-scroller": {
    fontFamily: "inherit",
    lineHeight: "1.95",
    overflow: "auto",
  },
  ".cm-content": {
    padding: "24px 0 100px",
    minHeight: "320px",
    caretColor: "#3f5846",
  },
  ".cm-line": { padding: "0 28px" },
  ".cm-focused": { outline: "none" },
  "&.cm-focused": { outline: "none" },
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "#dce6d9",
  },
  ".cm-cursor": { borderLeftColor: "#3f5846" },
  ".cm-placeholder": { color: "#637064" },
});
const highlighting = HighlightStyle.define([
  { tag: tags.heading, color: "#3f5846" },
  { tag: tags.processingInstruction, color: "#637064" },
  { tag: tags.emphasis, color: "#5c6556" },
  { tag: tags.strong, color: "#283e2f" },
  { tag: tags.link, color: "#3d6280", textDecoration: "underline" },
  { tag: tags.url, color: "#3d6280" },
  { tag: tags.monospace, color: "#875138" },
  { tag: tags.quote, color: "#637064" },
]);

export function MarkdownEditor({ value, onChange, hidden, readOnly = false }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const change = useRef(onChange);
  const [composing, setComposing] = useState(false);
  useLayoutEffect(() => {
    change.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!host.current) return;
    const extensions: Extension[] = [
      history(),
      drawSelection(),
      highlightActiveLine(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      markdown({ addKeymap: false, completeHTMLTags: false }),
      syntaxHighlighting(highlighting),
      theme,
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({
        "aria-label": "日記の本文",
        spellcheck: "false",
      }),
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
      placeholder("本文を入力"),
      EditorView.updateListener.of((update) => {
        if (
          update.docChanged &&
          !update.transactions.every((transaction) => transaction.annotation(externalChange))
        )
          change.current(update.state.doc.toString());
      }),
      EditorView.domEventHandlers({
        compositionstart: () => {
          setComposing(true);
          return false;
        },
        compositionend: () => {
          setComposing(false);
          return false;
        },
      }),
    ];
    const editor = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: host.current,
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- The value effect below syncs text without rebuilding CodeMirror and losing undo history.
  }, [readOnly]);

  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === value || editor.composing) return;
    const selection = editor.state.selection.main;
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: value },
      selection: {
        anchor: Math.min(selection.anchor, value.length),
        head: Math.min(selection.head, value.length),
      },
      annotations: externalChange.of(true),
    });
  }, [value]);

  useEffect(() => {
    if (!hidden) view.current?.requestMeasure();
  }, [hidden]);

  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      const inset = viewport
        ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
        : 0;
      document.documentElement.style.setProperty("--keyboard-inset", `${inset}px`);
    };
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    update();
    return () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      document.documentElement.style.removeProperty("--keyboard-inset");
    };
  }, []);

  const format = (action: FormatAction | "undo" | "redo") => {
    const editor = view.current;
    if (!editor || editor.composing || readOnly) return;
    if (action === "undo") undo(editor);
    else if (action === "redo") redo(editor);
    else {
      const { from, to } = editor.state.selection.main;
      const edit = formatSource(editor.state.doc.toString(), from, to, action);
      editor.dispatch({
        changes: { from: edit.from, to: edit.to, insert: edit.insert },
        selection: { anchor: edit.anchor, head: edit.head },
        userEvent: "input",
      });
    }
    editor.focus();
  };

  const actions = [
    ["heading", "見出し", Heading],
    ["bullet", "箇条書き", List],
    ["number", "番号付きリスト", ListOrdered],
    ["check", "チェックリスト", ListTodo],
    ["bold", "太字", Bold],
    ["italic", "斜体", Italic],
    ["undo", "元に戻す", Undo2],
    ["redo", "やり直す", Redo2],
  ] as const;
  return (
    <div className="source-editor" hidden={hidden}>
      <div ref={host} className="codemirror-host" />
      {!readOnly && (
        <div className="format-toolbar" role="toolbar" aria-label="Markdown入力補助">
          {actions.map(([action, label, Icon]) => (
            <button
              key={action}
              type="button"
              title={label}
              aria-label={label}
              disabled={composing}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => format(action)}
            >
              <Icon size={19} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
