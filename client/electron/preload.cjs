// WahtWay preload — 修复 Electron 焦点丢失
// 在 renderer 进程中运行，可访问部分 Node.js API

const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {});

// 关键修复：劫持任意点击，确保焦点落到对应元素
window.addEventListener("mousedown", (e) => {
  const target = e.target;
  if (target && typeof target.focus === "function") {
    // 延迟聚焦，确保 DOM 更新完成
    setTimeout(() => target.focus(), 0);
  }
}, true);
