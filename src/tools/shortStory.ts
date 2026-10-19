import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fromService, fail } from "../core/result.js";
import {
  listShortStories,
  getShortStory,
  createShortStory,
  publishShortStory,
  deleteShortStory,
  SHORT_MIN_WORDS,
  SHORT_MAX_WORDS,
  SHORT_BEST_RANGE,
} from "../services/shortStory.js";
import { articles, nowIso } from "../core/store.js";
import { resolveContent } from "../services/library.js";

/** article_id / file_path / content 三选一取正文 */
async function pickContent(args: { content?: string; file_path?: string; article_id?: string }): Promise<string> {
  if (args.article_id) {
    const art = await articles.get(args.article_id);
    if (!art) throw new Error(`本地文稿库未找到 article_id=${args.article_id}`);
    return art.content;
  }
  if (args.content) return args.content;
  if (args.file_path) return resolveContent(undefined, args.file_path).text;
  return "";
}

export function registerShortStoryTools(server: McpServer): void {
  server.registerTool(
    "list_short_stories_qimao",
    {
      title: "列出短篇作品",
      description:
        "读取七猫作者后台的短篇作品列表（book_id / 标题 / 字数 / 状态）。只读 HTTP。" +
        "分页是游标式——把返回里的 next_id 再传回来取下一页。",
      inputSchema: {
        next_id: z.string().optional().describe("分页游标：传上一次返回的 next_id 取下一页；不传＝第一页"),
      },
    },
    async (args) => fromService((await listShortStories({ nextId: args.next_id })) as any)
  );

  server.registerTool(
    "get_short_story_qimao",
    {
      title: "读取短篇详情",
      description: "读取某篇短篇作品的标题 / 字数 / 分类 / 状态等（只读 HTTP）。",
      inputSchema: { book_id: z.string().describe("短篇 book_id") },
    },
    async ({ book_id }) => fromService((await getShortStory(book_id)) as any)
  );

  server.registerTool(
    "create_short_story_qimao",
    {
      title: "新建短篇作品",
      description:
        `在七猫短故事管理页驱动真实创建流程：列表页「新建短故事」→ 信息表单（目标读者/作品类型/标签/主角名/简介）→ 确认创建。` +
        `⚠️ 真机确认：短篇创建**没有站点选择弹窗**，点「新建短故事」直接跳信息表单页；短篇渠道由平台写死（client_id=5）。` +
        `⚠️ **只建「短篇壳」**；正文请建好后再用 publish_short_story_qimao（带 book_id）发布。\n` +
        `未传的必填项会兜底填默认值（简介/主角名/标签），必填门＝作品名+目标读者+一级分类+二级分类+简介+至少1个标签+至少1个主角名。\n` +
        `⚠️ 分类名**未匹配会中止报错**（不会静默改成别的分类）；短篇分类请先用 list_book_options_qimao(client_id="5") 查准确名称。\n` +
        `经验字数区间 ${SHORT_MIN_WORDS}–${SHORT_MAX_WORDS} 字（最佳 ${SHORT_BEST_RANGE}，以平台实际规则为准，本工具只提示不硬拦）。\n` +
        `默认 confirm=false 只打开短故事管理页 + 截图，不点按钮不填表；confirm=true 才真正创建。`,
      inputSchema: {
        title: z.string().describe("作品名称（必填，最多 18 字，平台字符白名单会清洗）"),
        gender: z.number().optional().describe("目标读者：1=男生为主（默认），0=女生为主"),
        content: z.string().optional().describe("正文（仅用于字数提示；本工具不写正文）"),
        file_path: z.string().optional().describe("正文文件路径（仅用于字数提示）"),
        article_id: z.string().optional().describe("本地文稿库 article_id（仅用于字数提示）"),
        category: z.string().optional().describe("一级分类名称（**未匹配即中止**，不再静默取第一个；先用 list_book_options_qimao(client_id=\"5\") 查）"),
        category_sub: z.string().optional().describe("二级分类名称（同上：未匹配即中止）"),
        tags: z.array(z.string()).optional().describe("标签名称，按分组顺序取用；缺省时每个分组各取第一个"),
        abstract: z.string().optional().describe("作品简介"),
        protagonist1: z.string().optional().describe("主角名（缺省填「主角」）"),
        client_id: z.string().optional().describe("短篇渠道 client_id（真机确认短篇创建页写死为 5，此参数仅作记录；站点无法在此选择）"),
        confirm: z.boolean().optional().describe("是否真正提交，默认 false"),
        headless: z.boolean().optional().describe("是否无头运行，默认 true"),
      },
    },
    async (args) => {
      let content = "";
      try {
        content = await pickContent(args);
      } catch (e) {
        return fail((e as Error).message);
      }
      const r = await createShortStory({
        title: args.title,
        content,
        category: args.category,
        categorySub: args.category_sub,
        tags: args.tags,
        gender: args.gender,
        clientId: args.client_id,
        abstract: args.abstract,
        protagonist1: args.protagonist1,
        confirm: args.confirm,
        headless: args.headless,
      });
      if (args.article_id && r.ok && r.action !== "error") {
        await articles.update(args.article_id, { lastMessage: r.message, updatedAt: nowIso() });
      }
      return fromService(r as any);
    }
  );

  server.registerTool(
    "publish_short_story_qimao",
    {
      title: "发布短篇作品",
      description:
        `发布短篇正文：给 book_id → 打开该篇的**短篇正文编辑器**（/front/book-upload/short?id=…）填入正文并发布；` +
        `不给 book_id（给 title）→ 先走「新建短篇」流程建壳。正文可用 content/file_path/article_id。\n` +
        `真机事实：短篇编辑器**没有章节名输入框**（标题＝作品名，正文内小标题用工具栏「标题」样式），` +
        `故 title 在发布路径只作提示；按钮是「存为草稿」/「立即发布」；发布要过两层确认（确认发布 → 我已阅读并知晓 → 确认发布）。\n` +
        `平台字数门：正文 ${SHORT_MIN_WORDS}–${SHORT_MAX_WORDS} 字（低于下限时 mode=publish 会直接不提交，可改 mode=draft）。\n` +
        `⚠️ 编辑器边输入边自动保存，所以默认 confirm=false **只打开页面读现状 + 截图，绝不填充**；confirm=true 才填入并提交。`,
      inputSchema: {
        book_id: z.string().optional().describe("要发布的短篇 book_id（与 title 二选一）"),
        title: z.string().optional().describe("作品名称（配合 content 新建并发布；发布已有短篇时该参数不会写入正文）"),
        content: z.string().optional().describe("正文（与 file_path/article_id 三选一）"),
        file_path: z.string().optional(),
        article_id: z.string().optional(),
        mode: z.enum(["publish", "draft"]).optional().describe("publish＝立即发布（默认，需 ≥4000 字），draft＝存为草稿"),
        category: z.string().optional().describe("一级分类名称（新建时用）"),
        category_sub: z.string().optional().describe("二级分类名称（新建时用）"),
        tags: z.array(z.string()).optional().describe("标签名称，按分组顺序取用（新建时用）"),
        gender: z.number().optional().describe("目标读者：1=男生为主（默认），0=女生为主（新建时用）"),
        client_id: z.string().optional().describe("短篇渠道 client_id（真机确认写死为 5，仅作记录）"),
        abstract: z.string().optional().describe("作品简介（新建时用）"),
        protagonist1: z.string().optional().describe("主角名（新建时用）"),
        confirm: z.boolean().optional().describe("是否真正发布，默认 false"),
        headless: z.boolean().optional().describe("是否无头运行，默认 true"),
      },
    },
    async (args) => {
      if (!args.book_id && !args.title) return fail("需提供 book_id，或 title（+content）以新建并发布。");
      let content = "";
      try {
        content = await pickContent(args);
      } catch (e) {
        return fail((e as Error).message);
      }
      const r = await publishShortStory({
        bookId: args.book_id,
        title: args.title,
        content,
        mode: args.mode,
        category: args.category,
        categorySub: args.category_sub,
        tags: args.tags,
        gender: args.gender,
        clientId: args.client_id,
        abstract: args.abstract,
        protagonist1: args.protagonist1,
        confirm: args.confirm,
        headless: args.headless,
      });
      if (args.article_id && r.ok && r.action === "published") {
        await articles.update(args.article_id, {
          status: "published",
          qimaoBookId: r.bookId ?? args.book_id,
          lastMessage: r.message,
          updatedAt: nowIso(),
        });
      }
      return fromService(r as any);
    }
  );

  server.registerTool(
    "delete_short_story_qimao",
    {
      title: "删除短篇作品 / 草稿",
      description: "删除指定短篇作品或草稿（破坏性）。默认 confirm=false 只预览；confirm=true 才真正删除。",
      inputSchema: {
        book_id: z.string().describe("短篇 book_id"),
        confirm: z.boolean().optional().describe("是否真正删除，默认 false"),
        headless: z.boolean().optional().describe("是否无头运行，默认 true"),
      },
    },
    async (args) => fromService((await deleteShortStory(args.book_id, { confirm: args.confirm, headless: args.headless })) as any)
  );
}
