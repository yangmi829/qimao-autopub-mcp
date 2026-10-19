/** 中文正文字数统计：汉字按字计，英文单词折算 */
export function countCjk(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const words = (text.match(/[A-Za-z]+/g) || []).length;
  return cjk + Math.round(words / 1.6);
}

/**
 * markdown 正文 -> 纯文本。
 * 富文本编辑器会把 `**` / `---` / ``` / `>` 当字面字符渲染，
 * 所以上传前必须剥掉 markdown 标记，否则正文里会出现一堆星号、横线。
 */
export function toPlainText(text: string): string {
  let t = text;
  t = t.replace(/^\s*```.*$/gm, "");
  t = t.replace(/\*\*/g, "");
  t = t.replace(/^\s*>\s?/gm, "");
  t = t.replace(/^\s*---\s*$/gm, "");
  t = t.replace(/[ \t]+\n/g, "\n");
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

/**
 * HTML 富文本 -> 纯文本。
 * 编辑接口有时返回 `<p>…</p>` 片段，直接当正文用会把标签带进去。
 */
export function stripHtml(html: string): string {
  return (html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|blockquote|section)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, "&");
}

/** 去掉标题里的「第X章」前缀（序号框与标题框是两个独立输入框） */
export function cleanChapterTitle(title: string): string {
  return title.replace(/^第\s*[0-9一二三四五六七八九十百零]+\s*章[\s:：、.]*/u, "").trim();
}

/**
 * 书名清洗。
 *
 * 真机（2026-10）实测：七猫建书页对书名有字符白名单，前端报错原文是
 * 「仅支持中英文、数字（含罗马数字Ⅰ~Ⅻ）、及，：！？中文标点」——
 * 例如「联调测试书（可删）」里的**全角括号（）会被拒**，`确认创建` 一直灰着。
 *
 * 因此在提交前按白名单过滤并截断到 18 字（平台的 `maxlength`）。
 * 返回 `{ title, changed }`，`changed=true` 时调用方应在结果里提示用户。
 */
export const BOOK_TITLE_MAX = 18;
export function cleanBookTitle(raw: string, maxLen = BOOK_TITLE_MAX): { title: string; changed: boolean } {
  const src = String(raw ?? "");
  // 白名单：汉字（含扩展 A）/ 罗马数字 / 英数 / 空格 / 平台明示允许的中文标点
  const cleaned = src
    .replace(/[^\u3400-\u4dbf\u4e00-\u9fff\u2160-\u216b\u3007A-Za-z0-9 ，：！？]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
  return { title: cleaned, changed: cleaned !== src.trim() };
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
