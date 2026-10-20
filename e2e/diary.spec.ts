import { mkdir, readFile } from "node:fs/promises";
import { test as base, expect, type APIRequestContext, type Page } from "@playwright/test";
import type {
  Diary,
  DiaryResponse,
  MutationKind,
  MutationRequest,
  MutationResponse,
} from "../src/lib/types";
import { tokyoToday } from "../src/lib/types";

const origin = "http://127.0.0.1:5173";
const titles = [
  "opening is read-only until input, then autosaves once per date",
  "source cursor survives preview and duplicate tasks toggle exactly one marker",
  "preview escapes HTML and blocks image fetches and unsafe schemes",
  "offline edits survive closing the page and sync after reopening",
  "two devices preserve both versions and resolve an update conflict",
  "clearing a saved diary retains its empty server record",
  "trash restore purge and a stale device never silently recreate a diary",
  "unsynced source can be copied and downloaded without server success",
  "JSON export includes trashed diaries and their deletion state",
  "authentication expiry preserves editing and local copy access",
  "explicit logout hides diary DOM across tabs and retains unsynced IndexedDB text",
  "calendar selection uses Japanese date order in an English browser and cancel preserves the diary",
  "compact diary navigation keeps the working content within the first mobile viewport",
  "initial connection errors explain recovery without showing browser exceptions",
  "list errors offer recovery and safe error information with manual copy fallback",
  "sync errors keep local writing and offer nearby copy download and retry actions",
  "export errors retry the export without exposing server diagnostics",
  "local storage errors protect the current text and prevent accidental navigation",
  "diary read errors explain unavailable content and retry without changing the server version",
  "server retry deadlines explain the wait and reenable diary recovery automatically",
];

