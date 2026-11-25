import { findEvidence, observeWallet, readEvidence } from "./evidence.mjs";
import fs from "node:fs";
import {
  Contract,
  JsonRpcProvider,
  getBytes,
  hexlify,
  formatEther,
} from "ethers";
import { mldsa87 } from "@qorechain/pqc";
import { FEST, requireThat } from "./common.mjs";
import { createSponsor } from "./sponsor.mjs";
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
// Public and unauthenticated, so repeated calls must not reach Diana.
function cached(ms, load) {
  let value, at = 0;
  return () => {
    if (Date.now() - at > ms) {
      at = Date.now();
      value = load();
      value.catch(() => (at = 0));
    }
    return value;
  };
}
export async function liveAdapters(env, signer, store, sms) {
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
  const sponsor = env.SPONSOR_MNEMONIC
    ? createSponsor({
        mnemonic: env.SPONSOR_MNEMONIC,
        store,
        balance: (wallet) => rpc.getBalance(wallet),
      })
    : null;
  return {
    rpc,
    escrow,
    observeWallet,
    evidence: (row, kind, hash) => readEvidence(rpc, escrow, row, kind, hash),
    recover: (row, kind) => findEvidence(rpc, escrow, row, kind),
    sponsored: Boolean(sponsor),
    sponsor: (id, dest) => sponsor.pay(id, dest),
    send: sms.send,
    accepted: sms.accepted,
    // Operational state only: no phone data, keys or invitation details.
    health: cached(10000, async () => ({
      block: await rpc.getBlockNumber(),
      escrow: await escrow.getAddress(),
      channel: sms.channel,
      sponsor: sponsor
        ? {
            account: sponsor.account,
            testQor: formatEther(await rpc.getBalance(sponsor.address)),
          }
        : null,
    })),
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
