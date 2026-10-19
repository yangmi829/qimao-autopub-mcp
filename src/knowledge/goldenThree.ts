/**
 * 「黄金三章」方法论。免费阅读 + 广告分成模式的作品，
 * 前三章的跳出率直接决定后续推荐量，所以单独固化成检查清单。
 */

export interface GoldenRule {
  chapter: number;
  goals: string[];
  must: string[];
  avoid: string[];
}

export const GOLDEN_RULES: GoldenRule[] = [
  {
    chapter: 1,
    goals: ["让读者在 300 字内知道主角是谁、处境多糟、想要什么", "完成一次「受辱 → 觉醒/转折」", "抛出本章最大的 Flag"],
    must: [
      "开头第一句是有画面的动作或冲突，不要环境描写、不要自我介绍",
      "第一章内让主角主动提出一个更大的目标，被动受气会流失读者",
      "章末落在悬念上，不落在情绪宣泄上",
    ],
    avoid: ["大段世界观说明", "人物表式登场", "慢热铺垫超过 500 字"],
  },
  {
    chapter: 2,
    goals: ["把冲突从私人层面扩大到公开层面", "让更多人「不信」主角，扩大见证池", "给出完成条件与失败的代价"],
    must: [
      "嘲讽/质疑必须扩散，围观者数量要具体",
      "明确写出失败代价，代价越具体张力越强",
      "章末出现第一个不可控变量",
    ],
    avoid: ["主角自证清白的长篇解释", "冲突原地打转没有升级"],
  },
  {
    chapter: 3,
    goals: ["完成第一章抛出的 Flag", "兑现爽点并跳档（倍率/层级/目击规模）", "引出更高级反派与主线钩子"],
    must: [
      "解法靠资源整合或智谋，不能靠系统直接给答案",
      "最后一分钟才达成，中途至少一次看似失败",
      "章末抛出指向主线的情报或人物签名",
    ],
    avoid: ["反派突然降智送人头", "爽完就结束，不带出下一阶段目标"],
  },
];

export const COMMON_RHYTHM = [
  "每章 2000-3000 字，段落短，对话多，少形容词",
  "每章必须有章末钩子",
  "每 1-2 章一个小爽点，3-5 章一个中爽点，8-12 章一个大高潮",
  "连续两章无爽点即判定节奏失控，需要重写",
  "每一次爽点都必须顺手推进主线，不允许「先爽再讲主线」",
];

export function renderGoldenThree(): string {
  const body = GOLDEN_RULES.map((r) =>
    [
      `### 第 ${r.chapter} 章`,
      `目标：\n${r.goals.map((g) => `  - ${g}`).join("\n")}`,
      `必须做到：\n${r.must.map((m) => `  - ${m}`).join("\n")}`,
      `不要出现：\n${r.avoid.map((a) => `  - ${a}`).join("\n")}`,
    ].join("\n")
  ).join("\n\n");

  return [
    "## 黄金三章（前三章决定推荐量，必须逐条满足）",
    body,
    `\n### 通用节奏\n${COMMON_RHYTHM.map((c) => `- ${c}`).join("\n")}`,
  ].join("\n");
}

export function renderGoldenChecklist(chapterNumber: number): string {
  const rule = GOLDEN_RULES.find((r) => r.chapter === chapterNumber);
  if (!rule) return "";
  return [
    `## 第 ${rule.chapter} 章专项要求`,
    `目标：\n${rule.goals.map((g) => `- ${g}`).join("\n")}`,
    `必须做到：\n${rule.must.map((m) => `- ${m}`).join("\n")}`,
    `不要出现：\n${rule.avoid.map((a) => `- ${a}`).join("\n")}`,
  ].join("\n");
}
