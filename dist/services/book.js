import { logger } from "../core/logger.js";
import { sleep, shot } from "../browser/driver.js";
import { API, apiGet, openSession, isError, bookManageUrl, createBookUrl, bookInfoUrl, shortStoryInfoUrl, SHORT_CLIENT_ID, authorBase } from "../browser/endpoints.js";
import { fillByLabel, readForm } from "../browser/form.js";
import { realClickText, realClickByJs, realTypeByJs, clickVisibleOption, visibleSelectOptions, visibleModalText, } from "../browser/page.js";
import { assertCookies } from "./auth.js";
import { cleanBookTitle } from "../core/text.js";
/** 容错取值：在不同命名（后端字段名未公开）中取第一个命中的 */
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
/** 把后台作品条目归一化成稳定结构（字段名以 2026-10 真机联调结果为准） */
export function normalizeBook(b) {
    const isOver = pick(b, ["is_over"]);
    const signStatus = pick(b, ["sign_status"]);
    const rawStatus = pick(b, ["status_name", "statusName", "status", "book_status_name"]);
    return {
        bookId: String(pick(b, ["book_id", "bookId", "id", "bid"]) ?? ""),
        bookName: String(pick(b, ["title", "book_name", "bookName", "name"]) ?? ""),
        status: rawStatus ?? (isOver === "1" ? "已完结" : isOver === "0" ? "连载中" : undefined),
        category: pick(b, ["category_name", "categoryName", "category", "channel_name"]),
        words: pick(b, ["total_words", "word_count", "wordCount", "words", "word_num"]),
        chapterCount: pick(b, ["chapter_num", "chapterNum", "chapter_count", "chapterCount"]),
        // 真机确认存在的字段（便于排障核对，不要依赖 `raw` 之外的猜测字段名）
        clientId: pick(b, ["client_id"]),
        isGirl: pick(b, ["is_girl"]),
        isOver: isOver ? String(isOver) : undefined,
        signStatus: signStatus ? String(signStatus) : undefined,
        wordsToSign: pick(b, ["words_disparity", "sign_condition"]),
        coverUrl: pick(b, ["image_link"]),
        raw: b,
    };
}
/** 从各种可能的包装里取出书籍数组 */
function extractList(data) {
    if (Array.isArray(data))
        return data;
    for (const k of ["list", "book_list", "bookList", "data", "items", "records"]) {
        if (Array.isArray(data?.[k]))
            return data[k];
    }
    return [];
}
/**
 * 读作品列表（只读 HTTP）——长篇或短篇。
 *
 * 真机验证（2026-10）：接口是 `book-list-v2`，分页靠 `next_id` 游标（页面只发 `next_id` + `t`），
 * 响应为 `{data:{list:[],total:0,next_id:""}}`。
 */
export async function listBooks(opts = {}) {
    assertCookies();
    const kind = opts.kind ?? "long";
    const r = await apiGet(kind === "short" ? API.bookShortList : API.bookList, { next_id: opts.nextId ?? "" });
    if (!r.ok)
        return { ok: false, message: `读取作品列表失败：${r.error}`, books: [], error: r.error };
    const list = extractList(r.data);
    const total = pick(r.data, ["total", "count", "total_count"]) ?? list.length;
    const nextId = String(pick(r.data, ["next_id", "nextId"]) ?? "");
    return {
        ok: true,
        message: `共 ${total} 部${kind === "short" ? "短篇" : "长篇"}作品。`,
        total,
        nextId: nextId || undefined,
        books: list.map(normalizeBook),
    };
}
/** 依次尝试多个候选 label，命中即填 */
async function fillFirst(page, candidates, value) {
    for (const c of candidates) {
        const r = await fillByLabel(page, c, value);
        if (r.ok)
            return { label: c, ok: true };
    }
    return { ok: false };
}
/* --------------------- 建书：真机（2026-10）流程与选择器 --------------------- */
/**
 * 建书的**真实**流程（真机联调确认，全部为「像人一样」的真实键鼠操作）：
 *
 * 1. 打开作品管理列表页 `/front/book-manage`（建书**没有独立路由**）；
 * 2. 点「新建小说」→ 弹出「选择首发站点」（选项来自 `book/client-list`，
 *    顺序是 纵横(3) / 七猫(1)；`POST book/client-choose` 记录选择）；
 * 3. 点站点卡片 → 点弹窗「确认」→ 跳到 `/front/book-manage/information?client_id=<id>`；
 * 4. 填表 → 点「确认创建」→ `POST book/save-book-info` 返回 `data.book_id`。
 *
 * ⚠️ 前端 `submitBtnDisabled` 的**全部门禁**（真机读出的源码，缺一不可）：
 *    `书名 && 目标读者 && 一级分类 && 二级分类 && 作品简介 && 至少1个标签 && 至少1个主角名`
 *    （另有：若该站点显示「有奖征文」则必须选；书名/主角名不得命中前端校验）。
 *    所以本函数对「简介 / 主角 / 标签」都会兜底填默认值，否则按钮永远灰着。
 */
