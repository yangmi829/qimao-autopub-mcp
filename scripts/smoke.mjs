/**
 * 协议级冒烟测试（不触网）：
 * 以 stdio 方式拉起 dist/index.js，走真实 MCP 协议列出工具/资源，
 * 并调用若干个纯本地（不联网）工具验证返回结构；
 * 最后再以远程方式（Streamable HTTP）拉一次，验证鉴权 / 只读模式 / 远程调用链路。
 *
 * 使用临时数据目录，避免污染真实 data/。
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "qimao-smoke-"));
/** 服务版本必须与 package.json 一致（曾经在 index.ts 里写死 → 升版后报旧版本） */
const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8")).version;

// 预置最小夹具：一本本地小说 + 两章磁盘工作稿（用于 update_novel / import_articles_from_dir）
const SMOKE_NOVEL_ID = "nov_smoke0001";
fs.writeFileSync(
  path.join(TMP, "novels.json"),
  JSON.stringify(
    [
      {
        id: SMOKE_NOVEL_ID,
        title: "冒烟小说",
        gender: 1,
        qimaoBookId: "1234567890",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    null,
    2
  ),
  "utf-8"
);
const SMOKE_CHAPTER_DIR = path.join(TMP, "chapters");
fs.mkdirSync(SMOKE_CHAPTER_DIR, { recursive: true });
fs.writeFileSync(
  path.join(SMOKE_CHAPTER_DIR, "第01章_十二个人.md"),
  "# 第01章 十二个人\n\n> **本章概要**：这段元信息不该进正文\n> **本章爽点**：也不该\n\n---\n\n透析室在走廊尽头。\n\n第二段。\n",
  "utf-8"
);
fs.writeFileSync(path.join(SMOKE_CHAPTER_DIR, "第02章_测试二.md"), "# 第02章 测试二\n\n他笑了。\n", "utf-8");

const EXPECTED_TOOLS = [
  // 登录/状态
  "login_qimao",
  "set_qimao_cookies",
  "get_publish_status",
  // 作品
  "list_books_qimao",
  "create_book_qimao",
  "update_book_info_qimao",
  "set_book_tags",
  "list_book_options_qimao",
  // 章节
  "list_chapters_qimao",
  "add_chapter_qimao",
  "update_chapter_qimao",
  "delete_chapter_qimao",
  "batch_publish_chapters",
  // 短篇
  "list_short_stories_qimao",
  "get_short_story_qimao",
  "create_short_story_qimao",
  "publish_short_story_qimao",
  "delete_short_story_qimao",
  // 数据 / 收益
  "get_book_statistics_qimao",
  "get_book_income_qimao",
  // 文稿库
  "save_article",
  "list_articles",
  "get_article",
  "delete_article",
  "export_article",
  "import_articles_from_dir",
  // 本地知识库 / 质检 / 登记 / 汇总
  "check_originality",
  "update_novel",
  "list_genres",
  "get_stats",
];

const EXPECTED_RESOURCES = [
  "qimao://status",
  "qimao://novels",
  "qimao://short-stories",
  "qimao://articles",
  "qimao://tasks",
  "qimao://publish-rules",
  "qimao://genres",
  "qimao://golden-three-chapters",
];

const TOOL_COUNT = 30;

let failures = 0;
const httpChildren = [];
function check(name, cond, extra = "") {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${name}${extra ? "  " + extra : ""}`);
}

function parse(res) {
  const text = res?.content?.find((c) => c.type === "text")?.text ?? "";
  try {
    return JSON.parse(text);
  } catch {
    return { _text: text };
  }
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(ROOT, "dist", "index.js")],
  env: { ...process.env, QIMAO_DATA_DIR: TMP, QIMAO_ENABLE_BROWSER: "0" },
  stderr: "pipe",
});

const client = new Client({ name: "smoke", version: "0.0.0" });

try {
  await client.connect(transport);
  console.log("已连接 server（stdio）。\n");

  // 0) 服务版本：必须是 package.json 的那个版本，不能是写死的常量
  check(
    "stdio serverInfo 版本与 package.json 一致",
    client.getServerVersion()?.version === PKG_VERSION,
    `实际=${client.getServerVersion()?.version} 期望=${PKG_VERSION}`
  );

  // 1) 工具清单
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name);
  check(`工具总数=${TOOL_COUNT}`, names.length === TOOL_COUNT, `实际=${names.length}`);
  for (const t of EXPECTED_TOOLS) check(`工具存在: ${t}`, names.includes(t));

  // 2) 资源清单
  const resources = await client.listResources();
  const uris = resources.resources.map((r) => r.uri);
  check(`资源总数=${EXPECTED_RESOURCES.length}`, uris.length === EXPECTED_RESOURCES.length, `实际=${uris.length}`);
  for (const u of EXPECTED_RESOURCES) check(`资源存在: ${u}`, uris.includes(u));

  // 3) 纯本地工具调用
  let r = parse(await client.callTool({ name: "get_stats", arguments: { remote: false } }));
  check("get_stats 返回 local 统计", r?.local && typeof r.local.articles?.total === "number");

  r = parse(await client.callTool({ name: "list_articles", arguments: {} }));
  check("list_articles 空库返回 total=0", r?.total === 0);

  r = parse(await client.callTool({ name: "save_article", arguments: { kind: "chapter", title: "冒烟章节", content: "第一段。\n\n第二段。", chapter_number: 1 } }));
  check("save_article 返回 article_id", typeof r?.article?.id === "string", `id=${r?.article?.id ?? "?"}`);
  const artId = r?.article?.id;

  r = parse(await client.callTool({ name: "get_article", arguments: { article_id: artId } }));
  check("get_article 取回正文", typeof r?.content === "string" && r.content.includes("第一段"));

  r = parse(await client.callTool({ name: "list_genres", arguments: {} }));
  check("list_genres 返回赛道知识库", typeof r?.total === "number" && r.total > 0 && Array.isArray(r.genres));

  r = parse(await client.callTool({ name: "check_originality", arguments: { content: "第一段。\n\n第二段。", threshold: 0.25 } }));
  check("check_originality 返回 similarity/passed", typeof r?.similarity === "number" && typeof r?.passed === "boolean");

  r = parse(await client.callTool({ name: "export_article", arguments: { article_id: artId } }));
  check("export_article 返回文件路径", typeof r?.filePath === "string" && r.filePath.length > 0, `path=${r?.filePath ?? "?"}`);

  r = parse(await client.callTool({ name: "delete_article", arguments: { article_id: artId, confirm: false } }));
  check("delete_article(confirm=false) 为预览", r?.action === "preview" && r?.ok !== false);

  // 3.5) 修改能力（纯本地）：save_article upsert / update_novel / import_articles_from_dir
  r = parse(await client.callTool({ name: "save_article", arguments: { article_id: artId, title: "冒烟章节（改名）", chapter_number: 3 } }));
  check(
    "save_article(带 article_id) 走更新",
    r?.action === "updated" && r?.article?.title === "冒烟章节（改名）" && r?.article?.chapterNumber === 3,
    `action=${r?.action}`
  );

  r = parse(await client.callTool({ name: "update_novel", arguments: { novel_id: SMOKE_NOVEL_ID, status: "连载中", target_words_per_chapter: 2500, genre: "urban_system" } }));
  check(
    "update_novel 写入本地设定",
    r?.ok === true && Array.isArray(r?.changed) && r.changed.includes("status") && r?.novel_id === SMOKE_NOVEL_ID,
    `changed=${JSON.stringify(r?.changed)}`
  );

  r = parse(await client.callTool({ name: "import_articles_from_dir", arguments: { dir: SMOKE_CHAPTER_DIR, novel_id: SMOKE_NOVEL_ID, confirm: false } }));
  check(
    "import_articles_from_dir(confirm=false) 为预览且识别 2 章",
    r?.action === "preview" && r?.created === 2 && r?.updated === 0,
    `action=${r?.action} created=${r?.created}`
  );

  r = parse(await client.callTool({ name: "import_articles_from_dir", arguments: { dir: SMOKE_CHAPTER_DIR, novel_id: SMOKE_NOVEL_ID, confirm: true } }));
  check("import_articles_from_dir(confirm=true) 新建 2 章", r?.action === "imported" && r?.created === 2, `created=${r?.created}`);

  r = parse(await client.callTool({ name: "import_articles_from_dir", arguments: { dir: SMOKE_CHAPTER_DIR, novel_id: SMOKE_NOVEL_ID, confirm: true } }));
  check(
    "重复导入变为更新（幂等，不重复建条目）",
    r?.action === "imported" && r?.created === 0 && r?.updated === 2,
    `created=${r?.created} updated=${r?.updated}`
  );

  const ch1 = (r?.planned ?? []).find((p) => p.chapterNumber === 1);
  r = parse(await client.callTool({ name: "get_article", arguments: { article_id: ch1?.articleId } }));
  check(
    "导入结果：章节号/标题/正文都正确（剥掉概要块与 markdown）",
    r?.chapterNumber === 1 &&
      r?.title === "第01章 十二个人" &&
      /透析室在走廊尽头/.test(r?.content || "") &&
      !/本章概要|\*\*|---/.test(r?.content || ""),
    `title=${r?.title}`
  );

  r = parse(await client.callTool({ name: "list_articles", arguments: { novel_id: SMOKE_NOVEL_ID } }));
  check("导入后该小说下共 2 条文稿", r?.total === 2, `total=${r?.total}`);

  r = parse(await client.callTool({ name: "get_publish_status", arguments: { verify_login: false } }));
  check("get_publish_status 可调用并返回 ready 字段", typeof r?.ready === "boolean" && typeof r?.browser_ready === "boolean");

  // 4) 资源读取（只读、不联网）
  const res = await client.readResource({ uri: "qimao://publish-rules" });
  const body = JSON.parse(res.contents[0].text);
  check("publish-rules 含短篇字数与读写边界", body?.shortStory?.words && body?.readWriteBoundary?.readonly && body?.readWriteBoundary?.write);
  check("publish-rules 含确认两段式说明", /confirm=false/.test(JSON.stringify(body)));

  const genresRes = await client.readResource({ uri: "qimao://genres" });
  const genresBody = JSON.parse(genresRes.contents[0].text);
  check("genres 资源含赛道条目", Array.isArray(genresBody) && genresBody.length > 0);

  const goldenRes = await client.readResource({ uri: "qimao://golden-three-chapters" });
  check("golden-three 资源为 markdown", /黄金三章/.test(goldenRes.contents[0].text));

  const statusRes = await client.readResource({ uri: "qimao://status" });
  const statusBody = JSON.parse(statusRes.contents[0].text);
  check("status 资源含 ready / cookies", typeof statusBody?.ready === "boolean" && !!statusBody?.cookies);

  /* ------------------------------ 5) 远程传输（Streamable HTTP） ------------------------------ */
  const HTTP_TOKEN = "smoke-token-0123456789abcdef";
  const TMP_HTTP = path.join(TMP, "http-data");
  fs.mkdirSync(TMP_HTTP, { recursive: true });

  /** 以 --http 拉起一个独立进程（端口 0 = 系统分配），从 stderr 解析真实端点 */
  async function startHttpServer(extraEnv = {}) {
    const child = spawn(process.execPath, [path.join(ROOT, "dist", "index.js"), "--http"], {
      env: {
        ...process.env,
        QIMAO_DATA_DIR: TMP_HTTP,
        QIMAO_ENABLE_BROWSER: "0",
        QIMAO_HTTP_TOKEN: HTTP_TOKEN,
        QIMAO_HTTP_HOST: "127.0.0.1",
        QIMAO_HTTP_PORT: "0",
        ...extraEnv,
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    httpChildren.push(child);

    let stderr = "";
    child.stderr.on("data", (b) => {
      stderr += b.toString("utf-8");
    });

    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        clearInterval(poll);
        reject(new Error(`远程端点 15s 内未就绪。stderr:\n${stderr}`));
      }, 15000);
      const poll = setInterval(() => {
        const m = /远程端点已就绪: (http:\/\/[^\s（]+)/.exec(stderr);
        if (m) {
          clearInterval(poll);
          clearTimeout(timer);
          resolve(m[1]);
        }
      }, 50);
      child.once("exit", (code) => {
        clearInterval(poll);
        clearTimeout(timer);
        reject(new Error(`远程进程提前退出 code=${code}。stderr:\n${stderr}`));
      });
    });

    return { child, url, stderr: () => stderr };
  }

  async function connectHttp(url, token = HTTP_TOKEN) {
    const c = new Client({ name: "smoke-http", version: "0.0.0" });
    const t = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    });
    await c.connect(t);
    return c;
  }

  /** 拉起一个应当「启动即退出」的远程进程（用于验证拒绝启动的分支），只读 stderr 与退出码 */
  function runToExit(extraEnv = {}) {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(ROOT, "dist", "index.js"), "--http"], {
        env: {
          ...process.env,
          QIMAO_DATA_DIR: TMP_HTTP,
          QIMAO_ENABLE_BROWSER: "0",
          QIMAO_HTTP_HOST: "127.0.0.1",
          QIMAO_HTTP_PORT: "0",
          ...extraEnv,
        },
        stdio: ["ignore", "ignore", "pipe"],
      });
      httpChildren.push(child);
      let stderr = "";
      child.stderr.on("data", (b) => {
        stderr += b.toString("utf-8");
      });
      const timer = setTimeout(() => {
        child.kill();
        resolve({ code: -1, stderr: stderr + "\n（10s 未退出，已强杀）" });
      }, 10000);
      child.once("exit", (code) => {
        clearTimeout(timer);
        resolve({ code, stderr });
      });
    });
  }

  try {
    const srv = await startHttpServer();
    check("远程(--http) 启动并通告端点", /^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(srv.url), srv.url);

    const health = await fetch(new URL("/health", srv.url));
    const healthBody = await health.json().catch(() => ({}));
    check("远程 /health 免鉴权可探活", health.status === 200 && healthBody.ok === true);
    check(
      "远程 /health 版本与 package.json 一致",
      healthBody.version === PKG_VERSION,
      `实际=${healthBody.version} 期望=${PKG_VERSION}`
    );

    const noToken = await fetch(srv.url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    check("远程 配了 Token 时无 Token 请求被拒（401）", noToken.status === 401, `status=${noToken.status}`);

    const httpClient = await connectHttp(srv.url);
    const httpTools = await httpClient.listTools();
    check(`远程 走真协议列出 ${TOOL_COUNT} 个工具`, httpTools.tools.length === TOOL_COUNT, `实际=${httpTools.tools.length}`);

    let hr = parse(await httpClient.callTool({ name: "get_stats", arguments: { remote: false } }));
    check("远程 可调用只读工具", typeof hr?.local?.articles?.total === "number");

    hr = parse(await httpClient.callTool({ name: "save_article", arguments: { kind: "chapter", title: "远程冒烟", content: "远程写入。" } }));
    check("远程 带 Token 可调用写工具", typeof hr?.article?.id === "string");
    await httpClient.close();
    srv.child.kill();

    // 只读模式（QIMAO_HTTP_READONLY=1）：写工具一律拦在协议入口，只读工具照常
    const ro = await startHttpServer({ QIMAO_HTTP_READONLY: "1" });
    const roClient = await connectHttp(ro.url);
    const roTools = await roClient.listTools();
    check(`远程[只读] 工具清单不变（${TOOL_COUNT}）`, roTools.tools.length === TOOL_COUNT, `实际=${roTools.tools.length}`);

    const roStats = parse(await roClient.callTool({ name: "get_stats", arguments: { remote: false } }));
    check("远程[只读] 只读工具照常可用", typeof roStats?.local?.articles?.total === "number");

    // 浏览器已用 QIMAO_ENABLE_BROWSER=0 关闭，即使漏拦也只会报「浏览器能力已关闭」，不会触网
    const readonlyBlocked = [
      "save_article",
      "delete_article",
      "export_article",
      "update_novel",
      "import_articles_from_dir",
      "publish_short_story_qimao",
      "add_chapter_qimao",
      "create_book_qimao",
      "login_qimao",
    ];
    for (const name of readonlyBlocked) {
      let detail = "未被拦截（写操作会真的执行）";
      let blocked = false;
      try {
        await roClient.callTool({ name, arguments: {} });
      } catch (e) {
        detail = String(e?.message ?? e).slice(0, 140);
        blocked = /只读模式/.test(detail);
      }
      check(`远程[只读] 拦截写工具: ${name}`, blocked, detail);
    }
    await roClient.close();
    ro.child.kill();

    // 本机免鉴权（回环地址 + 不设 QIMAO_HTTP_TOKEN）：不再要求 Authorization
    const open = await startHttpServer({ QIMAO_HTTP_TOKEN: "" });
    check("远程[免鉴权] 启动并通告端点", /^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(open.url), open.url);
    check("远程[免鉴权] 启动日志标明「本机免鉴权」", /本机免鉴权/.test(open.stderr()), "");

    const openHealth = await fetch(new URL("/health", open.url));
    check("远程[免鉴权] /health 可探活", openHealth.status === 200);

    const openClient = await connectHttp(open.url, null);
    const openTools = await openClient.listTools();
    check(`远程[免鉴权] 不带 Authorization 也列出 ${TOOL_COUNT} 个工具`, openTools.tools.length === TOOL_COUNT, `实际=${openTools.tools.length}`);
    const openStats = parse(await openClient.callTool({ name: "get_stats", arguments: { remote: false } }));
    check("远程[免鉴权] 不带 Authorization 可调用工具", typeof openStats?.local?.articles?.total === "number");
    await openClient.close();
    open.child.kill();

    // 拒绝启动的分支：非回环地址无 Token / Token 太短
    const exposed = await runToExit({ QIMAO_HTTP_TOKEN: "", QIMAO_HTTP_HOST: "0.0.0.0" });
    check("远程[无 Token + 非回环] 拒绝启动", exposed.code !== 0, `code=${exposed.code}`);
    check(
      "远程[无 Token + 非回环] 提示改回环或补 Token",
      /非回环地址/.test(exposed.stderr) && /QIMAO_HTTP_TOKEN/.test(exposed.stderr),
      ""
    );

    const weak = await runToExit({ QIMAO_HTTP_TOKEN: "short" });
    check("远程[Token 太短] 拒绝启动", weak.code !== 0 && /太短/.test(weak.stderr), `code=${weak.code}`);
  } catch (e) {
    check("远程传输冒烟（阶段整体）", false, String(e?.message ?? e));
  }

  console.log(`\n===== 冒烟结果：${failures === 0 ? "全绿 ✅" : failures + " 项失败 ❌"} =====`);
} catch (e) {
  failures++;
  console.error("冒烟执行异常：", e);
} finally {
  for (const c of httpChildren) c.kill();
  await client.close().catch(() => {});
  fs.rmSync(TMP, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
