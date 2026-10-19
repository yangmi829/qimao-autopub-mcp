# AGENTS.md

七猫小说作者后台（`https://zuozhe.qimao.com`）自动发布 MCP 服务：TypeScript，传输为 stdio（默认）/ Streamable HTTP（远程），30 个工具 + 8 个只读资源。
用户侧用法见 `README.md`；计划与决策真身见 `docs/PLAN.md`；**本文件只写"改这个仓库时必须知道的"**。

与姊妹项目 `../fanqie-autopub-mcp`（番茄版）的关系：架构与约定是从它复刻的，但**最大的不同是——七猫的只读接口走纯 HTTP，不需要浏览器**（签名是纯 MD5、可复现）。凡是「番茄要起浏览器才读得到」的地方，这里都能直接用 Node `fetch`。

## 命令

- `npm install` → `npm run build`（tsc → `dist/`）→ `npm run smoke`
- `npm run smoke` 是本仓库**唯一自动化验证**：以 stdio 拉起 `dist/index.js`，走真实 MCP 协议断言 30 工具 / 8 资源 / 本地工具调用（`save_article` 增改、`update_novel`、`import_articles_from_dir` 幂等导入、`check_originality`、`export_article`、资源读取…）；再以 `--http` 拉起独立进程验证远程链路（端点通告 / 版本一致 / 带 Token 时无 Token 请求 401 / 本机免鉴权下不带 Authorization 也能列 30 工具并调用 / 非回环缺 Token 与短 Token 均拒绝启动 / `QIMAO_HTTP_READONLY=1` 逐个拦截写工具）。**全程不触网**（临时 `QIMAO_DATA_DIR` + `QIMAO_ENABLE_BROWSER=0`，远程用 `QIMAO_HTTP_PORT=0` 由系统分配端口）。exit 0 = 全绿。
- **增删工具或资源后，必须同步三处**：`scripts/smoke.mjs` 的 `EXPECTED_TOOLS` / `EXPECTED_RESOURCES`、`src/index.ts` 的 `TOOL_COUNT` / `RESOURCE_COUNT`、以及 `src/core/remote.ts` 的 `WRITE_TOOLS`（若新增的是写工具）。漏一处冒烟就会失败。
- 没有测试框架（无 jest/vitest），不要去找。
- 直连 MCP 调试：`node scripts/mcp-cli.mjs --list` / `node scripts/mcp-cli.mjs <tool> key=value` / `node scripts/mcp-cli.mjs --res qimao://publish-rules`
- 运行服务：`npm start`（stdio）/ `npm run start:http`（远程，默认回环免鉴权，绑非回环需 `QIMAO_HTTP_TOKEN`）
- 环境自检：`node dist/index.js --selfcheck`（只打印 JSON 后退出，不启动传输）

## 提交前必须知道

- **`dist/` 特意入库**（`.gitignore` 里被注释掉的正是它），clone 后免 build 即可运行。改了 `src/` 就必须 `npm run build`，并把新的 `dist/` 一起提交，否则运行的是旧产物。
- `package.json` 的 `bin.qimao-autopub-mcp` 指向 `dist/index.js`。
- 依赖极简：运行时只依赖 `@modelcontextprotocol/sdk` + `zod`，浏览器驱动 `puppeteer-core` 是 **optionalDependency**（装不上时只读与本地工具照用）。
- **版本号不许写死**：`src/index.ts` 的 `SERVER_VERSION` 必须取 `core/paths.ts` 的 `PACKAGE_VERSION`（读 `package.json`）。`scripts/smoke.mjs` 有 2 条断言（stdio `getServerVersion()` 与远程 `/health` 的 `version` 都须等于 `package.json` 的 `version`）盯着这件事。
- **发布到 npm 时 `package.json` 的 `files` 是白名单**（`dist` / `README.md` / `LICENSE`）——`data/*` **绝不能**进 tarball（里面有有效登录 cookies）。`.gitignore` 只保护 git：npm 仅在既无 `files` 又无 `.npmignore` 时才回退读 `.gitignore`。改发布配置后必跑 `npm pack --dry-run --json` 核对文件清单。`prepack` 会 `npm run build`，但仓库里的 `dist/` 仍要手动同步提交。

