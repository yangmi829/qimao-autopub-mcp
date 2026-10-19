# qimao-autopub-mcp 计划与决策记录（唯一真身）

七猫小说（作者后台 `https://zuozhe.qimao.com`）自动发布 MCP。
本文件是**计划与决策的唯一真身**；过程稿一律不入库。状态：v0.1.0 已跑通构建与冒烟（30 工具 / 8 资源）；**只读链路已真机联调通过**（登录、状态、列表、分类标签、收益接口全部带真实登录态验证）；**写接口的真机联调待用户授权**——测试账号当前 0 部长篇 + 0 部短篇，需先建一本测试书才能校准建书 / 改信息 / 章节编辑器 / 短篇页的选择器与成功判据。

## 1. 目标与非目标

**目标**：把「七猫作者后台的日常操作」收敛成一组 MCP 工具，让人（或 agent）在本机 / 内网里完成：登录、看作品与章节、建书、改作品信息与标签、上传与批量上传章节、短篇新建与发布、看数据与收益、本地文稿库与质检。

**非目标**：不做批量水军式刷量、不绕过平台审核、不代替人工过实名/人脸。

## 2. 关键决策

| 决策 | 结论 | 理由 |
| --- | --- | --- |
| 新项目位置 | `D:\番茄小说\qimao-autopub-mcp` | 与番茄项目并列；不污染番茄仓库 |
| 传输 | stdio（默认）+ Streamable HTTP（`--http`） | 复刻番茄项目成熟形态 |
| 环境变量前缀 | `QIMAO_` | 与 `FANQIE_` 彻底隔离，避免同机串味 |
| 数据目录 | `QIMAO_DATA_DIR` → `<项目根>/data` → `~/.qimao-autopub` | 与番茄一致的三级解析，clone 与 npx 两种用法都稳 |
| cookies 文件名 | `qimao_cookies.json` | 同机可能同时装两个服务 |
| 工具后缀 / 资源前缀 | `_qimao` / `qimao://` | 与番茄工具同机共存不重名 |
| 远程默认端口 | `8766` | 番茄是 8765，避开冲突 |
| **读写分层** | **只读走纯 HTTP；写接口驱动真实页面** | 七猫签名是纯 MD5、可复现 → 只读不需要浏览器；写接口有前端校验与二次确认，驱动真实页面最稳 |
| 写操作约定 | 两段式：默认 `confirm=false`（只读现状 + 截图），`confirm=true` 才提交 | 与番茄一致，防误操作 |
| 签名拼接风格 | `QIMAO_SIGN_STYLE=concat|amp`，默认 concat（去掉 `&`） | 前端 `set_url_sign` 会把排序串里的 `&` 全去掉；留开关以便联调纠偏 |

## 3. 已完成的逆向结论（2026-10 真机已校验）

**站点**：Vue SPA，接口同源 `zuozhe.qimao.com`，登录态走 cookies。

**接口前缀**：`/api/pc/v1`（o）、`/api/pc/v2`（n）、`/api/pc/v3`（i）；收益为 `/api/profit/*`；作者资料是**例外**——真实路径 `/api/author/profile`（**不带 `/pc/v1`**，带前缀会 404）。

**签名**（来自前端 bundle）：
- 固定请求头 `sign = md5("AUTHORIZATION=" + secret)`，`secret = e4dgHJb831kSWNw4`。
- GET：参数去空 → 追加毫秒时间戳 `t` → 按 key 排序拼 `k=v` → **去掉所有 `&`** → 整串 + secret 取 md5，作为 query `sign`。
- POST(JSON)：请求头 `b-sign = md5(JSON.stringify(body) + secret)`，body 带 `t`。
- POST(表单)：body 内 `sign = md5(排序拼接串 + secret)`。
- ✅ **2026-10 真机联调确认 `concat`（去掉 `&`）风格正确**：带真实登录态时所有只读接口正常鉴权返回，无需切 `amp`。（签名校验发生在登录校验之后，未登录时无法区分，所以必须靠登录态验证。）

**关键接口**（详见 `src/browser/endpoints.ts` 的 `API` 表，以下均经真机核对）：
- 作者：`/api/pc/v1/author/index`、`/api/author/profile`（笔名 `data.user.pen_name`、`data.user.account_id`、`data.user.book_list`）。~~`author/global-data`~~ 是 404 死路径，已删。
- 作品：`book/book-list-v2`、`book/book-shortstory-list-v2`、`book/create-book-over`、`book/save-book-info`、`book/edit-index`、`book/book-option`、`book/del-book`、`book/client-list`。~~`book/tag-list-option`~~ 无参会报 `40001002`，已改用 `book-option`。
- 章节：`book-chapter/list|save-chapter|auto-save-chapter|check-chapter-publish|draft-publish|draft-publish-confirm|del-chapter|volume-list|chapter-tabs-options`
- 统计：`book-statistics/book-detail|book-trend|chapter-retention|pay-data|...`
- 收益：`/api/profit/month-balance|book-date-profit|sub-detail`
- 全局：`/api/pc/v1/global/config`（短篇开关 `short_story_config.status`、各站点字数上下限 `client_config[id].word_count[]`）

