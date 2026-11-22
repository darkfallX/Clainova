export const el = (s) => document.querySelector(s);
export const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const money = (units) =>
  new Intl.NumberFormat("en", { maximumFractionDigits: 6 }).format(units / 1e6);
export const date = (t) =>
  new Date(t * 1000).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
export const title = (h, p) =>
  '<div class="intro"><h1>' + h + "</h1><p>" + p + "</p></div>";
export function state(r) {
  return r.state === "funded" && r.expiry <= Date.now() / 1000
    ? "Expired"
    : {
        draft: "Awaiting deposit",
        funded: "Ready to collect",
        collected: "Collected",
        refunded: "Refunded",
      }[r.state] || "Preview";
}
export function receipt(r = {}) {
  const status = state(r);
  return (
    '<aside class="press" aria-label="Payment slip"><div class="presshead"><span>Payment slip</span><span>Client copy</span></div><div class="receipt"><div class="receipttop"><strong>Clainova</strong><span class="meta">Transfer order</span></div><div class="amount-line meta">Amount payable</div><div class="total"><span id="slipAmount">' +
    esc(money(r.amount ?? 20000000)) +
    '</span> <small>test fUSD</small></div><dl><div><dt>Recipient</dt><dd id="slipPhone">' +
    esc(r.mask || "Phone number") +
    '</dd></div><div><dt>Collect by</dt><dd id="slipExpiry">' +
    esc(r.expiry ? date(r.expiry) : "Within 7 days") +
    '</dd></div><div><dt>Reference</dt><dd class="code">' +
    esc(r.id ? r.id.slice(2, 10).toUpperCase() : "Assigned on issue") +
    '</dd></div></dl><div class="foil"><canvas aria-hidden="true" width="700" height="140"></canvas><span class="stamp ' +
    (r.id ? "done" : "") +
    '">' +
    esc(status) +
    "</span></div></div></aside>"
  );
}
export function drawSlip() {
  const canvas = el(".foil canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.strokeStyle = "#ad6742";
  ctx.lineWidth = 0.9;
  for (let strand = 0; strand < 23; strand++) {
    ctx.beginPath();
    for (let x = 0; x <= 700; x += 2) {
      const phase = x / 57 + strand * 0.15;
      const y =
        70 + Math.sin(phase) * 44 + Math.sin(x / 93 - strand * 0.18) * 17;
      x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
}
export const main = (html) => {
  el("#main").innerHTML = html;
  drawSlip();
};
let timer;
export function status(text, timeout = 0) {
  clearTimeout(timer);
  el("#feedback").textContent = text;
  if (el("#review").open && el("#dialogMsg"))
    el("#dialogMsg").textContent = text;
  if (timeout)
    timer = setTimeout(() => (el("#feedback").textContent = ""), timeout);
}
export function modal(heading, html) {
  el("#dialogBody").innerHTML =
    '<h2 id="dialogTitle">' +
    heading +
    "</h2>" +
    html +
    '<p role="status" id="dialogMsg"></p>';
  if (!el("#review").open) el("#review").showModal();
}
export function close() {
  el("#review").close();
  status("");
}
export function on(selector, event, fn) {
  const target = el(selector);
  if (!target) return;
  target.addEventListener(event, async (e) => {
    e.preventDefault();
    if (target.dataset.busy) return;
    const control = target.tagName === "FORM" ? e.submitter : target;
    target.dataset.busy = "yes";
    if (control) control.disabled = true;
    status("");
    try {
      await fn(e);
    } catch (err) {
      status(err.shortMessage || err.message || "The request failed.", 12000);
    } finally {
      delete target.dataset.busy;
      if (control) control.disabled = false;
    }
  });
}
export const click = (s, fn) => on(s, "click", fn);
export async function api(url, body) {
  const r = await fetch(
    url,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await r.json();
  if (!r.ok) throw Error(data.error || "The service is unavailable.");
  return data;
}