## 运行前置

- Node ≥ 20；ESM（`"type": "module"`）。
- `puppeteer-core`（optionalDependency）+ 本机 Chrome/Edge；路径用 `QIMAO_CHROME_PATH`，否则自动探测常见安装位置。
- 只读工具需要有效登录态 `data/qimao_cookies.json`（由 `login_qimao` 生成，或 `set_qimao_cookies` 导入）。写工具还需要浏览器。**`get_publish_status` 是权威自检**：`ready=true` → 只读可用；`browser_ready=true` → 写可用。
- **改了 `src/` 后，跑着的 MCP 服务不会自动换新代码**：连接器里的 `node dist/index.js` 是启动时就把代码加载完的长驻进程，不重启就一直用旧 `dist/`（症状是「改了没生效 / 又复现了」）。改用 `node scripts/mcp-cli.mjs <tool>` 验证——那是新进程，拿到的是当前 `dist/`。

## ⚠️ 硬约束（不了解必踩坑）

1. **读写分层：只读走纯 HTTP，写接口只能驱动真实页面**。只读（列表 / 详情 / 卷 / 统计 / 收益）走 `browser/endpoints.ts` 的 `apiGet()` / `apiPostJson()`；**新增只读接口一律先进 `API` 表再走 `apiGet`**，别自己裸 `fetch`（会漏 cookies、`sign`、`pc-version` 请求头）。写接口（建书 / 改信息 / 标签 / 章节增删改 / 批量发章 / 短篇增删发）在 `services/*.ts` 里驱动真实页面。
2. **签名（`browser/endpoints.ts`）**：`secret = e4dgHJb831kSWNw4`（来自前端 bundle，可用 `QIMAO_SIGN_SECRET` 覆盖）。固定请求头 `sign = md5("AUTHORIZATION=" + secret)`；GET 参数去空 + 毫秒 `t`，按 key 排序拼 `k=v` **去掉 `&`**，整串 + secret 取 md5 作 query `sign`；POST(JSON) 用头 `b-sign = md5(JSON.stringify(body) + secret)`（body 带 `t`）。**关键坑**：签名校验发生在登录校验之后——未登录时无论签名对错都返回 `{"errors":{"code":"40002013",…}}`，所以**签名是否正确只能靠登录态联调确认**。✅ 2026-10 已用真实登录态确认 `concat` 正确（只读接口全部正常鉴权返回）。若日后被拒签，先切 `QIMAO_SIGN_STYLE=amp`（保留 `&`）再试，别一上来重写算法。
3. **写操作两段式**：默认 `confirm=false`（只读现状 + 截图，不提交），`confirm=true` 才提交。新增写工具必须沿用该约定，`publish_*` / `delete_*` 默认走预览。
4. **stdout 属于 MCP 协议**：日志只能走 stderr（`core/logger.ts`）。任何 `console.log` 都会破坏 stdio 协议。
5. **禁止 `process.cwd()`**：MCP 子进程的 cwd 不可靠；路径统一走 `core/paths.ts`（基于 `import.meta.url` 解析）。
6. **ESM + NodeNext：相对 import 必须带 `.js` 后缀**（如 `from "../core/logger.js"`），即使源文件是 `.ts`。
7. **`tsconfig` 的 `lib` 里刻意没有 DOM**：`page.evaluate` 用到的 `document` / `window` / `Event` 等由 `src/globals.d.ts` 声明为 `any`（`browser/driver.ts` 顶部也有一份）。删掉会报 TS2584 / TS2304；不要为了绕过它往 `lib` 加 `"dom"`。
8. **可选依赖必须用变量 specifier 动态 import**（见 `browser/driver.ts` 的 `const PUPPETEER = "puppeteer"`）：写死 `import "puppeteer-core"` 会让 tsc 因缺类型报 TS2307。
9. **编辑器有副作用**：章节编辑器**边输入边自动保存**，所以 `confirm=false` 时**绝不填充**（一填就可能改动线上正文），只读现状 + 截图；`confirm=true` 才填入并提交。侦察时也别反复打开「新建」类空白页（姊妹项目上这种页面会自动生成一条空草稿）。
10. **选择器与 label 候选集中管理**：地址 / 路由 / `API` 表 / 签名在 `browser/endpoints.ts`；Element-UI 表单助手（按 label 文本定位 `.el-form-item`）在 `browser/form.ts`；真实点击 / 模态读取在 `browser/page.ts`；各 `services/*.ts` 顶部的 label / 按钮候选数组是联调主要改动点。**平台改版通常只需改这些位置**；失败会自动截图到 `data/screenshots/`。
11. **`data/` 里有有效登录 cookies，绝不能提交**（`.gitignore` 用 `data/*` + `!data/.gitkeep`）。
12. **真实鼠标点击必须先 `scrollIntoView` 再取 `boundingBox`**：`boundingBox()` 给的是文档坐标，编辑页很长时直接 `page.mouse.click(box.x, box.y)` 点的是**视口外的空气**（元素看起来「没反应」，其实根本没点上）。统一用 `browser/page.ts` 的 `realClick()` / `realClickText()`。
13. **页面级文本判断会被「编辑器正文」污染**：`document.body.innerText` 包含正在编辑的稿件正文，用关键词扫整页会把正文里的词误判成页面限制。判限制 / 成功一律**只看可见模态**（`visibleModalText()`），返回里带上命中文案。
14. **远程传输（Streamable HTTP）的安全红线**：① 只有显式 `--http` / `QIMAO_TRANSPORT=http` 才开，stdio 默认路径**不许**引入 http 相关副作用（`src/index.ts` 用动态 `import("./http.js")`，别改成顶层 import）；② **回环地址免鉴权、非回环必填 Token**：`QIMAO_HTTP_HOST` 是 `127.0.0.1` / `localhost` / `::1` 时允许不设 `QIMAO_HTTP_TOKEN`（本机零配置），此时 `http.ts` 完全不校验 `Authorization`；一旦绑非回环地址，`remoteOptions()` 在缺 Token 时**必须**抛错拒绝启动（宁可起不来也不能裸奔暴露写权限），Token 给得短（<16 字符）同样拒绝。判断只能用 `isLoopback(host)`，别写死字面量；Token 比对用 `crypto.timingSafeEqual`（哈希后比，避免长度泄漏）；③ 默认只监听 `127.0.0.1`，绑非回环要告警；④ 新增写工具时**必须**确认 `core/remote.ts` 的 `isWriteTool()` 能判到它（显式名单 `WRITE_TOOLS` + 前缀正则兜底），否则 `QIMAO_HTTP_READONLY=1` 会漏；⑤ 只读拦截做在 HTTP 协议入口（`tools/call` 的 `params.name`），不改 `buildServer()`，因为 stdio 本地用法要保持全功能；⑥ `/health` 是唯一免鉴权端点，只许回最小信息，别往里塞 cookies / 路径等敏感内容；⑦ 启动日志里的 `远程端点已就绪: http://…` 一行是 `scripts/smoke.mjs` 的解析锚点，改文案要同步改冒烟正则。
15. **数据目录三级解析**（`core/paths.ts`）：`QIMAO_DATA_DIR` → `<项目根>/data`（目录存在即用，保住仓库内 / clone 的历史行为）→ `~/.qimao-autopub`（npm / npx 安装：发布包不含 `data/`，包目录在 npm 缓存里会被清）。`DATA_DIR_SOURCE` 会进启动日志与 `get_publish_status` / `--selfcheck` 的 `details`，排障先看它。**别把默认值改成「包目录」**，那等于让 npx 用户的登录态和文稿库随时蒸发。

