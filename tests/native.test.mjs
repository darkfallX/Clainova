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

// Cross-VM: every escrow and token call is a MsgCrossVMCall in one hybrid-signed
// native transaction. No window is opened at any point.
import { Interface } from "ethers";
import { PQC_HYBRID_TYPE_URL } from "@qorechain/qoresign";
import { callEvm, crossVmMsg, crossVmGas } from "../web/native.js";
import { allowedCalls, decodeCrossVm, nativeRequest } from "../server/native.mjs";
import { AuthInfo } from "cosmjs-types/cosmos/tx/v1beta1/tx.js";
const token = new Interface(["function approve(address,uint256)", "function transfer(address,uint256)", "function transferFrom(address,address,uint256)"]);
const escrow = new Interface(["function fund(bytes32,uint128,uint64)", "function claim(bytes32,uint64,bytes)", "function refund(bytes32)"]);
const SALT = "0x" + "ab".repeat(32);
const ID = "0x" + "cd".repeat(32);
const approve = (spender = ESCROW) => ({ to: FEST, data: token.encodeFunctionData("approve", [spender, 5n]) });
const fund = { to: ESCROW, data: escrow.encodeFunctionData("fund", [SALT, 5n, 99n]) };
const claim = { to: ESCROW, data: escrow.encodeFunctionData("claim", [ID, 9n, "0x01"]) };

function fakeCrossVm(wallet, executed = true) {
  const keys = nativeKeys(wallet);
  const sent = [];
  let sequence = 0, last;
  const api = async (path, body) => {
    if (path.startsWith("/api/native/account/")) return { info: { sequence: String(sequence), account_number: "7" } };
    if (path.startsWith("/api/native/key/"))
      return { found: true, account: { possession_proven: true, public_key: encodeBase64(keys.pqKey.publicKey) } };
    if (path === "/api/native/broadcast") {
      const raw = TxRaw.decode(Buffer.from(body.raw, "base64"));
      const decoded = TxBody.decode(raw.bodyBytes);
      last = { messages: decoded.messages, extensions: [...decoded.extensionOptions, ...decoded.nonCriticalExtensionOptions], auth: AuthInfo.decode(raw.authInfoBytes) };
      sent.push(last);
      sequence++;
      return { tx_response: { code: 0, txhash: "C" + sent.length } };
    }
    if (path.startsWith("/api/native/receipt/"))
      return {
        tx_response: {
          code: 0,
          txhash: "C" + sent.length,
          events: last.messages.map((_, i) => ({
            type: "crossvm_response",
            attributes: [{ key: "status", value: executed ? "executed" : "failed" }, { key: "msg_index", value: String(i) }],
          })),
        },
      };
    throw Error("unexpected " + path);
  };
  return { api, sent, keys };
}

test("approval and deposit go out as two cross-VM calls in one hybrid transaction, with no window", async () => {
  const wallet = Wallet.createRandom();
  const { api, sent, keys } = fakeCrossVm(wallet);
  const result = await callEvm(wallet, api, () => {}, [approve(), fund], "fund");
  assert.deepEqual(result, { hash: "C1", native: true });
  assert.equal(sent.length, 1);
  const [tx] = sent;
  assert.deepEqual(tx.messages.map((m) => m.typeUrl), ["/qorechain.crossvm.v1.MsgCrossVMCall", "/qorechain.crossvm.v1.MsgCrossVMCall"]);
  const [a, f] = tx.messages.map((m) => decodeCrossVm(m.value));
  assert.equal(a.sender, keys.account);
  assert.equal(a.targetVm, "evm");
  assert.equal(a.target, FEST);
  assert.equal(f.target, ESCROW);
  assert.equal("0x" + Buffer.from(f.payload).toString("hex"), fund.data);
  assert.equal(a.async, false);
  assert.equal(a.funds, 0);
  assert.equal(tx.auth.fee.gasLimit, crossVmGas.fund);
  assert.equal(tx.auth.fee.amount[0].amount, nativeFee(crossVmGas.fund));
  // The ML-DSA-87 layer rides in the hybrid extension: a 4627-byte signature.
  const pq = tx.extensions.find((e) => e.typeUrl === PQC_HYBRID_TYPE_URL);
  assert.ok(pq && pq.value.length > 4627);
});

