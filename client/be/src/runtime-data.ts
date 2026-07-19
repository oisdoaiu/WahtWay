import * as fs from "fs";
import * as os from "os";
import * as path from "path";

function getDefaultDataDir(): string {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "WahtWay", "data");
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "WahtWay", "data");
  }

  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(dataHome, "wahtway", "data");
}

const dataDir = path.resolve(process.env.WAHTWAY_DATA_DIR?.trim() || getDefaultDataDir());

export function getRuntimeDataDir(): string {
  return dataDir;
}

export function getConversationsDir(): string {
  return path.join(dataDir, "conversations");
}

export function getLogsDir(): string {
  return path.join(dataDir, "logs");
}

export function getExternalToolsDir(): string {
  return path.join(dataDir, "external-tools");
}

export function getSkillLearningDir(): string {
  return path.join(dataDir, "skill-learning");
}

export function getSkillRunsDir(): string {
  return path.join(getSkillLearningDir(), "runs");
}

export function getSkillLearningStatesDir(): string {
  return path.join(getSkillLearningDir(), "skills");
}

export function migrateLegacyConversations(): void {
  const targetDir = getConversationsDir();
  const legacyRoots = [
    path.join(process.cwd(), "data"),
    path.resolve(__dirname, "../data"),
    path.resolve(__dirname, "../../data"),
  ];

  for (const root of new Set(legacyRoots.map((item) => path.resolve(item)))) {
    const sourceDir = path.join(root, "conversations");
    if (path.resolve(sourceDir) === path.resolve(targetDir) || !fs.existsSync(sourceDir)) continue;

    try {
      const files = fs.readdirSync(sourceDir).filter((name) => /^\d+\.json$/.test(name));
      if (files.length === 0) continue;
      fs.mkdirSync(targetDir, { recursive: true });

      for (const name of files) {
        const source = path.join(sourceDir, name);
        const target = path.join(targetDir, name);
        if (!fs.existsSync(target) && fs.statSync(source).isFile()) {
          fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
        }
      }
    } catch (error) {
      console.warn("Failed to migrate legacy conversations:", error);
    }
  }
}
