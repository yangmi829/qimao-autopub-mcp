import fs from "node:fs";
import { novels, nowIso } from "../core/store.js";
import { resolveLoosePath } from "../core/paths.js";
import { logger } from "../core/logger.js";
import type { Novel } from "../types.js";

/**
 * 本地小说登记（data/novels.json）的**纯本地**读写。
 * 与 services/book.ts 的区别：那里全是驱动七猫后台的真实网络操作，这里不触网。
 */

export interface UpdateNovelInput {
  novelId: string;
  title?: string;
  /** 频道：1=男频，0=女频 */
  gender?: number;
  author?: string;
  abstract?: string;
  protagonist1?: string;
  protagonist2?: string;
  /** 七猫作品分类（一级/二级） */
  category?: string;
  tags?: string[];
  qimaoBookId?: string;
  qimaoBookName?: string;
  /** 赛道 key，参见 list_genres / qimao://genres */
  genre?: string;
  synopsis?: string;
  outline?: string;
  worldSetting?: string;
  goldenHook?: string;
  characters?: Novel["characters"];
  targetWordsPerChapter?: number;
  status?: string;
  /** 长文本改用文件传入（UTF-8），与同名字段二选一；相对路径按「工作区根」解析 */
  synopsisFile?: string;
  outlineFile?: string;
  worldSettingFile?: string;
  goldenHookFile?: string;
  /** 人物设定 JSON 文件：[{ name, role?, traits? }] */
  charactersFile?: string;
}

export interface UpdateNovelResult {
  ok: boolean;
  action: "updated" | "error";
  message: string;
  novel?: Novel;
  /** 本次实际写入的字段名 */
  changed?: string[];
  wordCounts?: Record<string, number>;
}

function readTextFile(file: string, label: string): string {
  const p = resolveLoosePath(file);
  if (!fs.existsSync(p)) throw new Error(`${label}文件不存在：${p}`);
  return fs.readFileSync(p, "utf-8");
}

function countChars(text: string): number {
  return text.replace(/\s/g, "").length;
}

/**
 * 更新本地小说的登记信息与创作设定。
 * 只覆盖显式传入的字段；未传的保持原值（因此不会把已有大纲/人物清空）。
 */
export async function updateNovel(input: UpdateNovelInput): Promise<UpdateNovelResult> {
  const novel = await novels.get(input.novelId);
  if (!novel) return { ok: false, action: "error", message: `未找到本地小说 novel_id=${input.novelId}` };

  const patch: Partial<Novel> = {};
  const changed: string[] = [];
  const wordCounts: Record<string, number> = {};

  const setIf = (key: keyof Novel, value: unknown): void => {
    if (value === undefined) return;
    (patch as Record<string, unknown>)[key] = value;
    changed.push(String(key));
    if (typeof value === "string" && value.length > 200) wordCounts[String(key)] = countChars(value);
  };

  try {
    setIf("title", input.title?.trim() || undefined);
    setIf("gender", input.gender);
    setIf("author", input.author);
    setIf("abstract", input.abstract);
    setIf("protagonist1", input.protagonist1);
    setIf("protagonist2", input.protagonist2);
    setIf("category", input.category);
    setIf("tags", input.tags);
    setIf("qimaoBookId", input.qimaoBookId);
    setIf("qimaoBookName", input.qimaoBookName);
    setIf("genre", input.genre);
    setIf("synopsis", input.synopsis ?? (input.synopsisFile ? readTextFile(input.synopsisFile, "synopsis") : undefined));
    setIf("outline", input.outline ?? (input.outlineFile ? readTextFile(input.outlineFile, "outline") : undefined));
    setIf(
      "worldSetting",
      input.worldSetting ?? (input.worldSettingFile ? readTextFile(input.worldSettingFile, "worldSetting") : undefined)
    );
    setIf("goldenHook", input.goldenHook ?? (input.goldenHookFile ? readTextFile(input.goldenHookFile, "goldenHook") : undefined));
    const characters =
      input.characters ?? (input.charactersFile ? (JSON.parse(readTextFile(input.charactersFile, "characters")) as Novel["characters"]) : undefined);
    setIf("characters", characters);
    setIf("targetWordsPerChapter", input.targetWordsPerChapter);
    setIf("status", input.status);
  } catch (e) {
    return { ok: false, action: "error", message: (e as Error).message };
  }

  if (!changed.length) return { ok: false, action: "error", message: "没有提供任何要修改的字段。" };

  patch.updatedAt = nowIso();
  const updated = await novels.update(input.novelId, patch);
  logger.info(`[localNovel] 更新 ${updated.id}《${updated.title}》字段：${changed.join(", ")}`);
  return {
    ok: true,
    action: "updated",
    message: `已更新本地小说《${updated.title}》字段：${changed.join(", ")}。`,
    novel: updated,
    changed,
    wordCounts: Object.keys(wordCounts).length ? wordCounts : undefined,
  };
}
