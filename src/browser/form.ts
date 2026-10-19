/**
 * Element-UI 风格表单的操作助手。
 *
 * 七猫后台用的是一套类 Element-UI 的组件库（`.el-form-item` / `.el-input__inner` /
 * `.el-textarea__inner` / `.el-select` / `.el-radio` / `.el-upload`）。
 *
 * 相比「猜 class 名」，「按 label 文本定位表单项」对改版更健壮，因此统一走 label。
 */
import { sleep } from "./driver.js";
import { realClickText, fillInput } from "./page.js";
import { logger } from "../core/logger.js";

/** 在页面里按 label 文本找到对应的 .el-form-item，返回其 DOM 下标（找不到返回 -1） */
async function findFormItemIndex(page: any, label: string, exact = false): Promise<number> {
  return (await page.evaluate(
    (want: string, ex: boolean) => {
      const items = Array.from(document.querySelectorAll(".el-form-item")) as any[];
      for (let i = 0; i < items.length; i++) {
        const lab = items[i].querySelector(".el-form-item__label");
        const txt = (lab?.innerText ?? lab?.textContent ?? "").trim().replace(/[:：*]\s*$/, "");
        if (!txt) continue;
        if (ex ? txt === want : txt.includes(want)) return i;
      }
      return -1;
    },
    label,
    exact
  )) as number;
}

export interface FillResult {
  ok: boolean;
  message: string;
}

/**
 * 按 label 填入文本（input 或 textarea）。
 * 找不到表单项 / 输入框时返回 ok=false，由调用方汇总为「未补齐字段」。
 */
export async function fillByLabel(page: any, label: string, value: string, exact = false): Promise<FillResult> {
  const idx = await findFormItemIndex(page, label, exact);
  if (idx < 0) return { ok: false, message: `未找到表单项「${label}」` };

  const sel = await page.evaluate((i: number) => {
    const items = Array.from(document.querySelectorAll(".el-form-item")) as any[];
    const item = items[i];
    if (!item) return null;
    const box = item.querySelector("textarea.el-textarea__inner, textarea, input.el-input__inner, input");
    if (!box) return null;
    // 给一个稳定的临时 id，供 fillInput 定位
    box.setAttribute("data-qimao-target", "1");
    return "1";
  }, idx);
  if (!sel) return { ok: false, message: `表单项「${label}」内没有可输入的控件` };

  const ok = await fillInput(page, "[data-qimao-target='1']", value);
  await page.evaluate(() => {
    const el = document.querySelector("[data-qimao-target='1']") as any;
    if (el) {
      el.removeAttribute("data-qimao-target");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
    }
  });
  return { ok, message: ok ? `已填入「${label}」` : `填入「${label}」失败` };
}

/** 读取 label 对应表单项的当前值（input.value / 选中文本） */
export async function readByLabel(page: any, label: string): Promise<string> {
  const idx = await findFormItemIndex(page, label);
  if (idx < 0) return "";
  return (await page.evaluate((i: number) => {
    const items = Array.from(document.querySelectorAll(".el-form-item")) as any[];
    const item = items[i];
    if (!item) return "";
    const input = item.querySelector("input, textarea") as any;
    if (input && input.value) return String(input.value);
    return (item.innerText ?? "").trim();
  }, idx)) as string;
}

/** 在表单项内按可见文本点一个元素（单/多选、开关等） */
export async function clickInFormItem(page: any, label: string, optionText: string): Promise<boolean> {
  const idx = await findFormItemIndex(page, label);
  if (idx < 0) return false;
  const marked = await page.evaluate(
    (i: number, want: string) => {
      const items = Array.from(document.querySelectorAll(".el-form-item")) as any[];
      const item = items[i];
      if (!item) return false;
      const cands = Array.from(item.querySelectorAll("*")) as any[];
      const hit = cands.find((el) => {
        const t = (el.innerText ?? el.textContent ?? "").trim();
        const r = el.getBoundingClientRect();
        return t === want && r.width > 0 && r.height > 0;
      });
      if (!hit) return false;
      hit.setAttribute("data-qimao-option", "1");
      return true;
    },
    idx,
    optionText
  );
  if (!marked) return false;
  const done = await realClickText(page, optionText, { exact: true });
  await page.evaluate(() => {
    const el = document.querySelector("[data-qimao-option='1']") as any;
    if (el) el.removeAttribute("data-qimao-option");
  });
  return done;
}

