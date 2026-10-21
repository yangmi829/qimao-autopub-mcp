import { sleep, launchBrowser, browserEnabled, puppeteerAvailable, driverName, shot } from "../browser/driver.js";
import { cookiesExist, cookiesPath, cookiesSummary, saveCookies, loadCookies } from "../browser/cookies.js";
import { authorLoginUrl, bookManageUrl, API, apiGet } from "../browser/endpoints.js";
import { logger } from "../core/logger.js";
import { DATA_DIR, DATA_DIR_SOURCE } from "../core/paths.js";
/**
 * 环境自检。
 *
 * 与番茄不同：七猫的**只读接口可以纯 HTTP 直连**（签名是纯 MD5），
 * 所以 `ready` 只要求 cookies 存在；浏览器只有写操作才需要。
 */
export function automationReadiness() {
    const reasons = [];
    const browserReasons = [];
    if (!cookiesExist())
        reasons.push(`缺少 cookies 文件：${cookiesPath()}（执行 login_qimao 登录，或 set_qimao_cookies 导入）`);
    if (!browserEnabled())
        browserReasons.push("浏览器能力已被 QIMAO_ENABLE_BROWSER=0 关闭");
    if (!puppeteerAvailable())
        browserReasons.push("未安装浏览器驱动：在项目目录执行 `npm i puppeteer-core`，或 `npm i puppeteer`");
    return {
        ready: reasons.length === 0,
        browserReady: reasons.length === 0 && browserReasons.length === 0,
        reasons,
        details: {
            browser_enabled: browserEnabled(),
            puppeteer_installed: puppeteerAvailable(),
            driver: driverName(),
            browser_ready: reasons.length === 0 && browserReasons.length === 0,
            browser_reasons: browserReasons,
            data_dir: DATA_DIR,
            data_dir_source: DATA_DIR_SOURCE,
            cookies_file: cookiesPath(),
            cookies: cookiesSummary(),
            login_url: authorLoginUrl(),
            book_manage_url: bookManageUrl(),
            chrome_path: process.env.QIMAO_CHROME_PATH ?? null,
            sign_style: (process.env.QIMAO_SIGN_STYLE ?? "").trim().toLowerCase() === "amp" ? "amp" : "concat",
        },
    };
}
/* ------------------------------ 半自动登录 ------------------------------ */
/**
 * 半自动登录：打开真实浏览器窗口，你在窗口里扫码 / 短信验证码完成登录，
 * 本服务只轮询登录状态并在成功后保存 cookies。全程不接触账号密码。
 */
export async function interactiveLogin(timeoutMs = 5 * 60 * 1000) {
    if (!browserEnabled()) {
        return { ok: false, message: "浏览器能力已被 QIMAO_ENABLE_BROWSER=0 关闭。" };
    }
    let browser;
    try {
        browser = await launchBrowser(false);
    }
    catch (e) {
        return { ok: false, message: e.message };
    }
    const loginUrl = authorLoginUrl();
    let saved = null;
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1440, height: 900 });
        await page.goto(loginUrl, { waitUntil: "networkidle2", timeout: 60000 });
        logger.info(`已打开登录页: ${loginUrl}，等待用户完成登录`);
        const deadline = Date.now() + timeoutMs;
        let lastCookieCount = 0;
        while (Date.now() < deadline) {
            await sleep(2000);
            let cookies = [];
            try {
                cookies = await page.cookies();
            }
            catch {
                break; // 窗口被关闭
            }
            lastCookieCount = cookies.length;
            // 登录成功的信号：URL 离开登录路由，且 cookies 有增长
            const url = page.url();
            const stillLogin = /register-login|\/login/i.test(url);
            if (!stillLogin && cookies.length >= 2) {
                saved = saveCookies(JSON.stringify(cookies));
                break;
            }
        }
        if (!saved) {
            const screenshotPath = await shot(page, "login-timeout");
            await browser.close().catch(() => { });
            return {
                ok: false,
                message: `等待登录超时（${Math.round(timeoutMs / 1000)} 秒内未检测到登录成功，当前 cookies 数=${lastCookieCount}）。` +
                    "请重试并在弹出的浏览器窗口中完成登录。",
                screenshotPath,
            };
        }
    }
    catch (e) {
        await browser.close().catch(() => { });
        return { ok: false, message: `登录流程异常: ${e.message}` };
    }
    await browser.close().catch(() => { });
    // 落地后立刻用 HTTP 直连复核登录态（比只看 URL 可靠）
    const check = await checkLogin();
    return {
        ok: check.loggedIn,
        message: check.loggedIn
            ? `登录成功，已保存 ${saved.count} 条 cookies。`
            : `已保存 ${saved.count} 条 cookies，但登录态校验未通过：${check.message}`,
        cookieCount: saved.count,
        path: saved.path,
    };
}
/**
 * 校验 cookies 是否仍然有效。
 *
 * 纯 HTTP 直连：先打 `/api/author/profile`（真机验证：笔名在 `data.user.pen_name`），
 * 失败再退回作者首页 `author/index`。命中「登录已失效」即判定未登录。
 */
