/**
 * 远程传输：Streamable HTTP（MCP 2025-03-26 起标准，支持 SSE 流式返回长任务进度）。
 *
 * 设计取舍：
 * - 用 node:http 手写路由，不引入 express（本仓库一贯零额外依赖）。
 * - 默认只监听回环地址；**回环地址免鉴权**（本机免配置），一旦绑非回环地址则强制 Bearer Token，
 *   否则拒绝启动——这个服务能驱动真实浏览器改线上内容，裸奔的对外端点等于把作者后台交出去。
 * - 会话按 mcp-session-id 维护，与 SDK 官方 stateful 示例一致。
 * - 日志仍走 stderr（core/logger.ts）；HTTP 模式下 stdout 不被占用，但保持一致。
 */
import http from "node:http";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logger } from "./core/logger.js";
import { isLoopback, isWriteTool, remoteOptions } from "./core/remote.js";

/** 单次请求体上限：整章正文走 HTTP 时可能很大，留足余量 */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

export type ServerFactory = () => McpServer;

export interface RemoteServerInfo {
  name: string;
  version: string;
}

export async function startRemoteServer(makeServer: ServerFactory, info: RemoteServerInfo): Promise<http.Server> {
  const opts = remoteOptions();
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://localhost");

    // 探活端点：免鉴权，只暴露最小信息（方便容器 / 反向代理健康检查）
    if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/healthz")) {
      return sendJson(res, 200, {
        ok: true,
        name: info.name,
        version: info.version,
        transport: "streamable-http",
        readonly: opts.readonly,
      });
    }

    if (url.pathname !== opts.path) {
      return sendJson(res, 404, { error: `未知路径 ${url.pathname}；MCP 端点是 ${opts.path}（探活：/health）` });
    }

    // 没配 Token ＝ 本机免鉴权模式（remoteOptions() 已保证这种情况只可能是回环地址）
    if (opts.token && !authorized(req.headers.authorization, opts.token)) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="qimao-autopub-mcp"');
      return sendJson(res, 401, rpcError(null, -32001, "未授权：请求头需要 Authorization: Bearer <QIMAO_HTTP_TOKEN>"));
    }

    if (req.method === "POST") {
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch (e) {
        return sendJson(res, 400, rpcError(null, -32700, `请求体解析失败：${(e as Error).message}`));
      }
      const blocked = blockedWriteTool(body, opts.readonly);
      if (blocked) {
        logger.warn(`只读模式拦截写工具调用：${blocked}`);
        return sendJson(res, 403, rpcError(rpcId(body), -32003, `远程端点当前为只读模式（QIMAO_HTTP_READONLY=1），已拦截写工具 ${blocked}`));
      }
      return handlePost(req, res, body, sessions, makeServer);
    }

    if (req.method === "GET" || req.method === "DELETE") {
      const sessionId = headerValue(req.headers["mcp-session-id"]);
      const transport = sessionId ? sessions.get(sessionId) : undefined;
      if (!transport) {
        return sendJson(res, 400, rpcError(null, -32000, `${req.method} 需要有效的 mcp-session-id（缺失或会话已过期）`));
      }
      return transport.handleRequest(req, res);
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return sendJson(res, 405, { error: `不支持的请求方法：${req.method ?? "?"}` });
  };

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      logger.error(`远程请求处理失败: ${(e as Error).stack ?? (e as Error).message}`);
      if (!res.headersSent) sendJson(res, 500, { error: "服务内部错误" });
      else res.end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, resolve);
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : opts.port;
  const shownHost = opts.host === "0.0.0.0" || opts.host === "::" ? "127.0.0.1" : opts.host;

  // 冒烟测试按这一行解析实际端口（端口传 0 时由系统分配），改动请同步 scripts/smoke.mjs
  logger.info(
    `远程端点已就绪: http://${shownHost}:${port}${opts.path}（${opts.token ? "Bearer 鉴权" : "本机免鉴权"} / ${
      opts.readonly ? "只读模式" : "可写模式"
    }）`
  );
  if (!opts.token) {
    logger.warn(
      `本机免鉴权模式（QIMAO_HTTP_HOST=${opts.host}）：同机任何进程都能调用该端点（含写工具）。不要改绑非回环地址——那会因缺 Token 直接拒绝启动。`
    );
  }
  if (!isLoopback(opts.host)) {
    logger.warn(
      `已绑定非回环地址 ${opts.host}：该端点能驱动真实浏览器执行写操作，请确保 QIMAO_HTTP_TOKEN 足够强，并置于反向代理 / 防火墙之后。`
    );
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`收到 ${signal}，正在关闭远程端点…`);
    for (const t of sessions.values()) await t.close().catch(() => {});
    sessions.clear();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  return server;
}

/* ------------------------------ 内部实现 ------------------------------ */

async function handlePost(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: unknown,
  sessions: Map<string, StreamableHTTPServerTransport>,
  makeServer: ServerFactory
): Promise<void> {
  const sessionId = headerValue(req.headers["mcp-session-id"]);
  let transport = sessionId ? sessions.get(sessionId) : undefined;

  if (!transport) {
    if (sessionId) {
      return sendJson(res, 404, rpcError(rpcId(body), -32001, `会话不存在或已过期：${sessionId}，请重新初始化`));
    }
    if (!isInitializeRequest(body)) {
      return sendJson(res, 400, rpcError(rpcId(body), -32600, "缺少 mcp-session-id，且请求不是 initialize"));
    }
    // 每个会话一个独立 Server + Transport，避免请求 ID 串号
    const created = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid: string) => {
        sessions.set(sid, created);
        logger.debug(`远程会话已建立：${sid}`);
      },
      onsessionclosed: (sid: string) => {
        sessions.delete(sid);
        logger.debug(`远程会话已关闭：${sid}`);
      },
    });
    created.onclose = () => {
      const sid = created.sessionId;
      if (sid) sessions.delete(sid);
    };
    await makeServer().connect(created);
    transport = created;
  }

  await transport.handleRequest(req, res, body);
}

/** 只读模式下命中写工具时返回工具名 */
function blockedWriteTool(body: unknown, readonly: boolean): string | null {
  if (!readonly) return null;
  for (const msg of Array.isArray(body) ? body : [body]) {
    const m = msg as { method?: string; params?: { name?: string } };
    if (m?.method === "tools/call" && typeof m.params?.name === "string" && isWriteTool(m.params.name)) {
      return m.params.name;
    }
  }
  return null;
}

function rpcId(body: unknown): unknown {
  const first = Array.isArray(body) ? body[0] : body;
  return (first as { id?: unknown } | undefined)?.id ?? null;
}

function rpcError(id: unknown, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error(`请求体超过 ${Math.round(MAX_BODY_BYTES / 1024 / 1024)}MB 上限`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8").trim();
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error((e as Error).message));
      }
    });
    req.on("error", reject);
  });
}

function headerValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** 常量时间比较，避免按字符比较泄漏 Token 长度 / 前缀 */
function authorized(header: string | undefined, token: string): boolean {
  const m = /^Bearer\s+(.+)$/i.exec((header ?? "").trim());
  if (!m) return false;
  const a = createHash("sha256").update(m[1].trim()).digest();
  const b = createHash("sha256").update(token).digest();
  return timingSafeEqual(a, b);
}
