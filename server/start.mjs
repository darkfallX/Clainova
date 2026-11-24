import { nativeRequest } from "./native.mjs";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import zlib from "node:zlib";
import { openStore } from "./store.mjs";
import { authority, liveAdapters } from "./network.mjs";
import { service, equal } from "./service.mjs";
import { secret, now, requireThat } from "./common.mjs";

const env = process.env,
  mode = env.MODE || "rehearsal",
  local = mode === "rehearsal";
if (!["rehearsal", "testnet"].includes(mode))
  throw Error("MODE must be rehearsal or testnet.");
const port = Number(env.PORT || 4173),
  origin = local
    ? "http://127.0.0.1:" + port
    : new URL(env.PUBLIC_ORIGIN).origin;
if (
  !local &&
  (!origin.startsWith("https://") ||
    !/^[0-9a-f]{64}$/i.test(env.DATA_KEY || "") ||
    !/^[0-9a-f]{64}$/i.test(env.VERIFIER_SEED || "") ||
    (env.OPERATOR_PASSWORD || "").length < 16 ||
    !env.AT_API_KEY ||
    !env.AT_USERNAME ||
    !env.ESCROW_ADDRESS)
)
  throw Error("Missing testnet configuration. See .env.example.");
const folder = path.join(env.DATA_DIR || ".data", mode);
fs.mkdirSync(folder, { recursive: true });
function key(name) {
  if (!local) return Buffer.from(env[name], "hex");
  const file = path.join(folder, name);
  if (!fs.existsSync(file))
    fs.writeFileSync(file, randomBytes(32), { mode: 0o600, flag: "wx" });
  return fs.readFileSync(file);
}
const store = openStore(path.join(folder, "payments.sqlite"), key("DATA_KEY"));
const signer = authority(key("VERIFIER_SEED"));
const live = local ? null : await liveAdapters(env, signer, store);
const app = service({
  store,
  authority: signer,
  live,
  config: {
    origin,
    cohort: env.COHORT === "field" ? "field" : "team",
    contract: local ? undefined : env.ESCROW_ADDRESS,
  },
});
const staticFiles = {
  "/pocket-fold.webp": ["pocket-fold.webp", "image/webp"],
  "/styles.css": ["styles.css", "text/css"],
  "/app.js": ["app.js", "application/javascript"],
  "/outfit.woff2": ["outfit.woff2", "font/woff2"],
};
// Behind a Cloudflare tunnel every request reaches the loopback socket, so
// per-visitor limits would collapse into one bucket. Trust Cloudflare's
// client header only when explicitly enabled and the socket is loopback.
const loopback = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
function clientAddress(req) {
  const socket = req.socket.remoteAddress || "";
  const forwarded = req.headers["cf-connecting-ip"];
  return env.TRUST_PROXY === "cloudflare" &&
    loopback.has(socket) &&
    typeof forwarded === "string" &&
    forwarded.length <= 64
    ? forwarded
    : socket;
}
// Static files are compressed once per build and revalidated by ETag, which
// keeps a phone on mobile data from re-downloading the 0.5 MB bundle.
const packed = new Map();
function staticBody(file) {
  const full = path.join("dist", file);
  const stamp = fs.statSync(full).mtimeMs;
  let entry = packed.get(file);
  if (!entry || entry.stamp !== stamp) {
    const raw = fs.readFileSync(full);
    const compressible = !/\.(webp|woff2)$/.test(file);
    entry = {
      stamp,
      raw,
      etag: '"' + createHash("sha256").update(raw).digest("base64url").slice(0, 22) + '"',
      br: compressible ? zlib.brotliCompressSync(raw) : null,
      gzip: compressible ? zlib.gzipSync(raw, { level: 9 }) : null,
    };
    packed.set(file, entry);
  }
  return entry;
}
function sendStatic(req, res, file, cacheable) {
  const entry = staticBody(file);
  res.setHeader("Vary", "Accept-Encoding");
  if (cacheable) {
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("ETag", entry.etag);
    // Cloudflare weakens ETags (W/"…") when it re-encodes, so compare the tag itself.
    const tags = String(req.headers["if-none-match"] || "")
      .split(",")
      .map((t) => t.trim().replace(/^W\//, ""));
    if (tags.includes(entry.etag)) {
      res.writeHead(304).end();
      return;
    }
  }
  const accepts = String(req.headers["accept-encoding"] || "");
  const encoding = entry.br && /\bbr\b/.test(accepts)
    ? "br"
    : entry.gzip && /\bgzip\b/.test(accepts)
      ? "gzip"
      : null;
  if (encoding) res.setHeader("Content-Encoding", encoding);
  res.end(encoding ? entry[encoding] : entry.raw);
}
function cookie(response, name, value, maxAge) {
  response.setHeader(
    "Set-Cookie",
    name +
      "=" +
      value +
      "; Path=/; HttpOnly; SameSite=Strict; Max-Age=" +
      maxAge +
      (local ? "" : "; Secure"),
  );
}
async function handle(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self' https://evm-testnet.qore.host https://api-testnet.qore.host; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  const pathname = new URL(req.url, origin).pathname;
  // Rehearsal cookies and origin checks are bound to 127.0.0.1. Send a
  // visitor who typed "localhost" to the same page there.
  if (local && req.method === "GET" && req.headers.host === "localhost:" + port) {
    res.writeHead(302, { Location: origin + pathname }).end();
    return;
  }
  if (local)
    requireThat(
      req.headers.host === new URL(origin).host,
      "Use the local address printed at startup.",
      403,
    );
  if (req.method === "GET" && !pathname.startsWith("/api/")) {
    if (pathname === "/robots.txt" || pathname === "/sitemap.xml") {
      const sitemap = pathname.endsWith("xml");
      res.setHeader("Content-Type", sitemap ? "application/xml" : "text/plain");
      res.end(
        sitemap
          ? '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>' +
              origin +
              "/</loc></url></urlset>"
          : "User-agent: *\nDisallow: /c/\nDisallow: /api/\nDisallow: /ledger\nSitemap: " +
              origin +
              "/sitemap.xml",
      );
      return;
    }
    if (pathname === "/favicon.ico") {
      res.writeHead(204).end();
      return;
    }
    const page =
      ["/", "/ledger", "/privacy", "/terms"].includes(pathname) ||
      /^\/c\/[\da-f]{64}\.[\da-f]{64}$/.test(pathname);
    requireThat(
      page || Object.hasOwn(staticFiles, pathname),
      "Page unavailable.",
      404,
    );
    if (pathname !== "/" || local)
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
    const [file, type] = page
      ? ["index.html", "text/html"]
      : staticFiles[pathname];
    res.setHeader("Content-Type", type);
    // Pages keep no-store (private invitation paths); assets may revalidate.
    sendStatic(req, res, file, !page);
    return;
  }
  const cookies = Object.fromEntries(
    (req.headers.cookie || "").split(";").map((x) => x.trim().split("=")),
  );
  let owner;
  if (local) {
    let sid = cookies.rehearsal;
    if (!/^[0-9a-f]{64}$/.test(sid || "")) {
      sid = secret();
      cookie(res, "rehearsal", sid, 604800);
    }
    owner = store.sign("session:" + sid);
  } else {
    const [until, sig] = (cookies.organiser || "").split(".");
    if (Number(until) > now() && equal(sig, store.sign("operator:" + until)))
      owner = "organiser";
  }
  let b = {};
  if (req.method === "POST") {
    requireThat(
      req.headers.origin === origin &&
        req.headers["content-type"]?.startsWith("application/json"),
      "Request origin or format is invalid.",
      403,
    );
    requireThat(
      store.limit(
        "ip:" + store.sign(clientAddress(req)),
        150,
        60,
        now(),
      ),
      "Too many requests. Try again shortly.",
      429,
    );
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      requireThat(size <= 24000, "Request too large.", 413);
      chunks.push(chunk);
    }
    try {
      b = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      requireThat(false, "Enter valid request data.");
    }
    requireThat(
      b && !Array.isArray(b) && typeof b === "object",
      "Invalid request data.",
    );
  }
  const parts = pathname.split("/").filter(Boolean),
    route = req.method + " /" + parts.slice(0, 2).join("/"),
    action = parts[3];
  let data;
  if (route === "GET /api/config")
    data = {
      mode,
      session: !!owner,
      chain: app.chain,
      contract: app.contract,
      token: app.token,
      sponsored: app.sponsored,
    };
  else if (route === "POST /api/login") {
    requireThat(
      !local && store.limit("login:" + store.sign(clientAddress(req)), 8, 600, now()),
      "Sign-in temporarily unavailable.",
      429,
    );
    requireThat(
      equal(b.password, env.OPERATOR_PASSWORD),
      "Incorrect password.",
      401,
    );
    const t = now() + 14400;
    cookie(res, "organiser", t + "." + store.sign("operator:" + t), 14400);
    data = { ok: true };
  } else if (!local && parts[1] === "native") {
    data = await nativeRequest(parts[2], parts[3], b, req.method);
  } else if (parts[1] === "payments") {
    requireThat(owner, "Sign in as organiser.", 401);
    if (req.method === "GET" && parts.length === 2)
      data = await app.list(owner);
    else if (req.method === "POST" && parts.length === 2)
      data = await app.create(owner, b);
    else if (req.method === "POST" && action === "deliver")
      data = await app.deliver(owner, parts[2]);
    else if (req.method === "POST" && action === "evidence")
      data = await app.operatorEvidence(owner, parts[2], b.kind, b.hash);
    else if (req.method === "POST" && action === "refund")
      data = await app.refund(owner, parts[2]);
  } else if (parts[1] === "invite") {
    const link = parts[2];
    if (req.method === "GET" && !action) data = await app.open(link);
    if (req.method === "POST") {
      if (action === "code") data = await app.code(link);
      if (action === "verify") data = await app.verify(link, b.code);
      if (action === "attest")
        data = await app.attest(link, b.token, b.destination);
      if (action === "observe")
        data = await app.observe(link, b.token, b.destination);
      if (action === "evidence")
        data = await app.recipientEvidence(link, b.kind, b.hash);
      if (action === "sponsor")
        data = await app.sponsor(link, b.token, b.destination);
      if (action === "settle") data = await app.settle(link, b);
    }
  } else if (local && route === "GET /api/balance")
    data = { balance: app.localBalance(parts[2]) };
  else if (local && route === "POST /api/transfer") data = app.transfer(b);
  requireThat(data !== undefined, "Page unavailable.", 404);
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}
const server = http.createServer((req, res) =>
  handle(req, res).catch((err) => {
    const status = err.status || 502;
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: err.status
          ? err.message
          : "Service unavailable. Your payment record is preserved. Refresh and retry.",
      }),
    );
  }),
);
server.requestTimeout = 15000;
server.listen(port, local ? "127.0.0.1" : env.HOST || "127.0.0.1", () =>
  console.log("Clainova " + mode + " at " + origin),
);
