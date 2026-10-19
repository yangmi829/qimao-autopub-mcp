import { sleep, shot } from "../browser/driver.js";
import { API, apiGet, openSession, isError, chapterEditUrl } from "../browser/endpoints.js";
import { fillByLabel, readForm } from "../browser/form.js";
import { realClickText, visibleModalText, waitForText, textOf } from "../browser/page.js";
import { logger } from "../core/logger.js";
import { assertCookies } from "./auth.js";
import { cleanChapterTitle, countCjk, toPlainText } from "../core/text.js";

export interface ChapterSummary {
  chapterId: string;
  chapterNumber?: number;
  title: string;
  words?: number;
  status?: string;
  publishTime?: string;
  raw?: unknown;
}

function pick<T = unknown>(obj: any, keys: string[]): T | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== "") return v as T;
  }
  return undefined;
}

export function normalizeChapter(c: any): ChapterSummary {
  return {
    chapterId: String(pick(c, ["chapter_id", "chapterId", "id", "cid"]) ?? ""),
    chapterNumber: pick<number>(c, ["chapter_num", "chapterNum", "sort", "index", "chapter_index"]),
    title: String(pick(c, ["chapter_name", "chapterName", "title", "name"]) ?? ""),
    words: pick<number>(c, ["word_count", "wordCount", "words", "word_num"]),
    status: pick<string>(c, ["status_name", "statusName", "status", "publish_status"]),
    publishTime: pick<string>(c, ["publish_time", "publishTime", "create_time", "update_time"]),
    raw: c,
  };
}

function extractList(data: any): any[] {
  if (Array.isArray(data)) return data;
  for (const k of ["list", "chapter_list", "chapterList", "data", "items", "records", "chapters"]) {
    if (Array.isArray(data?.[k])) return data[k];
  }
  return [];
}

export interface ListChaptersResult {
  ok: boolean;
  message: string;
  total?: number;
  chapters: ChapterSummary[];
}

/**
 * 读某本书的章节列表（只读 HTTP），用于复核与避重。
 *
 * ⚠️ 未联调：`book-chapter/list` 只传 `book_id` 会返回 `40001002 请求参数错误`（真机实测，2026-10），
 *    说明还需要别的参数（可能是 `type` / `tab_type` / 分页游标）——等有真实作品后再校准这里的入参。
 */
export async function listChapters(opts: { bookId: string; pageSize?: number; pageIndex?: number }): Promise<ListChaptersResult> {
  assertCookies();
  const r = await apiGet(API.chapterList, {
    book_id: opts.bookId,
    page: (opts.pageIndex ?? 0) + 1,
    page_size: opts.pageSize ?? 200,
  });
  if (!r.ok) return { ok: false, message: `读取章节列表失败：${r.error}`, chapters: [] };
  const list = extractList(r.data);
  return {
    ok: true,
    message: `《${opts.bookId}》共 ${pick<number>(r.data, ["total", "count"]) ?? list.length} 章。`,
    total: pick<number>(r.data, ["total", "count"]) ?? list.length,
    chapters: list.map(normalizeChapter),
  };
}

/* ------------------------------ 写：新增 / 修改 / 发布章节 ------------------------------ */

export interface WriteChapterInput {
  bookId: string;
  /** 传 chapterId 表示「改已有章节」；不传表示「新增章节」 */
  chapterId?: string;
  chapterNumber?: number;
  title?: string;
  content?: string;
  /** 定时发布时间（yyyy-MM-dd HH:mm）——仅小说章节支持 */
  scheduledTime?: string;
  confirm?: boolean;
  headless?: boolean;
}

export interface WriteChapterResult {
  ok: boolean;
  action: "preview" | "published" | "scheduled" | "error";
  message: string;
  screenshotPath?: string;
  chapterId?: string;
  filled?: Record<string, string>;
  missing?: string[];
}

/**
 * 新增 / 修改章节（同一个编辑器）。
 *
 * 真实路由是 `/front/book-manage/manage?book_id=…`（`chapterEditUrl(bookId, chapterId)`）。
 * ⚠️ 章节编辑器**边输入边自动保存**，所以 `confirm=false` 时**只打开页面读现状 + 截图，绝不填充**
 *    —— 一填充就可能改动线上正文。`confirm=true` 才填入并提交。
 *
 * 选择器：优先按 label 文本（章节名 / 正文），正文同时兼容富文本 `contenteditable`。
 */