export function jsFormItemControl(label, selector, nth = 0) {
    return `(()=>{const it=Array.from(document.querySelectorAll(".el-form-item")).find(x=>((x.querySelector(".el-form-item__label")?.innerText||"").trim()).includes(${JSON.stringify(label)}));const list=Array.from(it?.querySelectorAll(${JSON.stringify(selector)})||[]);const el=list[${nth}];if(!el)return null;el.scrollIntoView({block:"center"});const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`;
}
export function jsFormItemRadio(label, index) {
    return `(()=>{const it=Array.from(document.querySelectorAll(".el-form-item")).find(x=>((x.querySelector(".el-form-item__label")?.innerText||"").trim()).includes(${JSON.stringify(label)}));const rs=Array.from(it?.querySelectorAll(".el-radio")||[]);const el=rs[${index}];if(!el)return null;el.scrollIntoView({block:"center"});const r=el.getBoundingClientRect();return{x:r.x+14,y:r.y+r.height/2};})()`;
}
/** 站点选择弹窗里的第 N 个站点卡片（按 `.client-name` 文本精确匹配） */
export function jsSiteCard(name) {
    return `(()=>{const vis=e=>e.getBoundingClientRect().width>0;const d=Array.from(document.querySelectorAll(".el-dialog")).filter(vis).pop();const boxes=Array.from(d?.querySelectorAll(".client-box")||[]);const b=boxes.find(x=>((x.querySelector(".client-name")?.innerText||"").trim())===${JSON.stringify(name)});if(!b)return null;b.scrollIntoView({block:"center"});const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+30};})()`;
}
/** 可见弹窗里的按钮（`a.qm-btn` 不是 `<button>`！真机踩过） */
export function jsDialogBtn(text) {
    return `(()=>{const vis=e=>e.getBoundingClientRect().width>0;const d=Array.from(document.querySelectorAll(".el-dialog")).filter(vis).pop();if(!d)return null;const b=Array.from(d.querySelectorAll("a.qm-btn,button")).find(x=>((x.innerText||"").trim())===${JSON.stringify(text)});if(!b)return null;b.scrollIntoView({block:"center"});const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`;
}
/** 标签弹窗里第 `groupIndex` 个分组内、文本为 `name`（不给则第一个）的标签 */
function jsTagInGroup(groupIndex, name) {
    return `(()=>{const vis=e=>e.getBoundingClientRect().width>0;const d=Array.from(document.querySelectorAll(".el-dialog")).filter(vis).pop();const box=Array.from(d?.querySelectorAll(".tags-box")||[]).filter(vis)[${groupIndex}];if(!box)return null;const items=Array.from(box.querySelectorAll(".tags-con")).filter(vis);const want=${name ? JSON.stringify(name) : "null"};const el=(want&&items.find(x=>((x.innerText||"").trim())===want))||items[0];if(!el)return null;el.scrollIntoView({block:"center"});const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`;
}
/** 作品名称 / 作品简介 / 主角名的定位表达式（建书页与作品信息页是同一套结构） */
const EXPR_TITLE = `(()=>{const el=document.querySelector(".qm-highlight-textarea");if(!el)return null;el.scrollIntoView({block:"center"});const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`;
const EXPR_DESC = `(()=>{const el=document.querySelector(".q-contenteditable");if(!el)return null;el.scrollIntoView({block:"center"});const r=el.getBoundingClientRect();return{x:r.x+40,y:r.y+18};})()`;
/** 下拉浮层里「第一个选项」的坐标表达式（仅在调用方明确允许兜底时使用） */
function jsFirstVisibleOption(listIndex) {
    const pick = listIndex === "first" ? "[0]" : ".pop()";
    return `(()=>{const vis=e=>e.getBoundingClientRect().width>0;const dd=Array.from(document.querySelectorAll(".el-select-dropdown")).filter(vis)${pick};const it=dd?.querySelector(".el-select-dropdown__item");if(!it)return null;it.scrollIntoView({block:"center"});const r=it.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`;
}
/**
 * 填写作品信息字段（建书页 / 作品信息页 / 短篇信息页共用；三页是同一套 DOM 结构）。
 *
 * 只填**显式传入**的字段；未传的保持原样（建书时由调用方补默认值）。
 * ⚠️ 必须真实键鼠（Vue 2 + 类 Element-UI 不认 JS 赋 value），且必须「先清空再输入」。
 *
 * ⚠️ 分类语义（2026-10 修）：**显式传入的分类名没匹配上时，默认不兜底取第一项**，
 * 而是记 `missing` + 返回 `categoryOk=false`，由调用方中止整个写操作。
 * 旧行为是「静默取第一项，顶层仍 `ok:true`」——出了一次「分类填错但报成功」的事故。
 */
