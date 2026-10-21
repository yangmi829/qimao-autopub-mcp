import fs from "node:fs";
import path from "node:path";
import { articles, novels, shortStories, tasks, newId, nowIso } from "../core/store.js";
import { DATA_DIR, EXPORT_DIR, PROJECT_ROOT, ensureDir, resolveLoosePath } from "../core/paths.js";
import { countCjk, toPlainText, pad2, cleanChapterTitle } from "../core/text.js";
import { logger } from "../core/logger.js";
import type { Article, Novel, PublishTask } from "../types.js";
import { uploadChapter } from "./chapter.js";
import { analyzeOriginality } from "./originality.js";
import { sleep } from "../browser/driver.js";
import { NEXT_STEP_CHAPTER_PUBLISHED } from "../core/reminders.js";

/** 把长正文写到 data/export 下的文件，返回路径（避免超长文本塞进工具参数） */
export function writeExportFile(fileName: string, content: string): string {
  const dir = path.join(DATA_DIR, "export");
  ensureDir(dir);
  const safe = fileName.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "article";
  const file = path.join(dir, `${safe}-${Date.now()}.txt`);
  fs.writeFileSync(file, content, "utf-8");
  return file;
}

/** 从 file_path 或 content 取正文（二者必居其一） */
export function resolveContent(content?: string, filePath?: string): { text: string; source: string } {
  if (filePath) {
    if (!fs.existsSync(filePath)) throw new Error(`正文文件不存在：${filePath}`);
    return { text: fs.readFileSync(filePath, "utf-8"), source: filePath };
  }
  if (content && content.trim()) return { text: content, source: "inline" };
  throw new Error("缺少正文：请提供 content 或 file_path。");
}

/**
 * 文稿库 id 查不到时的统一文案。
 * ⚠️ 两个 MCP 的文稿库互相隔离，id 都是 `art_` 开头、肉眼分不出平台 →
 * 必须点明「只在当前库有效」，否则跨平台调用只会看到一句「未找到」。
 */
export function missingArticleMessage(id: string): string {
  return `本地文稿库未找到 article_id=${id}（article_id 只在当前 MCP 的文稿库内有效，跨平台请各自用 save_article 入库）`;
}

/* ------------------------------ 文稿库 CRUD ------------------------------ */

export interface SaveArticleInput {
  /** 传了就是「改已有条目」，不传就是「新建」 */
  articleId?: string;
  kind?: "chapter" | "short";
  title?: string;
  content?: string;
  filePath?: string;
  novelId?: string;
  chapterNumber?: number;
  status?: "draft" | "published" | "failed";
  qimaoBookId?: string;
}

export interface SaveArticleResult {
  ok: boolean;
  action: "created" | "updated" | "error";
  message: string;
  article?: Article;
}

/**
 * 入库 / 更新本地文稿。
 * - 不传 article_id：新建（返回 article_id，避免把长文本反复塞进工具参数）。
 * - 传 article_id：局部更新（只覆盖显式传入的字段）。
 */
