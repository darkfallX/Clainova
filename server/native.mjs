import { requireThat } from "./common.mjs";
import { TxBody, TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx.js";
import { BinaryReader } from "cosmjs-types/binary.js";
import { Interface, getAddress } from "ethers";
const root = "https://api-testnet.qore.host";
// Shared by the recipient proxy below and the server's own gas sponsor.
export const broadcast = (raw) =>
  request("broadcast", "/cosmos/tx/v1beta1/txs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tx_bytes: raw, mode: "BROADCAST_MODE_SYNC" }),
  });
// Newest first. Used to find a cross-VM settlement whose browser never reported
// it: these leave no EVM log, so only the native index knows them.
export const nativeSearch = (query) =>
  request(
    "search",
    "/cosmos/tx/v1beta1/txs?query=" +
      encodeURIComponent(query) +
      "&order_by=ORDER_BY_DESC&pagination.limit=20",
  );
export function chainRead(action, value) {
  const prefix = {
    receipt: "/cosmos/tx/v1beta1/txs/",
    account: "/cosmos/auth/v1beta1/account_info/",
    key: "/qorechain/pqc/v1/account/",
    window: "/qorechain/pqc/v1/evm_window/",
    kem: "/qorechain/pqc/v1/kem/",
    bank: "/cosmos/bank/v1beta1/balances/",
  }[action];
  requireThat(prefix, "Unknown network read.");
  return request(action, prefix + value);
}
async function request(action, path, options = {}) {
  let res;
  // Reads are safe to repeat, so one dropped connection is not an error.
  for (let left = options.method ? 0 : 2; ; left--) {
    try {
      res = await fetch(root + path, {
        ...options,
        signal: AbortSignal.timeout(options.method ? 14000 : 7000),
      });
      if (res.status < 500 || !left) break;
    } catch (err) {
      if (!left) throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  if (res.status === 404 && action === "receipt") return { pending: true };
  requireThat(
    res.ok,
    action === "account"
      ? "Account unavailable. Fund this address with test QOR first."
      : "Diana could not complete this request.",
    502,
  );
  return res.json();
}
export async function nativeRequest(action, value, body, method, contracts = {}) {
  if (action === "broadcast" && method === "POST") {
    requireThat(
      typeof body.raw === "string" && body.raw.length <= 23000,
      "Invalid signed transaction.",
    );
    const raw = TxRaw.decode(Buffer.from(body.raw, "base64"));
    const { messages } = TxBody.decode(raw.bodyBytes);
    requireThat(
      (messages.length === 1 &&
        [
          "/qorechain.pqc.v1.MsgRegisterPQCKeyV2",
          "/qorechain.pqc.v1.MsgOpenEVMWindow",
          "/cosmos.evm.erc20.v1.MsgConvertCoin",
        ].includes(messages[0].typeUrl)) ||
        allowedCalls(messages, contracts) ||
        allowedSwap(messages, contracts),
      "Unsupported setup transaction.",
    );
    return broadcast(body.raw);
  }
  if (
    action === "receipt" &&
    method === "GET" &&
    /^[0-9A-Fa-f]{64}$/.test(value)
  )
    return chainRead(action, value);
  if (action === "quote" && method === "GET") {
    requireThat(
      contracts.token && /^[1-9][0-9]{0,6}$/.test(String(value)) && Number(value) <= MAX_SWAP,
      "Invalid swap amount.",
    );
    return request(
      "quote",
      "/qorechain/amm/v1/quote/exact_in?pool_id=" +
        POOL +
        "&denom_in=erc20:" +
        contracts.token +
        "&amount_in=" +
        value,
    );
  }
  requireThat(
    method === "GET" &&
      action !== "receipt" &&
      /^qor1[0-9a-z]{38}$/.test(value),
    "Invalid native address.",
  );
  return chainRead(action, value);
}

const CROSS_VM = "/qorechain.crossvm.v1.MsgCrossVMCall";
const tokenAbi = new Interface([
  "function approve(address,uint256)",
  "function transfer(address,uint256)",
]);
const escrowAbi = new Interface([
  "function fund(bytes32,uint128,uint64)",
  "function claim(bytes32,uint64,bytes)",
  "function refund(bytes32)",
]);
export function decodeCrossVm(bytes) {
  const reader = new BinaryReader(bytes),
    msg = { funds: 0, async: false };
  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    if (field === 1) msg.sender = reader.string();
    else if (field === 3) msg.targetVm = reader.string();
    else if (field === 4) msg.target = reader.string();
    else if (field === 5) msg.payload = reader.bytes();
    else if (field === 6) (msg.funds++, reader.skipType(tag & 7));
    else if (field === 7) msg.async = reader.bool();
    else reader.skipType(tag & 7);
  }
  return msg;
}
// The relay forwards cross-VM calls only to this app's escrow and token, and
// only the calls the app makes: one claim, refund or transfer, or a deposit
// with its approval for the escrow. Anything else is refused before Diana.
const KEM = "/qorechain.pqc.v1.MsgRegisterKEMKey";
// MsgRegisterKEMKey: sender, algorithm_id (2 is ML-KEM-1024), public_key.
export function decodeKem(bytes) {
  const reader = new BinaryReader(bytes),
    msg = {};
  while (reader.pos < reader.len) {
    const tag = reader.uint32(),
      field = tag >>> 3;
    if (field === 1) msg.sender = reader.string();
    else if (field === 2) msg.algorithm = reader.uint32();
    else if (field === 3) msg.key = reader.bytes();
    else reader.skipType(tag & 7);
  }
  return msg;
}
export function allowedCalls(messages, contracts = {}) {
  // A wallet may register its ML-KEM-1024 encryption key in the same
  // transaction as its claim or deposit, for sealed notes. Nothing else rides along.
  if (messages[0]?.typeUrl === KEM) {
    let kem;
    try {
      kem = decodeKem(messages[0].value);
    } catch {
      return false;
    }
    if (kem.algorithm !== 2 || kem.key?.length !== 1568) return false;
    const rest = messages.slice(1);
    if (!allowedCalls(rest, contracts)) return false;
    const first = decodeCrossVm(rest[0].value);
    const parsed = rest.map((m) => {
      const d = decodeCrossVm(m.value);
      return "0x" + Buffer.from(d.payload).toString("hex").slice(0, 8);
    });
    const claimOrFund = parsed.every((sel) =>
      ["0x" + escrowAbi.getFunction("claim").selector.slice(2), "0x" + escrowAbi.getFunction("fund").selector.slice(2), "0x" + tokenAbi.getFunction("approve").selector.slice(2)].includes(sel),
    ) && !parsed.includes("0x" + tokenAbi.getFunction("transfer").selector.slice(2));
    return first.sender === kem.sender && claimOrFund;
  }
  const { escrow, token } = contracts;
  if (!escrow || !token || messages.length < 1 || messages.length > 2)
    return false;
  const calls = [];
  for (const any of messages) {
    if (any.typeUrl !== CROSS_VM) return false;
    let msg, target, call;
    try {
      msg = decodeCrossVm(any.value);
      target = getAddress(msg.target);
      const abi =
        target === getAddress(escrow)
          ? escrowAbi
          : target === getAddress(token)
            ? tokenAbi
            : null;
      call = abi?.parseTransaction({ data: "0x" + Buffer.from(msg.payload).toString("hex") });
    } catch {
      return false;
    }
    if (!call || msg.targetVm !== "evm" || msg.funds || msg.async) return false;
    if (call.name === "approve" && getAddress(call.args[0]) !== getAddress(escrow))
      return false;
    calls.push({ sender: msg.sender, name: call.name });
  }
  if (calls.some((c) => c.sender !== calls[0].sender)) return false;
  const names = calls.map((c) => c.name).join(",");
  return ["claim", "refund", "transfer", "fund", "approve,fund"].includes(names);
}

// The fee swap: exactly one ERC-20-to-coin conversion of this app's token,
// followed by a swap of the same amount into QOR in pool 2, by one account,
// for at most 0.1 fUSD. Nothing else of the AMM or the erc20 module passes.
const POOL = 2n;
export const MAX_SWAP = 100000;
export function allowedSwap(messages, { token } = {}) {
  if (!token || messages.length !== 2) return false;
  const [convert, swap] = messages;
  if (
    convert.typeUrl !== "/cosmos.evm.erc20.v1.MsgConvertERC20" ||
    swap.typeUrl !== "/qorechain.amm.v1.MsgSwapExactIn"
  )
    return false;
  try {
    const text = (m) =>
      Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Buffer.isBuffer(v) ? v.toString("utf8") : v]));
    const c = text(fieldsOf(convert.value)),
      raw = fieldsOf(swap.value),
      w = text(raw);
    const coin = text(fieldsOf(raw[3]));
    const amount = c[2];
    return (
      getAddress(c[1]) === getAddress(token) &&
      /^[1-9][0-9]*$/.test(amount) &&
      Number(amount) <= MAX_SWAP &&
      c[3] === c[4] &&
      w[1] === c[3] &&
      BigInt(w[2]) === POOL &&
      coin[1] === "erc20:" + getAddress(token) &&
      coin[2] === amount &&
      w[4] === "uqor" &&
      /^[1-9][0-9]*$/.test(w[5])
    );
  } catch {
    return false;
  }
}
// Reads a flat message: length-delimited fields as text, varints as strings.
// The swap's token_in (field 3) is a nested Coin, read again with this.
function fieldsOf(bytes) {
  const reader = new BinaryReader(bytes),
    out = {};
  while (reader.pos < reader.len) {
    const tag = reader.uint32(),
      field = tag >>> 3,
      wire = tag & 7;
    if (wire === 2) out[field] = reader.bytes();
    else if (wire === 0) out[field] = reader.uint64().toString();
    else reader.skipType(wire);
  }
  for (const k of Object.keys(out))
    if (out[k] instanceof Uint8Array) out[k] = Buffer.from(out[k]);
  return out;
}
