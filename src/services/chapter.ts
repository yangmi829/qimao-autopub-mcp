import { sleep, shot } from "../browser/driver.js";
import { NEXT_STEP_CHAPTER_PUBLISHED } from "../core/reminders.js";
import { API, apiGet, openSession, isError, chapterEditUrl, chapterManageUrl, authorBase } from "../browser/endpoints.js";
import {
  realClickText,
  realClickByJs,
  visibleModalText,
  visibleToastText,
  acceptPublishConfirm,
  waitForPublishGate,
  waitForText,
  textOf,
  fillInput,
  describeAiDeclaration,
  type AiDeclarationOutcome,
} from "../browser/page.js";
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
  /** 是否为草稿（`draft` tab 拉回来的） */
  isDraft?: boolean;
  volumeId?: string;
  raw?: unknown;
}

/**
 * 章节编辑器选择器（2026-10 真机确认）。
 *
 * ⚠️ 章节编辑器页面**没有 `.el-form-item`**（不是表单结构），所以 `fillByLabel` /
 *    `readForm` 在这里一律失效——只能按结构定位。真机 DOM：
 *    序号 `input.el-input__inner[maxlength=5]`、章节名 `textarea[placeholder*=章节名称]`
 *    （maxlength 20）、正文 `div.q-contenteditable.book`、段尾「有话要说」`font-size-14`。
 *    提交按钮是 `<a class="qm-btn …">`（**不是 `<button>`**）：`default`＝更新草稿 /
 *    定时发布，`important`＝立即发布。
 */
export const CHAPTER_SELECTORS = {
  index: 'input.el-input__inner[maxlength="5"]',
  title: 'textarea[placeholder*="章节名称"]',
  body: "div.q-contenteditable.book",
  tail: 'div.q-contenteditable[class*="font-size-14"]',
  indexFallback: 'input.el-input__inner[maxlength="5"]',
};

/** 平台正文字数门（`global/config` 的 `client_config[1].word_count[type=1]`：1000–50000），只做软提示 */
export const CHAPTER_MIN_WORDS = 1000;
export const CHAPTER_MAX_WORDS = 50000;

function pick<T = unknown>(obj: any, keys: string[]): T | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== "") return v as T;
  }
  return undefined;
}

