import { sleep, shot } from "../browser/driver.js";
import { NEXT_STEP_BOOK_CREATED, NEXT_STEP_SHORT_PUBLISHED } from "../core/reminders.js";
import { API, apiGet, openSession, isError, authorBase, shortManageUrl, shortChapterEditUrl, SHORT_CLIENT_ID, } from "../browser/endpoints.js";
import { readForm } from "../browser/form.js";
import { realClickText, realClickByJs, fillInput, visibleModalText, visibleToastText, acceptPublishConfirm, clickAgreementIfPresent, waitForText, describeAiDeclaration, } from "../browser/page.js";
import { logger } from "../core/logger.js";
import { countCjk, toPlainText, cleanBookTitle } from "../core/text.js";
import { assertCookies, assertWriteReady } from "./auth.js";
import { fillBookInfoFields, jsFormItemRadio, readCreateFormState } from "./book.js";
import { CHAPTER_SELECTORS, readEditorState } from "./chapter.js";
/**
 * 短篇信息表单页写死的站点 `client_id`（真机 2026-10 读 `formData.client_id` = "5"）。
 * 真身在 `browser/endpoints.ts`（`services/book.ts` 判「该 book_id 是不是短篇」也要用它），这里重新导出保持旧引用可用。
 */
export { SHORT_CLIENT_ID };
/**
 * 七猫「短篇作品」。
 *
 * 只读走纯 HTTP（`book-shortstory-list-v2` / `edit-index`），写操作驱动真实页面。
 * ✅ 2026-10 真机联调：建篇（`createShortStory`）与发布正文（`publishShortStory`）均已跑通。
 */
export const SHORT_MIN_WORDS = 4000;
export const SHORT_MAX_WORDS = 70000;
/** 经验性「比较好过稿」的区间（平台只硬卡上下限，本项仅作文案提示） */
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
        title: String(pick(b, ["title", "book_name", "bookName", "name"]) ?? ""),
        words: pick(b, ["total_words", "word_count", "wordCount", "words", "word_num"]),
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
 * 新建短篇（真机 2026-10 联调通过的完整流程）：
 *
 * 1. 打开**短故事管理页** `/front/book-manage/short`；
 * 2. 点「新建短故事」（列表为空时也点这个；空态另有一个「创建短故事」大按钮作兜底）
 *    → **直接跳** `/front/book-manage/short/information`（⚠️ 短篇**没有**长篇那样的「选择首发站点」弹窗）；
 * 3. 目标读者 radio → 作品类型（一级/二级）→ 作品标签 → 主角名 → 作品简介
 *    （与长篇共用 `fillBookInfoFields`，两页是同一个组件）；
 * 4. 点「确认创建」→ `POST book/save-book-info` 返回 `data.book_id`（与长篇同一个接口）。
 *
 * ⚠️ 前端必填门（`submitBtnDisabled`，真机读出的源码）与长篇一致：
 *    `作品名 && 目标读者 && 一级分类 && 二级分类 && 作品简介 && 至少1个标签 && 至少1个主角名`。
 *    所以未显式传入的字段会兜底填默认值，避免「按钮一直灰着」的迷惑失败。
 * ⚠️ 短篇的站点 `client_id` 由页面写死为 `5`（见 `SHORT_CLIENT_ID`），无需也**无法**在此选择。
 * ⚠️ 本工具只建「短篇壳」；正文请建好后用 `publishShortStory`（带 bookId）发布。
 */
