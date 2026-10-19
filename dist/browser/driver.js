import { createRequire } from "node:module";
import fs from "node:fs";
import { logger } from "../core/logger.js";
// 用变量做 specifier，避免 TS 在编译期解析这些可选依赖（未装类型会报 TS2307）
const PUPPETEER = "puppeteer";
const PUPPETEER_CORE = "puppeteer-core";
const require_ = createRequire(import.meta.url);
export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/** 浏览器总开关：QIMAO_ENABLE_BROWSER 显式为 0/false 时关闭 */
export function browserEnabled() {
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
export function detectBrowser() {
    if (process.env.QIMAO_CHROME_PATH)
        return process.env.QIMAO_CHROME_PATH;
    for (const p of BROWSER_CANDIDATES) {
        if (fs.existsSync(p))
            return p;
    }
    return undefined;
}
export async function loadPuppeteer() {
    try {
        const mod = (await import(PUPPETEER)).default;
        return { mod };
    }
    catch {
        // 继续尝试 puppeteer-core
    }
    try {
        const mod = (await import(PUPPETEER_CORE)).default;
        const executablePath = detectBrowser();
        if (!executablePath) {
            throw new Error("未找到本机浏览器。设置 QIMAO_CHROME_PATH 指向 chrome.exe，或安装 puppeteer（自带 Chromium）。");
        }
        return { mod, executablePath };
    }
    catch (e) {
        throw new Error(`缺少浏览器驱动：${e.message}\n` +
            "解决方式（任选一）：npm i puppeteer-core 并确保本机有 Chrome/Edge，或 npm i puppeteer。");
    }
}
export function puppeteerAvailable() {
    try {
        require_.resolve(PUPPETEER);
        return true;
    }
    catch {
        try {
            require_.resolve(PUPPETEER_CORE);
            return Boolean(detectBrowser());
        }
        catch {
            return false;
        }
    }
}
export function driverName() {
    try {
        require_.resolve(PUPPETEER);
        return "puppeteer";
    }
    catch {
        try {
            require_.resolve(PUPPETEER_CORE);
            return `puppeteer-core + ${detectBrowser() ?? "未找到浏览器"}`;
        }
        catch {
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
export async function launchBrowser(headless, driver) {
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
export async function shot(page, tag) {
    try {
        const { SHOT_DIR, ensureDir } = await import("../core/paths.js");
        ensureDir(SHOT_DIR);
        const file = `${SHOT_DIR}\\${tag}-${Date.now()}.png`;
        await page.screenshot({ path: file });
        return file;
    }
    catch {
        return "";
    }
}
