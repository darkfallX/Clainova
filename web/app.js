import { lazyWallet } from "./lazy-wallet.js";
import {
  el,
  esc,
  money,
  date,
  title,
  state,
  receipt,
  main,
  status,
  modal,
  close,
  on,
  click,
  api,
  short,
  statusClass,
  checkIcon,
} from "./view.js";
import { seal, stamp, countUp, tick, tilt, stagger } from "./motion.js";
// Below this balance (0.2 test QOR) a recipient is sent a gas top-up.
const ENOUGH_GAS = 200000000000000000n;
let cfg, local, wallet;
const demoSend = location.pathname === "/try/send";
const currentPath = location.pathname,
  link = currentPath.startsWith("/c/") ? currentPath.slice(3) : "";
const invite = (action, body) =>
  api("/api/invite/" + link + (action ? "/" + action : ""), body);
const action = (id, text, primary = false) =>
  '<button type="button" id="' +
  id +
  '" class="' +
  (primary ? "primary" : "secondary") +
  '">' +
  text +
  "</button>";
const layout = (left, right) =>
  '<div class="layout"><section class="formside">' +
  left +
  "</section>" +
  right +
  "</div>";
const convertChoice = () =>
  !local && wallet.current && !wallet.external
    ? '<p class="notice"><label><input id="convert" type="checkbox"> Convert faucet fUSD to cover a shortfall (0.075 test QOR fee).</label></p>'
    : "";
const summary = (rows) =>
  '<dl class="summary">' +
  rows
    .map(
      ([k, v]) => "<div><dt>" + esc(k) + "</dt><dd>" + esc(v) + "</dd></div>",
    )
    .join("") +
  "</dl>";
