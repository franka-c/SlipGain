const { handleAdminUsers } = require("../../lib/jira");

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.statusCode = 405;
    res.end("Method Not Allowed");
    return;
  }

  await handleAdminUsers(req, res);
};
