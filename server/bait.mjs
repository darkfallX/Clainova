// "Try to steal it": public wallets whose secp256k1 keys are published. The
// service attacks them every hour, and on request, with that key alone, and
// records what Diana answers. Nothing here can succeed unless QoreChain's
// post-quantum rules fail; if one does, it is shown as "Accepted", not hidden.
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { Interface, JsonRpcProvider, Wallet, encodeBase64 } from "ethers";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx.js";
import { TxBody, AuthInfo } from "cosmjs-types/cosmos/tx/v1beta1/tx.js";
import { PubKey } from "cosmjs-types/cosmos/crypto/secp256k1/keys.js";
import {
  buildRegisterPqKeyMessage,
  classicalKeyFromPrivate,
  pqKeyFromSeed,
  signHybrid,
} from "@qorechain/qoresign";
import { chainId, crossVmMsg, qorAddress, signedNative } from "../web/native.js";
import { broadcast, chainRead } from "./native.mjs";
import { FEST } from "./common.mjs";
const TEST_RPC_URL = "https://evm-testnet.qore.host";

const erc20 = new Interface([
  "function transfer(address,uint256)",
  "function balanceOf(address) view returns(uint256)",
]);
const ATTACKS = [
  "Send its fUSD in an ordinary EVM transaction",
  "Open an EVM window with the classical signature only",
  "Open an EVM window with the attacker’s own ML-DSA-87 key",
  "Register a new ML-DSA-87 key to take the account over",
  "Send its QOR with the classical signature only",
  "Move its fUSD through cross-VM with the attacker’s ML-DSA-87 key",
];

function signed(keys, info, messages, gasLimit, mode) {
  const bodyBytes = TxBody.encode(TxBody.fromPartial({ messages })).finish();
  const authInfoBytes = AuthInfo.encode(
    AuthInfo.fromPartial({
      signerInfos: [
        {
          publicKey: {
            typeUrl: "/cosmos.evm.crypto.v1.ethsecp256k1.PubKey",
            value: PubKey.encode({ key: keys.classicalKey.publicKey }).finish(),
          },
          sequence: BigInt(info.sequence),
          modeInfo: { single: { mode: 1 } },
        },
      ],
      fee: { amount: [{ denom: "uqor", amount: String(gasLimit / 8n) }], gasLimit },
    }),
  ).finish();
  return signHybrid({
    chainId,
    accountNumber: BigInt(info.account_number),
    bodyBytes,
    authInfoBytes,
    classicalKey: keys.classicalKey,
    pqKey: keys.pqKey,
    mode,
    signBytesVersion: "v2",
  });
}
// The chain's own words, without the account address, trimmed to one line.
const reason = (text) =>
  String(text || "")
    .replace(/(account )?qor1[0-9a-z]{38}/g, "this account")
    .replace(/\s+/g, " ")
    .split(": ")
    .slice(0, 2)
    .join(": ")
    .slice(0, 180);

