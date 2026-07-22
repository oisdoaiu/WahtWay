import { useEffect, useState } from "react";

type RuntimeState = "stopped" | "starting" | "running" | "reconnecting" | "error";
type ToolPermission = "auto" | "confirm" | "disabled";

interface McpToolSummary {
  name: string;
  registeredName: string;
  description: string;
  permission: ToolPermission;
  overridden: boolean;
}

interface McpServer {
  id: string;
  name: string;
  description: string;
  command: string;
  args: string[];
  cwd: string | null;
  env: Record<string, string>;
  enabled: boolean;
  autoStart: boolean;
  defaultToolPermission: ToolPermission;
  toolPermissions: Record<string, ToolPermission>;
  toolCallTimeoutMs: number;
  secretNames: string[];
  status: {
    state: RuntimeState;
    tools: McpToolSummary[];
    startedAt: string | null;
    lastError: string | null;
    lastHealthCheckAt: string | null;
    lastDisconnectedAt: string | null;
    consecutiveFailures: number;
    reconnectAttempt: number;
    nextReconnectAt: string | null;
  };
}

interface EditorState {
  id: string;
  name: string;
  description: string;
  command: string;
  argsText: string;
  cwd: string;
  envText: string;
  enabled: boolean;
  autoStart: boolean;
  defaultToolPermission: ToolPermission;
  toolCallTimeoutMs: number;
}

const EMPTY_EDITOR: EditorState = {
  id: "",
  name: "",
  description: "",
  command: "",
  argsText: "[]",
  cwd: "",
  envText: "{}",
  enabled: true,
  autoStart: false,
  defaultToolPermission: "confirm",
  toolCallTimeoutMs: 60000,
};

const STATE_LABELS: Record<RuntimeState, string> = {
  stopped: "已停止",
  starting: "启动中",
  running: "运行中",
  reconnecting: "重连中",
  error: "异常",
};

