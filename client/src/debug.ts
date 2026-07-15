// 调试开关 — 通过 localStorage 控制
// 在浏览器 Console 中执行: localStorage.debug = "1"  开启
//                          localStorage.debug = "0"  关闭

export const DEBUG = {
  get on() {
    return localStorage.getItem("debug") === "1";
  },
  set on(v: boolean) {
    localStorage.setItem("debug", v ? "1" : "0");
  },
  log(...args: unknown[]) {
    if (this.on) console.log("[DEBUG]", ...args);
  },
};
