/** 本地文稿库条目（用户写好的正文，MCP 只负责入库与上传） */
export interface Article {
  id: string;
  /** chapter=小说章节；short=短篇正文 */
  kind: "chapter" | "short";
  title: string;
  content: string;
  wordCount: number;
  /** chapter 归属的本地小说 id */
  novelId?: string;
  /** chapter 的章节号 */
  chapterNumber?: number;
  status: "draft" | "published" | "failed";
  /** 七猫作品 book_id（小说） */
  qimaoBookId?: string;
  publishTime?: string;
  /** 最近一次发布的说明/错误 */
  lastMessage?: string;
  /** 最近一次原创度检测的综合相似度（0~1，越低越原创） */
  originalityScore?: number;
  createdAt: string;
  updatedAt: string;
}

/** 本地小说登记（用于给建书/发章提供默认值，并绑定七猫 book_id；也保留创作设定） */
export interface Novel {
  id: string;
  title: string;
  /** 频道：1=男频，0=女频 */
  gender: number;
  author?: string;
  abstract?: string;
  protagonist1?: string;
  protagonist2?: string;
  /** 七猫作者后台 book_id */
  qimaoBookId?: string;
  qimaoBookName?: string;
  /** 七猫作品分类（一级/二级）与标签 */
  category?: string;
  tags?: string[];
  /** 赛道 key（如 urban_system），参见 list_genres / qimao://genres */
  genre?: string;
  /** 一句话简介 / 核心卖点 */
  synopsis?: string;
  /** 全书大纲 */
  outline?: string;
  /** 世界观设定 */
  worldSetting?: string;
  /** 开篇钩子 */
  goldenHook?: string;
  /** 主要人物设定 */
  characters?: { name: string; role?: string; traits?: string }[];
  /** 单章目标字数 */
  targetWordsPerChapter?: number;
  /** 本地创作状态标记 */
  status?: string;
  createdAt: string;
  updatedAt: string;
}

/** 本地短篇登记 */
export interface ShortStory {
  id: string;
  title: string;
  abstract?: string;
  category?: string;
  /** 七猫短篇 book_id */
  qimaoBookId?: string;
  status: "draft" | "published" | "failed";
  createdAt: string;
  updatedAt: string;
}

/** 发布任务日志 */
export interface PublishTask {
  id: string;
  kind: "novel" | "chapter" | "short";
  targetId?: string;
  title?: string;
  status: "pending" | "done" | "failed";
  mode: "upload" | "batch";
  message?: string;
  scheduledTime?: string;
  screenshotPath?: string;
  createdAt: string;
  updatedAt: string;
}
