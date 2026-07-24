// WahtWay Electron 主进程
const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
let mainWindow = null;

function resolveDataDir() {
  if (process.env.WAHTWAY_DATA_DIR && process.env.WAHTWAY_DATA_DIR.trim()) {
    return path.resolve(process.env.WAHTWAY_DATA_DIR.trim());
  }

  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR?.trim();
  if (portableDir) {
    return path.join(path.resolve(portableDir), "WahtWay-data");
  }

  return path.join(app.getPath("userData"), "data");
}

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

function writePortFile(port) {
  try {
    const beDir = path.join(__dirname, "..", "be");
    fs.writeFileSync(path.join(beDir, ".port"), String(port), "utf-8");
  } catch {}
}

function waitForPortFile(timeoutMs = 15000) {
  const beDir = path.join(__dirname, "..", "be");
  const portFile = path.join(beDir, ".port");
  const start = Date.now();

  return new Promise((resolve) => {
    const poll = () => {
      try {
        if (fs.existsSync(portFile)) {
          const port = parseInt(fs.readFileSync(portFile, "utf-8").trim(), 10);
          if (Number.isFinite(port) && port > 0) {
            resolve(port);
            return;
          }
        }
      } catch {}

      if (Date.now() - start >= timeoutMs) {
        resolve(3000);
        return;
      }

      setTimeout(poll, 100);
    };

    poll();
  });
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

// 全局函数：渲染 HTML 为图片（供 Express 后端调用）
global.renderHTMLSlides = async (htmlSlides) => {
  return await renderHTMLSlidesImpl(htmlSlides);
};

async function renderHTMLSlidesImpl(htmlSlides) {
  if (!Array.isArray(htmlSlides) || htmlSlides.length === 0) return [];
  const results = [];
  for (let i = 0; i < htmlSlides.length; i++) {
    try {
      const win = new BrowserWindow({
        width: 1280, height: 720, show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      });
      const html = "<!DOCTYPE html><html><head><meta charset='utf-8'><style>" +
        "*{margin:0;padding:0;box-sizing:border-box}" +
        "body{width:1280px;height:720px;overflow:hidden;font-family:'Microsoft YaHei','PingFang SC',sans-serif}" +
        "</style></head><body>" + htmlSlides[i] + "</body></html>";
      await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
      await new Promise(r => setTimeout(r, 500)); // 等渲染完成
      const image = await win.webContents.capturePage();
      results.push(image.toDataURL());
      win.close();
    } catch (e) {
      results.push("");
    }
  }
  return results;
}


app.whenReady().then(async () => {
  loadEnv();
  process.env.WAHTWAY_DATA_DIR = resolveDataDir();

  // require 后端（asar: false 直接文件访问）
  const beDir = path.join(__dirname, "..", "be");
  const distPath = path.join(beDir, "dist", "index.js");
  try {
    fs.unlinkSync(path.join(beDir, ".port"));
  } catch {}

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
      srv.listen(3000, () => writePortFile(3000));
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
  const port = await waitForPortFile();
  mainWindow.loadURL(`http://localhost:${port}`);
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
