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
export async function realClick(page: any, selector: string): Promise<boolean> {
  const handle = await page.$(selector);
  if (!handle) return false;
  try {
    await handle.evaluate((el: any) => el.scrollIntoView({ block: "center", inline: "center" }));
    await sleep(120);
    const box = await handle.boundingBox();
    if (!box) {
      // 元素不可见（display:none 等），退回 JS 点击
      await handle.evaluate((el: any) => el.click());
      return true;
    }
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    return true;
  } catch (e) {
    logger.debug(`realClick(${selector}) 失败: ${(e as Error).message}`);
    return false;
  }
}

/** 按可见文本找元素并真实点击（用于没有稳定选择器的按钮/选项） */
export async function realClickText(
  page: any,
  text: string,
  opts: { tags?: string[]; exact?: boolean; nth?: number } = {}
): Promise<boolean> {
  const tags = opts.tags ?? ["button", "a", "li", "div", "span", "p", "label", "i"];
  const handle = await page.evaluateHandle(
    (t: string, ts: string[], exact: boolean, nth: number) => {
      const wanted = t.trim();
      const all: any[] = [];
      for (const tag of ts) for (const el of Array.from(document.querySelectorAll(tag)) as any[]) {
        const txt = (el.innerText ?? el.textContent ?? "").trim();
        if (!txt) continue;
        if (exact ? txt === wanted : txt.includes(wanted)) {
          // 只保留最内层可见元素，避免点到外层容器
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) all.push(el);
        }
      }
      all.sort((a, b) => (a.innerText?.length ?? 0) - (b.innerText?.length ?? 0));
      return all[nth] ?? null;
    },
    text,
    tags,
    opts.exact ?? false,
    opts.nth ?? 0
  );
  const el = handle.asElement();
  if (!el) return false;
  try {
    await el.evaluate((n: any) => n.scrollIntoView({ block: "center", inline: "center" }));
    await sleep(120);
    const box = await el.boundingBox();
    if (!box) {
      await el.evaluate((n: any) => n.click());
      return true;
    }
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    return true;
  } catch (e) {
    logger.debug(`realClickText(${text}) 失败: ${(e as Error).message}`);
    return false;
  }
}

/**
 * 用一段 JS 表达式在页面里「算出要点的坐标」，再用真实鼠标点。
 *
 * 为什么需要它：七猫的建书/标签弹窗里很多可点元素是 `div` / `a.qm-btn` /
 * 自定义组件卡片，既没有稳定选择器，`realClickText` 的「按文本找最内层」也容易
 * 点到页脚同名链接（踩过：点「七猫中文网」命中了页脚短链）。这里允许调用方
 * 自己把作用域限定到可见弹窗 / 第 N 个卡片，再交回真实鼠标。
 *
 * `expr` 必须返回 `{x, y}` 或 `null`。
 */
export async function realClickByJs(page: any, expr: string): Promise<boolean> {
  try {
    const pt = (await page.evaluate(expr)) as { x: number; y: number } | null;
    if (!pt) return false;
    await page.mouse.click(pt.x, pt.y);
    return true;
  } catch (e) {
    logger.debug(`realClickByJs 失败: ${(e as Error).message}`);
    return false;
  }
}

/**
 * 用真实键鼠往「按 JS 定位到的元素」里输入。
 *
 * ⚠️ 必须真实输入：七猫建书页（Vue 2 + 类 Element-UI）只认原生键鼠事件。
 * 直接 `el.value = "x"` + `dispatchEvent(new Event("input"))` **不会**更新 v-model
 * ——真机上表现为「看着填进去了，但提交按钮一直是灰的 / 提交后字段为空」。
 */