export async function createShortStory(input) {
    assertWriteReady();
    const session = await openSession(input.headless ?? true, shortManageUrl());
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
                message: `已打开短故事管理页（confirm=false，未点「新建短故事」、未填表未提交）。` +
                    `⚠️ 真机确认：短篇创建**没有站点选择弹窗**——点「新建短故事」直接跳 /front/book-manage/short/information 填表` +
                    `（页面自带 client_id=${SHORT_CLIENT_ID}）。确认后传 confirm=true。`,
                screenshotPath: shotPath,
                filled: form,
            };
        }
        const filled = {};
        const missing = [];
        const warnings = [];
        const notes = [];
        if (input.content)
            warnings.push(...validateShortContent(toPlainText(input.content)).warnings);
        // 0) 作品名按平台白名单清洗（与长篇同一套规则：全角括号等会被拒，按钮永远灰着）
        const { title: safeName, changed: nameChanged } = cleanBookTitle(input.title ?? "");
        if (!safeName) {
            await browser.close().catch(() => { });
            return {
                ok: false,
                action: "error",
                message: `作品名清洗后为空（原值「${input.title ?? ""}」）。七猫作品名仅支持中英文、数字（含罗马数字Ⅰ~Ⅻ）与，「：！？」等中文标点。`,
            };
        }
        if (nameChanged)
            notes.push(`作品名已清洗：《${input.title}》→《${safeName}》`);
        // 1) 列表页 →「新建短故事」→ 直接跳信息表单页
        const clickedNew = (await realClickText(page, "新建短故事", { exact: true })) ||
            (await realClickText(page, "创建短故事", { exact: true }));
        if (!clickedNew) {
            const shotPath = await shot(page, "short-create-no-btn");
            await browser.close().catch(() => { });
            return { ok: false, action: "error", message: `未找到「新建短故事」按钮（页面未加载完或文案变了）。`, screenshotPath: shotPath };
        }
        await sleep(4500);
        filled["入口"] = "短故事管理页 →「新建短故事」";
        if (!page.url().includes("/short/information"))
            notes.push(`提示：点「新建短故事」后 URL 未出现 /short/information（当前 ${page.url()}），后续步骤可能失败。`);
        // 2) 目标读者（radio：0=男生 / 1=女生；工具的 gender：1=男频 → 男生）
        const gender = input.gender ?? 1;
        if (await realClickByJs(page, jsFormItemRadio("目标读者", gender === 1 ? 0 : 1))) {
            filled["目标读者"] = gender === 1 ? "男生" : "女生";
        }
        else
            missing.push("gender(目标读者)");
        await sleep(1600); // 选完目标读者才会加载一级分类
        // 3) 作品名 / 分类 / 简介 / 主角 / 标签（与长篇建书共用同一套填充逻辑）
        if (!input.abstract?.trim())
            notes.push("未提供简介，已填默认占位（可在作品信息页再改）");
        if (!input.protagonist1?.trim())
            notes.push("未提供主角名，已填默认「主角」");
        if (!input.tags?.length)
            notes.push("未指定标签，已按分组各取第一个");
        if (!input.category)
            notes.push("未指定分类，已取第一个一级分类");
        const fillRes = await fillBookInfoFields(page, {
            bookName: safeName,
            category: input.category ?? "",
            categorySub: input.categorySub ?? "",
            abstract: input.abstract?.trim() || `本作品简介待完善：${safeName}`,
            protagonist1: input.protagonist1?.trim() || "主角",
            protagonist2: input.protagonist2?.trim(),
            tags: input.tags?.length ? input.tags : [""],
        }, filled, missing, "（短篇）");
        // ⚠️ 显式传入的分类没匹配上 → 中止（不提交）。旧行为是「静默取第一项 + 顶层 ok:true」，
        //    出过「建出来是 现代言情/总裁豪门，但工具报成功」的事故（只能删篇重建）。
        if (!fillRes.categoryOk) {
            const shotPath = await shot(page, "short-create-category-mismatch");
            await browser.close().catch(() => { });
            return {
                ok: false,
                action: "error",
                message: `分类未匹配，已中止建篇（**未提交**）：${missing.join("；")}。` +
                    `短篇分类请先用 list_book_options_qimao(client_id="5") 查准确名称后重试。`,
                screenshotPath: shotPath,
                filled,
                missing,
            };
        }
        // 4) 提交前读门禁（拿不到 Vue 状态就跳过，不影响主流程）
        const state = await readCreateFormState(page);
        if (state?.disabled) {
            const shotPath = await shot(page, "short-create-blocked");
            await browser.close().catch(() => { });
            return {
                ok: false,
                action: "error",
                message: `短篇建篇前置条件未满足，未提交。前端提示：${state.titleError || state.charactersError || "（无文案，可能是必填项未选中）"}。` +
                    `必填＝作品名/目标读者/一级分类/二级分类/简介/至少1个标签/至少1个主角名。状态：${JSON.stringify(state)}`,
                screenshotPath: shotPath,
                filled,
                missing,
            };
        }
        // 5) 确认创建：以 `book/save-book-info` 响应为准判成功
        let createdBookId = "";
        const onResponse = async (resp) => {
            try {
                if (!String(resp.url()).includes("/book/save-book-info"))
                    return;
                const body = await resp.text();
                const id = JSON.parse(body)?.data?.book_id;
                if (id)
                    createdBookId = String(id);
            }
            catch {
                /* 忽略解析失败 */
            }
        };
        page.on("response", onResponse);
        if (!(await realClickText(page, "确认创建", { exact: true }))) {
            page.off("response", onResponse).catch?.(() => { });
            const shotPath = await shot(page, "short-create-nobutton");
            await browser.close().catch(() => { });
            return {
                ok: false,
                action: "error",
                message: `未找到「确认创建」按钮。已填：${Object.keys(filled).join("/")}；缺：${missing.join("/") || "无"}。`,
                screenshotPath: shotPath,
                filled,
                missing,
            };
        }
        await sleep(6000);
        page.off("response", onResponse).catch?.(() => { });
        const modal = await visibleModalText(page);
        const shotPath = await shot(page, "short-create-done");
        await browser.close().catch(() => { });
        if (!createdBookId) {
            return {
                ok: false,
                action: "error",
                message: `已点「确认创建」但没抓到创建成功响应（book/save-book-info）。${modal ? `页面提示：${modal.slice(0, 200)}` : ""}建议到短故事管理页核对。`,
                screenshotPath: shotPath,
                filled,
                missing,
                warnings: warnings.length ? warnings : undefined,
            };
        }
        return {
            ok: true,
            action: "created",
            bookId: createdBookId,
            message: `已建短篇：《${safeName}》（book_id=${createdBookId}，client_id=${SHORT_CLIENT_ID}）。` +
                `正文请再用 publish_short_story_qimao 带 book_id 发布。` +
                `${missing.length ? `未命中字段：${missing.join("/")}。` : ""}${notes.length ? notes.join(" ") : ""}` +
                NEXT_STEP_BOOK_CREATED,
            screenshotPath: shotPath,
            filled,
            missing,
            warnings: warnings.length ? warnings : undefined,
        };
    }
    catch (e) {
        await browser.close().catch(() => { });
        return { ok: false, action: "error", message: `新建短篇异常：${e.message}` };
    }
}
/**
 * 发布 / 存草稿：短篇正文。
 *
 * - 传 `bookId`：打开**短篇正文编辑器** `/front/book-upload/short?id=<bookId>`
 *   （真机确认：该页就是这篇短篇的正文编辑器，`chapter-index` 回读 `book_info.client_id=5`；
 *   短故事列表里「编辑正文」给的 href 是 `/front/book-upload?id=…`，两条路由都能进）。
 * - 不传 `bookId`：转发 `createShortStory`（先建壳，正文要再发一次并带上 book_id）。
 *
 * 真机事实（2026-10 联调）：
 * - 该编辑器**没有**「章节序号 / 章节名称」输入框——短篇没有独立章节名，标题即作品名，
 *   正文里的小标题用工具栏把「正文」切成「标题」样式实现。故 `title` 参数在这里只作提示，不填充。
 * - 页头写死字数门：**正文最少 4000 字、最多 70000 字**（`global/config` 的
 *   `client_config[5].word_count[type=1]`，与页面文案一致）。`mode=publish` 低于下限时直接不提交。
 * - 按钮随状态变：新建＝「存为草稿」/「立即发布」；存过一次草稿＝「更新草稿」/「立即发布」；
 *   已发布过＝「更新章节」/「立即发布」。
 * - **发布要过三步**（`mode=publish`）：
 *   ① 点「立即发布」→ 弹「章节格式不满足发布要求，是否智能分章？」→「开始拆分」
 *      （短篇正文必须先拆成 500~1500 字的章节，平台才认；`POST book-chapter/smart-split`）；
 *   ② 弹「智能分章结果」（目录 01/02/…）→「保存分章结果」
 *      （`POST book-chapter/smart-split/result-decision`，`decision_status=10`）；
 *   ③ 再点「立即发布」→ 平台**查重**（重复率高会弹「本章存在重复内容…」直接拦下）→
 *      两层确认（`draft-publish-confirm`「确认发布」→「重要提醒」里点「我已阅读并知晓」→ 再「确认发布」）
 *      → 真正落地 `POST /api/pc/v2/book-chapter/draft-publish`。
 *   `mode=draft` 只需「存为草稿」→（弹「重要提醒」）「我已阅读并知晓」。
 * - 成功判据：publish ＝ `draft-publish` 响应 OK **或** 回读列表字数 > 0；
 *   draft ＝ 回读列表字数 > 0 **或** toast 含「成功/已保存」。✅ 真机口径：只有**显式提交**
 *   才会把字数写进列表，编辑器自动保存不会（13817817 自动保存后列表仍是 0）。
 *
 * ⚠️ 编辑器「边输入边自动保存」，所以 `confirm=false` **只读现状 + 截图，绝不填充**。
 */
