// WahtWay CLI 交互模式 — V0.1 保留，通过 --cli 参数启用

import { runAgent } from "./agent";
import * as readline from "readline";

async function main() {
  console.log("\n💡 WahtWay CLI 交互模式");
  console.log('输入你的问题（输入 /quit 退出）:\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const askQuestion = () => {
    rl.question("👤 你: ", async (input: string) => {
      if (input === "/quit" || input === "/exit") {
        console.log("👋 再见！");
        rl.close();
        return;
      }

      try {
        const result = await runAgent(input);
        console.log(`\n📋 [${result.skillName}]`);
        console.log("─".repeat(50));
        console.log(result.output);
        console.log("─".repeat(50));
        console.log(
          `📊 Token 用量: ${result.tokenUsage.totalTokens} (入:${result.tokenUsage.promptTokens} 出:${result.tokenUsage.completionTokens})\n`
        );
      } catch (err: any) {
        console.error("❌ 出错:", err.message);
      }

      askQuestion();
    });
  };

  askQuestion();
}

main();
