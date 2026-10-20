# qimao-autopub-mcp

七猫小说作者后台（`https://zuozhe.qimao.com`）自动发布 **MCP 服务**。

TypeScript 编写，传输为 **stdio（默认）/ Streamable HTTP（远程）**，提供 **30 个工具 + 8 个只读资源**。
覆盖：登录与状态、作品列表与建书、作品信息与标签、章节增删改与批量发布、短篇作品、数据统计与收益（只读）、本地文稿库、原创度检测、赛道知识库。

> ⚠️ 本项目用于**辅助本人运营自己的七猫作者账号**：只做「把你自己写好的稿子发上去」这类重复劳动，不刷量、不绕审核、不代替人工过实名/人脸。

## 一、它和「番茄版」有什么不同

|  | 番茄版 `fanqie-autopub-mcp` | 本项目 |
| --- | --- | --- |
| 只读接口 | 必须起浏览器（带 `msToken`/`a_bogus` 签名） | **纯 HTTP 直连**（签名是纯 MD5、可复现），不需要浏览器 |
| 写接口 | 驱动真实页面 | 同样驱动真实页面 |
| 环境变量 | `FANQIE_*` | `QIMAO_*` |
| 工具后缀 / 资源前缀 | `_tomato` / `fanqie://` | `_qimao` / `qimao://` |
| 远程端口 | 8765 | 8766 |

因此：**只要有了 cookies，列表/详情/统计/收益类工具立刻可用**（这条已在真机上验证过：带真实登录态的只读接口全部正常鉴权返回）；建书、发章、发短篇这些写操作才需要本机有 Chrome/Edge。

## 二、安装

```powershell
cd D:\番茄小说\qimao-autopub-mcp
npm install
npm run build     # 生成 dist/
```

可选依赖 `puppeteer-core` 会随 `npm install` 装上；若没装上而又要用写操作：

```powershell
npm i puppeteer-core        # 配合本机 Chrome/Edge（路径自动探测，或用 QIMAO_CHROME_PATH 指定）
# 或
npm i puppeteer             # 自带 Chromium（约 150MB）
```

要求 Node ≥ 20。

## 三、接入 MCP 客户端

在客户端的 MCP 配置里加一个 stdio server，指向 `dist/index.js`：

```json
{
  "mcpServers": {
    "qimao-autopub": {
      "command": "node",
      "args": ["D:\\番茄小说\\qimao-autopub-mcp\\dist\\index.js"]
    }
  }
}
```

## 四、第一次使用

1. **登录**（二选一）
   - 让客户端调用 `login_qimao`：会弹出一个真实浏览器窗口，你**扫码 / 输短信验证码**完成登录，服务只轮询登录态并保存 cookies——全程不接触你的账号密码。
   - 或自己用浏览器插件导出 cookies，调用 `set_qimao_cookies` 导入（数组或 `{cookies:[...]}` 均可）。
2. **自检**：调用 `get_publish_status`。
   - `ready=true` → 只读工具（列表 / 统计 / 收益）可用。
   - `browser_ready=true` → 写工具（建书 / 发章 / 发短篇）可用。
3. 之后就可以用了。

## 五、工具一览（30）

### 登录与状态
| 工具 | 说明 |
| --- | --- |
| `login_qimao` | 半自动登录：弹真实浏览器，人工完成登录，服务保存 cookies |
| `set_qimao_cookies` | 手动导入 cookies（文本或文件） |
| `get_publish_status` | 环境自检：cookies / 浏览器 / 后台可达性 |

### 作品（长篇）
| 工具 | 说明 |
| --- | --- |
| `list_books_qimao` | 作品列表（真实 `book_id`，`next_id` 游标翻页）；可 `sync_local=true` 同步进本地登记 |
| `create_book_qimao` | 建书（默认只预览，`confirm=true` 才提交） |
| `update_book_info_qimao` | 改书名 / 简介 / 主角 / 分类（默认只读预览） |
| `set_book_tags` | 设置分类 / 标签（默认只填表不提交） |
| `list_book_options_qimao` | 读取分类 / 标签可选项 |
| `update_novel` | 改**本地**小说登记与创作设定（纯本地） |

