/**
 * MCP stdio 传输中 stdout 被协议占用，日志只能写 stderr。
 */
const DEBUG = process.env.QIMAO_DEBUG === "1";
function safeStringify(v) {
    try {
        return JSON.stringify(v);
    }
    catch {
        return String(v);
    }
}
function write(level, args) {
    const ts = new Date().toISOString();
    const msg = args.map((a) => (typeof a === "string" ? a : safeStringify(a))).join(" ");
    try {
        process.stderr.write(`[${ts}] [${level}] ${msg}\n`);
    }
    catch {
        // stderr 不可写时不应导致服务崩溃
    }
}
export const logger = {
    debug: (...args) => {
        if (DEBUG)
            write("DEBUG", args);
    },
    info: (...args) => write("INFO", args),
    warn: (...args) => write("WARN", args),
    error: (...args) => write("ERROR", args),
};
