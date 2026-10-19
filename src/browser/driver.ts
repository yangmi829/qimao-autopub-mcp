import { createRequire } from "node:module";
import fs from "node:fs";
import { logger } from "../core/logger.js";

/**
 * 浏览器驱动。
 * 优先完整版 puppeteer（自带 Chromium），否则 puppeteer-core + 本机 Chrome/Edge
 * —— 省掉约 150MB 的 Chromium 下载。
 *
 * 七猫的读取走纯 HTTP（见 browser/endpoints.ts），只有「写操作」与「半自动登录」需要浏览器；
 * 关闭浏览器能力时，只读工具与本地工具仍可正常使用。
 */

// page.evaluate 的回调运行在浏览器上下文
declare const document: any;
declare const window: any;
declare const Event: any;

// 用变量做 specifier，避免 TS 在编译期解析这些可选依赖（未装类型会报 TS2307）
const PUPPETEER = "puppeteer";
const PUPPETEER_CORE = "puppeteer-core";

const require_ = createRequire(import.meta.url);

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 浏览器总开关：QIMAO_ENABLE_BROWSER 显式为 0/false 时关闭 */
export function browserEnabled(): boolean {
  const v = (process.env.QIMAO_ENABLE_BROWSER ?? "").toLowerCase();
  return !(v === "0" || v === "false" || v === "off");
}

/** 本机浏览器候选路径（Windows 常见安装位置） */
const BROWSER_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

export function detectBrowser(): string | undefined {
  if (process.env.QIMAO_CHROME_PATH) return process.env.QIMAO_CHROME_PATH;
  for (const p of BROWSER_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

export interface Driver {
  mod: any;
  executablePath?: string;
}

export async function loadPuppeteer(): Promise<Driver> {
  try {
    const mod = (await import(PUPPETEER)).default;
    return { mod };
  } catch {
    // 继续尝试 puppeteer-core
  }
  try {
    const mod = (await import(PUPPETEER_CORE)).default;
    const executablePath = detectBrowser();
    if (!executablePath) {
      throw new Error(
        "未找到本机浏览器。设置 QIMAO_CHROME_PATH 指向 chrome.exe，或安装 puppeteer（自带 Chromium）。"
      );
    }
    return { mod, executablePath };
  } catch (e) {
    throw new Error(
      `缺少浏览器驱动：${(e as Error).message}\n` +
        "解决方式（任选一）：npm i puppeteer-core 并确保本机有 Chrome/Edge，或 npm i puppeteer。"
    );
  }
}

export function puppeteerAvailable(): boolean {
  try {
    require_.resolve(PUPPETEER);
    return true;
  } catch {
    try {
      require_.resolve(PUPPETEER_CORE);
      return Boolean(detectBrowser());
    } catch {
      return false;
    }
  }
}

export function driverName(): string {
  try {
    require_.resolve(PUPPETEER);
    return "puppeteer";
  } catch {
    try {
      require_.resolve(PUPPETEER_CORE);
      return `puppeteer-core + ${detectBrowser() ?? "未找到浏览器"}`;
    } catch {
      return "未安装";
    }
  }
}

export const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-blink-features=AutomationControlled",
];

export async function launchBrowser(headless: boolean, driver?: Driver): Promise<any> {
  const d = driver ?? (await loadPuppeteer());
  logger.debug(`启动浏览器 headless=${headless} driver=${d.executablePath ?? "内置 Chromium"}`);
  return d.mod.launch({
    headless,
    executablePath: d.executablePath,
    protocolTimeout: 180000,
    args: LAUNCH_ARGS,
  });
}

/** 截图并返回绝对路径（失败不抛错） */
export async function shot(page: any, tag: string): Promise<string> {
  try {
    const { SHOT_DIR, ensureDir } = await import("../core/paths.js");
    ensureDir(SHOT_DIR);
    const file = `${SHOT_DIR}\\${tag}-${Date.now()}.png`;
    await page.screenshot({ path: file });
    return file;
  } catch {
    return "";
  }
}
