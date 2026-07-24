const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");

let extraToolEnabled = false;
const server = new Server(
  { name: "wahtway-mcp-dynamic-tools-test", version: "1.0.0" },
  { capabilities: { tools: { listChanged: true } } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "toggle-tools",
      description: "Adds or removes the dynamic tool",
      inputSchema: { type: "object", properties: {} },
    },
    ...(extraToolEnabled ? [{
      name: "dynamic-echo",
      description: "A dynamically registered echo tool",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
    }] : []),
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "toggle-tools") {
    extraToolEnabled = !extraToolEnabled;
    setImmediate(() => server.sendToolListChanged().catch(() => undefined));
    return { content: [{ type: "text", text: extraToolEnabled ? "added" : "removed" }] };
  }
  if (request.params.name === "dynamic-echo" && extraToolEnabled) {
    return { content: [{ type: "text", text: `dynamic:${String(request.params.arguments?.text || "")}` }] };
  }
  return { isError: true, content: [{ type: "text", text: "unknown tool" }] };
});

server.connect(new StdioServerTransport()).catch((error) => {
  process.stderr.write(String(error));
  process.exit(1);
});
