import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes, randomUUID } from "node:crypto";
import { Wallet } from "ethers";
import { BinaryReader } from "cosmjs-types/binary.js";
import { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin.js";
import { verifyProofOfPossession, verifyHybridTx } from "@qorechain/qoresign";
import { TxBody } from "cosmjs-types/cosmos/tx/v1beta1/tx.js";
import { openStore } from "../server/store.mjs";
import { service } from "../server/service.mjs";
import { authority } from "../server/network.mjs";
import { FEST } from "../server/common.mjs";
import { nativeKeys, signedNative, convertFusd } from "../web/native.js";

test("a restarted service preserves the private invitation, verification limits and balance", async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "clainova-storage-"));
  const file = path.join(folder, "data.sqlite"),
    key = randomBytes(32),
    signer = authority(randomBytes(32));
  let store = openStore(file, key);
  const app = () =>
    service({ store, authority: signer, config: {}, clock: () => 1800000000 });
  try {
    const request = {
      requestKey: randomUUID(),
      phone: "+233241234567",
      amount: "10",
      note: "Community",
      seconds: 86400,
    };
    const row = await app().create("organiser", request);
    const { localCode } = await app().code(row.link);
    store.db.close();
    store = openStore(file, key);
    assert.equal((await app().list("organiser")).balance, 990e6);
    assert.equal((await app().open(row.link)).id, row.id);
    await assert.rejects(app().code(row.link));
    assert.ok((await app().verify(row.link, localCode)).token);
    assert.equal((await app().create("organiser", request)).id, row.id);
  } finally {
    store.db.close();
    if (
      path.dirname(folder) === os.tmpdir() &&
      path.basename(folder).startsWith("clainova-storage-")
    )
      fs.rmSync(folder, { recursive: true, force: true });
  }
});

test("registration proof verifies for this account and conversion specifies the exact bank denomination and recipient", () => {
  const wallet = Wallet.createRandom(),
    keys = nativeKeys(wallet),
    info = { account_number: "9", sequence: "0" };
  const registration = signedNative(keys, info, null),
    raw = TxBody.decode(registration.bodyBytes).messages[0].value;
  const registrationReader = new BinaryReader(raw);
  let proof;
  while (registrationReader.pos < registrationReader.len) {
    const tag = registrationReader.uint32();
    if (tag === 50) proof = registrationReader.bytes();
    else registrationReader.skipType(tag & 7);
  }
  assert.ok(
    verifyProofOfPossession({
      chainId: "qorechain-diana",
      account: keys.account,
      publicKey: keys.pqKey.publicKey,
      proof,
    }),
  );
  const msg = convertFusd(keys.account, wallet.address, FEST, 1234567n);
  const reader = new BinaryReader(msg.value);
  assert.equal(reader.uint32(), 10);
  assert.deepEqual(Coin.decode(reader.bytes()), {
    denom: "erc20:" + FEST,
    amount: "1234567",
  });
  assert.equal(reader.uint32(), 18);
  assert.equal(reader.string(), wallet.address);
  assert.equal(reader.uint32(), 26);
  assert.equal(reader.string(), keys.account);
  assert.equal(reader.pos, reader.len);
  const conversion = signedNative(keys, info, null, msg);
  assert.ok(
    verifyHybridTx({
      txBytes: conversion.txBytes,
      chainId: "qorechain-diana",
      accountNumber: 9,
      classicalPublicKey: keys.classicalKey.publicKey,
      classicalKeyType: "eth_secp256k1",
      pqPublicKey: keys.pqKey.publicKey,
    }).valid,
  );
});
