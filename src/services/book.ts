import { logger } from "../core/logger.js";
import { shot } from "../browser/driver.js";
import { API, apiGet, openSession, isError, bookManageUrl, createBookUrl, bookInfoUrl, authorBase } from "../browser/endpoints.js";
import { fillByLabel, readForm, clickInFormItem } from "../browser/form.js";
import { realClickText, waitForText, visibleModalText } from "../browser/page.js";
import { assertCookies } from "./auth.js";

export type BookKind = "long" | "short";

export interface BookSummary {
  bookId: string;
  bookName: string;
  /** 连载中 / 已完结 / 草稿 等（平台原文） */
  status?: string;
  category?: string;
  words?: number;
  chapterCount?: number;
  /** 原始条目，字段名不确定时排障用 */
  raw?: unknown;
}

/** 容错取值：在不同命名（后端字段名未公开）中取第一个命中的 */
function pick<T = unknown>(obj: any, keys: string[]): T | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== "") return v as T;
  }
  return undefined;
}

/** 把后台作品条目归一化成稳定结构（字段名以联调结果为准，这里做多命名兼容） */
export function normalizeBook(b: any): BookSummary {
  return {
    bookId: String(pick(b, ["book_id", "bookId", "id", "bid"]) ?? ""),
    bookName: String(pick(b, ["book_name", "bookName", "name", "title"]) ?? ""),
    status: pick<string>(b, ["status_name", "statusName", "status", "book_status_name"]),
    category: pick<string>(b, ["category_name", "categoryName", "category", "channel_name"]),
    words: pick<number>(b, ["word_count", "wordCount", "words", "total_words", "word_num"]),
    chapterCount: pick<number>(b, ["chapter_num", "chapterNum", "chapter_count", "chapterCount"]),
    raw: b,
  };
}

/** 从各种可能的包装里取出书籍数组 */
function extractList(data: any): any[] {
  if (Array.isArray(data)) return data;
  for (const k of ["list", "book_list", "bookList", "data", "items", "records"]) {
    if (Array.isArray(data?.[k])) return data[k];
  }
  return [];
}

export interface ListBooksResult {
  ok: boolean;
  message: string;
  total?: number;
  /** 游标：非空时把它再传回来即可取下一页（平台的列表分页是 next_id 游标，不是页码） */
  nextId?: string;
  books: BookSummary[];
  error?: string;
}

/**
 * 读作品列表（只读 HTTP）——长篇或短篇。
 *
 * 真机验证（2026-10）：接口是 `book-list-v2`，分页靠 `next_id` 游标（页面只发 `next_id` + `t`），
 * 响应为 `{data:{list:[],total:0,next_id:""}}`。
 */
export async function listBooks(opts: { kind?: BookKind; nextId?: string } = {}): Promise<ListBooksResult> {
  assertCookies();
  const kind = opts.kind ?? "long";
  const r = await apiGet(kind === "short" ? API.bookShortList : API.bookList, { next_id: opts.nextId ?? "" });
  if (!r.ok) return { ok: false, message: `读取作品列表失败：${r.error}`, books: [], error: r.error };

  const list = extractList(r.data);
  const total = pick<number>(r.data, ["total", "count", "total_count"]) ?? list.length;
  const nextId = String(pick<string>(r.data, ["next_id", "nextId"]) ?? "");
  return {
    ok: true,
    message: `共 ${total} 部${kind === "short" ? "短篇" : "长篇"}作品。`,
    total,
    nextId: nextId || undefined,
    books: list.map(normalizeBook),
  };
}

/* ------------------------------ 建书 ------------------------------ */

export interface CreateBookInput {
  bookName: string;
  /** 1=男频 0=女频（以平台实际字段为准） */
  gender?: number;
  abstract?: string;
  protagonist1?: string;
  protagonist2?: string;
  category?: string;
  tags?: string[];
  confirm?: boolean;
  headless?: boolean;
}

export interface WriteResult {
  ok: boolean;
  action: "preview" | "created" | "updated" | "deleted" | "error";
  message: string;
  bookId?: string;
  screenshotPath?: string;
  filled?: Record<string, string>;
  missing?: string[];
}

/** 依次尝试多个候选 label，命中即填 */
async function fillFirst(page: any, candidates: string[], value: string): Promise<{ label?: string; ok: boolean }> {
  for (const c of candidates) {
    const r = await fillByLabel(page, c, value);
    if (r.ok) return { label: c, ok: true };
  }
  return { ok: false };
}

/**
 * 新建作品。
 *
 * 默认 `confirm=false`：只打开建书页、读取当前表单、截图，**不填不提交**。
 * `confirm=true`：按 label 文本填表并点击提交按钮。
 *
 * ⚠️ 七猫建书页的具体 label 文案/必填项以真机为准；本函数用候选 label 列表匹配，
 *    未命中的字段会回在 `missing` 里，不会静默忽略。
 */