export async function fillBookInfoFields(page, opts, filled, missing, labelSuffix = "", options = {}) {
    const strict = options.strictCategory !== false;
    let categoryOk = true;
    const availHint = (avail) => avail.length ? `；可选：${avail.slice(0, 12).join("/")}${avail.length > 12 ? "…" : ""}` : "";
    // 作品名称
    if (opts.bookName !== undefined && opts.bookName !== "") {
        if (await realTypeByJs(page, EXPR_TITLE, opts.bookName, 40))
            filled[`作品名称${labelSuffix}`] = opts.bookName;
        else
            missing.push("bookName(作品名称)");
        await sleep(400);
    }
    // 作品类型：一级 + 二级（下拉浮层是异步渲染的，点完要等）
    if (opts.category !== undefined || opts.categorySub !== undefined) {
        const pickedL1 = await realClickByJs(page, jsFormItemControl("作品类型", ".el-select", 0));
        if (!pickedL1) {
            missing.push("category(作品类型-一级)");
            categoryOk = false;
        }
        else {
            await sleep(1100);
            const l1 = (opts.category ?? "").trim();
            let l1Ok = true;
            if (l1 && (await clickVisibleOption(page, l1))) {
                // 命中，什么都不用做
            }
            else if (l1) {
                const avail = await visibleSelectOptions(page);
                await page.keyboard.press("Escape").catch(() => { });
                l1Ok = false;
                categoryOk = false;
                missing.push(`category(一级分类「${l1}」未匹配${strict ? "，已中止（未提交）" : "，已取第一项"}${availHint(avail)})`);
                if (!strict)
                    await realClickByJs(page, jsFirstVisibleOption("first"));
            }
            else {
                // 未指定一级分类 → 保留旧行为：取第一项（调用方会在 notes 里说明）
                await realClickByJs(page, jsFirstVisibleOption("first"));
            }
            await sleep(1500);
            const l1Text = await page.evaluate(() => {
                const it = Array.from(document.querySelectorAll(".el-form-item")).find((x) => (x.querySelector(".el-form-item__label")?.innerText || "").trim().includes("作品类型"));
                return it?.querySelectorAll("input.el-input__inner")?.[0]?.value ?? "";
            });
            if (l1Text)
                filled["作品类型-一级"] = String(l1Text);
            if (l1Ok && (await realClickByJs(page, jsFormItemControl("作品类型", ".el-select", 1)))) {
                await sleep(1100);
                const sub = (opts.categorySub ?? "").trim();
                if (sub && (await clickVisibleOption(page, sub))) {
                    // 命中
                }
                else if (sub) {
                    const avail = await visibleSelectOptions(page);
                    await page.keyboard.press("Escape").catch(() => { });
                    categoryOk = false;
                    missing.push(`categorySub(二级分类「${sub}」未匹配${strict ? "，已中止（未提交）" : "，已取第一项"}${availHint(avail)})`);
                    if (!strict)
                        await realClickByJs(page, jsFirstVisibleOption("last"));
                }
                else {
                    await realClickByJs(page, jsFirstVisibleOption("last"));
                }
                await sleep(1200);
                const l2Text = await page.evaluate(() => {
                    const it = Array.from(document.querySelectorAll(".el-form-item")).find((x) => (x.querySelector(".el-form-item__label")?.innerText || "").trim().includes("作品类型"));
                    return it?.querySelectorAll("input.el-input__inner")?.[1]?.value ?? "";
                });
                if (l2Text)
                    filled["作品类型-二级"] = String(l2Text);
            }
            else if (l1Ok) {
                missing.push("categorySub(作品类型-二级)");
                categoryOk = false;
            }
        }
    }
    // 作品简介（contenteditable）
    if (opts.abstract !== undefined && opts.abstract !== "") {
        if (await realTypeByJs(page, EXPR_DESC, opts.abstract, 20))
            filled[`作品简介${labelSuffix}`] = opts.abstract;
        else
            missing.push("abstract(作品简介)");
        await sleep(400);
    }
    // 主角名
    const heroes = [opts.protagonist1, opts.protagonist2].filter((x) => !!(x && x.trim()));
    for (let i = 0; i < heroes.length; i++) {
        const key = `主角名${i + 1}`;
        if (await realTypeByJs(page, jsFormItemControl("主角名", "textarea", i), heroes[i].trim(), 50))
            filled[key] = heroes[i].trim();
        else
            missing.push(`${key.toLowerCase()}(主角名${i + 1})`);
        await sleep(400);
    }
    // 作品标签：每个分组至少 1 个（不指定就各取第一个）
    if (opts.tags && opts.tags.length > 0) {
        if (await realClickByJs(page, jsFormItemControl("作品标签", "p.p-book-selected-tags", 0))) {
            await sleep(2200);
            const groups = (await page.evaluate(() => {
                const vis = (e) => e.getBoundingClientRect().width > 0;
                const d = Array.from(document.querySelectorAll(".el-dialog")).filter(vis).pop();
                return d ? Array.from(d.querySelectorAll(".tags-box")).filter(vis).length : 0;
            }));
            if (groups > 0) {
                let picked = 0;
                for (let gi = 0; gi < groups; gi++) {
                    const hit = opts.tags[gi];
                    if (await realClickByJs(page, jsTagInGroup(gi, hit))) {
                        picked++;
                        if (hit)
                            filled[`标签-组${gi + 1}`] = hit;
                    }
                    await sleep(500);
                }
                filled["标签数"] = `${picked}/${groups}`;
                if (!(await realClickByJs(page, jsDialogBtn("确定"))))
                    await realClickText(page, "确定", { exact: true });
                await sleep(1600);
            }
            else
                missing.push("tags(标签弹窗没打开)");
        }
        else
            missing.push("tags(作品标签入口)");
    }
    return { categoryOk };
}
/**
 * 读作品信息表单的 Vue 状态（前端内部结构，仅供排障 / 判门禁用，取不到就返回 null）。
 * 真机确认：**建书页 / 作品信息页 / 短篇信息页**是同一个组件（`form.el-form` 的 `$parent`），
 * 所以这一份能同时给长篇建书、改信息、短篇建篇判门禁。
 */