export async function saveArticle(input: SaveArticleInput): Promise<SaveArticleResult> {
  // ---------- 更新模式 ----------
  if (input.articleId) {
    const existing = await articles.get(input.articleId);
    if (!existing) return { ok: false, action: "error", message: `未找到 article_id=${input.articleId}` };

    const patch: Partial<Article> = {};
    let source = "未改动正文";
    if (input.title?.trim()) patch.title = input.title.trim();
    if (input.kind) patch.kind = input.kind === "short" ? "short" : "chapter";
    if ((input.content && input.content.trim()) || input.filePath) {
      try {
        const r = resolveContent(input.content, input.filePath);
        source = r.source;
        const plain = toPlainText(r.text);
        patch.content = plain;
        patch.wordCount = countCjk(plain);
      } catch (e) {
        return { ok: false, action: "error", message: (e as Error).message };
      }
    }
    if (input.novelId !== undefined) patch.novelId = input.novelId || undefined;
    if (input.chapterNumber !== undefined) patch.chapterNumber = input.chapterNumber;
    if (input.status) patch.status = input.status;
    if (input.qimaoBookId !== undefined) patch.qimaoBookId = input.qimaoBookId || undefined;

    if (!Object.keys(patch).length) {
      return { ok: false, action: "error", message: "没有提供任何要修改的字段（也要给 title / content / chapter_number 等）。" };
    }

    patch.updatedAt = nowIso();
    const updated = await articles.update(input.articleId, patch);
    logger.info(`[library] 更新 ${updated.kind} 《${updated.title}》 ${updated.wordCount} 字（来源 ${source}）`);
    return {
      ok: true,
      action: "updated",
      message: `已更新 article_id=${updated.id}《${updated.title}》（${updated.wordCount} 字，${Object.keys(patch).filter((k) => k !== "updatedAt").join("/")}）。`,
      article: updated,
    };
  }

  // ---------- 新建模式 ----------
  if (!input.title?.trim()) return { ok: false, action: "error", message: "缺少标题 title。" };
  let text = "";
  let source = "";
  try {
    const r = resolveContent(input.content, input.filePath);
    text = r.text;
    source = r.source;
  } catch (e) {
    return { ok: false, action: "error", message: (e as Error).message };
  }
  const plain = toPlainText(text);
  const now = nowIso();
  const item: Article = {
    id: newId("art"),
    kind: input.kind === "short" ? "short" : "chapter",
    title: input.title.trim(),
    content: plain,
    wordCount: countCjk(plain),
    novelId: input.novelId,
    chapterNumber: input.chapterNumber,
    status: input.status ?? "draft",
    qimaoBookId: input.qimaoBookId,
    createdAt: now,
    updatedAt: now,
  };
  await articles.insert(item);
  logger.info(`[library] 入库 ${item.kind} 《${item.title}》 ${item.wordCount} 字（来源 ${source}）`);
  return { ok: true, action: "created", message: `已入库 article_id=${item.id}（${item.wordCount} 字）。`, article: item };
}

export interface ListArticlesFilter {
  kind?: "chapter" | "short";
  novelId?: string;
  status?: "draft" | "published" | "failed";
}

export async function listArticles(filter: ListArticlesFilter = {}): Promise<Article[]> {
  let items = await articles.all();
  if (filter.kind) items = items.filter((a) => a.kind === filter.kind);
  if (filter.novelId) items = items.filter((a) => a.novelId === filter.novelId);
  if (filter.status) items = items.filter((a) => a.status === filter.status);
  return items.sort((a, b) => (a.chapterNumber ?? 0) - (b.chapterNumber ?? 0));
}

export async function getArticle(id: string): Promise<Article | undefined> {
  return articles.get(id);
}

export async function deleteArticle(id: string, confirm?: boolean): Promise<{ ok: boolean; action: "preview" | "deleted" | "error"; message: string }> {
  const item = await articles.get(id);
  if (!item) return { ok: false, action: "error", message: `未找到 article_id=${id}` };
  if (!confirm) {
    return { ok: true, action: "preview", message: `将删除本地文稿「${item.title}」(${id})。confirm=true 才真正删除。` };
  }
  await articles.remove(id);
  return { ok: true, action: "deleted", message: `已删除本地文稿「${item.title}」(${id})。` };
}

/* ------------------------------ 导出正文 ------------------------------ */

export interface ExportArticleInput {
  articleId: string;
  format?: "txt" | "md";
  /** 是否在文件头部带上所属书名，默认 true */
  includeNovelTitle?: boolean;
  /** 自定义导出目录，省略则用 QIMAO_EXPORT_DIR（默认 data/export） */
  exportDir?: string;
}

export interface ExportArticleResult {
  ok: boolean;
  message: string;
  filePath?: string;
  format?: string;
  wordCount?: number;
  preview?: string;
}

function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\n\r\t]/g, "_").slice(0, 80) || "article";
}

