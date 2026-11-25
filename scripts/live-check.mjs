// Measures Clainova on Diana against sending straight to a new wallet, then attacks it.
//   ORIGIN=https://… node scripts/live-check.mjs 5
// The Clainova half and the attacks need no keys: they use the public demo.
// SPONSOR_MNEMONIC is only needed for the direct-transfer half, to pay 1 test fUSD
// to each new wallet. Results go to submission/live-check.json.
import fs from "node:fs";
import { Contract, HDNodeWallet, JsonRpcProvider, encodeBase64, hexlify, getBytes } from "ethers";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx.js";
import { nativeKeys, openWindow, qorAddress, signedNative } from "../web/native.js";
import { broadcast, chainRead } from "../server/native.mjs";
import { TEST_RPC } from "../server/network.mjs";
const { ORIGIN, SPONSOR_MNEMONIC } = process.env;
const runs = Number(process.argv[2] || 1);
const rpc = new JsonRpcProvider(TEST_RPC, 9800, { staticNetwork: true, cacheTimeout: -1 });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const short = (error) =>
  String(error?.error?.message || error?.info?.error?.message || error?.reason || error?.shortMessage || error?.message || error)
    .replace(/0x[0-9a-f]{70,}/gi, "0x…")
    .replace(/\s+/g, " ")
    .slice(0, 160);