export function createBait({ file = "server/bait-wallets.json", rpcUrl = TEST_RPC_URL, net = { broadcast, read: chainRead }, clock = () => Math.floor(Date.now() / 1000) } = {}) {
  if (!fs.existsSync(file)) return null;
  const { wallets } = JSON.parse(fs.readFileSync(file, "utf8"));
  const rpc = new JsonRpcProvider(rpcUrl, 9800, { staticNetwork: true });
  const rounds = [];
  let running = null,
    turn = 0,
    cache = { at: 0, value: null };

  async function native(build) {
    const info = (await net.read("account", build.account)).info;
    const res = await net.broadcast(encodeBase64(build.tx(info).txBytes));
    const r = res.tx_response;
    if (Number(r?.code) !== 0) return { refused: true, reason: reason(r?.raw_log) };
    // Accepted at broadcast: wait for the result rather than guess.
    for (let i = 0; i < 20; i++) {
      await new Promise((ok) => setTimeout(ok, 1500));
      const { tx_response: d } = await net.read("receipt", r.txhash);
      if (d)
        return Number(d.code) !== 0
          ? { refused: true, reason: reason(d.raw_log) }
          : { refused: false, reason: "Accepted in " + d.txhash };
    }
    return { refused: false, reason: "Broadcast accepted, " + r.txhash };
  }

  async function attack(bait) {
    const classicalKey = classicalKeyFromPrivate(
      Buffer.from(bait.secp256k1PrivateKey.slice(2), "hex"),
      "eth_secp256k1",
    );
    // What a thief has: the published classical key and an ML-DSA key of their own.
    const thief = { account: bait.account, classicalKey, pqKey: pqKeyFromSeed(randomBytes(32)) };
    const victim = new Wallet(bait.secp256k1PrivateKey, rpc);
    const away = Wallet.createRandom().address;
    const steps = [
      async () => {
        const tx = await victim.populateTransaction({
          to: FEST,
          data: erc20.encodeFunctionData("transfer", [away, 100000n]),
          gasLimit: 120000n,
        });
        const raw = await victim.signTransaction(tx);
        try {
          const hash = await rpc.send("eth_sendRawTransaction", [raw]);
          return { refused: false, reason: "Accepted as " + hash };
        } catch (err) {
          return { refused: true, reason: reason(err?.error?.message || err?.info?.error?.message || err.message) };
        }
      },
      () => native({ account: bait.account, tx: (info) => signedNative(thief, info, [FEST], null, "classicalOnly") }),
      () => native({ account: bait.account, tx: (info) => signedNative(thief, info, [FEST], null, "hybrid") }),
      () =>
        native({
          account: bait.account,
          tx: (info) =>
            signed(
              thief,
              info,
              [buildRegisterPqKeyMessage({ chainId, account: bait.account, pqKey: thief.pqKey, classicalPublicKey: classicalKey.publicKey })],
              400000n,
              "classicalOnly",
            ),
        }),
      () =>
        native({
          account: bait.account,
          tx: (info) =>
            signed(
              thief,
              info,
              [
                {
                  typeUrl: "/cosmos.bank.v1beta1.MsgSend",
                  value: MsgSend.encode(
                    MsgSend.fromPartial({
                      fromAddress: bait.account,
                      toAddress: qorAddress(away),
                      amount: [{ denom: "uqor", amount: "100000" }],
                    }),
                  ).finish(),
                },
              ],
              300000n,
              "classicalOnly",
            ),
        }),
      () =>
        native({
          account: bait.account,
          tx: (info) =>
            signed(thief, info, [crossVmMsg(bait.account, FEST, erc20.encodeFunctionData("transfer", [away, 100000n]))], 500000n, "hybrid"),
        }),
    ];
    const results = [];
    for (let i = 0; i < steps.length; i++) {
      let r;
      try {
        r = await steps[i]();
      } catch (err) {
        r = { refused: null, reason: "Could not reach Diana: " + reason(err.message) };
      }
      results.push({ attack: ATTACKS[i], ...r });
    }
    return results;
  }

  async function balances() {
    if (clock() - cache.at < 20 && cache.value) return cache.value;
    const value = await Promise.all(
      wallets.map(async (w) => {
        const [fusd, bank] = await Promise.all([
          rpc.call({ to: FEST, data: erc20.encodeFunctionData("balanceOf", [w.address]) }).then(BigInt),
          net.read("bank", w.account).catch(() => null),
        ]);
        return {
          fusd: Number(fusd),
          uqor: Number(bank?.balances?.find((b) => b.denom === "uqor")?.amount || 0),
        };
      }),
    );
    cache = { at: clock(), value };
    return value;
  }

  // One round attacks one wallet, taking them in turn.
  function round() {
    running ||= (async () => {
      const index = turn++ % wallets.length;
      const before = await balances().catch(() => null);
      const results = await attack(wallets[index]);
      cache.at = 0;
      const after = await balances().catch(() => null);
      rounds.unshift({
        at: clock(),
        wallet: wallets[index].address,
        results,
        unchanged: !!before && !!after && before[index].fusd === after[index].fusd,
      });
      rounds.length = Math.min(rounds.length, 48);
      return rounds[0];
    })().finally(() => (running = null));
    return running;
  }

  return {
    round,
    start(everySeconds = 3600) {
      setTimeout(() => round().catch(() => {}), 60000).unref?.();
      setInterval(() => round().catch(() => {}), everySeconds * 1000).unref?.();
    },
    async view() {
      const live = await balances().catch(() => null);
      return {
        wallets: wallets.map((w, i) => ({
          address: w.address,
          account: w.account,
          privateKey: w.secp256k1PrivateKey,
          fusd: live?.[i]?.fusd ?? null,
          uqor: live?.[i]?.uqor ?? null,
        })),
        rounds: rounds.slice(0, 12),
        total: rounds.length,
        accepted: rounds.reduce((n, r) => n + r.results.filter((x) => x.refused === false).length, 0),
      };
    },
  };
}
