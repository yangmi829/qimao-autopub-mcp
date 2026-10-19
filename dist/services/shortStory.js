import { shot } from "../browser/driver.js";
import { API, apiGet, openSession, isError, shortManageUrl, shortCreateUrl, shortStoryInfoUrl } from "../browser/endpoints.js";
import { fillByLabel, readForm } from "../browser/form.js";
import { realClickText, visibleModalText, waitForText } from "../browser/page.js";
import { logger } from "../core/logger.js";
import { countCjk, toPlainText } from "../core/text.js";
import { assertCookies } from "./auth.js";
/**
 * 七猫「短篇作品」。
 *
 * 只读走纯 HTTP（`book-shortstory-list-v2` / `edit-index`），写操作驱动真实页面。
 * ⚠️ 七猫短篇的字数规则与必填门以平台实时提示为准：这里只做**经验区间提醒**，
 *    不做硬拦截（拦错了比不拦更糟）。联调拿到真实规则后再收紧。
 */
export const SHORT_MIN_WORDS = 3000;
export const SHORT_MAX_WORDS = 100000;
export const SHORT_BEST_RANGE = "1 万 – 3 万字";
function pick(obj, keys) {
    if (!obj || typeof obj !== "object")
        return undefined;
    for (const k of keys) {
        const v = obj[k];
        if (v !== undefined && v !== null && v !== "")
            return v;
    }
    return undefined;
}
function extractList(data) {
    if (Array.isArray(data))
        return data;
    for (const k of ["list", "book_list", "bookList", "data", "items", "records"]) {
        if (Array.isArray(data?.[k]))
            return data[k];
    }
    return [];
}
export function normalizeShortStory(b) {
    return {
        bookId: String(pick(b, ["book_id", "bookId", "id", "bid"]) ?? ""),
        title: String(pick(b, ["book_name", "bookName", "name", "title"]) ?? ""),
        words: pick(b, ["word_count", "wordCount", "words", "total_words", "word_num"]),
        status: pick(b, ["status_name", "statusName", "status", "book_status_name"]),
        category: pick(b, ["category_name", "categoryName", "category"]),
        raw: b,
    };
}
/** 读短篇列表（只读 HTTP）。与长篇列表同族，分页同样用 `next_id` 游标。 */
export async function listShortStories(opts = {}) {
    assertCookies();
    const r = await apiGet(API.bookShortList, { next_id: opts.nextId ?? "" });
    if (!r.ok)
        return { ok: false, message: `读取短篇列表失败：${r.error}`, stories: [] };
    const list = extractList(r.data);
    const total = pick(r.data, ["total", "count", "total_count"]) ?? list.length;
    const nextId = String(pick(r.data, ["next_id", "nextId"]) ?? "");
    return {
        ok: true,
        message: `共 ${total} 篇短篇作品。`,
        total,
        nextId: nextId || undefined,
        stories: list.map(normalizeShortStory),
    };
}
/** 读短篇详情（只读 HTTP） */
export async function getShortStory(bookId) {
    assertCookies();
    const r = await apiGet(API.bookDetail, { book_id: bookId });
    if (!r.ok)
        return { ok: false, message: `读取短篇详情失败：${r.error}` };
    const d = r.data ?? {};
    const story = normalizeShortStory({ book_id: bookId, ...d });
    return { ok: true, message: `已读取短篇《${story.title || bookId}》。`, story, data: r.data };
}
/* ------------------------------ 本地字数校验（软） ------------------------------ */
export function validateShortContent(content) {
    const wordCount = countCjk(toPlainText(content));
    const warnings = [];
    if (wordCount < SHORT_MIN_WORDS)
        warnings.push(`正文 ${wordCount} 字，低于经验下限 ${SHORT_MIN_WORDS} 字（以平台实际规则为准）。`);
    if (wordCount > SHORT_MAX_WORDS)
        warnings.push(`正文 ${wordCount} 字，超过经验上限 ${SHORT_MAX_WORDS} 字（以平台实际规则为准）。`);
    return { wordCount, warnings };
}
/**
 * 新建短篇并可选提交（打开短篇创建页 `/front/book-upload/short`）。
 * 默认 `confirm=false`：只打开页面读现状 + 截图，不填不提交。
 */