test("a call Diana did not execute is reported as a failure", async () => {
  const wallet = Wallet.createRandom();
  const { api } = fakeCrossVm(wallet, false);
  await assert.rejects(callEvm(wallet, api, () => {}, [claim], "claim"), /did not run every call/);
});

test("the relay forwards only this app's calls", () => {
  const sender = "qor1" + "q".repeat(38);
  const msgs = (...calls) => calls.map((c) => crossVmMsg(c.sender || sender, c.to, c.data));
  const ok = (...calls) => allowedCalls(msgs(...calls), { escrow: ESCROW, token: FEST });
  assert.equal(ok(claim), true);
  assert.equal(ok(approve(), fund), true);
  assert.equal(ok(fund), true);
  assert.equal(ok({ to: ESCROW, data: escrow.encodeFunctionData("refund", [ID]) }), true);
  assert.equal(ok({ to: FEST, data: token.encodeFunctionData("transfer", [ESCROW, 1n]) }), true);
  // Refused: approval for another spender, another contract, other functions,
  // reversed order, three calls, two senders, and no configured contracts.
  assert.equal(ok(approve("0x" + "11".repeat(20)), fund), false);
  assert.equal(ok({ to: "0x" + "22".repeat(20), data: claim.data }), false);
  assert.equal(ok({ to: FEST, data: token.encodeFunctionData("transferFrom", [ESCROW, ESCROW, 1n]) }), false);
  assert.equal(ok(fund, approve()), false);
  assert.equal(ok(approve(), fund, claim), false);
  assert.equal(ok(approve(), { ...fund, sender: "qor1" + "z".repeat(38) }), false);
  assert.equal(allowedCalls(msgs(claim), {}), false);
});

test("the relay refuses a queued call or one carrying funds", () => {
  const writer = (asyncFlag) => {
    const base = crossVmMsg("qor1" + "q".repeat(38), ESCROW, claim.data);
    const extra = asyncFlag
      ? Buffer.from([56, 1])
      : Buffer.from([50, 12, 10, 4, 117, 113, 111, 114, 18, 4, 49, 48, 48, 48]);
    return { typeUrl: base.typeUrl, value: Buffer.concat([Buffer.from(base.value), extra]) };
  };
  assert.equal(decodeCrossVm(writer(true).value).async, true);
  assert.equal(decodeCrossVm(writer(false).value).funds, 1);
  assert.equal(allowedCalls([writer(true)], { escrow: ESCROW, token: FEST }), false);
  assert.equal(allowedCalls([writer(false)], { escrow: ESCROW, token: FEST }), false);
});

test("a disallowed cross-VM transaction never reaches Diana", async () => {
  const wallet = Wallet.createRandom();
  const keys = nativeKeys(wallet);
  const { signedCalls } = await import("../web/native.js");
  const tx = signedCalls(keys, { sequence: "0", account_number: "1" }, [crossVmMsg(keys.account, "0x" + "33".repeat(20), claim.data)], 400000n);
  await assert.rejects(
    nativeRequest("broadcast", undefined, { raw: encodeBase64(tx.txBytes) }, "POST", { escrow: ESCROW, token: FEST }),
    /Unsupported/,
  );
});

