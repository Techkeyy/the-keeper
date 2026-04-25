const { createSignalWorkflow, listWorkflows, deleteWorkflow } = require("./client");

async function syncDropsToKeeperHub(drops) {
  const khApiKey = process.env.KH_API_KEY;
  if (!khApiKey) {
    console.log("[KH Sync] No KH_API_KEY set — skipping KeeperHub workflow sync");
    return;
  }

  console.log(`[KH Sync] Syncing ${drops.length} active drops to KeeperHub...`);

  for (const drop of drops) {
    try {
      const result = await createSignalWorkflow({
        id: drop.id,
        tag: drop.tag,
        severity: drop.severity,
        price: drop.price,
        teaser: drop.teaser,
        ttl: drop.ttl,
        treasuryWallet: process.env.KEEPER_TREASURY_WALLET,
        apiKey: khApiKey
      });
      console.log(`[KH Sync] Created workflow for drop ${drop.id.slice(0, 8)}: ${result.workflowId}`);
    } catch (err) {
      console.error(`[KH Sync] Failed to create workflow for drop ${drop.id.slice(0, 8)}: ${err.message}`);
    }
  }
}

async function cleanupExpiredWorkflows(activeDropIds) {
  const khApiKey = process.env.KH_API_KEY;
  if (!khApiKey) return;
  try {
    const workflows = await listWorkflows(khApiKey);
    const wfList = Array.isArray(workflows) ? workflows : [];
    for (const wf of wfList) {
      if (wf.name && wf.name.startsWith("signal:")) {
        const dropId = wf.name.replace("signal:", "");
        if (!activeDropIds.includes(dropId)) {
          await deleteWorkflow(wf.id, khApiKey);
          console.log(`[KH Sync] Deleted expired workflow: ${wf.id}`);
        }
      }
    }
  } catch (err) {
    console.error(`[KH Sync] Cleanup error: ${err.message}`);
  }
}

module.exports = { syncDropsToKeeperHub, cleanupExpiredWorkflows };
