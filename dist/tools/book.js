import { z } from "zod";
import { ok, fail, fromService } from "../core/result.js";
import { listBooks, createBook, setBookTags, updateBookInfo, listBookOptions } from "../services/book.js";
import { updateNovel } from "../services/localNovel.js";
import { novels, newId, nowIso } from "../core/store.js";
const tagShape = z.array(z.string()).optional();
export function registerBookTools(server) {
    server.registerTool("list_books_qimao", {
        title: "列出七猫作品",
        description: "读取作者后台真实作品列表（拿真实 book_id）：kind=long 读长篇（默认），kind=short 读短篇。" +
            "分页是游标式——把返回里的 next_id 再传回来取下一页。可把结果同步进本地小说登记（sync_local=true，仅 kind=long）。只读 HTTP、不需要浏览器。",
        inputSchema: {
            kind: z.enum(["long", "short"]).optional().describe("long=长篇（默认），short=短篇"),
            next_id: z.string().optional().describe("分页游标：传上一次返回的 next_id 取下一页；不传＝第一页"),
            sync_local: z.boolean().optional().describe("是否把后台作品同步为本地小说登记（默认 false，仅 kind=long）"),
        },
    }, async (args) => {
        const kind = args.kind ?? "long";
        const r = await listBooks({ kind, nextId: args.next_id });
        if (!r.ok)
            return fail(r.message);
        if (!args.sync_local || kind !== "long")
            return ok(r);
        const existing = await novels.all();
        let added = 0;
        for (const b of r.books ?? []) {
            if (!b.bookId || existing.some((n) => n.qimaoBookId === b.bookId))
                continue;
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
    });
    server.registerTool("create_book_qimao", {
        title: "新建作品（建书）",
        description: "在七猫作者后台驱动真实建书流程：列表页「新建小说」→ 选首发站点 → 作品信息表单 →「确认创建」。必填 book_name。\n" +
            "⚠️ 平台**硬性必填**（缺一个「确认创建」就永远灰着）：书名 / 目标读者 / 一级分类 / 二级分类 / 简介 / 至少1个标签 / 至少1个主角名。" +
            "未传的会填默认值（默认值会在返回的 filled 里如实标出，可事后用 update_book_info_qimao 改）。\n" +
            "书名有字符白名单（中英文 / 数字 / 罗马数字 / 中文标点），如含全角括号等会被自动清洗，结果在返回里提示。\n" +
            "默认 confirm=false 只打开作品管理列表页 + 截图，不点按钮不填表；confirm=true 才真正建书（返回 book_id）。",
        inputSchema: {
            book_name: z.string().describe("书名（必填；平台限 18 字，非法字符会自动清洗）"),
            gender: z.number().int().min(0).max(1).optional().describe("频道：1=男频（默认），0=女频"),
            client_id: z.string().optional().describe("首发站点 client_id：1=七猫中文网（默认），3=纵横中文网（用 book/client-list 查其它）"),
            abstract: z.string().optional().describe("作品简介（未传则填默认占位）"),
            protagonist1: z.string().optional().describe("主角名1（未传则填「主角」）"),
            protagonist2: z.string().optional().describe("主角名2"),
            category: z.string().optional().describe("一级分类名称（**未匹配会中止报错，不再静默取第一项**；先用 list_book_options_qimao(client_id=…) 查准确名称）"),
            category_sub: z.string().optional().describe("二级分类名称（同上：未匹配即中止）"),
            tags: tagShape.describe("标签名称（按分组顺序取用；未传则每个分组各取第一个）"),
            confirm: z.boolean().optional().describe("是否真正提交建书，默认 false"),
            headless: z.boolean().optional().describe("是否无头运行，默认 true"),
            register_local: z.boolean().optional().describe("建书成功后是否登记到本地小说（默认 true）"),
        },
    }, async (args) => {
        const r = await createBook({
            bookName: args.book_name,
            gender: args.gender,
            clientId: args.client_id,
            abstract: args.abstract,
            protagonist1: args.protagonist1,
            protagonist2: args.protagonist2,
            category: args.category,
            categorySub: args.category_sub,
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
                qimaoBookId: r.bookId,
                createdAt: now,
                updatedAt: now,
            });
        }
        return fromService(r);
    });
    server.registerTool("update_book_info_qimao", {
        title: "修改已有作品信息（书名 / 简介 / 主角 / 分类 / 标签）",
        description: "改已有作品的名称 / 简介 / 主角名 / 分类 / 标签。**长篇走作品信息页，短篇自动走短篇信息页**（按 book_id 判定，短篇渠道 client_id=5）；只覆盖显式传入的字段。\n" +
            "⚠️ 默认 confirm=false 只打开页面**读现状 + 截图，完全不填充**（避免误改线上）；confirm=true 才填表并保存。\n" +
            "⚠️ 分类名没匹配上会**中止并返回可选值**（不会静默改成别的分类）；保存按钮按「保存/确认修改/立即修改/提交/确认」多候选 + 兜底扫描点击，全落空时返回页面上的按钮清单。\n" +
            "改书名 / 简介可能触发重新审核、影响曝光，请谨慎。",
        inputSchema: {
            book_id: z.string().describe("七猫书 ID（book_id；长篇短篇都行）"),
            book_name: z.string().optional().describe("作品名称（不给＝不改；含非法字符会自动清洗）"),
            abstract: z.string().optional().describe("作品简介（不给＝不改）"),
            protagonist1: z.string().optional().describe("主角名1（不给＝不改）"),
            protagonist2: z.string().optional().describe("主角名2（不给＝不改）"),
            category: z.string().optional().describe("一级分类名称（不给＝不改；未匹配即中止，短篇用 client_id=5 查选项）"),
            category_sub: z.string().optional().describe("二级分类名称（不给＝不改；未匹配即中止）"),
            tags: tagShape.describe("标签名称（按分组顺序取用；不给＝不改）"),
            confirm: z.boolean().optional().describe("是否真正提交，默认 false（只读预览）"),
            headless: z.boolean().optional().describe("是否无头运行，默认 true"),
        },
    }, async (args) => {
        const r = await updateBookInfo({
            bookId: args.book_id,
            bookName: args.book_name,
            abstract: args.abstract,
            protagonist1: args.protagonist1,
            protagonist2: args.protagonist2,
            category: args.category,
            categorySub: args.category_sub,
            tags: args.tags,
            confirm: args.confirm,
            headless: args.headless,
        });
        if (r.action === "preview")
            return ok(r);
        return fromService(r);
    });
    server.registerTool("set_book_tags", {
        title: "设置作品标签 / 分类",
        description: "为已有作品设置分类 / 标签（复用 update_book_info_qimao 的作品信息页链路）。语义是「确保这些分类 / 标签处于选中」。\n" +
            "默认 confirm=false 只打开页面填表 + 截图（不提交）；confirm=true 才保存。",
        inputSchema: {
            book_id: z.string().describe("七猫书 ID"),
            category: z.string().optional().describe("一级分类名称（确保处于选中状态）"),
            category_sub: z.string().optional().describe("二级分类名称（确保处于选中状态）"),
            tags: tagShape.describe("标签名称（确保处于选中状态）"),
            confirm: z.boolean().optional().describe("是否真正提交，默认 false"),
            headless: z.boolean().optional().describe("是否无头运行，默认 true"),
        },
    }, async (args) => {
        if (!args.category && !args.category_sub && !(args.tags?.length))
            return fail("请至少提供 category / category_sub / tags 之一。");
        const r = await setBookTags({
            bookId: args.book_id,
            category: args.category,
            categorySub: args.category_sub,
            tags: args.tags,
            confirm: args.confirm,
            headless: args.headless,
        });
        if (r.action === "preview")
            return ok(r);
        return fromService(r);
    });
    server.registerTool("list_book_options_qimao", {
        title: "列出作品分类 / 标签选项",
        description: "读取七猫后台的作品分类（一级 + 二级 children）与标签可选项（按风格/角色/情节/背景分组），供建书 / 改作品信息时选值。只读 HTTP。\n" +
            "⚠️ 分类随站点不同：用 client_id 指定（1=七猫中文网 默认，3=纵横中文网，**5=短篇**）。返回的 genders[0]=男频、[1]=女频。\n" +
            "⚠️ 默认只回分类（only=category），不再把 405 个标签全塞回来（旧版一次 132k 字符会被客户端截断、等于看不到结果）。\n" +
            "标签挂在顶层 tagGroups[].tags（男/女频是同一份，只回一次）；默认只回 tagGroups 概览（分组名+数量），要标签本体传 only=tag；要分类扁平路径传 flat=true。",
        inputSchema: {
            client_id: z.string().optional().describe("站点 client_id：1=七猫中文网（默认），3=纵横中文网，5=短篇"),
            only: z
                .enum(["category", "tag", "all"])
                .optional()
                .describe("只回哪部分：category=只要分类（默认，输出最小）；tag=只要标签；all=都要（很长，慎用）"),
            gender: z.number().int().min(0).max(1).optional().describe("只看某个频道：0=男频，1=女频（不传＝两组都回）"),
            flat: z.boolean().optional().describe("是否额外回一份扁平分类路径（一级/二级），默认 false"),
        },
    }, async (args) => fromService((await listBookOptions({ clientId: args.client_id, only: args.only, gender: args.gender, flat: args.flat }))));
    server.registerTool("update_novel", {
        title: "修改本地小说登记 / 创作设定",
        description: "改本地小说登记（data/novels.json）的登记信息与创作设定：书名、频道、简介、主角名、分类/标签、七猫书号绑定，" +
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
    }, async (args) => {
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
        if (!r.ok)
            return fail(r.message);
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
    });
}