function walletBox() {
  if (wallet.current)
    return (
      '<div class="wallet"><h3>Your ' +
      (local ? "rehearsal" : "testnet") +
      ' wallet</h3><p class="code wallet-address">' +
      esc(wallet.current.address) +
      '</p><div class="actions">' +
      (!wallet.external ? action("backup", "Save encrypted backup") : "") +
      "</div></div>"
    );
  return (
    '<div class="wallet"><h3>' +
    (demoSend
      ? wallet.saved ? "Unlock the sender wallet" : "Set up a sender wallet"
      : wallet.saved ? "Unlock your wallet" : "Set up your wallet") +
    '</h3><p class="helper">' +
    (wallet.saved
      ? "Enter the passphrase for this device."
      : "Choose a passphrase to encrypt your new wallet on this device. Save the backup so you can use it elsewhere.") +
    '</p><form id="walletForm"><div class="field"><label for="password">Wallet passphrase</label><input type="password" id="password" minlength="10" required autocomplete="' +
    (wallet.saved ? "current" : "new") +
    '-password"></div><button class="primary">' +
    (wallet.saved ? "Unlock wallet" : "Create my wallet") +
    '</button></form><details><summary>More wallet options</summary><div class="field"><label for="restore">Restore an encrypted Clainova backup</label><input id="restore" type="file" accept=".json,application/json"></div>' +
    (!local && !demoSend ? action("qorex", "Connect QoreX account") : "") +
    "</details></div>"
  );
}
function bindWallet(next) {
  const restore = el("#restore");
  if (restore)
    restore.onchange = () => {
      el("#walletForm button").textContent = restore.files.length
        ? "Restore wallet"
        : wallet.saved
          ? "Unlock wallet"
          : "Create my wallet";
    };
  click("#backup", () => wallet.backup());
  click("#qorex", async () => {
    await wallet.connect();
    await next();
  });
  on("#walletForm", "submit", async () => {
    status("Unlocking your wallet…");
    const file = el("#restore")?.files[0];
    if (file && file.size > 100000)
      throw Error("Choose a Clainova wallet backup.");
    await wallet.unlock(
      el("#password").value,
      file ? await file.text() : undefined,
    );
    status("");
    await next();
  });
}
async function signIn(next) {
  main(
    title(
      "Organiser sign-in",
      "Sign in to pay someone by phone number. If you received an invitation, open the link in your message.",
    ) +
      '<form id="login" class="formstack copy"><div class="field"><label for="pass">Organiser password</label><input id="pass" type="password" required autocomplete="current-password"></div><button class="primary">Sign in</button></form>' +
      (cfg.demo
        ? '<p class="formnote">No password? <a href="/try">Try a payment on Diana</a>.</p>'
        : ""),
    "signin",
  );
  on("#login", "submit", async () => {
    await api("/api/login", { password: el("#pass").value });
    cfg.session = true;
    await next();
  });
}
async function counter() {
  if (!cfg.session && !demoSend) return signIn(counter);
  if (demoSend) {
    if (!cfg.demoSend)
      return main(
        title("Not available here.", "This server has no public test sends."),
        "try",
      );
    // A reload returns to the payment this browser already sent.
    const { row } = await api("/api/try/sent", {});
    if (row && row.state !== "draft") return issued(row);
  }
  const info = demoSend ? {} : await api("/api/payments");
  const instructions = demoSend
    ? "You are the organiser. This sample number stands in for a real one, and no SMS is sent."
    : local
    ? "Enter their mobile number. You can try the invitation in the rehearsal inbox."
    : "Enter their mobile number. They’ll get an invitation by SMS after you fund the payment.";
  const steps = `
    <ol class="counter-progress" aria-label="Payment steps">
      <li id="recipientStep" aria-current="step">Recipient</li><li id="amountStep">Amount</li><li>Review</li>
    </ol>
    <section id="recipientPanel">
      ${title("Who are you paying?", instructions)}
      <form id="recipientForm" novalidate>
        <div class="field"><label for="phone">Recipient phone number</label>
          <div class="group"><select id="dial" aria-label="Country calling code">
            <option value="+234">NG +234</option><option value="+254">KE +254</option><option value="+233">GH +233</option><option value="+27">ZA +27</option>
          </select><input type="tel" required id="phone" autocomplete="tel" placeholder="801 234 5678" aria-describedby="phoneError"></div>
          <span class="field-error" id="phoneError" aria-live="polite"></span>
        </div>
        <button class="primary wide">Continue <span class="arrow" aria-hidden="true">→</span></button>
      </form>
      <p class="formnote">Your recipient can create a wallet when they collect.</p>
    </section>
    <section id="amountPanel" hidden>
      <div class="intro"><h1>How much?</h1></div>
      <div class="recipient-line"><span>Paying <strong id="confirmedPhone"></strong></span>
        <button type="button" class="edit-recipient" id="editRecipient">Edit number</button></div>
      <form id="payment">
        <div class="field"><label for="amount">Amount</label><div class="group">
          <input required id="amount" inputmode="decimal" maxlength="12" placeholder="0.00"><span class="unit">test fUSD</span>
        </div></div>
        <details class="payment-options"><summary>Payment details <span id="periodSummary">7 days to collect</span></summary>
          <div class="field"><label for="period">Collection period</label><select id="period"><option value="604800">7 days</option><option value="86400">24 hours</option>
            ${local ? '<option value="60">1 minute · rehearsal</option>' : ""}
          </select></div>
          <div class="field"><label for="note">Payment note <span class="optional">(optional)</span></label><input id="note" maxlength="80" placeholder="Workshop speaker fee"></div>
        </details>
        <button class="primary wide">Review payment <span class="arrow" aria-hidden="true">→</span></button>
      </form>
      <p class="formnote">Unclaimed funds can be refunded after the deadline.</p>
    </section>`;
  main(`<div class="counter-home">
    <div class="counter-scene">
      <div id="closedPocket" class="closed-pocket">
        <p class="scene-title">Pay by phone<span>.</span></p>
        <div class="envelope"><img src="/pocket-fold.webp" alt="" width="1152" height="768" fetchpriority="high"></div>
      </div>
      <div id="openPocket" hidden>${receipt()}</div>
    </div>
    <section class="formside counter-sheet">${steps}</section>
  </div>
  <div class="strip"><span>${local ? "Rehearsal balance · " + money(info.balance) + " test fUSD" : "QoreChain Diana · ERC-20 test fUSD"}</span>${demoSend ? '<a href="/try">Back</a>' : '<a href="/ledger">View ledger <span aria-hidden="true">↗</span></a>'}</div>`, "counter");
  if (demoSend) {
    el("#phone").value = "800 000 0000";
    el("#phone").readOnly = true;
    el("#dial").disabled = true;
    el("#amount").value = "1";
    el("#amount").readOnly = true;
    el("#period").replaceChildren(new Option("7 days", "604800"));
    el("#slipAmount").textContent = "1";
    el("#editRecipient").hidden = true;
  }
  tilt(el(".counter-scene"));

  let recipient = "";
  const phone = el("#phone");
  const dial = el("#dial");
  const amount = el("#amount");
  const period = el("#period");
  function showAmount(show) {
    el("#closedPocket").hidden = show;
    el("#openPocket").hidden = !show;
    el("#recipientPanel").hidden = show;
    el("#amountPanel").hidden = !show;
    el(show ? "#recipientStep" : "#amountStep").removeAttribute("aria-current");
    el(show ? "#amountStep" : "#recipientStep").setAttribute("aria-current", "step");
    (show ? amount : phone).focus();
  }
  function clearPhoneError() {
    phone.removeAttribute("aria-invalid");
    el("#phoneError").textContent = "";
  }
  phone.oninput = clearPhoneError;
  dial.onchange = clearPhoneError;
  on("#recipientForm", "submit", () => {
    const entered = phone.value.replace(/[\s()-]/g, "");
    const full = entered.startsWith("+") ? entered : dial.value + entered.replace(/^0/, "");
    let error = "";
    if (!entered) error = "Enter the recipient’s mobile number.";
    else if (!full.startsWith(dial.value)) error = "Choose the country that matches this number.";
    else if (!/^(?:\+234[1-9]\d{9}|\+(?:254|233|27)[1-9]\d{8})$/.test(full))
      error = "Check the number of digits for the selected country.";
    if (error) {
      phone.setAttribute("aria-invalid", "true");
      el("#phoneError").textContent = error;
      phone.focus();
      return;
    }
    clearPhoneError();
    recipient = full;
    el("#confirmedPhone").textContent = demoSend ? "a sample number" : recipient;
    el("#slipPhone").textContent = demoSend ? "Sample number" : recipient;
    showAmount(true);
  });
  click("#editRecipient", () => showAmount(false));
  el("#payment").oninput = (e) => {
    const shown = /^\d+(\.\d*)?$/.test(amount.value) ? amount.value : "—";
    if (e.target === amount && el("#slipAmount").textContent !== shown)
      tick(el("#slipAmount"));
    el("#slipAmount").textContent = shown;
    const duration = period.selectedOptions[0].text.split(" · ")[0];
    el("#periodSummary").textContent = duration + " to collect";
    el("#slipExpiry").textContent = "Within " + duration;
  };
  on("#payment", "submit", async () => {
    const b = {
      phone: recipient,
      amount: amount.value.trim(),
      note: el("#note").value,
      seconds: Number(period.value),
    };
    if (
      !/^\d{1,5}(\.\d{1,6})?$/.test(b.amount) ||
      Number(b.amount) <= 0 ||
      Number(b.amount) > 10000
    )
      throw Error("Enter 0.000001 to 10,000 test fUSD.");
    const requestKey = crypto.randomUUID();
    function review() {
      modal(
        "Review payment",
        summary([
          ["To", demoSend ? "Sample number" : b.phone],
          ["Amount", b.amount + " test fUSD"],
          ["Collection period", el("#period").selectedOptions[0].text],
          ...(b.note ? [["Note", b.note]] : []),
        ]) +
          '<p class="notice">' +
          (local
            ? "This rehearsal uses a local inbox and test ledger. No SMS is sent."
            : demoSend
            ? "Clainova sends your wallet 1 test fUSD and 0.3 test QOR. Your wallet then funds the escrow on Diana itself. Test tokens have no cash value."
            : "The wallet funds escrow before Clainova sends the SMS. A new spending window costs 0.05 test QOR, plus registration if needed and EVM fees.") +
          "</p>" +
          (!local ? walletBox() + (demoSend ? "" : convertChoice()) : "") +
          (local || wallet.current
            ? action("issue", "Issue payment", true)
            : ""),
      );
      bindWallet(review);
      click("#issue", async () => {
        status("Preparing payment…");
        if (demoSend) return sendDemo(b.note);
        let row = await api("/api/payments", {
          ...b,
          requestKey,
          sender: wallet.current?.address,
        });
        if (!local) {
          if (row.state === "draft") {
            const tx = await wallet.fund(row, el("#convert")?.checked);
            await api("/api/payments/" + row.id + "/evidence", {
              kind: "funding",
              hash: tx.hash,
            });
          }
          row = await api("/api/payments/" + row.id + "/deliver", {});
        }
        close();
        await seal(el("#openPocket .press"));
        issued(row);
      });
    }
    review();
  });
}
async function sendDemo(note) {
  const sender = wallet.current.address;
  status("Sending test tokens to your wallet…");
  await api("/api/try/fund", { destination: sender });
  await wallet.waitForGas(1n);
  const row = await api("/api/try/send", { sender, note });
  if (row.state === "draft") {
    const tx = await wallet.fund(row, true);
    await api("/api/try/evidence", { id: row.id, hash: tx.hash });
  }
  const { row: funded } = await api("/api/try/sent", {});
  close();
  await seal(el("#openPocket .press"));
  issued(funded);
}
// Shows the sender the collection as soon as Diana records it.
function watchCollection(row) {
  let checks = 0,
    waits = 0;
  const timer = setInterval(async () => {
    if (++checks > 150 || !el(".issued")) return clearInterval(timer);
    try {
      const { row: latest } = await api("/api/try/sent", {});
      // The receipt follows the collection by a few seconds.
      const settled = latest.evidence?.collection || ++waits > 8;
      if (latest.state !== row.state && settled) {
        clearInterval(timer);
        issued(latest);
      }
    } catch {
      // The next check tries again.
    }
  }, 5000);
}
function issued(row) {
  const done = row.state === "collected";
  // Funding, delivery and collection are separate events; show each truthfully.
  const sent = row.demo || (row.delivery && row.delivery !== "unsent");
  const steps = [
    [
      true,
      local ? "Funds reserved" : "Escrow funded",
      money(row.amount) +
        " test fUSD " +
        (local
          ? "on the rehearsal ledger"
          : done
            ? "was held by ClainovaClaims"
            : "held by ClainovaClaims"),
    ],
    [
      sent,
      sent
        ? local || row.demo
          ? "Invitation ready"
          : "Invitation sent"
        : "Invitation not sent yet",
      sent
        ? row.demo
          ? "A real recipient gets this by SMS"
          : local
          ? "In the rehearsal inbox"
          : row.delivery[0].toUpperCase() + row.delivery.slice(1)
        : "Send it again from the ledger",
    ],
    done
      ? [true, "Collected", "By wallet " + short(row.destination)]
      : [false, "Waiting for collection", row.mask + " · by " + date(row.expiry)],
  ];
  const current = steps.findIndex(([done]) => !done);
  main(
    `<div class="issued">
      <section class="issued-copy">
        <p class="eyebrow">Sealed · Ref ${esc(row.id.slice(2, 10).toUpperCase())}</p>
        <div class="intro"><h1>${done ? "Payment collected." : "Payment issued."}</h1><p>${
          row.demo
            ? done
              ? "The recipient’s own wallet collected it from the escrow on Diana."
              : "Now be the recipient. Open the invitation and collect it into a second wallet. This page updates when you do."
            : local
            ? "Your invitation is ready in the rehearsal inbox."
            : "Invitation " + esc(row.delivery) + "."
        }</p></div>
        <ol class="timeline" aria-label="Payment progress">${steps
          .map(
            ([done, head, detail], i) =>
              `<li class="${done ? "done" : ""}"${i === current ? ' aria-current="step"' : ""}><strong>${esc(head)}</strong><span>${esc(detail)}</span>${done ? '<span class="visually-hidden">Complete</span>' : ""}</li>`,
          )
          .join("")}</ol>
        <div class="actions">${
          row.demo
            ? (done ? "" : '<a class="button" target="_blank" href="/c/' + esc(row.link) + '">Open the invitation <span class="arrow" aria-hidden="true">→</span></a>')
            : local
            ? '<a class="button" href="/c/' + esc(row.link) + '">Open recipient inbox <span class="arrow" aria-hidden="true">→</span></a>'
            : ""
        }${row.demo ? "" : '<a class="secondary" href="/ledger">View ledger</a>'}</div>
        ${row.demo ? proof(row) : ""}
      </section>
      ${receipt(row)}
    </div>`,
    "issued",
  );
  stagger([...document.querySelectorAll(".timeline li")]);
  if (row.demo && !done) watchCollection(row);
}
// The public transactions behind a demo payment. The explorer opens on mainnet,
// so the official testnet API is linked as well.
function proof(row) {
  const items = [
    ["Funded", row.evidence?.funding],
    ["Collected", row.evidence?.collection],
  ].filter(([, fact]) => fact);
  if (!items.length) return "";
  const anchor = (href, text) =>
    '<a target="_blank" rel="noreferrer" href="' + esc(href) + '">' + text + "</a>";
  return (
    items
      .map(
        ([name, fact]) =>
          '<p class="formnote">' +
          name +
          " in block " +
          Number(fact.block).toLocaleString("en") +
          (fact.native
            ? " · " +
              anchor("https://explore.qore.network/tx/" + fact.native, "Explorer") +
              " · " +
              anchor(
                "https://api-testnet.qore.host/cosmos/tx/v1beta1/txs/" + fact.native,
                "Raw transaction",
              )
            : "") +
          "</p>",
      )
      .join("") +
    '<p class="formnote">Switch the explorer to Testnet to see them.</p>'
  );
}
async function ledger() {
  if (!cfg.session) return signIn(ledger);
  const { rows, returning } = await api("/api/payments");
  // Demo payments are public trials, so they stay out of the counts.
  const funded = rows.filter((r) => r.state !== "draft" && !r.demo);
  const stats = [
    ["Invitations", funded.length],
    ["Opened", funded.filter((r) => r.opened).length],
    ["Verified", funded.filter((r) => r.verified).length],
    ["Collected", funded.filter((r) => r.state === "collected").length],
    ["Sent again", returning || 0],
    ...(!local
      ? [
          [
            "New account records",
            funded.filter((r) => r.observed === "no prior account record")
              .length,
          ],
        ]
      : []),
  ];
  const entries = rows
    .map(
      (r, i) =>
        '<article class="entry"><div><strong>' +
        esc(r.note || "Phone payment") +
        "</strong><p>" +
        esc(r.mask) +
        " · " +
        esc(r.id.slice(2, 10)) +
        "</p></div><strong>" +
        money(r.amount) +
        ' test fUSD</strong><span class="status ' +
        statusClass(state(r)) +
        '">' +
        state(r) +
        "</span>" +
        action("row" + i, "View receipt") +
        "</article>",
    )
    .join("");
  main(
    title(
      "Payment ledger.",
      local
        ? "Your rehearsal payments and collection activity."
        : "Funded invitations, collection progress and refunds.",
    ) +
      '<div class="stats">' +
      stats
        .map(
          ([k, v]) =>
            '<div><strong data-count="' +
            v +
            '">' +
            v +
            "</strong>" +
            k +
            '<span class="bar-track" aria-hidden="true"><span class="bar-fill"></span></span></div>',
        )
        .join("") +
      '</div><div class="log">' +
      (entries ||
        '<p class="empty">No payments yet. <a href="/">Create your first invitation</a>.</p>') +
      '</div><div class="actions">' +
      action("refresh", "Refresh ledger") +
      "</div>",
    "ledger",
  );
  // Each bar shows its count as a share of funded invitations.
  const fills = document.querySelectorAll(".bar-fill");
  stats.forEach(([, v], i) => {
    const share = funded.length ? Math.min(1, v / funded.length) : 0;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => fills[i]?.style.setProperty("--share", String(share))),
    );
  });
  if (el("#main").classList.contains("enter"))
    document
      .querySelectorAll(".stats strong")
      .forEach((n) => countUp(n, Number(n.dataset.count), (x) => String(Math.round(x)), 700));
  stagger([...document.querySelectorAll(".entry")]);
  click("#refresh", ledger);
  rows.forEach((r, i) =>
    click("#row" + i, () => {
      function detail() {
        const expired = state(r) === "Expired";
        modal(
          "Payment receipt",
          summary([
            ["Status", state(r)],
            ["Amount", money(r.amount) + " test fUSD"],
            ["Recipient", r.mask],
            ["Deadline", date(r.expiry)],
            ["Delivery", r.delivery],
            ["Cohort", r.cohort],
            ...Object.entries(r.evidence || {}).map(([k, v]) => [
              k[0].toUpperCase() + k.slice(1) + " fee",
              v.feeQor + " test QOR · paid by " + short(v.payer),
            ]),
            ...Object.entries(r.evidence || {}).map(([k, v]) => [
              k[0].toUpperCase() + k.slice(1) + " transaction",
              v.hash,
            ]),
            ...(r.destination ? [["Wallet", r.destination]] : []),
            ...(r.opened && r.ended
              ? [["Time to settlement", r.ended - r.opened + " seconds"]]
              : []),
          ]) +
            '<div class="actions">' +
            (local && r.link
              ? '<a class="secondary" href="/c/' +
                r.link +
                '">Open recipient inbox</a>'
              : "") +
            (expired ? action("refund", "Refund sender", true) : "") +
            (!local && r.state === "draft"
              ? action("fund", "Resume deposit")
              : "") +
            (!local && r.state === "funded" && !expired && !r.demo
              ? action("resend", "Send invitation again")
              : "") +
            "</div>" +
            (!local && (r.state === "draft" || expired)
              ? walletBox() + (r.state === "draft" ? convertChoice() : "")
              : ""),
        );
        bindWallet(detail);
        click("#refund", async () => {
          if (!local) {
            if (!wallet.current) throw Error("Unlock your wallet first.");
            const tx = await wallet.refund(r);
            await api("/api/payments/" + r.id + "/evidence", {
              kind: "refund",
              hash: tx.hash,
            });
          }
          await api("/api/payments/" + r.id + "/refund", {});
          close();
          await ledger();
        });
        click("#fund", async () => {
          if (!wallet.current || wallet.current.address !== r.sender)
            throw Error("Unlock the wallet that created this payment.");
          const tx = await wallet.fund(r, el("#convert")?.checked);
          await api("/api/payments/" + r.id + "/evidence", {
            kind: "funding",
            hash: tx.hash,
          });
          if (!r.demo) await api("/api/payments/" + r.id + "/deliver", {});
          close();
          await ledger();
        });
        click("#resend", async () => {
          await api("/api/payments/" + r.id + "/deliver", {});
          close();
          await ledger();
        });
      }
      detail();
    }),
  );
}
const grantKey = "clainova.grant." + link;
let demoPin = "";
let verificationTimer;
let verifiedToken = sessionStorage.getItem(grantKey);
let justCollected = false;

