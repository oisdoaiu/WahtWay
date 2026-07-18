// WahtWay Electron 主进程
const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
let mainWindow = null;

// 加载 .env
function loadEnv() {
  const envPath = app.isPackaged
    ? path.join(path.dirname(process.execPath), ".env")
    : path.join(__dirname, "..", ".env");
  process.env.WAHTWAY_ENV_PATH = envPath;
  const candidates = [
    envPath,
    path.join(__dirname, "..", "be", ".env"),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf-8").split("\n")) {
      const m = line.trim().match(/^([^#=]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
    console.log("✅ .env 已加载:", p);
    return;
  }
  console.warn("⚠️ 未找到 .env，请配置 API Key");
}

// IPC: 打开文件选择对话框
ipcMain.handle("open-file-dialog", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile", "multiSelections"],
    title: "选择文件",
  });
  return result.canceled ? [] : result.filePaths;
});

// IPC: 打开文件夹选择对话框
ipcMain.handle("open-folder-dialog", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title: "选择工作目录",
  });
  return result.canceled ? "" : result.filePaths[0] || "";
});

app.whenReady().then(async () => {
  loadEnv();
  process.env.WAHTWAY_DATA_DIR = path.join(app.getPath("userData"), "data");

  // require 后端（asar: false 直接文件访问）
  const beDir = path.join(__dirname, "..", "be");
  const distPath = path.join(beDir, "dist", "index.js");

  if (fs.existsSync(distPath)) {
    try {
      require(distPath);
      console.log("✅ Express 已启动");
    } catch (e) {
      require("electron").dialog.showErrorBox("后端加载失败", e.message + "\n" + (e.stack || ""));
      // fallback: 内置最小 Express
      const express = require("express");
      const cors = require("cors");
      const srv = express();
      srv.use(cors());
      srv.use(express.json());
      srv.get("/api/health", (_r, res) => res.json({ status: "ok" }));
      srv.get("/api/skills", (_r, res) => res.json({ skills: [] }));
      const pub = path.join(__dirname, "..", "dist");
      srv.use(express.static(pub));
      srv.get("*", (_r, res) => res.sendFile(path.join(pub, "index.html")));
      srv.listen(3000);
    }
  }

  mainWindow = new BrowserWindow({
    width: 1000, height: 700, minWidth: 600, minHeight: 400,
    title: "WahtWay - 何以委",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  // 等 Express 就绪，读取实际端口
  let port = 3000;
  setTimeout(() => {
    try {
      const portFile = require("path").join(__dirname, "..", "be", ".port");
      if (require("fs").existsSync(portFile)) {
        port = parseInt(require("fs").readFileSync(portFile, "utf-8").trim()) || 3000;
      }
    } catch {}
    mainWindow.loadURL(`http://localhost:${port}`);
  }, 1500);
  mainWindow.setMenuBarVisibility(false);

  // 修复焦点丢失：页面加载完成后强制聚焦
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.focus();
  });

  // 窗口获得焦点时，聚焦 web 内容
  mainWindow.on("focus", () => {
    mainWindow.webContents.focus();
  });
});

app.on("window-all-closed", () => app.quit());
