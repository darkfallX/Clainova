import { requireThat } from "./common.mjs";
import { TxBody, TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx.js";
const root = "https://api-testnet.qore.host";
export async function nativeRequest(action, value, body, method) {
  let path,
    options = { signal: AbortSignal.timeout(14000) };
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
    path = "/cosmos/tx/v1beta1/txs";
    options = {
      ...options,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tx_bytes: body.raw, mode: "BROADCAST_MODE_SYNC" }),
    };
  } else if (
    action === "receipt" &&
    method === "GET" &&
    /^[0-9A-Fa-f]{64}$/.test(value)
  )
    path = "/cosmos/tx/v1beta1/txs/" + value;
  else {
    requireThat(
      method === "GET" && /^qor1[0-9a-z]{38}$/.test(value),
      "Invalid native address.",
    );
    const prefix = {
      account: "/cosmos/auth/v1beta1/account_info/",
      key: "/qorechain/pqc/v1/account/",
      window: "/qorechain/pqc/v1/evm_window/",
    }[action];
    requireThat(prefix, "Unknown network read.");
    path = prefix + value;
  }
  const res = await fetch(root + path, options);
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