export async function realTypeByJs(page: any, expr: string, value: string, delay = 30, clear = true): Promise<boolean> {
  try {
    const pt = (await page.evaluate(expr)) as { x: number; y: number } | null;
    if (!pt) return false;
    await page.mouse.click(pt.x, pt.y);
    await sleep(220);
    if (clear) {
      // Ctrl+A 只作用于当前聚焦的输入域（input / textarea / contenteditable），不会全选整页
      await page.keyboard.down("Control");
      await page.keyboard.press("KeyA");
      await page.keyboard.up("Control");
      await page.keyboard.press("Backspace");
      await sleep(140);
    }
    await page.keyboard.type(value, { delay });
    return true;
  } catch (e) {
    logger.debug(`realTypeByJs 失败: ${(e as Error).message}`);
    return false;
  }
}

/** 在「当前可见的」下拉浮层里按可见文本点一项（Element-UI 的 `.el-select-dropdown__item`） */
export async function clickVisibleOption(page: any, optionText: string): Promise<boolean> {
  const pt = (await page.evaluate((want: string) => {
    const vis = (el: any) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const dds = (Array.from(document.querySelectorAll(".el-select-dropdown")) as any[]).filter(vis);
    for (const dd of dds) {
      const items = Array.from(dd.querySelectorAll(".el-select-dropdown__item")) as any[];
      const hit = items.find((o) => ((o.innerText ?? o.textContent ?? "") as string).trim() === want);
      if (hit) {
        hit.scrollIntoView({ block: "center" });
        const r = hit.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }
    }
    return null;
  }, optionText)) as { x: number; y: number } | null;
  if (!pt) return false;
  await page.mouse.click(pt.x, pt.y);
  return true;
}

/** 读取当前可见下拉浮层里的全部选项文本 */
export async function visibleSelectOptions(page: any): Promise<string[]> {
  return (await page.evaluate(() => {
    const vis = (el: any) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const dds = (Array.from(document.querySelectorAll(".el-select-dropdown")) as any[]).filter(vis);
    const out: string[] = [];
    for (const dd of dds) {
      for (const o of Array.from(dd.querySelectorAll(".el-select-dropdown__item")) as any[]) {
        const t = ((o.innerText ?? o.textContent ?? "") as string).trim();
        if (t) out.push(t);
      }
    }
    return out;
  })) as string[];
}

/** 清空并输入文本（先聚焦、全选、删除，避免与默认值拼接） */
export async function fillInput(page: any, selector: string, value: string): Promise<boolean> {
  const handle = await page.$(selector);
  if (!handle) return false;
  try {
    await handle.evaluate((el: any) => el.scrollIntoView({ block: "center" }));
    await handle.click({ clickCount: 3 });
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await handle.type(value, { delay: 8 });
    return true;
  } catch (e) {
    logger.debug(`fillInput(${selector}) 失败: ${(e as Error).message}`);
    return false;
  }
}

/**
 * 读取「轻提示」文本（Element-UI 的 toast / 通知 / 确认框），用于判定成功。
 *
 * 为什么不直接用 `visibleModalText`：七猫页面常驻一个**法律声明弹窗**
 * （「重要提醒 …… 我已阅读并同意」），`visibleModalText` 会把这段长文案当成页面提示，
 * 结果「页面提示」全是免责声明，真正的 `保存成功` toast 反而被淹没。
 */
export async function visibleToastText(page: any): Promise<string> {
  return (await page.evaluate(() => {
    const sel = ".el-message, .el-message__content, .el-notification, .el-message-box, .el-message-box__message, .qm-message, .g-toast";
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll(sel)) as any[]) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const t = ((el.innerText ?? el.textContent ?? "") as string).trim();
      if (t) out.push(t);
    }
    return out.join(" | ").slice(0, 500);
  })) as string;
}

/**
 * 若页面弹出「我已阅读并同意」类协议勾选框且未勾选，则真实点击勾上。
 *
 * 真机背景：七猫在发布/提交前会弹法律声明弹窗（「……我已阅读并同意」），
 * 不勾选时「立即发布」会被拦下。勾选是用户明确的发布意图，故默认执行。
 * 返回是否点了（未发现弹窗 / 已勾选都返回 false）。
 */
