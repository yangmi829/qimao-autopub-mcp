/**
 * 远程（Streamable HTTP）传输的配置解析。
 *
 * 刻意不 import 任何 SDK / node:http：stdio 与 --selfcheck 路径也用它，
 * 保证默认用法零额外开销、也不因端口占用之类的原因影响本地启动。
 */
export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8766;
export const DEFAULT_PATH = "/mcp";
/** 通用布尔开关解析：1/true/yes/on 视为真 */
export function truthy(v) {
    const s = (v ?? "").trim().toLowerCase();
    return s === "1" || s === "true" || s === "yes" || s === "on";
}
/** 是否走远程传输：`--http` 参数或 `QIMAO_TRANSPORT=http` */
export function remoteRequested(argv = process.argv) {
    if (argv.includes("--http"))
        return true;
    return (process.env.QIMAO_TRANSPORT ?? "").trim().toLowerCase() === "http";
}
/**
 * 解析远程配置。
 *
 * 鉴权规则：**回环地址（127.0.0.1 / localhost / ::1）可以不设 Token，本机免鉴权**；
 * 一旦绑定非回环地址（0.0.0.0 等），必须设 Token，否则直接拒绝启动——
 * 这个端点能驱动真实浏览器改线上正文，不能裸奔对局域网 / 公网开放。
 */
export function remoteOptions() {
    const host = (process.env.QIMAO_HTTP_HOST ?? "").trim() || DEFAULT_HOST;
    const token = (process.env.QIMAO_HTTP_TOKEN ?? "").trim();
    if (token && token.length < 16) {
        throw new Error(`QIMAO_HTTP_TOKEN 太短（当前 ${token.length} 字符）：远程端点可驱动真实浏览器写入，请至少 16 字符的随机串。`);
    }
    if (!token && !isLoopback(host)) {
        throw new Error(`绑定非回环地址 ${host} 时必须设置 QIMAO_HTTP_TOKEN（Bearer 鉴权）。\n` +
            "  只在本机使用的话：把 QIMAO_HTTP_HOST 设为 127.0.0.1（回环地址免鉴权），或删掉该变量。\n" +
            "  要对外暴露（反向代理 / 内网共享）则生成一个强随机 Token：\n" +
            '    node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    }
    const rawPath = (process.env.QIMAO_HTTP_PATH ?? "").trim() || DEFAULT_PATH;
    const parsedPort = Number.parseInt(process.env.QIMAO_HTTP_PORT ?? "", 10);
    return {
        host,
        // 0 表示由系统分配空闲端口（冒烟测试用）
        port: Number.isInteger(parsedPort) && parsedPort >= 0 && parsedPort <= 65535 ? parsedPort : DEFAULT_PORT,
        path: rawPath.startsWith("/") ? rawPath : `/${rawPath}`,
        token: token || null,
        authRequired: Boolean(token),
        readonly: truthy(process.env.QIMAO_HTTP_READONLY),
    };
}
export function isLoopback(host) {
    return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
}
/**
 * 写工具名单（远程只读模式的拦截依据）。
 *
 * 显式列表是当前工具的准确答案；前缀正则是兜底，
 * 保证以后新增的写工具即使忘了加进列表也能被拦下。
 * 命名前缀：login_/set_/create_/update_/add_/save_/delete_/publish_/batch_/import_
 */
const WRITE_TOOLS = new Set([
    "login_qimao",
    "set_qimao_cookies",
    "create_book_qimao",
    "update_book_info_qimao",
    "set_book_tags",
    "add_chapter_qimao",
    "update_chapter_qimao",
    "delete_chapter_qimao",
    "batch_publish_chapters",
    "create_short_story_qimao",
    "publish_short_story_qimao",
    "delete_short_story_qimao",
    "save_article",
    "delete_article",
    "export_article",
    "import_articles_from_dir",
    "update_novel",
]);
const WRITE_TOOL_PREFIX = /^(login|set|create|update|add|save|delete|publish|batch|import)_/;
export function isWriteTool(name) {
    return WRITE_TOOLS.has(name) || WRITE_TOOL_PREFIX.test(name);
}
/** 给 --selfcheck 用：只报告配置（不猜 Token 内容） */
export function describeRemote() {
    let parsed;
    let error;
    try {
        parsed = remoteOptions();
    }
    catch (e) {
        error = e.message.split("\n")[0];
    }
    return {
        requested: remoteRequested(),
        host: parsed?.host ?? process.env.QIMAO_HTTP_HOST ?? DEFAULT_HOST,
        port: parsed?.port ?? process.env.QIMAO_HTTP_PORT ?? DEFAULT_PORT,
        path: parsed?.path ?? process.env.QIMAO_HTTP_PATH ?? DEFAULT_PATH,
        readonly: parsed?.readonly ?? truthy(process.env.QIMAO_HTTP_READONLY),
        token_set: Boolean(parsed?.token),
        /** none = 回环地址且没设 Token（本机免鉴权）；bearer = 请求需带 Authorization */
        auth_mode: parsed ? (parsed.authRequired ? "bearer" : "none") : null,
        error: error ?? null,
    };
}
