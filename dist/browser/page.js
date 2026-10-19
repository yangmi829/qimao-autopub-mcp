/**
 * 通用页面交互工具。
 *
 * 写操作全部驱动真实页面（七猫的写接口同样带签名，且部分还有前端校验与二次确认），
 * 这里集中放置「像人一样操作」的工具函数，避免各 service 重复实现。
 */
import { sleep } from "./driver.js";
import { logger } from "../core/logger.js";
/**
 * 真实鼠标点击：**必须先 scrollIntoView 再取 boundingBox**。
 * boundingBox() 给的是文档坐标，编辑页很长时直接 mouse.click 点的是视口外的空气
 * ——元素看起来「没反应」，其实根本没点上。
 */
export async function realClick(page, selector) {
    const handle = await page.$(selector);
    if (!handle)
        return false;
    try {
        await handle.evaluate((el) => el.scrollIntoView({ block: "center", inline: "center" }));
        await sleep(120);
        const box = await handle.boundingBox();
        if (!box) {
            // 元素不可见（display:none 等），退回 JS 点击
            await handle.evaluate((el) => el.click());
            return true;
        }
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        return true;
    }
    catch (e) {
        logger.debug(`realClick(${selector}) 失败: ${e.message}`);
        return false;
    }
}
/** 按可见文本找元素并真实点击（用于没有稳定选择器的按钮/选项） */
export async function realClickText(page, text, opts = {}) {
    const tags = opts.tags ?? ["button", "a", "li", "div", "span", "p", "label", "i"];
    const handle = await page.evaluateHandle((t, ts, exact, nth) => {
        const wanted = t.trim();
        const all = [];
        for (const tag of ts)
            for (const el of Array.from(document.querySelectorAll(tag))) {
                const txt = (el.innerText ?? el.textContent ?? "").trim();
                if (!txt)
                    continue;
                if (exact ? txt === wanted : txt.includes(wanted)) {
                    // 只保留最内层可见元素，避免点到外层容器
                    const rect = el.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0)
                        all.push(el);
                }
            }
        all.sort((a, b) => (a.innerText?.length ?? 0) - (b.innerText?.length ?? 0));
        return all[nth] ?? null;
    }, text, tags, opts.exact ?? false, opts.nth ?? 0);
    const el = handle.asElement();
    if (!el)
        return false;
    try {
        await el.evaluate((n) => n.scrollIntoView({ block: "center", inline: "center" }));
        await sleep(120);
        const box = await el.boundingBox();
        if (!box) {
            await el.evaluate((n) => n.click());
            return true;
        }
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        return true;
    }
    catch (e) {
        logger.debug(`realClickText(${text}) 失败: ${e.message}`);
        return false;
    }
}
/** 清空并输入文本（先聚焦、全选、删除，避免与默认值拼接） */
export async function fillInput(page, selector, value) {
    const handle = await page.$(selector);
    if (!handle)
        return false;
    try {
        await handle.evaluate((el) => el.scrollIntoView({ block: "center" }));
        await handle.click({ clickCount: 3 });
        await page.keyboard.down("Control");
        await page.keyboard.press("KeyA");
        await page.keyboard.up("Control");
        await page.keyboard.press("Backspace");
        await handle.type(value, { delay: 8 });
        return true;
    }
    catch (e) {
        logger.debug(`fillInput(${selector}) 失败: ${e.message}`);
        return false;
    }
}
/** 读取元素文本（不存在返回空串） */
export async function textOf(page, selector) {
    try {
        return (await page.$eval(selector, (el) => (el.innerText ?? el.textContent ?? "").trim()));
    }
    catch {
        return "";
    }
}
/** 元素是否存在且可见 */
export async function visible(page, selector) {
    try {
        return (await page.$eval(selector, (el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        }));
    }
    catch {
        return false;
    }
}
/** 等待页面上出现某段文本 */
export async function waitForText(page, text, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const body = await page.evaluate(() => document.body?.innerText ?? "");
        if (String(body).includes(text))
            return true;
        await sleep(300);
    }
    return false;
}
/**
 * 读取当前可见模态框（弹窗）里的文本。
 * ⚠️ 不能用整个 body 的 innerText 做判定——它会包含页面正文 / 编辑器内容，
 * 导致「正文里恰好出现了敏感词」被误判成页面限制（本项目踩过这个坑）。
 */
export async function visibleModalText(page) {
    return (await page.evaluate(() => {
        const sels = [
            ".el-dialog",
            ".el-message-box",
            ".q-dialog",
            ".arco-modal",
            "[role=dialog]",
            ".modal",
        ];
        const parts = [];
        for (const s of sels) {
            for (const el of Array.from(document.querySelectorAll(s))) {
                const r = el.getBoundingClientRect();
                if (r.width > 0 && r.height > 0)
                    parts.push(el.innerText ?? "");
            }
        }
        return parts.join("\n").trim();
    }));
}
