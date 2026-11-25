import { addressFromBytes } from "@qorechain/qoresign";
import { Interface, getBytes, formatEther } from "ethers";
import { FEST, requireThat } from "./common.mjs";
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
// Looks up a settlement event by payment ID, for receipts whose browser closed
// before reporting them. Diana's RPC serves at most 10,000 blocks per query.
const EVENTS = { funding: "Funded", collection: "Collected", refund: "Refunded" };
export async function findEvidence(rpc, escrow, row, kind) {
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
    block: receipt.blockNumber,
    payer: receipt.from,
    feeQor: formatEther(receipt.fee),
  };
}
