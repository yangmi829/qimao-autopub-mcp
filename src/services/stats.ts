import { articles, novels, shortStories, tasks } from "../core/store.js";
import { API, apiGet } from "../browser/endpoints.js";
import { automationReadiness } from "./auth.js";
import { listBooks } from "./book.js";
import { listShortStories, SHORT_BEST_RANGE, SHORT_MIN_WORDS, SHORT_MAX_WORDS } from "./shortStory.js";

/**
 * 数据统计 / 收益（**全部只读 HTTP**，不需要浏览器）。
 *
 * 七猫的统计与收益接口同源（zuozhe.qimao.com），带 cookies + 签名即可直连，
 * 所以这些工具在没有浏览器（QIMAO_ENABLE_BROWSER=0）时也能用。
 * ⚠️ 响应字段名以后端实际为准，这里只做多命名容错与原文回传，不做强行归一化。
 */

function pick<T = unknown>(obj: any, keys: string[]): T | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== "") return v as T;
  }
  return undefined;
}

/* ------------------------------ 作品数据 ------------------------------ */

export interface BookStatisticsResult {
  ok: boolean;
  message: string;
  bookId: string;
  /** 作品概览（阅读 / 收藏 / 追读等，字段名以平台为准） */
  detail?: unknown;
  /** 趋势数据（按日） */
  trend?: unknown;
  error?: string;
}

/**
 * 读某本书的数据统计。
 * `scope=detail`（默认）读作品概览；`scope=trend` 读按日趋势；`scope=all` 两者都读。
 */
export async function getBookStatistics(
  opts: { bookId: string; scope?: "detail" | "trend" | "all"; startDate?: string; endDate?: string } = { bookId: "" }
): Promise<BookStatisticsResult> {
  const bookId = String(opts.bookId || "").trim();
  if (!bookId) return { ok: false, message: "缺少 book_id。", bookId };
  const scope = opts.scope ?? "detail";
  const range = { book_id: bookId, start_date: opts.startDate, end_date: opts.endDate };

  try {
    const detail = scope === "trend" ? undefined : await apiGet(API.statBookDetail, range);
    const trend = scope === "detail" ? undefined : await apiGet(API.statBookTrend, range);

    const failed = [detail, trend].find((r) => r && !r.ok);
    if (failed) return { ok: false, message: `读取作品数据失败：${failed.error}`, bookId, error: failed.error };

    return {
      ok: true,
      message: `已读取 book_id=${bookId} 的作品数据（scope=${scope}）。字段名以平台实际返回为准。`,
      bookId,
      detail: detail?.data,
      trend: trend?.data,
    };
  } catch (e) {
    return { ok: false, message: `读取作品数据异常：${(e as Error).message}`, bookId, error: (e as Error).message };
  }
}

/* ------------------------------ 收益 ------------------------------ */

export interface BookIncomeResult {
  ok: boolean;
  message: string;
  /** 月度结算（余额 / 结算状态等） */
  monthBalance?: unknown;
  /** 按书按日收益 */
  bookDateProfit?: unknown;
  /** 订阅明细 */
  subDetail?: unknown;
  error?: string;
}

/**
 * 读收益数据。
 * 不传 `bookId` 时只读月度结算 + 订阅明细；传了则再读该书的按日收益。
 */
export async function getBookIncome(
  opts: { month?: string; bookId?: string; scope?: "summary" | "detail" | "all"; startDate?: string; endDate?: string } = {}
): Promise<BookIncomeResult> {
  const scope = opts.scope ?? "summary";
  const range = { month: opts.month, book_id: opts.bookId, start_date: opts.startDate, end_date: opts.endDate };

  try {
    const monthBalance = await apiGet(API.profitMonthBalance, range);
    if (!monthBalance.ok) return { ok: false, message: `读取收益失败：${monthBalance.error}`, error: monthBalance.error };

    const out: BookIncomeResult = {
      ok: true,
      message: `已读取收益${opts.month ? `（${opts.month}）` : ""}。字段名以平台实际返回为准。`,
      monthBalance: monthBalance.data,
    };

    if (scope !== "summary") {
      const sub = await apiGet(API.profitSubDetail, range);
      out.subDetail = sub.ok ? sub.data : { error: sub.error };
    }
    if (opts.bookId && scope !== "summary") {
      const byBook = await apiGet(API.profitBookDateProfit, range);
      out.bookDateProfit = byBook.ok ? byBook.data : { error: byBook.error };
    }
    return out;
  } catch (e) {
    return { ok: false, message: `读取收益异常：${(e as Error).message}`, error: (e as Error).message };
  }
}

/* ------------------------------ 汇总统计 ------------------------------ */

export interface StatsResult {
  ok: boolean;
  message: string;
  local: {
    novels: number;
    shortStories: number;
    articles: Record<string, number>;
    tasks: Record<string, number>;
  };
  readiness: ReturnType<typeof automationReadiness>;
  remote?: {
    novels: { count: number; items: { bookId: string; bookName: string }[] } | { error: string };
    shortStories: { count: number; items: { bookId: string; title: string; words?: number }[] } | { error: string };
  };
  rules: {
    shortStoryWords: string;
    chaptersSchedulable: boolean;
  };
}

/** 汇总本地文稿库 + （可选）七猫后台的真实作品数据概览 */
export async function getStats(opts: { remote?: boolean } = {}): Promise<StatsResult> {
  const [arts, ns, ss, ts] = await Promise.all([articles.all(), novels.all(), shortStories.all(), tasks.all()]);

  const articleStatus: Record<string, number> = {};
  for (const a of arts) articleStatus[a.status] = (articleStatus[a.status] ?? 0) + 1;
  const taskStatus: Record<string, number> = {};
  for (const t of ts) taskStatus[t.status] = (taskStatus[t.status] ?? 0) + 1;

  const readiness = automationReadiness();
  const stats: StatsResult = {
    ok: true,
    message: "本地统计已生成" + (opts.remote ? "，并尝试读取后台数据" : "（未联网，远程数据未读取）"),
    local: {
      novels: ns.length,
      shortStories: ss.length,
      articles: { total: arts.length, ...articleStatus },
      tasks: { total: ts.length, ...taskStatus },
    },
    readiness,
    rules: {
      shortStoryWords: `${SHORT_MIN_WORDS}–${SHORT_MAX_WORDS} 字（最佳 ${SHORT_BEST_RANGE}，以平台实际规则为准）`,
      chaptersSchedulable: true,
    },
  };

  if (opts.remote && readiness.ready) {
    const [books, shorts] = await Promise.all([
      listBooks().catch((e) => ({ ok: false, message: (e as Error).message }) as any),
      listShortStories().catch((e) => ({ ok: false, message: (e as Error).message }) as any),
    ]);
    stats.remote = {
      novels: books?.ok
        ? { count: books.books?.length ?? 0, items: (books.books ?? []).map((b: any) => ({ bookId: b.bookId, bookName: b.bookName })) }
        : { error: books?.message ?? "读取失败" },
      shortStories: shorts?.ok
        ? {
            count: shorts.stories?.length ?? 0,
            items: (shorts.stories ?? []).map((s: any) => ({ bookId: s.bookId, title: s.title, words: s.words })),
          }
        : { error: shorts?.message ?? "读取失败" },
    };
  }

  return stats;
}

export { pick };
