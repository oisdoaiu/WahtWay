// WahtWay Skill Hub 服务端
import "dotenv/config";
import express from "express";
import cors from "cors";
import skillsRouter from "./routes/skills";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: "512kb" }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "skill-hub", version: "0.8.0" });
});

app.use("/api/skills", skillsRouter);

app.listen(PORT, () => {
  console.log(`🌐 Skill Hub running on http://localhost:${PORT}`);
});
