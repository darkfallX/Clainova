import test from "node:test";
import assert from "node:assert/strict";
import { Wallet, encodeBase64 } from "ethers";
import { TxRaw, TxBody } from "cosmjs-types/cosmos/tx/v1beta1/tx.js";
import { openWindow, nativeKeys, convertFusd } from "../web/native.js";
const FEST = "0x97143B771D34ddb9130b807b135Ae675A5a963CA";
const ESCROW = "0x5fD1e7D06Eb60AEdDe19B4bFcEA3242F293b65F6";

// Fake Diana REST proxy that records each broadcast message type in order.
function fakeDiana(wallet, registered) {
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