function verificationStep({ requested, validFor }, demo) {
  const hint = validFor
    ? demo
      ? "Enter the six-digit code. If it is not shown, request another."
      : "Enter the six-digit code from your latest message."
    : requested
      ? "Request a new code to continue."
      : demo
        ? "Get a six-digit code."
        : "Request a six-digit code for the number on the invitation.";
  let contents =
    '<div class="step"><h3>' + (demo ? "Verify with a code" : "Verify your phone number") + '</h3><p class="helper" id="codeHint">' +
    hint + "</p>";
  if (validFor) {
    contents += '<div id="codeEntry">';
    if (demoPin)
      contents += '<div class="inbox"><span class="inbox-label">' +
        (local ? "Rehearsal inbox" : "Shown here instead of an SMS") + '</span><p class="bubble">Your Clainova code is <strong id="demoPin">' +
        esc(demoPin) + "</strong>. Don’t share it with anyone.</p></div>";
    contents += '<form id="verify"><div class="field"><label for="pin">Verification code</label>' +
      '<input id="pin" class="otp" aria-describedby="codeHint" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="······" required></div>' +
      '<button class="primary">Verify code</button></form></div>';
  }
  return contents + '<div class="actions">' +
    action("getCode", requested ? "Request another code" : "Get verification code", !validFor) +
    "</div></div>";
}

