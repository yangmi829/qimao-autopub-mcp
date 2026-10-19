import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ok } from "../core/result.js";
import { GENRES } from "../knowledge/genres.js";

/**
 * 纯本地知识库工具（不联网）。
 * 与资源 qimao://genres / qimao://golden-three-chapters 同源。
 */
export function registerKnowledgeTools(server: McpServer): void {
  server.registerTool(
    "list_genres",
    {
      title: "列出网文赛道知识库",
      description:
        "列出主流网文赛道的爽点机制、开篇要求、节奏、避坑清单与建议单章字数（不联网）。" +
        "写新书/定赛道前先看它；完整方法论也可读资源 qimao://genres 与 qimao://golden-three-chapters。",
    },
    async () =>
      ok({
        total: GENRES.length,
        genres: GENRES,
        usage: "把 key 作为赛道标识记录在本地小说登记里（本服务不强制校验赛道）。",
      })
  );
}