export function McpPanel({ onNotify }: { onNotify: (message: string, type?: "info" | "error") => void }) {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [editing, setEditing] = useState<EditorState | null>(null);
  const [originalId, setOriginalId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState("");
  const [secretName, setSecretName] = useState("");
  const [secretValue, setSecretValue] = useState("");

  const load = async () => {
    const response = await fetch("/api/mcp/servers");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "MCP Server 加载失败");
    setServers(data.servers || []);
  };

  useEffect(() => {
    load().catch((error) => onNotify(error.message, "error"));
    const timer = setInterval(() => load().catch(() => undefined), 2000);
    return () => clearInterval(timer);
  }, []);

  const openEditor = (server?: McpServer) => {
    setOriginalId(server?.id || null);
    setEditing(server ? {
      id: server.id,
      name: server.name,
      description: server.description,
      command: server.command,
      argsText: JSON.stringify(server.args, null, 2),
      cwd: server.cwd || "",
      envText: JSON.stringify(server.env, null, 2),
      enabled: server.enabled,
      autoStart: server.autoStart,
      defaultToolPermission: server.defaultToolPermission,
      toolCallTimeoutMs: server.toolCallTimeoutMs,
    } : { ...EMPTY_EDITOR });
    setSecretName("");
    setSecretValue("");
  };

  const request = async (url: string, options?: RequestInit) => {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "MCP 操作失败");
    return data;
  };

  const save = async () => {
    if (!editing) return;
    try {
      const args = JSON.parse(editing.argsText);
      const env = JSON.parse(editing.envText);
      if (!Array.isArray(args)) throw new Error("启动参数必须是 JSON 数组");
      if (!env || typeof env !== "object" || Array.isArray(env)) throw new Error("环境变量必须是 JSON 对象");
      await request(originalId ? `/api/mcp/servers/${originalId}` : "/api/mcp/servers", {
        method: originalId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editing.id,
          name: editing.name,
          description: editing.description,
          command: editing.command,
          args,
          cwd: editing.cwd || null,
          env,
          enabled: editing.enabled,
          autoStart: editing.autoStart,
          defaultToolPermission: editing.defaultToolPermission,
          toolCallTimeoutMs: editing.toolCallTimeoutMs,
        }),
      });
      setEditing(null);
      await load();
      onNotify("MCP Server 已保存");
    } catch (error: any) {
      onNotify(error.message || "配置格式无效", "error");
    }
  };

  const lifecycle = async (id: string, action: "start" | "stop" | "restart" | "test" | "health") => {
    setBusyId(id);
    try {
      const data = await request(`/api/mcp/servers/${id}/${action}`, { method: "POST" });
      await load();
      onNotify(action === "test" ? `连接成功，发现 ${data.tools?.length || 0} 个工具` : action === "health" ? "MCP 健康检查通过" : "MCP 状态已更新");
    } catch (error: any) {
      await load().catch(() => undefined);
      onNotify(error.message || "MCP 操作失败", "error");
    } finally {
      setBusyId("");
    }
  };

  const saveSecret = async () => {
    if (!originalId) return;
    try {
      await request(`/api/mcp/servers/${originalId}/secrets/${encodeURIComponent(secretName.trim())}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: secretValue }),
      });
      setSecretName("");
      setSecretValue("");
      await load();
      onNotify("MCP Secret 已保存，Server 已停止以应用新配置");
    } catch (error: any) {
      onNotify(error.message || "Secret 保存失败", "error");
    }
  };

  const updateDefaultPermission = async (serverId: string, permission: ToolPermission) => {
    setBusyId(serverId);
    try {
      await request(`/api/mcp/servers/${serverId}/tool-permissions/default`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permission }),
      });
      await load();
      onNotify("MCP 默认工具权限已更新");
    } catch (error: any) {
      await load().catch(() => undefined);
      onNotify(error.message || "权限更新失败", "error");
    } finally {
      setBusyId("");
    }
  };

  const updateToolPermission = async (serverId: string, toolName: string, value: string) => {
    setBusyId(serverId);
    try {
      const inherited = value === "inherit";
      await request(`/api/mcp/servers/${serverId}/tool-permissions/${encodeURIComponent(toolName)}`, {
        method: inherited ? "DELETE" : "PATCH",
        headers: inherited ? undefined : { "Content-Type": "application/json" },
        body: inherited ? undefined : JSON.stringify({ permission: value }),
      });
      await load();
      onNotify(inherited ? "工具已恢复继承默认权限" : "工具权限已更新");
    } catch (error: any) {
      await load().catch(() => undefined);
      onNotify(error.message || "工具权限更新失败", "error");
    } finally {
      setBusyId("");
    }
  };

  const editingServer = originalId ? servers.find((server) => server.id === originalId) : undefined;

  return (
    <section className="mcp-panel">
      <header className="header">
        <h1>MCP Servers</h1>
        <span className="subtitle">本地 stdio 工具服务</span>
        <button className="create-btn" onClick={() => openEditor()}>添加 Server</button>
      </header>

      <div className="mcp-server-list">
        {servers.length === 0 && <div className="mcp-empty">还没有配置 MCP Server</div>}
        {servers.map((server) => (
          <div key={server.id} className={`mcp-server-row state-${server.status.state}`}>
            <span className="mcp-state-dot" title={STATE_LABELS[server.status.state]} />
            <div className="mcp-server-info">
              <div className="mcp-server-title"><strong>{server.name}</strong><code>{server.id}</code><span>{STATE_LABELS[server.status.state]}</span></div>
              <p>{server.description}</p>
              <div className="mcp-command"><code>{server.command}</code>{server.args.map((arg, index) => <code key={index}>{arg}</code>)}</div>
              <label className="mcp-default-permission">默认工具权限
                <select value={server.defaultToolPermission} disabled={busyId === server.id} onChange={(event) => updateDefaultPermission(server.id, event.target.value as ToolPermission)}>
                  <option value="confirm">每次确认</option><option value="auto">自动调用</option><option value="disabled">全部禁用</option>
                </select>
              </label>
              <div className="mcp-runtime-meta">
                {server.status.lastHealthCheckAt && <span>最近健康检查：{new Date(server.status.lastHealthCheckAt).toLocaleTimeString()}</span>}
                {server.status.reconnectAttempt > 0 && <span>重连尝试：{server.status.reconnectAttempt}/6</span>}
                {server.status.nextReconnectAt && <span>下次重连：{new Date(server.status.nextReconnectAt).toLocaleTimeString()}</span>}
                {server.status.consecutiveFailures > 0 && <span className="failure">连续失败：{server.status.consecutiveFailures}</span>}
              </div>
              {server.status.lastError && <div className="mcp-error">{server.status.lastError}</div>}
              {server.status.tools.length > 0 && (
                <div className="mcp-tool-list">
                  {server.status.tools.map((tool) => <div key={tool.registeredName} className={`mcp-tool-permission permission-${tool.permission}`} title={tool.description}>
                    <span>{tool.registeredName}</span>
                    <select value={tool.overridden ? tool.permission : "inherit"} disabled={busyId === server.id} onChange={(event) => updateToolPermission(server.id, tool.name, event.target.value)}>
                      <option value="inherit">继承默认（{server.defaultToolPermission}）</option>
                      <option value="auto">自动调用</option><option value="confirm">每次确认</option><option value="disabled">禁用</option>
                    </select>
                  </div>)}
                </div>
              )}
            </div>
            <div className="mcp-server-actions">
              {server.status.state === "running"
                ? <button disabled={busyId === server.id} onClick={() => lifecycle(server.id, "stop")}>停止</button>
                : <button disabled={busyId === server.id || !server.enabled} onClick={() => lifecycle(server.id, "start")}>启动</button>}
              {server.status.state === "running" && <button disabled={busyId === server.id} onClick={() => lifecycle(server.id, "health")}>健康检查</button>}
              <button disabled={busyId === server.id || !server.enabled} onClick={() => lifecycle(server.id, "test")}>测试</button>
              <button disabled={busyId === server.id} onClick={() => openEditor(server)}>编辑</button>
              <button className="danger" disabled={busyId === server.id} onClick={async () => {
                try { await request(`/api/mcp/servers/${server.id}`, { method: "DELETE" }); await load(); }
                catch (error: any) { onNotify(error.message, "error"); }
              }}>删除</button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="modal mcp-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header"><h2>{originalId ? "编辑 MCP Server" : "添加 MCP Server"}</h2><button className="modal-close" onClick={() => setEditing(null)}>×</button></div>
            <div className="mcp-form">
              <label>Server ID<input value={editing.id} disabled={!!originalId} onChange={(event) => setEditing({ ...editing, id: event.target.value })} placeholder="filesystem" /></label>
              <label>名称<input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} placeholder="Filesystem Server" /></label>
              <label className="wide">描述<input value={editing.description} onChange={(event) => setEditing({ ...editing, description: event.target.value })} /></label>
              <label className="wide">启动命令<input value={editing.command} onChange={(event) => setEditing({ ...editing, command: event.target.value })} placeholder="node 或可执行文件绝对路径" /></label>
              <label className="wide">参数列表<textarea rows={5} value={editing.argsText} onChange={(event) => setEditing({ ...editing, argsText: event.target.value })} /></label>
              <label className="wide">工作目录<input value={editing.cwd} onChange={(event) => setEditing({ ...editing, cwd: event.target.value })} placeholder="可选，必须是已有目录" /></label>
              <label className="wide">环境变量<textarea rows={5} value={editing.envText} onChange={(event) => setEditing({ ...editing, envText: event.target.value })} /></label>
              <label>工具超时（毫秒）<input type="number" min={1000} max={300000} value={editing.toolCallTimeoutMs} onChange={(event) => setEditing({ ...editing, toolCallTimeoutMs: Number(event.target.value) })} /></label>
              <label>默认工具权限<select value={editing.defaultToolPermission} onChange={(event) => setEditing({ ...editing, defaultToolPermission: event.target.value as ToolPermission })}><option value="confirm">每次确认</option><option value="auto">自动调用</option><option value="disabled">全部禁用</option></select></label>
              <div className="mcp-checks">
                <label><input type="checkbox" checked={editing.enabled} onChange={(event) => setEditing({ ...editing, enabled: event.target.checked })} /> 启用</label>
                <label><input type="checkbox" checked={editing.autoStart} onChange={(event) => setEditing({ ...editing, autoStart: event.target.checked })} /> 启动应用时连接</label>
              </div>
              {originalId && (
                <div className="mcp-secret-box wide">
                  <strong>Secrets</strong>
                  <div className="mcp-secret-inputs"><input value={secretName} onChange={(event) => setSecretName(event.target.value.toUpperCase())} placeholder="API_KEY" /><input type="password" value={secretValue} onChange={(event) => setSecretValue(event.target.value)} placeholder="Secret 不会回显" /><button onClick={saveSecret}>保存</button></div>
                  <small>在环境变量值中使用 ${"${API_KEY}"}</small>
                  <div className="mcp-secret-list">{(editingServer?.secretNames || []).map((name) => <span key={name}>{name}<button title="删除 Secret" onClick={async () => { await request(`/api/mcp/servers/${originalId}/secrets/${name}`, { method: "DELETE" }); await load(); }}>×</button></span>)}</div>
                </div>
              )}
            </div>
            <div className="modal-actions"><button onClick={() => setEditing(null)}>取消</button><button className="primary" onClick={save}>保存 Server</button></div>
          </div>
        </div>
      )}
    </section>
  );
}
