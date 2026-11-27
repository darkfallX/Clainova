import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { getBytes, Wallet } from "ethers";
import { openStore } from "../server/store.mjs";
import { service, invitationText } from "../server/service.mjs";
import { authority } from "../server/network.mjs";
import { paymentInput } from "../server/common.mjs";
import { nativeKeys, signedNative } from "../web/native.js";
import { verifyHybridTx } from "@qorechain/qoresign";
import { decodeEvmWindowMsg } from "@qorechain/wallet-adapter";
import { TxBody } from "cosmjs-types/cosmos/tx/v1beta1/tx.js";
function fixture(live = null, options = {}) {
  let time = 1780000000;
  const store = openStore(":memory:", randomBytes(32)),
    signer = authority(randomBytes(32));
  const app = service({
    store,
    authority: signer,
    live,
    config: { origin: "https://example.org", ...options },
    clock: () => time,
  });
  const body = {
    phone: "+2348012345678",
    note: "Speaker",
    amount: "20.000001",
    seconds: 60,
    requestKey: randomUUID(),
  };
  return { store, app, body, tick: (n) => (time += n) };
}
test("validates countries, amounts and notes", () => {
  for (const phone of [
    "+2348012345678",
    "+254712345678",
    "+233241234567",
    "+27821234567",
  ])
    assert.equal(
      paymentInput({ phone, amount: "0.000001", note: "" }).amount,
      1,
    );
  for (const amount of ["1e3", "-2", "1.0000001", "0", "10001"])
    assert.throws(() =>
      paymentInput({ phone: "+2348012345678", amount, note: "" }),
    );
  assert.throws(() =>
    paymentInput({ phone: "+10000000000", amount: "2", note: "" }),
  );
});
test("persists one invitation on retry and hides its private details", async () => {
  const { app, body, store } = fixture();
  const a = await app.create("a", body);
  assert.equal((await app.create("a", body)).id, a.id);
  assert.equal((await app.list("a")).balance, 979999999);
  assert.equal((await app.list("b")).rows.length, 0);
  assert.ok(!JSON.stringify(store.get(a.id)).includes(body.phone));
  await assert.rejects(app.open(a.id));
  await assert.rejects(app.refund("b", a.id));
});
test("codes expire, throttle resends, limit guesses and cannot be reused", async () => {
  const { app, body, tick } = fixture();
  const { link } = await app.create("a", { ...body, seconds: 86400 });
  const timing = async () => (await app.open(link)).verification;
  assert.deepEqual(await timing(), { requested: false, validFor: 0, retryIn: 0 });
  const { localCode } = await app.code(link);
  assert.deepEqual(await timing(), { requested: true, validFor: 300, retryIn: 30 });
  await assert.rejects(app.code(link));
  for (let i = 0; i < 5; i++) await assert.rejects(app.verify(link, "bad"));
  assert.equal((await timing()).validFor, 0);
  await assert.rejects(app.verify(link, localCode));
  tick(31);
  const second = await app.code(link);
  tick(301);
  assert.deepEqual(await timing(), { requested: true, validFor: 0, retryIn: 0 });
  await assert.rejects(app.verify(link, second.localCode));
  const third = await app.code(link);
  await app.verify(link, third.localCode);
  assert.equal((await timing()).validFor, 0);
  await assert.rejects(app.verify(link, third.localCode));
});
test("collects to bound wallet and preserves balance through a follow-on transfer", async () => {
  const { app, body } = fixture();
  const w = Wallet.createRandom(),
    other = Wallet.createRandom();
  const r = await app.create("a", body);
  const { token } = await app.verify(
    r.link,
    (await app.code(r.link)).localCode,
  );
  const a = await app.attest(r.link, token, w.address);
  await assert.rejects(app.attest(r.link, token, other.address));
  await assert.rejects(
    app.settle(r.link, {
      ...a,
      token,
      proof: await other.signMessage(getBytes(a.payload)),
    }),
  );
  const signed = {
    ...a,
    token,
    proof: await w.signMessage(getBytes(a.payload)),
  };
  await app.settle(r.link, signed);
  await assert.rejects(app.settle(r.link, signed));
  const transfer = {
    from: w.address,
    to: other.address,
    amount: 1000000,
    time: 1780000000,
    nonce: "a".repeat(32),
  };
  transfer.proof = await w.signMessage(
    [
      "Clainova rehearsal transfer",
      w.address,
      other.address,
      transfer.amount,
      transfer.time,
      transfer.nonce,
    ].join("|"),
  );
  app.transfer(transfer);
  assert.throws(() => app.transfer(transfer));
  assert.equal(app.localBalance(w.address), 19000001);
  assert.equal(app.localBalance(other.address), 1000000);
  assert.equal((await app.list("a")).returning, 1);
});
test("refunds exactly at expiry and preserves funds", async () => {
  const { app, body, tick } = fixture();
  const r = await app.create("a", body);
  await assert.rejects(app.refund("a", r.id));
  tick(60);
  await assert.rejects(app.code(r.link));
  await app.refund("a", r.id);
  await assert.rejects(app.refund("a", r.id));
  assert.equal((await app.list("a")).balance, 1000e6);
});
test("failed SMS can be retried without creating or funding a second deposit", async () => {
  let chain,
    fail = true;
  const { app, body } = fixture({
    read: async () => chain,
    send: async () => {
      if (fail) throw Error("provider down");
    },
  });
  const sender = Wallet.createRandom().address;
  const r = await app.create("a", { ...body, sender, seconds: 86400 });
  chain = { ...r, state: "funded" };
  await assert.rejects(app.deliver("a", r.id));
  assert.equal((await app.list("a")).rows[0].state, "funded");
  fail = false;
  assert.equal(
    (await app.deliver("a", r.id)).delivery,
    "accepted by SMS provider",
  );
});
test("new coin-60 wallet signs a registration and a target-limited hybrid window offline", () => {
  const w = Wallet.createRandom(),
    keys = nativeKeys(w),
    info = { account_number: "22", sequence: "0" },
    target = Wallet.createRandom().address;
  const reg = signedNative(keys, info, null),
    win = signedNative(keys, { ...info, sequence: "1" }, [target]);
  const msg = TxBody.decode(win.bodyBytes).messages[0];
  const scoped = decodeEvmWindowMsg(msg);
  assert.deepEqual(
    scoped.allowedTargets.map((x) => x.toLowerCase()),
    [target.toLowerCase()],
  );
  assert.equal(scoped.blocks, 120n);
  assert.equal(scoped.maxTxs, 1n);
  assert.equal(
    TxBody.decode(reg.bodyBytes).messages[0].typeUrl,
    "/qorechain.pqc.v1.MsgRegisterPQCKeyV2",
  );
  assert.equal(
    verifyHybridTx({
      txBytes: win.txBytes,
      chainId: "qorechain-diana",
      accountNumber: 22,
      classicalPublicKey: keys.classicalKey.publicKey,
      classicalKeyType: "eth_secp256k1",
      pqPublicKey: keys.pqKey.publicKey,
    }).valid,
    true,
  );
});
test("the invitation names the organiser, the amount and the reason", () => {
  const row = { amount: 20500000, note: "Workshop speaker fee", expiry: 1796123682 };
  assert.equal(
    invitationText(row, "Lagos Dev Meetup"),
    "Lagos Dev Meetup sent you 20.5 test fUSD for Workshop speaker fee. Collect with Clainova by 1 Dec: ",
  );
  assert.match(invitationText({ ...row, note: "" }, ""), /^An organiser sent you 20\.5 test fUSD\. /);
});
test("a collection the browser never reported gets its receipt, once a minute at most", async () => {
  let chain, searches = 0;
  const { app, body, store, tick } = fixture({
    read: async () => chain,
    send: async () => {},
    recover: async (row, kind) => {
      searches++;
      return searches < 2 ? null : { hash: "0xabc", kind, block: 9 };
    },
    evidence: async (row, kind) => {
      assert.equal(row.evidence.collection.hash, "0xabc");
      return { hash: "0xdef", block: 10 };
    },
  });
  const r = await app.create("a", { ...body, sender: Wallet.createRandom().address, seconds: 86400 });
  const destination = Wallet.createRandom().address;
  chain = { ...r, state: "collected", destination };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
  await app.list("a");
  await app.list("a");
  await settle();
  assert.equal(searches, 1);
  assert.equal(store.get(r.id).evidence, undefined);
  tick(61);
  // A spend needs the collection receipt, so it is looked up before checking.
  const link = r.id.slice(2) + "." + store.sign("invite:" + r.id);
  await app.recipientEvidence(link, "transfer", "0xdef");
  assert.equal(store.get(r.id).evidence.collection.hash, "0xabc");
  assert.equal(store.get(r.id).evidence.transfer.hash, "0xdef");
  tick(61);
  await app.list("a");
  await settle();
  assert.equal(searches, 2);
});
test("demo payments are opt-in, show their code, hold one per visitor and send no SMS", async () => {
  const chain = new Map();
  let sms = 0;
  const live = {
    read: async (id) => chain.get(id),
    send: async () => sms++,
  };
  const off = fixture(live);
  const request = {
    demo: true,
    amount: "1",
    note: "Demo",
    seconds: 2505600,
    sender: Wallet.createRandom().address,
  };
  await assert.rejects(off.app.create("organiser", { ...request, requestKey: randomUUID() }));
  await assert.rejects(off.app.take("v1"));
  const { app, store, tick } = fixture(live, { demo: true });
  async function fund() {
    const row = await app.create("organiser", { ...request, requestKey: randomUUID() });
    chain.set(row.id, { ...row, state: "funded" });
    await app.list("organiser");
    return row;
  }
  // A 29-day period is only for demo payments.
  await assert.rejects(
    app.create("organiser", { ...request, demo: false, phone: "+2348012345678", requestKey: randomUUID() }),
  );
  assert.equal(off.app.pool(), 0);
  assert.equal(app.pool(), 0);
  await assert.rejects(app.take("v1"), /No test payment is waiting/);
  await fund();
  await fund();
  assert.equal(app.pool(), 2);
  const { link } = await app.take("v1");
  assert.equal(app.pool(), 1);
  assert.equal((await app.take("v1")).link, link);
  const other = await app.take("v2");
  assert.notEqual(other.link, link);
  assert.equal(app.pool(), 0);
  await assert.rejects(app.take("v3"), /in use/);
  const { pageCode } = await app.code(link);
  assert.match(pageCode, /^\d{6}$/);
  const { token } = await app.verify(link, pageCode);
  assert.equal(sms, 0);
  const id = "0x" + link.slice(0, 64);
  assert.equal(store.get(id).phone, null);
  await assert.rejects(app.deliver("organiser", id), /not sent by SMS/);
  // A payment bound to a wallet is never handed to anyone else.
  await app.attest(link, token, Wallet.createRandom().address);
  tick(7201);
  assert.equal((await app.take("v3")).link, other.link);
  await assert.rejects(app.take("v4"), /in use/);
  assert.equal((await app.list("organiser")).returning, 0);
});
test("a visitor sends exactly one demo payment, resumes it, and cannot reach anyone else's", async () => {
  const chain = new Map(),
    grants = [];
  let sms = 0;
  const { app, store } = fixture(
    {
      read: async (id) => chain.get(id) || { state: "draft" },
      send: async () => sms++,
      sponsored: true,
      sponsor: async (...args) => grants.push(args),
      evidence: async () => ({ hash: "0xabc", block: 1 }),
    },
    { demo: true },
  );
  const sender = Wallet.createRandom().address;
  assert.deepEqual(await app.sent("v1"), { row: null });
  await app.fundSender("v1", sender);
  assert.deepEqual(grants, [["sender:v1", sender]]);
  await assert.rejects(app.fundSender("v1", "not an address"));
  const row = await app.send("v1", { sender, note: "x".repeat(200), amount: "9999", seconds: 1 });
  assert.equal(row.amount, 1000000);
  assert.equal(row.note.length, 80);
  assert.equal(row.mask, "Sample number");
  assert.equal(store.get(row.id).phone, null);
  // Asking again resumes the same payment, and only for the same wallet.
  assert.equal((await app.send("v1", { sender })).id, row.id);
  await assert.rejects(app.send("v1", { sender: Wallet.createRandom().address }), /started with/);
  chain.set(row.id, { ...row, state: "funded" });
  const { row: mine } = await app.sent("v1");
  assert.equal(mine.state, "funded");
  assert.match(mine.link, /^[0-9a-f]{64}\.[0-9a-f]{64}$/);
  assert.equal((await app.open(mine.link)).mask, "Code on this page");
  assert.equal((await app.open(mine.link)).link, undefined);
  // Other visitors and the organiser's own ledger and pool never include it.
  assert.deepEqual(await app.sent("v2"), { row: null });
  assert.equal((await app.list("organiser")).rows.length, 0);
  await assert.rejects(app.take("v2"), /No test payment is waiting/);
  await assert.rejects(app.operatorEvidence("visitor:v2", row.id, "funding", "0x1"), /unavailable/);
  assert.equal(sms, 0);
  // Without a sponsor there are no public sends.
  const off = fixture({ read: async () => ({ state: "draft" }) }, { demo: true });
  await assert.rejects(off.app.send("v1", { sender }), /off/);
});

