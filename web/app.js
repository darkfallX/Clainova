import { walletTools } from "./wallet.js";
import { qorAddress } from "./native.js";
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
} from "./view.js";
let cfg, local, wallet;
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
    ? '<p class="notice"><label><input id="convert" type="checkbox"> Convert faucet fUSD to cover a shortfall (0.1 test QOR fee).</label></p>'
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
      ' wallet</h3><p class="code">' +
      esc(wallet.current.address) +
      '</p><div class="actions">' +
      (!wallet.external ? action("backup", "Save encrypted backup") : "") +
      "</div></div>"
    );
  return (
    '<div class="wallet"><h3>' +
    (wallet.saved ? "Unlock your wallet" : "Set up your wallet") +
    '</h3><p class="helper">' +
    (wallet.saved
      ? "Enter the passphrase for this device."
      : "Choose a passphrase to encrypt your new wallet on this device. Save the backup so you can use it elsewhere.") +
    '</p><form id="walletForm"><div class="field"><label for="password">Wallet passphrase</label><input type="password" id="password" minlength="10" required autocomplete="' +
    (wallet.saved ? "current" : "new") +
    '-password"></div><button class="secondary">' +
    (wallet.saved ? "Unlock wallet" : "Create my wallet") +
    '</button></form><details><summary>More wallet options</summary><div class="field"><label for="restore">Restore an encrypted Clainova backup</label><input id="restore" type="file" accept=".json,application/json"></div>' +
    (!local ? action("qorex", "Connect QoreX account") : "") +
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
      "Enter the organiser password to use this payment counter.",
    ) +
      '<form id="login" class="formstack copy"><div class="field"><label for="pass">Organiser password</label><input id="pass" type="password" required autocomplete="current-password"></div><button class="primary">Sign in</button></form>',
  );
  on("#login", "submit", async () => {
    await api("/api/login", { password: el("#pass").value });
    cfg.session = true;
    await next();
  });
}
async function counter() {
  if (!cfg.session) return signIn(counter);
  const info = await api("/api/payments");
  const form =
    '<form id="payment"><div class="field"><label for="phone">Recipient phone number</label><div class="group"><select id="dial" aria-label="Country calling code"><option value="+234">NG +234</option><option value="+254">KE +254</option><option value="+233">GH +233</option><option value="+27">ZA +27</option></select><input type="tel" required id="phone" autocomplete="tel-national" placeholder="801 234 5678"></div></div><div class="pair"><div class="field"><label for="amount">Amount</label><div class="group"><input required id="amount" inputmode="decimal" value="20" maxlength="12"><span class="unit">test fUSD</span></div></div><div class="field"><label for="period">Collection period</label><select id="period"><option value="604800">7 days</option><option value="86400">24 hours</option>' +
    (local ? '<option value="60">1 minute · rehearsal</option>' : "") +
    '</select></div></div><div class="field"><label for="note">Payment note <span class="optional">(optional)</span></label><input id="note" maxlength="80" placeholder="Workshop speaker fee"></div><button class="primary wide">Review payment <span class="arrow" aria-hidden="true">→</span></button></form>';
  main(
    title(
      "Send a payment.",
      "Pay someone by phone number. They can set up their wallet when they collect.",
    ) +
      layout(
        form +
          '<p class="formnote">' +
          (local
            ? "Practice with a local inbox and test tokens."
            : "Your recipient receives an SMS after the deposit confirms.") +
          " Unclaimed funds can be refunded after the deadline.</p>",
        receipt(),
      ) +
      '<div class="strip"><span>' +
      (local
        ? "Rehearsal balance · " + money(info.balance) + " test fUSD"
        : "QoreChain Diana · ERC-20 test fUSD") +
      '</span><a href="/ledger">View ledger</a></div>',
  );
  const values = () => {
    const digits = el("#phone")
      .value.replace(/[ ()-]/g, "")
      .replace(/^0/, "");
    return {
      phone: el("#dial").value + digits,
      amount: el("#amount").value.trim(),
      note: el("#note").value,
      seconds: Number(el("#period").value),
    };
  };
  el("#payment").oninput = () => {
    const v = values();
    el("#slipAmount").textContent = /^\d+(\.\d*)?$/.test(v.amount)
      ? v.amount
      : "—";
    el("#slipPhone").textContent = el("#phone").value
      ? v.phone
      : "Phone number";
    el("#slipExpiry").textContent = date(Date.now() / 1000 + v.seconds);
  };
  on("#payment", "submit", async () => {
    const b = values();
    if (
      !/^(?:\+234[1-9]\d{9}|\+(?:254|233)[1-9]\d{8}|\+27[1-9]\d{8})$/.test(
        b.phone,
      )
    )
      throw Error("Check the country and full mobile number.");
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
          ["To", b.phone],
          ["Amount", b.amount + " test fUSD"],
          ["Collection period", el("#period").selectedOptions[0].text],
          ...(b.note ? [["Note", b.note]] : []),
        ]) +
          '<p class="notice">' +
          (local
            ? "This rehearsal uses a local inbox and test ledger. No SMS is sent."
            : "The wallet funds escrow before Clainova sends the SMS. A new spending window costs 0.1 test QOR, plus registration if needed and EVM fees.") +
          "</p>" +
          (!local ? walletBox() + convertChoice() : "") +
          (local || wallet.current
            ? action("issue", "Issue payment", true)
            : ""),
      );
      bindWallet(review);
      click("#issue", async () => {
        status("Preparing payment…");
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
        issued(row);
      });
    }
    review();
  });
}
function issued(row) {
  main(
    title(
      "Payment issued.",
      local
        ? "Your invitation is ready in the rehearsal inbox."
        : "The SMS provider accepted the invitation.",
    ) +
      layout(
        "<h2>Collection details</h2>" +
          summary([
            ["Recipient", row.mask],
            ["Amount", money(row.amount) + " test fUSD"],
            ["Expires", date(row.expiry)],
            ["Delivery", row.delivery],
          ]) +
          '<div class="actions">' +
          (local
            ? '<a class="button" href="/c/' +
              esc(row.link) +
              '">Open recipient inbox</a>'
            : "") +
          '<a class="secondary" href="/ledger">View ledger</a></div>',
        receipt(row),
      ),
  );
}
async function ledger() {
  if (!cfg.session) return signIn(ledger);
  const { rows, returning } = await api("/api/payments");
  const funded = rows.filter((r) => r.state !== "draft");
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
        ' test fUSD</strong><span class="status">' +
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
        .map(([k, v]) => "<div><strong>" + v + "</strong>" + k + "</div>")
        .join("") +
      '</div><div class="log">' +
      (entries ||
        '<p class="empty">No payments yet. <a href="/">Create your first invitation</a>.</p>') +
      '</div><div class="actions">' +
      action("refresh", "Refresh ledger") +
      "</div>",
  );
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
              k + " fee",
              v.feeQor + " test QOR · " + v.payer,
            ]),
            ...Object.entries(r.evidence || {}).map(([k, v]) => [
              k + " transaction",
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
            (!local && r.state === "funded" && !expired
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
          await api("/api/payments/" + r.id + "/deliver", {});
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
let otpSent = false,
  demoPin = "",
  verifiedToken = sessionStorage.getItem(grantKey);
async function collect() {
  const r = await invite("");
  const label = state(r);
  if (r.state === "collected") {
    main(
      title(
        "Payment collected.",
        "The payment belongs to the wallet on this receipt.",
      ) +
        layout(
          "<h2>Collection receipt</h2>" +
            summary([
              ["Received", money(r.amount) + " test fUSD"],
              ["Wallet", r.destination],
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
    );
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
    );
    return;
  }
  const token = verifiedToken;
  let contents =
    '<h2>Collect your payment</h2><p class="helper">' +
    esc(r.note || "Phone payment") +
    " · " +
    esc(r.mask) +
    "</p>";
  if (!token) {
    contents +=
      '<div class="step"><h3>Verify your phone number</h3><p class="helper">Request a six-digit code for the number on the invitation.</p>' +
      action(
        "getCode",
        otpSent ? "Request another code" : "Get verification code",
        !otpSent,
      );
    if (otpSent)
      contents +=
        (local
          ? '<p class="notice">Rehearsal inbox · code <strong id="demoPin">' +
            esc(demoPin) +
            "</strong></p>"
          : "") +
        '<form id="verify"><div class="field"><label for="pin">Verification code</label><input id="pin" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required></div><button class="primary">Verify code</button></form>';
    contents += "</div>";
  } else {
    contents +=
      '<div class="step"><span class="status">Number verified</span>' +
      walletBox();
    if (wallet.current)
      contents +=
        (!local
          ? '<p class="code">' +
            qorAddress(wallet.current.address) +
            '</p><p class="helper">Setup registers your key if needed, then opens a window for this escrow. Each native approval costs 0.1 test QOR. Collection also uses EVM gas.</p><div class="actions">' +
            (cfg.sponsored
              ? action("sponsor", "Request gas top-up")
              : '<a href="https://dashboard.qorechain.io/faucet" target="_blank" rel="noreferrer">Get test QOR from the faucet</a>') +
            "</div>"
          : "") +
        '<div class="actions">' +
        action("claim", "Collect " + money(r.amount) + " test fUSD", true) +
        "</div>";
    contents +=
      '<div class="actions">' +
      action("again", "Verify number again") +
      "</div></div>";
  }
  main(
    title(
      "A payment for you.",
      "Verify your number and collect into a wallet you control.",
    ) + layout(contents, receipt(r)),
  );
  click("#getCode", async () => {
    const response = await invite("code", {});
    otpSent = true;
    demoPin = response.localCode;
    await collect();
    el("#pin").focus();
  });
  on("#verify", "submit", async () => {
    const { token } = await invite("verify", { code: el("#pin").value });
    verifiedToken = token;
    sessionStorage.setItem(grantKey, token);
    await collect();
  });
  bindWallet(collect);
  click("#again", async () => {
    verifiedToken = "";
    sessionStorage.removeItem(grantKey);
    otpSent = false;
    await collect();
  });
  click("#sponsor", async () => {
    await invite("observe", { token, destination: wallet.current.address });
    const { hash } = await invite("sponsor", {
      token,
      destination: wallet.current.address,
    });
    status("Top-up broadcast: " + hash, 12000);
  });
  click("#claim", async () => {
    modal(
      "Approve collection",
      summary([
        ["Receive", money(r.amount) + " test fUSD"],
        ["Wallet", wallet.current.address],
        ["Network", cfg.mode],
        [
          "Fees",
          local
            ? "No network fees"
            : "Up to 0.2 test QOR for setup plus EVM gas",
        ],
      ]) + action("approve", "Approve and collect", true),
    );
    click("#approve", async () => {
      if (!local)
        await invite("observe", { token, destination: wallet.current.address });
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
      await collect();
    });
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
  );
}
async function start() {
  cfg = await api("/api/config");
  local = cfg.mode === "rehearsal";
  wallet = walletTools(cfg, api, status);
  el("#network").textContent = local ? "Local rehearsal" : "Diana testnet";
  const nav =
    currentPath === "/"
      ? "#sendNav"
      : currentPath === "/ledger"
        ? "#ledgerNav"
        : null;
  if (nav) el(nav).setAttribute("aria-current", "page");
  if (link) return collect();
  if (currentPath === "/ledger") return ledger();
  if (currentPath === "/privacy" || currentPath === "/terms") return legal();
  return counter();
}
start().catch((err) => {
  main(
    title("Unable to open this page.", esc(err.message)) +
      '<a class="secondary" href="">Retry</a>',
  );
});
