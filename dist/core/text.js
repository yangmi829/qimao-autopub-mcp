/** 中文正文字数统计：汉字按字计，英文单词折算 */
export function countCjk(text) {
    const cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const words = (text.match(/[A-Za-z]+/g) || []).length;
    return cjk + Math.round(words / 1.6);
}
/**
 * markdown 正文 -> 纯文本。
 * 富文本编辑器会把 `**` / `---` / ``` / `>` 当字面字符渲染，
 * 所以上传前必须剥掉 markdown 标记，否则正文里会出现一堆星号、横线。
 */
export function toPlainText(text) {
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
export function stripHtml(html) {
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
export function cleanChapterTitle(title) {
    return title.replace(/^第\s*[0-9一二三四五六七八九十百零]+\s*章[\s:：、.]*/u, "").trim();
}
export function pad2(n) {
    return String(n).padStart(2, "0");
}