// Sealed notes: the service keeps QoreSeal envelopes it cannot open, only for a
// collected payment, from its own two parties, five each.
test("sealed notes are stored as envelopes, only after collection and only by the two parties", async () => {
  const chain = new Map();
  const live = { read: async (id) => chain.get(id), send: async () => {} };
  const { app } = fixture(live, { demo: true });
  const row = await app.create("organiser", {
    demo: true,
    amount: "1",
    note: "Demo",
    seconds: 2505600,
    sender: Wallet.createRandom().address,
    requestKey: randomUUID(),
  });
  const envelope = "qoreseal:" + "A".repeat(200);
  chain.set(row.id, { ...row, state: "funded" });
  await app.list("organiser");
  await assert.rejects(app.operatorNote("organiser", row.id, envelope), /once the payment is collected/);
  chain.set(row.id, { ...row, state: "collected", destination: Wallet.createRandom().address });
  await app.list("organiser");
  await assert.rejects(app.operatorNote("organiser", row.id, "plain text the server could read"), /Invalid sealed note/);
  await assert.rejects(app.operatorNote("organiser", row.id, "qoreseal:" + "A".repeat(6000)), /Invalid sealed note/);
  await assert.rejects(app.operatorNote("someone else", row.id, envelope), /unavailable/);
  const { notes } = await app.operatorNote("organiser", row.id, envelope);
  assert.deepEqual(notes.map((n) => [n.from, n.envelope]), [["organiser", envelope]]);
  for (let i = 0; i < 4; i++) await app.operatorNote("organiser", row.id, envelope);
  await assert.rejects(app.operatorNote("organiser", row.id, envelope), /Five notes each/);
  // Both parties see the thread in their views.
  const [mine] = (await app.list("organiser")).rows;
  assert.equal(mine.notes.length, 5);
  const local = fixture();
  assert.throws(() => local.app.addNote({ state: "collected" }, "organiser", envelope), /Diana/);
});
