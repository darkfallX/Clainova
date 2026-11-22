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
// The adapter exposes other wallet utilities through its entry point; bundle only its window composer.
import { openEvmWindowMsg } from "../node_modules/@qorechain/wallet-adapter/src/evm-window.js";
export const chainId = "qorechain-diana";
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
export function signedNative(keys, info, targets, conversion) {
  const { account, classicalKey, pqKey } = keys;
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
        amount: [{ denom: "uqor", amount: "100000" }],
        gasLimit: conversion ? 600000n : 400000n,
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
    mode: targets || conversion ? "hybrid" : "classicalOnly",
    signBytesVersion: "v2",
  });
}
export async function openWindow(wallet, targets, api, progress, conversion) {
  const keys = nativeKeys(wallet);
  async function broadcast(targetList, convert) {
    const { info } = await api("/api/native/account/" + keys.account);
    if (!info) throw Error("Fund the account with test QOR and retry.");
    const tx = signedNative(keys, info, targetList, convert);
    const response = await api("/api/native/broadcast", {
      raw: encodeBase64(tx.txBytes),
    });
    if (Number(response.tx_response?.code) !== 0)
      throw Error(
        "Diana refused the setup transaction. " +
          (response.tx_response?.raw_log || "Check the test QOR balance."),
      );
    const hash = response.tx_response.txhash;
    for (let i = 0; i < 30; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const result = await api("/api/native/receipt/" + hash);
      if (result.tx_response) {
        if (Number(result.tx_response.code) !== 0)
          throw Error(
            "Setup transaction failed. " + result.tx_response.raw_log,
          );
        return hash;
      }
    }
    throw Error(
      "Confirmation is pending for " +
        hash +
        ". Check the explorer, then retry.",
    );
  }
  const key = await api("/api/native/key/" + keys.account);
  if (!key.found) {
    progress("Registering your post-quantum key…");
    await broadcast(null);
  } else if (
    !key.account?.possession_proven ||
    key.account.public_key !== encodeBase64(keys.pqKey.publicKey)
  )
    throw Error(
      "The registered key does not match this wallet or lacks proof of possession.",
    );
  progress("Opening a 120-block spending window…");
  return broadcast(targets);
}
