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
    '</h3><p class="helper" id="pwHelp">' +
    (wallet.saved
      ? "Enter the password you chose for this wallet on this device."
      : "We create your wallet for you, with a new post-quantum key. This password locks it on this device and on its backup file. Nobody can reset it, so keep it somewhere safe.") +
    '</p><form id="walletForm" novalidate><div class="field"><label for="password" id="pwLabel">' +
    (wallet.saved ? "Wallet password" : "Create a password") +
    '</label><input type="password" id="password" minlength="10" required aria-describedby="pwHelp pwError" autocomplete="' +
    (wallet.saved ? "current" : "new") +
    '-password"></div>' +
    (wallet.saved
      ? ""
      : '<div class="field" id="confirmField"><label for="password2">Type it again</label><input type="password" id="password2" minlength="10" required aria-describedby="pwError" autocomplete="new-password"></div>') +
    '<label class="check-row"><input type="checkbox" id="showPw"> Show password</label>' +
    '<span class="field-error" id="pwError" aria-live="polite"></span>' +
    '<button class="primary">' +
    (wallet.saved ? "Unlock wallet" : "Create my wallet") +
    '</button></form><details><summary>More wallet options</summary><div class="field"><label for="restore">Restore an encrypted Clainova backup</label><input id="restore" type="file" accept=".json,application/json"></div>' +
    (!local && !demoSend ? action("qorex", "Connect QoreX account") : "") +
    "</details></div>"
  );
}
function bindWallet(next) {
  const restore = el("#restore");
  const confirm = el("#confirmField");
  const pwError = el("#pwError");
  const clearError = () => {
    if (!pwError) return;
    pwError.textContent = "";
    for (const id of ["#password", "#password2"]) el(id)?.removeAttribute("aria-invalid");
  };
  if (el("#showPw"))
    el("#showPw").onchange = (e) => {
      for (const id of ["#password", "#password2"])
        if (el(id)) el(id).type = e.target.checked ? "text" : "password";
    };
  for (const id of ["#password", "#password2"]) if (el(id)) el(id).oninput = clearError;
  if (restore)
    restore.onchange = () => {
      const restoring = restore.files.length > 0;
      el("#walletForm button.primary").textContent = restoring
        ? "Restore wallet"
        : wallet.saved
          ? "Unlock wallet"
          : "Create my wallet";
      el("#pwLabel").textContent = restoring
        ? "Backup password"
        : wallet.saved
          ? "Wallet password"
          : "Create a password";
      // A backup already has its password, so there is nothing to confirm.
      if (confirm) confirm.hidden = restoring;
      clearError();
    };
  click("#backup", () => wallet.backup());
  click("#qorex", async () => {
    await wallet.connect();
    await next();
  });
  on("#walletForm", "submit", async () => {
    const file = el("#restore")?.files[0];
    const first = el("#password").value;
    const problem =
      first.length < 10
        ? "Use at least 10 characters."
        : confirm && !confirm.hidden && el("#password2").value !== first
          ? "The two passwords don't match."
          : "";
    if (problem) {
      pwError.textContent = problem;
      const bad = problem.includes("match") ? el("#password2") : el("#password");
      bad.setAttribute("aria-invalid", "true");
      bad.focus();
      return;
    }
    status(file ? "Restoring your wallet…" : wallet.saved ? "Unlocking your wallet…" : "Creating your wallet…");
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
// What a visitor without an organiser session sees first.
function welcome() {
  el(".bar nav").hidden = true;
  main(
    `<div class="counter-home">
    <div class="counter-scene"><div class="closed-pocket">
      <p class="scene-title">Pay by phone<span>.</span></p>
      <div class="envelope"><img src="/pocket-fold.webp" alt="" width="1152" height="768" fetchpriority="high"></div>
    </div></div>
    <section class="formside counter-sheet">
      ${title(
        "The wallet can come later.",
        "An organiser pays a phone number. The money waits in escrow on QoreChain until that person verifies a code and collects it into a new wallet with a post-quantum key. If nobody collects, the sender can get it back.",
      )}
      <div class="actions welcome-actions">
        ${cfg.demoSend ? '<a class="button wide" href="/try/send">Try both sides on Diana <span class="arrow" aria-hidden="true">→</span></a>' : ""}
        <a class="${cfg.demoSend ? "secondary" : "button"} wide" href="/try">${cfg.demoSend ? "More ways to try it" : "Try it on Diana"}</a>
      </div>
      <p class="formnote">About two minutes. Real testnet transactions, test money. You need no password, phone or QOR.</p>
    </section>
  </div>
  <div class="strip"><span>Open the link in your message to collect a payment sent to you.</span><button type="button" id="organiser" class="secondary quiet">Organiser sign-in</button></div>`,
    "welcome",
  );
  tilt(el(".counter-scene"));
  click("#organiser", async () => {
    el(".bar nav").hidden = false;
    await signIn(counter);
  });
}
// QoreChain's own post-quantum checks on a collected payment, asked live from
// this browser. Failing to load never hides the receipt.
async function postQuantum(row) {
  const box = el("#pq");
  const hash = row.evidence?.collection?.hash;
  if (!box || local || !hash) return;
  box.innerHTML =
    '<div class="step"><h3>Asked QoreChain just now</h3><p class="helper" id="pqNote">Your browser is checking this payment on Diana…</p></div>';
  try {
    const { askDiana } = await import("./proof.js");
    const { rows, block } = await askDiana(cfg, api, hash);
    box.innerHTML =
      '<div class="step"><h3>Asked QoreChain just now</h3>' +
      '<dl class="summary pq">' +
      rows
        .map(
          ([question, answer, expected]) =>
            "<div><dt>" +
            esc(question) +
            '</dt><dd class="' +
            (expected ? "pq-ok" : "pq-bad") +
            '">' +
            esc(answer) +
            "</dd></div>",
        )
        .join("") +
      '</dl><p class="helper">Read by your browser from Diana at block ' +
      Number(block).toLocaleString("en") +
      ", using the ML-DSA-87 precompiles pqcVerify (0x0a01) and pqcKeyStatus (0x0a02).</p>" +
      '<div class="actions">' +
      action("pqAgain", "Ask again") +
      "</div></div>";
  } catch {
    box.innerHTML =
      '<div class="step"><h3>Ask QoreChain</h3><p class="helper">Diana did not answer. The receipt above is not affected.</p><div class="actions">' +
      action("pqAgain", "Try again") +
      "</div></div>";
  }
  click("#pqAgain", () => postQuantum(row));
}
async function counter() {
  if (!cfg.session && !demoSend) return cfg.demo ? welcome() : signIn(counter);
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
            : "The wallet funds escrow before Clainova sends the SMS. The approval and deposit go in one post-quantum transaction of about 0.09 test QOR, plus 0.05 to register the key the first time.") +
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
      if (latest.state === row.state) return;
      // The receipt follows the collection by a few seconds. Count the wait
      // only from the change, so the live check has a receipt to ask about.
      if (latest.evidence?.collection || ++waits > 8) {
        clearInterval(timer);
        issued(latest);
      }
    } catch {
      // The next check tries again.
    }
  }, 5000);
}
// Sealed notes between the organiser and the recipient after collection. Each
// is sealed in this browser with QoreSeal (ML-KEM-1024) to both parties' keys
// on QoreChain's encryption-key registry; the server stores text it cannot open.
async function sealedNotes(row, side, post, refresh, checks = 0) {
  const box = el("#notes");
  if (!box || local || row.state !== "collected") return;
  // The keys come from the wallet, so a locked wallet asks for its password first.
  if (!wallet.current && wallet.saved) {
    box.innerHTML =
      '<div class="step"><h3>Sealed notes</h3><p class="helper">Notes between the organiser and the recipient are sealed with ML-KEM-1024. Unlock this browser’s wallet to read and write them.</p><form class="formstack" id="notesUnlock"><div class="field"><label for="notesPw">Wallet password</label><input id="notesPw" type="password" autocomplete="current-password" required minlength="10"></div><button class="secondary">Unlock notes</button></form></div>';
    on("#notesUnlock", "submit", async () => {
      await wallet.unlock(el("#notesPw").value);
      await sealedNotes(row, side, post, refresh, checks);
    });
    return;
  }
  if (!wallet.current || !wallet.canSeal) return;
  const other = side === "recipient" ? row.sender : row.destination;
  const [mine, theirs] = await Promise.all([
    wallet.kemKeyOf(wallet.current.address).catch(() => null),
    wallet.kemKeyOf(other).catch(() => null),
  ]);
  const them = side === "recipient" ? "the organiser" : "the recipient";
  const items = (row.notes || [])
    .map((n) => {
      const text = wallet.openNote(n.envelope);
      return (
        "<li><strong>" +
        (n.from === side ? "You" : side === "recipient" ? "The organiser" : "The recipient") +
        "</strong><span>" +
        (text === null ? "Sealed for another wallet" : esc(text)) +
        "</span></li>"
      );
    })
    .join("");
  const last = row.notes?.at(-1);
  box.innerHTML =
    '<div class="step"><h3>Sealed notes</h3><p class="helper">A note to ' +
    them +
    ", such as a receipt, an event pass or invoice details. It is sealed in this browser with ML-KEM-1024 to both wallets’ keys on QoreChain’s encryption-key registry. Clainova stores only the sealed text and has no key to open it.</p>" +
    (items ? '<ol class="notes">' + items + "</ol>" : "") +
    (last
      ? '<p class="formnote">What Clainova stores for the latest note: <code>' +
        esc(last.envelope.slice(0, 26)) +
        "…</code> (" +
        last.envelope.length.toLocaleString("en") +
        " characters)</p>"
      : "") +
    (!mine
      ? '<p class="helper">This wallet’s encryption key is not on QoreChain yet.</p>'
      : !theirs
        ? '<p class="helper">The other wallet has no encryption key on QoreChain yet, so nothing can be sealed to it.</p>'
        : '<form class="formstack" id="noteForm"><div class="field"><label for="noteText">Note to ' +
          them +
          '</label><textarea id="noteText" required maxlength="800" rows="3"></textarea></div><button class="secondary">Seal and send</button></form>') +
    "</div>";
  on("#noteForm", "submit", async () => {
    const envelope = await wallet.sealNote(el("#noteText").value.trim(), other);
    const { notes } = await post(envelope);
    row.notes = notes;
    await sealedNotes(row, side, post, refresh);
    status("Note sealed and sent.", 5000);
  });
  // The other side's notes appear without a reload, unless a note is being typed.
  if (refresh && checks < 90)
    setTimeout(async () => {
      if (!document.body.contains(box)) return;
      const fresh = await refresh().catch(() => null);
      const changed = (fresh?.notes || []).length !== (row.notes || []).length;
      if (changed && !el("#noteText")?.value) row.notes = fresh.notes;
      sealedNotes(row, side, post, refresh, checks + 1);
    }, 8000);
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
        <div id="pq"></div>
        <div id="notes"></div>
      </section>
      ${receipt(row)}
    </div>`,
    "issued",
  );
  stagger([...document.querySelectorAll(".timeline li")]);
  if (row.demo && !done) watchCollection(row);
  if (done) {
    postQuantum(row);
    sealedNotes(
      row,
      "organiser",
      (envelope) =>
        row.demo
          ? api("/api/try/note", { id: row.id, envelope })
          : api("/api/payments/" + row.id + "/note", { envelope }),
      async () =>
        row.demo
          ? (await api("/api/try/sent", {})).row
          : (await api("/api/payments")).rows.find((r) => r.id === row.id),
    ).catch((err) => console.warn("Sealed notes unavailable:", err?.message));
  }
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
            '<div id="follow"></div><div id="notes"></div><div id="pq"></div>',
          receipt(r),
        ),
      "collected",
    );
    if (celebrate) {
      countUp(el("#slipAmount"), r.amount, money, 900);
      stamp(el(".press"));
    }
    bindWallet(collect);
    postQuantum(r);
    sealedNotes(
      r,
      "recipient",
      (envelope) => invite("note", { envelope }),
      () => invite(),
    ).catch((err) => console.warn("Sealed notes unavailable:", err?.message));
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
      // Fees from the payment itself: a recipient who keeps 0.01 fUSD as QOR
      // no longer depends on the sponsor for later transactions.
      if (!local && !wallet.external && balance >= 10000) {
        const gas = Number(await wallet.gas()) / 1e18;
        // The swap's own fee is 0.08 test QOR. Right after collecting, the
        // sponsor's grant still covers it, so this step comes before sending.
        const enough = gas >= 0.082,
          covered = gas >= 0.5;
        el("#follow").insertAdjacentHTML(
          "afterbegin",
          '<div class="step" id="feeStep"><h3>Pay your own fees</h3><p class="helper">This wallet holds ' +
            gas.toFixed(2) +
            (covered
              ? " test QOR, enough to pay its own fees for many transactions.</p></div>"
              : " test QOR for fees. Swap 0.01 test fUSD for about " +
            "1 test QOR in QoreChain’s fUSD/QOR pool, and it pays its own fees from then on. One post-quantum transaction, with a 3% price limit." +
                (enough ? "" : " The swap itself needs 0.08 test QOR, which this wallet no longer has.") +
                "</p>" +
                (enough ? action("swapFees", "Swap 0.01 fUSD for fees") : "") +
                "</div>"),
        );
        click("#swapFees", async () => {
          const { hash } = await wallet.swapForFees();
          await collect();
          status(
            "Swapped. This wallet now pays its own fees. Transaction " + hash.slice(0, 10) + "…",
            8000,
          );
        });
      }
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
            '</p><p class="helper">Your key is registered the first time. Collecting is then one transaction signed with it, so no window is opened. ' +
            (cfg.sponsored
              ? "Clainova sends this wallet the test QOR for these fees when you collect.</p>"
              : 'Registration costs 0.05 test QOR and collecting about 0.14.</p><div class="actions"><a href="https://dashboard.qorechain.io/faucet" target="_blank" rel="noreferrer">Get test QOR from the faucet</a></div>')
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
      "Try Clainova on QoreChain.",
      cfg.demoSend
        ? "Send a payment as the organiser, then collect it as the recipient. You need no phone, no extension and no QOR."
        : "1 test fUSD is waiting in the escrow on Diana. You need no phone, no extension and no QOR.",
    ) +
      '<div class="copy"><p>Every step is a real transaction on Diana, QoreChain’s testnet, and at the end your browser asks the chain’s post-quantum checks itself. A normal recipient gets a code by SMS. Here the code is shown on the page. Test tokens have no cash value.</p><div class="actions">' +
      (cfg.demoSend
        ? '<a class="button" href="/try/send">Send, then collect <span class="arrow" aria-hidden="true">→</span></a>'
        : "") +
      // "Only collect" needs a pre-funded payment; a new server has none.
      (!cfg.demoSend || cfg.demoPool > 0
        ? action("take", cfg.demoSend ? "Only collect" : "Take a test payment", !cfg.demoSend)
        : "") +
      '<a class="secondary" href="/try/steal">Try to steal a wallet</a>' +
      "</div></div>",
    "try",
  );
  click("#take", async () => {
    const { link } = await api("/api/try", {});
    location.href = "/c/" + link;
  });
}
// Public bait wallets: their classical keys are published, and the page shows
// Diana refusing every transaction made with that key alone.
async function steal() {
  if (!cfg.demo)
    return main(title("Not available here.", "This server has no public test wallets."), "try");
  const qor = (uqor) => (uqor == null ? "—" : (uqor / 1e6).toFixed(2));
  function draw(v) {
    const latest = v.rounds[0];
    main(
      title(
        "Try to steal it.",
        "These three wallets hold test fUSD on Diana, and their private keys are below.",
      ) +
        '<div class="copy"><p>Each is the secp256k1 key an ordinary Ethereum wallet uses; MetaMask can import it. On QoreChain that key is not enough. Every transaction from these accounts must also carry an ML-DSA-87 signature from the post-quantum key registered to it, and nobody holds that key: the recovery phrase that makes it was never stored. Test tokens have no cash value.</p></div>' +
        v.wallets
          .map(
            (w, i) =>
              '<section class="step bait"><h3>Wallet ' +
              (i + 1) +
              "</h3>" +
              summary([
                ["Holds", (w.fusd == null ? "—" : money(w.fusd)) + " test fUSD · " + qor(w.uqor) + " test QOR"],
                ["Address", short(w.address)],
              ]) +
              '<p class="helper">Private key (secp256k1)</p><p class="code" id="key' +
              i +
              '">' +
              esc(w.privateKey) +
              "</p>" +
              action("copy" + i, "Copy key") +
              '<p class="formnote">' +
              esc(w.account) +
              "</p></section>",
          )
          .join("") +
        '<section class="step"><h3>The six attacks, against the live network</h3><p class="helper">Clainova runs them every hour with the published key and an ML-DSA-87 key of the attacker’s own, and shows Diana’s answer word for word.</p>' +
        (latest
          ? '<ol class="notes">' +
            latest.results
              .map(
                (r) =>
                  "<li><strong>" +
                  esc(r.attack) +
                  ' · <span class="' +
                  (r.refused === true ? "pq-ok" : "pq-bad") +
                  '">' +
                  (r.refused === true ? "Refused" : r.refused === false ? "Accepted" : "No answer") +
                  "</span></strong><span>" +
                  esc(r.reason) +
                  "</span></li>",
              )
              .join("") +
            "</ol>" +
            '<p class="formnote">Latest round against ' +
            esc(short(latest.wallet)) +
            ", " +
            new Date(latest.at * 1000).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" }) +
            ". Rounds since this server started: " +
            v.total +
            ". Transactions accepted: " +
            v.accepted +
            ".</p>"
          : '<p class="helper">The first round runs a minute after the server starts.</p>') +
        '<div class="actions">' +
        action("attackNow", "Run the six attacks now", true) +
        "</div></section>",
      "steal",
    );
    v.wallets.forEach((w, i) =>
      click("#copy" + i, async () => {
        await navigator.clipboard.writeText(w.privateKey);
        status("Key copied.", 3000);
      }),
    );
    click("#attackNow", async () => {
      status("Attacking on Diana… about 20 seconds.", 25000);
      draw(await api("/api/bait", {}));
      status("Round finished.", 4000);
    });
  }
  draw(await api("/api/bait"));
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
        ? "<h2>Phone numbers and codes</h2><p>The verifier stores the number encrypted and uses it to send the invitation and one-time codes. The ledger shows only its last four digits. Africa’s Talking receives the number and message in SMS mode. The rehearsal inbox stays on the local machine.</p><h2>Public payment records</h2><p>Escrow transactions expose addresses, amounts and timing. The private invitation link, note, number and code stay off-chain. The operator can read the organiser’s note and decrypt phone numbers. Sealed notes after collection are different: they are encrypted in your browser with ML-KEM-1024 to both wallets’ keys on QoreChain’s encryption-key registry, and the operator stores them without any key to open them. Ask the organiser who invited you to remove the off-chain record after settlement. Public chain records persist.</p><h2>Wallet storage</h2><p>Clainova creates your wallet in your browser. Your password encrypts it and its backup on this device. Save a copy before clearing browser data. Nobody can reset a lost password. Browser cookies keep organiser sessions separate.</p>"
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
  if (currentPath === "/try/steal") return steal();
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