export function normalizeChapter(c: any, isDraft = false): ChapterSummary {
  return {
    chapterId: String(pick(c, ["chapter_id", "chapterId", "id", "cid"]) ?? ""),
    chapterNumber: pick<number>(c, ["chapter_index", "chapter_num", "chapterNum", "sort", "index"]),
    title: String(pick(c, ["chapter_name", "chapter_name_txt", "chapterName", "title", "name"]) ?? ""),
    words: pick<number>(c, ["words_num", "word_count", "wordCount", "words", "word_num"]),
    status: pick<string>(c, ["status_name", "statusName", "status", "publish_status"]),
    publishTime: pick<string>(c, ["publish_time", "publishTime", "create_time", "update_time"]),
    isDraft,
    volumeId: pick<string>(c, ["volume_id"]),
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
  /** 本次返回的章节条数 */
  total?: number;
  /** 平台计数（真机口径）：published=已发布条数，all=合计数，draftWords=草稿总字数 */
  counts?: { published: number; all: number; draftWords: number };
  chapters: ChapterSummary[];
  error?: string;
}

export type ChapterTab = "all" | "published" | "draft";

/**
 * 读某本书的章节列表（只读 HTTP）。
 *
 * 真机（2026-10）校准的**完整**入参（只传 `book_id` 会报 `40001002 请求参数错误`）：
 * `book_id, page, page_size, search_type=2, is_draft, tab_type, volume_id, order_type=2`。
 * 响应：`{data:{list, data_total, chapter_total, draft_total, chapter_index_rule, …}}`。
 *
 * `tab=all`（默认）会拉「已发布 + 草稿」两次并合并——只读复核/避重需要看到草稿，
 * 否则「新建章节」自动生成的空草稿会漏掉。
 */
export async function listChapters(opts: { bookId: string; tab?: ChapterTab; pageSize?: number; page?: number; volumeId?: string }): Promise<ListChaptersResult> {
  assertCookies();
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 100;
  const volumeId = opts.volumeId ?? "0";
  const tab = opts.tab ?? "all";

  const fetchTab = async (which: "published" | "draft") => {
    const r = await apiGet(API.chapterList, {
      book_id: opts.bookId,
      page: String(page),
      chapter_name: "",
      page_size: String(pageSize),
      search_type: "2",
      is_draft: which === "draft" ? "1" : "0",
      tab_type: which === "draft" ? "1" : "0",
      volume_id: volumeId,
      order_type: "2",
    });
    return r;
  };

  const wanted: ("published" | "draft")[] = tab === "all" ? ["published", "draft"] : [tab];
  const chapters: ChapterSummary[] = [];
  let counts: { published: number; all: number; draftWords: number } | undefined;
  for (const which of wanted) {
    const r = await fetchTab(which);
    if (!r.ok) {
      if (chapters.length === 0) return { ok: false, message: `读取章节列表失败：${r.error}`, chapters: [], error: r.error };
      continue;
    }
    const d: any = r.data ?? {};
    // ⚠️ 字段口径（真机 2026-10 比对得出，平台未公开文档）：
    //   data_total   → 已发布章节**条数**
    //   chapter_total→ 章节**条数**（含草稿）
    //   draft_total  → 草稿**总字数**（不是条数！空草稿时为 0，写了 1507 字后变 1507）
    counts = {
      published: Number(d.data_total ?? 0),
      all: Number(d.chapter_total ?? 0),
      draftWords: Number(d.draft_total ?? 0),
    };
    for (const c of extractList(d)) chapters.push(normalizeChapter(c, which === "draft"));
  }

  const suffix = counts
    ? `（平台原始计数 data_total=${counts.published} / chapter_total=${counts.all} / draft_total=${counts.draftWords}` +
      `；真机比对推测：chapter_total=章节条数、draft_total=草稿总字数、data_total 偏「已过审条数」——` +
      `别把 data_total 当「已提交条数」，待审核章节不计入它）`
    : "";
  return {
    ok: true,
    message: `《${opts.bookId}》本次返回 ${chapters.length} 条章节${suffix}。`,
    total: chapters.length,
    counts,
    chapters,
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
  /** 提交方式：publish＝立即发布（默认，需 ≥1000 字），draft＝更新草稿，schedule＝定时发布 */
  mode?: "publish" | "draft" | "schedule";
  /** 定时发布时间（yyyy-MM-dd HH:mm）——仅 mode=schedule 支持 */
  scheduledTime?: string;
  /**
   * 发布确认弹窗里的「内容声明」：**默认 true＝选「含AI生成内容」**（AI 相关声明一律取肯定项）；
   * 显式 false 才选「本人原创」。平台没有该字段时（短篇 / 部分渠道）自动跳过。
   */
  useAI?: boolean;
  confirm?: boolean;
  headless?: boolean;
}

export interface WriteChapterResult {
  ok: boolean;
  action: "preview" | "published" | "drafted" | "scheduled" | "deleted" | "aborted" | "error";
  message: string;
  screenshotPath?: string;
  chapterId?: string;
  filled?: Record<string, string>;
  missing?: string[];
}

/**
 * 读编辑器当前内容（不触发任何输入）。
 * 真机事实：**章节编辑器 / 短篇正文编辑器都没有 `.el-form-item`**，只能按结构定位；
 * 短篇编辑器没有「章节序号 / 章节名称」两个 input（那两项会读回空串），只有正文。
 */
export async function readEditorState(page: any): Promise<Record<string, any>> {
  return (await page.evaluate((sel: any) => {
    const g = (s: string) => document.querySelector(s) as any;
    const idx = g(sel.index);
    const title = g(sel.title);
    const body = g(sel.body);
    return {
      章节序号: idx?.value ?? "",
      章节名称: title?.value ?? "",
      正文字数: (body?.innerText ?? "").replace(/\s/g, "").length,
      正文预览: (body?.innerText ?? "").replace(/\s+/g, " ").slice(0, 80),
    };
  }, CHAPTER_SELECTORS)) as Record<string, any>;
}

/**
 * 新增 / 修改章节（同一个编辑器）。
 *
 * 真实路由 `/front/book-upload?id=<bookId>[&cid=<chapterId>]`（真机确认；章节管理页的
 * 「新建章节」就跳这里）。⚠️ 不带 `cid` 打开会**自动创建一条草稿章节**。
 *
 * ⚠️ 编辑器**边输入边自动保存**，所以 `confirm=false` 时**只打开页面读现状 + 截图，绝不输入**
 *    —— 一输入就可能改动线上正文。`confirm=true` 才填入并提交。
 */
export async function writeChapter(input: WriteChapterInput): Promise<WriteChapterResult> {
  assertCookies();
  const target = chapterEditUrl(input.bookId, input.chapterId);
  const session = await openSession(input.headless ?? true, target);
  if (isError(session)) return { ok: false, action: "error", message: session.error };
  const { browser, page } = session;

  try {
    if (!input.confirm) {
      await sleep(3500);
      const state = await readEditorState(page);
      const shotPath = await shot(page, "chapter-preview");
      const cidPreview = /[?&]cid=(\d+)/.exec(page.url())?.[1];
      await browser.close().catch(() => {});
      return {
        ok: true,
        action: "preview",
        chapterId: input.chapterId ?? cidPreview,
        message:
          `已打开章节编辑器（confirm=false，**未做任何输入**，避免触发自动保存）。` +
          `当前：${JSON.stringify(state)}。核对无误后传 confirm=true。` +
          (input.chapterId ? "" : "⚠️ 未传 chapter_id 时，平台打开该页会自动生成一条草稿章节。"),
        screenshotPath: shotPath,
        filled: state as Record<string, string>,
      };
    }

    const filled: Record<string, string> = {};
    const missing: string[] = [];
    const plain = input.content ? toPlainText(input.content) : undefined;
    const mode = input.mode ?? "publish";

    // 1) 章节序号（默认已有值，显式传了才覆盖）
    if (input.chapterNumber !== undefined) {
      if (await fillInput(page, CHAPTER_SELECTORS.index, String(input.chapterNumber))) {
        filled["章节序号"] = String(input.chapterNumber);
      } else missing.push("chapterNumber(章节序号)");
      await sleep(300);
    }

    // 2) 章节名称
    if (input.title) {
      const raw = cleanChapterTitle(input.title) || input.title;
      if (await fillInput(page, CHAPTER_SELECTORS.title, raw)) filled["章节名称"] = raw;
      else missing.push("title(章节名称)");
      await sleep(300);
    }

    // 3) 正文
    if (plain !== undefined) {
      const words = countCjk(plain);
      if (words > CHAPTER_MAX_WORDS) missing.push(`content(正文 ${words} 字，超过平台上限 ${CHAPTER_MAX_WORDS})`);
      if (await fillInput(page, CHAPTER_SELECTORS.body, plain)) filled["正文"] = `${words} 字`;
      else missing.push("content(正文)");
      await sleep(500);
    }

    // 4) 发布前拦一道：立即发布要够字数，否则前端会拦下（省一次往返）
    if (mode === "publish" && plain !== undefined && countCjk(plain) < CHAPTER_MIN_WORDS) {
      const shotPath = await shot(page, "chapter-too-short");
      await browser.close().catch(() => {});
      return {
        ok: false,
        action: "error",
        message: `正文 ${countCjk(plain)} 字，未达「立即发布」下限 ${CHAPTER_MIN_WORDS} 字，未提交（平台会拦）。可改用 mode=draft 存草稿，或补足正文字数。`,
        screenshotPath: shotPath,
        filled,
        missing,
      };
    }

    // 5) 提交
    // ⚠️ 按钮文案在**新章**与**已有草稿**上不一样（真机确认）：
    //    新章 = 「存为草稿」/「定时发布」/「立即发布」；
    //    已有草稿 = 「更新草稿」/「定时发布」/「立即发布」。
    const btnCandidates =
      mode === "draft" ? ["存为草稿", "更新草稿", "保存草稿"] : mode === "schedule" ? ["定时发布"] : ["立即发布"];
    const action: WriteChapterResult["action"] = mode === "draft" ? "drafted" : mode === "schedule" ? "scheduled" : "published";

    if (mode === "schedule" && !input.scheduledTime) {
      await browser.close().catch(() => {});
      return { ok: false, action: "error", message: `mode=schedule 需要同时给 scheduledTime（yyyy-MM-dd HH:mm）。`, filled, missing };
    }

    // 抓章节写接口的响应作为**权威**成功判据（编辑器回读只能证明草稿被自动保存，
    // 证明不了「发布成功」——真机踩过：只点「立即发布」不点二次确认，章节仍是草稿）。
    const apiTrace: string[] = [];
    let apiOk = false;
    let publishDone = false;
    const onResp = async (resp: any) => {
      try {
        const u = String(resp.url());
        if (!/chapter/i.test(u) || !/(publish|save|draft|add|update|modify)/i.test(u)) return;
        const body = await resp.text();
        const short = u.replace(authorBase(), "");
        apiTrace.push(`${short} => ${body.slice(0, 240)}`);
        if (!/error|"code":"4|失败/.test(body)) apiOk = true;
        // `draft-publish`（正式发布，区别于 `draft-publish-confirm`）成功 = 发布已落地
        if (/draft-publish(?!-confirm)/.test(u) && !/error|"code":"4|失败/.test(body)) publishDone = true;
      } catch {
        /* 忽略 */
      }
    };
    page.on("response", onResp);

    // 硬门：章节名为空时平台对「立即发布」**完全无响应**（连 3 秒 toast 都没有），
    // 干等只会得到「未出现二次确认弹窗」。提前拦下并说清原因（草稿模式允许无名，故只拦发布 / 定时）。
    if (mode !== "draft") {
      const state = await readEditorState(page);
      if (!String(state.章节名称 ?? "").trim()) {
        page.off?.("response", onResp);
        const shotPath = await shot(page, "chapter-title-missing");
        await browser.close().catch(() => {});
        return {
          ok: false,
          action: "aborted",
          message:
            `章节名为空：平台不会响应「${btnCandidates[0]}」（页面上没有任何提示）。` +
            `请传 title（≤20 字）后重试；已有章节名请确认查看的是正确的 chapterId。` +
            `⚠️ 已填入的正文可能已被编辑器自动保存成草稿，请到章节管理页核对。`,
          screenshotPath: shotPath,
          filled,
          missing,
          chapterId: input.chapterId,
        };
      }
    }

    let clicked: string | undefined;
    for (const t of btnCandidates) {
      if (await realClickText(page, t, { exact: true })) {
        clicked = t;
        break;
      }
    }
    if (!clicked) {
      page.off?.("response", onResp);
      const shotPath = await shot(page, "chapter-nobutton");
      await browser.close().catch(() => {});
      return {
        ok: false,
        action: "error",
        message: `已填入但未找到提交按钮（候选：${btnCandidates.join("/")}）。已填：${Object.keys(filled).join("/")}；缺：${missing.join("/") || "无"}。`,
        screenshotPath: shotPath,
        filled,
        missing,
      };
    }
    await sleep(2000);

    // ★ 二次确认弹窗（真机确认是**两层**）：点「立即发布」→ 弹窗①「请核对上下文内容」+确认发布
    //   → 点确认发布 → 弹层②「重要提醒」+『我已阅读并知晓』→ 再点确认发布 → 才真正发布。
    //   只做一层会「点了但章节还是草稿」——这是本工具最初踩的坑。
    //   「内容声明」就在这一层：默认选「含AI生成内容」（use_ai=false 才选「本人原创」）。
    let confirmed: string[] = [];
    let aiDeclaration: AiDeclarationOutcome | undefined;
    if (mode === "publish" || mode === "schedule") {
      // 前置门：序号与已发布章节接不上时，平台先弹「检测到章节序号不连续」，不进发布确认弹窗。
      // 改序号是内容决策 → 不替用户点「更正序号去发布」，如实回报让用户决定。
      const gate = await waitForPublishGate(page, 12000);
      if (gate.kind === "sequence") {
        const shotPath = await shot(page, "chapter-sequence-blocked");
        page.off?.("response", onResp);
        await browser.close().catch(() => {});
        return {
          ok: false,
          action: "aborted",
          message:
            `平台拦下：检测到章节序号不连续（本次提交章节号=${input.chapterNumber ?? "未指定"}${input.chapterId ? `, chapterId=${input.chapterId}` : ""}）。` +
            `平台弹窗只给两个选择${gate.options?.length ? `：${gate.options.map((o) => `「${o}」`).join(" / ")}` : ""}；` +
            `改序号属于内容决策，本工具不替你点「更正序号去发布」。请先确认章节号（编辑器里改序号后重发，或用 update_chapter_qimao 修正），` +
            `也可以到页面上手动选择。⚠️ 正文已随编辑器自动保存成草稿（编辑器边输入边存），请到章节管理页核对后再发。` +
            `弹窗原文：${gate.text ?? "(未读到)"}。`,
          screenshotPath: shotPath,
          filled,
          missing,
          chapterId: input.chapterId,
        };
      }
      confirmed = await acceptPublishConfirm(page, 4, () => publishDone, {
        useAI: input.useAI !== false,
        onAi: (r) => (aiDeclaration = r),
      });
    }

    if (mode === "schedule" && input.scheduledTime) {
      // 定时发布的时间选择器结构未联调：尽力而为，失败就如实回报（让用户手动确认时间）
      missing.push(`scheduledTime(${confirmed.length ? `已点${confirmed.map((x) => `「${x}」`).join("→")}` : "未找到定时弹层"}；时间 ${input.scheduledTime} 需在页面手动核对)`);
    }

    await waitForText(page, "成功", 5000).catch(() => false);
    const toast = await visibleToastText(page);
    const shotPath = await shot(page, `chapter-${action}`);
    const state = await readEditorState(page);
    const urlNow = page.url();
    const cidFromUrl = /[?&]cid=(\d+)/.exec(urlNow)?.[1];
    page.off?.("response", onResp);
    await browser.close().catch(() => {});

    // 成功判据优先级：写接口响应 > toast > （兜底）编辑器回读
    const okSignal = apiOk || /成功|已保存|已提交|已发布/.test(toast);
    const notes: string[] = [];
    if (!input.chapterId && cidFromUrl) notes.push(`平台已自动建草稿 chapterId=${cidFromUrl}（不传 chapter_id 打开编辑器就会这样）`);
    if (confirmed.length) notes.push(`已点确认链：${confirmed.map((x) => `「${x}」`).join("→")}`);
    else if (mode === "publish") notes.push("⚠️ 未出现二次确认弹窗（可能按钮未生效）");
    if (aiDeclaration) notes.push(`内容声明：${describeAiDeclaration(aiDeclaration)}`);
    if (missing.length) notes.push(`未命中/警告：${missing.join("/")}`);
    if (toast) notes.push(`提示：${toast}`);
    if (apiTrace.length) notes.push(`写接口：${apiTrace.slice(-2).join(" ｜ ")}`);
    else if (!okSignal) notes.push("未捕获章节写接口响应，请到章节管理页复核");
    if (mode === "publish" && !apiOk) notes.push("⚠️ 未确认发布成功（章节可能仍是草稿）");

    return {
      ok: okSignal,
      action: okSignal ? action : "error",
      message:
        `已点「${clicked}」（bookId=${input.bookId}${input.chapterId ? `, chapterId=${input.chapterId}` : ""}）。` +
        `${notes.length ? notes.join("；") + "。" : ""}` +
        ` 编辑器现状：${JSON.stringify(state)}。` +
        (mode === "publish" && okSignal ? NEXT_STEP_CHAPTER_PUBLISHED : ""),
      screenshotPath: shotPath,
      chapterId: input.chapterId ?? cidFromUrl,
      filled,
      missing,
    };
  } catch (e) {
    await browser.close().catch(() => {});
    return { ok: false, action: "error", message: `写章节异常：${(e as Error).message}` };
  }
}

/** 批量上传 / 改章用的单章原语（新增或修改章节） */
export async function uploadChapter(input: {
  bookId: string;
  chapterId?: string;
  title: string;
  content: string;
  chapterNumber?: number;
  mode?: "publish" | "draft" | "schedule";
  scheduledTime?: string;
  /** 发布确认弹窗的「内容声明」：默认 true＝含AI生成内容 */
  useAI?: boolean;
  confirm?: boolean;
  headless?: boolean;
}): Promise<WriteChapterResult> {
  return writeChapter({
    bookId: input.bookId,
    chapterId: input.chapterId,
    chapterNumber: input.chapterNumber,
    title: input.title,
    content: input.content,
    mode: input.mode,
    scheduledTime: input.scheduledTime,
    useAI: input.useAI,
    confirm: input.confirm,
    headless: input.headless,
  });
}

/**
 * 删除章节（默认预览）。
 *
 * ⚠️ 必须从**章节管理列表页**（`chapterManageUrl`）删，不能打开章节编辑器删——
 * 打开 `/front/book-upload?id=…`（不带 cid）平台会**自动新建一条草稿**，等于没删还多一条。
 * 真实删除交互（hover 出的删除图标 → 二次确认）尚未真机联调。 */
export async function deleteChapter(input: {
  bookId: string;
  chapterId: string;
  confirm?: boolean;
  headless?: boolean;
}): Promise<WriteChapterResult> {
  assertCookies();
  const session = await openSession(input.headless ?? true, chapterManageUrl(input.bookId));
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
    const modal = await visibleModalText(page);
    const shotPath = await shot(page, "chapter-delete-done");
    await browser.close().catch(() => {});
    return {
      ok: true,
      action: "deleted",
      message: `已提交删除 chapterId=${input.chapterId}。${modal ? `页面提示：${modal.slice(0, 200)}` : "（未读到明确提示，请到章节管理页复核）"}`,
      screenshotPath: shotPath,
    };
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
