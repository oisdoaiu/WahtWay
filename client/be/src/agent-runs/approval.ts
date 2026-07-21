import os from "os";
import { getExternalTool } from "../external-tools/repository";
import { executeExternalTool } from "../external-tools/executor";
import { executeConfirmedMcpTool } from "../mcp/runtime";
import { approveAndExecute } from "../tools/command-tool";
import { approvePath } from "../tools/file-tools";
import { getTool } from "../tools/registry";
import { PendingApproval } from "./types";

function inferredTarget(args: Record<string, unknown>): string | undefined {
  for (const key of ["path", "directory", "source", "destination", "cwd"]) {
    if (typeof args[key] === "string" && args[key]) return args[key] as string;
  }
  return undefined;
}

export function parsePendingApproval(
  marker: string,
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>
): PendingApproval | null {
  if (marker.startsWith("MCP_PERMISSION_REQUIRED::")) {
    const [, serverId = "", mcpToolName = ""] = marker.split("::");
    return { toolCallId, toolName, arguments: args, kind: "mcp", reason: mcpToolName, target: serverId };
  }
  if (marker.startsWith("EXTERNAL_PERMISSION_REQUIRED::")) {
    const [, toolId = ""] = marker.split("::");
    return { toolCallId, toolName, arguments: args, kind: "external", reason: `External tool ${toolId} requires approval`, target: toolId };
  }
  if (!marker.startsWith("PERMISSION_REQUIRED::")) return null;
  const [, reason = "This operation requires approval", markerTarget] = marker.split("::");
  const isCommand = toolName === "run-command" || typeof args.command === "string";
  return {
    toolCallId, toolName, arguments: args, kind: isCommand ? "command" : "file",
    reason, target: markerTarget || inferredTarget(args),
  };
}

export async function executeApprovedTool(approval: PendingApproval): Promise<string> {
  if (approval.kind === "command") {
    return approveAndExecute(String(approval.arguments.command || ""), String(approval.arguments.cwd || os.homedir()));
  }
  if (approval.kind === "external") {
    const tool = getExternalTool(String(approval.target || ""));
    if (!tool) throw new Error("External tool no longer exists");
    return executeExternalTool(tool, approval.arguments, true);
  }
  if (approval.kind === "mcp") {
    return executeConfirmedMcpTool(String(approval.target || ""), approval.reason, approval.arguments);
  }

  const targets = new Set<string>();
  if (approval.target) targets.add(approval.target);
  for (const key of ["path", "directory", "source", "destination"]) {
    const value = approval.arguments[key];
    if (typeof value === "string" && value) targets.add(value);
  }
  for (const target of targets) approvePath(target);
  const tool = getTool(approval.toolName);
  if (!tool) throw new Error(`Unknown tool: ${approval.toolName}`);
  const result = await tool.execute(approval.arguments);
  if (parsePendingApproval(result, approval.toolCallId, approval.toolName, approval.arguments)) {
    throw new Error("The approved file operation still requires permission");
  }
  return result;
}
