import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function ok(data: unknown, note?: string): CallToolResult {
  const payload = note ? { note, ...(data as object) } : data;
  return {
    content: [
      {
        type: "text",
        text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
      },
    ],
  };
}

/**
 * 服务层统一返回 { ok, message, ...payload }，这里转成 MCP 结果：
 * ok=false -> 错误结果（附加 warnings 作为 hint）。
 */
export function fromService(r: { ok: boolean; message?: string; warnings?: string[] } & Record<string, unknown>): CallToolResult {
  if (!r.ok) {
    const hint = r.warnings?.length ? r.warnings.join("；") : undefined;
    return fail(r.message ?? "操作失败", hint);
  }
  return ok(r);
}

export function fail(message: string, hint?: string): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(hint ? { error: message, hint } : { error: message }, null, 2),
      },
    ],
    isError: true,
  };
}
