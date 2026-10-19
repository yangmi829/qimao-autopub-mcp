import { createHash } from "node:crypto";
import { logger } from "../core/logger.js";
/* ============================================================================
 * 一、地址与路由
 * 七猫作者后台是 Vue SPA，接口同源（zuozhe.qimao.com），登录态走 cookies。
 * 路由来自前端 bundle 的 vue-router 定义，接口来自 bundle 的 API 常量模块。
 * ========================================================================== */
/** 作者后台站点根 */
export function authorBase() {
    return process.env.QIMAO_AUTHOR_BASE || "https://zuozhe.qimao.com";
}
/** 登录页（前端路由 /front/register-login/login） */
export function authorLoginUrl() {
    return process.env.QIMAO_AUTHOR_URL || `${authorBase()}/front/register-login/login`;
}
/** 作品管理（长篇） */
export function bookManageUrl() {
    return process.env.QIMAO_BOOK_MANAGE_URL || `${authorBase()}/front/book-manage`;
}
/** 新建长篇作品 */
export function createBookUrl() {
    return `${authorBase()}/front/book-upload`;
}
/** 短篇作品管理 */
export function shortManageUrl() {
    return `${authorBase()}/front/book-manage/short`;
}
/** 新建短篇作品 */
export function shortCreateUrl() {
    return `${authorBase()}/front/book-upload/short`;
}
/** 作品数据（统计） */
export function bookDataUrl() {
    return `${authorBase()}/front/book-data`;
}
/** 收益管理 */
export function incomeManageUrl() {
    return `${authorBase()}/front/income-manage`;
}
/**
 * 章节管理页（章节列表 + 章节编辑器）：`/front/book-manage/manage?book_id=…`
 *
 * 真实路由与参数名取自前端路由表（`path:"manage", name:"book-manage_chapter-manage"`）
 * 与接口 `book-chapter/chapter-tabs-options` 返回的 `tab_url`（2026-10 真机验证）。
 * ⚠️ 早先写成 `/front/book-manage/{bookId}` 是**错的**（那个路径在前端路由表里不存在）。
 * 查询参数用 snake_case `book_id`（与站内其它查询参数一致，如 `chat-prompt-text?params={"book_id":0}`）。
 */
export function chapterEditUrl(bookId, chapterId) {
    const base = `${authorBase()}/front/book-manage/manage?book_id=${encodeURIComponent(String(bookId))}`;
    return chapterId === undefined || chapterId === ""
        ? base
        : `${base}&chapter_id=${encodeURIComponent(String(chapterId))}`;
}
/** 作品信息页（改书名 / 简介 / 主角 / 分类标签）：`/front/book-manage/information/?book_id=…` */
export function bookInfoUrl(bookId) {
    return `${authorBase()}/front/book-manage/information/?book_id=${encodeURIComponent(String(bookId))}`;
}
/** 短篇信息页（短篇的分类 / 简介等）：`/front/book-manage/short/information?book_id=…` */
export function shortStoryInfoUrl(bookId) {
    return `${authorBase()}/front/book-manage/short/information?book_id=${encodeURIComponent(String(bookId))}`;
}
/** 章节草稿箱：`/front/book-manage/draft?book_id=…` */
export function chapterDraftUrl(bookId) {
    return `${authorBase()}/front/book-manage/draft?book_id=${encodeURIComponent(String(bookId))}`;
}
/** 章节目录（真实站内路由，供返回里提示用户去哪里核对） */
export function chapterRoutes() {
    return {
        manage: `${authorBase()}/front/book-manage/manage`,
        draft: `${authorBase()}/front/book-manage/draft`,
        bookThought: `${authorBase()}/front/book-manage/book-thought`,
    };
}
/** 章节列表接口路径（供 UI 驱动时定位/回读） */
export function chapterListPath() {
    return API.chapterList;
}
/* ============================================================================
 * 二、接口表（路径来自前端 bundle 的 API 常量；o=/api/pc/v1, n=/api/pc/v2, i=/api/pc/v3）
 * ========================================================================== */
