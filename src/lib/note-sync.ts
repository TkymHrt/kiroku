import { createDraftRepository } from "./drafts";
import { DiarySyncEngine, type SyncOptions } from "./sync";
import { bodyBytes, type Diary } from "./types";
import {
  decodeNote,
  encodeNote,
  type Note,
  type NoteMutation,
  type NoteMutationResponse,
  type NoteState,
} from "./notes";

/** Translate notes to the existing, tested version/receipt/epoch protocol internally.
 * The opaque queue key is a note UUID; diary queues and browser channels stay separate.
 */
export function noteDocument(note: Note): Diary {
  return {
    id: note.id,
    date: note.id,
    body: encodeNote(note),
    version: note.version,
    deletedAt: note.deletedAt,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}
export function createNoteSyncEngine(options: SyncOptions = {}): DiarySyncEngine {
  const fetcher =
    options.fetcher ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  return new DiarySyncEngine({
    ...options,
    repository: options.repository ?? createDraftRepository("kiroku-note-drafts-v1"),
    channelName: "kiroku-note-draft-changes",
    measureBody: (body) => bodyBytes(decodeNote(body).body),
    fetcher: async (input, init) => {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
      const id = url.split("/").at(-1)!;
      let body: string | undefined;
      if (init?.body) {
        if (typeof init.body !== "string") throw new TypeError("Expected a JSON mutation");
        const { body: source, ...mutation } = JSON.parse(init.body) as {
          body?: string;
        } & NoteMutation;
        body = JSON.stringify({
          ...mutation,
          ...(source !== undefined ? { content: decodeNote(source) } : {}),
        });
      }
      const response = await fetcher(`/api/notes/${id}`, {
        ...init,
        ...(body !== undefined ? { body } : {}),
      });
      if (!response.headers.get("content-type")?.includes("application/json")) return response;
      const data = (await response.json()) as NoteState & Partial<NoteMutationResponse>;
      const mapped = {
        ...data,
        ...(data.note !== undefined
          ? { diary: data.note === null ? null : noteDocument(data.note) }
          : {}),
        ...(data.appliedNoteId !== undefined ? { appliedDiaryId: data.appliedNoteId } : {}),
      };
      return new Response(JSON.stringify(mapped), {
        status: response.status,
        headers: response.headers,
      });
    },
  });
}
