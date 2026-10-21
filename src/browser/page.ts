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

/* ------------------------------ AI / 创作声明 ------------------------------ */

/**
 * 「内容声明 / 创作声明」的 AI 相关选项文案。
 *
 * 七猫现版（2026-10 真机读 `/api/author/global-data`）：
 *   `disclaimer_type = [{label:"本人原创",value:"1"},{label:"含AI生成内容",value:"2"}]`
 * 当前业务约定：**默认选否定项**（本人原创 / 否），
 * 显式传 useAI=true 才选肯定项（含AI生成内容 / 是 / AI生成）。平台若改文案，往这里加候选即可。
 */
export const AI_DECLARATION_YES = ["含AI生成内容", "AI生成", "AI辅助创作", "AI创作", "人工智能生成", "是"];
export const AI_DECLARATION_NO = ["本人原创", "非AI生成", "不是AI生成", "人工创作", "否"];

export interface AiDeclarationOutcome {
  /** selected=本次点中；already-set=本来就是目标值；absent=页面没有该字段；option-missing=有这个字段但没找到目标选项；click-failed=点了但没生效 */
  status: "selected" | "already-set" | "absent" | "option-missing" | "click-failed";
  /** 点击前的当前值 */
  current?: string;
  /** 实际选中的文案 */
  selected?: string;
  /** 下拉里读到的全部选项（排障用） */
  options?: string[];
}

/** 归一化选项文案（去空白，便于「含 AI 生成内容」这类写法对齐） */
function normAiText(s: string): string {
  return String(s ?? "").replace(/\s+/g, "");
}

/** 把声明处理结果转成一句可复核的中文说明（写进工具返回消息） */
export function describeAiDeclaration(r: AiDeclarationOutcome): string {
  switch (r.status) {
    case "selected":
      return `已选「${r.selected ?? "?"}」${r.current ? `（原为「${r.current}」）` : ""}`;
    case "already-set":
      return `已是「${r.current ?? "?"}」，未改动`;
    case "absent":
      return "本页无「内容声明」字段，跳过（平台未要求）";
    case "option-missing":
      return `⚠️ 有声明字段但未找到目标选项${r.current ? `（当前「${r.current}」）` : ""}${
        r.options?.length ? `；可选：${r.options.join(" / ")}` : ""
      }`;
    case "click-failed":
      return `⚠️ 点选声明未生效${r.current ? `（当前「${r.current}」）` : ""}`;
    default:
      return String(r.status);
  }
}

/**
 * 在可见弹窗里找「内容声明 / 创作声明」并选中目标项（默认选否定项「本人原创」）。
 *
 * 真机结构（2026-10）：发布确认弹窗 `el-dialog.qm-pop` 里是
 *   `<div class="chapter-detail-item"><span class="label"><span class="label-text">内容声明</span>…</span>
 *    <el-select class="qm-select el-select-200">…</el-select></div>`
 * 选项浮层由 `popper-append-to-body` 挂到 body（`.el-select-dropdown__item`），
 * 且 `formData.disclaimer_type` 默认是 `"0"`（未选）——不选就按平台默认走，等于漏声明。
 *
 * ⚠️ 必须真实鼠标点：Vue 2 只认原生事件；直接用 JS 改 v-model 不会被提交。
 * 找不到该字段时返回 `absent`（短篇/部分渠道本就没有，不报错）。
 */
