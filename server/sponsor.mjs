import { HDNodeWallet, encodeBase64, parseEther, sha256 } from "ethers";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx.js";
import { AuthInfo, TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx.js";
import { nativeKeys, qorAddress, signedNative } from "../web/native.js";
import { broadcast, chainRead } from "./native.mjs";
import { now, requireThat } from "./common.mjs";

// One grant pays for key registration, the collection window, the claim, a
// spending window and a first transfer. GRANT is in uqor (0.3 test QOR).
export const GRANT = 300000n;
export const ENOUGH = parseEther("0.2");
export const DAILY = 20;
// A grant plus its own network fee.
const RESERVE = parseEther("0.34");

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const hashOf = (raw) =>
  sha256(Buffer.from(raw, "base64")).slice(2).toUpperCase();
const sequenceOf = (raw) =>
  Number(
    AuthInfo.decode(TxRaw.decode(Buffer.from(raw, "base64")).authInfoBytes)
      .signerInfos[0].sequence,
  );
export const sendMessage = (from, to) => ({
  typeUrl: "/cosmos.bank.v1beta1.MsgSend",
  value: MsgSend.encode(
    MsgSend.fromPartial({
      fromAddress: from,
      toAddress: to,
      amount: [{ denom: "uqor", amount: String(GRANT) }],
    }),
  ).finish(),
});

// Pays gas with a native transfer that carries an ML-DSA-87 signature, so the
// sponsor account never needs an open EVM window.
export function createSponsor({
  mnemonic,
  store,
  balance,
  net = { broadcast, read: chainRead },
  wait = pause,
  clock = now,
}) {
  const wallet = HDNodeWallet.fromPhrase(mnemonic);
  const keys = nativeKeys(wallet);
  const account = async () => (await net.read("account", keys.account)).info;

  async function settled(hash, attempts) {
    for (let i = 0; i < attempts; i++) {
      const { tx_response: r } = await net.read("receipt", hash);
      if (r) return Number(r.code) === 0 ? "confirmed" : "failed";
      if (i + 1 < attempts) await wait(1000);
    }
    return "unknown";
  }
  async function submit(raw) {
    const { tx_response: r } = await net.broadcast(raw);
    // Code 19 means the same bytes are already waiting in the mempool.
    requireThat(
      [0, 19].includes(Number(r?.code)),
      "Diana refused the gas top-up. Try again shortly.",
      502,
    );
  }
  // Checked on first use, so a sponsor problem never stops the server. Registers
  // the sponsor's post-quantum key if the account does not have one yet.
  let checked = false;
  async function ready() {
    if (checked) return;
    const key = await net.read("key", keys.account);
    if (key.found) {
      requireThat(
        key.account?.possession_proven &&
          key.account.public_key === encodeBase64(keys.pqKey.publicKey),
        "The sponsor's registered key does not match its mnemonic.",
        500,
      );
      checked = true;
      return;
    }
    const raw = encodeBase64(
      signedNative(keys, await account(), null).txBytes,
    );
    await submit(raw);
    requireThat(
      (await settled(hashOf(raw), 30)) === "confirmed",
      "Sponsor key registration did not confirm.",
      502,
    );
    checked = true;
  }

  async function payGas(id, destination) {
    await ready();
    const prior = store.db.prepare("SELECT * FROM sponsor WHERE id=?").get(id);
    requireThat(
      !prior || prior.wallet === destination,
      "This invitation already has a gas recipient.",
      409,
    );
    if (prior) {
      const hash = hashOf(prior.raw);
      let outcome = await settled(hash, 1);
      if (outcome === "unknown") {
        // While the account has not moved past the signed sequence, the
        // original bytes can still land: send those and nothing else.
        if (Number((await account()).sequence) <= sequenceOf(prior.raw)) {
          await submit(prior.raw);
          outcome = await settled(hash, 20);
          requireThat(
            outcome !== "unknown",
            "The gas top-up is still confirming. Try again shortly.",
            409,
          );
        } else outcome = await settled(hash, 10);
      }
      if (outcome === "confirmed") return { status: "funded", hash };
      // The saved bytes failed, or another transaction used their sequence.
      // They can never land, so a replacement cannot pay twice.
    } else {
      if ((await balance(destination)) >= ENOUGH)
        return { status: "sufficient" };
      requireThat(
        !store.db
          .prepare("SELECT 1 FROM sponsor WHERE wallet=?")
          .get(destination),
        "This wallet already received a top-up.",
        409,
      );
      const used = store.db
        .prepare("SELECT count(*) AS n FROM sponsor WHERE created>?")
        .get(clock() - 86400).n;
      requireThat(
        used < DAILY,
        "Daily sponsor budget used. Use the festival faucet.",
        429,
      );
      // Nothing is saved for a grant the sponsor could not afford.
      requireThat(
        (await balance(wallet.address)) >= RESERVE,
        "The gas sponsor is empty. Ask the organiser to refill it, then retry.",
        503,
      );
    }
    const raw = encodeBase64(
      signedNative(
        keys,
        await account(),
        null,
        sendMessage(keys.account, qorAddress(destination)),
      ).txBytes,
    );
    // Saved before broadcast, so a crash between the two can be resumed.
    store.db
      .prepare(
        "INSERT INTO sponsor VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET raw=excluded.raw",
      )
      .run(id, destination, raw, clock());
    await submit(raw);
    const hash = hashOf(raw);
    const outcome = await settled(hash, 20);
    requireThat(
      outcome === "confirmed",
      outcome === "failed"
        ? "The gas top-up failed on Diana. Try again."
        : "The gas top-up is still confirming. Try again shortly.",
      outcome === "failed" ? 502 : 409,
    );
    return { status: "funded", hash };
  }

  // One job at a time keeps sequence numbers in order within this process.
  let queue = Promise.resolve();
  return {
    account: keys.account,
    address: wallet.address,
    pay(id, destination) {
      const job = queue.then(() => payGas(id, destination));
      queue = job.catch(() => {});
      return job;
    },
  };
}