/** 把本地文稿导出成可直接粘贴到七猫作者后台的文本文件（供人工发布流程） */
export async function exportArticle(input: ExportArticleInput): Promise<ExportArticleResult> {
  const art = await articles.get(input.articleId);
  if (!art) return { ok: false, message: `未找到 article_id=${input.articleId}` };

  const fmt = input.format === "md" ? "md" : "txt";
  const dir = input.exportDir || EXPORT_DIR;
  ensureDir(dir);

  const novel = art.novelId ? await novels.get(art.novelId) : undefined;
  const base =
    typeof art.chapterNumber === "number" && art.chapterNumber > 0
      ? `${String(art.chapterNumber).padStart(3, "0")}-${safeFileName(art.title)}`
      : `${safeFileName(art.title)}-${art.id}`;
  const filePath = path.join(dir, `${base}.${fmt}`);

  const head = input.includeNovelTitle !== false && novel ? `《${novel.title}》\n` : "";
  const body = fmt === "md" ? `${head}# ${art.title}\n\n${art.content}\n` : `${head}${art.title}\n\n${art.content}\n`;

  await fs.promises.writeFile(filePath, body, "utf-8");
  return {
    ok: true,
    message: `已导出到 ${filePath}`,
    filePath,
    format: fmt,
    wordCount: art.wordCount,
    preview: body.slice(0, 300),
  };
}

/* --------------------------- 原创度 / AI 味检测 --------------------------- */

export interface OriginalityCheckInput {
  articleId?: string;
  content?: string;
  /** 相似度阈值，默认 0.25，越低越严格 */
  threshold?: number;
}

/**
 * 本地原创性 / AI 味检测：与本地文稿库其它条目做 n-gram 相似度比对，
 * 并检查自我复读、套话密度、对话占比、段落均匀度。不联网、不消耗额度。
 */
export async function checkOriginality(input: OriginalityCheckInput) {
  let text = input.content && input.content.trim() ? input.content : "";
  let articleId: string | undefined;

  if (!text && input.articleId) {
    const art = await articles.get(input.articleId);
    if (!art) return { ok: false as const, message: `未找到 article_id=${input.articleId}` };
    text = art.content;
    articleId = art.id;
  }
  if (!text.trim()) return { ok: false as const, message: "需要提供 article_id 或 content。" };

  const all = await articles.all();
  const corpus = all.filter((a) => a.id !== articleId).map((a) => ({ id: a.id, text: a.content }));
  const threshold = typeof input.threshold === "number" && Number.isFinite(input.threshold) ? input.threshold : 0.25;
  const report = analyzeOriginality(text, corpus, threshold);

  return {
    ok: true as const,
    message: report.passed
      ? `相似度 ${report.similarity}（阈值 ${threshold}），通过。`
      : `相似度 ${report.similarity} 超过阈值 ${threshold}，建议按 findings 修改。`,
    article_id: articleId,
    similarity: report.similarity,
    passed: report.passed,
    threshold: report.threshold,
    metrics: report.metrics,
    findings: report.findings,
    suggestions: report.suggestions,
    compared_with: corpus.length,
  };
}

/* ------------------------------ 批量上传 ------------------------------ */

export interface BatchPublishOptions {
  novelId?: string;
  bookId?: string;
  articleIds?: string[];
  limit?: number;
  intervalSeconds?: number;
  /** 发布确认弹窗的「内容声明」：默认 true＝含AI生成内容；false 才选本人原创 */
  useAI?: boolean;
  confirm?: boolean;
  headless?: boolean;
}

export interface BatchPublishResult {
  ok: boolean;
  message: string;
  total: number;
  succeeded: number;
  failed: number;
  results: { articleId: string; title: string; ok: boolean; action: string; message: string }[];
}

/**
 * 从本地文稿库挑「待发布」章节，按章节号顺序限速依次上传。
 * 单章失败不中断；每章结果写回 articles 与 publish_tasks。
 * confirm=false 时只做一次「填表不提交」演练（只跑第一章预览），避免在后台留下大量草稿。
 */