### 章节
| 工具 | 说明 |
| --- | --- |
| `list_chapters_qimao` | 章节列表（顺带返回卷列表） |
| `add_chapter_qimao` | 新增章节（正文可用 `content` / `file_path` / `article_id`；支持定时；`use_ai` **默认 true＝内容声明选「含AI生成内容」**） |
| `update_chapter_qimao` | 修改章节（同样支持 `use_ai`） |
| `delete_chapter_qimao` | 删除章节（默认预览） |
| `batch_publish_chapters` | 从本地文稿库批量发章（`confirm=false` 只演练第 1 章；`use_ai` 默认 true） |

发布章节前平台有三个硬门：**章节名非空**、正文 ≥1000 字、**章节序号与已发布章节连续**。缺少章节名时点「立即发布」**毫无反应**（也没有提示），所以工具会先检查章节名；若平台弹「检测到章节序号不连续」，工具**不会**替你点「更正序号去发布」，而是返回 `action=aborted` 并附弹窗原文，由你改好章节号后重发（或用 `update_chapter_qimao` 修）。

### 短篇
| 工具 | 说明 |
| --- | --- |
| `list_short_stories_qimao` / `get_short_story_qimao` | 短篇列表 / 详情 |
| `create_short_story_qimao` | 新建短篇壳（名称 / 目标读者 / 分类 / 标签 / 主角名 / 简介；默认只预览） |
| `publish_short_story_qimao` | 发正文（`mode=publish` 立即发布 / `mode=draft` 存草稿；`use_ai` 默认 true） |
| `delete_short_story_qimao` | 删除短篇 / 草稿（默认预览；按书名定位该行再删） |

短篇与长篇的差异（已在真机上确认）：

- **短篇没有站点选择弹窗**：列表页点「新建短故事」直接进信息表单页，渠道由平台写死（`client_id=5`，不在 `book/client-list` 里）。
- **短篇没有独立的章节名**：正文编辑器里标题＝作品名，正文内小标题靠工具栏把「正文」切成「标题」样式。
- **正文字数门 4000–70000 字**（来自 `/api/pc/v1/global/config` 的 `client_config[5].word_count`，与页面文案一致）。
- **发布要过三步**：①「立即发布」→ 弹「章节格式不满足发布要求，是否智能分章？」→「开始拆分」；②「智能分章结果」→「保存分章结果」；③ 再「立即发布」→ 平台查重（重复率高会直接拦下）→ 两层确认。`mode=draft` 只需「存为草稿」。

### AI / 创作声明默认取肯定项

七猫长篇的发布确认弹窗里有「内容声明」下拉（平台配置：`本人原创` / `含AI生成内容`），代码默认值是 `0`＝**未选**。本服务在点「确认发布」之前会自动处理：

- **默认 `use_ai=true` → 选「含AI生成内容」**（平台若改文案，`是 / AI生成 / AI辅助创作 / 人工智能生成` 等同义肯定项都能命中）；
- 只有显式传 `use_ai=false` 才选「本人原创 / 否」；
- 页面没有该字段（例如短篇）时自动跳过，并在返回消息里写明 `内容声明：本页无…字段，跳过`，不当作失败。

### 数据 / 收益（只读 HTTP）
| 工具 | 说明 |
| --- | --- |
| `get_book_statistics_qimao` | 作品数据（概览 / 按日趋势） |
| `get_book_income_qimao` | 收益（月度结算 / 订阅明细 / 按书按日） |

### 本地文稿库与质检（不触网）
`save_article` / `list_articles` / `get_article` / `delete_article` / `export_article` / `import_articles_from_dir` / `check_originality` / `list_genres` / `get_stats`

## 六、只读资源（8）