export async function publishShortStory(input) {
    assertWriteReady();
    if (!input.bookId) {
        if (!input.title)
            return { ok: false, action: "error", message: "需提供 book_id（发布已有短篇），或 title（新建短篇）。" };
        const created = await createShortStory(input);
        return { ...created, message: `${created.message}（未传 book_id，本次走的是「新建短篇」流程；正文需在建好后再发一次并带上 book_id。）` };
    }
    const warnings = [];
    if (input.content)
        warnings.push(...validateShortContent(toPlainText(input.content)).warnings);
    const session = await openSession(input.headless ?? true, shortChapterEditUrl(input.bookId));
    if (isError(session))
        return { ok: false, action: "error", message: session.error, warnings };
    const { browser, page } = session;
    try {
        if (!input.confirm) {
            await sleep(4500);
            const state = await readEditorState(page);
            const shotPath = await shot(page, "short-publish-preview");
            await browser.close().catch(() => { });
            return {
                ok: true,
                action: "preview",
                message: `已打开短篇正文编辑器（confirm=false，**未做任何填充/提交**，避免触发自动保存）。` +
                    `book_id=${input.bookId}。当前：${JSON.stringify(state)}。确认后传 confirm=true 才提交。`,
                screenshotPath: shotPath,
                filled: state,
                warnings: warnings.length ? warnings : undefined,
            };
        }
        const filled = {};
        const missing = [];
        const notes = [];
        const mode = input.mode ?? "publish";
        const plain = input.content !== undefined ? toPlainText(input.content) : undefined;
        // 1) 正文（⚠️ 短篇没有章节名输入框，只有正文 contenteditable）
        if (plain !== undefined) {
            const words = countCjk(plain);
            if (words > SHORT_MAX_WORDS)
                missing.push(`content(正文 ${words} 字，超过平台上限 ${SHORT_MAX_WORDS})`);
            if (await fillInput(page, CHAPTER_SELECTORS.body, plain))
                filled["正文"] = `${words} 字`;
            else
                missing.push("content(正文)");
            await sleep(800);
        }
        if (input.title)
            notes.push(`短篇没有独立的章节名输入框，已忽略 title「${input.title}」（短篇标题＝作品名；正文内小标题用编辑器工具栏把「正文」切换为「标题」样式）`);
        // 2) 发布前拦一道：立即发布要够字数，否则前端会拦下（省一次往返）
        if (mode === "publish" && plain !== undefined && countCjk(plain) < SHORT_MIN_WORDS) {
            const shotPath = await shot(page, "short-too-short");
            await browser.close().catch(() => { });
            return {
                ok: false,
                action: "error",
                message: `正文 ${countCjk(plain)} 字，未达短篇「立即发布」下限 ${SHORT_MIN_WORDS} 字，未提交（平台会拦）。可改用 mode=draft 存草稿，或补足正文字数。`,
                screenshotPath: shotPath,
                bookId: input.bookId,
                filled,
                missing,
                warnings: warnings.length ? warnings : undefined,
            };
        }
        // 3) 提交。⚠️ 短篇发布比长篇发章**多一步「智能分章」**（真机 2026-10 全流程）：
        //    点「立即发布」→ ①「章节格式不满足发布要求，是否智能分章？」→「开始拆分」
        //                 → ②「智能分章结果」→「保存分章结果」（POST smart-split/result-decision decision_status=10）
        //                 → ③ 再点「立即发布」→ 平台查重（「本章存在重复内容」会拦下）→ 两层确认 → draft-publish。
        //    「存为草稿」不需要分章。
        const action = mode === "draft" ? "draft-saved" : "published";
        // 抓写接口响应作为权威判据。⚠️ 两条都要排除：
        //   ① `auto-save-chapter` 是编辑器**边输入边自动保存**，不算提交；
        //   ② `book-shortstory-list-v2` / `book-chapter/list` 是**只读列表**，更不算（早先正则误命中过）。
        const apiTrace = [];
        let publishDone = false;
        const onResp = async (resp) => {
            try {
                const u = String(resp.url());
                if (!/\/api\//.test(u))
                    return;
                if (/(list-v2|\/list\b|book-option|client-list|edit-index|req-info|global\/config|latest-smart-split-result|author\/)/i.test(u))
                    return;
                if (/auto-save/.test(u))
                    return;
                if (!/(draft-publish|save-chapter|smart-split|result-decision)/i.test(u))
                    return;
                const body = await resp.text();
                const bad = /error|"code":"4|失败|重复内容/.test(body);
                apiTrace.push(`${u.replace(authorBase(), "").split("&t=")[0]} => ${body.slice(0, 200)}`);
                if (bad)
                    return;
                if (/draft-publish(?!-confirm)/.test(u))
                    publishDone = true;
            }
            catch {
                /* 忽略 */
            }
        };
        page.on("response", onResp);
        const splitSteps = [];
        let clicked;
        let confirmed = [];
        let blockedText = "";
        let drafted = false;
        let aiDeclaration;
        for (let attempt = 0; attempt < 3; attempt++) {
            if (publishDone || drafted)
                break;
            // 上一轮留下的「智能分章结果」弹窗：先保存它，再回到主按钮
            if (splitSteps[splitSteps.length - 1] === "已拆分") {
                if (await realClickText(page, "保存分章结果", { exact: true })) {
                    splitSteps.push("已保存分章结果");
                    await sleep(6000);
                    continue;
                }
                splitSteps.push("未找到「保存分章结果」");
            }
            // 主按钮（候选按顺序试一遍）。⚠️ 真机：新短篇＝「存为草稿」/「立即发布」；
            // 存过一次草稿后＝「更新草稿」/「立即发布」；已发布过的短篇＝「更新章节」/「立即发布」。
            const candidates = clicked ? [clicked] : mode === "draft" ? ["存为草稿", "更新草稿", "保存草稿", "更新章节"] : ["立即发布"];
            let hit;
            for (const t of candidates) {
                if (await realClickText(page, t, { exact: true })) {
                    hit = t;
                    break;
                }
            }
            if (!hit)
                break;
            clicked = hit;
            await sleep(2500);
            // ① 智能分章询问（只有 publish 会出现）
            if (await realClickText(page, "开始拆分", { exact: true })) {
                splitSteps.push("已点「开始拆分」");
                await sleep(9000);
                splitSteps.push("已拆分");
                continue; // 分章后要**重新点一次**主按钮，才能走到查重/确认
            }
            // ③ 查重失败（「本章存在重复内容…重复率…」）
            const modalNow = await visibleModalText(page);
            if (/重复内容|重复率/.test(modalNow)) {
                blockedText = modalNow.replace(/\s+/g, " ").slice(0, 240);
                break;
            }
            // ④ 确认链：publish 两层确认；draft 先点掉「重要提醒」。
            //    确认前先处理「内容声明」：默认选「本人原创」（use_ai=true 才选「含AI生成内容」）。
            if (mode === "publish") {
                confirmed = await acceptPublishConfirm(page, 4, () => publishDone, {
                    useAI: input.useAI === true,
                    onAi: (r) => (aiDeclaration = r),
                });
                if (confirmed.length === 0 && /重复内容|重复率/.test(await visibleModalText(page))) {
                    blockedText = (await visibleModalText(page)).replace(/\s+/g, " ").slice(0, 240);
                }
            }
            else {
                const agreed = await clickAgreementIfPresent(page, 8000);
                if (agreed)
                    confirmed.push(agreed);
                await sleep(2500);
                drafted = true;
            }
            break;
        }
        if (!clicked) {
            page.off?.("response", onResp);
            const shotPath = await shot(page, "short-publish-nobutton");
            await browser.close().catch(() => { });
            return {
                ok: false,
                action: "error",
                message: `已填入正文但未找到提交按钮。已填：${Object.keys(filled).join("/")}；缺：${missing.join("/") || "无"}。`,
                screenshotPath: shotPath,
                bookId: input.bookId,
                filled,
                missing,
            };
        }
        await waitForText(page, "成功", 5000).catch(() => false);
        const toast = await visibleToastText(page);
        const state = await readEditorState(page);
        const shotPath = await shot(page, `short-${action}`);
        page.off?.("response", onResp);
        await browser.close().catch(() => { });
        // 4) 回读短篇列表核对（字数 / 状态），作为第二判据
        let verified;
        let readback = "";
        try {
            const list = await listShortStories({});
            const hit = list.stories.find((s) => String(s.bookId) === String(input.bookId));
            if (hit) {
                const w = Number(hit.words ?? 0);
                readback = `回读列表：《${hit.title}》字数=${hit.words ?? "?"} 状态=${hit.status ?? "-"}`;
                // 真机口径：**只有显式提交**（存为草稿 / 立即发布）才会把字数写进列表；
                // 编辑器自动保存不会（13817817 自动保存后列表仍是 0）。所以 >0 是有意义的第二判据。
                verified = w > 0;
            }
            else {
                readback = "回读列表：未找到该短篇（列表可能延迟）";
            }
        }
        catch (e) {
            readback = `回读列表失败：${e.message}`;
        }
        const okSignal = mode === "publish"
            ? publishDone || verified === true
            : verified === true || /成功|已保存|保存成功/.test(toast);
        const finalNotes = [];
        if (notes.length)
            finalNotes.push(notes.join("；"));
        if (splitSteps.length)
            finalNotes.push(`智能分章：${splitSteps.join("→")}`);
        if (confirmed.length)
            finalNotes.push(`已点确认链：${confirmed.map((x) => `「${x}」`).join("→")}`);
        else if (mode === "publish" && !blockedText)
            finalNotes.push("⚠️ 未出现二次确认弹窗（可能按钮未生效）");
        if (aiDeclaration)
            finalNotes.push(`内容声明：${describeAiDeclaration(aiDeclaration)}`);
        if (blockedText)
            finalNotes.push(`⛔ 平台拦下：${blockedText}`);
        if (missing.length)
            finalNotes.push(`未命中/警告：${missing.join("/")}`);
        if (toast)
            finalNotes.push(`页面提示：${toast}`);
        if (readback)
            finalNotes.push(readback);
        if (apiTrace.length)
            finalNotes.push(`写接口：${apiTrace.slice(-2).join(" ｜ ")}`);
        else if (!okSignal)
            finalNotes.push("未捕获写接口响应，请到短故事管理页复核");
        // ⚠️ 口径说明：智能分章后编辑器会被重置，正文不再挂在编辑器里 →
        //    「正文字数 0」是**正常现象**，真实字数以回读列表 / 平台页头为准（2026-10 事故：被当成「正文没上去」）。
        const stateLabel = okSignal && mode === "publish"
            ? `编辑器现状（发布/分章后已重置，这里「正文字数=0」属正常，真实字数见回读列表）`
            : `编辑器现状`;
        return {
            ok: okSignal,
            action: okSignal ? action : "error",
            message: `已点「${clicked}」（book_id=${input.bookId}）。${finalNotes.length ? finalNotes.join("；") + "。" : ""} ` +
                stateLabel +
                `：${JSON.stringify(state)}。` +
                (mode === "publish" && okSignal ? NEXT_STEP_SHORT_PUBLISHED : ""),
            screenshotPath: shotPath,
            bookId: input.bookId,
            filled: { ...filled, ...(verified !== undefined ? { 回读校验: verified ? "通过" : "未通过" } : {}) },
            missing,
            warnings: warnings.length ? warnings : undefined,
        };
    }
    catch (e) {
        await browser.close().catch(() => { });
        return { ok: false, action: "error", message: `发布短篇异常：${e.message}`, warnings };
    }
}
/**
 * 生成「按书名定位到该行、并取该行『删除』按钮坐标」的 JS 表达式。
 *
 * 真机结构（2026-10）：列表每行是
 *   `<div class="book-detail-wrap">…<span class="s-right"><a><i/><span class="text">编辑正文</span></a>
 *    <a>…作品设置…</a><a>…删除…</a></span></div>`
 * ⚠️ 行内**没有任何 book_id**（`编辑正文` 的 href 是 `javascript:void(0)`，不是真链接），
 *    所以只能**按书名**定位；书名在同一行容器里（`.book-detail-wrap` 的祖先）。
 */
function jsRowDeletePoint(title) {
    return `(function(){
    const want = ${JSON.stringify(String(title))}.replace(/\\s+/g, "");
    const norm = (s) => (s || "").replace(/\\s+/g, "");
    for (const row of Array.from(document.querySelectorAll(".book-detail-wrap"))) {
      let scope = row;
      while (scope && !norm(scope.textContent).includes(want)) scope = scope.parentElement;
      if (!scope) continue;
      // ⚠️ 不能用 === 精确比：锚点文本里混着不可见字符（零宽 / 私有区图标），会匹配不上
      const del = Array.from(row.querySelectorAll("a")).find((a) => /删除/.test(a.textContent || ""));
      if (!del) continue;
      del.scrollIntoView({ block: "center" });
      const r = del.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }
    return null;
  })()`;
}
/**
 * 删除短篇 / 草稿（破坏性；默认预览）。
 *
 * ✅ 2026-10 真机：短故事管理页 → 该行右侧「删除」→ 二次确认弹窗 → 回读列表确认消失。
 * ⚠️ 行内没有 book_id，必须**先读列表拿书名**再按书名定位（否则会误删列表第一行）。
 */
export async function deleteShortStory(bookId, opts = {}) {
    assertWriteReady();
    let title = "";
    let before = 0;
    try {
        const list = await listShortStories({});
        const hit = list.stories.find((s) => String(s.bookId) === String(bookId));
        title = hit?.title ?? "";
        before = list.total ?? 0;
    }
    catch {
        /* 只读失败不影响删除，只是无法定位行 */
    }
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
                bookId,
                message: `将删除短篇 book_id=${bookId}${title ? `《${title}》` : ""}（confirm=false，未执行）。删除入口＝列表该行右侧「删除」→ 二次确认。confirm=true 才真正删除。`,
                screenshotPath: shotPath,
            };
        }
        if (!title) {
            await browser.close().catch(() => { });
            return {
                ok: false,
                action: "error",
                bookId,
                message: `列表里找不到 book_id=${bookId}（可能已被删除）。页面按书名定位行，拿不到标题就不动手，避免误删。`,
            };
        }
        // ⚠️ `waitForText("短故事")` 会被**左侧菜单**提前满足，等不到列表；直接等行容器出现
        for (let i = 0; i < 20; i++) {
            const n = await page.evaluate(() => document.querySelectorAll(".book-detail-wrap").length);
            if (n > 0)
                break;
            await sleep(1000);
        }
        const trace = [];
        const onDel = async (r) => {
            try {
                const u = String(r.url());
                if (!/\/api\//.test(u) || !/(del|remove)/i.test(u))
                    return;
                const b = await r.text();
                trace.push(`${u.replace(authorBase(), "").split("&t=")[0].split("?")[0]} => ${b.slice(0, 200)}`);
            }
            catch {
                /* 忽略 */
            }
        };
        page.on("response", onDel);
        let clickedRow = false;
        for (let i = 0; i < 4 && !clickedRow; i++) {
            clickedRow = await realClickByJs(page, jsRowDeletePoint(title));
            if (!clickedRow)
                await sleep(3000);
        }
        if (!clickedRow) {
            page.off?.("response", onDel);
            await browser.close().catch(() => { });
            return {
                ok: false,
                action: "error",
                bookId,
                message: `未能在列表里定位到《${title}》那一行的「删除」按钮（页面结构可能变了 / 列表没加载完）。`,
            };
        }
        await sleep(2200);
        const dlgText = await visibleModalText(page);
        // 真机：二次确认弹窗是「作品删除提示 … 取消 / **永久删除**」，且「永久删除」带 **2s 倒计时**
        //（倒计时内点击无效），所以轮询点到弹窗真的消失为止。
        let confirmed;
        for (let i = 0; i < 8; i++) {
            for (const t of ["永久删除", "确认删除", "确定"]) {
                if (await realClickText(page, t, { exact: true })) {
                    confirmed = t;
                    break;
                }
            }
            await sleep(1500);
            if (!/作品删除提示/.test(await visibleModalText(page)))
                break;
        }
        await sleep(3500);
        const toast = await visibleToastText(page);
        const shotPath = await shot(page, "short-delete-done");
        page.off?.("response", onDel);
        await browser.close().catch(() => { });
        let gone = false;
        let after = before;
        let readback = "";
        try {
            const l = await listShortStories({});
            after = l.total ?? 0;
            gone = !l.stories.some((s) => String(s.bookId) === String(bookId));
            readback = `回读列表：${before} → ${after} 篇`;
        }
        catch (e) {
            readback = `回读列表失败：${e.message}`;
        }
        const details = [];
        details.push(`已点《${title}》该行的「删除」${confirmed ? `→「${confirmed}」` : "（未找到二次确认按钮）"}`);
        if (dlgText)
            details.push(`确认弹窗：${dlgText.replace(/\s+/g, " ").slice(0, 160)}`);
        if (toast)
            details.push(`页面提示：${toast}`);
        if (readback)
            details.push(readback);
        if (trace.length)
            details.push(`接口：${trace[trace.length - 1]}`);
        if (!gone)
            details.push("⚠️ 该短篇仍在列表里，删除未生效");
        return {
            ok: gone,
            action: gone ? "deleted" : "error",
            bookId,
            message: `${details.join("；")}。`,
            screenshotPath: shotPath,
        };
    }
    catch (e) {
        await browser.close().catch(() => { });
        return { ok: false, action: "error", message: `删除短篇异常：${e.message}` };
    }
}
export { logger };