function startVerificationTimer({ validFor, retryIn }) {
  const button = el("#getCode");
  const label = button.textContent;
  const started = Date.now();
  function update() {
    const elapsed = Math.floor((Date.now() - started) / 1000);
    const wait = Math.max(0, retryIn - elapsed);
    button.disabled = wait > 0 || Boolean(button.dataset.busy);
    button.textContent = wait ? "Resend in " + wait + "s" : label;
    const entry = el("#codeEntry");
    if (entry && elapsed >= validFor) {
      const moveFocus = entry.contains(document.activeElement);
      entry.remove();
      demoPin = "";
      el("#codeHint").textContent = "Your code expired. Request a new one to continue.";
      if (moveFocus) button.focus();
    }
    if (wait || elapsed < validFor)
      verificationTimer = setTimeout(update, 1000);
  }
  update();
}

async function collect() {
  const r = await invite("");
  clearTimeout(verificationTimer);
  const label = state(r);
  if (r.state === "collected") {
    const celebrate = justCollected;
    justCollected = false;
    main(
      title(
        "Payment collected.",
        "The payment belongs to the wallet on this receipt.",
      ) +
        layout(
          "<h2>Collection receipt</h2>" +
            summary([
              ["Received", money(r.amount) + " test fUSD"],
              ["Wallet", short(r.destination)],
              [
                "Since invitation opened",
                r.opened && r.ended
                  ? r.ended - r.opened + " seconds"
                  : "Unavailable",
              ],
            ]) +
            walletBox() +
            '<div id="follow"></div>',
          receipt(r),
        ),
      "collected",
    );
    if (celebrate) {
      countUp(el("#slipAmount"), r.amount, money, 900);
      stamp(el(".press"));
    }
    bindWallet(collect);
    if (wallet.current?.address === r.destination) {
      const balance = await wallet.balance();
      el("#follow").innerHTML =
        '<div class="step"><h3>Send from this wallet</h3><p class="helper">Available · ' +
        money(balance) +
        ' test fUSD</p><form class="formstack" id="out"><div class="field"><label for="to">Destination wallet</label><input required id="to" placeholder="0x…"></div><div class="field"><label for="outAmount">Amount in test fUSD</label><input id="outAmount" required inputmode="decimal" value="1"></div><button class="primary">Review transfer</button></form></div>';
      on("#out", "submit", async () => {
        const dest = el("#to").value.trim(),
          value = el("#outAmount").value;
        modal(
          "Confirm transfer",
          summary([
            ["To", dest],
            ["Amount", value + " test fUSD"],
            ["Network", cfg.mode],
          ]) + action("confirmTransfer", "Send transfer", true),
        );
        click("#confirmTransfer", async () => {
          const tx = await wallet.send(dest, value);
          if (!local)
            await invite("evidence", { kind: "transfer", hash: tx.hash });
          close();
          await collect();
          status("Transfer confirmed.", 6000);
        });
      });
    }
    return;
  }
  if (label === "Expired" || r.state === "refunded" || r.state === "draft") {
    main(
      title(
        label + ".",
        label === "Expired"
          ? "The organiser can now recover the funds."
          : r.state === "refunded"
            ? "The funds were returned to the sender."
            : "The sender still needs to fund this payment.",
      ) + receipt(r),
      "closed",
    );
    return;
  }
  const token = verifiedToken;
  const stage = !token ? 0 : wallet.current ? 2 : 1;
  const rail =
    '<ol class="rail" aria-label="Collection steps">' +
    ["Verify number", "Set up wallet", "Collect"]
      .map((name, i) =>
        i < stage
          ? '<li class="done">' + checkIcon + name + '<span class="visually-hidden"> (complete)</span></li>'
          : "<li" + (i === stage ? ' aria-current="step"' : "") + ">" + name + "</li>",
      )
      .join("") +
    "</ol>";
  let contents =
    rail +
    '<h1>A payment for you.</h1><p class="helper claim-intro">' +
    (r.demo
      ? "This is a public demo payment. The code appears on this page instead of going to a phone. Everything else is the real flow on Diana."
      : "Verify your number and collect into your own wallet.") +
    "</p>";
  if (!token) {
    contents += verificationStep(r.verification, r.demo);
  } else {
    contents +=
      '<div class="step"><p class="confirmed">' +
      checkIcon +
      (r.demo ? "Code verified" : "Number verified · " + esc(r.mask)) +
      "</p>" +
      walletBox();
    if (wallet.current)
      contents +=
        (!local
          ? '<p class="code">' +
            wallet.qor() +
            '</p><p class="helper">Setup registers your key if needed, then opens a window for this escrow. ' +
            (cfg.sponsored
              ? "Clainova sends this wallet the test QOR for these fees when you collect.</p>"
              : 'Each native approval costs 0.05 test QOR. Collection also uses EVM gas.</p><div class="actions"><a href="https://dashboard.qorechain.io/faucet" target="_blank" rel="noreferrer">Get test QOR from the faucet</a></div>')
          : "") +
        '<div class="actions">' +
        action("claim", "Collect " + money(r.amount) + " test fUSD", true) +
        "</div>";
    contents +=
      '<div class="actions"><button type="button" id="again" class="secondary quiet">Verify number again</button></div></div>';
  }
  main(
    `<div class="claim-layout">${receipt(r)}<section class="formside claim-sheet">${contents}</section></div>`,
    "claim",
  );
  if (!token) {
    startVerificationTimer(r.verification);
    el("#pin")?.focus({ preventScroll: true });
  }
  click("#getCode", async () => {
    demoPin = "";
    try {
      const response = await invite("code", {});
      demoPin = response.localCode || response.pageCode;
    } finally {
      await collect();
    }
  });
  on("#verify", "submit", async () => {
    try {
      const { token } = await invite("verify", { code: el("#pin").value });
      verifiedToken = token;
      sessionStorage.setItem(grantKey, token);
      demoPin = "";
    } finally {
      await collect();
    }
  });
  bindWallet(collect);
  click("#again", async () => {
    verifiedToken = "";
    sessionStorage.removeItem(grantKey);
    demoPin = "";
    await collect();
  });
  click("#claim", async () => {
    modal(
      "Approve collection",
      summary([
        ["Receive", money(r.amount) + " test fUSD"],
        ["Wallet", short(wallet.current.address)],
        ["Network", cfg.mode],
        [
          "Fees",
          local
            ? "No network fees"
            : "About 0.15 test QOR" + (cfg.sponsored ? ", sent to you first" : ""),
        ],
      ]) + action("approve", "Approve and collect", true),
    );
    click("#approve", async () => {
      if (!local)
      {
        const destination = wallet.current.address;
        await invite("observe", { token, destination });
        if (cfg.sponsored && (await wallet.gas()) < ENOUGH_GAS) {
          status("Sending test QOR for your setup fees…");
          await invite("sponsor", { token, destination });
          await wallet.waitForGas(1n);
        }
      }
      await wallet.prepare();
      const a = await invite("attest", {
        token,
        destination: wallet.current.address,
      });
      if (local)
        await invite("settle", {
          ...a,
          token,
          proof: await wallet.sign(a.payload),
        });
      else {
        const tx = await wallet.claim(r, a);
        await invite("settle", {});
        await invite("evidence", { kind: "collection", hash: tx.hash });
      }
      close();
      sessionStorage.removeItem(grantKey);
      verifiedToken = "";
      justCollected = true;
      await collect();
    });
  });
}
function tryDemo() {
  if (!cfg.demo)
    return main(
      title("Not available here.", "This server has no public test payments."),
      "try",
    );
  main(
    title(
      "Try Clainova on Diana.",
      cfg.demoSend
        ? "Send a payment as the organiser, then collect it as the recipient. You need no phone, no extension and no QOR."
        : "1 test fUSD is waiting in the escrow on Diana. You need no phone, no extension and no QOR.",
    ) +
      '<div class="copy"><p>Every step is a real transaction on the testnet. A normal recipient gets a code by SMS. Here the code is shown on the page. Test tokens have no cash value.</p><div class="actions">' +
      (cfg.demoSend
        ? '<a class="button" href="/try/send">Send, then collect <span class="arrow" aria-hidden="true">→</span></a>'
        : "") +
      action("take", cfg.demoSend ? "Only collect" : "Take a test payment", !cfg.demoSend) +
      "</div></div>",
    "try",
  );
  click("#take", async () => {
    const { link } = await api("/api/try", {});
    location.href = "/c/" + link;
  });
}
function legal() {
  const privacy = currentPath === "/privacy";
  main(
    '<article class="copy">' +
      title(
        privacy ? "Privacy." : "Terms of use.",
        privacy
          ? "How Clainova handles a payment invitation."
          : "Clainova is a festival testnet application.",
      ) +
      (privacy
        ? "<h2>Phone numbers and codes</h2><p>The verifier stores the number encrypted and uses it to send the invitation and one-time codes. The ledger shows only its last four digits. Africa’s Talking receives the number and message in SMS mode. The rehearsal inbox stays on the local machine.</p><h2>Public payment records</h2><p>Escrow transactions expose addresses, amounts and timing. The private invitation link, note, number and code stay off-chain. The operator can read notes and decrypt phone numbers. Ask the organiser who invited you to remove the off-chain record after settlement. Public chain records persist.</p><h2>Wallet storage</h2><p>Your browser encrypts its wallet backup with your passphrase and stores it on this device. Save a copy before clearing browser data. The verifier cannot restore a lost passphrase. Browser cookies keep organiser sessions separate.</p>"
        : "<h2>Test assets</h2><p>Only use festival test tokens. They have no cash value. Use a dedicated test wallet, send invitations only to people expecting payment, and confirm the phone number before issuing one.</p><h2>Collection and refunds</h2><p>A verification code establishes current access to the number. A single verifier authorises the receiving wallet. After expiry, anyone may call the escrow refund function. Only the original sender receives the refund.</p><h2>Rehearsal mode</h2><p>The local ledger and inbox are for practice. Testnet mode uses external services and requires network fees in test QOR. SMS delivery and transaction inclusion can take time.</p>") +
      "</article>",
    "legal" + currentPath,
  );
}
async function start() {
  cfg = await api("/api/config");
  local = cfg.mode === "rehearsal";
  wallet = lazyWallet(cfg, api, status, demoSend ? ".sender" : "");
  // Fetched once the page has been drawn, before anyone needs it.
  if (link || currentPath.startsWith("/try") || cfg.session) setTimeout(wallet.preload, 400);
  el("#network").textContent = local ? "Local rehearsal" : "Diana testnet";
  const nav =
    currentPath === "/"
      ? "#sendNav"
      : currentPath === "/ledger"
        ? "#ledgerNav"
        : null;
  if (nav) el(nav).setAttribute("aria-current", "page");
  // A testnet recipient has no organiser session, so the organiser menu
  // would only lead to a sign-in page. Rehearsal keeps it for the demo.
  if ((link || currentPath.startsWith("/try")) && !local) el(".bar nav").hidden = true;
  if (currentPath === "/try") return tryDemo();
  if (link) return collect();
  if (currentPath === "/ledger") return ledger();
  if (currentPath === "/privacy" || currentPath === "/terms") return legal();
  return counter();
}
start().catch((err) => {
  main(
    title("Unable to open this page.", esc(err.message)) +
      '<a class="secondary" href="">Retry</a>',
    "error",
  );
});
