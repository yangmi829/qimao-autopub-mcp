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
- **npm 发布凭据（2026-10-20 实操）**：`npm login` 拿到的会话 token、以及不带 bypass 的 classic/granular token 都会被拒：`403 … Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages`（`--otp=` 也救不了，registry 在验 OTP 前就按 token 类型拒）。可行解只有一个——官网 **Access Tokens → Generate New Token → Granular**：勾 **Bypass two-factor authentication**、权限 **Read and write (publish and stage)**、包选 **All Packages**（新包在「Only select packages」下拉里搜不到），有效期设最短，发完立即 revoke。
- **首版会多出一个 `0.0.0-stage` 版本**：staged publishing 机制给新包自动建的占位壳（340 B，说明写着 "Temporary package placeholder for staged publishing"），无害；`dist-tags.latest` 在几分钟内会指到真版本。发布后 `npm view <pkg> versions` 若还没看到自家版本，是 CDN 传播延迟，`npm i --prefer-online` 或等 1 分钟再试。

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
16. **发布类工具成功返回必须带「人工下一步」**：建书 / 建短篇 / 发章 / 发短篇 / 批量发布成功后，把 `core/reminders.ts` 的 `NEXT_STEP_*` 拼进 `message`——提醒用户去七猫作者后台「作品管理 → 签约」申请签约、到「章节管理 / 短故事管理」看审核结果。签约与审核只能在后台由本人操作（合同 / 实名），MCP 不做也不代做。**只在真的提交且成功的分支拼**（单次发布是 `confirm=true`，批量是 `opts.confirm` 为真），预览 / 失败不要带。

## 只读路径现状（2026-10 已真机联调通过）

带真实登录态验证过：`get_publish_status`（`user.pen_name` / `account_id`）、`list_books_qimao` / `list_short_stories_qimao`（游标 `next_id`，空响应 `total=0`）、`list_book_options_qimao`（`book-option`，2 组男/女频、去重 405 标签）、`get_book_income_qimao` / `get_book_statistics_qimao`（无数据时字段为 `null`，接口正常）、`get_short_story_qimao`（不存在的 `book_id` 回干净错误 `读取短篇详情失败：书籍不存在`）。真机结论已回写 `browser/endpoints.ts`（路由 / `API` / 分页 / `book-option`）与 `docs/PLAN.md` 第 3 节。

**真机口径**：`/api/author/profile` **不带 `/pc/v1`**（写成 `/api/pc/v1/author/profile` 会 404）；作品列表分页是 **`next_id` 游标**（页面只发 `next_id`+`t`，响应 `{data:{list,total,next_id}}`，空串=没有下一页）；分类 / 标签走 **`book/book-option`**（`tag-list-option` 无参报 `40001002`）；查询参数一律 **snake_case**（`book_id` / `chapter_id`）。签名 `concat`（去掉 `&`）风格已在登录态下确认可用。

## 写路径现状（2026-10 全部真机联调通过）

写路径驱动真实页面（真实鼠标 + 真实键盘），**已逐条联调过**；label / 按钮文案仍按「多候选 + 未命中回 `missing`」处理（平台改版时优先改这里，不要改流程）。**路由与查询参数按前端路由表 + 真机抓包校正过，不用再猜**：

- **建书** `services/book.ts:createBook`：入口是列表页「新建小说」→ **「选择首发站点」弹窗**（`client_id`：1=七猫中文网 / 3=纵横中文网）→ `POST book/save-book-info` 返回 `book_id`。必填门（前端 `submitBtnDisabled`）：书名 && 目标读者 && 一级分类 && 二级分类 && 简介 && ≥1 标签 && ≥1 主角名。书名走 `core/text.ts:cleanBookTitle` 白名单清洗（全角括号等会被平台拒 → 按钮永远灰着）。
- **改作品信息 / 标签** `services/book.ts:updateBookInfo`：`bookInfoUrl()` = `/front/book-manage/information?id=…`（**`?id=`，不是 `?book_id=`**）。分类 / 标签落地在 `fillBookInfoFields`（建书 / 改信息 / 短篇共用同一份），`set_book_tags` 不再空操作。
- **章节** `services/chapter.ts:writeChapter`：`chapterEditUrl()` = `/front/book-upload?id=<bookId>`（改章附加 `&cid=<chapterId>`）。编辑器**没有 `.el-form-item`**（不是表单结构），只能按结构定位：序号 `input.el-input__inner[maxlength=5]`、章节名 `textarea[placeholder*=章节名称]`、正文 `div.q-contenteditable.book`。提交：`mode=publish`「立即发布」（≥1000 字）→ `draft-publish-confirm` 弹窗「确认发布」→「重要提醒」里点「我已阅读并知晓」→ 再「确认发布」→ `POST /api/pc/v2/book-chapter/draft-publish`；`mode=draft`「更新草稿 / 存为草稿」。**只点一层会「看起来成功但仍是草稿」**。
  - **发布的三个硬门**（真机 2026-10 实测）：**章节名非空**、正文 ≥1000 字、**章节序号与已发布章节连续**。缺章节名时点「立即发布」**毫无反应**（连 3 秒 toast 都没有，别误判成"点击没生效"）；正常路径下点「立即发布」先发 `POST /api/pc/v1/book-chapter/draft-publish-confirm` 取弹窗数据，**真正提交才是 `POST /api/pc/v2/book-chapter/draft-publish`**——做拦截实验时别用 `/draft-publish/` 这种宽正则，会把 `-confirm` 一起 abort，症状是「点了没弹窗」且无报错。
  - **序号不连续**：平台先弹 `el-dialog.qm-dialog.abnormal-publish-dialog`「检测到章节序号不连续 当前发布章节：第1章 … 已发布上一章：第3章 …『取消』/『更正序号去发布』」，**不进**发布确认弹窗。改序号属于内容决策，`browser/page.ts:waitForPublishGate()` 只识别并原样回报（`action=aborted` + 弹窗原文 + 可点按钮），**不替用户点「更正序号去发布」**。跳号发章（比如新书先发第 5 章）会命中这里。
