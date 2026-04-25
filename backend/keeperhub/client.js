const https = require("https");

const KH_BASE = "https://app.keeperhub.com/api";

function khRequest(method, path, body, apiKey) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: "app.keeperhub.com",
      path: `/api${path}`,
      method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {})
      }
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(`KeeperHub API ${res.statusCode}: ${JSON.stringify(parsed)}`));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error(`KeeperHub parse error: ${data}`));
        }
      });
    });

    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function createSignalWorkflow({ id, tag, severity, price, teaser, ttl, treasuryWallet, apiKey }) {
  const name = `signal:${id}`;
  const description = `TheKeeper signal — ${tag} [${severity}] — ${teaser}`;

  const nodes = [
    {
      id: "trigger-1",
      type: "trigger",
      data: {
        label: "Signal Webhook",
        description: "Triggered when buyer acquires this signal",
        type: "trigger",
        config: { triggerType: "Webhook" },
        status: "idle"
      }
    },
    {
      id: "check-payment",
      type: "action",
      data: {
        label: "Verify Payment",
        description: "Check x402 payment header is present",
        type: "action",
        config: {
          actionType: "system/condition",
          condition: "{{@trigger-1:Signal Webhook.headers.x-payment}} !== undefined"
        },
        status: "idle"
      }
    },
    {
      id: "deliver-signal",
      type: "action",
      data: {
        label: "Deliver Signal",
        description: "Return decrypted signal payload to buyer",
        type: "action",
        config: {
          actionType: "system/webhook",
          url: "{{env.BACKEND_URL}}/internal/deliver/{{@trigger-1:Signal Webhook.body.dropId}}",
          method: "POST",
          headers: { "x-keeper-secret": "{{env.KEEPER_INTERNAL_SECRET}}" }
        },
        status: "idle"
      }
    }
  ];

  const edges = [
    { id: "e1", source: "trigger-1", target: "check-payment" },
    { id: "e2", source: "check-payment", target: "deliver-signal", sourceHandle: "true" }
  ];

  const workflow = await khRequest("POST", "/workflows/create", { name, description }, apiKey);
  const workflowId = workflow.id;

  await khRequest("PATCH", `/workflows/${workflowId}`, {
    name,
    description,
    nodes,
    edges,
    visibility: "private"
  }, apiKey);

  return { workflowId, name, description };
}

async function executeWorkflow(workflowId, apiKey) {
  return khRequest("POST", `/workflow/${workflowId}/execute`, {}, apiKey);
}

async function getExecutionStatus(executionId, apiKey) {
  return khRequest("GET", `/workflows/executions/${executionId}/status`, null, apiKey);
}

async function getExecutionLogs(executionId, apiKey) {
  return khRequest("GET", `/workflows/executions/${executionId}/logs`, null, apiKey);
}

async function listWorkflows(apiKey) {
  return khRequest("GET", "/workflows", null, apiKey);
}

async function deleteWorkflow(workflowId, apiKey) {
  return khRequest("DELETE", `/workflows/${workflowId}?force=true`, null, apiKey);
}

async function getWalletIntegration(apiKey) {
  return khRequest("GET", "/integrations?type=web3", null, apiKey);
}

module.exports = {
  createSignalWorkflow,
  executeWorkflow,
  getExecutionStatus,
  getExecutionLogs,
  listWorkflows,
  deleteWorkflow,
  getWalletIntegration,
  khRequest
};
