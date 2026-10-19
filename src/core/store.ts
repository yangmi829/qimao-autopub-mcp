import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, ensureDirs } from "./paths.js";
import { logger } from "./logger.js";

/**
 * 轻量 JSON 文档存储（原子写 tmp -> rename）。
 * 不用 SQLite：原生模块在 Windows 需要编译工具链，而 MCP 以子进程方式被拉起，
 * 任何安装/启动失败都会让整组工具不可用。本场景数据量极小，JSON 足够且便于人工查看。
 */
export class Collection<T extends { id: string }> {
  private cache: T[] | null = null;
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(readonly name: string) {}

  private get file(): string {
    return path.join(DATA_DIR, `${this.name}.json`);
  }

  private async load(): Promise<T[]> {
    if (this.cache) return this.cache;
    ensureDirs();
    try {
      const raw = await fs.readFile(this.file, "utf-8");
      const parsed = JSON.parse(raw);
      this.cache = Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        logger.warn(`读取 ${this.name}.json 失败，将以空集合启动: ${(e as Error).message}`);
      }
      this.cache = [];
    }
    return this.cache;
  }

  private persist(items: T[]): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      ensureDirs();
      const tmp = `${this.file}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(items, null, 2), "utf-8");
      await fs.rename(tmp, this.file);
    });
    return this.writeChain as Promise<void>;
  }

  async all(): Promise<T[]> {
    return [...(await this.load())];
  }

  async get(id: string): Promise<T | undefined> {
    return (await this.load()).find((i) => i.id === id);
  }

  async filter(pred: (item: T) => boolean): Promise<T[]> {
    return (await this.load()).filter(pred);
  }

  async insert(item: T): Promise<T> {
    const items = await this.load();
    items.push(item);
    this.cache = items;
    await this.persist(items);
    return item;
  }

  async update(id: string, patch: Partial<T>): Promise<T> {
    const items = await this.load();
    const idx = items.findIndex((i) => i.id === id);
    if (idx < 0) throw new Error(`${this.name} 中不存在 id=${id}`);
    const merged = { ...items[idx], ...patch } as T;
    items[idx] = merged;
    this.cache = items;
    await this.persist(items);
    return merged;
  }

  async remove(id: string): Promise<boolean> {
    const items = await this.load();
    const idx = items.findIndex((i) => i.id === id);
    if (idx < 0) return false;
    items.splice(idx, 1);
    this.cache = items;
    await this.persist(items);
    return true;
  }
}

export const novels = new Collection<import("../types.js").Novel>("novels");
export const shortStories = new Collection<import("../types.js").ShortStory>("short_stories");
export const articles = new Collection<import("../types.js").Article>("articles");
export const tasks = new Collection<import("../types.js").PublishTask>("publish_tasks");

let counter = 0;

export function newId(prefix: string): string {
  counter = (counter + 1) % 1000;
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${prefix}_${stamp}${counter.toString(36)}${rand}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
