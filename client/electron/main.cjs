// WahtWay Electron 主进程
const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");
let mainWindow = null;

// 加载 .env
function loadEnv() {
  const candidates = [
    path.join(__dirname, "..", "be", ".env"),
    path.join(path.dirname(process.execPath), ".env"),
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

app.whenReady().then(async () => {
  loadEnv();

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
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  // 等 Express 就绪
  setTimeout(() => {
    mainWindow.loadURL("http://localhost:3000");
  }, 1500);
  mainWindow.setMenuBarVisibility(false);
});

app.on("window-all-closed", () => app.quit());
