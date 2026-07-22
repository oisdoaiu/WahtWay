const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");

const server = new Server(
  { name: "wahtway-mcp-crash-test", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: "crash",
    description: "Terminates the fixture process",
    inputSchema: { type: "object", properties: {} },
  }],
}));

server.setRequestHandler(CallToolRequestSchema, async () => {
  setImmediate(() => process.exit(23));
  return { content: [{ type: "text", text: "terminating" }] };
});

server.connect(new StdioServerTransport()).catch((error) => {
  process.stderr.write(String(error));
  process.exit(1);
});
