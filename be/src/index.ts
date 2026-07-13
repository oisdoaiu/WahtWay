// WahtWay 后端入口 — V0.1 命令行版本
// 用法: ts-node src/index.ts "你的问题"

import "dotenv/config";
import { runAgent } from "./agent";

async function main() {
  // 从命令行获取用户输入
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log("💡 用法: ts-node src/index.ts <你的问题>");
    console.log('💡 示例: ts-node src/index.ts "帮我制定明天的数学复习计划，重点复习定积分"');
    console.log("\n--- 进入交互模式 ---");
    console.log('输入你的问题（输入 /quit 退出）:\n');

    // 交互模式
    const readline = require("readline");
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
  } else {
    // 单次模式
    const userMessage = args.join(" ");

    try {
      const result = await runAgent(userMessage);
      console.log(result.output);
    } catch (err: any) {
      console.error("❌ 出错:", err.message);
      process.exit(1);
    }
  }
}

main();
