// WahtWay Skill Hub 服务端
import "dotenv/config";
import express from "express";
import cors from "cors";
import { initSkills, registeredSkills } from "./skills/loader";

initSkills();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Skill 列表
app.get("/api/skills", (_req, res) => {
  const skills = registeredSkills.map(s => ({
    id: s.id, name: s.name, description: s.description,
    input: s.input, output: s.output, keywords: s.keywords,
  }));
  res.json({ skills });
});

// 下载单个 Skill JSON
app.get("/api/skills/:id/download", (req, res) => {
  const skill = registeredSkills.find(s => s.id === req.params.id);
  if (!skill) return res.status(404).json({ error: "Skill not found" });
  res.json(skill);
});

app.listen(PORT, () => {
  console.log(`🌐 Skill Hub running on http://localhost:${PORT}`);
});
