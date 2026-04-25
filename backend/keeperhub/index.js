module.exports = {
  ...require("./client"),
  ...require("./workflow-sync"),
  createMCPServer: require("./mcp-server").createMCPServer,
  TOOLS: require("./mcp-server").TOOLS
};
