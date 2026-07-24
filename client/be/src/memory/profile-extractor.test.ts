import { parseProfileCandidates, planProfileMutations } from "./profile-extractor";
import type { MemoryItem } from "./repository";

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    failures++;
    console.error("  FAIL:", msg);
  } else {
    console.log("  ok:", msg);
  }
}

function makeItem(partial: Partial<MemoryItem> & { id: string; content: string; category: MemoryItem["category"] }): MemoryItem {
  return {
    source: "manual",
    sourceConversationId: null,
    sourceMessageId: null,
    enabled: true,
    sensitive: false,
    createdAt: "",
    updatedAt: "",
    lastUsedAt: null,
    schemaVersion: 1,
    ...partial,
  };
}

console.log("== parseProfileCandidates ==");
const p1 = parseProfileCandidates('[{"category":"profile","content":"用户是计算机专业学生"}]');
assert(p1.length === 1 && p1[0].category === "profile" && p1[0].content.includes("计算机专业"), "普通数组");

const p2 = parseProfileCandidates('```json\n[{"category":"preference","content":"偏好简洁回答"}]\n```');
assert(p2.length === 1 && p2[0].category === "preference", "带 ```json 围栏");

const p3 = parseProfileCandidates("完全不是 JSON");
assert(p3.length === 0, "无效 JSON → 空数组");

const p4 = parseProfileCandidates('{"a":1}');
assert(p4.length === 0, "非数组 → 空数组");

const p5 = parseProfileCandidates('[{"content":"没有分类字段"}]');
assert(p5.length === 1 && p5[0].category === "other", "缺分类 → other");

const p6 = parseProfileCandidates('[{"category":"profile"},{"category":"坏","content":"坏分类"},{"category":"profile","content":"好内容"}]');
assert(p6.length === 2 && p6[0].category === "other" && p6[1].category === "profile", "过滤缺 content 与非法分类");

console.log("== planProfileMutations 去重/合并 ==");
const existing = [makeItem({ id: "e1", content: "用户是计算机专业学生", category: "profile" })];

const m1 = planProfileMutations([{ category: "profile", content: "用户是计算机专业学生" }], existing);
assert(m1.length === 0, "完全相同 → 无变更");

const m2 = planProfileMutations([{ category: "profile", content: "用户是计算机专业学生，熟悉 Java" }], existing);
assert(m2.length === 1 && m2[0].kind === "update" && m2[0].id === "e1", "高度相似 → 更新（取更长描述）");

const m3 = planProfileMutations([{ category: "preference", content: "用户偏好 TypeScript" }], existing);
assert(m3.length === 1 && m3[0].kind === "create", "不同类别/内容 → 创建");

const m4 = planProfileMutations([{ category: "profile", content: "用户叫张三，在杭州工作" }], existing);
assert(m4.length === 1 && m4[0].kind === "create", "低相似度 → 创建（不静默覆盖）");

console.log("");
console.log(failures === 0 ? "ALL TESTS PASSED ✅" : `${failures} TEST(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
