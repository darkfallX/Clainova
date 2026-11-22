import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { getBytes, Wallet } from "ethers";
import { openStore } from "../server/store.mjs";
import { service } from "../server/service.mjs";
import { authority } from "../server/network.mjs";
import { paymentInput } from "../server/common.mjs";
import { nativeKeys, signedNative } from "../web/native.js";
import { verifyHybridTx } from "@qorechain/qoresign";
import { decodeEvmWindowMsg } from "@qorechain/wallet-adapter";
import { TxBody } from "cosmjs-types/cosmos/tx/v1beta1/tx.js";
function fixture(live = null) {
  let time = 1780000000;
  const store = openStore(":memory:", randomBytes(32)),
    signer = authority(randomBytes(32));
  const app = service({
    store,
    authority: signer,
    live,
    config: { origin: "https://example.org" },
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
  const { localCode } = await app.code(link);
  await assert.rejects(app.code(link));
  for (let i = 0; i < 5; i++) await assert.rejects(app.verify(link, "bad"));
  await assert.rejects(app.verify(link, localCode));
  tick(31);
  const second = await app.code(link);
  tick(301);
  await assert.rejects(app.verify(link, second.localCode));
  const third = await app.code(link);
  await app.verify(link, third.localCode);
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
