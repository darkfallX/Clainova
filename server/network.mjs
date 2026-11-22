import { observeWallet, readEvidence } from "./evidence.mjs";
import fs from "node:fs";
import {
  Contract,
  JsonRpcProvider,
  Wallet,
  getBytes,
  hexlify,
  keccak256,
  parseEther,
} from "ethers";
import { mldsa87 } from "@qorechain/pqc";
import africastalking from "africastalking";
import { FEST, now, requireThat } from "./common.mjs";
export const TEST_RPC = "https://evm-testnet.qore.host";
export function authority(seed) {
  const pair = mldsa87.keygen(seed);
  return {
    publicKey: hexlify(pair.publicKey),
    sign: (payload) => hexlify(mldsa87.sign(pair.secretKey, getBytes(payload))),
    verify: (payload, sig) =>
      mldsa87.verify(pair.publicKey, getBytes(payload), getBytes(sig)),
  };
}
export async function liveAdapters(env, signer, store) {
  const rpc = new JsonRpcProvider(env.RPC_URL || TEST_RPC);
  requireThat(
    (await rpc.getNetwork()).chainId === 9800n,
    "Set the Diana testnet RPC.",
  );
  const { abi } = JSON.parse(fs.readFileSync("dist/contract.json"));
  const escrow = new Contract(env.ESCROW_ADDRESS, abi, rpc);
  requireThat(
    (await escrow.token()).toLowerCase() === FEST.toLowerCase() &&
      (await escrow.verifierKey()) === signer.publicKey,
    "Escrow asset or verifier key mismatch.",
  );
  const sms = africastalking({
    apiKey: env.AT_API_KEY,
    username: env.AT_USERNAME,
  }).SMS;
  const funder = env.SPONSOR_PRIVATE_KEY
    ? new Wallet(env.SPONSOR_PRIVATE_KEY, rpc)
    : null;
  // Serialise nonce allocation for this dedicated sponsor in the single server process.
  let queue = Promise.resolve();
  async function payGas(id, destination) {
    requireThat(funder, "Use the festival faucet for test QOR.", 409);
    const prior = store.db.prepare("SELECT * FROM sponsor WHERE id=?").get(id);
    requireThat(
      !prior || prior.wallet === destination,
      "This invitation already has a gas recipient.",
      409,
    );
    let raw = prior?.raw;
    if (!raw) {
      requireThat(
        !store.db
          .prepare("SELECT 1 FROM sponsor WHERE wallet=?")
          .get(destination),
        "This wallet already received a top-up.",
        409,
      );
      const used = store.db
        .prepare("SELECT count(*) AS n FROM sponsor WHERE created>?")
        .get(now() - 86400).n;
      requireThat(
        used < 20,
        "Daily sponsor budget used. Use the festival faucet.",
        429,
      );
      requireThat(
        (await rpc.getBalance(destination)) < parseEther("0.12"),
        "This wallet already has test QOR.",
        409,
      );
      const tx = await funder.populateTransaction({
        to: destination,
        value: parseEther("0.3"),
      });
      raw = await funder.signTransaction(tx);
      store.db
        .prepare("INSERT INTO sponsor VALUES(?,?,?,?)")
        .run(id, destination, raw, now());
    }
    const hash = keccak256(raw);
    if (!(await rpc.getTransaction(hash))) await rpc.broadcastTransaction(raw);
    return { hash };
  }
  return {
    rpc,
    escrow,
    observeWallet,
    evidence: (row, kind, hash) => readEvidence(rpc, escrow, row, kind, hash),
    sponsored: Boolean(funder),
    sponsor: (id, dest) => {
      const job = queue.then(() => payGas(id, dest));
      queue = job.catch(() => {});
      return job;
    },
    send: async (to, message) => {
      const result = await sms.send({
        to: [to],
        message,
        ...(env.AT_FROM ? { from: env.AT_FROM } : {}),
      });
      requireThat(
        result.SMSMessageData?.Recipients?.some(
          (r) => r.status === "Success" && r.number === to,
        ),
        "SMS provider did not accept the message.",
        502,
      );
    },
    read: async (id) => {
      const p = await escrow.payments(id);
      return {
        state: ["draft", "funded", "collected", "refunded"][Number(p.state)],
        amount: Number(p.amount),
        expiry: Number(p.expiry),
        sender: p.sender,
        destination: p.recipient,
      };
    },
  };
}
