// Funds public demo payments for /try.
//   ORIGIN=https://… OPERATOR_PASSWORD=… DEMO_ORGANISER_MNEMONIC="…" node scripts/fund-demo.mjs 10
// The wallet needs bank fUSD and test QOR. All deposits share one hybrid-signed
// window limited to the token and the escrow.
import { randomUUID } from "node:crypto";
import { Contract, HDNodeWallet, JsonRpcProvider, encodeBase64 } from "ethers";
import { openEvmWindowMsg } from "../node_modules/@qorechain/wallet-adapter/src/evm-window.js";
import { convertFusd, nativeKeys, signedNative } from "../web/native.js";
import { broadcast, chainRead } from "../server/native.mjs";
import { TEST_RPC } from "../server/network.mjs";
const { ORIGIN, OPERATOR_PASSWORD, DEMO_ORGANISER_MNEMONIC } = process.env;
const count = Number(process.argv[2] || 5);
if (!ORIGIN || !OPERATOR_PASSWORD || !DEMO_ORGANISER_MNEMONIC || !(count >= 1 && count <= 40))
  throw Error("Set ORIGIN, OPERATOR_PASSWORD and DEMO_ORGANISER_MNEMONIC, and fund 1 to 40 payments.");
const AMOUNT = 1000000n;
const rpc = new JsonRpcProvider(TEST_RPC, 9800, { staticNetwork: true, cacheTimeout: -1 });
const wallet = HDNodeWallet.fromPhrase(DEMO_ORGANISER_MNEMONIC).connect(rpc);
const keys = nativeKeys(wallet);
let session;
async function call(path, body) {
  const res = await fetch(ORIGIN + path, {
    method: body ? "POST" : "GET",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", ...(session ? { Cookie: session } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json();
  if (!res.ok) throw Error(path.split("/").slice(0, 3).join("/") + ": " + data.error);
  return { data, res };
}
async function native(message) {
  const { info } = await chainRead("account", keys.account);
  const raw = encodeBase64(signedNative(keys, info, null, message).txBytes);
  const { tx_response: sent } = await broadcast(raw);
  if (Number(sent.code)) throw Error(sent.raw_log);
  for (let i = 0; i < 40; i++) {
    const { tx_response: done } = await chainRead("receipt", sent.txhash);
    if (done) {
      if (Number(done.code)) throw Error(done.raw_log);
      return sent.txhash;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw Error("Pending " + sent.txhash);
}
try {
  const login = await call("/api/login", { password: OPERATOR_PASSWORD });
  session = login.res.headers.get("set-cookie").split(";")[0];
  const { data: cfg } = await call("/api/config");
  if (!cfg.demo) throw Error("Start the server with DEMO_PAYMENTS=on.");
  if (!(await chainRead("key", keys.account)).found) console.log("registered key", await native());
  const token = new Contract(cfg.token, [
    "function approve(address,uint256) returns(bool)",
    "function balanceOf(address) view returns(uint256)",
  ], wallet);
  const escrow = new Contract(cfg.contract, ["function fund(bytes32,uint128,uint64)"], wallet);
  const total = AMOUNT * BigInt(count);
  const held = await token.balanceOf(wallet.address);
  if (held < total)
    console.log("converted", await native(convertFusd(keys.account, wallet.address, cfg.token, total - held)));
  console.log("window", await native(openEvmWindowMsg({
    sender: keys.account,
    blocks: 120 + count * 20,
    maxTxs: count + 1,
    maxValue: String(50000 * (count + 1)),
    allowedTargets: [cfg.token, cfg.contract],
  })));
  await (await token.approve(cfg.contract, total)).wait(1, 90000);
  for (let i = 0; i < count; i++) {
    const { data: row } = await call("/api/payments", {
      demo: true,
      amount: "1",
      note: "Clainova demo",
      seconds: 2505600,
      requestKey: randomUUID(),
      sender: wallet.address,
    });
    const receipt = await (await escrow.fund(row.salt, row.amount, row.expiry)).wait(1, 90000);
    await call("/api/payments/" + row.id + "/evidence", { kind: "funding", hash: receipt.hash });
    console.log("funded", i + 1, row.id.slice(0, 12), receipt.hash);
  }
} finally {
  rpc.destroy();
}
