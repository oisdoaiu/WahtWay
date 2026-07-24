// WahtWay preload — 修复 Electron 焦点丢失 + 暴露文件路径 API
// 在 renderer 进程中运行，可访问部分 Node.js API

const { contextBridge, webUtils, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // 获取拖拽文件的完整绝对路径
  getFilePath: (file) => {
    try {
      if (webUtils && webUtils.getPathForFile) {
        return webUtils.getPathForFile(file);
      }
    } catch {}
    return file.path || file.name;
  },
  // 打开原生文件选择对话框
  openFileDialog: () => ipcRenderer.invoke("open-file-dialog"),
  // 打开文件夹选择对话框
  openFolderDialog: () => ipcRenderer.invoke("open-folder-dialog"),
  // HTML 转图片（PPT 生成用）
  renderHTMLSlides: (htmlArr) => ipcRenderer.invoke("render-html-slides", htmlArr),
});

// 关键修复：劫持任意点击，确保焦点落到对应元素
window.addEventListener("mousedown", (e) => {
  const target = e.target;
  if (target && typeof target.focus === "function") {
    // 延迟聚焦，确保 DOM 更新完成
    setTimeout(() => target.focus(), 0);
  }
}, true);