export async function applyAiDeclaration(page: any, useAI = false, timeoutMs = 6000): Promise<AiDeclarationOutcome> {
  const want = (useAI ? AI_DECLARATION_YES : AI_DECLARATION_NO).map(normAiText);
  const deadline = Date.now() + timeoutMs;
  let last: AiDeclarationOutcome = { status: "absent" };

  while (Date.now() < deadline) {
    const found = (await page
      .evaluate((wanted: string[]) => {
        const norm = (s: string) => String(s ?? "").replace(/\s+/g, "");
        const vis = (el: any) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const scopes = (
          Array.from(
            document.querySelectorAll(".el-dialog,.el-message-box,.g-pop,.qm-dialog,.qm-pop")
          ) as any[]
        ).filter(vis);
        for (let i = scopes.length - 1; i >= 0; i--) {
          const scope = scopes[i];
          // 只认「叶子节点且文本恰好是声明标题」的元素，避免命中正文长段落
          const labelEl = (Array.from(scope.querySelectorAll("span,div,p,label")) as any[]).find(
            (el) =>
              vis(el) &&
              (!el.children || el.children.length === 0) &&
              /^(内容声明|创作声明|作品声明|AI声明)[:：]?$/.test(norm(el.textContent || ""))
          );
          if (!labelEl) continue;
          const row: any =
            labelEl.closest?.(".chapter-detail-item,.el-form-item,.qm-form-item") || labelEl.parentElement;
          if (!row) continue;

          const sel: any = row.querySelector(".el-select,.qm-select");
          if (sel) {
            sel.scrollIntoView({ block: "center" });
            const input: any = sel.querySelector("input");
            // 点 .el-select 本身（与 book.ts 打开下拉的方式一致）；输入框只用来读当前值
            const r = sel.getBoundingClientRect();
            return {
              kind: "select",
              current: String(input?.value ?? "").trim(),
              x: r.x + r.width / 2,
              y: r.y + r.height / 2,
            };
          }

          // 兜底：声明是单选/复选组（不是下拉）
          const opts = (
            Array.from(row.querySelectorAll("label,.el-radio,.el-checkbox,.arco-radio")) as any[]
          ).filter(vis);
          const wantedHit = wanted.find((w) =>
            opts.some((o: any) => {
              const t = norm(o.textContent || "");
              return t === w || (w.length > 1 && t.includes(w));
            })
          );
          if (wantedHit) {
            const hit = opts.find((o: any) => {
              const t = norm(o.textContent || "");
              return t === wantedHit || t.includes(wantedHit);
            }) as any;
            hit.scrollIntoView({ block: "center" });
            const r = hit.getBoundingClientRect();
            return {
              kind: "group",
              current: "",
              label: norm(hit.textContent || ""),
              x: r.x + r.width / 2,
              y: r.y + r.height / 2,
            };
          }
          return { kind: "none", current: norm(row.textContent || "").slice(0, 80) };
        }
        return null;
      }, want)
      .catch(() => null)) as
      | { kind: "select" | "group" | "none"; current?: string; label?: string; x?: number; y?: number }
      | null;

    // 弹窗还没渲染出来：继续等（发布确认弹窗是异步挂载的）
    if (!found) {
      await sleep(300);
      continue;
    }

    if (found.kind === "none") {
      return { status: "option-missing", current: found.current };
    }

    if (found.kind === "group") {
      await page.mouse.click(found.x, found.y);
      await sleep(300);
      return { status: "selected", selected: found.label };
    }

    // kind === "select"
    const current = normAiText(found.current ?? "");
    if (current && want.includes(current)) {
      return { status: "already-set", current: found.current };
    }

    // 点开下拉；Element-UI 的浮层可能延迟渲染，最多试 3 次
    let options: string[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.mouse.click(found.x, found.y);
      await sleep(500);
      options = await visibleSelectOptions(page);
      if (options.length) break;
    }
    if (!options.length) {
      await page.keyboard.press("Escape").catch(() => {});
      return { status: "option-missing", current: found.current };
    }

    const target =
      options.find((o) => want.includes(normAiText(o))) ||
      options.find((o) => want.some((w) => w.length > 1 && normAiText(o).includes(w)));
    if (!target) {
      await page.keyboard.press("Escape").catch(() => {});
      return { status: "option-missing", current: found.current, options };
    }

    if (!(await clickVisibleOption(page, target))) {
      return { status: "click-failed", current: found.current, options };
    }
    await sleep(450);
    return { status: "selected", selected: target, current: found.current, options };
  }

  // 超时仍未出现声明字段
  return last;
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
 * 等「立即发布确认」弹窗真的出现（标题文案 / 确认按钮二选一）。
 *
 * 为什么不能直接等「任意可见弹窗」：七猫页面常驻**法律声明弹窗**（「我已阅读并同意」），
 * 随便一个弹窗就往下走会把它当成发布确认，导致「内容声明」还没渲染就报 absent。
 */
export async function waitForPublishDialog(page: any, timeoutMs = 12000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = (await page
      .evaluate(() => {
        const vis = (el: any) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const ds = (
          Array.from(document.querySelectorAll(".el-dialog,.el-message-box,.g-pop,.qm-dialog,.qm-pop")) as any[]
        ).filter(vis);
        return ds.some((d: any) => {
          const t = (d.innerText || "").replace(/\s+/g, " ").trim();
          if (/立即发布确认|请核对上下文|确认发布/.test(t)) return true;
          return (Array.from(d.querySelectorAll("a.qm-btn,button")) as any[]).some(
            (b: any) => vis(b) && /^确认发布$/.test((b.innerText || "").trim())
          );
        });
      })
      .catch(() => false)) as boolean;
    if (hit) return true;
    await sleep(300);
  }
  return false;
}

