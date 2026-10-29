import { test as base, expect, type Page, type Route } from "@playwright/test";
import type { Draft } from "../src/lib/drafts";
import { encodeNote, type Note, type NoteContent, type NoteMutation } from "../src/lib/notes";
import { noteDocument } from "../src/lib/note-sync";

const epoch = "notes-performance-test-epoch";
const timestamp = "2020-01-01T00:00:00.000Z";
const noteId = (index: number) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
const title = (index: number) => `検証用メモ ${String(index).padStart(3, "0")}`;
const editor = (page: Page) => page.getByRole("textbox", { name: "メモの本文", exact: true });

function cachedNotes(count: number): Note[] {
  const block =
    "# 架空の記録\n\n本文を変えずに表示を確認するための文章です。\n\n- [ ] 未完了\n- [x] 完了\n\n";
  const body = block.repeat(100).slice(0, 3000);
  return Array.from({ length: count }, (_, index) => ({
    id: noteId(index),
    title: title(index),
    body,
    pinned: index % 11 === 0,
    archived: false,
    version: 1,
    deletedAt: null,
    createdAt: timestamp,
    updatedAt: new Date(Date.UTC(2020, 0, 1, 0, 0, index)).toISOString(),
  }));
}

/** All API requests fail closed into this fake. No real backend or diary is used. */
class NotesNetwork {
  readonly notes = new Map<string, Note>();
  readonly unexpected: string[] = [];
  readonly pending: Route[] = [];
  holdQueries = false;
  posts = 0;
  releaseSession!: () => void;
  private readonly seeded = new Promise<void>((resolve) => {
    this.releaseSession = resolve;
  });

  async handle(route: Route) {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/session" && request.method() === "GET") {
      await this.seeded;
      await route.fulfill({ json: { authenticated: true, email: "local-development" } });
      return;
    }
    if (path === "/api/diaries" && request.method() === "GET") {
      await route.fulfill({ json: { items: [], nextCursor: null, epoch } });
      return;
    }
    if (path === "/api/notes/query" && request.method() === "POST") {
      if (this.holdQueries) this.pending.push(route);
      else await route.fulfill({ json: { items: [], nextCursor: null, epoch } });
      return;
    }
    if (/^\/api\/notes\/[0-9a-f-]{36}$/.test(path)) {
      const id = path.split("/").at(-1)!;
      const previous = this.notes.get(id);
      if (request.method() === "GET") {
        await route.fulfill({ json: { note: previous ?? null, epoch, absenceToken: null } });
        return;
      }
      if (request.method() === "POST") {
        const mutation = request.postDataJSON() as NoteMutation;
        this.posts++;
        if (
          !mutation.content ||
          !["create", "update"].includes(mutation.kind) ||
          mutation.epoch !== epoch ||
          mutation.expectedVersion !== (previous?.version ?? null)
        ) {
          this.unexpected.push("Invalid synthetic note mutation");
          await route.fulfill({ status: 400, json: { code: "INVALID_INPUT" } });
          return;
        }
        const note: Note = {
          ...mutation.content,
          id,
          version: (previous?.version ?? 0) + 1,
          deletedAt: null,
          createdAt: previous?.createdAt ?? timestamp,
          updatedAt: new Date().toISOString(),
        };
        this.notes.set(id, note);
        await route.fulfill({
          json: {
            note,
            epoch,
            absenceToken: null,
            mutationId: mutation.mutationId,
            appliedVersion: note.version,
            appliedNoteId: id,
            replayed: false,
          },
        });
        return;
      }
    }
    this.unexpected.push(`${request.method()} ${path}`);
    await route.fulfill({ status: 500, json: { code: "UNEXPECTED_TEST_ROUTE" } });
  }
}

const test = base.extend<{ network: NotesNetwork }>({
  network: async ({ page }, use) => {
    const network = new NotesNetwork();
    await page.route("**/api/**", (route) => network.handle(route));
    await use(network);
    network.releaseSession();
    for (const route of network.pending) await route.abort().catch(() => {});
    expect(network.unexpected).toEqual([]);
  },
});

async function start(page: Page, network: NotesNetwork, notes: Note[]) {
  for (const note of notes) network.notes.set(note.id, note);
  await page.goto("/");
  const drafts: Draft[] = notes.map((note) => ({
    date: note.id,
    body: encodeNote(note),
    revision: 1,
    diary: noteDocument(note),
    epoch,
    absenceToken: null,
    dirty: false,
    pending: null,
    problem: null,
    unsyncedSince: null,
    updatedAt: note.updatedAt,
    lastSyncedAt: note.updatedAt,
  }));
  await page.evaluate(async (records) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open("kiroku-note-drafts-v1", 1);
      opening.onupgradeneeded = () =>
        opening.result.createObjectStore("drafts", { keyPath: "date" });
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => resolve(opening.result);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("drafts", "readwrite");
      for (const record of records) transaction.objectStore("drafts").put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  }, drafts);
  network.releaseSession();
  await page
    .getByRole("navigation", { name: "メインナビゲーション" })
    .getByRole("button", { name: "メモ", exact: true })
    .click();
  await expect(page.locator(".notes-list")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".note-row")).toHaveCount(notes.length);
  expect(network.posts).toBe(0);
}

async function open(page: Page, name: string) {
  await page.getByRole("button", { name: `${name}をひらく`, exact: true }).click();
  await expect(page.locator(".note-heading").getByRole("status")).toHaveText("保存済み");
  await page.getByRole("tab", { name: "編集", exact: true }).click();
}

