// Re-checks every recorded Diana transaction in submission/diana-run.json.
// Read-only: needs no keys, sends nothing.  node scripts/verify-run.mjs
import fs from "node:fs";
import { Interface, JsonRpcProvider, getBytes } from "ethers";
import { addressFromBytes } from "@qorechain/qoresign";
const REST = "https://api-testnet.qore.host";
const run = JSON.parse(fs.readFileSync("submission/diana-run.json"));
const rpc = new JsonRpcProvider("https://evm-testnet.qore.host", 9800, {
  staticNetwork: true,
});
const events = new Interface([
  "event Funded(bytes32 indexed id,address indexed sender,uint128 amount,uint64 expiry)",
  "event Collected(bytes32 indexed id,address indexed recipient)",
  "event Refunded(bytes32 indexed id,address indexed sender)",
]);
const transfers = new Interface([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
const same = (a, b) => a?.toLowerCase() === b?.toLowerCase();
let passed = 0,
  failed = 0;
function check(ok, text) {
  ok ? passed++ : failed++;
  console.log((ok ? "ok    " : "FAIL  ") + text);
}
// A slow or flaky connection should not end the check halfway: retry each
// network read a few times before giving up.
async function retry(read, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      return await read();
    } catch (err) {
      if (i >= tries) throw err;
      console.log("      network busy, retrying (" + i + "/" + (tries - 1) + ")");
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
}
async function evm(hash) {
  const receipt = await retry(() => rpc.getTransactionReceipt(hash));
  check(receipt?.status === 1, "succeeded " + hash);
  return receipt;
}
function escrowEvent(receipt, name, id) {
  for (const log of receipt?.logs || []) {
    if (!same(log.address, run.escrow)) continue;
    const event = events.parseLog(log);
    if (event?.name === name && event.args.id === id) return event;
  }
}
async function native(hash, type, account) {
  const { tx, tx_response: out } = await retry(async () => {
    const res = await fetch(REST + "/cosmos/tx/v1beta1/txs/" + hash, {
      signal: AbortSignal.timeout(20000),
    });
    return res.json();
  });
  const message = tx?.body.messages[0];
  check(
    Number(out?.code) === 0 &&
      message?.["@type"] === type &&
      [message.sender, message.from_address].includes(account),
    type.split(".").pop() + " " + hash,
  );
  // Registration is the one native message that cannot be hybrid-signed yet.
  if (!type.endsWith("RegisterPQCKeyV2"))
    check(
      [
        ...(tx?.body.extension_options || []),
        ...(tx?.body.non_critical_extension_options || []),
      ].some((x) => /PQC/i.test(x["@type"])),
      "  carries a post-quantum signature",
    );
  return { height: Number(out?.height), message };
}
for (const p of run.payments) {
  console.log("\n" + p.label + "\n" + p.id);
  const funding = await evm(p.funding);
  const funded = escrowEvent(funding, "Funded", p.id);
  check(
    funded && Number(funded.args.amount) === p.amount * 1e6,
    "Funded event with " + p.amount + " test fUSD for this payment ID",
  );
  if (p.collection) {
    const receipt = await evm(p.collection);
    const event = escrowEvent(receipt, "Collected", p.id);
    check(
      event && same(event.args.recipient, p.recipient),
      "Collected event pays " + p.recipient,
    );
    check(
      same(receipt?.from, p.recipient),
      "the recipient sent and paid for its own collection",
    );
    const qor = addressFromBytes(getBytes(p.recipient)).bech32;
    const topUp = await native(p.gasTopUp, "/cosmos.bank.v1beta1.MsgSend", run.sponsor);
    check(topUp.message.to_address === qor, "  the sponsor paid this recipient's gas");
    const key = await native(p.registration, "/qorechain.pqc.v1.MsgRegisterPQCKeyV2", qor);
    check(
      key.height > funding.blockNumber,
      "  the wallet registered " + (key.height - funding.blockNumber) + " blocks after the payment was funded",
    );
    const window = await native(p.window, "/qorechain.pqc.v1.MsgOpenEVMWindow", qor);
    const allowed = window.message.allowed_targets || [];
    check(
      allowed.length === 1 && same(allowed[0], run.escrow) && Number(window.message.max_txs) === 1,
      "  window allows one call, to the escrow only",
    );
  }
  if (p.refund) {
    const receipt = await evm(p.refund);
    const event = escrowEvent(receipt, "Refunded", p.id);
    check(event && same(event.args.sender, funded?.args.sender), "Refunded event returns funds to the sender");
    check(!same(receipt?.from, event?.args.sender), "a different account triggered the refund");
  }
  if (p.spend) {
    const receipt = await evm(p.spend);
    const moved = (receipt?.logs || []).some((log) => {
      if (!same(log.address, run.token)) return false;
      const event = transfers.parseLog(log);
      return event?.name === "Transfer" && same(event.args.from, p.recipient);
    });
    check(moved, "the recipient then spent from its own wallet");
  }
}
rpc.destroy();
console.log("\n" + passed + " checks passed, " + failed + " failed");
process.exitCode = failed ? 1 : 0;
