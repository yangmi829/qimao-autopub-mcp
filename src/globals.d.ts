/**
 * page.evaluate 的回调在浏览器上下文运行，这里的 DOM 全局在 Node 编译期不存在，
 * 因此统一声明为 any（只在传入 evaluate 的闭包里使用）。
 */
declare const document: any;
declare const window: any;
declare const Event: any;
declare const location: any;
declare const fetch: any;