async function saved(page: Page) {
  await expect(page.locator(".note-heading").getByRole("status")).toHaveText("保存済み");
}

async function localContent(page: Page, id: string): Promise<NoteContent> {
  return page.evaluate(async (key) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open("kiroku-note-drafts-v1", 1);
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => resolve(opening.result);
    });
    const content = await new Promise<NoteContent>((resolve, reject) => {
      const request = database.transaction("drafts").objectStore("drafts").get(key);
      request.onsuccess = () => resolve(JSON.parse((request.result as Draft).body) as NoteContent);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return content;
  }, id);
}

test("editing among100 cached notes returns the latest complete content and ordering before remote lookup", async ({
  page,
  network,
}) => {
  await start(page, network, cachedNotes(100));
  const before = await page.locator(".note-row-title").allTextContents();
  await open(page, title(50));
  const body =
    "# 変更した抜粋\n\n- [ ] 残す用事\n- [x] 完了した用事\n\n" + "保存する原文。\n".repeat(400);
  await page.getByRole("textbox", { name: "メモのタイトル" }).fill("更新したメモ");
  await editor(page).fill(body);
  await page.getByRole("button", { name: "固定する", exact: true }).click();
  await saved(page);
  expect(network.notes.get(noteId(50))).toMatchObject({
    title: "更新したメモ",
    body,
    pinned: true,
  });
  expect(await localContent(page, noteId(50))).toEqual({
    title: "更新したメモ",
    body,
    pinned: true,
    archived: false,
  });
  network.holdQueries = true;
  await page.getByRole("button", { name: "メモに戻る", exact: true }).click();
  await expect(page.locator(".note-row-title")).toHaveText([
    "更新したメモ",
    ...before.filter((name) => name !== title(50)),
  ]);
  const updated = page.getByRole("button", { name: "更新したメモをひらく", exact: true });
  await expect(updated.locator(".note-row-excerpt")).toContainText("変更した抜粋");
  await expect(updated.locator(".note-tasks")).toHaveText("未完了 1件");
});

test("returning from editing preserves the query and applies changed archive metadata", async ({
  page,
  network,
}) => {
  const notes = cachedNotes(3);
  notes[0] = { ...notes[0], title: "検索語を含むメモ", body: "検索語の本文" };
  notes[1] = { ...notes[1], title: "検索語の別メモ", body: "そのまま残す本文" };
  await start(page, network, notes);
  const query = page.getByRole("searchbox", { name: "メモを検索" });
  await query.fill("検索語");
  await expect(page.locator(".note-row")).toHaveCount(2);
  await open(page, notes[0].title);
  await page.getByRole("textbox", { name: "メモのタイトル" }).fill("変更後のメモ");
  const body = "検索条件から外れる本文\n\n- [x] 完了した用事";
  await editor(page).fill(body);
  await saved(page);
  network.holdQueries = true;
  await page.getByRole("button", { name: "メモに戻る", exact: true }).click();
  await expect(query).toHaveValue("検索語");
  await expect(page.locator(".note-row-title")).toHaveText([notes[1].title]);
  await page.getByRole("button", { name: "検索をクリア", exact: true }).click();
  await expect(page.locator(".note-row")).toHaveCount(3);
  await open(page, "変更後のメモ");
  await page.getByRole("button", { name: "しまう", exact: true }).click();
  await expect(page.locator(".note-row")).toHaveCount(2);
  await page.getByRole("button", { name: "しまったメモ", exact: true }).click();
  await expect(page.locator(".note-row-title")).toHaveText(["変更後のメモ"]);
  await open(page, "変更後のメモ");
  await saved(page);
  expect(await localContent(page, notes[0].id)).toEqual({
    title: "変更後のメモ",
    body,
    pinned: true,
    archived: true,
  });
  await page.getByRole("button", { name: "メモに戻す", exact: true }).click();
  await expect(page.locator(".note-row")).toHaveCount(0);
  await page.locator(".notes-scope").getByRole("button", { name: "メモ", exact: true }).click();
  await expect(page.locator(".note-row")).toHaveCount(3);
});

test("a new note reappears with its complete original body when the remote list is stalled", async ({
  page,
  network,
}) => {
  await start(page, network, cachedNotes(3));
  await page.getByRole("button", { name: "メモを書く", exact: true }).click();
  await page.getByRole("textbox", { name: "メモのタイトル" }).fill("新しく残すメモ");
  const body = "一行目\n\n- [ ] 同じ用事\n- [x] 同じ用事\n\n末尾まで保存する原文。";
  await editor(page).fill(body);
  await saved(page);
  const created = [...network.notes.values()].find((note) => note.title === "新しく残すメモ");
  expect(created?.body).toBe(body);
  expect(await localContent(page, created!.id)).toEqual({
    title: "新しく残すメモ",
    body,
    pinned: false,
    archived: false,
  });
  network.holdQueries = true;
  await page.getByRole("button", { name: "メモに戻る", exact: true }).click();
  await expect(page.locator(".note-row")).toHaveCount(4);
  const row = page.getByRole("button", { name: "新しく残すメモをひらく", exact: true });
  await expect(row.locator(".note-tasks")).toHaveText("未完了 1件");
  await open(page, "新しく残すメモ");
  expect(await localContent(page, created!.id)).toMatchObject({ body });
});
