import { requireThat } from "./common.mjs";
import { TxBody, TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx.js";
const root = "https://api-testnet.qore.host";
// Shared by the recipient proxy below and the server's own gas sponsor.
export const broadcast = (raw) =>
  request("broadcast", "/cosmos/tx/v1beta1/txs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tx_bytes: raw, mode: "BROADCAST_MODE_SYNC" }),
  });
export function chainRead(action, value) {
  const prefix = {
    receipt: "/cosmos/tx/v1beta1/txs/",
    account: "/cosmos/auth/v1beta1/account_info/",
    key: "/qorechain/pqc/v1/account/",
    window: "/qorechain/pqc/v1/evm_window/",
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
export async function nativeRequest(action, value, body, method) {
  if (action === "broadcast" && method === "POST") {
    requireThat(
      typeof body.raw === "string" && body.raw.length <= 23000,
      "Invalid signed transaction.",
    );
    const raw = TxRaw.decode(Buffer.from(body.raw, "base64"));
    const { messages } = TxBody.decode(raw.bodyBytes);
    requireThat(
      messages.length === 1 &&
        [
          "/qorechain.pqc.v1.MsgRegisterPQCKeyV2",
          "/qorechain.pqc.v1.MsgOpenEVMWindow",
          "/cosmos.evm.erc20.v1.MsgConvertCoin",
        ].includes(messages[0].typeUrl),
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
  requireThat(
    method === "GET" &&
      action !== "receipt" &&
      /^qor1[0-9a-z]{38}$/.test(value),
    "Invalid native address.",
  );
  return chainRead(action, value);
}
