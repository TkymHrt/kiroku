import { parser } from "@lezer/markdown";
import type { MutationRequest } from "./types";

export interface NoteContent {
  title: string;
  body: string;
  pinned: boolean;
  archived: boolean;
}
export interface Note extends NoteContent {
  id: string;
  version: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface NoteSummary extends Omit<Note, "body"> {
  excerpt: string;
  taskCount: number;
  completedCount: number;
}
export type NoteScope = "active" | "archived" | "trash";
export interface NoteState {
  note: Note | null;
  epoch: string;
  absenceToken: string | null;
}
export type NoteMutation = Omit<MutationRequest, "body"> & { content?: NoteContent };
export interface NoteMutationResponse extends NoteState {
  mutationId: string;
  appliedVersion: number | null;
  appliedNoteId: string;
  replayed: boolean;
}
export interface NoteListResponse {
  items: NoteSummary[];
  nextCursor: string | null;
  epoch: string;
}
export const emptyNote = (): NoteContent => ({
  title: "",
  body: "",
  pinned: false,
  archived: false,
});

/** A private sync envelope; exports and the Markdown editor always use body verbatim. */
export function encodeNote(content: NoteContent): string {
  return !content.title && !content.body && !content.pinned && !content.archived
    ? ""
    : JSON.stringify({
        title: content.title,
        body: content.body,
        pinned: content.pinned,
        archived: content.archived,
      });
}
export function decodeNote(value: string): NoteContent {
  if (!value) return emptyNote();
  const content = JSON.parse(value) as NoteContent;
  if (
    typeof content.title !== "string" ||
    typeof content.body !== "string" ||
    typeof content.pinned !== "boolean" ||
    typeof content.archived !== "boolean"
  )
    throw new Error("メモの端末データを読み取れません。端末のデータを保持して再試行してください。");
  return content;
}
function plainLine(value: string): string {
  return value
    .replace(/^\s*(?:#{1,6}\s+|(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s*)?|>\s*)/, "")
    .replace(/[*_`]/g, "")
    .trim();
}
export function noteTitle(content: Pick<NoteContent, "title" | "body">): string {
  return (
    content.title.trim() ||
    plainLine(content.body.split(/\r?\n/).find((line) => line.trim()) ?? "").slice(0, 100) ||
    "無題のメモ"
  );
}
export function summarizeNote(note: Note): NoteSummary {
  let taskCount = 0;
  let completedCount = 0;
  parser.parse(note.body).iterate({
    enter(node) {
      if (node.name !== "ListItem") return;
      const match = note.body
        .slice(node.from, node.from + 100)
        .match(/^(?:[-+*]|\d+[.)])\s+\[([ xX])\](?:\s|$)/);
      if (match) {
        taskCount++;
        if (match[1] !== " ") completedCount++;
      }
    },
  });
  const { body, ...metadata } = note;
  return {
    ...metadata,
    excerpt: body
      .slice(0, 600)
      .split(/\r?\n/)
      .map(plainLine)
      .filter(Boolean)
      .join("\n")
      .slice(0, 140),
    taskCount,
    completedCount,
  };
}