async function getDiary(request: APIRequestContext, date: string): Promise<DiaryResponse> {
  const response = await request.get(`/api/diaries/${date}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json() as Promise<DiaryResponse>;
}

async function mutate(
  request: APIRequestContext,
  date: string,
  kind: MutationKind,
  body?: string,
): Promise<MutationResponse> {
  const { diary, epoch, absenceToken } = await getDiary(request, date);
  const operation: MutationRequest = {
    mutationId: crypto.randomUUID(),
    kind,
    id: diary?.id ?? null,
    expectedVersion: diary?.version ?? null,
    epoch,
    ...(kind === "create" ? { absenceToken } : {}),
    ...(body !== undefined ? { body } : {}),
  };
  const response = await request.post(`/api/diaries/${date}`, {
    headers: { Origin: origin, "X-Kiroku-CSRF": "1", "Content-Type": "application/json" },
    data: operation,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json() as Promise<MutationResponse>;
}

/** Only the reserved date belonging to the current test is ever cleaned up. */
async function clean(request: APIRequestContext, date: string): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { diary } = await getDiary(request, date);
    if (!diary) return;
    if (!diary.deletedAt) await mutate(request, date, "trash");
    await mutate(request, date, "purge");
  }
  expect((await getDiary(request, date)).diary).toBeNull();
}

const test = base.extend<{ diaryDate: string }>({
  diaryDate: async ({ request, context }, use, info) => {
    const day = String(titles.indexOf(info.title) + 1).padStart(2, "0");
    const date = `${info.project.name === "mobile" ? "2081" : "2080"}-10-${day}`;
    if (day === "00")
      throw new Error("Unregistered test title: refusing to touch an unreserved date");
    await clean(request, date);
    await use(date);
    for (const page of context.pages()) await page.close();
    await clean(request, date);
  },
});

async function enter(page: Page, date: string): Promise<void> {
  await page.goto("/");
  await chooseDate(page, date);
  await expect(page.getByLabel("日記の本文")).toBeVisible();
  await expect(
    page.getByRole("button", { name: `日付を変更: ${date.replaceAll("-", "/")}`, exact: true }),
  ).toBeVisible();
}

async function chooseDate(page: Page, date: string, label = "日付を指定"): Promise<void> {
  const trigger =
    label === "日付を指定"
      ? page.getByRole("button", { name: label, exact: true })
      : page.getByRole("button", { name: new RegExp(`^${label}:`) });
  await trigger.click();
  const picker = page.getByRole("dialog", { name: "日付を選ぶ", exact: true });
  await expect(picker).toBeVisible();
  const [year, month, day] = date.split("-").map(Number);
  await picker.getByLabel("年", { exact: true }).selectOption(String(year));
  await picker.getByLabel("月", { exact: true }).selectOption(String(month));
  await picker.getByRole("button", { name: new RegExp(`^${year}年${month}月${day}日 `) }).click();
  await expect(picker).not.toBeVisible();
}

const source = (page: Page) => page.getByLabel("日記の本文");
const diaryRow = (page: Page, date: string) => {
  const [year, month, day] = date.split("-").map(Number);
  return page.getByRole("button", {
    name: new RegExp(`^${year}年${month}月${day}日.*の日記をひらく$`),
  });
};
async function sourceText(page: Page): Promise<string> {
  return source(page)
    .locator(".cm-line")
    .allTextContents()
    .then((lines) => lines.join("\n"));
}

async function saved(request: APIRequestContext, date: string, body: string): Promise<Diary> {
  await expect.poll(async () => (await getDiary(request, date)).diary?.body).toBe(body);
  return (await getDiary(request, date)).diary!;
}

async function localText(page: Page, date: string): Promise<string | undefined> {
  return page.evaluate(async (date) => {
    return new Promise<string | undefined>((resolve, reject) => {
      const opening = indexedDB.open("kiroku-drafts-v1", 1);
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const database = opening.result;
        const read = database.transaction("drafts").objectStore("drafts").get(date);
        read.onsuccess = () => {
          resolve(read.result?.body);
          database.close();
        };
        read.onerror = () => {
          reject(read.error);
          database.close();
        };
      };
    });
  }, date);
}

async function captureError(page: Page, project: string, surface: string): Promise<void> {
  if (process.env.KIROKU_CAPTURE_ERRORS !== "1") return;
  const directory = ".impeccable/review/error-refine";
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: `${directory}/${project}-${surface}.png`, fullPage: true });
}

async function confirm(page: Page, action: string): Promise<void> {
  await page.getByRole("dialog").getByRole("button", { name: action, exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
}

test(titles[0], async ({ page, request, diaryDate }) => {
  await enter(page, diaryDate);
  expect((await getDiary(request, diaryDate)).diary).toBeNull();
  await expect(page.getByText("まだ記録されていません", { exact: true })).toBeVisible();
  await source(page).fill("短い記録\n日本語の追記です。");
  const diary = await saved(request, diaryDate, "短い記録\n日本語の追記です。");
  expect(diary.version).toBe(1);
  await expect(page.locator(".diary-heading .save-state")).toHaveText("保存済み");
  await page.getByRole("button", { name: "日記一覧に戻る", exact: true }).click();
  await expect(diaryRow(page, diaryDate)).toHaveCount(1);
});

test(titles[1], async ({ page, request, diaryDate }) => {
  await enter(page, diaryDate);
  await source(page).fill("abcdef");
  await source(page).press("Control+Home");
  await source(page).press("ArrowRight");
  await source(page).press("ArrowRight");
  await page.getByRole("tab", { name: "プレビュー", exact: true }).click();
  await expect(page.getByLabel("日記のプレビュー")).toContainText("abcdef");
  await page.getByRole("tab", { name: "編集", exact: true }).click();
  await source(page).press("X");
  await expect.poll(() => sourceText(page)).toBe("abXcdef");
  const taskBody = "前文\n続き\n\n- [ ] 同じ項目\n  説明の続き\n- [ ] 同じ項目";
  await source(page).fill(taskBody);
  await page.getByRole("tab", { name: "プレビュー", exact: true }).click();
  const preview = page.getByLabel("日記のプレビュー");
  await expect(preview.locator("br")).toHaveCount(2);
  const checkboxes = preview.getByRole("checkbox");
  await expect(checkboxes).toHaveCount(2);
  await checkboxes.nth(1).check();
  await expect(checkboxes.nth(0)).not.toBeChecked();
  await expect(checkboxes.nth(1)).toBeChecked();
  const checkedBody = "前文\n続き\n\n- [ ] 同じ項目\n  説明の続き\n- [x] 同じ項目";
  await saved(request, diaryDate, checkedBody);
  await page.getByRole("tab", { name: "編集", exact: true }).click();
  await expect.poll(() => sourceText(page)).toBe(checkedBody);
});

test(titles[2], async ({ page, context, diaryDate }) => {
  let imageRequests = 0;
  await context.route("https://example.invalid/**", (route) => {
    imageRequests++;
    return route.abort();
  });
  await enter(page, diaryDate);
  await source(page).fill(
    '<script>window.__diaryXss = true</script>\n\n<img src="https://example.invalid/raw.png" onerror="window.__diaryXss=true">\n\n![外部画像](https://example.invalid/markdown.png)\n\n[危険なリンク](javascript:alert(1))\n\n[安全なリンク](https://example.com/)',
  );
  await page.getByRole("tab", { name: "プレビュー", exact: true }).click();
  const preview = page.getByLabel("日記のプレビュー");
  await expect(preview).toContainText("<script>window.__diaryXss = true</script>");
  await expect(preview.locator("script, img")).toHaveCount(0);
  await expect(preview.getByRole("link", { name: "安全なリンク" })).toHaveAttribute(
    "href",
    "https://example.com/",
  );
  expect(await preview.getByText("危険なリンク", { exact: true }).getAttribute("href")).not.toMatch(
    /^javascript:/i,
  );
  await expect(preview.getByRole("link", { name: "画像: 外部画像" })).toHaveAttribute(
    "href",
    "https://example.invalid/markdown.png",
  );
  await page.waitForTimeout(250);
  expect(imageRequests).toBe(0);
  expect(
    await page.evaluate(() => (window as unknown as { __diaryXss?: boolean }).__diaryXss),
  ).toBeUndefined();
});

test(titles[3], async ({ page, context, request, diaryDate }) => {
  await enter(page, diaryDate);
  await source(page).fill("online");
  await saved(request, diaryDate, "online");
  await context.setOffline(true);
  await source(page).fill("online\nオフラインの追記");
  await expect.poll(() => localText(page, diaryDate)).toBe("online\nオフラインの追記");
  // Keep writes unavailable while reloading the app's assets and authentication online.
  await context.route(`**/api/diaries/${diaryDate}`, (route) =>
    route.request().method() === "POST" ? route.abort() : route.continue(),
  );
  await page.close();
  await context.setOffline(false);
  const reopened = await context.newPage();
  await enter(reopened, diaryDate);
  await expect.poll(() => sourceText(reopened)).toBe("online\nオフラインの追記");
  expect((await getDiary(request, diaryDate)).diary?.body).toBe("online");
  await context.unroute(`**/api/diaries/${diaryDate}`);
  await saved(request, diaryDate, "online\nオフラインの追記");
  await expect(reopened.locator(".diary-heading .save-state")).toHaveText("保存済み");
});

test(titles[4], async ({ browser, page, request, diaryDate }) => {
  await mutate(request, diaryDate, "create", "base");
  const second = await browser.newContext({
    baseURL: origin,
    viewport: { width: 390, height: 844 },
  });
  try {
    const other = await second.newPage();
    await enter(page, diaryDate);
    await enter(other, diaryDate);
    await source(page).fill("device A");
    await saved(request, diaryDate, "device A");
    await source(other).fill("device B");
    const conflict = other.getByRole("region", { name: "競合の解決" });
    await expect(conflict).toContainText("device A");
    await expect(conflict).toContainText("device B");
    expect((await getDiary(request, diaryDate)).diary?.body).toBe("device A");
    await conflict.getByRole("button", { name: "端末版を採用", exact: true }).click();
    await confirm(other, "端末版を採用");
    await saved(request, diaryDate, "device B");
  } finally {
    await second.close();
  }
});

test(titles[5], async ({ page, request, diaryDate }) => {
  await mutate(request, diaryDate, "create", "erase me");
  const before = (await getDiary(request, diaryDate)).diary!;
  await enter(page, diaryDate);
  await source(page).fill("");
  const after = await saved(request, diaryDate, "");
  expect(after.id).toBe(before.id);
  expect(after.version).toBe(before.version + 1);
  await expect(page.locator(".diary-heading .save-state")).toHaveText("保存済み");
});

test(titles[6], async ({ browser, page, request, diaryDate }) => {
  await mutate(request, diaryDate, "create", "keep this version");
  const second = await browser.newContext({
    baseURL: origin,
    viewport: { width: 1440, height: 960 },
  });
  try {
    const stale = await second.newPage();
    await enter(stale, diaryDate);
    await enter(page, diaryDate);
    await page.getByRole("button", { name: "ゴミ箱へ移動", exact: true }).click();
    await confirm(page, "ゴミ箱へ移動");
    await chooseDate(page, diaryDate);
    await expect(
      page.getByText("この日記はゴミ箱にあります。編集するには復元してください。"),
    ).toBeVisible();
    await page.getByRole("button", { name: "復元する", exact: true }).click();
    await confirm(page, "復元する");
    await expect(source(page)).toHaveAttribute("contenteditable", "true");
    await page.getByRole("button", { name: "ゴミ箱へ移動", exact: true }).click();
    await confirm(page, "ゴミ箱へ移動");
    await chooseDate(page, diaryDate);
    await page.getByRole("button", { name: "完全削除", exact: true }).click();
    await confirm(page, "完全削除する");
    await expect.poll(async () => (await getDiary(request, diaryDate)).diary).toBeNull();
    await source(stale).fill("a stale device must not recreate this");
    await expect(stale.getByRole("region", { name: "競合の解決" })).toContainText(
      "完全削除済みの可能性",
    );
    expect((await getDiary(request, diaryDate)).diary).toBeNull();
  } finally {
    await second.close();
  }
});

test(titles[7], async ({ page, context, request, diaryDate }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await enter(page, diaryDate);
  await page.route(`**/api/diaries/${diaryDate}`, (route) =>
    route.request().method() === "POST" ? route.abort() : route.continue(),
  );
  const body = "# 未同期\n- [ ] 手元に保存\n日本語の全文";
  await source(page).fill(body);
  await expect.poll(() => localText(page, diaryDate)).toBe(body);
  await page
    .locator(".editor-actions")
    .getByRole("button", { name: "本文をコピー", exact: true })
    .click();
  // Windows' system clipboard normalizes line endings; the downloaded Markdown remains byte-exact.
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n")).toBe(
    body,
  );
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Markdownファイルを保存", exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe(`diary-${diaryDate}.md`);
  expect(await readFile((await download.path())!, "utf8")).toBe(body);
  expect((await getDiary(request, diaryDate)).diary).toBeNull();
});

test(titles[8], async ({ page, request, diaryDate }) => {
  await mutate(request, diaryDate, "create", "trash export body");
  await mutate(request, diaryDate, "trash");
  await page.goto("/");
  await page.getByRole("button", { name: "設定", exact: true }).click();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSONを一括エクスポート", exact: true }).click();
  const download = await downloadEvent;
  const data = JSON.parse(await readFile((await download.path())!, "utf8")) as {
    formatVersion: number;
    diaries: Diary[];
  };
  expect(data.formatVersion).toBe(1);
  expect(data.diaries.find((item) => item.date === diaryDate)).toMatchObject({
    body: "trash export body",
    deletedAt: expect.any(String),
  });
});

test(titles[9], async ({ page, context, request, diaryDate }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await mutate(request, diaryDate, "create", "認証確認前の本文");
  await enter(page, diaryDate);
  await page.route("**/api/session", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ code: "AUTH_REQUIRED", message: "認証の有効期限が切れました。" }),
    }),
  );
  await page.route(`**/api/diaries/${diaryDate}`, (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({
            code: "AUTH_REQUIRED",
            message: "認証の有効期限が切れました。端末の本文は保持します。",
          }),
        })
      : route.continue(),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(source(page)).toBeVisible();
  const body = "認証確認前の本文\n認証切れ後の追記";
  await source(page).fill(body);
  await expect.poll(() => localText(page, diaryDate)).toBe(body);
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /ログイン|本人確認/ })
      .first(),
  ).toBeVisible();
  await page
    .locator(".editor-actions")
    .getByRole("button", { name: "本文をコピー", exact: true })
    .click();
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n")).toBe(
    body,
  );
  expect((await getDiary(request, diaryDate)).diary?.body).toBe("認証確認前の本文");
});

test(titles[10], async ({ page, context, request, diaryDate }) => {
  await mutate(request, diaryDate, "create", "ログアウト前の保存済み本文");
  await context.route(`**/api/diaries/${diaryDate}`, (route) =>
    route.request().method() === "POST" ? route.abort() : route.continue(),
  );
  await enter(page, diaryDate);
  const other = await context.newPage();
  await enter(other, diaryDate);
  const body = "ログアウト前の保存済み本文\n未同期でも端末に保持する追記";
  await source(page).fill(body);
  await expect.poll(() => localText(page, diaryDate)).toBe(body);
  await expect.poll(() => sourceText(other)).toBe(body);
  // The mobile editor deliberately hides the global navigation while writing.
  await page.getByRole("button", { name: "日記一覧に戻る", exact: true }).click();
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page.getByRole("main").getByRole("button", { name: "ログアウト", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("未同期の下書きがあります。");
  await confirm(page, "ログアウト");
  for (const tab of [page, other]) {
    await expect(
      tab.getByRole("heading", { name: "ログインして日記をひらく", exact: true }),
    ).toBeVisible();
    await expect(
      tab.getByText("未同期の本文があります。ブラウザのデータを消さないでください。", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(source(tab)).toHaveCount(0);
    await expect(tab.locator(".cm-content, .markdown-preview")).toHaveCount(0);
    await expect(tab.locator("body")).not.toContainText(body);
    expect(await localText(tab, diaryDate)).toBe(body);
  }
  expect((await getDiary(request, diaryDate)).diary?.body).toBe("ログアウト前の保存済み本文");
});

test.describe("English browser date controls", () => {
  test.use({ locale: "en-US" });

  test(titles[11], async ({ page, request, diaryDate }) => {
    await enter(page, diaryDate);
    expect(await page.evaluate(() => navigator.language)).toBe("en-US");
    await expect(page.locator('input[type="date"]')).toHaveCount(0);
    const trigger = page.getByRole("button", {
      name: `日付を変更: ${diaryDate.replaceAll("-", "/")}`,
      exact: true,
    });
    await expect(trigger).toContainText(diaryDate.replaceAll("-", "/"));
    const body = "日付選択をキャンセルしても、この本文は残ります。";
    await source(page).fill(body);
    await saved(request, diaryDate, body);

    await trigger.click();
    const picker = page.getByRole("dialog", { name: "日付を選ぶ", exact: true });
    await picker.getByLabel("年", { exact: true }).selectOption("2082");
    await picker.getByLabel("月", { exact: true }).selectOption("12");
    await picker.getByRole("button", { name: "キャンセル", exact: true }).click();
    await expect(picker).not.toBeVisible();
    await expect(trigger).toBeVisible();
    await expect.poll(() => sourceText(page)).toBe(body);
    expect((await getDiary(request, diaryDate)).diary?.body).toBe(body);

    await trigger.click();
    await page.keyboard.press("Escape");
    await expect(picker).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await expect.poll(() => sourceText(page)).toBe(body);

    await trigger.click();
    await picker.getByRole("button", { name: "今日", exact: true }).click();
    await expect(picker).not.toBeVisible();
    await expect(
      page.getByRole("button", {
        name: `日付を変更: ${tokyoToday().replaceAll("-", "/")}`,
        exact: true,
      }),
    ).toBeVisible();
    expect((await getDiary(request, diaryDate)).diary?.body).toBe(body);
  });
});

test(titles[12], async ({ page, request, diaryDate }, info) => {
  const body =
    "# 夕方の記録\n\n近所を散歩して、気になっていた本を読んだ。\n\n- [x] 今日の記録を書く\n- [ ] 明日の予定を確認する";
  await mutate(request, diaryDate, "create", body);
  await page.goto("/");
  const navigation = page.getByRole("navigation", { name: "メインナビゲーション" });
  await expect(navigation.getByRole("button", { name: "日記一覧", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(
    page.getByRole("button", { name: "きろく 日記一覧へ", exact: true }).locator("svg"),
  ).toHaveCount(0);
  await expect(diaryRow(page, diaryDate)).toHaveCount(1);
  const expectEqualMobileNavigation = async () => {
    if (info.project.name !== "mobile") return;
    const buttons = await navigation.getByRole("button").evaluateAll((elements) =>
      elements.map((element) => {
        const bounds = element.getBoundingClientRect();
        const y = bounds.top + bounds.height / 2;
        return {
          width: bounds.width,
          height: bounds.height,
          left: bounds.left,
          right: bounds.right,
          viewportWidth: document.documentElement.clientWidth,
          contentFits: element.scrollWidth <= element.clientWidth,
          leftHit: document.elementFromPoint(bounds.left + 1, y)?.closest("button") === element,
          rightHit: document.elementFromPoint(bounds.right - 1, y)?.closest("button") === element,
        };
      }),
    );
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(Math.abs(button.width - buttons[0].width)).toBeLessThan(1);
      expect(button.height).toBe(buttons[0].height);
      expect(button.height).toBeGreaterThanOrEqual(44);
      expect(button.contentFits).toBe(true);
      expect(button.leftHit).toBe(true);
      expect(button.rightHit).toBe(true);
    }
    expect(Math.abs(buttons[0].left)).toBeLessThan(1);
    expect(Math.abs(buttons[2].right - buttons[0].viewportWidth)).toBeLessThan(1);
    for (let index = 0; index < 3; index++) {
      expect(Math.abs(buttons[index].left - (buttons[0].viewportWidth * index) / 3)).toBeLessThan(
        1,
      );
      expect(
        Math.abs(buttons[index].right - (buttons[0].viewportWidth * (index + 1)) / 3),
      ).toBeLessThan(1);
    }
  };
  await expectEqualMobileNavigation();
  if (info.project.name === "mobile") {
    await page.setViewportSize({ width: 320, height: 844 });
    await expectEqualMobileNavigation();
    for (const [name, edge] of [
      ["設定", "right"],
      ["ゴミ箱", "left"],
      ["日記一覧", "left"],
    ] as const) {
      const button = navigation.getByRole("button", { name, exact: true });
      const bounds = (await button.boundingBox())!;
      await page.mouse.click(
        edge === "left" ? bounds.x + 1 : bounds.x + bounds.width - 1,
        bounds.y + bounds.height / 2,
      );
      await expect(button).toHaveAttribute("aria-current", "page");
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const firstDiary = await page.locator(".diary-row").first().boundingBox();
    expect(firstDiary?.y).toBeLessThan(220);
  }
  const reviewDirectory = ".impeccable/review/ui-refine";
  const capture = async (surface: string) => {
    if (process.env.KIROKU_CAPTURE_UI !== "1") return;
    await mkdir(reviewDirectory, { recursive: true });
    await page.screenshot({
      path: `${reviewDirectory}/${info.project.name}-${surface}.png`,
      fullPage: true,
    });
  };
  // Each capture uses the reserved synthetic diary owned by this test.
  await capture("list");
  await diaryRow(page, diaryDate).click();
  await expect(source(page)).toBeVisible();
  await expect.poll(() => sourceText(page)).toBe(body);
  if (info.project.name === "mobile") {
    const editor = await source(page).boundingBox();
    expect(editor?.y).toBeLessThan(230);
  }
  await capture("editor");
  await page.getByRole("button", { name: /^日付を変更:/ }).click();
  await expect(page.getByRole("dialog", { name: "日付を選ぶ", exact: true })).toBeVisible();
  const picker = page.getByRole("dialog", { name: "日付を選ぶ", exact: true });
  await expect(picker.locator(".date-picker-footer")).toHaveText("今日");
  const weekendColors = await picker
    .locator(".date-picker-weekdays > span")
    .evaluateAll((elements) => elements.map((element) => getComputedStyle(element).color));
  expect(weekendColors[0]).not.toBe(weekendColors[1]);
  expect(weekendColors[6]).not.toBe(weekendColors[1]);
  expect(weekendColors[0]).not.toBe(weekendColors[6]);
  const expectSelectorSpacing = async () => {
    const fields = await picker.locator(".date-picker-select-field").evaluateAll((elements) =>
      elements.map((element) => {
        const select = element.querySelector("select")!;
        const icon = element.querySelector("svg")!;
        const rect = select.getBoundingClientRect();
        const arrow = icon.getBoundingClientRect();
        const style = getComputedStyle(select);
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d")!;
        context.font = style.font;
        return {
          left: rect.left,
          right: rect.right,
          width: rect.width,
          arrowInset: rect.right - arrow.right,
          contentWidth:
            rect.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 2,
          textWidth: context.measureText(select.selectedOptions[0].text).width,
          customArrow: style.appearance === "none",
          iconIgnoresTouches: getComputedStyle(icon).pointerEvents === "none",
        };
      }),
    );
    for (const field of fields) {
      expect(field.arrowInset).toBeGreaterThanOrEqual(10);
      expect(field.contentWidth).toBeGreaterThanOrEqual(field.textWidth);
      expect(field.customArrow).toBe(true);
      expect(field.iconIgnoresTouches).toBe(true);
    }
    expect(fields[0].right).toBeLessThan(fields[1].left);
  };
  await expectSelectorSpacing();
  if (info.project.name === "mobile") {
    await page.setViewportSize({ width: 320, height: 844 });
    await expectSelectorSpacing();
    await page.setViewportSize({ width: 390, height: 844 });
  }
  await capture("datepicker");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "日記一覧に戻る", exact: true }).click();
  await navigation.getByRole("button", { name: "設定", exact: true }).click();
  await expect(navigation.getByRole("button", { name: "設定", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expectEqualMobileNavigation();
  await expect(
    page.getByRole("heading", { name: "データのエクスポート", exact: true }),
  ).toBeVisible();
  await capture("settings");
  await mutate(request, diaryDate, "trash");
  await navigation.getByRole("button", { name: "ゴミ箱", exact: true }).click();
  await expect(navigation.getByRole("button", { name: "ゴミ箱", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expectEqualMobileNavigation();
  await expect(diaryRow(page, diaryDate)).toHaveCount(1);
  await capture("trash");
});

test(titles[13], async ({ page, diaryDate }, info) => {
  // Reserving a date keeps the fixture's cleanup limited to synthetic test data.
  expect(diaryDate).toMatch(/^208[01]-10-14$/);
  await page.route("**/api/session", (route) => route.abort("failed"));
  await page.goto("/");
  const error = page.getByRole("alert", { name: "アプリに接続できません", exact: true });
  await expect(error).toBeVisible();
  await expect(error).toContainText(/接続|通信/);
  await expect(page.locator("body")).not.toContainText(/Failed to fetch|NetworkError|TypeError/i);
  await expect(
    error.getByRole("button", { name: "エラー情報をコピー", exact: true }),
  ).toBeVisible();
  await captureError(page, info.project.name, "connection");
  await page.unroute("**/api/session");
  await page.getByRole("button", { name: "もう一度接続する", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "メインナビゲーション" })).toBeVisible();
  await expect(error).not.toBeVisible();
});

test(titles[14], async ({ page, context, request, diaryDate }, info) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const privateBody = "エラー情報には含めない日記の本文";
  await mutate(request, diaryDate, "create", privateBody);
  await page.route("**/api/diaries?*", (route) => route.abort("failed"));
  await page.goto("/");
  const error = page.getByRole("alert", { name: "一覧を読み込めませんでした", exact: true });
  await expect(error).toBeVisible();
  await expect(page.getByText("日記はまだありません", { exact: true })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(/Failed to fetch|NetworkError|TypeError/i);
  await error.getByRole("button", { name: "エラー情報をコピー", exact: true }).click();
  const report = await page.evaluate(() => navigator.clipboard.readText());
  expect(report).toContain("きろく");
  expect(report).not.toContain(privateBody);
  expect(report).not.toMatch(/Bearer|token|Failed to fetch|127\.0\.0\.1|\/api\//i);
  await captureError(page, info.project.name, "list");

  // Denying the clipboard must leave a selectable, clearly identified fallback.
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => {
      throw new DOMException("Clipboard denied", "NotAllowedError");
    };
  });
  await error.getByRole("button", { name: "エラー情報をコピー", exact: true }).click();
  const fallback = page.getByRole("dialog", { name: "エラー情報を選択してコピー", exact: true });
  const reportField = fallback.getByLabel("エラー情報を選択してコピー", { exact: true });
  await expect(fallback).toBeVisible();
  const fallbackReport = await reportField.inputValue();
  const withoutCopyTime = (value: string) =>
    value
      .split(/\r?\n/)
      .filter((line) => !/^(発生日時|コピー日時):/.test(line))
      .join("\n");
  expect(withoutCopyTime(fallbackReport)).toBe(withoutCopyTime(report));
  await fallback.getByRole("button", { name: "すべて選択", exact: true }).click();
  expect(
    await reportField.evaluate((element) => {
      const textarea = element as HTMLTextAreaElement;
      return textarea.selectionEnd - textarea.selectionStart;
    }),
  ).toBe(fallbackReport.length);
  await captureError(page, info.project.name, "copy-fallback");
  await fallback
    .locator(".dialog-actions")
    .getByRole("button", { name: "閉じる", exact: true })
    .click();
  await page.unroute("**/api/diaries?*");
  await error.getByRole("button", { name: "一覧を読み直す", exact: true }).click();
  await expect(error).not.toBeVisible();
  await expect(diaryRow(page, diaryDate)).toBeVisible();
});

test(titles[15], async ({ page, context, request, diaryDate }, info) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await enter(page, diaryDate);
  await page.route(`**/api/diaries/${diaryDate}`, (route) =>
    route.request().method() === "POST" ? route.abort("failed") : route.continue(),
  );
  const body = "# 保存待ちの記録\n\n失敗しても本文を手元に残す。";
  await source(page).fill(body);
  await expect.poll(() => localText(page, diaryDate)).toBe(body);
  const error = page.getByRole("alert", { name: "サーバーに保存できていません", exact: true });
  await expect(error).toBeVisible();
  await expect(error).toContainText(/端末/);
  await expect(page.locator("body")).not.toContainText(/Failed to fetch|NetworkError|TypeError/i);
  await error.getByRole("button", { name: "本文をコピー", exact: true }).click();
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n")).toBe(
    body,
  );
  const downloading = page.waitForEvent("download");
  await error.getByRole("button", { name: "Markdown保存", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(`diary-${diaryDate}.md`);
  expect(await readFile((await download.path())!, "utf8")).toBe(body);
  expect((await getDiary(request, diaryDate)).diary).toBeNull();
  await captureError(page, info.project.name, "sync");
  // Keep the failure in place through the click: after reconnection, an automatic
  // retry may save successfully and remove the banner before a click can land.
  await error.getByRole("button", { name: "保存を再試行", exact: true }).click();
  await page.unroute(`**/api/diaries/${diaryDate}`);
  await saved(request, diaryDate, body);
  await expect(error).not.toBeVisible();
  await expect(page.locator(".diary-heading .save-state")).toHaveText("保存済み");
});

test(titles[16], async ({ page, request, diaryDate }, info) => {
  const body = "サーバーエラー時も残す日記";
  await mutate(request, diaryDate, "create", body);
  await page.goto("/");
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page.route("**/api/export*", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        code: "SERVER_ERROR",
        message: "D1_ERROR: SELECT body FROM diaries; Bearer private-diagnostic",
      }),
    }),
  );
  await page.getByRole("button", { name: "JSONを一括エクスポート", exact: true }).click();
  const error = page.getByRole("alert", { name: "ファイルを作成できませんでした", exact: true });
  await expect(error).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/D1_ERROR|SELECT body|private-diagnostic/);
  await captureError(page, info.project.name, "export");
  await page.unroute("**/api/export*");
  const downloading = page.waitForEvent("download");
  await error.getByRole("button", { name: "もう一度エクスポート", exact: true }).click();
  const download = await downloading;
  const data = JSON.parse(await readFile((await download.path())!, "utf8")) as { diaries: Diary[] };
  expect(data.diaries.find((item) => item.date === diaryDate)?.body).toBe(body);
  await expect(error).not.toBeVisible();
});

test(titles[17], async ({ page, context, request, diaryDate }, info) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await enter(page, diaryDate);
  await source(page).fill("保存済みの本文");
  await saved(request, diaryDate, "保存済みの本文");
  await expect(page.locator(".diary-heading .save-state")).toHaveText("保存済み");
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as unknown as { __restoreDraftWrites: () => void }).__restoreDraftWrites = () => {
      IDBObjectStore.prototype.put = original;
    };
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) {
      if (this.name === "drafts")
        throw new DOMException(
          "Quota exceeded while writing private technical data",
          "QuotaExceededError",
        );
      return original.apply(this, args);
    };
  });
  const body = "保存済みの本文\n端末に保存できなかった追記も退避する。";
  await source(page).fill(body);
  const error = page.getByRole("alert", { name: "この端末に保存できていません", exact: true });
  await expect(error).toBeVisible();
  await expect(error).toContainText(/閉じ/);
  await expect(page.locator("body")).not.toContainText(/QuotaExceededError|private technical data/);
  await page.getByRole("button", { name: "日記一覧に戻る", exact: true }).click();
  await expect(source(page)).toBeVisible();
  await expect.poll(() => sourceText(page)).toBe(body);
  await error.getByRole("button", { name: "本文をコピー", exact: true }).click();
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n")).toBe(
    body,
  );
  const downloading = page.waitForEvent("download");
  await error.getByRole("button", { name: "Markdown保存", exact: true }).click();
  const download = await downloading;
  expect(await readFile((await download.path())!, "utf8")).toBe(body);
  expect((await getDiary(request, diaryDate)).diary?.body).toBe("保存済みの本文");
  await captureError(page, info.project.name, "storage");
  await page.evaluate(() =>
    (window as unknown as { __restoreDraftWrites: () => void }).__restoreDraftWrites(),
  );
  await error.getByRole("button", { name: "端末保存を再試行", exact: true }).click();
  await saved(request, diaryDate, body);
  await expect(error).not.toBeVisible();
});

test(titles[18], async ({ page, request, diaryDate }, info) => {
  const body = "読み込みが戻ったら表示する保存済みの本文";
  await mutate(request, diaryDate, "create", body);
  const original = (await getDiary(request, diaryDate)).diary!;
  await page.route(`**/api/diaries/${diaryDate}`, (route) =>
    route.request().method() === "GET" ? route.abort("failed") : route.continue(),
  );
  await enter(page, diaryDate);
  const error = page.getByRole("alert", { name: "日記を読み込めませんでした", exact: true });
  await expect(error).toBeVisible();
  await expect(page.locator(".diary-heading .save-state")).toHaveText("読み込みできていません");
  await expect(error).not.toContainText("サーバーに保存できていません");
  await expect(page.locator("body")).not.toContainText(body);
  await expect(source(page).locator(".cm-placeholder")).toBeVisible();
  await captureError(page, info.project.name, "diary-read");
  await page.unroute(`**/api/diaries/${diaryDate}`);
  await error.getByRole("button", { name: "日記を読み直す", exact: true }).click();
  await expect.poll(() => sourceText(page)).toBe(body);
  await expect(error).not.toBeVisible();
  expect((await getDiary(request, diaryDate)).diary).toMatchObject({
    id: original.id,
    body,
    version: original.version,
  });
});

test(titles[19], async ({ page, request, diaryDate }) => {
  const body = "待機時間が過ぎたら読み直す本文";
  await mutate(request, diaryDate, "create", body);
  const original = (await getDiary(request, diaryDate)).diary!;
  let readAttempts = 0;
  await page.route(`**/api/diaries/${diaryDate}`, (route) => {
    if (route.request().method() !== "GET") return route.continue();
    readAttempts++;
    return route.fulfill({
      status: 429,
      headers: { "Retry-After": "2" },
      contentType: "application/json",
      body: JSON.stringify({
        code: "RATE_LIMITED",
        message: "Technical throttling details must not be shown directly",
      }),
    });
  });
  await enter(page, diaryDate);
  const error = page.getByRole("alert", { name: "日記を読み込めませんでした", exact: true });
  await expect(error).toBeVisible();
  await expect(
    error.getByRole("button", { name: "再試行までお待ちください", exact: true }),
  ).toBeDisabled();
  await expect(page.locator("body")).not.toContainText("Technical throttling details");
  expect(readAttempts).toBe(1);
  await page.unroute(`**/api/diaries/${diaryDate}`);
  const retry = error.getByRole("button", { name: "日記を読み直す", exact: true });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect.poll(() => sourceText(page)).toBe(body);
  await expect(error).not.toBeVisible();
  expect((await getDiary(request, diaryDate)).diary).toMatchObject({
    id: original.id,
    body,
    version: original.version,
  });
});
