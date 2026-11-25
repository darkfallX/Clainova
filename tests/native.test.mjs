import test from "node:test";
import assert from "node:assert/strict";
import { Wallet, encodeBase64 } from "ethers";
import { TxRaw, TxBody } from "cosmjs-types/cosmos/tx/v1beta1/tx.js";
import { openWindow, nativeKeys, convertFusd, nativeFee, nativeGas } from "../web/native.js";
import { GRANT } from "../server/sponsor.mjs";
const FEST = "0x97143B771D34ddb9130b807b135Ae675A5a963CA";
const ESCROW = "0x5fD1e7D06Eb60AEdDe19B4bFcEA3242F293b65F6";

// Fake Diana REST proxy that records each broadcast message type in order.
function fakeDiana(wallet, registered, openState = { live: false }) {
  const keys = nativeKeys(wallet);
  const sent = [];
  let sequence = 0;
  const api = async (path, body) => {
    if (path.startsWith("/api/native/account/"))
      return { info: { sequence: String(sequence), account_number: "7" } };
    if (path.startsWith("/api/native/key/"))
      return registered
        ? { found: true, account: { possession_proven: true, public_key: encodeBase64(keys.pqKey.publicKey) } }
        : { found: false };
    if (path.startsWith("/api/native/window/")) return openState;
    if (path === "/api/native/broadcast") {
      const { messages } = TxBody.decode(TxRaw.decode(Buffer.from(body.raw, "base64")).bodyBytes);
      sent.push(messages[0].typeUrl);
      sequence++;
      return { tx_response: { code: 0, txhash: "H" + sent.length } };
    }
    if (path.startsWith("/api/native/receipt/")) return { tx_response: { code: 0 } };
    throw Error("unexpected " + path);
  };
  return { api, sent, keys };
}

test("funding with a shortfall converts bank fUSD before opening the window", async () => {
  const wallet = Wallet.createRandom();
  const { api, sent, keys } = fakeDiana(wallet, true);
  const conversion = convertFusd(keys.account, wallet.address, "0x97143B771D34ddb9130b807b135Ae675A5a963CA", 20000000n);
  await openWindow(wallet, [FEST, ESCROW], api, () => {}, conversion);
  assert.deepEqual(sent, [
    "/cosmos.evm.erc20.v1.MsgConvertCoin",
    "/qorechain.pqc.v1.MsgOpenEVMWindow",
  ]);
});

test("a new wallet registers its key, converts, then opens the window", async () => {
  const wallet = Wallet.createRandom();
  const { api, sent, keys } = fakeDiana(wallet, false);
  const conversion = convertFusd(keys.account, wallet.address, "0x97143B771D34ddb9130b807b135Ae675A5a963CA", 1n);
  await openWindow(wallet, [ESCROW], api, () => {}, conversion);
  assert.deepEqual(sent, [
    "/qorechain.pqc.v1.MsgRegisterPQCKeyV2",
    "/cosmos.evm.erc20.v1.MsgConvertCoin",
    "/qorechain.pqc.v1.MsgOpenEVMWindow",
  ]);
});

test("no shortfall means no conversion transaction", async () => {
  const wallet = Wallet.createRandom();
  const { api, sent } = fakeDiana(wallet, true);
  await openWindow(wallet, [ESCROW], api, () => {});
  assert.deepEqual(sent, ["/qorechain.pqc.v1.MsgOpenEVMWindow"]);
});

test("a retry reuses an untouched window for the same target and never any other", async () => {
  const open = {
    live: true,
    used_txs: "0",
    max_txs: "1",
    remaining_blocks: "100",
    allowed_targets: [ESCROW.toLowerCase()],
  };
  const attempt = async (state, targets = [ESCROW]) => {
    const { api, sent } = fakeDiana(wallet, true, state);
    await openWindow(wallet, targets, api, () => {});
    return sent.length;
  };
  const wallet = Wallet.createRandom();
  assert.equal(await attempt(open), 0);
  assert.equal(await attempt({ ...open, used_txs: "1" }), 1);
  assert.equal(await attempt({ ...open, remaining_blocks: "20" }), 1);
  assert.equal(await attempt({ ...open, live: false }), 1);
  assert.equal(await attempt({ ...open, allowed_targets: [] }), 1);
  assert.equal(await attempt(open, [FEST]), 1);
});

test("setup fees stay above Diana's minimum and fit one sponsor grant", async () => {
  // A full first use: registration, two windows, the claim and a transfer.
  const setup = Number(nativeFee(nativeGas.setup));
  for (const gas of Object.values(nativeGas))
    assert.ok(Number(nativeFee(gas)) > Number(gas) * 0.1);
  const measuredEvmFees = 50300 + 5900; // uqor, Diana run of 25 Nov 2026
  assert.ok(setup * 3 + measuredEvmFees < Number(GRANT) * 0.75);
});
