import { mkdir, readFile } from "node:fs/promises";
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import type { Note, NoteContent, NoteListResponse, NoteState } from "../src/lib/notes";

const origin = "http://127.0.0.1:5173";
const headers = { Origin: origin, "X-Kiroku-CSRF": "1", "Content-Type": "application/json" };
async function state(request: APIRequestContext, id: string): Promise<NoteState> {
  const response = await request.get(`/api/notes/${id}`);
  expect(response.ok()).toBe(true);
  return response.json() as Promise<NoteState>;
}
async function mutate(
  request: APIRequestContext,
  id: string,
  kind: "create" | "update" | "trash" | "restore" | "purge",
  content?: NoteContent,
): Promise<Note | null> {
  const current = await state(request, id);
  const response = await request.post(`/api/notes/${id}`, {
    headers,
    data: {
      mutationId: crypto.randomUUID(),
      kind,
      id: current.note?.id ?? null,
      expectedVersion: current.note?.version ?? null,
      epoch: current.epoch,
      ...(kind === "create" ? { absenceToken: current.absenceToken } : {}),
      ...(content ? { content } : {}),
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as NoteState).note;
}
async function notes(page: Page) {
  await page
    .getByRole("navigation", { name: "メインナビゲーション" })
    .getByRole("button", { name: "メモ", exact: true })
    .click();
}
async function clean(request: APIRequestContext, id: string) {
  const current = await state(request, id);
  if (!current.note) return;
  if (!current.note.deletedAt) await mutate(request, id, "trash");
  await mutate(request, id, "purge");
}
async function source(page: Page, body: string) {
  const edit = page.getByRole("tab", { name: "編集", exact: true });
  if ((await edit.getAttribute("aria-selected")) !== "true") await edit.click();
  const editor = page.getByRole("textbox", { name: "メモの本文", exact: true });
  await editor.fill(body);
}
async function saved(page: Page) {
  await expect(page.locator(".note-heading").getByRole("status")).toHaveText("保存済み");
}

test("notes create check pin archive restore and export preserve the original Markdown", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const ids: string[] = [];
  try {
    await page.goto("/");
    await notes(page);
    const create = page.getByRole("button", { name: "メモを書く", exact: true });
    await expect(create).toBeVisible();
    await expect(create.locator("svg")).toHaveCount(1);
    await expect(create.locator("svg")).toBeVisible();
    await create.click();
    await expect(page.getByRole("textbox", { name: "メモのタイトル" })).toBeEnabled();
    await expect(page.getByRole("tab", { name: "編集", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const response = page.waitForResponse(
      (res) =>
        res.url().includes("/api/notes/") &&
        !res.url().includes("/query") &&
        res.request().method() === "POST",
    );
    await page.getByRole("textbox", { name: "メモのタイトル" }).fill("検証用の買い物");
    await source(page, "- [ ] 同じ項目\n- [ ] 同じ項目\n\n残しておく文章");
    const created = (await (await response).json()) as NoteState;
    const id = created.note!.id;
    ids.push(id);
    await saved(page);
    await page.getByRole("button", { name: "固定する", exact: true }).click();
    await saved(page);
    await page.getByRole("tab", { name: "プレビュー", exact: true }).click();
    await page.getByRole("checkbox").nth(1).check();
    await saved(page);
    expect((await state(request, id)).note?.body).toBe(
      "- [ ] 同じ項目\n- [x] 同じ項目\n\n残しておく文章",
    );
    await page.getByRole("tab", { name: "編集", exact: true }).click();
    await page.getByRole("button", { name: "メモに戻る", exact: true }).click();
    await expect(page.locator(".notes-list")).toContainText("未完了 1件");
    await page.getByRole("button", { name: "検証用の買い物をひらく", exact: true }).click();
    await expect(page.getByRole("tab", { name: "プレビュー" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByRole("button", { name: "しまう", exact: true }).click();
    await expect(page.locator(".notes-tools")).toBeVisible();
    await page.getByRole("button", { name: "しまったメモ", exact: true }).click();
    await page.getByRole("button", { name: "検証用の買い物をひらく", exact: true }).click();
    await saved(page);
    await page.getByRole("button", { name: "メモに戻す", exact: true }).click();
    await page.locator(".notes-scope").getByRole("button", { name: "メモ", exact: true }).click();
    await page.getByRole("button", { name: "検証用の買い物をひらく", exact: true }).click();
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Markdown保存", exact: true }).click();
    const file = await downloadEvent;
    expect(await readFile((await file.path())!, "utf8")).toBe(
      (await state(request, id)).note!.body,
    );
    await page.getByRole("button", { name: "ゴミ箱へ移動", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "ゴミ箱へ移動", exact: true })
      .click();
    await page.locator(".notes-scope").getByRole("button", { name: "ゴミ箱", exact: true }).click();
    await page.getByRole("button", { name: "検証用の買い物をひらく", exact: true }).click();
    await page.getByRole("button", { name: "復元する", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "復元する", exact: true }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await saved(page);
    expect((await state(request, id)).note).toMatchObject({
      pinned: true,
      archived: false,
      deletedAt: null,
    });
  } finally {
    for (const id of ids) await clean(request, id);
  }
});

test("notes keep offline drafts and stop on conflicts across two browser contexts", async ({
  page,
  context,
  browser,
  request,
}) => {
  test.setTimeout(90_000);
  const id = `test-note-2081-${crypto.randomUUID()}`;
  await mutate(request, id, "create", {
    title: "同期の検証",
    body: "元の本文",
    pinned: false,
    archived: false,
  });
  const other = await browser.newContext();
  try {
    await page.goto("/");
    await notes(page);
    await page.getByRole("button", { name: "同期の検証をひらく" }).click();
    await saved(page);
    const second = await other.newPage();
    await second.goto(origin);
    await notes(second);
    await second.getByRole("button", { name: "同期の検証をひらく" }).click();
    await saved(second);
    await context.setOffline(true);
    await source(page, "端末に残す本文\n- [ ] やること");
    await expect(page.locator(".note-heading").getByRole("status")).toHaveText(
      /端末保存済み|未同期/,
    );
    await source(second, "別の端末の本文");
    await saved(second);
    await context.setOffline(false);
    await expect(page.getByRole("heading", { name: "この端末のメモ", exact: true })).toBeVisible();
    await expect(page.locator(".note-conflict")).toContainText("端末に残す本文");
    await expect(page.locator(".note-conflict")).toContainText("別の端末の本文");
    await page.getByRole("button", { name: "端末版を採用", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "端末版を採用", exact: true })
      .click();
    await saved(page);
    expect((await state(request, id)).note?.body).toBe("端末に残す本文\n- [ ] やること");
    await page.reload();
    await notes(page);
    await page.getByRole("button", { name: "同期の検証をひらく" }).click();
    await expect(page.getByRole("tab", { name: "プレビュー", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("article", { name: "メモのプレビュー" })).toContainText(
      "端末に残す本文",
    );
    await page.getByRole("tab", { name: "編集", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "メモの本文", exact: true }).locator(".cm-line"),
    ).toHaveText(["端末に残す本文", "- [ ] やること"]);
  } finally {
    await context.setOffline(false);
    await other.close();
    await clean(request, id);
  }
});

test("notes checkboxes expose their own text and preserve repeated and nested source positions", async ({
  page,
  request,
}) => {
  const id = `test-note-2081-${crypto.randomUUID()}`;
  const body = "- [ ] 準備\n  - [ ] 子の用事\n- [ ] 同じ項目\n- [ ] 同じ項目";
  await mutate(request, id, "create", {
    title: "チェックの読み上げ検証",
    body,
    pinned: false,
    archived: false,
  });
  try {
    await page.goto("/");
    await notes(page);
    await page.getByRole("button", { name: "チェックの読み上げ検証をひらく" }).click();
    await saved(page);
    await page.getByRole("tab", { name: "プレビュー", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: "準備", exact: true })).toHaveCount(1);
    await expect(page.getByRole("checkbox", { name: "同じ項目", exact: true })).toHaveCount(2);
    await page.getByRole("checkbox", { name: "子の用事", exact: true }).focus();
    await page.keyboard.press("Space");
    await saved(page);
    await page.getByRole("checkbox", { name: "同じ項目", exact: true }).nth(1).check();
    await saved(page);
    await expect(page.getByRole("checkbox", { name: "準備", exact: true })).not.toBeChecked();
    expect((await state(request, id)).note?.body).toBe(
      "- [ ] 準備\n  - [x] 子の用事\n- [ ] 同じ項目\n- [x] 同じ項目",
    );
    for (const box of await page.locator(".task-toggle").all()) {
      const bounds = await box.boundingBox();
      expect(bounds!.width).toBeGreaterThanOrEqual(44);
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }
  } finally {
    await clean(request, id);
  }
});

test("notes review screenshots use synthetic content and fit desktop and mobile", async ({
  page,
  request,
}, info) => {
  const ids = [0, 1, 2].map(() => `test-note-2081-${crypto.randomUUID()}`);
  try {
    await page.route("**/api/notes/query", async (route) => {
      const response = await route.fetch();
      const data = (await response.json()) as NoteListResponse;
      for (const item of data.items) {
        if (item.id === ids[0]) item.updatedAt = "2025-12-31T14:59:00.000Z";
        if (item.id === ids[1]) item.updatedAt = "2025-12-31T15:00:00.000Z";
      }
      await route.fulfill({ response, json: data });
    });
    await mutate(request, ids[0], "create", {
      title: "週末に調べたいこと",
      body: "自転車のブレーキ調整。近所のお店と、家でできる手入れを調べる。",
      pinned: false,
      archived: false,
    });
    await mutate(request, ids[1], "create", {
      title: "次の休みに",
      body: "気になっていた喫茶店へ。\n読みかけの本を一冊持っていく。",
      pinned: false,
      archived: false,
    });
    await mutate(request, ids[2], "create", {
      title: "買い物",
      body: "帰りにスーパーで買うもの。\n\n- [x] 牛乳\n- [ ] 洗剤\n- [ ] コーヒー豆\n\nコーヒーは、いつもの深煎りを。",
      pinned: true,
      archived: false,
    });
    await page.goto("/");
    await notes(page);
    await expect(page.getByRole("button", { name: "買い物をひらく" })).toBeVisible();
    await expect(page.locator(".notes-page-heading, .notes-count")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "メモ", exact: true })).toHaveClass("sr-only");
    await page.getByRole("searchbox", { name: "メモを検索" }).fill("深煎り");
    await expect(page.locator(".note-row")).toHaveCount(1);
    await page.getByRole("button", { name: "検索をクリア" }).click();
    await expect(page.locator(".note-row")).toHaveCount(3);
    await expect(page.locator(".notes-list")).toContainText("未完了 2件");
    await expect(
      page.getByRole("button", { name: "週末に調べたいことをひらく" }).locator("time"),
    ).toHaveText("2025/12/31");
    await expect(
      page.getByRole("button", { name: "次の休みにをひらく" }).locator("time"),
    ).toHaveText("2026/01/01");
    for (const time of await page.locator(".note-row time").all())
      await expect(time).toHaveText(/^\d{4}\/\d{2}\/\d{2}$/);
    if (info.project.name === "mobile") {
      await page.setViewportSize({ width: 320, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      for (const time of await page.locator(".note-row time").all())
        await expect(time).toHaveCSS("white-space", "nowrap");
      await page.setViewportSize({ width: 390, height: 844 });
    }
    await mkdir(".impeccable/review", { recursive: true });
    await page.screenshot({ path: `.impeccable/review/${info.project.name}.png`, fullPage: true });
    await page.getByRole("button", { name: "買い物をひらく" }).click();
    await saved(page);
    await page.getByRole("tab", { name: "プレビュー", exact: true }).click();
    await expect(page.getByRole("checkbox")).toHaveCount(3);
    await page.screenshot({
      path: `.impeccable/review/${info.project.name}-checklist.png`,
      fullPage: true,
    });
    if (info.project.name === "mobile") {
      await page.setViewportSize({ width: 320, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  } finally {
    for (const id of ids) await clean(request, id);
  }
});
