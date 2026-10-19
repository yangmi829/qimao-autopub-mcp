/**
 * 网文赛道知识库。
 * 内容来自本工作区的赛道分析整理（爆款拆解、类型分类推荐等），
 * 用于在生成 prompt 时注入赛道特有的爽点机制与避坑要求。
 */
export const GENRES = [
    {
        key: "urban_system",
        label: "都市脑洞 · 系统爽文",
        core: "低起点主角（外卖员/保安/打工人）激活有严格规则的金手指。爽感来自「当众被轻视 → 立 Flag → 完成打脸 → 拿奖励」的可重复闭环，且金手指必须有代价、有次数限制。",
        opening: "开篇即冲突，第一章内完成：当众受辱 → 金手指觉醒 → 主角主动抛出一个更大的 Flag。禁止慢热铺垫。",
        rhythm: "每 1-2 章一个小打脸，3-5 章一个中打脸，8-12 章一个大高潮，15-20 章一次卷末决战。每章必须有章末钩子，连续两章无爽点即判定节奏失控。",
        pitfalls: [
            "金手指无代价、无限制，导致后续无敌无张力",
            "反派降智，只会嘴臭不会升级手段",
            "爽点与主线脱节（先爽再补主线）",
            "同一招反复使用，读者疲劳",
        ],
        wordsPerChapter: "2000-3000",
        refs: ["boss 阴到没边，我的系统也是", "系统任务太难？国家：放着我来"],
    },
    {
        key: "urban_rebirth",
        label: "穿越 · 重生",
        core: "重生＝记忆优势 + 情绪宣泄；穿越＝知识降维打击。爽感来自「提前知道结局」的信息差，以及弥补前世遗憾的情绪释放。",
        opening: "第一章直接回到关键决策点前，用前世惨状做对比，迅速建立改变动机。",
        rhythm: "前期密集兑现信息差红利，中期引入前世未知变量打破全知优势，避免无敌化。",
        pitfalls: ["主角全知全能导致无对手", "只复仇不建设，中后期空洞", "前世记忆使用无成本"],
        wordsPerChapter: "2000-3000",
    },
    {
        key: "urban_romance",
        label: "都市言情",
        core: "情绪拉扯 + 身份反差。爽感来自关系位势的反转与被坚定选择的归属感。",
        opening: "第一章建立强关系冲突（误会/重逢/契约），让双方立场立刻对立。",
        rhythm: "每章至少一次情绪转折，暧昧与危机交替，避免平铺直叙的日常。",
        pitfalls: ["为虐而虐", "女主工具人化", "冲突靠误会堆砌、解释即解决"],
        wordsPerChapter: "2000-3000",
    },
    {
        key: "fantasy_cultivation",
        label: "玄幻 · 废柴逆袭 / 扮猪吃虎",
        core: "天才跌落 → 资源被夺 → 暗藏底牌 → 大比反杀。关键是「反派不降智、主角靠智谋而非开挂」，爽感才立得住。",
        opening: "先写跌落谷底的羞辱场景，再亮出隐藏底牌的第一个征兆。",
        rhythm: "小场景打脸密集，长线复仇铺陈，每次胜利都要付出可见代价。",
        pitfalls: ["反派降智", "境界膨胀失控", "打脸套路完全雷同"],
        wordsPerChapter: "2500-3500",
        refs: ["天渊（玄幻版基督山伯爵）", "烟雨楼"],
    },
    {
        key: "urban_martial",
        label: "都市高武 · 灵气复苏",
        core: "特殊能力设定 + 世界观层层揭开 + 反转密集。爽感来自「格局一层层变大」。",
        opening: "以一场超常事件打破日常认知，立刻给出力量体系的第一条规则。",
        rhythm: "每个阶段性胜利都要揭开更大一层世界观，保持信息增量。",
        pitfalls: ["战力体系崩坏", "世界观一次讲完导致后期无悬念", "能力堆砌无克制关系"],
        wordsPerChapter: "2500-3500",
        refs: ["我在精神病院学斩神", "我不是戏神", "时停起手"],
    },
    {
        key: "apocalypse_hoarding",
        label: "末世囤货 · 生存流",
        core: "延迟满足：别人挨冻挨饿，主角早已囤够物资。爽感来自对比与安全屋的确定性。",
        opening: "开篇点明灾难时间点，立刻进入囤货行动，用具体数字制造安心感。",
        rhythm: "囤货 → 灾难降临 → 他人求援 → 选择性施恩，循环推进。",
        pitfalls: ["物资清单流水账", "人性冲突单一重复", "主角囤货过程无阻力"],
        wordsPerChapter: "2000-3000",
        refs: ["冰河末世：我囤积了百亿物资"],
    },
    {
        key: "game_invasion",
        label: "游戏降临 · 掠夺机缘",
        core: "抢占本该属于「原男女主」的机缘，攫取升级资源。爽感直接、节奏密集。",
        opening: "第一章即进入副本/首杀竞争，抢到第一个本不属于自己的资源。",
        rhythm: "副本驱动，每个副本一次资源掠夺 + 一次信息优势兑现。",
        pitfalls: ["副本机制重复", "数值增长无实感", "掠夺对象无记忆点"],
        wordsPerChapter: "2000-3000",
        refs: ["游戏入侵：开局金刚明王功"],
    },
    {
        key: "descent_master",
        label: "下山流 · 都市修真",
        core: "深山高手入都市，打脸快。低门槛解压型，靠身份反差制造爽点。",
        opening: "高手以落魄姿态登场，第一章内被小人物轻视并随手化解。",
        rhythm: "单元剧式打脸，穿插一条身世/师门长线。",
        pitfalls: ["主角全程无敌无悬念", "都市势力反复送人头"],
        wordsPerChapter: "2000-3000",
        refs: ["高手下山，我家师姐太宠我了"],
    },
    {
        key: "rule_horror",
        label: "规则怪谈 · 无限流",
        core: "副本 + 规则求生。爽感来自「读懂规则 → 利用规则反杀」，逻辑必须自洽。",
        opening: "第一章直接抛出规则文本与第一次违规后果，建立压迫感。",
        rhythm: "每个副本：拿到规则 → 试错 → 归纳 → 破局，破局后揭示更大规则层。",
        pitfalls: ["规则前后矛盾", "恐怖氛围靠形容词堆砌", "副本难度曲线混乱"],
        wordsPerChapter: "2500-3500",
        refs: ["十日终焉", "诡舍"],
    },
    {
        key: "suspense_thriller",
        label: "悬疑推理 · 罪案",
        core: "悬念叠加，靠信息差与线索回收制造张力。注意：这类不是爽文，追求的是压迫感不是释放感。",
        opening: "第一章抛出核心谜面与一个反常细节，让读者立刻产生疑问。",
        rhythm: "每章回收一个小线索、抛出新疑点，线索必须可回溯、不可作弊。",
        pitfalls: ["线索未前置，结局硬解谜", "靠巧合推进", "人物动机薄弱"],
        wordsPerChapter: "2000-3000",
        refs: ["罪名不朽"],
    },
    {
        key: "female_rebirth_era",
        label: "女频 · 重生年代 / 种田基建",
        core: "回到物资匮乏年代，靠现代知识与勤劳改善生活。爽感是确定感与积累感。",
        opening: "开篇点明年代与困境，用一件具体小事展示现代知识的价值。",
        rhythm: "事业线稳定积累 + 家庭关系小额冲突，避免大起大落的突兀转折。",
        pitfalls: ["年代细节失真", "金手指过大失去真实感", "感情线喧宾夺主"],
        wordsPerChapter: "2000-3000",
    },
    {
        key: "female_revenge",
        label: "女频 · 马甲文 / 大女主复仇",
        core: "隐藏实力（马甲）逐个揭开，每一次掉马都是一次打脸高潮。",
        opening: "第一章建立「被低估」处境，埋下第一个身份伏笔。",
        rhythm: "控制掉马节奏，每次揭开一个身份解决一类危机，最后身份合一。",
        pitfalls: ["马甲过多难以收束", "掉马过早失去悬念", "复仇动机单薄"],
        wordsPerChapter: "2000-3000",
        refs: ["桃花马上请长缨", "蓄意逐风"],
    },
];
export const GENRE_KEYS = GENRES.map((g) => g.key);
export function getGenre(key) {
    return GENRES.find((g) => g.key === key);
}
export function findGenreByLabel(text) {
    const t = text.toLowerCase();
    return (GENRES.find((g) => g.key === t) ||
        GENRES.find((g) => g.label.includes(text)) ||
        GENRES.find((g) => text.includes(g.label.split(" ")[0])));
}
/** 把赛道知识渲染成可注入 prompt 的 Markdown 片段 */
export function renderGenreGuidance(key) {
    const g = getGenre(key);
    if (!g) {
        return `赛道：${key}（未收录，按通用网文要求创作：开篇即冲突、每章有钩子、爽点密集）`;
    }
    return [
        `## 赛道：${g.label}`,
        `- 核心爽点机制：${g.core}`,
        `- 开篇要求：${g.opening}`,
        `- 节奏要求：${g.rhythm}`,
        `- 建议单章字数：${g.wordsPerChapter}`,
        `- 必须避开：\n${g.pitfalls.map((p) => `  - ${p}`).join("\n")}`,
        g.refs?.length ? `- 可参考的标杆作品：${g.refs.join("、")}` : "",
    ]
        .filter(Boolean)
        .join("\n");
}