## 只读路径现状（2026-10 已真机联调通过）

带真实登录态验证过：`get_publish_status`（`user.pen_name` / `account_id`）、`list_books_qimao` / `list_short_stories_qimao`（游标 `next_id`，空响应 `total=0`）、`list_book_options_qimao`（`book-option`，2 组男/女频、去重 405 标签）、`get_book_income_qimao` / `get_book_statistics_qimao`（无数据时字段为 `null`，接口正常）、`get_short_story_qimao`（不存在的 `book_id` 回干净错误 `读取短篇详情失败：书籍不存在`）。真机结论已回写 `browser/endpoints.ts`（路由 / `API` / 分页 / `book-option`）与 `docs/PLAN.md` 第 3 节。

**真机口径**：`/api/author/profile` **不带 `/pc/v1`**（写成 `/api/pc/v1/author/profile` 会 404）；作品列表分页是 **`next_id` 游标**（页面只发 `next_id`+`t`，响应 `{data:{list,total,next_id}}`，空串=没有下一页）；分类 / 标签走 **`book/book-option`**（`tag-list-option` 无参报 `40001002`）；查询参数一律 **snake_case**（`book_id` / `chapter_id`）。签名 `concat`（去掉 `&`）风格已在登录态下确认可用。

## 写路径现状（未真机联调，联调改动点都在这里）