| 资源 | 内容 |
| --- | --- |
| `qimao://status` | 登录与环境状态 |
| `qimao://novels` | 本地小说登记 |
| `qimao://short-stories` | 本地短篇登记 |
| `qimao://articles` | 本地文稿库（不含正文全文） |
| `qimao://tasks` | 发布任务日志 |
| `qimao://publish-rules` | 发布限制须知（读写边界 / 短篇字数 / 定时范围） |
| `qimao://genres` | 网文赛道知识库 |
| `qimao://golden-three-chapters` | 黄金三章方法论 |

## 七、写操作是「两段式」的

所有会产生线上变更的工具，默认 `confirm=false`：

1. 第一次调用：**只打开页面读现状 + 截图，什么都不改**，返回现状与截图路径；
2. 你确认无误后，再传 `confirm=true`，它才会真正填表并提交。

章节编辑器**边输入边自动保存**，所以它的预览模式**绝不填充**（一填就可能改动线上正文）。

## 八、远程模式（可选）

```powershell
$env:QIMAO_HTTP_TOKEN = "至少16位的强随机串"
npm run start:http
```

- 默认只监听 `127.0.0.1`。**回环地址免鉴权**（本机零配置）；一旦绑非回环地址（`QIMAO_HTTP_HOST=0.0.0.0`），**必须**配 `QIMAO_HTTP_TOKEN`，否则拒绝启动。
- `QIMAO_HTTP_READONLY=1` 可让远程端点只留只读能力（本地 stdio 不受影响）。
- `/health` 是唯一免鉴权端点（只回最小信息）。

## 九、开发与验证

```powershell
npm run build          # tsc → dist/
npm run smoke          # 唯一自动化验证：stdio + 远程两条链路，全程不触网，exit 0 = 全绿
node scripts/mcp-cli.mjs --list
node scripts/mcp-cli.mjs get_stats '{"remote":false}'
node scripts/mcp-cli.mjs --res qimao://publish-rules
```

开发约定见 `AGENTS.md`；计划与决策见 `docs/PLAN.md`。

## 十、环境变量

全部可省略，见 `.env.example`。常用：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `QIMAO_DATA_DIR` | 项目根 `data/` 或 `~/.qimao-autopub` | cookies / 文稿 / 截图所在 |
| `QIMAO_ENABLE_BROWSER` | `1` | 设 `0` 彻底禁用浏览器（只读 + 本地工具仍可用） |
| `QIMAO_CHROME_PATH` | 自动探测 | Chrome/Edge 可执行文件路径 |
| `QIMAO_SIGN_STYLE` | `concat` | 签名拼接风格，联调纠偏用 |
| `QIMAO_DEBUG` | 关 | 设 `1` 输出 debug 日志 |

## 十一、已知限制

- **读与写都已在真机上联调通过**（2026-10）：只读＝登录 / 状态 / 作品与短篇列表 / 分类标签 / 数据统计 / 收益；写＝建书 / 改作品信息与标签 / 章节增删改与发布 / 短篇建篇·发正文·删篇。
- 写工具仍按「候选 label / 候选按钮文案」匹配平台控件，**未命中的字段会回在返回值的 `missing` 里**（不会静默忽略）——平台改版时先看它。
- **作品列表分页是游标**：`list_books_qimao` / `list_short_stories_qimao` 用 `next_id` 翻页（不是 `page_index`），响应里的 `next_id` 为空表示没有下一页。
- **长篇的书没有删除工具**（只有章节 / 短篇能删）；平台侧对应 `POST /api/pc/v1/book/del-book`，需要时走小说列表页每行的「删除」→「永久删除」。
- 短篇字数门取平台配置（4000–70000），但**查重（重复率）不预检**：重复率过高时平台会在发布步骤直接拦下，返回值里会带上原文案。
- 平台改版后，优先改 `src/browser/endpoints.ts`（路由 / 接口 / 签名）与各 `src/services/*.ts` 里的选择器 / label 候选数组。

## License

MIT
