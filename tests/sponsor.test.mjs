import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { HDNodeWallet, Wallet, encodeBase64, parseEther } from "ethers";
import { TxBody, TxRaw, AuthInfo } from "cosmjs-types/cosmos/tx/v1beta1/tx.js";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx.js";
import { verifyHybridTx } from "@qorechain/qoresign";
import { openStore } from "../server/store.mjs";
import {
  createSponsor,
  hashOf,
  senderId,
  DAILY,
  GRANT,
  SENDER_DAILY,
  SENDER_FUSD,
} from "../server/sponsor.mjs";
import { FEST } from "../server/common.mjs";
import { smsChannel } from "../server/sms.mjs";
import { nativeKeys, qorAddress } from "../web/native.js";

// Fake Diana: accepts a transaction only when its sequence is the next one.
function fixture({ registered = true, balance = 0n } = {}) {
  const wallet = HDNodeWallet.createRandom(),
    keys = nativeKeys(wallet),
    store = openStore(":memory:", randomBytes(32));
  const chain = { sequence: 4, landed: new Map(), sent: [], mode: "land", registered, balance, reserve: parseEther("100") };
  const net = {
    async read(action, value) {
      if (action === "account")
        return { info: { sequence: String(chain.sequence), account_number: "7" } };
      if (action === "key")
        return chain.registered
          ? { found: true, account: { possession_proven: true, public_key: encodeBase64(keys.pqKey.publicKey) } }
          : { found: false };
      const code = chain.landed.get(value);
      return code === undefined ? { pending: true } : { tx_response: { code } };
    },
    async broadcast(raw) {
      if (chain.mode === "crash") throw Error("connection lost");
      if (chain.mode === "refuse") return { tx_response: { code: 5 } };
      const tx = TxRaw.decode(Buffer.from(raw, "base64"));
      const sequence = Number(AuthInfo.decode(tx.authInfoBytes).signerInfos[0].sequence);
      if (sequence !== chain.sequence) return { tx_response: { code: 32 } };
      const message = TxBody.decode(tx.bodyBytes).messages[0];
      chain.sent.push({ raw, message });
      if (message.typeUrl.endsWith("RegisterPQCKeyV2")) chain.registered = true;
      if (chain.mode !== "mempool") {
        chain.sequence++;
        chain.landed.set(hashOf(raw), chain.mode === "fail" ? 11 : 0);
      }
      return { tx_response: { code: 0 } };
    },
  };
  let time = 1800000000;
  const start = () =>
    createSponsor({
      mnemonic: wallet.mnemonic.phrase,
      store,
      balance: async (who) =>
        who === wallet.address ? chain.reserve : chain.balance,
      net,
      wait: async () => {},
      clock: () => time,
    });
  return { chain, keys, store, start, tick: (n) => (time += n) };
}
const someone = () => Wallet.createRandom().address;

test("the sponsor sends one hybrid-signed native grant and repeats return the same payment", async () => {
  const { chain, keys, start } = fixture();
  const sponsor = await start(),
    to = someone();
  const first = await sponsor.pay("invite", to);
  assert.equal(first.status, "funded");
  assert.deepEqual(await sponsor.pay("invite", to), first);
  assert.equal(chain.sent.length, 1);
  const { message, raw } = chain.sent[0];
  assert.equal(message.typeUrl, "/cosmos.bank.v1beta1.MsgSend");
  const sent = MsgSend.decode(message.value);
  assert.equal(sent.toAddress, qorAddress(to));
  assert.deepEqual(sent.amount, [{ denom: "uqor", amount: String(GRANT) }]);
  assert.equal(
    verifyHybridTx({
      txBytes: Buffer.from(raw, "base64"),
      chainId: "qorechain-diana",
      accountNumber: 7,
      classicalPublicKey: keys.classicalKey.publicKey,
      classicalKeyType: "eth_secp256k1",
      pqPublicKey: keys.pqKey.publicKey,
    }).valid,
    true,
  );
});

test("a sponsor without a registered key registers it before paying", async () => {
  const { chain, start } = fixture({ registered: false });
  const sponsor = await start();
  await sponsor.pay("invite", someone());
  assert.deepEqual(
    chain.sent.map((x) => x.message.typeUrl),
    ["/qorechain.pqc.v1.MsgRegisterPQCKeyV2", "/cosmos.bank.v1beta1.MsgSend"],
  );
});

test("a lost broadcast resumes with the same bytes and pays once", async () => {
  const { chain, store, start } = fixture();
  const to = someone();
  chain.mode = "crash";
  await assert.rejects((await start()).pay("invite", to));
  const saved = store.db.prepare("SELECT raw FROM sponsor").get().raw;
  chain.mode = "land";
  // A new process resumes from the saved bytes.
  await (await start()).pay("invite", to);
  assert.deepEqual(chain.sent.map((x) => x.raw), [saved]);
});