写路径（**只有这部分还没真机验证**）是按前端结构"押注"写的，**label 文案 / 按钮文案 / 成功判据一律以真机为准**。工具对字段用「候选 label 列表 + 多候选按钮文案」匹配，**未命中的字段会回在结果里的 `missing`（不会静默忽略）**，改版时优先改下面这些；**路由与查询参数已按前端路由表校正，不用再猜**：

- **建书** `services/book.ts:createBook`：`/front/book-upload`。书名候选 `作品名称|书名|作品名|小说名称`，简介 `作品简介|简介|内容简介`，主角 `主角名|主角名称|主角|人物名称`，分类走 `clickInFormItem("作品分类", …)`；提交候选 `立即创建|创建作品|提交|完成`。
- **改作品信息** `services/book.ts:updateBookInfo`：`bookInfoUrl()` = `/front/book-manage/information/?book_id=…`（snake_case，**已校正**）。候选 label 同上；提交候选 `保存|提交|立即修改`。
- **章节** `services/chapter.ts:writeChapter`：`chapterEditUrl()` = `/front/book-manage/manage?book_id=…`（改章附加 `&chapter_id=…`，**已校正**；旧写法 `/front/book-manage/{bookId}` 是错的）。标题 `章节名|章节标题`，序号 `章节序号|序号`，正文优先 `.ProseMirror` / `[contenteditable='true']`，退回 label `正文|章节内容`；提交候选 `发布|提交|保存|确定`。
- **短篇** `services/shortStory.ts`：新建 `/front/book-upload/short`，信息页 `shortStoryInfoUrl()` = `/front/book-manage/short/information?book_id=…`，管理 `/front/book-manage/short`。标题 `作品名称|书名`，正文 `正文|作品正文`，分类 `分类|作品分类`；提交候选与建书 / 章节类似。
- **删除**：章节 / 短篇的删除图标**没有稳定选择器**，目前按文案点 `删除` → `确定` 兜底（真机确认后应换成稳定选择器）。

