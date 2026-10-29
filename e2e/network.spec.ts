import { test as base, expect, type Page, type Route } from "@playwright/test";
import type { Diary, MutationRequest } from "../src/lib/types";
import type { Note, NoteMutation } from "../src/lib/notes";

const epoch = "network-test-epoch";
const date = "2081-11-01";
const timestamp = "2081-11-01T00:00:00.000Z";

/** Every API request is intercepted; these tests never read or mutate a real database. */
class MockNetwork {
  diaries = new Map<string, Diary>();
  notes = new Map<string, Note>();
  stallSession = false;
  stallList = false;
  stallDiaryReads = false;
  stallNoteReads = false;
  stallMutations = false;
  diaryReads = 0;
  noteReads = 0;
  listReads = 0;
  sessionReads = 0;
  pending: Route[] = [];
  oldQuery: Route | null = null;
  unexpected: string[] = [];

  hold(route: Route) {
    this.pending.push(route);
  }

  async handle(route: Route) {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === "/api/session") {
      this.sessionReads++;
      if (this.stallSession) return this.hold(route);
      await route.fulfill({ json: { authenticated: true, email: "local-development" } });
      return;
    }
    if (path === "/api/diaries") {
      this.listReads++;
      if (this.stallList) return this.hold(route);
      await route.fulfill({
        json: {
          items: [...this.diaries.values()].map(({ body: _body, ...diary }) => diary),
          nextCursor: null,
          epoch,
        },
      });
      return;
    }
    if (/^\/api\/diaries\/2081-\d{2}-\d{2}\/neighbors$/.test(path)) {
      await route.fulfill({ json: { previous: null, next: null } });
      return;
    }
    if (/^\/api\/diaries\/2081-\d{2}-\d{2}$/.test(path)) {
      const day = path.split("/").at(-1)!;
      if (request.method() === "GET") {
        this.diaryReads++;
        if (this.stallDiaryReads) return this.hold(route);
        await route.fulfill({
          json: { diary: this.diaries.get(day) ?? null, epoch, absenceToken: null },
        });
        return;
      }
      if (request.method() === "POST") {
        if (this.stallMutations) return this.hold(route);
        const mutation = request.postDataJSON() as MutationRequest;
        const previous = this.diaries.get(day);
        const diary: Diary = {
          id: previous?.id ?? `mock-${day}`,
          date: day,
          body: mutation.body ?? previous?.body ?? "",
          version: (previous?.version ?? 0) + 1,
          deletedAt: null,
          createdAt: previous?.createdAt ?? timestamp,
          updatedAt: timestamp,
        };
        this.diaries.set(day, diary);
        await route.fulfill({
          json: {
            diary,
            epoch,
            absenceToken: null,
            mutationId: mutation.mutationId,
            appliedVersion: diary.version,
            appliedDiaryId: diary.id,
            replayed: false,
          },
        });
        return;
      }
    }
    if (path === "/api/notes/query") {
      const { query } = request.postDataJSON() as { query: string };
      if (query === "old") {
        this.oldQuery = route;
        return this.hold(route);
      }
      await route.fulfill({
        json: {
          items: query === "new" ? [noteSummary("new result")] : [],
          nextCursor: null,
          epoch,
        },
      });
      return;
    }
    if (/^\/api\/notes\/[0-9a-f-]{36}$/.test(path)) {
      const id = path.split("/").at(-1)!;
      if (request.method() === "GET") {
        this.noteReads++;
        if (this.stallNoteReads) return this.hold(route);
        await route.fulfill({
          json: { note: this.notes.get(id) ?? null, epoch, absenceToken: null },
        });
        return;
      }
      if (request.method() === "POST") {
        if (this.stallMutations) return this.hold(route);
        const mutation = request.postDataJSON() as NoteMutation;
        const previous = this.notes.get(id);
        const note: Note = {
          ...(mutation.content ?? {
            title: "",
            body: "",
            pinned: false,
            archived: false,
          }),
          id,
          version: (previous?.version ?? 0) + 1,
          deletedAt: null,
          createdAt: previous?.createdAt ?? timestamp,
          updatedAt: timestamp,
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

function noteSummary(title: string) {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    title,
    excerpt: "synthetic query result",
    pinned: false,
    archived: false,
    version: 1,
    deletedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    taskCount: 0,
    completedCount: 0,
  };
}

const test = base.extend<{ network: MockNetwork }>({
  network: async ({ page }, use) => {
    const network = new MockNetwork();
    await page.route("**/api/**", (route) => network.handle(route));
    await use(network);
    for (const route of network.pending) await route.abort().catch(() => {});
    expect(network.unexpected).toEqual([]);
  },
});

async function chooseDate(page: Page, day: string) {
  await page.getByRole("button", { name: "日付を指定", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "日付を選ぶ", exact: true });
  const [year, month, date] = day.split("-").map(Number);
  await picker.getByLabel("年", { exact: true }).selectOption(String(year));
  await picker.getByLabel("月", { exact: true }).selectOption(String(month));
  await picker.getByRole("button", { name: new RegExp(`^${year}年${month}月${date}日 `) }).click();
}

async function localBodies(page: Page, databaseName = "kiroku-drafts-v1") {
  return page.evaluate(async (name) => {
    return new Promise<string[]>((resolve, reject) => {
      const opening = indexedDB.open(name, 1);
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const database = opening.result;
        const transaction = database.transaction("drafts");
        const read = transaction.objectStore("drafts").getAll();
        read.onsuccess = () => {
          resolve(read.result.map((draft: { body: string }) => draft.body));
          database.close();
        };
        read.onerror = () => {
          reject(read.error);
          database.close();
        };
      };
    });
  }, databaseName);
}

const diaryEditor = (page: Page) => page.getByRole("textbox", { name: "日記の本文", exact: true });

async function capture(page: Page, project: string, surface: string) {
  const directory = ".impeccable/review/network";
  await page.screenshot({ path: `${directory}/${project}-${surface}.png`, fullPage: true });
}

test("cached diary stays editable and navigation finishes while refresh stalls", async ({
  page,
  network,
}, info) => {
  network.diaries.set(date, {
    id: "cached-diary",
    date,
    body: "端末に残る本文",
    version: 1,
    deletedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await page.goto("/");
  await page.locator(".diary-row").click();
  await expect(diaryEditor(page)).toHaveText("端末に残る本文");
  await expect.poll(() => localBodies(page)).toContain("端末に残る本文");
  await page.getByRole("button", { name: "日記一覧に戻る", exact: true }).click();

  network.stallDiaryReads = true;
  network.stallMutations = true;
  const reads = network.diaryReads;
  await page.locator(".diary-row").click();
  await expect.poll(() => network.diaryReads).toBeGreaterThan(reads);
  await expect(diaryEditor(page)).toBeEditable({ timeout: 2500 });
  await capture(page, info.project.name, "checking");
  await diaryEditor(page).fill("通信待ちの間にも追記できます");
  await expect.poll(() => localBodies(page)).toContain("通信待ちの間にも追記できます");
  await page.getByRole("button", { name: "日記一覧に戻る", exact: true }).click();
  await expect(page.locator(".diary-list")).toBeVisible({ timeout: 2500 });
  await page.locator(".diary-row").click();
  await expect(diaryEditor(page)).toHaveText("通信待ちの間にも追記できます", { timeout: 2500 });
});

test("new diary can be written locally before its remote lookup finishes", async ({
  page,
  network,
}) => {
  network.stallDiaryReads = true;
  await page.goto("/");
  await chooseDate(page, date);
  await expect.poll(() => network.diaryReads).toBeGreaterThan(0);
  await expect(diaryEditor(page)).toBeEditable({ timeout: 2500 });
  await diaryEditor(page).fill("回線が遅い日の新しい記録");
  await expect.poll(() => localBodies(page)).toContain("回線が遅い日の新しい記録");
  await page.getByRole("tab", { name: "プレビュー", exact: true }).click();
  await expect(page.getByLabel("日記のプレビュー")).toContainText("回線が遅い日の新しい記録");
});

test("new note stays editable and locally saved during a stalled lookup", async ({
  page,
  network,
}) => {
  network.stallNoteReads = true;
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "メインナビゲーション" })
    .getByRole("button", { name: "メモ", exact: true })
    .click();
  await page.getByRole("button", { name: "メモを書く", exact: true }).click();
  await expect.poll(() => network.noteReads).toBeGreaterThan(0);
  await expect(page.getByRole("textbox", { name: "メモのタイトル" })).toBeEnabled({
    timeout: 2500,
  });
  await page.getByRole("textbox", { name: "メモのタイトル" }).fill("通信待ちのメモ");
  const editor = page.getByRole("textbox", { name: "メモの本文", exact: true });
  await expect(editor).toBeEditable({ timeout: 2500 });
  await editor.fill("タイトルと本文を端末に残します");
  await expect
    .poll(async () =>
      (await localBodies(page, "kiroku-note-drafts-v1")).map((body) => JSON.parse(body) as unknown),
    )
    .toContainEqual({
      title: "通信待ちのメモ",
      body: "タイトルと本文を端末に残します",
      pinned: false,
      archived: false,
    });
  await page.getByRole("button", { name: "メモに戻る", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "通信待ちのメモをひらく", exact: true }),
  ).toBeVisible({
    timeout: 2500,
  });
});

test("stalled list reaches its deadline and offers a working retry", async ({
  page,
  network,
}, info) => {
  network.stallList = true;
  await page.goto("/");
  await expect.poll(() => network.listReads).toBeGreaterThan(0);
  await expect(page.getByRole("alert", { name: "一覧を読み込めませんでした" })).toBeVisible({
    timeout: 20_000,
  });
  const retry = page.getByRole("button", { name: "一覧を読み直す", exact: true });
  await expect(retry).toBeEnabled();
  await capture(page, info.project.name, "list-timeout");
  network.stallList = false;
  await retry.click();
  await expect(page.getByRole("alert", { name: "一覧を読み込めませんでした" })).not.toBeVisible();
  await expect(page.getByText("日記はまだありません", { exact: true })).toBeVisible();
});

test("stalled initial authentication reaches its deadline and recovers on retry", async ({
  page,
  network,
}) => {
  network.stallSession = true;
  await page.goto("/");
  await expect.poll(() => network.sessionReads).toBeGreaterThan(0);
  await expect(
    page.getByRole("alert", { name: "アプリに接続できません", exact: true }),
  ).toBeVisible({
    timeout: 20_000,
  });
  const retry = page.getByRole("button", { name: "もう一度接続する", exact: true });
  await expect(retry).toBeEnabled();
  network.stallSession = false;
  await retry.click();
  await expect(page.getByRole("heading", { name: "日記一覧", exact: true })).toBeVisible();
});

test("superseded note search cannot replace the latest results", async ({ page, network }) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "メインナビゲーション" })
    .getByRole("button", { name: "メモ", exact: true })
    .click();
  const search = page.getByRole("searchbox", { name: "メモを検索" });
  await search.fill("old");
  await expect.poll(() => network.oldQuery !== null).toBe(true);
  await search.fill("new");
  await expect(page.getByRole("button", { name: "new resultをひらく", exact: true })).toBeVisible();
  await network
    .oldQuery!.fulfill({ json: { items: [noteSummary("old result")], nextCursor: null, epoch } })
    .catch(() => {});
  await expect(page.getByRole("button", { name: "new resultをひらく", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "old resultをひらく", exact: true })).toHaveCount(
    0,
  );
});
