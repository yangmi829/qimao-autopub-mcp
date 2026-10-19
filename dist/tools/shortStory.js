import { z } from "zod";
import { fromService, fail } from "../core/result.js";
import { listShortStories, getShortStory, createShortStory, publishShortStory, deleteShortStory, SHORT_MIN_WORDS, SHORT_MAX_WORDS, SHORT_BEST_RANGE, } from "../services/shortStory.js";
import { articles, nowIso } from "../core/store.js";
import { resolveContent } from "../services/library.js";
/** article_id / file_path / content 三选一取正文 */
async function pickContent(args) {
    if (args.article_id) {
        const art = await articles.get(args.article_id);
        if (!art)
            throw new Error(`本地文稿库未找到 article_id=${args.article_id}`);
        return art.content;
    }
    if (args.content)
        return args.content;
    if (args.file_path)
        return resolveContent(undefined, args.file_path).text;
    return "";
}
export function registerShortStoryTools(server) {
    server.registerTool("list_short_stories_qimao", {
        title: "列出短篇作品",
        description: "读取七猫作者后台的短篇作品列表（book_id / 标题 / 字数 / 状态）。只读 HTTP。" +
            "分页是游标式——把返回里的 next_id 再传回来取下一页。",
        inputSchema: {
            next_id: z.string().optional().describe("分页游标：传上一次返回的 next_id 取下一页；不传＝第一页"),
        },
    }, async (args) => fromService((await listShortStories({ nextId: args.next_id }))));
    server.registerTool("get_short_story_qimao", {
        title: "读取短篇详情",
        description: "读取某篇短篇作品的标题 / 字数 / 分类 / 状态等（只读 HTTP）。",
        inputSchema: { book_id: z.string().describe("短篇 book_id") },
    }, async ({ book_id }) => fromService((await getShortStory(book_id))));
    server.registerTool("create_short_story_qimao", {
        title: "新建短篇作品",
        description: `在七猫作者后台的新建短篇页填表并可选提交。正文可用 content/file_path/article_id。` +
            `经验字数区间 ${SHORT_MIN_WORDS}–${SHORT_MAX_WORDS} 字（最佳 ${SHORT_BEST_RANGE}，以平台实际规则为准，本工具只提示不硬拦）。\n` +
            `⚠️ 默认 confirm=false 只打开创建页读现状 + 截图，不填不提交；confirm=true 才填表并点提交。`,
        inputSchema: {
            title: z.string().describe("作品名称"),
            content: z.string().optional().describe("正文（与 file_path/article_id 三选一）"),
            file_path: z.string().optional().describe("正文文件路径（UTF-8 文本）"),
            article_id: z.string().optional().describe("本地文稿库 article_id（优先）"),
            category: z.string().optional().describe("作品分类名称"),
            confirm: z.boolean().optional().describe("是否真正提交，默认 false"),
            headless: z.boolean().optional().describe("是否无头运行，默认 true"),
        },
    }, async (args) => {
        let content = "";
        try {
            content = await pickContent(args);
        }
        catch (e) {
            return fail(e.message);
        }
        const r = await createShortStory({
            title: args.title,
            content,
            category: args.category,
            confirm: args.confirm,
            headless: args.headless,
        });
        if (args.article_id && r.ok && r.action === "published") {
            await articles.update(args.article_id, { status: "published", lastMessage: r.message, updatedAt: nowIso() });
        }
        return fromService(r);
    });
    server.registerTool("publish_short_story_qimao", {
        title: "发布短篇作品",
        description: `发布短篇：可给 book_id 发布已有作品，或给 title(+content) 新建并发布。正文可用 content/file_path/article_id。` +
            `⚠️ 短篇编辑器可能边输入边自动保存，所以默认 confirm=false **只打开页面读现状 + 截图，绝不填充**；confirm=true 才填空并提交。` +
            `发布前会做经验字数区间（${SHORT_MIN_WORDS}–${SHORT_MAX_WORDS}）软提示。`,
        inputSchema: {
            book_id: z.string().optional().describe("要发布的短篇 book_id（与 title 二选一）"),
            title: z.string().optional().describe("作品名称（配合 content 新建并发布）"),
            content: z.string().optional().describe("正文（与 file_path/article_id 三选一）"),
            file_path: z.string().optional(),
            article_id: z.string().optional(),
            category: z.string().optional().describe("作品分类名称（新建时用）"),
            confirm: z.boolean().optional().describe("是否真正发布，默认 false"),
            headless: z.boolean().optional().describe("是否无头运行，默认 true"),
        },
    }, async (args) => {
        if (!args.book_id && !args.title)
            return fail("需提供 book_id，或 title（+content）以新建并发布。");
        let content = "";
        try {
            content = await pickContent(args);
        }
        catch (e) {
            return fail(e.message);
        }
        const r = await publishShortStory({
            bookId: args.book_id,
            title: args.title,
            content,
            category: args.category,
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
        return fromService(r);
    });
    server.registerTool("delete_short_story_qimao", {
        title: "删除短篇作品 / 草稿",
        description: "删除指定短篇作品或草稿（破坏性）。默认 confirm=false 只预览；confirm=true 才真正删除。",
        inputSchema: {
            book_id: z.string().describe("短篇 book_id"),
            confirm: z.boolean().optional().describe("是否真正删除，默认 false"),
            headless: z.boolean().optional().describe("是否无头运行，默认 true"),
        },
    }, async (args) => fromService((await deleteShortStory(args.book_id, { confirm: args.confirm, headless: args.headless }))));
}