**已知缺口（联调时补齐）**：
1. **`list_chapters_qimao` 的入参未校准**：`book-chapter/list` 只传 `book_id` 会报 `40001002 请求参数错误`，说明还需卷 / 类型等参数——**必须等有真实作品后才能抓包确认**（账号当前 0 部作品）。
2. `update_book_info_qimao` 的 `plan` 里**没有分类 / 标签分支**，`input.category` 声明了但没被使用；`set_book_tags` 只是把 `category` 转发给 `updateBookInfo` —— 所以 `set_book_tags` **目前等于空操作**（既不选分类也不选标签）。真机看清「分类 / 标签」控件的 DOM 后，在 `services/book.ts` 里补实现（可选项已能从 `book/book-option` 读到）。
3. 成功判据目前只等 `成功` 文本 + 读可见模态，未必可靠；拿到真机流程后应收紧（对齐真实 toast / 跳转 / 列表回读）。
4. 详情类响应字段名仍未完全确认，保留了多命名容错 `pick()` / `extractList()`，**写路径联调时一并收敛为确定字段名**（列表类已确认 `{data:{list,total,next_id}}`）。
5. 短篇字数 `SHORT_MIN_WORDS=3000` / `SHORT_MAX_WORDS=100000` 是经验值，只软提示不硬拦；平台真实规则可从 `/api/pc/v1/global/config` 的 `client_config[id].word_count[]` 取。

## 架构

- 分层：`services/*`（业务 + 浏览器驱动，统一返回 `{ ok, message, … }`）→ `tools/*`（薄 MCP 包装，用 `core/result.ts` 的 `fromService()` 转 MCP 结果）→ `resources/*`（只读、不联网）。改行为优先落在 `services/`，`tools/` 只做参数解析与转发。
- `browser/`：`endpoints.ts`（地址 / 路由 / `API` 表 / 签名 / 纯 HTTP 客户端 / `openSession` 浏览器会话）、`driver.ts`（浏览器探测与启动、截图）、`cookies.ts`（cookies 存取与 `Cookie:` 头）、`form.ts`（Element-UI 表单助手：按 label 填 / 读 / 选）、`page.ts`（真实点击 / 清空输入 / 模态文本）。
- 入口 `src/index.ts`：`buildServer()` 注册全部工具与资源后接 `StdioServerTransport`；`--selfcheck` 只打印环境自检后退出；`--http` / `QIMAO_TRANSPORT=http` 时动态 import `src/http.ts` 起 Streamable HTTP 端点（同一份 `buildServer()`，会话按 `mcp-session-id` 管理）。
- 远程相关：`core/remote.ts`（纯配置解析 + 写工具判定，不 import SDK / http）+ `http.ts`（node:http 手写路由、Bearer 鉴权、只读拦截、信号优雅关闭），不引入 express。
- SDK 用法：`server.registerTool(name, { title, description, inputSchema: { …zodRawShape } }, handler)`（MCP SDK 1.x + zod v4）。
- 存储：`core/store.ts` 的 `Collection<T>`（JSON 原子写 tmp → rename），集合为 `novels` / `shortStories` / `articles` / `tasks`，落在 `DATA_DIR` 下的 `*.json`。文稿正文只存 `articles.json`，工具返回列表时不回传全文（`preview` 截断）。
- 纯本地能力不碰浏览器：知识数据在 `knowledge/`（`GENRES` + `renderGoldenThree()`，对应 `list_genres` 与两个资源），检测算法在 `services/originality.ts`（`check_originality`），本地登记在 `services/localNovel.ts`（`update_novel`），批量入库 / 批量发章在 `services/library.ts`。
- 测过的前端事实：组件库是「类 Element-UI」（`.el-form-item` / `.el-input__inner` / `.el-textarea__inner` / `.el-select` / `.el-dialog`）+ vxe-table + `.qm-*` / `.g-*`；路由为 `/front/…` 形态（见 `browser/endpoints.ts` 顶部）。

## Windows / PowerShell

- PowerShell 5.1 会吞掉传给 node 的 JSON 引号 → 用 `$env:MCP_ARGS='{"book_id":"123"}'` 传参，不要写 `node x.mjs t '{...}'`。
- 控制台中文可能显示乱码，但**文件内容本身是 UTF-8 正常的**，不要据此判断编码问题。