- **内容声明（AI）**：发布确认弹窗 `el-dialog.qm-pop` 里的「内容声明」下拉（`/api/author/global-data` → `disclaimer_type`：`本人原创`=1 / `含AI生成内容`=2，`formData.disclaimer_type` 默认 `"0"`＝未选）。`browser/page.ts:applyAiDeclaration()` 在点「确认发布」前**默认选「含AI生成内容」**（`use_ai=false` 才选「本人原创」），由 `acceptPublishConfirm(..., { useAI, onAi })` 调用；没有该字段（短篇）自动跳过。改文案只改 `AI_DECLARATION_YES/NO` 两个数组。
- **短篇** `services/shortStory.ts`：见下节（与长篇差异最大）。
- **删除**：短篇走**按书名定位行**（行内没有 `book_id`，`编辑正文` 的 href 是 `javascript:void(0)`）→ 行内「删除」→ 弹「作品删除提示」→ 点 **「永久删除」**（带 2s 倒计时，倒计时内点击无效）→ `POST /api/pc/v1/book/del-book`。

### 短篇专章（真机 2026-10）

- **建篇** `createShortStory`：短故事列表页（`/front/book-manage/short`）「新建短故事」→ **直接跳**信息表单页 `/front/book-manage/short/information`（**没有长篇那样的站点选择弹窗**）；渠道 `client_id` 由页面写死 = **5**（见 `SHORT_CLIENT_ID`，**不在 `book/client-list` 里**，分类 / 标签选项也走 `book-option?client_id=5`）。表单结构、必填门、提交按钮（「确认创建」）与长篇**同一个组件**，故复用 `fillBookInfoFields` / `readCreateFormState`。
- **发正文** `publishShortStory`：编辑器 `/front/book-upload/short?id=<bookId>`（`chapter-index` 回读 `book_info.client_id=5` 可自证）。
  - **没有章节名输入框**（标题＝作品名；正文内小标题用工具栏把「正文」切成「标题」样式），所以 `title` 在这条路径只作提示、不填充。
  - 字数门 **4000–70000**（`global/config` → `client_config[5].word_count[type=1]`，与页头文案一致）。
  - 按钮随状态变：新建＝`存为草稿` / `立即发布`；存过一次草稿＝`更新草稿`；已发布过＝`更新章节`。
  - **发布必须走「智能分章」三步**：①「立即发布」→ 弹「章节格式不满足发布要求，是否智能分章？」→「开始拆分」（`POST book-chapter/smart-split`）；② 弹「智能分章结果」（目录 01/02/…）→「保存分章结果」（`POST book-chapter/smart-split/result-decision`，`decision_status=10`）；③ **再点一次**「立即发布」→ 平台**查重**（重复率高会弹「本章存在重复内容…」直接拦下）→ 两层确认。`mode=draft` 只需「存为草稿」→「我已阅读并知晓」。
  - 成功判据：publish ＝ `draft-publish` 响应 OK **或** 回读列表字数 > 0；draft ＝ 回读列表字数 > 0 **或** toast 含「成功/已保存」。**真机口径：只有显式提交才会把字数写进列表，编辑器自动保存不会**（先自动保存再查列表，字数仍是 0）。
- **删篇** `deleteShortStory`：见上文「删除」。⚠️ 必须先读列表拿**书名**再按书名定位行，否则会误删列表第一行（行内无 `book_id`）。

### 写路径踩过的坑（照抄即可，别重蹈）

1. **JS 赋 `value` / `.click()` 平台不认**（Vue 2 + 类 Element-UI 只认原生键鼠事件）——一律用 `page.ts` 的 `realClick*` / `realTypeByJs`。
2. **`a.textContent` 精确等号匹配会失败**：行内按钮的锚点文本混着不可见字符（零宽 / 私有区图标），判「删除」「编辑正文」这类按钮要改用 `/删除/.test(text)` 的包含匹配。
3. **`textContent` 里放反引号会截断 TS 模板字符串**：往模板字符串里写「按 JS 定位」的表达式时，注释里别用反引号（TS1005 报错点会很迷惑）。
4. **`waitForText("短故事")` / `waitForText("小说")` 会被左侧菜单提前满足**，等不到列表渲染——要等列表就轮询 `document.querySelectorAll(".book-detail-wrap").length > 0`。
5. **平台弹层常带倒计时**（「我已阅读并知晓(3)」「永久删除 2s」）：倒计时内点击无效，必须轮询点到弹窗真的消失。
6. `page.on("response")` 判成功时**务必排除只读接口**（`*-list-v2` / `book-option` / `client-list`）与 `auto-save-chapter`，否则会把「列表加载 / 自动保存」当成提交成功。

### 已知缺口（还没做，不要当成已支持）

1. **长篇作品没有删除工具**（平台侧是 `POST /api/pc/v1/book/del-book` + 列表行「删除」→「永久删除」，与短篇同一套；缺一个 `delete_book_qimao` 封装）。
2. `list_chapters_qimao` 的入参是**真机校准过**的（`book_id` + 卷 / `tab`），但 `data_total` 的含义偏「已过审条数」，别当「已提交条数」（详情见函数注释）。
3. 定时发布（章节 `mode=schedule`）只填时间、**时间选择器未联调**，失败会如实回报让用户手动核对。
4. 短篇**查重（重复率）不做预检**：由平台在发布步骤拦下，返回里带原文案。

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
