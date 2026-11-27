import { getBytes, encodeBase64 } from "ethers";
import {
  addressFromBytes,
  buildRegisterPqKeyMessage,
  classicalKeyFromPrivate,
  deriveCanonicalPqKey,
  signHybrid,
} from "@qorechain/qoresign";
import { TxBody, AuthInfo } from "cosmjs-types/cosmos/tx/v1beta1/tx.js";
import { BinaryWriter } from "cosmjs-types/binary.js";
import { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin.js";
import { PubKey } from "cosmjs-types/cosmos/crypto/secp256k1/keys.js";
// Deep import on purpose. The package root (wallet-adapter 0.6.0) also loads its
// Phantom and authenticator helpers, whose Node fallbacks `import('crypto')`:
// esbuild then fails for the browser, and with crypto marked external the bundle
// grows from 549 KB to 1.95 MB. Its exports map has no subpath, hence the path.
import { openEvmWindowMsg } from "../node_modules/@qorechain/wallet-adapter/src/evm-window.js";
export const chainId = "qorechain-diana";
// Diana's minimum gas price is 0.1 uqor. Paying 0.125 leaves headroom, and the
// limits sit above measured use (registration 300k, window 190k, conversion
// 450k, sponsor transfer 203k gas).
export const nativeGas = {
  setup: 400000n,
  conversion: 600000n,
  send: 300000n,
};
export const nativeFee = (gas) => String(gas / 8n);
export const qorAddress = (address) =>
  addressFromBytes(getBytes(address)).bech32;
export function nativeKeys(wallet) {
  const account = qorAddress(wallet.address),
    classicalKey = classicalKeyFromPrivate(
      getBytes(wallet.privateKey),
      "eth_secp256k1",
    );
  const pqKey = deriveCanonicalPqKey({
    address: account,
    mnemonic: wallet.mnemonic.phrase,
  });
  return { account, classicalKey, pqKey };
}
export function convertFusd(account, recipient, token, amount) {
  const coin = Coin.encode({
    denom: "erc20:" + token,
    amount: String(amount),
  }).finish();
  const value = BinaryWriter.create()
    .uint32(10)
    .bytes(coin)
    .uint32(18)
    .string(recipient)
    .uint32(26)
    .string(account)
    .finish();
  return { typeUrl: "/cosmos.evm.erc20.v1.MsgConvertCoin", value };
}
export function signedNative(keys, info, targets, conversion, mode) {
  const { account, classicalKey, pqKey } = keys;
  const gasLimit =
    {
      "/cosmos.evm.erc20.v1.MsgConvertCoin": nativeGas.conversion,
      "/cosmos.bank.v1beta1.MsgSend": nativeGas.send,
    }[conversion?.typeUrl] || nativeGas.setup;
  const msg =
    conversion ||
    (targets
      ? openEvmWindowMsg({
          sender: account,
          blocks: 120,
          maxTxs: targets.length,
          maxValue: "250000",
          allowedTargets: targets,
        })
      : buildRegisterPqKeyMessage({
          chainId,
          account,
          pqKey,
          classicalPublicKey: classicalKey.publicKey,
        }));
  const bodyBytes = TxBody.encode(
    TxBody.fromPartial({ messages: [msg] }),
  ).finish();
  const key = {
    typeUrl: "/cosmos.evm.crypto.v1.ethsecp256k1.PubKey",
    value: PubKey.encode({ key: classicalKey.publicKey }).finish(),
  };
  const authInfoBytes = AuthInfo.encode(
    AuthInfo.fromPartial({
      signerInfos: [
        {
          publicKey: key,
          sequence: BigInt(info.sequence),
          modeInfo: { single: { mode: 1 } },
        },
      ],
      fee: {
        amount: [{ denom: "uqor", amount: nativeFee(gasLimit) }],
        gasLimit,
      },
    }),
  ).finish();
  return signHybrid({
    chainId,
    accountNumber: BigInt(info.account_number),
    bodyBytes,
    authInfoBytes,
    classicalKey,
    pqKey,
    mode: mode || (targets || conversion ? "hybrid" : "classicalOnly"),
    signBytesVersion: "v2",
  });
}
// Gas for each kind of cross-VM transaction, above the use measured on Diana
// (claim 924k with the ML-DSA-87 check, approve and fund 540k, transfer 299k).
// The fee is an eighth of the limit in uqor, so a claim costs 0.1375 test QOR.
export const crossVmGas = {
  // Converting 0.01 fUSD to a bank coin and swapping it used 528k.
  swap: 650000n,
  claim: 1100000n,
  fund: 750000n,
  refund: 500000n,
  transfer: 400000n,
};
// /qorechain.crossvm.v1.MsgCrossVMCall: sender, source_vm, target_vm,
// target_contract, payload. The chain ignores source_vm but refuses it when it
// equals the target, so it names the native side.
export function crossVmMsg(sender, target, payload) {
  const value = BinaryWriter.create()
    .uint32(10)
    .string(sender)
    .uint32(18)
    .string("cosmwasm")
    .uint32(26)
    .string("evm")
    .uint32(34)
    .string(target)
    .uint32(42)
    .bytes(getBytes(payload))
    .finish();
  return { typeUrl: "/qorechain.crossvm.v1.MsgCrossVMCall", value };
}
// QoreChain's native fUSD/QOR pool. A swap names both of its denominations.
export const FEE_POOL = 2n;
// /cosmos.evm.erc20.v1.MsgConvertERC20: contract, amount, receiver, sender.
// Moves ERC-20 fUSD back to the bank coin, which the pool trades.
export function convertErc20Msg(account, token, amount) {
  const value = BinaryWriter.create()
    .uint32(10)
    .string(token)
    .uint32(18)
    .string(String(amount))
    .uint32(26)
    .string(account)
    .uint32(34)
    .string(account)
    .finish();
  return { typeUrl: "/cosmos.evm.erc20.v1.MsgConvertERC20", value };
}
// /qorechain.amm.v1.MsgSwapExactIn: sender, pool_id, token_in, denom_out,
// min_out. min_out is always set, so a moved price refuses the swap.
export function swapMsg(account, token, amount, minOut) {
  const coin = Coin.encode({ denom: "erc20:" + token, amount: String(amount) }).finish();
  const value = BinaryWriter.create()
    .uint32(10)
    .string(account)
    .uint32(16)
    .uint64(FEE_POOL)
    .uint32(26)
    .bytes(coin)
    .uint32(34)
    .string("uqor")
    .uint32(42)
    .string(String(minOut))
    .finish();
  return { typeUrl: "/qorechain.amm.v1.MsgSwapExactIn", value };
}
export function signedCalls(keys, info, messages, gasLimit) {
  const { classicalKey, pqKey } = keys;
  const bodyBytes = TxBody.encode(TxBody.fromPartial({ messages })).finish();
  const authInfoBytes = AuthInfo.encode(
    AuthInfo.fromPartial({
      signerInfos: [
        {
          publicKey: {
            typeUrl: "/cosmos.evm.crypto.v1.ethsecp256k1.PubKey",
            value: PubKey.encode({ key: classicalKey.publicKey }).finish(),
          },
          sequence: BigInt(info.sequence),
          modeInfo: { single: { mode: 1 } },
        },
      ],
      fee: { amount: [{ denom: "uqor", amount: nativeFee(gasLimit) }], gasLimit },
    }),
  ).finish();
  return signHybrid({
    chainId,
    accountNumber: BigInt(info.account_number),
    bodyBytes,
    authInfoBytes,
    classicalKey,
    pqKey,
    mode: "hybrid",
    signBytesVersion: "v2",
  });
}
// A retry after a failed EVM call can use the window that is already open.
// Only an untouched window with exactly these targets qualifies.
function reusable(state, targets) {
  const allowed = (state?.allowed_targets || []).map((x) => x.toLowerCase());
  return (
    state?.live === true &&
    Number(state.used_txs) === 0 &&
    Number(state.max_txs) === targets.length &&
    Number(state.remaining_blocks) >= 60 &&
    allowed.length === targets.length &&
    targets.every((t) => allowed.includes(t.toLowerCase()))
  );
}
// Sends one hybrid-signed native transaction and waits for it. Every
// transaction here carries an ML-DSA-87 signature except key registration,
// which proves possession of that key inside the message instead.
async function submit(keys, api, build, what) {
  const { info } = await api("/api/native/account/" + keys.account);
  if (!info) throw Error("Fund the account with test QOR and retry.");
  const tx = build(info);
  const response = await api("/api/native/broadcast", {
    raw: encodeBase64(tx.txBytes),
  });
  if (Number(response.tx_response?.code) !== 0)
    throw Error(
      "Diana refused the " + what + ". " +
        (response.tx_response?.raw_log || "Check the test QOR balance."),
    );
  const hash = response.tx_response.txhash;
  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const result = await api("/api/native/receipt/" + hash);
    if (result.tx_response) {
      if (Number(result.tx_response.code) !== 0)
        throw Error(
          "The " + what + " failed. " + result.tx_response.raw_log,
        );
      return result.tx_response;
    }
  }
  throw Error(
    "Confirmation is pending for " + hash + ". Check the explorer, then retry.",
  );
}
// Registers the wallet's post-quantum key if needed, then converts any faucet
// fUSD shortfall from the bank coin into the ERC-20 the escrow uses.
async function setup(wallet, api, progress, conversion) {
  const keys = nativeKeys(wallet);
  const key = await api("/api/native/key/" + keys.account);
  if (!key.found) {
    progress("Registering your post-quantum key…");
    await submit(keys, api, (info) => signedNative(keys, info, null), "key registration");
  } else if (
    !key.account?.possession_proven ||
    key.account.public_key !== encodeBase64(keys.pqKey.publicKey)
  )
    throw Error(
      "The registered key does not match this wallet or lacks proof of possession.",
    );
  if (conversion) {
    progress("Converting faucet fUSD for this payment…");
    await submit(keys, api, (info) => signedNative(keys, info, null, conversion), "conversion");
  }
  return keys;
}
// For QoreX accounts, which sign their own EVM transactions inside a window.
export async function openWindow(wallet, targets, api, progress, conversion) {
  const keys = await setup(wallet, api, progress, conversion);
  if (reusable(await api("/api/native/window/" + keys.account), targets))
    return "reused";
  progress("Opening a 120-block spending window…");
  return (
    await submit(keys, api, (info) => signedNative(keys, info, targets), "window")
  ).txhash;
}
export async function prepareKey(wallet, api, progress) {
  await setup(wallet, api, progress);
}
// Calls the escrow or the token from the wallet's own native account. Each call
// is a MsgCrossVMCall inside one hybrid-signed transaction, so the chain checks
// the wallet's ML-DSA-87 signature and the EVM sees the wallet as msg.sender.
// No EVM window is opened and no ECDSA-only EVM transaction is sent. Several
// calls in one transaction succeed or fail together.
export async function callEvm(wallet, api, progress, calls, kind, conversion, before = []) {
  const keys = await setup(wallet, api, progress, conversion);
  const response = await submit(
    keys,
    api,
    (info) =>
      signedCalls(
        keys,
        info,
        [
          ...before,
          ...calls.map(({ to, data }) => crossVmMsg(keys.account, to, data)),
        ],
        // Registering the encryption key in the same transaction used about 75k.
        crossVmGas[kind] + (before.length ? 150000n : 0n),
      ),
    "post-quantum transaction",
  );
  const done = (response.events || []).filter(
    (e) =>
      e.type === "crossvm_response" &&
      e.attributes?.some((a) => a.key === "status" && a.value === "executed"),
  ).length;
  if (done !== calls.length)
    throw Error("Diana did not run every call in " + response.txhash + ".");
  return { hash: response.txhash, native: true };
}

// Swaps a little of the received fUSD for QOR in QoreChain's own pool, so the
// wallet pays its own fees afterwards instead of relying on the sponsor. The
// conversion and the swap are one hybrid-signed transaction: both or neither.
export async function swapForFees(wallet, api, progress, token, amount) {
  const keys = await setup(wallet, api, progress);
  const quote = await api("/api/native/quote/" + amount);
  const expected = BigInt(quote.amount_out || 0);
  if (expected <= 0n) throw Error("The fUSD/QOR pool has no quote right now.");
  // Accept at most 3% less than the quote.
  const minOut = (expected * 97n) / 100n;
  progress("Swapping in QoreChain's fUSD/QOR pool…");
  const response = await submit(
    keys,
    api,
    (info) =>
      signedCalls(
        keys,
        info,
        [
          convertErc20Msg(keys.account, token, amount),
          swapMsg(keys.account, token, amount, minOut),
        ],
        crossVmGas.swap,
      ),
    "swap",
  );
  return { hash: response.txhash, expected };
}
