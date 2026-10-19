import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

/**
 * cwd 在 MCP 子进程里是不可靠的（客户端拉起时目录不确定），
 * 因此所有路径一律基于模块自身位置解析，绝不使用 process.cwd()。
 * dist/core/paths.js -> ../../ 即项目根目录。
 */
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = path.resolve(MODULE_DIR, "..", "..");

/**
 * 包版本：唯一真源是 `package.json`（`npm version` 会改它）。
 * 不要在 index.ts 里写死版本号——发版忘改会让 /health、MCP `serverInfo` 与启动日志一起报旧版本。
 */
export const PACKAGE_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf-8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

/** 用户级数据目录：npm / npx 安装时包目录在 npm 缓存里（会被清掉），数据绝不能放那儿。 */
export const USER_DATA_DIR = path.join(os.homedir(), ".qimao-autopub");

export type DataDirSource = "env" | "project" | "user";

/**
 * 数据目录解析顺序（保证同一份 cookies / 文稿始终只落一处）：
 * 1) `QIMAO_DATA_DIR`（显式指定，最高优先）
 * 2) `<项目根>/data`：仓库内运行 / clone 用法（`data/.gitkeep` 已把目录建出来），历史行为不变
 * 3) `~/.qimao-autopub`：npm / npx 安装（发布包不含 `data/`，包目录会被缓存清理）
 */
function resolveDataDir(): { dir: string; source: DataDirSource } {
  const explicit = process.env.QIMAO_DATA_DIR;
  if (explicit) return { dir: explicit, source: "env" };

  const inProject = path.join(PROJECT_ROOT, "data");
  if (fs.existsSync(inProject)) return { dir: inProject, source: "project" };

  return { dir: USER_DATA_DIR, source: "user" };
}

const DATA_RESOLVED = resolveDataDir();

export const DATA_DIR = DATA_RESOLVED.dir;

/** 数据目录是怎么定下来的（env / project / user）；排障与启动日志用。 */
export const DATA_DIR_SOURCE = DATA_RESOLVED.source;

export const EXPORT_DIR = process.env.QIMAO_EXPORT_DIR || path.join(DATA_DIR, "export");

export const SHOT_DIR = path.join(DATA_DIR, "screenshots");

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function ensureDirs(): void {
  ensureDir(DATA_DIR);
  ensureDir(EXPORT_DIR);
  ensureDir(SHOT_DIR);
}

/**
 * 解析用户传入的文件/目录路径（工作稿在仓库外，所以不能用 cwd 兜底）。
 * 绝对路径原样返回；相对路径依次按「项目根」「项目根的上一级（工作区根）」尝试，
 * 命中即返回，都不存在则返回第一个候选，交由调用方报错时展示。
 */
export function resolveLoosePath(p: string): string {
  if (path.isAbsolute(p)) return p;
  const candidates = [path.resolve(PROJECT_ROOT, p), path.resolve(PROJECT_ROOT, "..", p)];
  return candidates.find((c) => fs.existsSync(c)) ?? candidates[0];
}
