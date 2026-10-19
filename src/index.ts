#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { logger } from "./core/logger.js";
import { ensureDirs, DATA_DIR, DATA_DIR_SOURCE, PACKAGE_VERSION } from "./core/paths.js";
import { describeRemote, remoteRequested } from "./core/remote.js";
import { registerAuthTools } from "./tools/auth.js";
import { registerBookTools } from "./tools/book.js";
import { registerChapterTools } from "./tools/chapter.js";
import { registerShortStoryTools } from "./tools/shortStory.js";
import { registerLibraryTools } from "./tools/library.js";
import { registerKnowledgeTools } from "./tools/knowledge.js";
import { registerStatsTools } from "./tools/stats.js";
import { registerResources } from "./resources/index.js";

const SERVER_NAME = "qimao-autopub-mcp";
/** 单一真源＝package.json（见 core/paths.ts 的 PACKAGE_VERSION），不要在这里写死版本号 */
const SERVER_VERSION = PACKAGE_VERSION;
/** 注册的工具 / 资源总数（冒烟与启动日志都盯着它，改完记得同步） */
const TOOL_COUNT = 30;
const RESOURCE_COUNT = 8;

export function buildServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  registerAuthTools(server);
  registerBookTools(server);
  registerChapterTools(server);
  registerShortStoryTools(server);
  registerLibraryTools(server);
  registerKnowledgeTools(server);
  registerStatsTools(server);
  registerResources(server);

  return server;
}

async function main(): Promise<void> {
  ensureDirs();

  // 便于排障：--selfcheck 只打印环境信息后退出，不启动任何传输
  if (process.argv.includes("--selfcheck")) {
    const { automationReadiness } = await import("./services/auth.js");
    process.stderr.write(
      JSON.stringify({ ...automationReadiness(), remote: describeRemote() }, null, 2) + "\n"
    );
    return;
  }

  // 数据落在哪儿常是排障第一问（cookies / 文稿都在里面），启动时明确报一次
  logger.info(`数据目录: ${DATA_DIR}（来源: ${DATA_DIR_SOURCE}）`);

  // 远程模式：Streamable HTTP（默认仍是 stdio）
  if (remoteRequested()) {
    const { startRemoteServer } = await import("./http.js");
    await startRemoteServer(buildServer, { name: SERVER_NAME, version: SERVER_VERSION });
    return;
  }

  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info(`${SERVER_NAME} v${SERVER_VERSION} 已就绪（stdio），共注册 ${TOOL_COUNT} 个工具、${RESOURCE_COUNT} 个只读资源。`);
}

main().catch((e) => {
  logger.error(`启动失败: ${(e as Error).stack ?? (e as Error).message}`);
  process.exit(1);
});