export async function readCreateFormState(page) {
    try {
        return await page.evaluate(() => {
            const vm = document.querySelector("form.el-form")?.__vue__?.$parent;
            if (!vm)
                return null;
            return {
                title: vm.titleHighlightData?.content ?? "",
                is_girl: vm.formData?.is_girl ?? "",
                category_1: vm.formData?.category_1 ?? "",
                category_2: vm.formData?.category_2 ?? "",
                book_desc: vm.formData?.book_desc ?? "",
                tags: (vm.bookSelectedTags ?? []).map((t) => t.tag_name ?? t.name ?? ""),
                characters: (vm.characters ?? []).map((c) => c.content).filter(Boolean),
                disabled: !!vm.submitBtnDisabled,
                titleError: vm.errorMessage?.title ?? "",
                charactersError: vm.errorMessage?.characters?.find?.((x) => !!x) ?? "",
            };
        });
    }
    catch {
        return null;
    }
}
/** client_id → 站点名（`book/client-list` 权威；顺序与弹窗展示顺序不一定一致，按名字匹配最稳） */
export async function resolveClientName(clientId) {
    const r = await apiGet(API.bookClientList, { activity_id: "" });
    if (!r.ok)
        return undefined;
    const list = (r.data?.list ?? []);
    const hit = list.find((c) => String(c.client_id) === String(clientId));
    return hit?.client_name ? String(hit.client_name) : undefined;
}
/**
 * 新建作品。
 *
 * 默认 `confirm=false`：只打开作品管理列表页读现状 + 截图，**不点「新建小说」不填不提交**。
 * `confirm=true`：走完整真实流程（选站点 → 填表 → 选标签 → 确认创建）。
 *
 * 不能省的必填（见上方注释）：书名 / 目标读者 / 一级分类 / 二级分类 / 简介 / 标签 / 主角名。
 * 未显式传入的会填默认值并在 `filled` 里标注 `(默认)`，避免「按钮一直灰着」的迷惑失败。
 */
