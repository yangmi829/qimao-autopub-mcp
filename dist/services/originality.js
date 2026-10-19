/**
 * 本地原创性 / AI 味检测。
 *
 * 不依赖任何外部查重 API（成本高且需联网）。用三组信号综合判断：
 *  1. 与本书历史章节、其它作品的 n-gram 相似度 —— 抓"自己抄自己"和模版化复用
 *  2. 章节内部重复度 —— 抓 AI 常见的自我复读
 *  3. AI 味启发式 —— 抓段落过于均匀、套话密集、对话占比过低等特征
 */
const DEFAULT_THRESHOLD = 0.25;
/** 常见的 AI 生成套话 */
const CLICHE_PATTERNS = [
    "首先", "其次", "再次", "最后", "总的来说", "总而言之", "综上所述",
    "不禁", "不由得", "仿佛", "似乎", "似乎在", "这一刻", "那一刻",
    "眼神中闪过", "嘴角勾起", "嘴角上扬", "深吸一口气", "沉默了片刻",
    "缓缓开口", "轻声说道", "冷冷地说", "淡淡地说", "意味深长",
    "如释重负", "五味杂陈", "百感交集", "心中一凛", "心头一震",
    "仿佛整个世界", "在这一瞬间", "命运的齿轮", "注定不平凡",
];
export function analyzeOriginality(content, corpus = [], threshold = DEFAULT_THRESHOLD) {
    const clean = normalize(content);
    const wordCount = countCjk(content);
    let corpusSimilarity = 0;
    let matchedChapterId;
    for (const item of corpus) {
        const other = normalize(item.text);
        if (other.length < 200)
            continue;
        const sim = ngramSimilarity(clean, other, 5);
        if (sim > corpusSimilarity) {
            corpusSimilarity = sim;
            matchedChapterId = item.id;
        }
    }
    const selfRepetition = selfRepetitionRate(clean, 8);
    const dialogueRatio = calcDialogueRatio(content);
    const paragraphLengthCv = calcParagraphCv(content);
    const aiSmell = calcAiSmell({
        selfRepetition,
        dialogueRatio,
        paragraphLengthCv,
        content,
    });
    // 综合：语料相似度权重最高，AI 味与复读作为放大项
    const similarity = clamp01(corpusSimilarity * 0.6 + selfRepetition * 0.25 + aiSmell * 0.15);
    const findings = [];
    const suggestions = [];
    if (corpusSimilarity > threshold) {
        findings.push(`与已有章节相似度偏高（${pct(corpusSimilarity)}${matchedChapterId ? `，最接近 ${matchedChapterId}` : ""}）`);
        suggestions.push("重写本章开头与高潮段，更换具体事件与场景，保留主线目标。");
    }
    if (selfRepetition > 0.12) {
        findings.push(`章节内部 8 字片段重复率 ${pct(selfRepetition)}，存在自我复读`);
        suggestions.push("删掉重复的解释性段落，把信息压缩进动作和对话里。");
    }
    if (dialogueRatio < 0.15) {
        findings.push(`对话占比仅 ${pct(dialogueRatio)}，叙述过密`);
        suggestions.push("把说明性叙述改成人物对话，免费阅读平台读者偏好高对话密度。");
    }
    if (paragraphLengthCv < 0.35) {
        findings.push(`段落长度过于均匀（变异系数 ${paragraphLengthCv.toFixed(2)}），机械感强`);
        suggestions.push("打破段落均齐：关键处用短句单独成段，长段用于铺陈。");
    }
    if (aiSmell > 0.4) {
        findings.push(`AI 套话密度偏高（${pct(aiSmell)}）`);
        suggestions.push("替换掉模板化的情绪描写（如「眼神中闪过」「不禁」），改用具体动作。");
    }
    if (wordCount < 1800) {
        findings.push(`正文仅 ${wordCount} 字，低于日更经验门槛`);
        suggestions.push("补充一个完整的冲突回合，目标 2000-3000 字。");
    }
    if (findings.length === 0) {
        findings.push("未发现明显的重复或 AI 味问题");
    }
    if (suggestions.length === 0) {
        suggestions.push("可以进入发布环节。");
    }
    return {
        similarity: round(similarity),
        passed: similarity < threshold,
        threshold,
        metrics: {
            corpusSimilarity: round(corpusSimilarity),
            matchedChapterId,
            selfRepetition: round(selfRepetition),
            aiSmell: round(aiSmell),
            dialogueRatio: round(dialogueRatio),
            paragraphLengthCv: round(paragraphLengthCv),
            wordCount,
        },
        findings,
        suggestions,
    };
}
/* ----------------------------- 内部算法 ----------------------------- */
function normalize(text) {
    return text
        .replace(/\s+/g, "")
        .replace(/[，。！？；：、“”‘’（）《》…—·,.!?;:()"'`~\[\]{}<>|\-_/\\]/g, "");
}
function countCjk(text) {
    return (text.match(/[\u4e00-\u9fa5]/g) || []).length;
}
function ngrams(s, n) {
    const set = new Set();
    for (let i = 0; i + n <= s.length; i++)
        set.add(s.slice(i, i + n));
    return set;
}
/** Jaccard + 覆盖率混合，对局部抄袭更敏感 */
function ngramSimilarity(a, b, n) {
    if (a.length < n || b.length < n)
        return 0;
    const ga = ngrams(a, n);
    const gb = ngrams(b, n);
    const sample = ga.size <= gb.size ? ga : gb;
    const other = ga.size <= gb.size ? gb : ga;
    let inter = 0;
    for (const g of sample)
        if (other.has(g))
            inter++;
    if (sample.size === 0)
        return 0;
    const jaccard = inter / (ga.size + gb.size - inter || 1);
    const coverage = inter / sample.size;
    return clamp01(jaccard * 0.4 + coverage * 0.6);
}
function selfRepetitionRate(s, n) {
    if (s.length < n * 4)
        return 0;
    const seen = new Map();
    let total = 0;
    for (let i = 0; i + n <= s.length; i++) {
        const g = s.slice(i, i + n);
        seen.set(g, (seen.get(g) || 0) + 1);
        total++;
    }
    let dup = 0;
    for (const c of seen.values())
        if (c > 1)
            dup += c - 1;
    return total ? dup / total : 0;
}
function calcDialogueRatio(text) {
    const lines = text.split("\n").filter((l) => l.trim());
    const dialogueChars = (text.match(/[“"][^”"]{2,}[”"]/g) || []).reduce((sum, s) => sum + s.length, 0);
    const total = countCjk(text) || 1;
    const ratio = dialogueChars / total;
    return lines.length ? clamp01(Math.min(1, ratio * 1.4)) : clamp01(ratio);
}
function calcParagraphCv(text) {
    const paras = text
        .split(/\n+/)
        .map((p) => p.trim().length)
        .filter((l) => l > 0);
    if (paras.length < 3)
        return 0;
    const mean = paras.reduce((a, b) => a + b, 0) / paras.length;
    if (mean === 0)
        return 0;
    const variance = paras.reduce((a, b) => a + (b - mean) ** 2, 0) / paras.length;
    return Math.sqrt(variance) / mean;
}
function calcAiSmell(input) {
    const { content } = input;
    const cjk = countCjk(content) || 1;
    let clicheHits = 0;
    for (const p of CLICHE_PATTERNS) {
        const m = content.split(p).length - 1;
        clicheHits += m;
    }
    const clicheDensity = clamp01(clicheHits / (cjk / 1000) / 12);
    const uniformity = clamp01(1 - input.paragraphLengthCv / 0.6);
    const lowDialogue = clamp01(1 - input.dialogueRatio / 0.35);
    const repetition = clamp01(input.selfRepetition / 0.2);
    return clamp01(clicheDensity * 0.4 + uniformity * 0.25 + lowDialogue * 0.2 + repetition * 0.15);
}
function clamp01(v) {
    return Math.max(0, Math.min(1, v));
}
function round(v) {
    return Math.round(v * 1000) / 1000;
}
function pct(v) {
    return `${(v * 100).toFixed(1)}%`;
}
