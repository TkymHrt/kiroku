import { readFileSync, readdirSync } from "node:fs";
import { Miniflare } from "miniflare";
import { IDBFactory } from "fake-indexeddb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  getNoteState,
  listNotes,
  mutateNote,
  noteErrorResponse,
  validateNoteMutation,
} from "./notes";
import { getEpoch, getExportPage } from "./diaries";
import {
  type Note,
  type NoteMutation,
  decodeNote,
  encodeNote,
  summarizeNote,
} from "../src/lib/notes";
import { createNoteSyncEngine } from "../src/lib/note-sync";
import { DraftRepository } from "../src/lib/drafts";

describe("independent notes and durable mutations", () => {
  let runtime: Miniflare;
  let db: D1Database;
  let epoch: string;
  beforeAll(async () => {
    runtime = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("test"); } }',
      compatibilityDate: "2026-02-24",
      d1Databases: { DB: "note-tests" },
    });
    db = (await runtime.getD1Database("DB")) as unknown as D1Database;
    const directory = new URL("../db/migrations/", import.meta.url);
    for (const name of readdirSync(directory)
      .filter((file) => file.endsWith(".sql"))
      .sort()) {
      for (const statement of readFileSync(new URL(name, directory), "utf8")
        .split(";")
        .filter((part) => part.trim()))
        await db.prepare(statement).run();
    }
  }, 30_000);
  afterAll(async () => {
    await runtime?.dispose();
  });
  beforeEach(async () => {
    epoch = crypto.randomUUID();
    await db.batch([
      db.prepare("DELETE FROM notes"),
      db.prepare("DELETE FROM note_mutation_receipts"),
      db.prepare("UPDATE app_meta SET value = ? WHERE key = 'database_epoch'").bind(epoch),
    ]);
  });
  const create = (body = "メモの本文", title = "メモ"): NoteMutation => ({
    mutationId: crypto.randomUUID(),
    kind: "create",
    id: null,
    expectedVersion: null,
    epoch,
    absenceToken: null,
    content: { title, body, pinned: false, archived: false },
  });
  const operation = (
    note: Note,
    kind: NoteMutation["kind"],
    content = { title: note.title, body: note.body, pinned: note.pinned, archived: note.archived },
  ): NoteMutation => ({
    mutationId: crypto.randomUUID(),
    kind,
    id: note.id,
    expectedVersion: note.version,
    epoch,
    ...(kind === "update"
      ? {
          content: {
            title: content.title,
            body: content.body,
            pinned: content.pinned,
            archived: content.archived,
          },
        }
      : {}),
  });

  it("opens an empty note without creating it; stores multiple independent UUIDs and titles", async () => {
    const id = crypto.randomUUID();
    expect((await getNoteState(db, id)).note).toBeNull();
    expect((await listNotes(db, {})).items).toEqual([]);
    await mutateNote(db, id, create("- [ ] 買う\n- [x] 済み"));
    await mutateNote(db, crypto.randomUUID(), create("", "タイトルのみ"));
    const listed = await listNotes(db, {});
    expect(listed.items).toHaveLength(2);
    expect(listed.items.find((item) => item.id === id)).toMatchObject({
      taskCount: 2,
      completedCount: 1,
    });
    expect(listed.items.every((item) => !("body" in item))).toBe(true);
  });
  it("deduplicates lost responses and rejects an ID reused with different metadata", async () => {
    const id = crypto.randomUUID();
    const request = create();
    await mutateNote(db, id, request);
    expect((await mutateNote(db, id, request)).replayed).toBe(true);
    await expect(
      mutateNote(db, id, { ...request, content: { ...request.content!, pinned: true } }),
    ).rejects.toMatchObject({ code: "MUTATION_ID_REUSED" });
    expect((await getNoteState(db, id)).note?.version).toBe(1);
  });
  it("checks versions for title, body, pin and archive together", async () => {
    const id = crypto.randomUUID();
    const original = (await mutateNote(db, id, create())).note!;
    const pinned = (
      await mutateNote(
        db,
        id,
        operation(original, "update", { ...original, pinned: true, title: "固定したメモ" }),
      )
    ).note!;
    await expect(
      mutateNote(db, id, operation(original, "update", { ...original, body: "古い端末" })),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const archived = (
      await mutateNote(db, id, operation(pinned, "update", { ...pinned, archived: true }))
    ).note!;
    expect((await listNotes(db, { scope: "active" })).items).toEqual([]);
    expect((await listNotes(db, { scope: "archived", query: "固定" })).items[0].id).toBe(
      archived.id,
    );
  });
  it("never resurrects a purged UUID through replay, stale update or new create", async () => {
    const id = crypto.randomUUID();
    const initial = create();
    const note = (await mutateNote(db, id, initial)).note!;
    const trash = (await mutateNote(db, id, operation(note, "trash"))).note!;
    const purge = operation(trash, "purge");
    await mutateNote(db, id, purge);
    expect((await mutateNote(db, id, initial)).note).toBeNull();
    expect((await mutateNote(db, id, purge)).replayed).toBe(true);
    await expect(mutateNote(db, id, operation(note, "update"))).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(mutateNote(db, id, create())).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await getNoteState(db, id)).absenceToken).toBe(purge.mutationId);
  });
  it("restores to the original archive state and rejects writes after epoch rotation", async () => {
    const id = crypto.randomUUID();
    const request = create();
    request.content!.archived = true;
    const note = (await mutateNote(db, id, request)).note!;
    const trash = (await mutateNote(db, id, operation(note, "trash"))).note!;
    const restored = (await mutateNote(db, id, operation(trash, "restore"))).note!;
    expect(restored.archived).toBe(true);
    await db
      .prepare("UPDATE app_meta SET value = ? WHERE key = 'database_epoch'")
      .bind(crypto.randomUUID())
      .run();
    await expect(mutateNote(db, id, operation(restored, "update"))).rejects.toMatchObject({
      code: "EPOCH_CHANGED",
    });
  });
  it("keeps original Markdown bytes, excludes code fences from checklist counts and bounds input", async () => {
    const id = crypto.randomUUID();
    const body = "- [ ] 同じ\r\n- [x] 同じ\r\n```md\n- [ ] コード\n```\n\u0000🍵";
    const note = (await mutateNote(db, id, create(body))).note!;
    expect(note.body).toBe(body);
    expect(summarizeNote(note)).toMatchObject({ taskCount: 2, completedCount: 1 });
    const limit = "日".repeat(333_333) + "a";
    expect((await mutateNote(db, crypto.randomUUID(), create(limit))).note?.body).toBe(limit);
    expect(() => validateNoteMutation(create(limit + "x"))).toThrow();
    expect(() => validateNoteMutation(create("", ""))).toThrow();
    expect(() =>
      validateNoteMutation({
        ...create(),
        content: { ...create().content, title: "x".repeat(201) },
      }),
    ).toThrow();
  });
  it("exports notes at the same snapshot and detects note changes during diary export", async () => {
    const id = crypto.randomUUID();
    const note = (await mutateNote(db, id, create("原文\r\n🍵"))).note!;
    const first = await getExportPage(db);
    const exported = await getExportPage(db, "", first.snapshotToken, "");
    expect(exported.formatVersion).toBe(3);
    expect(exported.notes).toEqual([note]);
    await mutateNote(db, id, operation(note, "update", { ...note, archived: true }));
    await expect(getExportPage(db, "", first.snapshotToken, "")).rejects.toMatchObject({
      code: "EXPORT_CHANGED",
    });
  });
  it("replays the frozen envelope after a lost response before saving newer text and pin state", async () => {
    const repository = new DraftRepository(crypto.randomUUID(), new IDBFactory());
    const id = crypto.randomUUID();
    let lose = true;
    let clock = Date.now();
    const sent: NoteMutation[] = [];
    const engine = createNoteSyncEngine({
      repository,
      browserEvents: false,
      debounceMs: 1_000_000,
      now: () => clock,
      fetcher: async (_input, init) => {
        try {
          if (init?.method !== "POST") return Response.json(await getNoteState(db, id));
          const input = JSON.parse(init.body as string) as NoteMutation;
          sent.push(input);
          const result = await mutateNote(db, id, input);
          if (lose) {
            lose = false;
            throw new TypeError("lost response");
          }
          return Response.json(result);
        } catch (error) {
          if (error instanceof TypeError) throw error;
          return noteErrorResponse(error);
        }
      },
    });
    try {
      await engine.start();
      await engine.open(id);
      await engine.edit(
        id,
        encodeNote({ title: "最初", body: "- [ ] 買う", pinned: false, archived: false }),
      );
      await engine.retry(id);
      expect(engine.getDraft(id)?.pending).not.toBeNull();
      await engine.edit(
        id,
        encodeNote({ title: "新しいタイトル", body: "- [x] 買う", pinned: true, archived: false }),
      );
      clock += 5000;
      await engine.retry(id);
      await engine.retry(id);
      expect(sent[1]).toEqual(sent[0]);
      expect((await getNoteState(db, id)).note).toMatchObject({
        title: "新しいタイトル",
        body: "- [x] 買う",
        pinned: true,
        version: 2,
      });
      expect(decodeNote(engine.getDraft(id)!.body).pinned).toBe(true);
      expect(engine.getStatus(id)).toBe("saved");
      expect(await getEpoch(db)).toBe(epoch);
    } finally {
      engine.stop();
      repository.close();
    }
  });
});
