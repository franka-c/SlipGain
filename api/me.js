const { handleCurrentUser } = require("../lib/jira");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.end("Method Not Allowed");
    return;
  }

  await handleCurrentUser(req, res);
};