export async function writeChapter(input: WriteChapterInput): Promise<WriteChapterResult> {
  assertCookies();
  const target = chapterEditUrl(input.bookId, input.chapterId);
  const session = await openSession(input.headless ?? true, target);
  if (isError(session)) return { ok: false, action: "error", message: session.error };
  const { browser, page } = session;

  try {
    if (!input.confirm) {
      await waitForText(page, "章节", 8000).catch(() => false);
      const shotPath = await shot(page, "chapter-preview");
      const form = await readForm(page);
      await browser.close().catch(() => {});
      return {
        ok: true,
        action: "preview",
        message:
          `已打开章节页（confirm=false，**未做任何填充**，避免触发自动保存）。` +
          `当前表单：${JSON.stringify(form).slice(0, 400)}。核对无误后传 confirm=true。`,
        screenshotPath: shotPath,
        filled: form,
      };
    }

    const filled: Record<string, string> = {};
    const missing: string[] = [];
    const plain = input.content ? toPlainText(input.content) : undefined;

    if (input.title) {
      const raw = cleanChapterTitle(input.title) || input.title;
      const r = await fillByLabel(page, "章节名", raw);
      const r2 = r.ok ? r : await fillByLabel(page, "章节标题", raw);
      if (r2.ok) filled["章节名"] = raw;
      else missing.push("title(章节名)");
    }

    if (input.chapterNumber !== undefined) {
      const r = await fillByLabel(page, "章节序号", String(input.chapterNumber));
      const r2 = r.ok ? r : await fillByLabel(page, "序号", String(input.chapterNumber));
      if (r2.ok) filled["章节序号"] = String(input.chapterNumber);
      else missing.push("chapterNumber(章节序号)");
    }

    if (plain !== undefined) {
      const ok = await fillChapterBody(page, plain);
      if (ok) filled["正文"] = `${countCjk(plain)} 字`;
      else missing.push("content(正文)");
    }

    if (input.scheduledTime) {
      const r = await fillByLabel(page, "定时", input.scheduledTime);
      if (r.ok) filled["定时发布"] = input.scheduledTime;
      else missing.push("scheduledTime(定时发布)");
    }

    const submitted =
      (await realClickText(page, "发布", { exact: true })) ||
      (await realClickText(page, "提交", { exact: true })) ||
      (await realClickText(page, "保存", { exact: true })) ||
      (await realClickText(page, "确定", { exact: true }));

    const modal = await visibleModalText(page);
    const shotPath = await shot(page, "chapter-done");
    await browser.close().catch(() => {});

    return {
      ok: submitted,
      action: submitted ? (input.scheduledTime ? "scheduled" : "published") : "error",
      message: submitted
        ? `已提交章节《${input.title ?? ""}》。${missing.length ? `未命中字段：${missing.join("/")}。` : ""}${modal ? `页面提示：${modal.slice(0, 200)}` : ""}`
        : `已填表但未找到提交按钮。缺：${missing.join("/") || "无"}。`,
      screenshotPath: shotPath,
      chapterId: input.chapterId,
      filled,
      missing,
    };
  } catch (e) {
    await browser.close().catch(() => {});
    return { ok: false, action: "error", message: `章节写入异常：${(e as Error).message}` };
  }
}

/** 往编辑器正文区写入：富文本 contenteditable 优先，退回 textarea */
async function fillChapterBody(page: any, text: string): Promise<boolean> {
  const isRich = await page.evaluate(() => {
    const ed = document.querySelector(".ProseMirror, [contenteditable='true']") as any;
    if (ed) {
      ed.setAttribute("data-qimao-body", "1");
      return true;
    }
    return false;
  });
  if (isRich) {
    try {
      const handle = await page.$("[data-qimao-body='1']");
      await handle.evaluate((el: any) => {
        el.scrollIntoView({ block: "center" });
        el.focus();
      });
      await handle.evaluate((el: any, t: string) => {
        el.innerText = t;
      }, text);
      await handle.evaluate((el: any) => {
        el.removeAttribute("data-qimao-body");
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
      return true;
    } catch (e) {
      logger.debug(`正文富文本写入失败: ${(e as Error).message}`);
    }
  }
  const r = await fillByLabel(page, "正文", text);
  if (r.ok) return true;
  const r2 = await fillByLabel(page, "章节内容", text);
  return r2.ok;
}

/** 批量上传 / 改章用的单章原语（新增或修改章节） */
export async function uploadChapter(input: {
  bookId: string;
  chapterId?: string;
  title: string;
  content: string;
  chapterNumber?: number;
  scheduledTime?: string;
  confirm?: boolean;
  headless?: boolean;
}): Promise<WriteChapterResult> {
  return writeChapter({
    bookId: input.bookId,
    chapterId: input.chapterId,
    chapterNumber: input.chapterNumber,
    title: input.title,
    content: input.content,
    scheduledTime: input.scheduledTime,
    confirm: input.confirm,
    headless: input.headless,
  });
}

/** 删除章节（默认预览） */
export async function deleteChapter(input: {
  bookId: string;
  chapterId: string;
  confirm?: boolean;
  headless?: boolean;
}): Promise<WriteChapterResult> {
  assertCookies();
  const session = await openSession(input.headless ?? true, chapterEditUrl(input.bookId));
  if (isError(session)) return { ok: false, action: "error", message: session.error };
  const { browser, page } = session;
  try {
    if (!input.confirm) {
      const shotPath = await shot(page, "chapter-delete-preview");
      await browser.close().catch(() => {});
      return {
        ok: true,
        action: "preview",
        message: `将删除章节 chapterId=${input.chapterId}（confirm=false，未执行）。confirm=true 才真正删除。`,
        screenshotPath: shotPath,
      };
    }
    // 在章节列表里 hover 出删除图标再确认（图标通常无稳定选择器，按文案兜底）
    await realClickText(page, "删除", { exact: true });
    await sleep(500);
    await realClickText(page, "确定", { exact: true });
    const shotPath = await shot(page, "chapter-delete-done");
    await browser.close().catch(() => {});
    return { ok: true, action: "published", message: `已提交删除 chapterId=${input.chapterId}。`, screenshotPath: shotPath };
  } catch (e) {
    await browser.close().catch(() => {});
    return { ok: false, action: "error", message: `删除章节异常：${(e as Error).message}` };
  }
}

/** 只读：卷列表 */
export async function listVolumes(bookId: string): Promise<{ ok: boolean; message: string; volumes: any[] }> {
  assertCookies();
  const r = await apiGet(API.volumeList, { book_id: bookId });
  if (!r.ok) return { ok: false, message: `读取卷列表失败：${r.error}`, volumes: [] };
  const list = extractList(r.data);
  return { ok: true, message: `共 ${list.length} 卷。`, volumes: list };
}

/** 只读：章节页的当前标题（复核用） */
export async function readChapterTitle(page: any): Promise<string> {
  return (await textOf(page, ".el-form-item__label")) || "";
}

export { logger };