export async function createBook(input) {
    assertCookies();
    const session = await openSession(input.headless ?? true, "/front/book-manage");
    if (isError(session))
        return { ok: false, action: "error", message: session.error };
    const { browser, page } = session;
    try {
        const filled = {};
        const missing = [];
        const notes = [];
        if (!input.confirm) {
            const shotPath = await shot(page, "book-create-preview");
            await browser.close().catch(() => { });
            return {
                ok: true,
                action: "preview",
                message: `已打开作品管理列表页（confirm=false，未点「新建小说」、未填表未提交）。` +
                    `⚠️ 建书没有独立路由：入口是列表页的「新建小说」按钮 → 选首发站点弹窗 → 作品信息表单。` +
                    `核对无误后传 confirm=true。`,
                screenshotPath: shotPath,
                filled: await readForm(page),
            };
        }
        // --- 0. 书名先按平台白名单清洗（全角括号等会被拒，导致提交按钮永远灰着） ---
        const { title: safeName, changed: nameChanged } = cleanBookTitle(input.bookName);
        if (!safeName) {
            await browser.close().catch(() => { });
            return { ok: false, action: "error", message: `书名清洗后为空（原值「${input.bookName}」）。七猫书名仅支持中英文、数字（含罗马数字Ⅰ~Ⅻ）与，「：！？」等中文标点。` };
        }
        if (nameChanged)
            notes.push(`书名已清洗：《${input.bookName}》→《${safeName}》（平台仅允许中英文/数字/罗马数字/中文标点）`);
        const clientId = String(input.clientId ?? "1");
        const clientName = await resolveClientName(clientId);
        if (!clientName) {
            await browser.close().catch(() => { });
            return { ok: false, action: "error", message: `无法解析首发站点 client_id=${clientId}（读取 book/client-list 失败或该站点不存在）。` };
        }
        // --- 1. 列表页 → 新建小说 ---
        if (!(await realClickText(page, "新建小说", { exact: true }))) {
            const shotPath = await shot(page, "book-create-no-new-btn");
            await browser.close().catch(() => { });
            return { ok: false, action: "error", message: `未找到「新建小说」按钮（可能账号无建书权限或页面未加载完）。`, screenshotPath: shotPath };
        }
        await sleep(2200);
        // --- 2. 选首发站点 → 确认 ---
        if (!(await realClickByJs(page, jsSiteCard(clientName)))) {
            const shotPath = await shot(page, "book-create-no-site");
            await browser.close().catch(() => { });
            return { ok: false, action: "error", message: `站点弹窗里未找到「${clientName}」卡片。`, screenshotPath: shotPath };
        }
        await sleep(900);
        if (!(await realClickByJs(page, jsDialogBtn("确认")))) {
            // 站点弹窗的确认按钮可能不带 a.qm-btn，退回按文本点
            await realClickText(page, "确认", { exact: true });
        }
        await sleep(3800);
        filled["首发站点"] = clientName;
        if (!page.url().includes("/information"))
            notes.push(`提示：确认站点后 URL 未出现 /information（当前 ${page.url()}），后续步骤可能失败。`);
        // --- 3. 目标读者（radio：0=男生 / 1=女生；工具的 gender 是 1=男频 → 站点 is_girl="0"） ---
        const gender = input.gender ?? 1;
        const readerIndex = gender === 1 ? 0 : 1;
        if (await realClickByJs(page, jsFormItemRadio("目标读者", readerIndex))) {
            filled["目标读者"] = gender === 1 ? "男生" : "女生";
        }
        else
            missing.push("gender(目标读者)");
        await sleep(1600); // 选完目标读者才会加载一级分类
        // --- 4. 名称 / 分类 / 简介 / 主角 / 标签（与改作品信息共用同一套填充逻辑） ---
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
        }, filled, missing);
        // ⚠️ 显式传入的分类没匹配上 → 直接中止，绝不静默兜底（避免「报成功但分类是错的」）
        if (!fillRes.categoryOk) {
            const shotPath = await shot(page, "book-create-category-mismatch");
            await browser.close().catch(() => { });
            return {
                ok: false,
                action: "error",
                message: `分类未匹配，已中止建书（**未提交**）：${missing.join("；")}。` +
                    `请先用 list_book_options_qimao(client_id=…) 查可选分类名后重试。`,
                screenshotPath: shotPath,
                filled,
                missing,
            };
        }
        // --- 9. 提交前读门禁（拿不到 Vue 状态就跳过，不影响主流程） ---
        const state = await readCreateFormState(page);
        if (state?.disabled) {
            const shotPath = await shot(page, "book-create-blocked");
            await browser.close().catch(() => { });
            return {
                ok: false,
                action: "error",
                message: `建书前置条件未满足，未提交。前端提示：${state.titleError || state.charactersError || "（无文案，可能是必填项未选中）"}。` +
                    `必填＝书名/目标读者/一级分类/二级分类/简介/至少1个标签/至少1个主角名。状态：${JSON.stringify(state)}`,
                screenshotPath: shotPath,
                filled,
                missing,
            };
        }
        // --- 10. 确认创建：以 `book/save-book-info` 的响应为准判成功 ---
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
            page.off("response", onResponse);
            const shotPath = await shot(page, "book-create-nobutton");
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
        const shotPath = await shot(page, "book-create-done");
        await browser.close().catch(() => { });
        if (!createdBookId) {
            return {
                ok: false,
                action: "error",
                message: `已点「确认创建」但没抓到创建成功响应（book/save-book-info）。${modal ? `页面提示：${modal.slice(0, 200)}` : ""}建议核对列表。`,
                screenshotPath: shotPath,
                filled,
                missing,
            };
        }
        return {
            ok: true,
            action: "created",
            bookId: createdBookId,
            message: `已建书：《${safeName}》（book_id=${createdBookId}，站点：${clientName}）。` +
                `${missing.length ? `未命中字段：${missing.join("/")}。` : ""}${notes.length ? notes.join(" ") : ""}`,
            screenshotPath: shotPath,
            filled,
            missing,
        };
    }
    catch (e) {
        await browser.close().catch(() => { });
        return { ok: false, action: "error", message: `建书异常：${e.message}` };
    }
}
/* ------------------------------ 改作品信息 ------------------------------ */
/** 该 `book_id` 是不是短篇（短篇渠道 `client_id` 页面写死为 5，且不在 `book/client-list` 里） */
async function isShortBook(bookId) {
    const r = await apiGet(API.bookDetail, { book_id: bookId });
    if (!r.ok)
        return false;
    const d = r.data ?? {};
    const cid = String(d?.book_info?.client_id ?? d?.book_info?.clientId ?? "");
    return cid === SHORT_CLIENT_ID;
}
/** 页面上可见的按钮文本（排障用：保存按钮候选全落空时，把现场按钮如实回给调用方） */
async function visibleButtonTexts(page) {
    return (await page
        .evaluate(() => {
        const vis = (e) => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        };
        return Array.from(document.querySelectorAll("a.qm-btn,button,.el-button"))
            .filter(vis)
            .map((e) => (e.innerText ?? e.textContent ?? "").trim())
            .filter(Boolean)
            .slice(0, 20);
    })
        .catch(() => []));
}
/**
 * 点「保存」类按钮：先按候选文本精确点，再兜底扫「含 保存/修改/提交/确认 的可见按钮」。
 *
 * ⚠️ 真机踩坑（2026-10）：短篇信息页的保存按钮在页面底部，且文案与长篇不同
 * （长篇的候选是 保存/提交/立即修改/确认）→ 之前直接按文本点，报「已填表但未找到保存按钮」。
 * 这里统一走 `realClickText` / `realClickByJs`（都会先 `scrollIntoView`），并把命中的文案回传。
 */