/** 点「立即发布」之后、发布确认弹窗之前，平台可能先弹的**前置门** */
export interface PublishGate {
  /** publish=正常走到「立即发布确认」；sequence=章节序号不连续被拦；none=都没出现 */
  kind: "publish" | "sequence" | "none";
  /** 拦截弹窗原文（压空白后截断） */
  text?: string;
  /** 弹窗里可点的按钮文案（让调用方原样回报给用户） */
  options?: string[];
}

/**
 * 点「立即发布」后判断平台先给哪一层。
 *
 * 真机（2026-10）实测：草稿序号与已发布章节接不上时，平台**不会**直接进「立即发布确认」，
 * 而是先弹 `el-dialog__wrapper.qm-dialog.abnormal-publish-dialog`：
 *   「检测到章节序号不连续 … 同步更正章节序号：第1章 → 第4章」+『取消』/『更正序号去发布』。
 * 这层只给两个选择，且**改序号是内容决策**——本工具不替用户点『更正序号去发布』，
 * 一律如实回报（点名当前章节号 + 弹窗原文 + 可点按钮），由用户改好序号或去页面手动确认。
 *
 * ⚠️ 别把 `/draft-publish/` 当「提交接口」拦：弹窗数据来自 `POST book-chapter/draft-publish-confirm`，
 *    真正提交才是 `POST book-chapter/draft-publish`。
 */
export async function waitForPublishGate(page: any, timeoutMs = 12000): Promise<PublishGate> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = (await page
      .evaluate(() => {
        const vis = (el: any) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const ds = (
          Array.from(document.querySelectorAll(".el-dialog,.el-message-box,.g-pop,.qm-dialog,.qm-pop")) as any[]
        ).filter(vis);
        for (let i = ds.length - 1; i >= 0; i--) {
          const d: any = ds[i];
          const t = (d.innerText || "").replace(/\s+/g, " ").trim();
          if (/章节序号不连续|序号不连续/.test(t)) {
            const options = Array.from(d.querySelectorAll("a,button,.qm-btn,.el-button")) as any[];
            return {
              kind: "sequence",
              text: t.slice(0, 300),
              options: options
                .filter((b: any) => vis(b))
                .map((b: any) => (b.innerText || "").replace(/\s+/g, " ").trim())
                .filter(Boolean)
                .slice(0, 6),
            };
          }
        }
        for (const d of ds as any[]) {
          const t = (d.innerText || "").replace(/\s+/g, " ").trim();
          if (/立即发布确认|请核对上下文|确认发布/.test(t)) return { kind: "publish" };
        }
        return null;
      })
      .catch(() => null)) as PublishGate | null;
    if (hit) return hit;
    await sleep(300);
  }
  return { kind: "none" };
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
 *
 * `opts.useAI`（默认 false）会在确认前处理弹窗里的「内容声明 / 创作声明」：
 * 默认选否定项（本人原创 / 否）；显式 true 才选肯定项（含AI生成内容 / 是）。
 * `opts.onAi` 用于把实际选中的文案带回给调用方（写进返回消息，便于复核）。
 */
export async function acceptPublishConfirm(
  page: any,
  rounds = 4,
  shouldStop?: () => boolean,
  opts: { useAI?: boolean; onAi?: (r: AiDeclarationOutcome) => void } = {}
): Promise<string[]> {
  const done: string[] = [];
  let aiDone = false;
  for (let i = 0; i < rounds; i++) {
    if (shouldStop?.()) break; // 发布接口已成功——别再多点（避免重复提交）

    // 先等「立即发布确认」弹窗真的出现，再处理内容声明。
    // （页面常驻法律声明弹窗，不能拿「任意弹窗」当发布确认，否则声明还没渲染就判 absent）
    const dialogReady = await waitForPublishDialog(page, i === 0 ? 12000 : 2500);

    // 内容声明必须在点「确认发布」之前选好（真机默认是未选 "0"，漏了等于不声明）
    if (!aiDone && dialogReady) {
      const ai = await applyAiDeclaration(page, opts.useAI === true, 3000);
      aiDone = true;
      opts.onAi?.(ai);
      if (ai.status === "option-missing" || ai.status === "click-failed") {
        logger.warn(`[内容声明] ${ai.status}：current=${ai.current ?? "(空)"} options=${JSON.stringify(ai.options ?? [])}`);
      }
    }

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