export async function acceptAgreementIfPresent(page: any): Promise<boolean> {
  const pt = (await page.evaluate(() => {
    const vis = (e: any) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    // 只认「可见弹窗 / 遮罩层里」的勾选框，避免点到正文里的同名文字
    const scopes = (Array.from(document.querySelectorAll(".el-dialog, .el-message-box, .g-pop, .qm-dialog")) as any[]).filter(vis);
    for (const scope of scopes) {
      const txt = ((scope.innerText ?? "") as string) || "";
      if (!/我已/.test(txt) || !/(同意|阅读|遵守)/.test(txt)) continue;
      for (const cb of Array.from(scope.querySelectorAll(".el-checkbox, input[type=checkbox]")) as any[]) {
        const host = cb.classList?.contains("el-checkbox") ? cb : cb.closest?.(".el-checkbox") ?? cb;
        if (host.classList?.contains("is-checked") || cb.checked) continue;
        host.scrollIntoView({ block: "center" });
        const r = host.getBoundingClientRect();
        return { x: r.x + 12, y: r.y + r.height / 2 };
      }
    }
    return null;
  })) as { x: number; y: number } | null;
  if (!pt) return false;
  await page.mouse.click(pt.x, pt.y);
  await sleep(400);
  return true;
}

/**
 * 轮询「可见弹窗」里的按钮并真实点击，返回被点中的按钮文案（超时返回 undefined）。
 *
 * ⚠️ 为什么必须轮询：弹窗是**异步渲染**的（先发一个 confirm 接口，拿到响应才挂载 DOM）。
 * 点完主按钮立刻查一次必然落空——真机踩过：`立即发布` 后的二次确认弹窗没被点，
 * 章节停在草稿，工具却报成功。别改回「sleep 一次 + 查一次」。
 */
export async function clickInVisibleDialog(page: any, texts: string[], timeoutMs = 12000): Promise<string | undefined> {
  const expr = (t: string) =>
    `(()=>{const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};` +
    `const ds=Array.from(document.querySelectorAll(".el-dialog,.el-message-box,.g-pop,.qm-dialog")).filter(vis);` +
    `for(let i=ds.length-1;i>=0;i--){const b=Array.from(ds[i].querySelectorAll("a.qm-btn,button")).find(x=>((x.innerText||"").trim())===${JSON.stringify(
      t
    )});if(b&&!/disabled/.test((b.className||"").toString())){b.scrollIntoView({block:"center"});const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};}}return null;})()`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const t of texts) {
      let pt: { x: number; y: number } | null = null;
      try {
        pt = (await page.evaluate(expr(t))) as { x: number; y: number } | null;
      } catch {
        pt = null;
      }
      if (pt) {
        await page.mouse.click(pt.x, pt.y);
        return t;
      }
    }
    await sleep(500);
  }
  return undefined;
}

/**
 * 点掉「确认发布确认」类**多层**弹窗（真机流程，别简化）：
 *
 *   点「立即发布」→ 弹窗①（请核对上下文内容 + 内容声明 + `确认发布`）
 *                → 点①的「确认发布」→ 弹层②（重要提醒 + `我已阅读并知晓`）
 *                → 点②的「我已阅读并知晓」→ 再点①的「确认发布」→ 才真正发布
 *
 * ⚠️ 「我已阅读并知晓」是 `<em>`（不是 button），且弹层挂在 body 上（不在 .el-dialog 里），
 *    所以必须**全页**按短文本找。只做一层确认的实现在真机上表现为「点了但章节还是草稿」。
 *
 * 返回每轮实际点中的按钮文案（按顺序）。
 */
export async function acceptPublishConfirm(page: any, rounds = 4, shouldStop?: () => boolean): Promise<string[]> {
  const done: string[] = [];
  for (let i = 0; i < rounds; i++) {
    if (shouldStop?.()) break; // 发布接口已成功——别再多点（避免重复提交）
    const agreed = await clickAgreementIfPresent(page, i === 0 ? 1500 : 2500);
    const hit = await clickInVisibleDialog(page, ["确认发布", "确定"], i === 0 ? 12000 : 2500);
    if (!hit && !agreed) break; // 没有弹窗了，收工
    if (hit) done.push(hit);
    await sleep(2500);
  }
  return done;
}