async function clickInfoSaveButton(page, candidates) {
    for (const t of candidates) {
        if (await realClickText(page, t, { exact: true }))
            return t;
    }
    const pt = (await page
        .evaluate(() => {
        const vis = (e) => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        };
        const inDialog = (e) => !!e.closest?.(".el-dialog,.el-message-box,.g-pop,.qm-dialog");
        const all = Array.from(document.querySelectorAll("a.qm-btn,button,.el-button"))
            .filter(vis)
            .filter((e) => !inDialog(e));
        const hit = all.find((e) => /(确认修改|保存修改|立即修改)/.test(e.innerText ?? e.textContent ?? "")) ??
            all.find((e) => /(保存|提交)/.test(e.innerText ?? e.textContent ?? "")) ??
            all.find((e) => /确认/.test(e.innerText ?? e.textContent ?? ""));
        if (!hit)
            return null;
        hit.scrollIntoView({ block: "center" });
        const r = hit.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, txt: (hit.innerText ?? hit.textContent ?? "").trim() };
    })
        .catch(() => null));
    if (!pt)
        return undefined;
    await page.mouse.click(pt.x, pt.y);
    return pt.txt;
}
/**
 * 修改已有作品信息（书名 / 简介 / 主角 / 分类 / 标签）。
 *
 * 走作品信息页 `/front/book-manage/information?id=…`（真机确认参数名是 `id`）；
 * 该页与建书页是同一套 DOM，故填充逻辑与 `createBook` 共用 `fillBookInfoFields`
 * ——只覆盖显式传入的字段，未传的保持原值。
 *
 * 默认 `confirm=false`：只打开页面读现状 + 截图，**完全不填充**（避免误改线上）。
 *
 * ⚠️ 保存成功后平台可能要求**重新审核**；书名 / 简介改动会影响曝光，请谨慎。
 * ⚠️ 「保存」按钮的真实文案（`确认创建` / `保存` / `立即修改`）尚未真机联调，见下方候选。
 */
