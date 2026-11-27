import { addressFromBytes } from "@qorechain/qoresign";
import {
  AbiCoder,
  Interface,
  getAddress,
  getBytes,
  formatEther,
  keccak256,
} from "ethers";
import { FEST, requireThat } from "./common.mjs";
import { chainRead, nativeSearch } from "./native.mjs";
const qor = (address) => addressFromBytes(getBytes(address)).bech32;
const CROSS_VM = "/qorechain.crossvm.v1.MsgCrossVMCall";
const tokenAbi = new Interface(["function transfer(address,uint256)"]);
const rest = "https://api-testnet.qore.host";
const transfer = new Interface([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
export async function observeWallet(address) {
  const qor = addressFromBytes(getBytes(address)).bech32;
  const r = await fetch(rest + "/cosmos/auth/v1beta1/account_info/" + qor, {
    signal: AbortSignal.timeout(8000),
  });
  const body = await r.json();
  if (r.status === 404 && body.code === 5) return "no prior account record";
  requireThat(
    r.ok && body.info?.address === qor,
    "Account history is currently unavailable.",
    502,
  );
  return "existing account record";
}
// The explorer and the native API know an EVM transaction by its native hash.
// It is only used for links, so a slow index never blocks a receipt.
async function nativeHash(hash) {
  for (let i = 0; i < 3; i++) {
    try {
      const query = "ethereum_tx.ethereumTxHash='" + hash + "'";
      const r = await fetch(
        rest + "/cosmos/tx/v1beta1/txs?query=" + encodeURIComponent(query),
        { signal: AbortSignal.timeout(4000) },
      );
      const [found] = (await r.json()).tx_responses || [];
      if (found) return found.txhash;
    } catch {
      // Try again below.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
// Looks up a settlement event by payment ID, for receipts whose browser closed
// before reporting them. Diana's RPC serves at most 10,000 blocks per query.
const EVENTS = { funding: "Funded", collection: "Collected", refund: "Refunded" };
export async function findEvidence(rpc, escrow, row, kind) {
  const found = await findNativeEvidence(rpc, escrow, row, kind).catch(
    () => null,
  );
  if (found) return found;
  const topic = escrow.interface.getEvent(EVENTS[kind]).topicHash;
  const head = await rpc.getBlockNumber();
  const floor = row.evidence?.funding?.block || Math.max(0, head - 400000);
  for (let to = head; to >= floor; to -= 10000) {
    const [log] = await rpc.getLogs({
      address: escrow.target,
      topics: [topic, row.id],
      fromBlock: Math.max(floor, to - 9999),
      toBlock: to,
    });
    if (log) return readEvidence(rpc, escrow, row, kind, log.transactionHash);
  }
  return null;
}
export async function readEvidence(rpc, escrow, row, kind, hash) {
  if (/^[0-9a-fA-F]{64}$/.test(hash))
    return readNativeEvidence(rpc, escrow, row, kind, hash.toUpperCase());
  requireThat(/^0x[0-9a-fA-F]{64}$/.test(hash), "Invalid transaction hash.");
  const receipt = await rpc.getTransactionReceipt(hash);
  requireThat(
    receipt?.status === 1,
    "Transaction is awaiting successful confirmation.",
    409,
  );
  if (kind === "transfer") {
    const previous = row.evidence?.collection;
    requireThat(
      row.state === "collected" &&
        previous &&
        receipt.blockNumber >= previous.block &&
        receipt.from === row.destination &&
        receipt.to?.toLowerCase() === FEST.toLowerCase(),
      "Transfer does not match this recipient.",
    );
    const valid = receipt.logs.some((log) => {
      if (log.address.toLowerCase() !== FEST.toLowerCase()) return false;
      try {
        const e = transfer.parseLog(log);
        return (
          e?.args.from === row.destination &&
          e.args.to !== row.destination &&
          e.args.value > 0n
        );
      } catch {
        return false;
      }
    });
    requireThat(valid, "No outgoing token transfer in this receipt.");
  } else {
    const names = {
      funding: "Funded",
      collection: "Collected",
      refund: "Refunded",
    };
    requireThat(Object.hasOwn(names, kind), "Unknown payment event.");
    requireThat(
      receipt.to?.toLowerCase() === escrow.target.toLowerCase() &&
        receipt.logs.some((log) => {
          if (log.address.toLowerCase() !== escrow.target.toLowerCase())
            return false;
          try {
            const event = escrow.interface.parseLog(log);
            return event?.name === names[kind] && event.args.id === row.id;
          } catch {
            return false;
          }
        }),
      "Receipt does not match this invitation.",
    );
  }
  return {
    hash: receipt.hash,
    native: await nativeHash(receipt.hash),
    block: receipt.blockNumber,
    payer: receipt.from,
    feeQor: formatEther(receipt.fee),
  };
}

// A cross-VM settlement is a native transaction whose MsgCrossVMCall ran the
// escrow or token call as the signer's own 0x address. Diana records no EVM
// log for it, so the receipt is checked from the signed message itself, its
// crossvm_response event, and the escrow's state now.
export async function readNativeEvidence(rpc, escrow, row, kind, hash) {
  const { tx, tx_response: r, pending } = await chainRead("receipt", hash);
  requireThat(
    !pending && r && Number(r.code) === 0,
    "Transaction is awaiting successful confirmation.",
    409,
  );
  const executed = new Set(
    (r.events || [])
      .filter(
        (e) =>
          e.type === "crossvm_response" &&
          e.attributes.some((a) => a.key === "status" && a.value === "executed"),
      )
      .map((e) => e.attributes.find((a) => a.key === "msg_index")?.value),
  );
  const calls = (tx?.body?.messages || []).flatMap((m, i) => {
    if (m["@type"] !== CROSS_VM || m.target_vm !== "evm" || !executed.has(String(i)))
      return [];
    try {
      const target = getAddress(m.target_contract),
        data = "0x" + Buffer.from(m.payload, "base64").toString("hex");
      const abi =
        target === getAddress(escrow.target)
          ? escrow.interface
          : target === getAddress(FEST)
            ? tokenAbi
            : null;
      const call = abi?.parseTransaction({ data });
      return call ? [{ sender: m.sender, target, call }] : [];
    } catch {
      return [];
    }
  });
  const payment = await escrow.payments(row.id);
  const state = Number(payment.state);
  let payer;
  if (kind === "transfer") {
    const previous = row.evidence?.collection;
    const spend = calls.find(
      (c) =>
        c.call.name === "transfer" &&
        c.sender === qor(row.destination) &&
        getAddress(c.call.args[0]) !== getAddress(row.destination) &&
        c.call.args[1] > 0n,
    );
    requireThat(
      row.state === "collected" &&
        previous &&
        Number(r.height) >= previous.block &&
        spend,
      "Transfer does not match this recipient.",
    );
    payer = row.destination;
  } else {
    const name = { funding: "fund", collection: "claim", refund: "refund" }[kind];
    requireThat(name, "Unknown payment event.");
    const match = calls.find((c) => {
      if (c.call.name !== name) return false;
      if (name === "fund")
        return (
          keccak256(
            AbiCoder.defaultAbiCoder().encode(
              ["address", "bytes32"],
              [payment.sender, c.call.args[0]],
            ),
          ) === row.id && c.sender === qor(payment.sender)
        );
      if (name === "claim")
        return c.call.args[0] === row.id && c.sender === qor(payment.recipient);
      return c.call.args[0] === row.id;
    });
    requireThat(
      match &&
        { fund: state >= 1, claim: state === 2, refund: state === 3 }[name],
      "Receipt does not match this invitation.",
    );
    payer = name === "claim" ? payment.recipient : name === "fund" ? payment.sender : null;
  }
  const fee = (tx.auth_info?.fee?.amount || []).find((c) => c.denom === "uqor");
  return {
    hash,
    native: hash,
    crossVm: true,
    block: Number(r.height),
    payer,
    feeQor: formatEther(BigInt(fee?.amount || 0) * 1000000000000n),
  };
}
async function findNativeEvidence(rpc, escrow, row, kind) {
  const payment = await escrow.payments(row.id);
  const who = { funding: payment.sender, collection: payment.recipient }[kind];
  if (!who || /^0x0{40}$/i.test(who)) return null;
  const { tx_responses: found = [] } = await nativeSearch(
    "crossvm_request.target_contract='" +
      getAddress(escrow.target) +
      "' AND crossvm_request.sender='" +
      qor(who) +
      "'",
  );
  for (const r of found) {
    try {
      return await readNativeEvidence(rpc, escrow, row, kind, r.txhash);
    } catch {
      // Not this payment; keep looking.
    }
  }
  return null;
}