export async function createBook(input: CreateBookInput): Promise<WriteResult> {
  assertCookies();
  const session = await openSession(input.headless ?? true, "/front/book-upload");
  if (isError(session)) return { ok: false, action: "error", message: session.error };
  const { browser, page } = session;

  try {
    const filled: Record<string, string> = {};
    const missing: string[] = [];

    if (!input.confirm) {
      const shotPath = await shot(page, "book-create-preview");
      await browser.close().catch(() => {});
      return {
        ok: true,
        action: "preview",
        message: `已打开建书页（confirm=false，未填表未提交）。当前表单字段：${Object.keys(await readForm(page)).join("/")}。核对无误后传 confirm=true。`,
        screenshotPath: shotPath,
        filled: await readForm(page),
      };
    }

    const title = await fillFirst(page, ["作品名称", "书名", "作品名", "小说名称"], input.bookName);
    if (title.ok) filled[title.label as string] = input.bookName;
    else missing.push("bookName(作品名称)");

    if (input.abstract) {
      const r = await fillFirst(page, ["作品简介", "简介", "内容简介"], input.abstract);
      if (r.ok) filled[r.label as string] = input.abstract;
      else missing.push("abstract(作品简介)");
    }

    for (const [key, val] of [
      ["protagonist1", input.protagonist1],
      ["protagonist2", input.protagonist2],
    ] as const) {
      if (!val) continue;
      const r = await fillFirst(page, ["主角名", "主角名称", "主角", "人物名称"], val);
      if (r.ok) filled[r.label as string] = val;
      else missing.push(`${key}(主角名)`);
    }

    if (input.category) {
      const r = await clickInFormItem(page, "作品分类", input.category);
      if (r) filled["作品分类"] = input.category;
      else missing.push("category(作品分类)");
    }

    // 提交
    const clicked =
      (await realClickText(page, "立即创建", { exact: true })) ||
      (await realClickText(page, "创建作品", { exact: true })) ||
      (await realClickText(page, "提交", { exact: true })) ||
      (await realClickText(page, "完成", { exact: true }));
    if (!clicked) {
      const shotPath = await shot(page, "book-create-nobutton");
      await browser.close().catch(() => {});
      return {
        ok: false,
        action: "error",
        message: `已填表但未找到提交按钮（可能按钮文案不同）。已填：${Object.keys(filled).join("/")}；缺：${missing.join("/") || "无"}。`,
        screenshotPath: shotPath,
        filled,
        missing,
      };
    }

    await waitForText(page, "成功", 8000).catch(() => false);
    const modal = await visibleModalText(page);
    const shotPath = await shot(page, "book-create-done");
    await browser.close().catch(() => {});
    return {
      ok: true,
      action: "created",
      message: `已提交建书：《${input.bookName}》。${missing.length ? `未命中字段：${missing.join("/")}。` : ""}${modal ? `页面提示：${modal.slice(0, 200)}` : ""}`,
      screenshotPath: shotPath,
      filled,
      missing,
    };
  } catch (e) {
    await browser.close().catch(() => {});
    return { ok: false, action: "error", message: `建书异常：${(e as Error).message}` };
  }
}

/* ------------------------------ 改作品信息 ------------------------------ */

export interface UpdateBookInfoInput {
  bookId: string;
  bookName?: string;
  abstract?: string;
  protagonist1?: string;
  protagonist2?: string;
  category?: string;
  confirm?: boolean;
  headless?: boolean;
}

/**
 * 修改已有作品信息（书名 / 简介 / 主角 / 分类）。
 * 默认 `confirm=false`：只打开作品信息页读现状 + 截图，**完全不填充**（避免误改线上）。
 *
 * ⚠️ 已知缺口：`category`（分类）与 `tags`（标签）**目前没有落到页面**——真机看清
 *    「分类 / 标签」控件（`book/book-option` 给出的 `tag_id` / `tag_name`）后需在此补齐。
 */