test("a payment that landed before a crash is recognised, not repeated", async () => {
  const { chain, start } = fixture();
  const to = someone(),
    sponsor = await start();
  chain.mode = "mempool";
  await assert.rejects(sponsor.pay("invite", to), /still confirming/);
  chain.landed.set(hashOf(chain.sent[0].raw), 0);
  chain.sequence++;
  chain.mode = "land";
  assert.equal((await sponsor.pay("invite", to)).status, "funded");
  assert.equal(chain.sent.length, 1);
});

test("a stale sequence is replaced instead of blocking the recipient", async () => {
  const { chain, start } = fixture();
  const to = someone(),
    sponsor = await start();
  chain.mode = "crash";
  await assert.rejects(sponsor.pay("invite", to));
  chain.mode = "land";
  chain.sequence += 3;
  assert.equal((await sponsor.pay("invite", to)).status, "funded");
  assert.equal(chain.sent.length, 1);
});

test("a failed grant can be tried again", async () => {
  const { chain, start } = fixture();
  const to = someone(),
    sponsor = await start();
  chain.mode = "fail";
  await assert.rejects(sponsor.pay("invite", to), /failed on Diana/);
  chain.mode = "land";
  assert.equal((await sponsor.pay("invite", to)).status, "funded");
});

test("grants are limited per invitation, per wallet, per balance and per day", async () => {
  const { chain, start, tick } = fixture();
  const sponsor = await start(),
    to = someone();
  await sponsor.pay("invite", to);
  await assert.rejects(sponsor.pay("invite", someone()), /already has a gas recipient/);
  await assert.rejects(sponsor.pay("another", to), /already received/);
  chain.balance = parseEther("0.2");
  assert.deepEqual(await sponsor.pay("funded", someone()), { status: "sufficient" });
  chain.balance = 0n;
  for (let i = 1; i < DAILY; i++) await sponsor.pay("i" + i, someone());
  await assert.rejects(sponsor.pay("over", someone()), /budget used/);
  tick(86401);
  assert.equal((await sponsor.pay("over", someone())).status, "funded");
});

test("a demo sender gets test fUSD and gas once, from its own daily allowance", async () => {
  const { chain, start } = fixture();
  const sponsor = await start(),
    to = someone();
  const first = await sponsor.pay(senderId("v1"), to);
  assert.deepEqual(await sponsor.pay(senderId("v1"), to), first);
  assert.equal(chain.sent.length, 1);
  assert.deepEqual(MsgSend.decode(chain.sent[0].message.value).amount, [
    { denom: "erc20:" + FEST, amount: String(SENDER_FUSD) },
    { denom: "uqor", amount: String(GRANT) },
  ]);
  // The same visitor cannot fund a second wallet, nor a second visitor this one.
  await assert.rejects(sponsor.pay(senderId("v1"), someone()), /already has/);
  await assert.rejects(sponsor.pay(senderId("v2"), to), /already received/);
  for (let i = 1; i < SENDER_DAILY; i++)
    await sponsor.pay(senderId("n" + i), someone());
  await assert.rejects(sponsor.pay(senderId("over"), someone()), /used up/);
  // Senders using up their allowance leaves the recipients' one untouched.
  for (let i = 0; i < DAILY; i++)
    assert.equal((await sponsor.pay("r" + i, someone())).status, "funded");
  await assert.rejects(sponsor.pay("r-over", someone()), /budget used/);
});

test("an empty sponsor or an unreachable chain never stops the server or burns the grant", async () => {
  const { chain, store, start } = fixture();
  const to = someone();
  chain.reserve = parseEther("0.1");
  const sponsor = start();
  await assert.rejects(sponsor.pay("invite", to), /sponsor is empty/);
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM sponsor").get().n, 0);
  chain.reserve = parseEther("1");
  assert.equal((await sponsor.pay("invite", to)).status, "funded");
});

test("concurrent grants use consecutive sequences", async () => {
  const { chain, start } = fixture();
  const sponsor = await start();
  const results = await Promise.all(
    ["a", "b", "c"].map((id) => sponsor.pay(id, someone())),
  );
  assert.ok(results.every((r) => r.status === "funded"));
  assert.equal(chain.sent.length, 3);
});

test("the test outbox is refused for field trials and stays private to the server", async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "clainova-outbox-"));
  try {
    assert.throws(() => smsChannel({ SMS_PROVIDER: "outbox", COHORT: "field" }, folder));
    assert.throws(() => smsChannel({ SMS_PROVIDER: "pigeon" }, folder));
    assert.throws(() => smsChannel({}, folder), /AT_USERNAME/);
    const sms = smsChannel({ SMS_PROVIDER: "outbox", COHORT: "team" }, folder);
    await sms.send("+2348012345678", "hello");
    const line = JSON.parse(fs.readFileSync(path.join(folder, "outbox.jsonl"), "utf8"));
    assert.equal(line.message, "hello");
    assert.match(sms.accepted, /test outbox/);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