/**
 * 全页找「我已阅读并…」(如「我已阅读并知晓」「我已阅读并同意」)的**短文本**可点元素并真实点击。
 * 这类元素是 `<em>` / `<span>`，不是 `button`，且常挂在 body 上的浮层里 → 不能只在 .el-dialog 里找。
 * 用「文本长度 ≤ 30」把正文 / 长条款段落排除掉。
 */
export async function clickAgreementIfPresent(page: any, timeoutMs = 3000): Promise<string | undefined> {
  // ⚠️ 真机坑：该元素带**倒计时**——文本是「我已阅读并知晓(3)」→「(2)」→「我已阅读并知晓」，
  //    倒计时期间点击无效（等同 disabled）。所以必须**等倒计时走完**（文本不再带 `(数字)`）再点。
  const expr = `(()=>{const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};` +
    `const all=Array.from(document.querySelectorAll("em,span,a,label,i,div"));let best=null;` +
    `for(const el of all){const t=(el.textContent||"").trim();` +
    `if(t.length<4||t.length>30)continue;` +
    `if(!/我已阅读并/.test(t))continue;` +
    `if(!/同意|知晓|接受/.test(t))continue;` +
    `if(/\\(\\s*\\d+\\s*\\)\\s*$/.test(t))continue;` +
    `if(!vis(el))continue;` +
    `if(Array.from(el.children).some(c=>((c.textContent||"").trim())===t))continue;` +
    `best=el;}` +
    `if(!best)return null;best.scrollIntoView({block:"center"});const r=best.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,txt:(best.textContent||"").trim()};})()`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let pt: { x: number; y: number; txt: string } | null = null;
    try {
      pt = (await page.evaluate(expr)) as { x: number; y: number; txt: string } | null;
    } catch {
      pt = null;
    }
    if (pt) {
      await page.mouse.click(pt.x, pt.y);
      await sleep(300);
      // 点完还要确认它真的消失了（否则可能是倒计时中/未生效）
      const gone = (await page.evaluate(`(()=>{const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};` +
        `return !Array.from(document.querySelectorAll("em,span,a,label,i")).some(el=>{const t=(el.textContent||"").trim();` +
        `return t.length<30&&/我已阅读并(同意|知晓|接受)/.test(t)&&!/\\(\\s*\\d+\\s*\\)\\s*$/.test(t)&&vis(el);});})()`)) as boolean;
      if (gone) return pt.txt;
      await sleep(800);
    }
    await sleep(400);
  }
  return undefined;
}

/** 读取元素文本（不存在返回空串） */
export async function textOf(page: any, selector: string): Promise<string> {
  try {
    return (await page.$eval(selector, (el: any) => (el.innerText ?? el.textContent ?? "").trim())) as string;
  } catch {
    return "";
  }
}

/** 元素是否存在且可见 */
export async function visible(page: any, selector: string): Promise<boolean> {
  try {
    return (await page.$eval(selector, (el: any) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    })) as boolean;
  } catch {
    return false;
  }
}

/** 等待页面上出现某段文本 */
export async function waitForText(page: any, text: string, timeoutMs = 15000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const body = await page.evaluate(() => document.body?.innerText ?? "");
    if (String(body).includes(text)) return true;
    await sleep(300);
  }
  return false;
}

/**
 * 读取当前可见模态框（弹窗）里的文本。
 * ⚠️ 不能用整个 body 的 innerText 做判定——它会包含页面正文 / 编辑器内容，
 * 导致「正文里恰好出现了敏感词」被误判成页面限制（本项目踩过这个坑）。
 */
export async function visibleModalText(page: any): Promise<string> {
  return (await page.evaluate(() => {
    const sels = [
      ".el-dialog",
      ".el-message-box",
      ".q-dialog",
      ".arco-modal",
      "[role=dialog]",
      ".modal",
    ];
    const parts: string[] = [];
    for (const s of sels) {
      for (const el of Array.from(document.querySelectorAll(s)) as any[]) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) parts.push(el.innerText ?? "");
      }
    }
    return parts.join("\n").trim();
  })) as string;
}
