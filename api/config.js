const { handleConfig } = require("../lib/jira");

module.exports = async function handler(req, res) {
  handleConfig(req, res);
};
