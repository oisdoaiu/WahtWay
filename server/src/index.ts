// WahtWay Skill Hub 服务端
import "dotenv/config";
import express from "express";
import cors from "cors";
import * as fs from "fs";
import * as path from "path";
import authRouter from "./routes/auth";
import skillsRouter from "./routes/skills";

const app = express();
const PORT = process.env.PORT || 4000;
const publicDir = path.resolve(__dirname, "../public");

app.use(cors());
app.use(express.json({ limit: "512kb" }));

if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
}

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "skill-hub", version: "0.8.0" });
});

app.use("/api/auth", authRouter);
app.use("/api/skills", skillsRouter);

if (fs.existsSync(publicDir)) {
  app.get("/", (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`🌐 Skill Hub running on http://localhost:${PORT}`);
});
