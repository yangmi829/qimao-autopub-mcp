import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, fail, fromService } from "../core/result.js";
import { saveArticle, listArticles, getArticle, deleteArticle, exportArticle, checkOriginality, importArticlesFromDir } from "../services/library.js";

export function registerLibraryTools(server: McpServer): void {
  server.registerTool(
    "save_article",
    {
      title: "保存 / 更新本地文稿",
      description:
        "把正文入库（data/articles.json），返回 article_id，避免把长文本反复塞进工具参数。" +
        "不传 article_id = 新建；传 article_id = 改已有条目（只覆盖显式传入的字段，标题/正文/章节号/状态/绑定 id 都能改）。" +
        "kind=chapter 可带 novel_id/chapter_number；kind=short 用于短篇。正文可用 content 或 file_path。",
      inputSchema: {
        article_id: z.string().optional().describe("要修改的本地文稿 article_id；不传则新建"),
        kind: z.enum(["chapter", "short"]).optional().describe("chapter=小说章节，short=短篇正文（新建时默认 chapter）"),
        title: z.string().optional().describe("标题（新建时必填）"),
        content: z.string().optional().describe("正文（与 file_path 二选一）"),
        file_path: z.string().optional().describe("正文文件路径（UTF-8 文本）"),
        novel_id: z.string().optional().describe("归属的本地小说 id（kind=chapter）"),
        chapter_number: z.number().int().optional().describe("章节号（kind=chapter）"),
        status: z.enum(["draft", "published", "failed"]).optional().describe("初始状态，默认 draft"),
        qimao_book_id: z.string().optional().describe("已绑定的七猫 book_id（可选）"),
      },
    },
    async (args) =>
      fromService(
        (await saveArticle({
          articleId: args.article_id,
          kind: args.kind,
          title: args.title,
          content: args.content,
          filePath: args.file_path,
          novelId: args.novel_id,
          chapterNumber: args.chapter_number,
          status: args.status,
          qimaoBookId: args.qimao_book_id,
        })) as any
      )
  );

  server.registerTool(
    "list_articles",
    {
      title: "列出本地文稿",
      description: "按 kind / novel_id / status 过滤列出本地文稿库条目（不含正文全文）。",
      inputSchema: {
        kind: z.enum(["chapter", "short"]).optional(),
        novel_id: z.string().optional(),
        status: z.enum(["draft", "published", "failed"]).optional(),
      },
    },
    async (args) => {
      const items = await listArticles({ kind: args.kind, novelId: args.novel_id, status: args.status });
      return ok({
        total: items.length,
        articles: items.map(({ content, ...rest }) => ({ ...rest, preview: content.slice(0, 60) })),
      });
    }
  );

  server.registerTool(
    "get_article",
    {
      title: "读取本地文稿",
      description: "按 article_id 取回本地文稿全文（含正文）。",
      inputSchema: { article_id: z.string().describe("本地文稿 article_id") },
    },
    async ({ article_id }) => {
      const art = await getArticle(article_id);
      if (!art) return fail(`未找到 article_id=${article_id}`);
      return ok(art);
    }
  );

  server.registerTool(
    "delete_article",
    {
      title: "删除本地文稿",
      description: "删除本地文稿库条目（不影响七猫后台）。默认 confirm=false 只预览。",
      inputSchema: {
        article_id: z.string().describe("本地文稿 article_id"),
        confirm: z.boolean().optional().describe("是否真正删除，默认 false"),
      },
    },
    async ({ article_id, confirm }) => fromService((await deleteArticle(article_id, confirm)) as any)
  );

  server.registerTool(
    "export_article",
    {
      title: "导出本地文稿为文本",
      description:
        "把本地文稿导出成可直接粘贴到七猫作者后台的文本文件（txt/md），返回绝对路径。适合人工发布流程。默认带书名抬头；不联网。",
      inputSchema: {
        article_id: z.string().describe("本地文稿 article_id"),
        format: z.enum(["txt", "md"]).optional().describe("导出格式，默认 txt"),
        include_novel_title: z.boolean().optional().describe("是否在文件头带上所属书名，默认 true"),
        export_dir: z.string().optional().describe("自定义导出目录，省略则用 data/export"),
      },
    },
    async ({ article_id, format, include_novel_title, export_dir }) =>
      fromService(
        (await exportArticle({
          articleId: article_id,
          format,
          includeNovelTitle: include_novel_title,
          exportDir: export_dir,
        })) as any
      )
  );

  server.registerTool(
    "check_originality",
    {
      title: "原创性 / AI 味检测",
      description:
        "本地原创性检测：与文稿库其它条目做 n-gram 相似度比对，同时检查自我复读、套话密度、对话占比、段落均匀度、字数是否达日更门槛。" +
        "不联网、不消耗额度。用 article_id 或直接传 content。",
      inputSchema: {
        article_id: z.string().optional().describe("本地文稿 article_id（与 content 二选一）"),
        content: z.string().optional().describe("待检测正文（与 article_id 二选一）"),
        threshold: z.number().optional().describe("相似度阈值，默认 0.25，越低越严格"),
      },
    },
    async ({ article_id, content, threshold }) =>
      fromService((await checkOriginality({ articleId: article_id, content, threshold })) as any)
  );

  server.registerTool(
    "import_articles_from_dir",
    {
      title: "从磁盘工作稿批量入库 / 更新",
      description:
        "把磁盘上的章节稿（`小说/<书名>_<书号>/章节/第NN章_标题.md`）批量同步进本地文稿库。" +
        "章节号与标题优先取文内「# 第N章 标题」，文件名作回退；`> **本章概要**` 之类的元信息块与 markdown 标记会被剥掉。" +
        "已存在（同小说 + 同章节号）默认覆盖正文但保留其状态/发布时间。纯本地、不触网。" +
        "dir 省略时按 novel_id 推断工作稿目录。默认 confirm=false 只预览。",
      inputSchema: {
        dir: z.string().optional().describe("章节稿目录（可含子目录 章节/）；省略则按 novel_id 推断"),
        novel_id: z.string().optional().describe("归属的本地小说 id（用于匹配已存在章节与推断目录）"),
        kind: z.enum(["chapter", "short"]).optional().describe("默认 chapter"),
        status: z.enum(["draft", "published", "failed"]).optional().describe("新建条目的状态，默认 draft"),
        update_existing: z.boolean().optional().describe("已存在章节是否覆盖正文，默认 true"),
        confirm: z.boolean().optional().describe("是否真正写入，默认 false（只预览）"),
      },
    },
    async (args) =>
      fromService(
        (await importArticlesFromDir({
          dir: args.dir,
          novelId: args.novel_id,
          kind: args.kind,
          status: args.status,
          updateExisting: args.update_existing,
          confirm: args.confirm,
        })) as any
      )
  );
}
