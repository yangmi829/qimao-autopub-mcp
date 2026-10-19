#!/usr/bin/env node
/**
 * 直连 MCP 的命令行小工具（当 WorkBuddy 连接器尚未生效时排障用）。
 *
 * 用法：
 *   node scripts/mcp-cli.mjs --list                          # 列出工具
 *   node scripts/mcp-cli.mjs --resources                     # 列出资源
 *   node scripts/mcp-cli.mjs get_publish_status              # 调用工具（默认参数 {}）
 *   node scripts/mcp-cli.mjs get_stats '{"remote":false}'    # 带 JSON 参数
 *   node scripts/mcp-cli.mjs --res qimao://publish-rules     # 读取资源
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(ROOT, "dist", "index.js")],
  env: process.env,
  stderr: "inherit",
});
const client = new Client({ name: "mcp-cli", version: "0.0.0" });

try {
  await client.connect(transport);

  if (argv.includes("--list") || argv.length === 0) {
    const tools = await client.listTools();
    for (const t of tools.tools) console.log(`- ${t.name}: ${t.description?.split("\n")[0] ?? ""}`);
  } else if (argv.includes("--resources")) {
    const res = await client.listResources();
    for (const r of res.resources) console.log(`- ${r.uri}: ${r.description ?? r.name}`);
  } else if (argv[0] === "--res") {
    const res = await client.readResource({ uri: argv[1] });
    console.log(res.contents.map((c) => c.text).join("\n"));
  } else {
    const [name, ...rest] = argv;
    let args = {};
    if (process.env.MCP_ARGS) {
      args = JSON.parse(process.env.MCP_ARGS);
    } else if (rest.length === 1 && rest[0].trim().startsWith("{")) {
      args = JSON.parse(rest[0]);
    } else {
      // 支持 key=value 形式（value 先尝试 JSON，失败则按字符串）
      for (const token of rest) {
        const eq = token.indexOf("=");
        if (eq < 0) continue;
        const k = token.slice(0, eq);
        const raw = token.slice(eq + 1);
        if (raw === "true") args[k] = true;
        else if (raw === "false") args[k] = false;
        else if (raw !== "" && !Number.isNaN(Number(raw)) && /^-?\d+(\.\d+)?$/.test(raw)) args[k] = Number(raw);
        else args[k] = raw;
      }
    }
    const callTimeout = Number(process.env.MCP_CALL_TIMEOUT_MS || 600000);
    const res = await client.callTool({ name, arguments: args }, undefined, { timeout: callTimeout });
    const text = res.content?.map((c) => c.text).join("\n") ?? "";
    console.log(text);
    if (res.isError) process.exitCode = 1;
  }
} catch (e) {
  console.error("调用失败：", e);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
