import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fromService, fail } from "../core/result.js";
import { listChapters, uploadChapter, deleteChapter, listVolumes } from "../services/chapter.js";
import { batchPublishChapters, resolveContent, missingArticleMessage } from "../services/library.js";
import { articles, nowIso } from "../core/store.js";

export function registerChapterTools(server: McpServer): void {
  server.registerTool(
    "list_chapters_qimao",
    {
      title: "列出小说章节（含卷）",
      description:
        "读取七猫后台某本书的章节列表（标题/字数/状态/是否草稿），并顺带返回卷列表，用于复核发布结果与避免重号。只读 HTTP。" +
        "tab=all（默认）会同时拉「已发布 + 草稿」再合并——草稿也要看，否则「新建章节」自动生成的空草稿会漏掉。",
      inputSchema: {
        book_id: z.string().describe("七猫书 ID（book_id）"),
        tab: z.enum(["all", "published", "draft"]).optional().describe("拉哪个页签：all=已发布+草稿（默认），published=仅已发布，draft=仅草稿箱"),
        page: z.number().int().min(1).optional().describe("页码，从 1 开始（默认 1）"),
        page_size: z.number().int().positive().max(500).optional().describe("每页条数，默认 100"),
        volume_id: z.string().optional().describe("按卷过滤（默认 0＝全部）"),
        include_volumes: z.boolean().optional().describe("是否同时返回卷列表，默认 true"),
      },
    },
    async (args) => {
      const r = await listChapters({
        bookId: args.book_id,
        tab: args.tab,
        page: args.page,
        pageSize: args.page_size,
        volumeId: args.volume_id,
      });
      if (args.include_volumes === false) return fromService(r as any);
      const vols = await listVolumes(args.book_id).catch(() => ({ ok: false, message: "读取卷列表失败", volumes: [] as any[] }));
      return fromService({ ...r, volumes: vols.volumes, volumes_ok: vols.ok } as any);
    }
  );

  server.registerTool(
    "add_chapter_qimao",
    {
      title: "新增小说章节",
      description:
        "向指定书籍新增一个章节：填章节序号 + 标题 + 正文 →（confirm=true 时）提交。正文可用 content、file_path 或 article_id（本地文稿库）。" +
        "mode=publish（默认，立即发布，正文需 ≥1000 字）| draft（存草稿）| schedule（定时发布，配 scheduled_time）。\n" +
        "⚠️ 章节编辑器**边输入边自动保存**，所以默认 confirm=false **只打开页面读现状 + 截图，绝不输入**；confirm=true 才填入并提交。" +
        "⚠️ 不传 chapter_id 打开编辑器时，平台会自动生成一条草稿章节。",
      inputSchema: {
        book_id: z.string().describe("七猫书 ID（book_id）"),
        title: z.string().describe("章节标题（可含「第X章」，会自动剥离序号前缀）"),
        chapter_number: z.union([z.number(), z.string()]).optional().describe("章节序号（阿拉伯数字）"),
        content: z.string().optional().describe("章节正文（与 file_path/article_id 三选一）"),
        file_path: z.string().optional().describe("章节正文所在文件路径（UTF-8 文本）"),
        article_id: z.string().optional().describe("本地文稿库 article_id（优先于 file_path/content）"),
        mode: z.enum(["publish", "draft", "schedule"]).optional().describe("提交方式：publish=立即发布（默认），draft=更新草稿，schedule=定时发布"),
        scheduled_time: z.string().optional().describe("定时发布时间（yyyy-MM-dd HH:mm 或 ISO 字符串），仅 mode=schedule"),
        use_ai: z.boolean().optional().describe("「内容声明」：**默认 false＝本人原创**；显式 true 才选「含AI生成内容」。页面没有该字段时自动跳过"),
        confirm: z.boolean().optional().describe("是否真正发布，默认 false"),
        headless: z.boolean().optional().describe("是否无头运行，默认 true"),
      },
    },
    async (args) => {
      let content = args.content ?? "";
      if (args.article_id) {
        const art = await articles.get(args.article_id);
        if (!art) return fail(missingArticleMessage(args.article_id));
        content = art.content;
      } else if (!content && args.file_path) {
        try {
          content = resolveContent(undefined, args.file_path).text;
        } catch (e) {
          return fail((e as Error).message);
        }
      }
      if (!content) return fail("缺少正文：请提供 content、file_path 或 article_id。");

      const r = await uploadChapter({
        bookId: args.book_id,
        title: args.title,
        content,
        chapterNumber: args.chapter_number === undefined || args.chapter_number === "" ? undefined : Number(args.chapter_number),
        mode: args.mode,
        scheduledTime: args.scheduled_time,
        useAI: args.use_ai,
        confirm: args.confirm,
        headless: args.headless,
      });

      if (args.article_id && (r.action === "published" || r.action === "scheduled" || r.action === "drafted")) {
        await articles.update(args.article_id, {
          status: r.action === "drafted" ? "draft" : "published",
          publishTime: r.action === "drafted" ? undefined : nowIso(),
          qimaoBookId: args.book_id,
          lastMessage: r.message,
          updatedAt: nowIso(),
        });
      }
      return fromService(r as any);
    }
  );

  server.registerTool(
    "update_chapter_qimao",
    {
      title: "修改章节",
      description:
        "改已有章节的标题 / 正文（走章节编辑器 `/front/book-upload?id=…&cid=…`，按 chapter_id 定位）。正文可用 content / file_path / article_id。" +
        "mode=publish（默认）| draft（只更新草稿）| schedule（定时发布，配 scheduled_time；时间选择器未联调，失败会如实回报）。\n" +
        "⚠️ 该编辑器边输入边自动保存，所以**默认 confirm=false 只打开页面读现状 + 截图，完全不输入**；confirm=true 才填入并提交。",
      inputSchema: {
        book_id: z.string().describe("七猫书 ID（book_id）"),
        chapter_id: z.string().describe("要修改的章节 ID（从 list_chapters_qimao 取）"),
        title: z.string().describe("修改后的章节标题（会剥掉「第X章」前缀）"),
        chapter_number: z.union([z.number(), z.string()]).optional().describe("章节序号（一般不用改）"),
        content: z.string().optional().describe("修改后的正文（与 file_path/article_id 三选一）"),
        file_path: z.string().optional().describe("正文所在文件路径（UTF-8 文本）"),
        article_id: z.string().optional().describe("本地文稿库 article_id（优先）"),
        mode: z.enum(["publish", "draft", "schedule"]).optional().describe("提交方式：publish=立即发布（默认），draft=更新草稿，schedule=定时发布（配 scheduled_time）"),
        scheduled_time: z.string().optional().describe("定时发布时间（yyyy-MM-dd HH:mm 或 ISO 字符串，仅 mode=schedule）"),
        use_ai: z.boolean().optional().describe("「内容声明」：**默认 false＝本人原创**；显式 true 才选「含AI生成内容」"),
        confirm: z.boolean().optional().describe("是否真正提交修改，默认 false（只读预览）"),
        headless: z.boolean().optional().describe("是否无头运行，默认 true"),
      },
    },
    async (args) => {
      if (!String(args.title ?? "").trim()) return fail("缺少 title：改章节必须给出修改后的标题。");

      let content = args.content ?? "";
      if (args.article_id) {
        const art = await articles.get(args.article_id);
        if (!art) return fail(missingArticleMessage(args.article_id));
        content = art.content;
      } else if (!content && args.file_path) {
        try {
          content = resolveContent(undefined, args.file_path).text;
        } catch (e) {
          return fail((e as Error).message);
        }
      }

      const r = await uploadChapter({
        bookId: args.book_id,
        chapterId: args.chapter_id,
        title: args.title,
        content,
        chapterNumber: args.chapter_number === undefined || args.chapter_number === "" ? undefined : Number(args.chapter_number),
        mode: args.mode,
        scheduledTime: args.scheduled_time,
        useAI: args.use_ai,
        confirm: args.confirm,
        headless: args.headless,
      });

      if (args.article_id && r.action === "published") {
        await articles.update(args.article_id, {
          qimaoBookId: args.book_id,
          lastMessage: r.message,
          updatedAt: nowIso(),
        });
      }
      return fromService(r as any);
    }
  );

  server.registerTool(
    "delete_chapter_qimao",
    {
      title: "删除章节",
      description: "删除指定章节（破坏性）。默认 confirm=false 只预览 + 截图；confirm=true 才真正删除。",
      inputSchema: {
        book_id: z.string().describe("七猫书 ID（book_id）"),
        chapter_id: z.string().describe("要删除的章节 ID"),
        confirm: z.boolean().optional().describe("是否真正删除，默认 false"),
        headless: z.boolean().optional().describe("是否无头运行，默认 true"),
      },
    },
    async (args) =>
      fromService(
        (await deleteChapter({
          bookId: args.book_id,
          chapterId: args.chapter_id,
          confirm: args.confirm,
          headless: args.headless,
        })) as any
      )
  );

  server.registerTool(
    "batch_publish_chapters",
    {
      title: "批量上传章节",
      description:
        "从本地文稿库挑「待发布」章节，按章节号顺序限速依次上传；单章失败不中断，返回逐章结果。" +
        "confirm=false 时只演练第 1 章（填表不提交），避免在后台留下大量草稿。",
      inputSchema: {
        novel_id: z.string().optional().describe("本地小说 id（用于解析 qimaoBookId）"),
        book_id: z.string().optional().describe("七猫书 ID（与 novel_id 二选一，优先）"),
        article_ids: z.array(z.string()).optional().describe("指定要上传的 article_id 列表（缺省＝该小说下所有待发布章节）"),
        limit: z.number().int().positive().optional().describe("最多上传多少章"),
        interval_seconds: z.number().min(0).optional().describe("每章之间间隔秒数，默认 5"),
        use_ai: z.boolean().optional().describe("「内容声明」：**默认 false＝本人原创**；显式 true 才选「含AI生成内容」"),
        confirm: z.boolean().optional().describe("是否真正发布，默认 false"),
        headless: z.boolean().optional().describe("是否无头运行，默认 true"),
      },
    },
    async (args) =>
      fromService(
        (await batchPublishChapters({
          novelId: args.novel_id,
          bookId: args.book_id,
          articleIds: args.article_ids,
          limit: args.limit,
          intervalSeconds: args.interval_seconds,
          useAI: args.use_ai,
          confirm: args.confirm,
          headless: args.headless,
        })) as any
      )
  );
}
