// Creates the public bait wallets for /try/steal.
//   SPONSOR_MNEMONIC="…" node scripts/bait-setup.mjs 3
// Each wallet registers its ML-DSA-87 key with proof of possession, converts
// 1 test fUSD to the ERC-20 and keeps some test QOR. Its recovery phrase lives
// only in this process: it is never printed or saved. After setup nobody holds
// the post-quantum key, so the published secp256k1 key is the only key left.
import fs from "node:fs";
import { HDNodeWallet, encodeBase64 } from "ethers";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx.js";
import { nativeKeys, signedNative, convertFusd } from "../web/native.js";
import { broadcast, chainRead } from "../server/native.mjs";
import { FEST } from "../server/common.mjs";

const count = Number(process.argv[2] || 3);
const { SPONSOR_MNEMONIC } = process.env;
if (!SPONSOR_MNEMONIC || !(count >= 1 && count <= 5))
  throw Error("Set SPONSOR_MNEMONIC and create 1 to 5 wallets.");
const sponsor = nativeKeys(HDNodeWallet.fromPhrase(SPONSOR_MNEMONIC));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function send(keys, build, what) {
  let info;
  for (let i = 0; i < 20 && !(info = (await chainRead("account", keys.account)).info); i++)
    await pause(1500);
  const res = await broadcast(encodeBase64(build(info).txBytes));
  const r = res.tx_response;
  if (Number(r?.code) !== 0) throw Error(what + " refused: " + r?.raw_log);
  for (let i = 0; i < 40; i++) {
    await pause(1500);
    const { tx_response: done } = await chainRead("receipt", r.txhash);
    if (done) {
      if (Number(done.code) !== 0) throw Error(what + " failed: " + done.raw_log);
      return done.txhash;
    }
  }
  throw Error(what + " unconfirmed: " + r.txhash);
}

const wallets = [];
for (let n = 0; n < count; n++) {
  const wallet = HDNodeWallet.createRandom();
  const keys = nativeKeys(wallet);
  const grant = {
    typeUrl: "/cosmos.bank.v1beta1.MsgSend",
    value: MsgSend.encode(
      MsgSend.fromPartial({
        fromAddress: sponsor.account,
        toAddress: keys.account,
        amount: [
          { denom: "erc20:" + FEST, amount: "1000000" },
          { denom: "uqor", amount: "400000" },
        ],
      }),
    ).finish(),
  };
  const funded = await send(sponsor, (info) => signedNative(sponsor, info, null, grant), "grant");
  const registered = await send(keys, (info) => signedNative(keys, info, null), "registration");
  const converted = await send(
    keys,
    (info) => signedNative(keys, info, null, convertFusd(keys.account, wallet.address, FEST, 1000000n)),
    "conversion",
  );
  wallets.push({
    address: wallet.address,
    account: keys.account,
    secp256k1PrivateKey: wallet.privateKey,
    setup: { funded, registered, converted },
  });
  console.log("bait", n + 1, wallet.address, keys.account);
}
fs.writeFileSync(
  "server/bait-wallets.json",
  JSON.stringify(
    {
      created: new Date().toISOString(),
      network: "qorechain-diana",
      note: "Public test wallets. Each holds 1 test fUSD and some test QOR under a registered ML-DSA-87 key whose recovery phrase was never stored. Their secp256k1 private keys are published on purpose.",
      wallets,
    },
    null,
    2,
  ) + "\n",
);
console.log("Wrote server/bait-wallets.json");
