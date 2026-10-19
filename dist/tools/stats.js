import { z } from "zod";
import { fromService } from "../core/result.js";
import { getBookStatistics, getBookIncome, getStats } from "../services/stats.js";
export function registerStatsTools(server) {
    server.registerTool("get_book_statistics_qimao", {
        title: "作品数据统计",
        description: "读取某本书的数据统计（**只读 HTTP，不需要浏览器**）：scope=detail 读作品概览，scope=trend 读按日趋势，scope=all 两者都读。" +
            "字段名以平台实际返回为准；口径可参考资源 qimao://publish-rules。",
        inputSchema: {
            book_id: z.string().describe("七猫书 ID（book_id）"),
            scope: z.enum(["detail", "trend", "all"]).optional().describe("detail（默认）/ trend / all"),
            start_date: z.string().optional().describe("起始日期（yyyy-MM-dd）"),
            end_date: z.string().optional().describe("结束日期（yyyy-MM-dd）"),
        },
    }, async (args) => fromService((await getBookStatistics({
        bookId: args.book_id,
        scope: args.scope,
        startDate: args.start_date,
        endDate: args.end_date,
    }))));
    server.registerTool("get_book_income_qimao", {
        title: "作品收益",
        description: "读取收益数据（**只读 HTTP**）：scope=summary（默认）读月度结算；detail 再读订阅明细；all 再加按日收益（需 book_id）。" +
            "字段名以平台实际返回为准。",
        inputSchema: {
            month: z.string().optional().describe("月份（yyyy-MM，默认平台当前结算月）"),
            book_id: z.string().optional().describe("七猫书 ID（可选，用于按书收益）"),
            scope: z.enum(["summary", "detail", "all"]).optional().describe("summary（默认）/ detail / all"),
            start_date: z.string().optional().describe("起始日期（yyyy-MM-dd）"),
            end_date: z.string().optional().describe("结束日期（yyyy-MM-dd）"),
        },
    }, async (args) => fromService((await getBookIncome({
        month: args.month,
        bookId: args.book_id,
        scope: args.scope,
        startDate: args.start_date,
        endDate: args.end_date,
    }))));
    server.registerTool("get_stats", {
        title: "汇总统计",
        description: "汇总本地文稿库/任务/登记 + 环境自检；remote=true 时再读一次七猫后台的真实长篇与短篇列表（只读 HTTP）。",
        inputSchema: {
            remote: z.boolean().optional().describe("是否联网读取后台数据，默认 false"),
        },
    }, async ({ remote }) => fromService((await getStats({ remote }))));
}