export async function checkLogin() {
    if (!cookiesExist()) {
        return { ok: false, loggedIn: false, message: `缺少 cookies 文件：${cookiesPath()}` };
    }
    const profile = await apiGet(API.authorProfile);
    const index = profile.ok ? undefined : await apiGet(API.authorIndex);
    const source = profile.ok ? profile : index;
    if (!source.ok) {
        if (source.code === "NO_COOKIES" || source.error?.includes("未找到 cookies")) {
            return { ok: false, loggedIn: false, message: source.error ?? "缺少 cookies" };
        }
        return { ok: false, loggedIn: false, message: source.error ?? "校验登录态失败" };
    }
    const d = profile.ok ? profile.data ?? {} : index?.data ?? {};
    const user = d.user?.pen_name ??
        d.pen_name ??
        d.author_name ??
        d.nick_name ??
        d.name ??
        d.author_info?.author_name ??
        d.user?.nick_name;
    const accountId = d.user?.account_id ?? d.account_id;
    let bookCount;
    const books = await apiGet(API.bookList, { next_id: "" });
    if (books.ok) {
        const b = books.data ?? {};
        bookCount =
            typeof b.total === "number"
                ? b.total
                : Array.isArray(b.list)
                    ? b.list.length
                    : Array.isArray(b.book_list)
                        ? b.book_list.length
                        : undefined;
    }
    return {
        ok: true,
        loggedIn: true,
        message: "cookies 有效，当前处于登录态。",
        user: user ? String(user) : undefined,
        accountId: accountId ? String(accountId) : undefined,
        bookCount,
    };
}
/** 供工具层使用：导入 cookies 文本/文件 */
export function importCookies(raw) {
    const saved = saveCookies(raw);
    // 立即确认格式可加载
    loadCookies();
    return saved;
}
/** 供其它服务复用：带登录态校验的 cookies 断言 */
export function assertCookies() {
    if (!cookiesExist()) {
        throw new Error(`缺少 cookies 文件：${cookiesPath()}。先执行 login_qimao 登录，或用 set_qimao_cookies 导入。`);
    }
}
/** 写操作前置校验：cookies + 浏览器可用（写接口只能驱动真实页面，不能纯 HTTP） */
export function assertWriteReady() {
    assertCookies();
    if (!browserEnabled()) {
        throw new Error("浏览器已被 QIMAO_ENABLE_BROWSER=0 关闭：写操作必须驱动真实页面，本次未执行。");
    }
    if (!puppeteerAvailable()) {
        throw new Error("未安装浏览器驱动（puppeteer-core）：写操作必须驱动真实页面，本次未执行。请在项目目录执行 `npm i puppeteer-core`。");
    }
}
export { cookiesSummary };