export async function updateBookInfo(input) {
    assertCookies();
    const short = await isShortBook(input.bookId);
    const path = short ? shortStoryInfoUrl(input.bookId) : bookInfoUrl(input.bookId);
    const pageName = short ? "短篇信息页" : "作品信息页";
    const session = await openSession(input.headless ?? true, path);
    if (isError(session))
        return { ok: false, action: "error", message: session.error };
    const { browser, page } = session;
    try {
        const current = await readForm(page);
        if (!input.confirm) {
            const shotPath = await shot(page, "book-info-preview");
            await browser.close().catch(() => { });
            return {
                ok: true,
                action: "preview",
                message: `已打开${pageName}（${short ? "预判为短篇，走 /front/book-manage/short/information" : "长篇"}，confirm=false，未做任何修改）。现状：${JSON.stringify(current).slice(0, 400)}`,
                screenshotPath: shotPath,
                filled: current,
            };
        }
        const filled = {};
        const missing = [];
        const { title: safeName } = input.bookName ? cleanBookTitle(input.bookName) : { title: "" };
        if (input.bookName && safeName !== input.bookName.trim()) {
            missing.push(`bookName(已按平台字符白名单清洗为「${safeName}」)`);
        }
        const fillRes = await fillBookInfoFields(page, {
            bookName: input.bookName ? safeName : undefined,
            abstract: input.abstract,
            protagonist1: input.protagonist1,
            protagonist2: input.protagonist2,
            category: input.category,
            categorySub: input.categorySub,
            tags: input.tags,
        }, filled, missing);
        // ⚠️ 显式传入的分类没匹配上 → 中止（不提交），别把错配的分类写上线
        if (!fillRes.categoryOk) {
            const shotPath = await shot(page, "book-info-category-mismatch");
            await browser.close().catch(() => { });
            return {
                ok: false,
                action: "error",
                message: `分类未匹配，已中止保存（**线上未改动**）：${missing.join("；")}。` +
                    `请先用 list_book_options_qimao(client_id=…或 5) 查可选分类名后重试。`,
                screenshotPath: shotPath,
                filled,
                missing,
            };
        }
        const clicked = await clickInfoSaveButton(page, ["保存", "确认修改", "保存修改", "立即修改", "提交", "确认"]);
        const modal = await visibleModalText(page);
        const shotPath = await shot(page, "book-info-done");
        if (!clicked) {
            const buttons = await visibleButtonTexts(page);
            await browser.close().catch(() => { });
            return {
                ok: false,
                action: "error",
                message: `已填表但未找到保存按钮（${pageName}）。缺：${missing.join("/") || "无"}。` +
                    `页面可见按钮：${buttons.join(" / ") || "（未读到）"}。请把这份按钮清单反馈给开发者补候选文案。`,
                screenshotPath: shotPath,
                filled,
                missing,
            };
        }
        await browser.close().catch(() => { });
        return {
            ok: true,
            action: "updated",
            message: `已提交${pageName}修改（bookId=${input.bookId}，点了「${clicked}」）。已填：${Object.keys(filled).join("/") || "无"}。` +
                `${missing.length ? `注意：${missing.join("/")}。` : ""}${modal ? `页面提示：${modal.slice(0, 200)}` : ""}`,
            screenshotPath: shotPath,
            filled,
            missing,
        };
    }
    catch (e) {
        await browser.close().catch(() => { });
        return { ok: false, action: "error", message: `改作品信息异常：${e.message}` };
    }
}
/**
 * 只改「分类 / 标签」的快捷入口（内部就是 updateBookInfo 的薄包装）。
 * 语义是「确保这些分类 / 标签处于选中」。标签按分组顺序取用（见 `createBook` 的说明）。
 */
export async function setBookTags(input) {
    return updateBookInfo({
        bookId: input.bookId,
        category: input.category,
        categorySub: input.categorySub,
        tags: input.tags,
        confirm: input.confirm,
        headless: input.headless,
    });
}
/**
 * 读分类 / 标签可选项。
 *
 * 走 `book/book-option?client_id=…`（2026-10 真机验证）。结构：
 * `data.category_list[is_girl]` = `{category:[{id, category_name, children:[{id, category_name}]}], tag_info:[{type_id, type_name, select_list:[{id, tag_id, tag_name}]}]}`，
 * 其中 **`category_list` 的下标与「目标读者」一致：0=男频，1=女频**（前端 `firstCategory` computed 即如此取）。
 * ⚠️ 必须带 `client_id`（不同站点分类不同）；不带参会拿到不完整数据。
 *
 * ⚠️ 2026-10 事故：默认把 405 个标签全塞进返回 → 132k 字符，MCP 客户端直接截断，
 * 调用方「看不到返回值只能猜分类名」。现在默认 `only=category`（几十条分类），
 * 标签只在 `only=tag`/`all` 时挂在顶层 `tagGroups[].tags`（且男/女频只回一份，不再重复一倍）。
 */
