export interface JSONSchema {
  type: string;
  properties?: Record<string, { type: string; description: string }>;
  required?: string[];
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  input: JSONSchema;
  output: JSONSchema;
  requiredTools: string[];
  keywords?: string[];
}