export async function createShortStory(input) {
    assertCookies();
    const session = await openSession(input.headless ?? true, "/front/book-upload/short");
    if (isError(session))
        return { ok: false, action: "error", message: session.error };
    const { browser, page } = session;
    try {
        if (!input.confirm) {
            const form = await readForm(page);
            const shotPath = await shot(page, "short-create-preview");
            await browser.close().catch(() => { });
            return {
                ok: true,
                action: "preview",
                message: `已打开短篇创建页（confirm=false，未填表未提交）。当前表单字段：${Object.keys(form).join("/") || "（未识别到 el-form-item）"}。`,
                screenshotPath: shotPath,
                filled: form,
            };
        }
        const filled = {};
        const missing = [];
        const warnings = [];
        if (input.title) {
            const r = (await fillByLabel(page, "作品名称", input.title)).ok
                ? { ok: true, label: "作品名称" }
                : (await fillByLabel(page, "书名", input.title)).ok
                    ? { ok: true, label: "书名" }
                    : { ok: false };
            if (r.ok)
                filled[r.label] = input.title;
            else
                missing.push("title(作品名称)");
        }
        if (input.content) {
            const plain = toPlainText(input.content);
            warnings.push(...validateShortContent(plain).warnings);
            const ok = (await fillByLabel(page, "正文", plain)).ok || (await fillByLabel(page, "作品正文", plain)).ok;
            if (ok)
                filled["正文"] = `${countCjk(plain)} 字`;
            else
                missing.push("content(正文)");
        }
        if (input.category) {
            const ok = (await fillByLabel(page, "分类", input.category)).ok || (await fillByLabel(page, "作品分类", input.category)).ok;
            if (ok)
                filled["分类"] = input.category;
            else
                missing.push("category(分类)");
        }
        const submitted = (await realClickText(page, "立即创建", { exact: true })) ||
            (await realClickText(page, "创建作品", { exact: true })) ||
            (await realClickText(page, "提交", { exact: true })) ||
            (await realClickText(page, "保存", { exact: true }));
        const modal = await visibleModalText(page);
        const shotPath = await shot(page, "short-create-done");
        await browser.close().catch(() => { });
        return {
            ok: submitted,
            action: submitted ? "published" : "error",
            message: submitted
                ? `已提交短篇《${input.title ?? ""}》。${missing.length ? `未命中字段：${missing.join("/")}。` : ""}${modal ? `页面提示：${modal.slice(0, 200)}` : ""}`
                : `已填表但未找到提交按钮。缺：${missing.join("/") || "无"}。`,
            screenshotPath: shotPath,
            filled,
            missing: missing.length ? missing : undefined,
            warnings: warnings.length ? warnings : undefined,
        };
    }
    catch (e) {
        await browser.close().catch(() => { });
        return { ok: false, action: "error", message: `新建短篇异常：${e.message}` };
    }
}
/**
 * 发布短篇（已有 bookId 时打开短篇管理页提交；无 bookId 时等同 createShortStory）。
 * ⚠️ 短篇编辑器同样可能边输入边自动保存，所以 confirm=false **只读现状 + 截图，绝不填充**。
 */
