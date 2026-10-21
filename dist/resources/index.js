import { articles, novels, shortStories, tasks } from "../core/store.js";
import { automationReadiness } from "../services/auth.js";
import { cookiesSummary } from "../browser/cookies.js";
import { SHORT_MIN_WORDS, SHORT_MAX_WORDS, SHORT_BEST_RANGE } from "../services/shortStory.js";
import { GENRES } from "../knowledge/genres.js";
import { renderGoldenThree } from "../knowledge/goldenThree.js";
import { createBookUrl, shortManageUrl, bookManageUrl, bookDataUrl, incomeManageUrl, chapterEditUrl } from "../browser/endpoints.js";
const MIME = "application/json";
function json(uri, data) {
    return { contents: [{ uri: uri.href, mimeType: MIME, text: JSON.stringify(data, null, 2) }] };
}
export function registerResources(server) {
    server.registerResource("status", "qimao://status", { title: "登录与环境状态", description: "cookies / 浏览器驱动 / 后台地址等只读状态", mimeType: MIME }, async (uri) => {
        const readiness = automationReadiness();
        return json(uri, {
            ready: readiness.ready,
            browser_ready: readiness.browserReady,
            reasons: readiness.reasons,
            cookies: cookiesSummary(),
            details: readiness.details,
        });
    });
    server.registerResource("novels", "qimao://novels", { title: "本地小说登记", description: "本地登记的小说与绑定的七猫 book_id（不联网）", mimeType: MIME }, async (uri) => json(uri, { total: (await novels.all()).length, novels: await novels.all() }));
    server.registerResource("short-stories", "qimao://short-stories", { title: "本地短篇登记", description: "本地登记的短篇与七猫 book_id（不联网）", mimeType: MIME }, async (uri) => json(uri, { total: (await shortStories.all()).length, shortStories: await shortStories.all() }));
    server.registerResource("articles", "qimao://articles", { title: "本地文稿库", description: "本地文稿库条目（不含正文全文）", mimeType: MIME }, async (uri) => {
        const items = await articles.all();
        return json(uri, {
            total: items.length,
            articles: items.map(({ content, ...rest }) => ({ ...rest, preview: content.slice(0, 60) })),
        });
    });
    server.registerResource("tasks", "qimao://tasks", { title: "发布任务日志", description: "批量/单章上传的任务日志", mimeType: MIME }, async (uri) => json(uri, { total: (await tasks.all()).length, tasks: await tasks.all() }));
    server.registerResource("publish-rules", "qimao://publish-rules", { title: "发布限制须知", description: "短篇字数区间、定时发布支持范围、只读/写能力边界等；写操作前先读", mimeType: MIME }, async (uri) => json(uri, {
        readWriteBoundary: {
            readonly: "作品列表 / 章节列表 / 卷列表 / 短篇列表与详情 / 数据统计 / 收益 均走纯 HTTP（签名可复现），不需要浏览器。",
            write: "建书 / 改作品信息 / 标签 / 章节增删改与批量 / 短篇新建发布删除 均驱动真实页面，需要浏览器（puppeteer-core + 本机 Chrome/Edge）。",
            confirm: "所有写操作默认 confirm=false（只读现状 + 截图，不提交），必须 confirm=true 才提交。",
        },
        shortStory: {
            words: `${SHORT_MIN_WORDS}–${SHORT_MAX_WORDS}`,
            best: SHORT_BEST_RANGE,
            schedulable: false,
            note: "字数区间为经验值，以平台实际提示为准；本服务只做软提示，不硬拦截。",
        },
        novelChapter: {
            schedulable: true,
            note: "add_chapter_qimao / batch_publish_chapters 支持 scheduled_time；章节编辑器边输入边自动保存，预览模式绝不填充。",
        },
        urls: {
            bookManage: bookManageUrl(),
            createBook: createBookUrl(),
            chapterEdit: chapterEditUrl("<book_id>"),
            shortManage: shortManageUrl(),
            bookData: bookDataUrl(),
            income: incomeManageUrl(),
        },
    }));
    server.registerResource("genres", "qimao://genres", { title: "网文赛道知识库", description: "主流赛道的爽点机制、开篇要求、节奏、避坑清单与建议单章字数（不联网）；定赛道 / 写开篇前先读", mimeType: MIME }, async (uri) => json(uri, GENRES));
    server.registerResource("golden-three-chapters", "qimao://golden-three-chapters", { title: "黄金三章方法论", description: "前三章逐章目标与通用节奏要求（markdown）；写前三章前先读", mimeType: "text/markdown" }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: renderGoldenThree() }] }));
}
