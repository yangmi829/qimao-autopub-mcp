import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, fail, fromService } from "../core/result.js";
import { listBooks, createBook, setBookTags, updateBookInfo, listBookOptions } from "../services/book.js";
import { updateNovel } from "../services/localNovel.js";
import { novels, newId, nowIso } from "../core/store.js";

const tagShape = z.array(z.string()).optional();

export function registerBookTools(server: McpServer): void {
  server.registerTool(
    "list_books_qimao",
    {
      title: "列出七猫作品",
      description:
        "读取作者后台真实作品列表（拿真实 book_id）：kind=long 读长篇（默认），kind=short 读短篇。" +
        "分页是游标式——把返回里的 next_id 再传回来取下一页。可把结果同步进本地小说登记（sync_local=true，仅 kind=long）。只读 HTTP、不需要浏览器。",
      inputSchema: {
        kind: z.enum(["long", "short"]).optional().describe("long=长篇（默认），short=短篇"),
        next_id: z.string().optional().describe("分页游标：传上一次返回的 next_id 取下一页；不传＝第一页"),
        sync_local: z.boolean().optional().describe("是否把后台作品同步为本地小说登记（默认 false，仅 kind=long）"),
      },
    },
    async (args) => {
      const kind = args.kind ?? "long";
      const r = await listBooks({ kind, nextId: args.next_id });
      if (!r.ok) return fail(r.message);
      if (!args.sync_local || kind !== "long") return ok(r);

      const existing = await novels.all();
      let added = 0;
      for (const b of r.books ?? []) {
        if (!b.bookId || existing.some((n) => n.qimaoBookId === b.bookId)) continue;
        const now = nowIso();
        await novels.insert({
          id: newId("nov"),
          title: b.bookName,
          gender: 1,
          qimaoBookId: b.bookId,
          qimaoBookName: b.bookName,
          createdAt: now,
          updatedAt: now,
        });
        added++;
      }
      return ok({ ...r, synced_local: added });
    }
  );

  server.registerTool(
    "create_book_qimao",
    {
      title: "新建作品（建书）",
      description:
        "在七猫作者后台驱动真实建书页填表并提交。必填 book_name；可选 gender（1=男频 0=女频）、abstract、主角名、category。\n" +
        "⚠️ 七猫建书页的字段 label / 必填项以真机为准：本工具按 label 文本匹配填表，未命中的字段会回在 missing 里（不静默忽略）。\n" +
        "默认 confirm=false 只打开建书页读现状 + 截图，不填不提交；confirm=true 才填表并点提交。",
      inputSchema: {
        book_name: z.string().describe("书名（必填）"),
        gender: z.number().int().min(0).max(1).optional().describe("频道：1=男频，0=女频"),
        abstract: z.string().optional().describe("作品简介"),
        protagonist1: z.string().optional().describe("主角名1"),
        protagonist2: z.string().optional().describe("主角名2"),
        category: z.string().optional().describe("作品分类（一级/二级名称，以 list_book_options_qimao 为准）"),
        tags: tagShape.describe("作品标签"),
        confirm: z.boolean().optional().describe("是否真正提交建书，默认 false"),
        headless: z.boolean().optional().describe("是否无头运行，默认 true"),
        register_local: z.boolean().optional().describe("建书成功后是否登记到本地小说（默认 true）"),
      },
    },
    async (args) => {
      const r = await createBook({
        bookName: args.book_name,
        gender: args.gender,
        abstract: args.abstract,
        protagonist1: args.protagonist1,
        protagonist2: args.protagonist2,
        category: args.category,
        tags: args.tags,
        confirm: args.confirm,
        headless: args.headless,
      });
      if (r.ok && r.action === "created" && args.register_local !== false) {
        const now = nowIso();
        await novels.insert({
          id: newId("nov"),
          title: args.book_name,
          gender: args.gender ?? 1,
          abstract: args.abstract,
          protagonist1: args.protagonist1,
          protagonist2: args.protagonist2,
          category: args.category,
          tags: args.tags,
          createdAt: now,
          updatedAt: now,
        });
      }
      return fromService(r as any);
    }
  );

  server.registerTool(
    "update_book_info_qimao",
    {
      title: "修改已有作品信息（书名 / 简介 / 主角 / 分类）",
      description:
        "改已有作品的名称 / 简介 / 主角名 / 分类。走作品信息页；只覆盖显式传入的字段。\n" +
        "⚠️ 默认 confirm=false 只打开作品信息页**读现状 + 截图，完全不填充**（避免误改线上）；confirm=true 才填表并保存。\n" +
        "改书名 / 简介可能触发重新审核、影响曝光，请谨慎。",
      inputSchema: {
        book_id: z.string().describe("七猫书 ID（book_id）"),
        book_name: z.string().optional().describe("作品名称（不给＝不改）"),
        abstract: z.string().optional().describe("作品简介（不给＝不改）"),
        protagonist1: z.string().optional().describe("主角名1（不给＝不改）"),
        protagonist2: z.string().optional().describe("主角名2（不给＝不改）"),
        category: z.string().optional().describe("作品分类（不给＝不改）"),
        confirm: z.boolean().optional().describe("是否真正提交，默认 false（只读预览）"),
        headless: z.boolean().optional().describe("是否无头运行，默认 true"),
      },
    },
    async (args) => {
      const r = await updateBookInfo({
        bookId: args.book_id,
        bookName: args.book_name,
        abstract: args.abstract,
        protagonist1: args.protagonist1,
        protagonist2: args.protagonist2,
        category: args.category,
        confirm: args.confirm,
        headless: args.headless,
      });
      if (r.action === "preview") return ok(r as any);
      return fromService(r as any);
    }
  );

  server.registerTool(
    "set_book_tags",
    {
      title: "设置作品标签",
      description:
        "为已有作品设置分类 / 标签（复用 update_book_info_qimao 的页面链路）。语义是「确保这些标签处于选中」，已选中的会跳过。\n" +
        "默认 confirm=false 只打开页面填表 + 截图（不提交）；confirm=true 才保存。",
      inputSchema: {
        book_id: z.string().describe("七猫书 ID"),
        category: z.string().optional().describe("作品分类（确保处于选中状态）"),
        tags: tagShape.describe("作品标签（确保处于选中状态）"),
        confirm: z.boolean().optional().describe("是否真正提交，默认 false"),
        headless: z.boolean().optional().describe("是否无头运行，默认 true"),
      },
    },
    async (args) => {
      if (!args.category && !(args.tags?.length)) return fail("请至少提供 category 或 tags。");
      const r = await setBookTags({
        bookId: args.book_id,
        category: args.category,
        tags: args.tags,
        confirm: args.confirm,
        headless: args.headless,
      });
      if (r.action === "preview") return ok(r as any);
      return fromService(r as any);
    }
  );

  server.registerTool(
    "list_book_options_qimao",
    {
      title: "列出作品分类 / 标签选项",
      description: "读取七猫后台的作品分类与标签可选项（只读 HTTP），供建书 / 改作品信息时选值。",
      inputSchema: {},
    },
    async () => fromService((await listBookOptions()) as any)
  );

  server.registerTool(
    "update_novel",
    {
      title: "修改本地小说登记 / 创作设定",
      description:
        "改本地小说登记（data/novels.json）的登记信息与创作设定：书名、频道、简介、主角名、分类/标签、七猫书号绑定，" +
        "以及 genre/synopsis/outline/world_setting/golden_hook/characters/target_words_per_chapter/status 等创作字段。" +
        "只覆盖显式传入的字段，未传的保持原值。长文本（大纲/世界观等）可用 *_file 指到磁盘文件。" +
        "**纯本地，不改动七猫后台**；阅读用资源 qimao://novels。",
      inputSchema: {
        novel_id: z.string().describe("本地小说 id（nov_xxx）"),
        title: z.string().optional().describe("书名"),
        gender: z.number().int().min(0).max(1).optional().describe("频道：1=男频，0=女频"),
        author: z.string().optional().describe("作者名"),
        abstract: z.string().optional().describe("作品简介"),
        protagonist1: z.string().optional().describe("主角名1"),
        protagonist2: z.string().optional().describe("主角名2"),
        category: z.string().optional().describe("七猫作品分类"),
        tags: tagShape.describe("作品标签"),
        qimao_book_id: z.string().optional().describe("七猫 book_id（绑定用）"),
        qimao_book_name: z.string().optional().describe("七猫书名"),
        genre: z.string().optional().describe("赛道 key（参见 list_genres）"),
        synopsis: z.string().optional().describe("一句话简介 / 核心卖点"),
        outline: z.string().optional().describe("全书大纲（长文本建议改用 outline_file）"),
        world_setting: z.string().optional().describe("世界观设定（长文本建议改用 world_setting_file）"),
        golden_hook: z.string().optional().describe("开篇钩子"),
        characters: z
          .array(z.object({ name: z.string(), role: z.string().optional(), traits: z.string().optional() }))
          .optional()
          .describe("主要人物设定"),
        target_words_per_chapter: z.number().int().optional().describe("单章目标字数"),
        status: z.string().optional().describe("本地创作状态标记（如 连载中/已完结）"),
        synopsis_file: z.string().optional().describe("synopsis 的文本文件路径"),
        outline_file: z.string().optional().describe("outline 的文本文件路径（如 大纲.md）"),
        world_setting_file: z.string().optional().describe("world_setting 的文本文件路径"),
        golden_hook_file: z.string().optional().describe("golden_hook 的文本文件路径"),
        characters_file: z.string().optional().describe("characters 的 JSON 文件路径：[{name,role?,traits?}]"),
      },
    },
    async (args) => {
      const r = await updateNovel({
        novelId: args.novel_id,
        title: args.title,
        gender: args.gender,
        author: args.author,
        abstract: args.abstract,
        protagonist1: args.protagonist1,
        protagonist2: args.protagonist2,
        category: args.category,
        tags: args.tags,
        qimaoBookId: args.qimao_book_id,
        qimaoBookName: args.qimao_book_name,
        genre: args.genre,
        synopsis: args.synopsis,
        outline: args.outline,
        worldSetting: args.world_setting,
        goldenHook: args.golden_hook,
        characters: args.characters,
        targetWordsPerChapter: args.target_words_per_chapter,
        status: args.status,
        synopsisFile: args.synopsis_file,
        outlineFile: args.outline_file,
        worldSettingFile: args.world_setting_file,
        goldenHookFile: args.golden_hook_file,
        charactersFile: args.characters_file,
      });
      if (!r.ok) return fail(r.message);
      // 只回摘要：大纲等长字段不往响应里塞
      return ok({
        ok: true,
        action: r.action,
        message: r.message,
        novel_id: r.novel?.id,
        title: r.novel?.title,
        changed: r.changed,
        wordCounts: r.wordCounts,
      });
    }
  );
}
