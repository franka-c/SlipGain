const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const {
  handleAdminUsers,
  handleAccessRequest,
  handleConfig,
  handleCurrentUser,
  handleEpics,
  handleLastWeekTime,
  handleProjects,
  handleReport,
  handleTrends,
} = require("./lib/jira");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".otf": "font/otf",
    ".ttf": "font/ttf",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  };

  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    res.writeHead(200, {
      "Content-Type": contentTypes[ext] || "application/octet-stream",
    });
    res.end(content);
  });
}

function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/config") {
      handleConfig(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/me") {
      handleCurrentUser(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/access-request") {
      handleAccessRequest(req, res);
      return;
    }

    if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/admin/users") {
      handleAdminUsers(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/projects") {
      handleProjects(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/epics") {
      handleEpics(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/report") {
      handleReport(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/last-week-hours") {
      handleLastWeekTime(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/trends") {
      handleTrends(req, res);
      return;
    }

    const requestedPath =
      url.pathname === "/" || url.pathname === "/admin"
        ? "/index.html"
        : url.pathname;
    const filePath = path.join(PUBLIC_DIR, requestedPath);

    if (!filePath.startsWith(PUBLIC_DIR)) {
      sendJson(res, 403, { error: "Forbidden" });
      return;
    }

    sendFile(res, filePath);
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(PORT, HOST, () => {
    console.log(`Slip gain app running at http://${HOST}:${PORT}`);
  });
}

module.exports = { createServer };
