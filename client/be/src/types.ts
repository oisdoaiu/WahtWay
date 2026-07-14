// WahtWay 核心类型定义
// 对应架构设计中的 Skill / Tool / AgentResult 数据模型

export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
}

export interface JSONSchemaProperty {
  type: string;
  description: string;
  enum?: string[];
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  input: JSONSchema;
  output: JSONSchema;
  requiredTools: string[];
  keywords?: string[];  // V0.3 关键词匹配
}

export interface AgentResult {
  skillName: string;
  skillId: string;
  output: string;
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}