const P1 = "/api/pc/v1";
const P2 = "/api/pc/v2";
export const API = {
    /* --- 作者 / 全局（以下路径均经 2026-10 真机验证） --- */
    authorIndex: `${P1}/author/index`,
    /**
     * 作者资料。⚠️ **不带 `/pc/v1` 前缀**（前端请求的就是 `/api/author/profile`）——
     * 写成 `/api/pc/v1/author/profile` 会 404。笔名在 `data.user.pen_name`。
     */
    authorProfile: "/api/author/profile",
    authorRightsList: `${P1}/author/rights-list`,
    /** 全局配置：短篇开关 + 各站点字数上下限（`data.client_config[id].word_count[]`，含 min/max） */
    globalConfig: `${P1}/global/config`,
    requestInfo: `${P1}/global/req-info`,
    /* --- 作品（长篇 / 短篇同一套接口，靠 type 区分） --- */
    /**
     * 作品列表。⚠️ 分页是**游标**（`next_id`），不是 page/page_size——
     * 真机抓包：页面发的是 `book-list-v2?next_id=&t=…`；响应为 `{data:{list:[],total:0,next_id:""}}`。
     */
    bookList: `${P1}/book/book-list-v2`,
    bookShortList: `${P1}/book/book-shortstory-list-v2`,
    bookScreenplayList: `${P1}/book/book-screenplay-list`,
    bookDetail: `${P1}/book/edit-index`,
    /**
     * 分类 / 标签可选项（建书 / 改信息用这个）：
     * `data.category_list[i].tag_info[j].select_list[]` = `{id, tag_id, tag_name}`，i=0/1 对应男频/女频。
     * ⚠️ 不要用 `/book/tag-list-option`（真机实测无参会 40001002 参数错误）。
     */
    bookOption: `${P1}/book/book-option`,
    bookCreate: `${P1}/book/create-book-over`,
    bookSave: `${P1}/book/save-book-info`,
    bookCheckNum: `${P1}/book/check-book-num`,
    bookCheckTitle: `${P1}/book/check-book-title`,
    bookSortList: `${P1}/book/sort-list`,
    bookDel: `${P1}/book/del-book`,
    /** 站点 / 渠道列表（建书时选「站点」，`client_id` 1…6 对应七猫/奇妙/纵横…） */
    bookClientList: `${P1}/book/client-list`,
    /* --- 章节 / 卷 --- */
    chapterList: `${P1}/book-chapter/list`,
    chapterIndex: `${P1}/book-chapter/chapter-index`,
    chapterSave: `${P1}/book-chapter/save-chapter`,
    chapterSaveV2: `${P2}/book-chapter/save-chapter`,
    chapterAutoSave: `${P1}/book-chapter/auto-save-chapter`,
    chapterCheckPublish: `${P1}/book-chapter/check-chapter-publish`,
    chapterDraftPublish: `${P1}/book-chapter/draft-publish`,
    chapterDraftPublishConfirm: `${P1}/book-chapter/draft-publish-confirm`,
    chapterDel: `${P1}/book-chapter/del-chapter`,
    chapterPreview: `${P1}/book-chapter/preview-chapter`,
    chapterUpload: `${P1}/book-chapter/upload-chapter`,
    chapterRegularTimeData: `${P1}/book-chapter/regular-time-data`,
    chapterTabsOptions: `${P1}/book-chapter/chapter-tabs-options`,
    chapterSortTargetOptions: `${P1}/book-chapter/sort-target-options`,
    chapterHistory: `${P1}/book-chapter/history`,
    chapterSpecialList: `${P1}/book-chapter/special-chapter-list`,
    volumeList: `${P1}/book-chapter/volume-list`,
    volumeSave: `${P1}/book-chapter/save-volume`,
    volumeDel: `${P1}/book-chapter/del-volume`,
    /* --- 数据统计（只读） --- */
    statBookDetail: `${P1}/book-statistics/book-detail`,
    statBookTrend: `${P1}/book-statistics/book-trend`,
    statChapterRetention: `${P1}/book-statistics/chapter-retention`,
    statAvgRetention: `${P1}/book-statistics/avg-retention`,
    statPayData: `${P1}/book-statistics/pay-data`,
    statTotalPayData: `${P1}/book-statistics/total-pay-data`,
    statWordsRetention: `${P1}/book-statistics/words-retention`,
    statFlowComposition: `${P1}/book-statistics/flow-composition-data`,
    /* --- 收益（只读） --- */
    profitMonthBalance: "/api/profit/month-balance",
    profitBookDateProfit: "/api/profit/book-date-profit",
    profitBookDateProfitDetail: "/api/profit/book-date-profit-detail",
    profitSubDetail: "/api/profit/sub-detail",
    profitWelfareDetail: "/api/profit/welfare-detail",
};
/* ============================================================================
 * 三、签名
 *
 * 七猫与番茄最大的不同：签名是**纯 MD5、算法可复现**，所以只读接口不需要浏览器。
 * 从前端 bundle 逆向得到：
 *   secret = "e4dgHJb831kSWNw4"
 *   GET : 参数去空后追加时间戳 t，按 key 排序拼成 `k=v`（**去掉分隔符 &**），
 *         整串 + secret 取 md5，作为 query 里的 sign
 *   POST(JSON): 请求头 b-sign = md5(JSON.stringify(body) + secret)，body 里同样带 t
 *   POST(表单): body 里追加 sign = md5(排序拼接串 + secret)
 *   另有固定请求头 sign = md5("AUTHORIZATION=" + secret)
 *
 * ⚠️ 该算法已按前端源码 1:1 复刻，但由于签名校验发生在登录校验之后
 *    （未登录时无论签名对错都返回「登录已失效」），**必须用真实登录态联调确认**。
 *    若联调发现 sign 不通过，把 QIMAO_SIGN_STYLE 从 concat 改成 amp（或反之）即可。
 * ========================================================================== */
