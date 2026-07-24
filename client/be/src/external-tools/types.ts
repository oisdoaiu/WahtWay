import { JSONSchema } from "../types";

export type ExternalToolMethod = "GET" | "POST" | "PUT" | "PATCH";
export type ExternalToolPermission = "read" | "write";

export interface ExternalToolConfig {
  id: string;
  name: string;
  description: string;
  method: ExternalToolMethod;
  url: string;
  headers: Record<string, string>;
  parameters: JSONSchema;
  query: Record<string, string>;
  body: unknown;
  responseDataPath: string;
  permission: ExternalToolPermission;
  enabled: boolean;
  timeoutMs: number;
  maxResponseBytes: number;
  createdAt: string;
  updatedAt: string;
  schemaVersion: 1;
}

export interface PublicExternalTool extends ExternalToolConfig {
  secretNames: string[];
}
