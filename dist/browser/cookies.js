import path from "node:path";
import fs from "node:fs";
import { DATA_DIR } from "../core/paths.js";
import { logger } from "../core/logger.js";
export function cookiesPath() {
    return process.env.QIMAO_COOKIES_FILE || path.join(DATA_DIR, "qimao_cookies.json");
}
export function cookiesExist() {
    return fs.existsSync(cookiesPath());
}
/** 保存 cookies。接受 puppeteer 导出的数组，或 {"cookies":[...]} 包装。 */
export function saveCookies(raw) {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.cookies) ? parsed.cookies : null;
    if (!list || list.length === 0) {
        throw new Error("cookies 为空，或格式不是数组 / {cookies:[...]}");
    }
    const normalized = list.map((c) => ({
        name: String(c.name),
        value: String(c.value),
        domain: c.domain ?? ".qimao.com",
        path: c.path ?? "/",
        expires: c.expires ?? c.expirationDate ?? undefined,
        httpOnly: Boolean(c.httpOnly),
        secure: Boolean(c.secure),
        sameSite: c.sameSite ?? undefined,
    }));
    const file = cookiesPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(normalized, null, 2), "utf-8");
    logger.info(`已保存 ${normalized.length} 条 cookies -> ${file}`);
    return { count: normalized.length, path: file };
}
export function loadCookies() {
    const file = cookiesPath();
    if (!fs.existsSync(file)) {
        throw new Error(`未找到 cookies 文件：${file}。先执行 login_qimao 登录，或用 set_qimao_cookies 导入。`);
    }
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    const list = Array.isArray(parsed) ? parsed : parsed?.cookies;
    if (!Array.isArray(list) || list.length === 0) {
        throw new Error(`cookies 文件内容无效：${file}`);
    }
    return list;
}
/**
 * 构造 `Cookie:` 请求头。
 * 只取与作者后台同域名（qimao.com / zuozhe.qimao.com）相关的 cookie：
 * 把别的域名的 cookie 一并带上会让服务端困惑，也会泄露无关凭据。
 */
export function cookieHeader() {
    const list = loadCookies();
    return list
        .filter((c) => {
        const d = String(c.domain ?? "").replace(/^\./, "");
        return d === "" || d.endsWith("qimao.com");
    })
        .map((c) => `${c.name}=${c.value}`)
        .join("; ");
}
/** cookies 详情（只暴露结构与过期时间，不泄露 value） */
export function cookiesSummary() {
    const file = cookiesPath();
    if (!fs.existsSync(file))
        return { exists: false, path: file };
    try {
        const list = loadCookies();
        const now = Math.floor(Date.now() / 1000);
        const expiring = list
            .filter((c) => typeof c.expires === "number" && c.expires > 0 && c.expires < now)
            .map((c) => c.name);
        const earliest = list
            .map((c) => (typeof c.expires === "number" && c.expires > 0 ? c.expires : Infinity))
            .reduce((a, b) => Math.min(a, b), Infinity);
        return {
            exists: true,
            path: file,
            count: list.length,
            names: list.map((c) => c.name),
            expired: expiring,
            earliest_expiry: Number.isFinite(earliest) ? new Date(earliest * 1000).toISOString() : null,
        };
    }
    catch (e) {
        return { exists: true, path: file, error: e.message };
    }
}