const SIGN_SECRET = process.env.QIMAO_SIGN_SECRET || "e4dgHJb831kSWNw4";
const PC_VERSION = process.env.QIMAO_PC_VERSION || "1.0.0";
/** 前端 `set_url_sign` 把排序后的 `k=v&k=v` 里的 `&` 全部去掉，默认复刻该行为 */
function signJoinStyle() {
    return (process.env.QIMAO_SIGN_STYLE ?? "").trim().toLowerCase() === "amp" ? "amp" : "concat";
}
export function md5Hex(s) {
    return createHash("md5").update(s, "utf-8").digest("hex");
}
/** 固定请求头签名 */
export function headerSign() {
    return md5Hex("AUTHORIZATION=" + SIGN_SECRET);
}
/** 去掉空值（前端 interceptor 会删掉 null / undefined / "null" 的字段） */
function dropEmpty(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v === undefined || v === null)
            continue;
        if (typeof v === "string" && (v === "" || v === "null" || v === "undefined"))
            continue;
        out[k] = v;
    }
    return out;
}
/** 按 key 排序，拼成 `k=v` 串（再按 style 决定是否保留 &），供签名用 */
export function signString(params) {
    const keys = Object.keys(params).sort();
    const pairs = keys.map((k) => `${k}=${params[k]}`);
    return pairs.join(signJoinStyle() === "amp" ? "&" : "");
}
/** GET: query 签名 */
export function signGet(params) {
    return md5Hex(signString(params) + SIGN_SECRET);
}
/** POST(JSON): body 签名 */
export function signPostJson(data) {
    return md5Hex(JSON.stringify(data) + SIGN_SECRET);
}
/** POST(表单): body 内 sign 字段 */
export function signPostForm(data) {
    return md5Hex(signString(data) + SIGN_SECRET);
}
/** 登录已失效的业务码（需要重新登录） */
export const CODE_NOT_LOGGED_IN = "40002013";
function qsEncode(params) {
    return Object.keys(params)
        .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]))}`)
        .join("&");
}
function interpret(raw, status, url) {
    const err = raw?.errors;
    if (err) {
        return {
            ok: false,
            status,
            url,
            raw,
            code: err.code,
            error: String(err.title || err.details || err.message || "接口返回错误"),
        };
    }
    // 七猫成功响应一般是 {data:...}；少数接口直接给顶层字段
    const data = raw && typeof raw === "object" && "data" in raw ? raw.data : raw;
    return { ok: true, status, url, raw, data };
}
function baseHeaders() {
    return {
        accept: "application/json, text/plain, */*",
        "pc-version": PC_VERSION,
        sign: headerSign(),
        origin: authorBase(),
        referer: `${authorBase()}/front/index`,
        "user-agent": process.env.QIMAO_USER_AGENT ||
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    };
}
async function readCookieHeader() {
    const { cookieHeader } = await import("./cookies.js");
    try {
        return cookieHeader();
    }
    catch (e) {
        throw new Error(e.message);
    }
}
/**
 * 只读 GET（带 sign，自带 cookies）。
 * 这是「读走 HTTP」的主入口：列表 / 详情 / 统计 / 收益都走它，不需要起浏览器。
 */
export async function apiGet(pathname, params = {}) {
    const withT = { ...dropEmpty(params), t: Date.now() };
    const sign = signGet(withT);
    const url = `${authorBase()}${pathname}?${qsEncode(withT)}&sign=${sign}`;
    return request(url, { method: "GET" }, pathname);
}
/**
 * 只读 POST(JSON)（带 b-sign）。
 * 用于参数较多、GET 传不下的查询类接口。
 */
export async function apiPostJson(pathname, data = {}) {
    const withT = { ...dropEmpty(data), t: Date.now() };
    return request(`${authorBase()}${pathname}`, {
        method: "POST",
        headers: { "content-type": "application/json", "b-sign": signPostJson(withT) },
        body: JSON.stringify(withT),
    }, pathname);
}
async function request(url, init, pathname) {
    let cookie = "";
    try {
        cookie = await readCookieHeader();
    }
    catch (e) {
        return { ok: false, status: 0, url, error: e.message, code: "NO_COOKIES" };
    }
    const headers = { ...baseHeaders(), ...init.headers };
    if (cookie)
        headers.cookie = cookie;
    let res;
    try {
        res = await fetch(url, { ...init, headers, redirect: "manual" });
    }
    catch (e) {
        return { ok: false, status: 0, url, error: `请求失败：${e.message}` };
    }
    const text = await res.text();
    let raw = text;
    try {
        raw = text ? JSON.parse(text) : {};
    }
    catch {
        /* 非 JSON（如被重定向到登录 HTML）时保持原文 */
    }
    logger.debug(`api ${init.method ?? "GET"} ${pathname} -> ${res.status}`);
    if (res.status === 401 || res.status === 403) {
        return { ok: false, status: res.status, url, raw, error: "未登录或登录态已失效，请重新执行 login_qimao。" };
    }
    if (raw && typeof raw === "object" && raw.errors?.code === CODE_NOT_LOGGED_IN) {
        return { ok: false, status: res.status, url, raw, code: CODE_NOT_LOGGED_IN, error: "登录已失效，请重新执行 login_qimao。" };
    }
    if (typeof raw === "string") {
        return { ok: false, status: res.status, url, raw, error: `接口返回了非 JSON 内容（HTTP ${res.status}），可能被重定向到登录页。` };
    }
    return interpret(raw, res.status, url);
}
/** 需要断言成功的场景：失败直接抛错（服务层 catch 后转成 ok=false） */
export function mustOk(r, label) {
    if (!r.ok)
        throw new Error(`${label} 失败：${r.error ?? "未知错误"}${r.code ? `（code=${r.code}）` : ""}`);
    return r.data;
}
/** 是否被重定向到登录页（cookies 失效） */
export function onLoginPage(url) {
    return /register-login|\/login|passport|sso/i.test(url);
}
/**
 * 起浏览器 + 注入 cookies + 打开指定页面。
 * 若被重定向到登录页，返回 error（调用方提示重新登录）。
 */
export async function openSession(headless, targetPath, driverBundle) {
    let browser;
    try {
        const { launchBrowser } = await import("./driver.js");
        browser = await launchBrowser(headless, driverBundle);
    }
    catch (e) {
        return { error: e.message };
    }
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1440, height: 900 });
        const { loadCookies } = await import("./cookies.js");
        const cookies = loadCookies();
        await page.goto("about:blank");
        await page.setCookie(...cookies);
        const url = targetPath.startsWith("http") ? targetPath : `${authorBase()}${targetPath}`;
        logger.debug(`打开页面: ${url}`);
        await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
        if (onLoginPage(page.url())) {
            await browser.close().catch(() => { });
            return { error: "cookies 已失效（被重定向到登录页）。请先执行 login_qimao 重新登录。" };
        }
        return { browser, page };
    }
    catch (e) {
        await browser.close().catch(() => { });
        return { error: `打开作者后台失败: ${e.message}` };
    }
}
export function isError(r) {
    return r.error !== undefined;
}