export async function publishShortStory(input) {
    assertCookies();
    if (!input.bookId && !input.title) {
        return { ok: false, action: "error", message: "需提供 book_id，或 title（+content）以新建并发布。" };
    }
    const warnings = [];
    if (input.content)
        warnings.push(...validateShortContent(toPlainText(input.content)).warnings);
    const session = await openSession(input.headless ?? true, input.bookId ? shortStoryInfoUrl(input.bookId) : shortCreateUrl());
    if (isError(session))
        return { ok: false, action: "error", message: session.error, warnings };
    const { browser, page } = session;
    try {
        if (!input.confirm) {
            const form = await readForm(page);
            const shotPath = await shot(page, "short-publish-preview");
            await browser.close().catch(() => { });
            return {
                ok: true,
                action: "preview",
                message: `已打开短篇${input.bookId ? "管理" : "创建"}页（confirm=false，**未做任何填充/提交**）。` +
                    `book_id=${input.bookId ?? "（新建）"}。确认后传 confirm=true 才提交。`,
                screenshotPath: shotPath,
                filled: form,
                warnings: warnings.length ? warnings : undefined,
            };
        }
        const filled = {};
        const missing = [];
        if (input.title) {
            const ok = (await fillByLabel(page, "作品名称", input.title)).ok || (await fillByLabel(page, "书名", input.title)).ok;
            if (ok)
                filled["作品名称"] = input.title;
            else
                missing.push("title(作品名称)");
        }
        if (input.content) {
            const plain = toPlainText(input.content);
            const ok = (await fillByLabel(page, "正文", plain)).ok || (await fillByLabel(page, "作品正文", plain)).ok;
            if (ok)
                filled["正文"] = `${countCjk(plain)} 字`;
            else
                missing.push("content(正文)");
        }
        const submitted = (await realClickText(page, "发布", { exact: true })) ||
            (await realClickText(page, "提交审核", { exact: true })) ||
            (await realClickText(page, "提交", { exact: true })) ||
            (await realClickText(page, "确定", { exact: true }));
        const modal = await visibleModalText(page);
        const shotPath = await shot(page, "short-publish-done");
        await browser.close().catch(() => { });
        return {
            ok: submitted,
            action: submitted ? "published" : "error",
            message: submitted
                ? `已提交短篇发布（book_id=${input.bookId ?? "新建"}）。${missing.length ? `未命中字段：${missing.join("/")}。` : ""}${modal ? `页面提示：${modal.slice(0, 200)}` : ""}`
                : `已填表但未找到提交按钮。缺：${missing.join("/") || "无"}。`,
            screenshotPath: shotPath,
            bookId: input.bookId,
            filled,
            missing: missing.length ? missing : undefined,
            warnings: warnings.length ? warnings : undefined,
        };
    }
    catch (e) {
        await browser.close().catch(() => { });
        return { ok: false, action: "error", message: `发布短篇异常：${e.message}`, warnings };
    }
}
/** 删除短篇 / 草稿（破坏性；默认预览） */
export async function deleteShortStory(bookId, opts = {}) {
    assertCookies();
    const session = await openSession(opts.headless ?? true, shortManageUrl());
    if (isError(session))
        return { ok: false, action: "error", message: session.error };
    const { browser, page } = session;
    try {
        if (!opts.confirm) {
            const shotPath = await shot(page, "short-delete-preview");
            await browser.close().catch(() => { });
            return {
                ok: true,
                action: "preview",
                message: `将删除短篇 book_id=${bookId}（confirm=false，未执行）。confirm=true 才真正删除。`,
                screenshotPath: shotPath,
            };
        }
        await waitForText(page, "短篇", 8000).catch(() => false);
        // 列表里 hover 出删除图标再二次确认（图标无稳定选择器，按文案兜底）
        await realClickText(page, "删除", { exact: true });
        await realClickText(page, "确定", { exact: true });
        const shotPath = await shot(page, "short-delete-done");
        await browser.close().catch(() => { });
        return { ok: true, action: "deleted", message: `已提交删除短篇 book_id=${bookId}。`, screenshotPath: shotPath };
    }
    catch (e) {
        await browser.close().catch(() => { });
        return { ok: false, action: "error", message: `删除短篇异常：${e.message}` };
    }
}
export { logger };
