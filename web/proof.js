import { Contract, Interface, JsonRpcProvider, Wallet, decodeBase64, getBytes, hexlify } from "ethers";
import { qorAddress } from "./native.js";
// Asks Diana's post-quantum precompiles about one collected payment, from the
// visitor's own browser. Every call is read-only.
const RPC = "https://evm-testnet.qore.host";
const claimAbi = new Interface(["function claim(bytes32 id,uint64 deadline,bytes signature)"]);
export async function askDiana(cfg, api, hash) {
  const rpc = new JsonRpcProvider(RPC, 9800, { staticNetwork: true });
  try {
    const escrow = new Contract(
      cfg.contract,
      [
        "function verifierKey() view returns(bytes)",
        "function message(bytes32,address,uint64) view returns(bytes)",
        "function payments(bytes32) view returns(address,uint64,uint8,uint128,address)",
      ],
      rpc,
    );
    const verify = new Contract(
      "0x0000000000000000000000000000000000000a01",
      ["function pqcVerify(bytes,bytes,bytes) view returns(bool)"],
      rpc,
    );
    const registry = new Contract(
      "0x0000000000000000000000000000000000000a02",
      ["function pqcKeyStatus(address) view returns(bool,uint8,bytes,bool)"],
      rpc,
    );
    // A cross-VM claim is a native transaction (its hash has no 0x); the claim
    // call is the payload of its MsgCrossVMCall, and the payer is the escrow's
    // recorded recipient. An older claim is an EVM transaction.
    let tx;
    if (hash.startsWith("0x")) tx = await rpc.getTransaction(hash);
    else {
      const { tx: signed } = await api("/api/native/receipt/" + hash);
      const call = (signed?.body?.messages || []).find(
        (m) => m["@type"] === "/qorechain.crossvm.v1.MsgCrossVMCall",
      );
      const data = hexlify(decodeBase64(call.payload));
      const [claimId] = claimAbi.decodeFunctionData("claim", data);
      tx = { data, from: (await escrow.payments(claimId))[4] };
    }
    const [id, deadline, signature] = claimAbi.decodeFunctionData("claim", tx.data);
    const stranger = Wallet.createRandom().address;
    const changed = getBytes(signature);
    changed[changed.length >> 1] ^= 1;
    const [key, mine, other] = await Promise.all([
      escrow.verifierKey(),
      escrow.message(id, tx.from, deadline),
      escrow.message(id, stranger, deadline),
    ]);
    const [valid, tampered, redirected, owner, unknown, window, block] = await Promise.all([
      verify.pqcVerify(key, signature, mine),
      verify.pqcVerify(key, hexlify(changed), mine),
      verify.pqcVerify(key, signature, other),
      registry.pqcKeyStatus(tx.from),
      registry.pqcKeyStatus(stranger),
      api("/api/native/window/" + qorAddress(tx.from)),
      rpc.getBlockNumber(),
    ]);
    const proven = (k) => k[0] && k[1] === 1n && k[3];
    const answer = (value) => (value ? "Accepted" : "Refused");
    return {
      block,
      rows: [
        ["The signature that released this payment", answer(valid), valid],
        ["The same signature, one bit changed", answer(tampered), !tampered],
        ["The same signature, another wallet", answer(redirected), !redirected],
        ["This wallet’s ML-DSA-87 key", proven(owner) ? "Registered and proven" : "Missing", proven(owner)],
        ["A wallet without one", proven(unknown) ? "Accepted" : "Refused", !proven(unknown)],
        [
          "This wallet’s EVM window",
          !window.found ? "Never opened" : window.live ? "Open" : "Closed",
          true,
        ],
      ],
    };
  } finally {
    rpc.destroy();
  }
}