const coin = (denom, amount) => ({ denom, amount: String(amount) });
const sendMsg = (from, to, amount) => ({
  typeUrl: "/cosmos.bank.v1beta1.MsgSend",
  value: MsgSend.encode(MsgSend.fromPartial({ fromAddress: from, toAddress: to, amount })).finish(),
});
async function settle(raw) {
  const { tx_response: sent } = await broadcast(raw);
  if (Number(sent.code)) throw Error("code " + sent.code + ": " + sent.raw_log);
  for (let i = 0; i < 40; i++) {
    const { tx_response: done } = await chainRead("receipt", sent.txhash);
    if (done) {
      if (Number(done.code)) throw Error("code " + done.code + ": " + done.raw_log);
      return sent.txhash;
    }
    await pause(1000);
  }
  throw Error("Pending " + sent.txhash);
}
// One visitor: its own cookie jar, like a separate browser.
function browser() {
  let jar = "";
  return async (path, body) => {
    const res = await fetch(ORIGIN + path, {
      method: body ? "POST" : "GET",
      headers: { Origin: ORIGIN, "Content-Type": "application/json", ...(jar ? { Cookie: jar } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const set = res.headers.get("set-cookie");
    if (set) jar = set.split(";")[0];
    const data = await res.json();
    if (!res.ok) throw Object.assign(Error(data.error), { status: res.status });
    return data;
  };
}
const cfg = await browser()("/api/config");
const escrow = new Contract(cfg.contract, ["function claim(bytes32,uint64,bytes)", "function refund(bytes32)"], rpc);
const token = new Contract(cfg.token, ["function transfer(address,uint256)", "function balanceOf(address) view returns(uint256)"], rpc);
const attacks = [];
// `refused` must be the chain or server saying no, never a success.
async function attack(name, attempt, expected) {
  try {
    await attempt();
    attacks.push({ name, refused: false, answer: "succeeded" });
  } catch (error) {
    const answer = short(error);
    attacks.push({ name, refused: expected.test(answer), answer });
  }
  const last = attacks.at(-1);
  console.log((last.refused ? "refused  " : "PROBLEM  ") + name + " -> " + last.answer);
}
async function collect(previous) {
  const api = browser(), started = Date.now();
  const { link } = await api("/api/try", {});
  const invite = (action, body) => api("/api/invite/" + link + (action ? "/" + action : ""), body);
  const row = await invite("");
  if (previous) {
    await attack("Stolen link, no code: ask for the signature", () => invite("attest", { token: "0".repeat(64), destination: previous.address }), /Verify your number again/);
    await attack("Stolen link, guessed code", async () => { await invite("code", {}); await invite("verify", { code: "000000" }); }, /incorrect/);
    await pause(31000);
  }
  const { pageCode } = await invite("code", {});
  const { token: grant } = await invite("verify", { code: pageCode });
  const wallet = HDNodeWallet.createRandom().connect(rpc);
  const prior = await invite("observe", { token: grant, destination: wallet.address });
  const before = await rpc.getBalance(wallet.address);
  await invite("sponsor", { token: grant, destination: wallet.address });
  for (let i = 0; i < 30 && !(await rpc.getBalance(wallet.address)); i++) await pause(1000);
  if (previous) {
    const early = await invite("attest", { token: grant, destination: wallet.address });
    await attack("Right wallet, but no ML-DSA-87 key registered", () => escrow.claim.staticCall(row.id, early.deadline, early.signature, { from: wallet.address }), /possession-proven|missing revert|revert/i);
  }
  await openWindow(wallet, [cfg.contract], api, () => {});
  const a = await invite("attest", { token: grant, destination: wallet.address });
  if (previous) {
    const bent = getBytes(a.signature);
    bent[2000] ^= 1;
    await attack("Signature with one bit changed", () => escrow.claim.staticCall(row.id, a.deadline, hexlify(bent), { from: wallet.address }), /Invalid attestation/);
    await attack("Someone else's wallet, with a proven key, using the real signature", () => escrow.claim.staticCall(row.id, a.deadline, a.signature, { from: previous.address }), /Invalid attestation/);
    await attack("Ask the server to pay a second wallet", () => invite("attest", { token: grant, destination: previous.address }), /already bound/);
    await attack("Refund before the deadline", () => escrow.refund.staticCall(row.id, { from: previous.address }), /Refund unavailable/);
  }
  const claimed = await (await escrow.connect(wallet).claim(row.id, a.deadline, a.signature)).wait(1, 90000);
  await invite("settle", {});
  await invite("evidence", { kind: "collection", hash: claimed.hash });
  const collectedIn = (Date.now() - started) / 1000;
  if (previous) {
    await attack("Collect the same payment twice", () => escrow.claim.staticCall(row.id, a.deadline, a.signature, { from: wallet.address }), /Payment closed/);
    // The classical key alone, as after a leak or on Q-Day. The window is used up.
    await attack("Leaked classical key: EVM transfer with no window open", async () => {
      const raw = await wallet.signTransaction({ type: 0, chainId: 9800, to: cfg.token, data: token.interface.encodeFunctionData("transfer", [previous.address, 1]), gasLimit: 100000n, gasPrice: (await rpc.getFeeData()).gasPrice, nonce: await rpc.getTransactionCount(wallet.address) });
      await rpc.broadcastTransaction(raw);
    }, /window|post-quantum|pqc|refus|denied|not admitted/i);
    await attack("Leaked classical key: open a window without the ML-DSA-87 signature", async () => {
      const keys = nativeKeys(wallet);
      const { info } = await chainRead("account", keys.account);
      await settle(encodeBase64(signedNative(keys, info, [cfg.token], null, "classicalOnly").txBytes));
    }, /pqc|hybrid|post-quantum|signature|classical/i);
    await attack("Leaked classical key: native transfer without the ML-DSA-87 signature", async () => {
      const keys = nativeKeys(wallet);
      const { info } = await chainRead("account", keys.account);
      await settle(encodeBase64(signedNative(keys, info, null, sendMsg(keys.account, qorAddress(previous.address), [coin("uqor", 1000)]), "classicalOnly").txBytes));
    }, /pqc|hybrid|post-quantum|signature|classical/i);
  }
  await openWindow(wallet, [cfg.token], api, () => {});
  const spent = await (await token.connect(wallet).transfer(HDNodeWallet.createRandom().address, 500000n)).wait(1, 90000);
  await invite("evidence", { kind: "transfer", hash: spent.hash });
  return { wallet, result: { wallet: wallet.address, accountBefore: prior.status, qorBefore: before.toString(), collected: claimed.hash, collectedInSeconds: Math.round(collectedIn), spent: spent.hash } };
}
// The simple alternative: send the same token straight to a new wallet.
async function direct() {
  const sponsor = nativeKeys(HDNodeWallet.fromPhrase(SPONSOR_MNEMONIC));
  const wallet = HDNodeWallet.createRandom().connect(rpc), keys = nativeKeys(wallet);
  const denom = "erc20:" + cfg.token;
  const { info } = await chainRead("account", sponsor.account);
  const received = await settle(encodeBase64(signedNative(sponsor, info, null, sendMsg(sponsor.account, keys.account, [coin(denom, 1000000)])).txBytes));
  const tries = {};
  const attempt = async (name, fn) => {
    try { tries[name] = { ok: true, answer: await fn() }; } catch (error) { tries[name] = { ok: false, answer: short(error) }; }
  };
  const account = async () => (await chainRead("account", keys.account)).info;
  await attempt("send it on", async () => settle(encodeBase64(signedNative(keys, await account(), null, sendMsg(keys.account, sponsor.account, [coin(denom, 500000)])).txBytes)));
  await attempt("register a key first", async () => settle(encodeBase64(signedNative(keys, await account(), null).txBytes)));
  return { wallet: wallet.address, received, couldSpend: tries["send it on"].ok, tries };
}
const out = { network: "qorechain-diana", date: new Date().toISOString(), escrow: cfg.contract, clainova: [], direct: [], attacks };
try {
  let previous;
  for (let i = 0; i < runs; i++) {
    // The second run is attacked, with the first run's wallet as the thief.
    const { wallet, result } = await collect(i === 1 ? previous : null);
    out.clainova.push(result);
    console.log("clainova " + (i + 1) + ": collected in " + result.collectedInSeconds + "s, then spent", result.spent.slice(0, 12));
    previous ||= wallet;
  }
  if (SPONSOR_MNEMONIC)
    for (let i = 0; i < runs; i++) {
      out.direct.push(await direct());
      const d = out.direct.at(-1);
      console.log("direct " + (i + 1) + ": received, could spend: " + d.couldSpend + " (" + d.tries["send it on"].answer + ")");
    }
  const ok = out.clainova.length, free = out.direct.filter((d) => d.couldSpend).length;
  out.headline = `${ok} of ${runs} new wallets collected and spent through Clainova. ${SPONSOR_MNEMONIC ? `${free} of ${out.direct.length} could spend the same token sent to them directly.` : ""}`.trim();
  out.attacksRefused = attacks.filter((x) => x.refused).length + " of " + attacks.length;
  console.log(out.headline, "Attacks refused:", out.attacksRefused);
} finally {
  fs.writeFileSync("submission/live-check.json", JSON.stringify(out, null, 2) + "\n");
  rpc.destroy();
}