export async function batchPublishChapters(opts: BatchPublishOptions): Promise<BatchPublishResult> {
  let bookId = opts.bookId;
  if (!bookId && opts.novelId) {
    const novel = await novels.get(opts.novelId);
    bookId = novel?.qimaoBookId;
  }
  if (!bookId) {
    return {
      ok: false,
      message: "缺少七猫书 ID：请提供 book_id，或在本地小说登记里绑定 qimaoBookId（novel_id）。",
      total: 0,
      succeeded: 0,
      failed: 0,
      results: [],
    };
  }

  let targets = await listArticles({ kind: "chapter" });
  if (opts.articleIds?.length) {
    const set = new Set(opts.articleIds);
    targets = targets.filter((a) => set.has(a.id));
  } else {
    targets = targets.filter((a) => a.status === "draft" && (!opts.novelId || a.novelId === opts.novelId));
    targets = targets.filter((a) => !a.qimaoBookId || a.qimaoBookId === bookId);
  }
  const limit = opts.limit && opts.limit > 0 ? opts.limit : targets.length;
  targets = targets.slice(0, limit);

  if (targets.length === 0) {
    return { ok: true, message: "没有符合条件的待发布章节。", total: 0, succeeded: 0, failed: 0, results: [] };
  }

  const interval = Math.max(0, opts.intervalSeconds ?? 5) * 1000;
  const results: BatchPublishResult["results"] = [];

  for (let i = 0; i < targets.length; i++) {
    const a = targets[i];
    const isPreviewOnly = !opts.confirm && i > 0; // 非提交模式只演练第一章
    if (isPreviewOnly) break;

    const task: PublishTask = {
      id: newId("task"),
      kind: "chapter",
      targetId: a.id,
      title: a.title,
      status: "pending",
      mode: "batch",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await tasks.insert(task);

    const r = await uploadChapter({
      bookId,
      title: a.title,
      content: a.content,
      chapterNumber: a.chapterNumber,
      useAI: opts.useAI,
      confirm: opts.confirm,
      headless: opts.headless,
    });

    const published = r.action === "published" || r.action === "scheduled";
    await tasks.update(task.id, {
      status: published ? "done" : r.ok ? "pending" : "failed",
      message: `${r.action}: ${r.message}`,
      screenshotPath: r.screenshotPath,
      updatedAt: nowIso(),
    });

    if (published) {
      await articles.update(a.id, {
        status: "published",
        publishTime: nowIso(),
        qimaoBookId: bookId,
        lastMessage: r.message,
        updatedAt: nowIso(),
      });
    } else if (!r.ok) {
      await articles.update(a.id, { status: "failed", lastMessage: r.message, updatedAt: nowIso() });
    }

    results.push({ articleId: a.id, title: a.title, ok: published || (r.ok && !opts.confirm), action: r.action, message: r.message });

    if (i < targets.length - 1 && interval > 0) await sleep(interval);
  }

  const succeeded = results.filter((x) => x.ok).length;
  const failed = results.length - succeeded;
  return {
    ok: failed === 0,
    message: opts.confirm
      ? `批量上传完成：成功 ${succeeded} / 失败 ${failed}（共 ${results.length} 章）。${NEXT_STEP_CHAPTER_PUBLISHED}`
      : `演练模式（confirm=false）：仅对第 1 章做了「填表不提交」预览，共待发布 ${targets.length} 章。`,
    total: results.length,
    succeeded,
    failed,
    results,
  };
}

/* ------------------ 从磁盘工作稿批量入库 / 更新（本地） ------------------ */

/** 章节标题行：`# 第01章 标题` / `## 第十二章 标题`（兼容中文数字与破折号） */
const CHAPTER_HEADING_RE = /^#{1,6}\s*第\s*([0-9一二两三四五六七八九十百零]+)\s*章[\s:：、.、_\-—]*(.*)$/;
/** 任意 markdown 标题行 */
const ANY_HEADING_RE = /^#{1,6}\s+(.+?)\s*$/;
/** 合稿文件名：`第01-03章_合稿（润色版）.md` */
const RANGE_FILE_RE = /^第\s*\d+\s*[-–—~至]\s*\d+\s*章/;
/** 单章文件名：`第01章_标题.md` */
const SINGLE_FILE_RE = /^第\s*(\d+)\s*章\s*(?:[-–—_.\s]+)?(.*)$/;

const CN_DIGITS: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** 「十二」/「二十一」/「一百零三」→ 12 / 21 / 103；纯数字原样返回，无法解析返回 null */
function cnToNumber(s: string): number | null {
  if (/^\d+$/.test(s)) return Number(s);
  let total = 0;
  let digit: number | null = null;
  for (const ch of s) {
    if (ch in CN_DIGITS) {
      digit = CN_DIGITS[ch];
      continue;
    }
    if (ch === "十") {
      total += (digit ?? 1) * 10;
      digit = null;
      continue;
    }
    if (ch === "百") {
      total += (digit ?? 1) * 100;
      digit = null;
      continue;
    }
    return null;
  }
  return total + (digit ?? 0);
}

/**
 * 去掉章节段首的元信息：工作稿习惯在标题下用引用块写
 * `> **本章概要**` / `> **本章爽点**` / `> **字数**`，后面跟一条 `---`。
 * 这些只服务于人工写作，不能进正文，所以在成段前先剥掉。
 */
function stripLeadingMeta(lines: string[]): string[] {
  const out = [...lines];
  while (out.length && !out[0].trim()) out.shift();
  while (out.length && /^\s*>/.test(out[0])) out.shift();
  while (out.length && (!out[0].trim() || /^\s*-{3,}\s*$/.test(out[0]))) out.shift();
  return out;
}

function sectionToContent(lines: string[]): string {
  return toPlainText(stripLeadingMeta(lines).join("\n"));
}

/**
 * 按 `# 第N章 标题` 切分正文。
 * 遇到非章节标题（如 `# 附录 —— 角色名录`、`## 目录`）即结束当前章节，避免把附录内容并进最后一章。
 */
function splitChaptersFromText(text: string): { chapterNumber: number; title: string; content: string }[] {
  const sections: { num: number; title: string; lines: string[] }[] = [];
  let current: { num: number; title: string; lines: string[] } | null = null;

  for (const line of text.split(/\r?\n/)) {
    if (ANY_HEADING_RE.test(line)) {
      const m = CHAPTER_HEADING_RE.exec(line);
      const num = m ? cnToNumber(m[1]) : null;
      if (m && num !== null) {
        current = { num, title: cleanChapterTitle((m[2] || "").trim()) || `第${num}章`, lines: [] };
        sections.push(current);
      } else {
        current = null;
      }
      continue;
    }
    if (current) current.lines.push(line);
  }

  return sections
    .map((s) => ({ chapterNumber: s.num, title: s.title, content: sectionToContent(s.lines) }))
    .filter((s) => s.content.length > 0);
}

/** 归一化目录名/书名：工作稿目录常省标点（`请在全网面前叫我废物_<书号>` vs 书名「请在全网面前，叫我废物」） */
function normalizeName(s: string): string {
  return s.replace(/[，,。.、·！!？?：:；;「」《》\s]/g, "");
}

/** 本地小说对应的工作稿目录候选（默认 <工作区>/小说/<书名>_<七猫书号>/章节） */
function guessNovelDirs(novel: Novel | undefined): string[] {
  if (!novel) return [];
  const base = process.env.QIMAO_NOVEL_DIR || path.join(PROJECT_ROOT, "..", "小说");
  const out: string[] = [];
  const push = (dir: string) => out.push(path.join(dir, "章节"), dir);

  for (const n of [novel.qimaoBookId ? `${novel.title}_${novel.qimaoBookId}` : "", novel.title].filter(Boolean)) {
    push(path.join(base, n));
  }

  // 容错：按「含七猫书号」或「归一化书名相同」匹配目录名
  try {
    const want = normalizeName(novel.title);
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const byId = !!novel.qimaoBookId && entry.name.includes(novel.qimaoBookId);
      const byName = normalizeName(entry.name.split("_")[0]) === want;
      if (byId || byName) push(path.join(base, entry.name));
    }
  } catch {
    /* 工作区目录不存在就只保留精确候选 */
  }
  return out;
}