export async function listBookOptions(opts = {}) {
    assertCookies();
    const clientId = String(opts.clientId ?? "1");
    const only = opts.only ?? "category";
    const r = await apiGet(API.bookOption, { client_id: clientId });
    if (!r.ok)
        return { ok: false, message: `读取分类/标签选项失败：${r.error}` };
    const d = r.data ?? {};
    const toTag = (x) => ({
        id: String(x?.id ?? ""),
        tagId: String(x?.tag_id ?? x?.id ?? ""),
        name: String(x?.tag_name ?? x?.name ?? ""),
    });
    const allGenders = (Array.isArray(d.category_list) ? d.category_list : []).map((c, index) => ({
        index,
        isGirl: String(index),
        categories: (Array.isArray(c?.category) ? c.category : [])
            .map((cat) => ({
            id: String(cat?.id ?? ""),
            name: String(cat?.category_name ?? cat?.name ?? ""),
            children: (Array.isArray(cat?.children) ? cat.children : []).map((k) => ({
                id: String(k?.id ?? ""),
                name: String(k?.category_name ?? k?.name ?? ""),
            })),
        }))
            .filter((cat) => cat.name),
        groups: (Array.isArray(c?.tag_info) ? c.tag_info : []).map((t) => ({
            typeId: Number(t?.type_id ?? 0),
            typeName: t?.type_name ? String(t.type_name) : undefined,
            tags: (Array.isArray(t?.select_list) ? t.select_list : []).map(toTag).filter((x) => x.name),
        })),
    }));
    const genders = typeof opts.gender === "number" ? allGenders.filter((g) => g.index === opts.gender) : allGenders;
    const wantCats = only === "category" || only === "all";
    const wantTags = only === "tag" || only === "all";
    // 标签与频道无关：男/女频的 tag_info 是同一份（405 个），按 gender 平铺会重复一倍。
    // 这里按 `type_id` 合并、用 tagId 去重，只在顶层 `tagGroups` 出现一次（顺序＝平台分组顺序）。
    const groupOrder = [];
    const groupMap = new Map();
    for (const g of genders) {
        for (const grp of g.groups) {
            let entry = groupMap.get(grp.typeId);
            if (!entry) {
                entry = { typeName: grp.typeName, seen: new Set(), tags: [] };
                groupMap.set(grp.typeId, entry);
                groupOrder.push(grp.typeId);
            }
            else if (!entry.typeName && grp.typeName) {
                entry.typeName = grp.typeName;
            }
            for (const t of grp.tags) {
                const key = t.tagId || t.name;
                if (entry.seen.has(key))
                    continue;
                entry.seen.add(key);
                entry.tags.push(t);
            }
        }
    }
    const tagGroups = groupOrder.map((typeId) => {
        const e = groupMap.get(typeId);
        return { typeId, typeName: e.typeName, count: e.tags.length, ...(wantTags ? { tags: e.tags } : {}) };
    });
    const outGenders = genders.map((g) => ({
        index: g.index,
        isGirl: g.isGirl,
        categories: wantCats ? g.categories : [],
    }));
    const categoryPaths = opts.flat
        ? genders.flatMap((g) => g.categories.flatMap((c) => [
            `[${g.isGirl}频] ${c.name}`,
            ...c.children.map((k) => `[${g.isGirl}频] ${c.name}/${k.name}`),
        ]))
        : undefined;
    const catCount = genders.reduce((n, g) => n + g.categories.reduce((m, c) => m + 1 + c.children.length, 0), 0);
    const tagCount = tagGroups.reduce((n, g) => n + g.count, 0);
    const scope = opts.gender === undefined ? "" : `（只看 ${opts.gender === 1 ? "女频" : "男频"}）`;
    const tail = only === "category"
        ? `本次只回分类（分类树足够选值；默认不再带 ${tagCount} 个标签，避免超过输出上限）。需要标签时传 only=tag。`
        : only === "tag"
            ? `本次只回标签（共 ${tagCount} 个去重，见 tagGroups[].tags）。需要分类树时传 only=category。`
            : `本次 only=all：分类与标签都回了，注意上下文占用。`;
    return {
        ok: true,
        message: `已读取分类/标签选项（client_id=${clientId}）${scope}：${genders.length} 组（0=男频/1=女频）、` +
            `${catCount} 个分类（含二级）、标签共 ${tagCount} 个（分 ${tagGroups.length} 组）。${tail}`,
        clientId,
        only,
        genders: outGenders,
        tagGroups,
        categoryPaths,
        activities: d.book_activity_list ?? null,
        extra: {
            book_config: d.book_config,
            upload_image_config: d.upload_image_config,
            is_edit_cover: d.is_edit_cover,
            is_girl_list: d.is_girl_list,
        },
    };
}
/** 后台地址（供工具返回里提示用户去哪里核对） */
export function manageUrlHints() {
    return {
        bookManage: bookManageUrl(),
        createBook: createBookUrl(),
        bookData: `${authorBase()}/front/book-data`,
        income: `${authorBase()}/front/income-manage`,
    };
}
export { logger };