// Fee swap: ERC-20 fUSD back to the bank coin, then into QOR in pool 2, in one
// hybrid transaction. The relay accepts only that pair, small and with a limit.
import { convertErc20Msg, swapMsg, FEE_POOL } from "../web/native.js";
import { allowedSwap, MAX_SWAP } from "../server/native.mjs";
import { BinaryWriter } from "cosmjs-types/binary.js";
import { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin.js";

test("the fee swap is a conversion and a pool-2 swap of the same small amount, with a minimum", () => {
  const me = nativeKeys(Wallet.createRandom()).account,
    other = nativeKeys(Wallet.createRandom()).account;
  const pair = (amount, minOut, who = me, token = FEST) => [convertErc20Msg(who, token, amount), swapMsg(who, FEST, amount, minOut)];
  const ok = (messages) => allowedSwap(messages, { token: FEST });
  assert.equal(FEE_POOL, 2n);
  assert.equal(ok(pair(10000n, 980000n)), true);
  assert.equal(ok(pair(BigInt(MAX_SWAP), 1n)), true);
  assert.equal(ok(pair(BigInt(MAX_SWAP) + 1n, 1n)), false, "larger than 0.1 fUSD");
  assert.equal(ok(pair(10000n, 0n)), false, "no price limit");
  assert.equal(ok(pair(10000n, 1n, me, "0x" + "11".repeat(20))), false, "another token");
  assert.equal(ok([convertErc20Msg(me, FEST, 10000n), swapMsg(other, FEST, 10000n, 1n)]), false, "two accounts");
  assert.equal(ok([convertErc20Msg(me, FEST, 10000n), swapMsg(me, FEST, 20000n, 1n)]), false, "amounts differ");
  assert.equal(ok([swapMsg(me, FEST, 10000n, 1n), convertErc20Msg(me, FEST, 10000n)]), false, "reversed");
  assert.equal(ok([swapMsg(me, FEST, 10000n, 1n)]), false, "swap alone");
  assert.equal(allowedSwap(pair(10000n, 1n), {}), false, "no token configured");
  // Another pool, built by hand, is refused.
  const coin = Coin.encode({ denom: "erc20:" + FEST, amount: "10000" }).finish();
  const pool3 = {
    typeUrl: "/qorechain.amm.v1.MsgSwapExactIn",
    value: BinaryWriter.create().uint32(10).string(me).uint32(16).uint64(3n).uint32(26).bytes(coin).uint32(34).string("uqor").uint32(42).string("1").finish(),
  };
  assert.equal(ok([convertErc20Msg(me, FEST, 10000n), pool3]), false, "another pool");
});

// The encryption key may ride only in a claim or a deposit, from the same account.
import { buildRegisterKemKeyMessage } from "@qorechain/qoreseal";
test("an ML-KEM-1024 registration may precede a claim or a deposit, and nothing else", () => {
  const me = nativeKeys(Wallet.createRandom()).account,
    other = nativeKeys(Wallet.createRandom()).account;
  const kem = (who = me, key = new Uint8Array(1568).fill(7)) => buildRegisterKemKeyMessage({ sender: who, mlkemPublicKey: key });
  const x = (c) => crossVmMsg(me, c.to, c.data);
  const ok = (messages) => allowedCalls(messages, { escrow: ESCROW, token: FEST });
  assert.equal(ok([kem(), x(claim)]), true);
  assert.equal(ok([kem(), x(approve()), x(fund)]), true);
  assert.equal(ok([kem(), x(fund)]), true);
  assert.equal(ok([kem(other), x(claim)]), false, "another account's key");
  const short = {
    typeUrl: "/qorechain.pqc.v1.MsgRegisterKEMKey",
    value: BinaryWriter.create().uint32(10).string(me).uint32(16).uint32(2).uint32(26).bytes(new Uint8Array(32)).finish(),
  };
  assert.equal(ok([short, x(claim)]), false, "wrong key length");
  assert.equal(ok([kem(), x({ to: ESCROW, data: escrow.encodeFunctionData("refund", [ID]) })]), false, "with a refund");
  assert.equal(ok([kem(), x({ to: FEST, data: token.encodeFunctionData("transfer", [ESCROW, 1n]) })]), false, "with a transfer");
  assert.equal(ok([kem()]), false, "alone");
  assert.equal(ok([x(claim), kem()]), false, "after the call");
});
