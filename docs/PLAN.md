# qimao-autopub-mcp 计划与决策记录（唯一真身）

七猫小说（作者后台 `https://zuozhe.qimao.com`）自动发布 MCP。
本文件是**计划与决策的唯一真身**；过程稿一律不入库。状态：v0.1.0 已跑通构建与冒烟（30 工具 / 8 资源）；**只读与写链路均已真机联调通过**（2026-10）——只读＝登录 / 状态 / 列表 / 分类标签 / 收益；写＝建书 / 改作品信息与标签 / 章节增删改与发布 / 短篇建篇·发正文·存草稿·删篇。联调用的测试数据（2 部长篇 + 3 篇短篇）已全部删除，账号回到 0 长篇 / 0 短篇。**剩余缺口见第 5 节。**

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

**前端路由**（**2026-10 真机校正过，不是猜的**）：`/front/book-manage`（长篇列表，建书入口）、`/front/book-manage/information?id=…`（作品信息页，**`?id=`**）、`/front/book-upload?id=<bookId>[&cid=<chapterId>]`（**章节编辑器**，不带 `cid` 会自动建一条空草稿）、`/front/book-manage/manage?id=…`（章节管理列表）、`/front/book-manage/draft?id=…`（草稿箱）、`/front/book-manage/short`（短故事列表，建短篇入口）、`/front/book-manage/short/information?id=…`（短篇信息页）、`/front/book-upload/short?id=…`（**短篇正文编辑器**）、`/front/book-data`、`/front/income-manage`、`/front/register-login/login`。
⚠️ 三处早期误判已修正：① `/front/book-manage/{bookId}` **不存在**；② 建书**没有独立路由**（列表页「新建小说」→「选择首发站点」弹窗 → `book/client-choose`）；③ `/front/book-upload` 是**章节编辑器**、`/front/book-upload/short` 是**短篇编辑器**，都不是建书页；查询参数一律 snake_case（`?id=` / `cid` 是编辑器例外）。

**未登录特征**：接口返回 `{"errors":{"code":"40002013","title":"登录已失效，请重新登录"}}`（`CODE_NOT_LOGGED_IN`）；其它业务错误形如 `{"errors":{"code":"40001002","title":"请求参数错误"}}`。

### 3.1 写路径真机结论（2026-10，逐条联调过）

**通用**：写操作全部走真实页面（真实鼠标 + 真实键盘）；JS 赋 `value` / `.click()` 平台**不认**（Vue 2 + 类 Element-UI 只认原生键鼠事件）。登录态下逐条验证结果如下。

**建书**（`services/book.ts:createBook`）：长篇列表页「新建小说」→「选择首发站点」弹窗（`book/client-choose`；`client_id` 1=七猫中文网 / 3=纵横中文网）→ 信息表单页 →「确认创建」→ `POST book/save-book-info` 返回 `book_id`。前端门禁 `submitBtnDisabled` 要求：书名 && 目标读者 && 一级分类 && 二级分类 && 简介 && ≥1 标签 && ≥1 主角名。书名需 `core/text.ts:cleanBookTitle` 清洗（白名单外字符会让按钮一直灰着）。

**章节**（`services/chapter.ts:writeChapter`）：`/front/book-upload?id=<bookId>[&cid=…]`。该编辑器**没有 `.el-form-item`**（不是 Element 表单），只能按结构定位：序号 `input.el-input__inner[maxlength=5]`、章节名 `textarea[placeholder*=章节名称]`、正文 `div.q-contenteditable.book`。发布链：`mode=publish`「立即发布」→ `draft-publish-confirm` 弹窗「确认发布」→「重要提醒」（「我已阅读并知晓(N)」**倒计时**）→ 再「确认发布」→ `POST /api/pc/v2/book-chapter/draft-publish`。**只点一层会「看着成功但仍是草稿」**。新章按钮是「存为草稿」、已有草稿是「更新草稿」。

