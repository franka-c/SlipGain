const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
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

  // HTML/CSS/JS must always be revalidated so a cached asset can never desync
  // from a freshly deployed index.html. no-cache still allows 304s via ETag.
  const revalidateExts = new Set([".html", ".css", ".js"]);

  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    const headers = {
      "Content-Type": contentTypes[ext] || "application/octet-stream",
    };
    if (revalidateExts.has(ext)) {
      headers["Cache-Control"] = "no-cache";
    }

    res.writeHead(200, headers);
    res.end(content);
  });
}

// Short content hash so index.html can reference /styles.css?v=<hash>. A
// changed asset yields a new URL that no CDN/browser has cached, which defeats
// cache layers (e.g. Cloudflare's Browser Cache TTL) that ignore no-cache.
function assetVersion(fileName) {
  try {
    const content = fs.readFileSync(path.join(PUBLIC_DIR, fileName));
    return crypto.createHash("md5").update(content).digest("hex").slice(0, 10);
  } catch (error) {
    return "0";
  }
}

function sendIndexHtml(res) {
  fs.readFile(path.join(PUBLIC_DIR, "index.html"), "utf8", (error, html) => {
    if (error) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    const versioned = html
      .replace('href="/styles.css"', `href="/styles.css?v=${assetVersion("styles.css")}"`)
      .replace('src="/app.js"', `src="/app.js?v=${assetVersion("app.js")}"`);

    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    });
    res.end(versioned);
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

    if (url.pathname === "/" || url.pathname === "/admin") {
      sendIndexHtml(res);
      return;
    }

    const filePath = path.join(PUBLIC_DIR, url.pathname);

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
