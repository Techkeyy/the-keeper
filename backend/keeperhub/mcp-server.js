require("dotenv").config();

const http = require("http");
const { createSignalWorkflow, executeWorkflow, getExecutionStatus, getExecutionLogs, listWorkflows } = require("./client");

const PORT = Number(process.env.MCP_PORT || 4001);

const TOOLS = [
  {
    name: "discover_signals",
    description: "Discover available intelligence signals on TheKeeper marketplace. Returns list of active signals with id, tag, severity, price, teaser, and time remaining.",
    inputSchema: {
      type: "object",
      properties: {
        tag: { type: "string", description: "Filter by tag: trading_signal, logistics_alert, intelligence, research, weather_alert, sports_intel" },
        severity: { type: "string", description: "Filter by severity: LOW, MEDIUM, HIGH, CRITICAL" },
        max_price: { type: "string", description: "Maximum price in USDC e.g. 0.10" }
      }
    }
  },
  {
    name: "acquire_signal",
    description: "Acquire an intelligence signal by ID. Handles x402 payment and returns the decrypted signal payload.",
    inputSchema: {
      type: "object",
      required: ["signal_id"],
      properties: {
        signal_id: { type: "string", description: "The signal drop ID to acquire" },
        payment_header: { type: "string", description: "Optional: pre-computed X-PAYMENT header value" }
      }
    }
  },
  {
    name: "get_signal_status",
    description: "Check the execution status of a signal acquisition by execution ID.",
    inputSchema: {
      type: "object",
      required: ["execution_id"],
      properties: {
        execution_id: { type: "string", description: "The KeeperHub execution ID returned by acquire_signal" }
      }
    }
  },
  {
    name: "list_keeper_workflows",
    description: "List all active KeeperHub workflows created by TheKeeper for signal delivery.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "get_execution_logs",
    description: "Get detailed execution logs for a signal acquisition including transaction hashes and delivery status.",
    inputSchema: {
      type: "object",
      required: ["execution_id"],
      properties: {
        execution_id: { type: "string", description: "The KeeperHub execution ID" }
      }
    }
  }
];

function sendJSON(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  });
  res.end(body);
}

async function handleToolCall(name, args, backendUrl) {
  if (name === "discover_signals") {
    const res = await fetch(`${backendUrl}/drops`);
    let drops = await res.json();
    if (args.tag) drops = drops.filter(d => d.tag === args.tag);
    if (args.severity) drops = drops.filter(d => String(d.severity).toUpperCase() === args.severity.toUpperCase());
    if (args.max_price) drops = drops.filter(d => parseFloat(d.price) <= parseFloat(args.max_price));
    return { signals: drops, count: drops.length };
  }

  if (name === "acquire_signal") {
    const headers = {};
    if (args.payment_header) headers["X-PAYMENT"] = args.payment_header;

    const dropRes = await fetch(`${backendUrl}/drop/${args.signal_id}`, { headers });
    if (dropRes.status === 402) {
      const challenge = await dropRes.json();
      return {
        status: "payment_required",
        challenge,
        instructions: "Use KeeperHub agentic wallet to pay, then retry with payment_header."
      };
    }
    if (dropRes.status === 200) {
      const payload = await dropRes.json();
      return { status: "acquired", payload };
    }
    return { status: "error", code: dropRes.status };
  }

  if (name === "get_signal_status") {
    return getExecutionStatus(args.execution_id, process.env.KH_API_KEY);
  }

  if (name === "list_keeper_workflows") {
    const workflows = await listWorkflows(process.env.KH_API_KEY);
    return { workflows: Array.isArray(workflows) ? workflows : [] };
  }

  if (name === "get_execution_logs") {
    return getExecutionLogs(args.execution_id, process.env.KH_API_KEY);
  }

  throw new Error(`Unknown tool: ${name}`);
}

function createMCPServer(backendUrl) {
  const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
      });
      res.end();
      return;
    }

    if (req.method === "GET" && req.url === "/tools") {
      return sendJSON(res, 200, { tools: TOOLS });
    }

    if (req.method === "GET" && req.url === "/health") {
      return sendJSON(res, 200, { status: "ok", service: "thekeeper-mcp", tools: TOOLS.length });
    }

    if (req.method === "POST" && req.url === "/tools/call") {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", async () => {
        try {
          const { name, arguments: args } = JSON.parse(body);
          const result = await handleToolCall(name, args || {}, backendUrl);
          return sendJSON(res, 200, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
        } catch (err) {
          return sendJSON(res, 200, { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true });
        }
      });
      return;
    }

    return sendJSON(res, 404, { error: "Not found" });
  });

  server.listen(PORT, () => {
    console.log(`[TheKeeper MCP] Server running on port ${PORT}`);
    console.log(`[TheKeeper MCP] Tools available: ${TOOLS.map(t => t.name).join(", ")}`);
    console.log(`[TheKeeper MCP] Health: http://localhost:${PORT}/health`);
    console.log(`[TheKeeper MCP] Tools: http://localhost:${PORT}/tools`);
  });

  return server;
}

module.exports = { createMCPServer, TOOLS };

if (require.main === module) {
  const backendUrl = process.env.BACKEND_URL || "http://localhost:4000";
  createMCPServer(backendUrl);
}
