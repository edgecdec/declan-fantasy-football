const { createServer } = require("http");
const { parse } = require("url");
const { createHmac } = require("crypto");
const { execFile } = require("child_process");
const next = require("next");

const PORT = parseInt(process.env.PORT || "3004", 10);
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

function verifySignature(payload, signature) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
  return signature === expected;
}

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsed = parse(req.url, true);

    // GitHub webhook endpoint
    if (req.method === "POST" && parsed.pathname === "/api/webhook") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const sig = req.headers["x-hub-signature-256"];
        if (!verifySignature(body, sig)) {
          res.writeHead(401);
          res.end("Unauthorized");
          return;
        }
        try {
          const payload = JSON.parse(body);
          if (payload.ref === "refs/heads/main") {
            console.log("[webhook] Push to main detected, deploying...");
            execFile("bash", ["deploy_webhook.sh"], { cwd: process.cwd() }, (err, stdout, stderr) => {
              if (err) console.error("[deploy] Error:", stderr);
              else console.log("[deploy] Done:", stdout);
            });
          }
        } catch (e) {
          console.error("[webhook] Parse error:", e.message);
        }
        res.writeHead(200);
        res.end("OK");
      });
      return;
    }

    handle(req, res, parsed);
  });

  server.listen(PORT, () => {
    console.log(`> Declanalytics ready on http://localhost:${PORT}`);
  });
});