export interface ImportArticlesInput {
  /** 章节稿目录；省略时按本地小说推断（见 guessNovelDirs） */
  dir?: string;
  novelId?: string;
  kind?: "chapter" | "short";
  /** 新条目状态，默认 draft；已存在条目不会被改状态 */
  status?: "draft" | "published" | "failed";
  /** 已存在（同小说同章节号）是否覆盖正文，默认 true */
  updateExisting?: boolean;
  /** 是否真正写入，默认 false（只预览） */
  confirm?: boolean;
}

export interface ImportArticlesResult {
  ok: boolean;
  action: "preview" | "imported" | "error";
  message: string;
  dir?: string;
  novelId?: string;
  scannedFiles?: number;
  created: number;
  updated: number;
  planned: {
    file: string;
    chapterNumber?: number;
    title: string;
    wordCount: number;
    action: "create" | "update";
    articleId?: string;
  }[];
  warnings?: string[];
}

/**
 * 把磁盘上的章节工作稿（`小说/<书名>_<书号>/章节/第NN章_标题.md`）批量入库 / 更新到本地文稿库。
 * 纯本地、不触网。默认 confirm=false 只预览，confirm=true 才写入。
 */
export async function importArticlesFromDir(input: ImportArticlesInput): Promise<ImportArticlesResult> {
  const warnings: string[] = [];
  const empty = { created: 0, updated: 0, planned: [] as ImportArticlesResult["planned"] };

  let novel: Novel | undefined;
  if (input.novelId) {
    novel = await novels.get(input.novelId);
    if (!novel) return { ok: false, action: "error", message: `未找到本地小说 novel_id=${input.novelId}`, ...empty };
  }

  let dir = input.dir ? resolveLoosePath(input.dir) : "";
  if (!dir) {
    dir = guessNovelDirs(novel).find((c) => fs.existsSync(c)) ?? "";
    if (!dir) {
      return {
        ok: false,
        action: "error",
        message: "未提供 dir，且未能按本地小说推断出章节目录。请显式传 dir（如 小说/<书名>_<书号>/章节 的绝对路径）。",
        ...empty,
      };
    }
  }
  if (!fs.existsSync(dir)) return { ok: false, action: "error", message: `目录不存在：${dir}`, dir, ...empty };

  // 传了小说根目录时自动下探一层 章节/
  if (path.basename(dir) !== "章节" && fs.existsSync(path.join(dir, "章节"))) dir = path.join(dir, "章节");

  const kind = input.kind ?? "chapter";
  const files = fs
    .readdirSync(dir)
    .filter((f) => /\.(md|txt)$/i.test(f))
    .sort();

  // ---------- 解析文件 ----------
  const found: { file: string; chapterNumber?: number; title: string; content: string }[] = [];
  for (const f of files) {
    if (RANGE_FILE_RE.test(f)) {
      warnings.push(`已跳过合稿文件「${f}」（一个文件含多章，避免与单章文件重复）；如需导入请单独放到一个目录。`);
      continue;
    }
    const text = fs.readFileSync(path.join(dir, f), "utf-8");
    const parts = splitChaptersFromText(text);
    if (parts.length) {
      for (const p of parts) found.push({ file: f, ...p });
      continue;
    }
    // 回退：用文件名解析章节号 + 标题
    const base = f.replace(/\.(md|txt)$/i, "");
    const m = SINGLE_FILE_RE.exec(base);
    const lines = text.split(/\r?\n/);
    const firstHeading = lines.findIndex((l) => ANY_HEADING_RE.test(l));
    const content = sectionToContent(firstHeading >= 0 ? lines.slice(firstHeading + 1) : lines);
    if (m && content) {
      const num = Number(m[1]);
      found.push({ file: f, chapterNumber: num, title: cleanChapterTitle(m[2].trim()) || `第${num}章`, content });
    } else {
      warnings.push(`已跳过「${f}」：未识别到「第N章」标题。`);
    }
  }

  // ---------- 与现有条目比对 ----------
  const existing = (await articles.all()).filter((a) => a.kind === kind && (!novel || a.novelId === novel.id));
  const byNumber = new Map<number, Article>();
  const byTitle = new Map<string, Article>();
  for (const a of existing) {
    if (typeof a.chapterNumber === "number" && !byNumber.has(a.chapterNumber)) byNumber.set(a.chapterNumber, a);
    if (!byTitle.has(a.title)) byTitle.set(a.title, a);
  }

  const items: (ImportArticlesResult["planned"][number] & { content: string })[] = [];
  const seen = new Set<number>();
  for (const f of found) {
    const num = f.chapterNumber;
    if (typeof num === "number") {
      if (seen.has(num)) {
        warnings.push(`第 ${num} 章在多处出现，已跳过「${f.file}」（保留先出现的）。`);
        continue;
      }
      seen.add(num);
    }
    const title = typeof num === "number" ? `第${pad2(num)}章 ${f.title}` : f.title;
    const hit = typeof num === "number" ? byNumber.get(num) : byTitle.get(title);
    if (hit && input.updateExisting === false) {
      warnings.push(`已存在「${hit.title}」(${hit.id})，按 update_existing=false 跳过。`);
      continue;
    }
    items.push({
      file: f.file,
      chapterNumber: num,
      title,
      wordCount: countCjk(f.content),
      action: hit ? "update" : "create",
      articleId: hit?.id,
      content: f.content,
    });
  }

  const created = items.filter((i) => i.action === "create").length;
  const updated = items.length - created;
  const planned = items.map(({ content, ...rest }) => rest);

  if (!input.confirm) {
    return {
      ok: true,
      action: "preview",
      message: `预览（confirm=false）：扫描「${dir}」${files.length} 个文件，识别 ${found.length} 章；待新建 ${created} 章、待更新 ${updated} 章。确认后传 confirm=true 写入本地文稿库。`,
      dir,
      novelId: novel?.id,
      scannedFiles: files.length,
      created,
      updated,
      planned,
      warnings: warnings.length ? warnings : undefined,
    };
  }

  // ---------- 写入 ----------
  const now = nowIso();
  for (const it of items) {
    if (it.action === "update" && it.articleId) {
      const patch: Partial<Article> = { title: it.title, content: it.content, wordCount: it.wordCount, updatedAt: now };
      if (it.chapterNumber !== undefined) patch.chapterNumber = it.chapterNumber;
      if (novel?.qimaoBookId) patch.qimaoBookId = novel.qimaoBookId;
      await articles.update(it.articleId, patch);
    } else {
      await articles.insert({
        id: newId("art"),
        kind,
        title: it.title,
        content: it.content,
        wordCount: it.wordCount,
        novelId: novel?.id,
        chapterNumber: it.chapterNumber,
        status: input.status ?? "draft",
        qimaoBookId: novel?.qimaoBookId,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  logger.info(`[library] 从 ${dir} 导入：新建 ${created} / 更新 ${updated}`);
  return {
    ok: true,
    action: "imported",
    message: `已写入本地文稿库：新建 ${created} 章、更新 ${updated} 章（共 ${items.length} 章）。`,
    dir,
    novelId: novel?.id,
    scannedFiles: files.length,
    created,
    updated,
    planned,
    warnings: warnings.length ? warnings : undefined,
  };
}

export { shortStories };