**作品列表分页是游标**：页面只发 `next_id` + `t`（无 `page` / `page_size`）；响应为 `{data:{list:[],total:0,next_id:""}}`，`next_id` 为空串表示没有下一页。`list_books_qimao` / `list_short_stories_qimao` 的入参已相应改为 `next_id`。

**分类 / 标签可选项**：`book/book-option` → `data.category_list[i].tag_info[j].select_list[] = {id, tag_id, tag_name}`，`i=0/1` 对应男频/女频（`list_book_options_qimao` 实测去重后 405 个标签）。

**前端路由**（取自前端 bundle 的 vue-router 表）：`/front/book-manage`、`/front/book-manage/information/?book_id=…`（作品信息）、`/front/book-manage/manage?book_id=…[&chapter_id=…]`（章节管理 + 编辑器）、`/front/book-manage/draft?book_id=…`（草稿箱）、`/front/book-manage/short`、`/front/book-manage/short/information?book_id=…`、`/front/book-upload`、`/front/book-upload/short`、`/front/book-data`、`/front/income-manage`、`/front/register-login/login`。查询参数一律 snake_case（`book_id` / `chapter_id`）。
⚠️ 早先写成的 `/front/book-manage/{bookId}` **不存在**（已修）；`?bookId=` 驼峰写法也不再使用。

**未登录特征**：接口返回 `{"errors":{"code":"40002013","title":"登录已失效，请重新登录"}}`（`CODE_NOT_LOGGED_IN`）；其它业务错误形如 `{"errors":{"code":"40001002","title":"请求参数错误"}}`。

## 4. 工具集（30）

- **登录/状态（3）**：`login_qimao`、`set_qimao_cookies`、`get_publish_status`
- **作品（6）**：`list_books_qimao`、`create_book_qimao`、`update_book_info_qimao`、`set_book_tags`、`list_book_options_qimao`、`update_novel`
- **章节（5）**：`list_chapters_qimao`、`add_chapter_qimao`、`update_chapter_qimao`、`delete_chapter_qimao`、`batch_publish_chapters`
- **短篇（5）**：`list_short_stories_qimao`、`get_short_story_qimao`、`create_short_story_qimao`、`publish_short_story_qimao`、`delete_short_story_qimao`
- **数据/收益（2）**：`get_book_statistics_qimao`、`get_book_income_qimao`
- **文稿库（6）**：`save_article`、`list_articles`、`get_article`、`delete_article`、`export_article`、`import_articles_from_dir`
- **本地知识/质检/汇总（3）**：`check_originality`、`list_genres`、`get_stats`

**资源（8）**：`qimao://status`、`novels`、`short-stories`、`articles`、`tasks`、`publish-rules`、`genres`、`golden-three-chapters`。

## 5. 待办 / 风险

1. **写接口真机联调**（阻塞中，**需用户明确同意对其线上账号做一次写操作**）：账号当前 0 部作品，无法在无副作用前提下验证建书页 / 作品信息页 / 章节编辑器 / 短篇页的 label 文案、提交按钮文案、成功判据。最小验证路径 = 先建一本测试书 → 用真实 `book_id` 校准 `list_chapters_qimao` 入参（`book-chapter/list` 只传 `book_id` 报 `40001002`，还需其它参数）与章节编辑器路由 / 选择器。
2. ~~**签名风格最终确认**~~ ✅ 已在登录态下确认 `concat` 正确，无需切换。
3. **响应字段名收敛**：列表 / 详情字段已按真机确认的 `{data:{list,total,next_id}}` 改好；仍保留多命名容错 `pick()` / `extractList()` 的文件（详情类）待写路径联调时一并收敛。
4. **短篇字数规则**：`SHORT_MIN_WORDS/SHORT_MAX_WORDS` 目前是经验值，只做软提示；平台真实规则可从 `/api/pc/v1/global/config` 的 `client_config[id].word_count[]` 取（软提示可据此收紧）。
5. **章节编辑器自动保存**：预览模式一律不填充；联调确认「新增 vs 修改」的入口差异。
6. **`set_book_tags` 目前是空操作**：`update_book_info_qimao` 没有分类 / 标签分支；真机看清「分类 / 标签」控件 DOM 后补实现。
7. `data/` 内含有效登录 cookies，`.gitignore` 已挡；发布到 npm 时 `files` 白名单不含 `data/`。

## 6. 验证

- `npm run build`（tsc → `dist/`）
- `npm run smoke`：stdio + 远程两条链路，**全程不触网**，exit 0 = 全绿。