**短篇**（`services/shortStory.ts`）：三条链路都验过——
1. **建篇**：短故事列表页「新建短故事」→ **直接跳** `/front/book-manage/short/information`（**没有长篇那样的站点选择弹窗**）；`client_id` 由页面写死 **5**（不在 `book/client-list` 里，分类 / 标签选项也走 `book-option?client_id=5`，故 `endpoints.ts` 新增常量 `SHORT_CLIENT_ID`）。表单 / 必填门 / 提交按钮「确认创建」与长篇**同一个组件**，复用 `fillBookInfoFields` / `readCreateFormState`。
2. **发正文 / 存草稿**：编辑器 `/front/book-upload/short?id=<bookId>`。**没有章节名输入框**（标题＝作品名，正文内小标题靠工具栏把「正文」切成「标题」样式）；字数门 **4000–70000**（`global/config` → `client_config[5].word_count[type=1]`，与页头文案一致）。按钮随状态变：新建＝`存为草稿`/`立即发布`，存过一次草稿＝`更新草稿`，已发布过＝`更新章节`。**发布必须走「智能分章」三步**：①「立即发布」→ 弹「章节格式不满足发布要求，是否智能分章？」→「开始拆分」（`book-chapter/smart-split`）；② 弹「智能分章结果」→「保存分章结果」（`book-chapter/smart-split/result-decision`，`decision_status=10`）；③ **再点一次**「立即发布」→ 平台**查重**（重复率 ≥50% 会弹「本章存在重复内容 共 N 段…」直接拦下）→ 两层确认 → `draft-publish`。`mode=draft` 只需「存为草稿」→「我已阅读并知晓」。
3. **删篇**：短故事列表页该行右侧「删除」→ 弹「作品删除提示」→ 点 **「永久删除」**（带 2s 倒计时）→ `POST /api/pc/v1/book/del-book`（`{"data":{"status":"1"}}`）。⚠️ 行内**没有 book_id**（「编辑正文」的 href 是 `javascript:void(0)`），必须先读列表拿**书名**再按书名定位行，否则误删第一行。

**成功判据（真机口径）**：① 优先抓**写接口响应**（且必须排除只读接口如 `*-list-v2` / `book-option` / `client-list` 与 `auto-save-chapter`，否则会把「列表加载 / 自动保存」当成功）；② 再**回读列表**核对（章节 / 短篇条目出现、字数变化、条目消失）。**编辑器边输入边自动保存，其响应不能当提交判据**（自动保存后列表字数仍是 0，只有显式提交才写进列表）。

**平台字数口径**：非空白字符数（含标点）。

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

1. ~~**写接口真机联调**~~ ✅ 2026-10 已完成（建书 / 作品信息与标签 / 章节增删改与发布 / 短篇建篇·发正文·存草稿·删篇，全部真机验证；详见 3.1）。
2. ~~**签名风格最终确认**~~ ✅ 已在登录态下确认 `concat` 正确，无需切换。
3. ~~**响应字段名收敛**~~ ✅ 列表类已按 `{data:{list,total,next_id}}` 收敛；详情类仍保留多命名容错 `pick()` / `extractList()`（低风险，按需收敛）。
4. ~~**短篇字数规则**~~ ✅ 已取平台权威值：**4000–70000**（`global/config` → `client_config[5].word_count[type=1]`，`SHORT_MIN_WORDS` / `SHORT_MAX_WORDS`）。**查重（重复率）仍不做预检**：由平台在发布步骤拦下，返回值带原文案。
5. ~~**`set_book_tags` 空操作**~~ ✅ 已实现（分类 / 标签落地在 `fillBookInfoFields`，建书 / 改信息 / 短篇共用）。
6. **长篇作品没有删除工具**（唯一明确缺口）：平台侧是 `POST /api/pc/v1/book/del-book` + 列表行「删除」→「永久删除」，与短篇**同一套**流程（已用一次性脚本验证过）；缺一个 `delete_book_qimao` 封装（新增工具须同步 `scripts/smoke.mjs` / `src/index.ts` / `src/core/remote.ts` 三处）。
7. **章节定时发布**（`mode=schedule`）只填时间、**时间选择器未联调**；失败会如实回报，由用户手动核对。
8. **`list_chapters_qimao` 的 `data_total` 语义**：偏「已过审条数」，**别当「已提交条数」**（待审核章节不计入；真机推测 `chapter_total`=章节条数、`draft_total`=草稿总字数）。
9. `data/` 内含有效登录 cookies，`.gitignore` 已挡；发布到 npm 时 `files` 白名单不含 `data/`。

## 6. 验证

- `npm run build`（tsc → `dist/`）
- `npm run smoke`：stdio + 远程两条链路，**全程不触网**，exit 0 = 全绿。