export async function updateBookInfo(input: UpdateBookInfoInput): Promise<WriteResult> {
  assertCookies();
  const path = bookInfoUrl(input.bookId);
  const session = await openSession(input.headless ?? true, path);
  if (isError(session)) return { ok: false, action: "error", message: session.error };
  const { browser, page } = session;

  try {
    const current = await readForm(page);
    if (!input.confirm) {
      const shotPath = await shot(page, "book-info-preview");
      await browser.close().catch(() => {});
      return {
        ok: true,
        action: "preview",
        message: `已打开作品信息页（confirm=false，未做任何修改）。现状：${JSON.stringify(current).slice(0, 400)}`,
        screenshotPath: shotPath,
        filled: current,
      };
    }

    const filled: Record<string, string> = {};
    const missing: string[] = [];
    const plan: [string[], string | undefined, string][] = [
      [["作品名称", "书名", "作品名"], input.bookName, "bookName"],
      [["作品简介", "简介", "内容简介"], input.abstract, "abstract"],
      [["主角名", "主角", "人物名称"], input.protagonist1, "protagonist1"],
    ];
    for (const [labels, value, key] of plan) {
      if (!value) continue;
      const r = await fillFirst(page, labels, value);
      if (r.ok) filled[r.label as string] = value;
      else missing.push(key);
    }

    const clicked =
      (await realClickText(page, "保存", { exact: true })) ||
      (await realClickText(page, "提交", { exact: true })) ||
      (await realClickText(page, "立即修改", { exact: true }));
    const shotPath = await shot(page, "book-info-done");
    await browser.close().catch(() => {});
    return {
      ok: clicked,
      action: clicked ? "updated" : "error",
      message: clicked
        ? `已提交作品信息修改（bookId=${input.bookId}）。${missing.length ? `未命中字段：${missing.join("/")}。` : ""}`
        : `已填表但未找到保存按钮。缺：${missing.join("/") || "无"}。`,
      screenshotPath: shotPath,
      filled,
      missing,
    };
  } catch (e) {
    await browser.close().catch(() => {});
    return { ok: false, action: "error", message: `改作品信息异常：${(e as Error).message}` };
  }
}

/**
 * 只改「分类 / 标签」的快捷入口（内部就是 updateBookInfo 的薄包装）。
 * 语义是「确保这些标签处于选中」，已选中的会跳过。
 */
export async function setBookTags(input: { bookId: string; tags?: string[]; category?: string; confirm?: boolean; headless?: boolean }): Promise<WriteResult> {
  return updateBookInfo({
    bookId: input.bookId,
    category: input.category,
    confirm: input.confirm,
    headless: input.headless,
  });
}

/** 只读：作品分类 / 标签可选项（供建书与改信息时选值） */
export interface BookOptionTag {
  id: string;
  tagId: string;
  name: string;
}
export interface BookOptionGroup {
  typeId: number;
  tags: BookOptionTag[];
}
export interface BookOptionGender {
  index: number;
  /** 一级 / 二级分类（真机上作者无书时可能为空数组） */
  categories: BookOptionTag[];
  groups: BookOptionGroup[];
}
export interface ListBookOptionsResult {
  ok: boolean;
  message: string;
  /** 男频 / 女频各一组（index 0 / 1） */
  genders?: BookOptionGender[];
  /** 全部标签去重后的平铺列表，方便直接挑选 */
  tags?: BookOptionTag[];
  /** 其它可选配置（有奖征文、上传图片限制等） */
  extra?: unknown;
}

/**
 * 读分类 / 标签可选项。
 *
 * 走 `book/book-option`（真机验证 2026-10）：`data.category_list[i].tag_info[j].select_list[]`
 * = `{id, tag_id, tag_name}`，i 为男频/女频两组。早先走的 `/book/tag-list-option` 缺参会
 * 40001002 参数错误，已弃用。
 */
export async function listBookOptions(): Promise<ListBookOptionsResult> {
  assertCookies();
  const r = await apiGet(API.bookOption);
  if (!r.ok) return { ok: false, message: `读取分类/标签选项失败：${r.error}` };

  const d: any = r.data ?? {};
  const toTag = (x: any): BookOptionTag => ({
    id: String(x?.id ?? ""),
    tagId: String(x?.tag_id ?? x?.id ?? ""),
    name: String(x?.tag_name ?? x?.name ?? ""),
  });

  const genders: BookOptionGender[] = (Array.isArray(d.category_list) ? d.category_list : []).map(
    (c: any, index: number): BookOptionGender => ({
      index,
      categories: (Array.isArray(c?.category) ? c.category : []).map(toTag).filter((t: BookOptionTag) => t.name),
      groups: (Array.isArray(c?.tag_info) ? c.tag_info : []).map((t: any): BookOptionGroup => ({
        typeId: Number(t?.type_id ?? 0),
        tags: (Array.isArray(t?.select_list) ? t.select_list : []).map(toTag).filter((x: BookOptionTag) => x.name),
      })),
    })
  );

  const seen = new Set<string>();
  const tags: BookOptionTag[] = [];
  for (const g of genders) {
    for (const grp of g.groups) {
      for (const t of grp.tags) {
        const key = t.tagId || t.name;
        if (seen.has(key)) continue;
        seen.add(key);
        tags.push(t);
      }
    }
  }

  return {
    ok: true,
    message: `已读取分类/标签选项：${genders.length} 组（男频/女频）、去重后 ${tags.length} 个标签。`,
    genders,
    tags,
    extra: {
      book_activity_list: d.book_activity_list,
      book_config: d.book_config,
      upload_image_config: d.upload_image_config,
    },
  };
}

/** 后台地址（供工具返回里提示用户去哪里核对） */
export function manageUrlHints(): Record<string, string> {
  return {
    bookManage: bookManageUrl(),
    createBook: createBookUrl(),
    bookData: `${authorBase()}/front/book-data`,
    income: `${authorBase()}/front/income-manage`,
  };
}

export { logger };