/**
 * 下拉框按 label 选值：点开 `.el-select` → 在浮层里点包含 optionText 的项。
 * 浮层是异步渲染的，必须等选项出现再点。
 */
export async function selectByLabel(page: any, label: string, optionText: string): Promise<boolean> {
  const idx = await findFormItemIndex(page, label);
  if (idx < 0) {
    logger.debug(`selectByLabel: 未找到「${label}」`);
    return false;
  }
  const opened = await page.evaluate((i: number) => {
    const items = Array.from(document.querySelectorAll(".el-form-item")) as any[];
    const item = items[i];
    const trigger = item?.querySelector(".el-select .el-input, .el-select") as any;
    if (!trigger) return false;
    trigger.click();
    return true;
  }, idx);
  if (!opened) return false;

  // 等下拉浮层出现选项
  const deadline = Date.now() + 5000;
  let n = 0;
  while (Date.now() < deadline) {
    n = (await page.evaluate(() => document.querySelectorAll(".el-select-dropdown .el-select-dropdown__item").length)) as number;
    if (n > 0) break;
    await sleep(120);
  }
  if (n === 0) {
    logger.debug(`selectByLabel: 「${label}」的下拉没有出现选项`);
    return false;
  }
  return await realClickText(page, optionText, { tags: ["li", "div", "span"], exact: false });
}

/** 给 label 对应的上传控件选择本地文件（`.el-upload` 内的 input[type=file]） */
export async function uploadByLabel(page: any, label: string, filePath: string): Promise<boolean> {
  const idx = await findFormItemIndex(page, label);
  const handles = await page.$$("input[type=file]");
  if (handles.length === 0) return false;
  // 优先取同一表单项内的 file input
  let target = handles[0];
  if (idx >= 0) {
    const matched = await page.evaluate((i: number) => {
      const items = Array.from(document.querySelectorAll(".el-form-item")) as any[];
      const item = items[i];
      if (!item) return false;
      const input = item.querySelector("input[type=file]") as any;
      if (!input) return false;
      input.setAttribute("data-qimao-file", "1");
      return true;
    }, idx);
    if (matched) {
      const h = await page.$("[data-qimao-file='1']");
      if (h) target = h;
    }
  }
  try {
    await target.uploadFile(filePath);
    await page.evaluate(() => {
      const el = document.querySelector("[data-qimao-file='1']") as any;
      if (el) el.removeAttribute("data-qimao-file");
    });
    return true;
  } catch (e) {
    logger.debug(`uploadByLabel: ${(e as Error).message}`);
    return false;
  }
}

/** 汇总页面上所有 .el-form-item 的「标签 → 值」，用于预览/复核 */
export async function readForm(page: any): Promise<Record<string, string>> {
  return (await page.evaluate(() => {
    const out: Record<string, string> = {};
    for (const item of Array.from(document.querySelectorAll(".el-form-item")) as any[]) {
      const lab = item.querySelector(".el-form-item__label");
      const label = (lab?.innerText ?? lab?.textContent ?? "").trim().replace(/[:：*]\s*$/, "");
      if (!label) continue;
      const input = item.querySelector("input, textarea") as any;
      const value = input?.value ? String(input.value) : (item.innerText ?? "").replace(label, "").trim();
      out[label] = value.slice(0, 200);
    }
    return out;
  })) as Record<string, string>;
}
