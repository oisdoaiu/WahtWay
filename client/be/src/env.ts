import fs from "fs";
import path from "path";

export function getEnvPath(): string {
  return process.env.WAHTWAY_ENV_PATH || path.resolve(__dirname, "../../.env");
}

function loadEnv(): void {
  const envPath = getEnvPath();
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.trim().match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim();
    }
  }
}

loadEnv();
