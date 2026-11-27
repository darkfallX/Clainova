// The v3 guardian: an ML-DSA-87 key kept on the operator's machine that can
// replace the verifier key or freeze claims. It can never move funds.
//   node --env-file=.env scripts/guardian.mjs key
//   node --env-file=.env scripts/guardian.mjs rotate <new VERIFIER_SEED, 64 hex>
//   node --env-file=.env scripts/guardian.mjs freeze
// The seed lives in GUARDIAN_SEED_FILE (default .data/guardian.seed, gitignored).
// Back it up offline. Rotate and freeze are sent as a hybrid-signed cross-VM
// transaction from SPONSOR_MNEMONIC's account; any funded account would do,
// because the guardian's signature, not the sender, authorises the change.
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Contract, HDNodeWallet, JsonRpcProvider, encodeBase64, keccak256 } from "ethers";
import { authority, TEST_RPC } from "../server/network.mjs";
import { broadcast, chainRead } from "../server/native.mjs";
import { nativeKeys, signedCalls, crossVmMsg } from "../web/native.js";

export function guardianKey(file = process.env.GUARDIAN_SEED_FILE || ".data/guardian.seed") {
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" });
  }
  const seed = fs.readFileSync(file, "utf8").trim();
  if (!/^[0-9a-f]{64}$/i.test(seed)) throw Error(file + " must hold 64 hex characters.");
  return authority(Buffer.from(seed, "hex"));
}

async function submit(escrow, data) {
  const { SPONSOR_MNEMONIC } = process.env;
  if (!SPONSOR_MNEMONIC) throw Error("Set SPONSOR_MNEMONIC to pay the fee.");
  const keys = nativeKeys(HDNodeWallet.fromPhrase(SPONSOR_MNEMONIC));
  const { info } = await chainRead("account", keys.account);
  // A rotation stores a 2,592-byte key: about 1.7 million gas with the check.
  const tx = signedCalls(keys, info, [crossVmMsg(keys.account, escrow, data)], 3000000n);
  const { tx_response: r } = await broadcast(encodeBase64(tx.txBytes));
  if (Number(r?.code) !== 0) throw Error("Refused: " + r?.raw_log);
  for (let i = 0; i < 40; i++) {
    await new Promise((ok) => setTimeout(ok, 1500));
    const { tx_response: d } = await chainRead("receipt", r.txhash);
    if (d) {
      if (Number(d.code) !== 0) throw Error("Failed: " + d.raw_log);
      return d.txhash;
    }
  }
  throw Error("Unconfirmed: " + r.txhash);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, arg] = process.argv.slice(2);
  const guardian = guardianKey();
  if (command === "key") {
    console.log("Guardian public key keccak256:", keccak256(guardian.publicKey));
  } else if (command === "rotate" || command === "freeze") {
    const address = process.env.ESCROW_ADDRESS;
    const rpc = new JsonRpcProvider(process.env.RPC_URL || TEST_RPC, 9800, { staticNetwork: true });
    const { abi } = JSON.parse(fs.readFileSync("dist/contract.json"));
    const escrow = new Contract(address, abi, rpc);
    if ((await escrow.guardianKey()) !== guardian.publicKey) throw Error("This seed is not the escrow's guardian.");
    const nonce = await escrow.guardianNonce();
    let data;
    if (command === "rotate") {
      if (!/^[0-9a-f]{64}$/i.test(arg || "")) throw Error("Give the new VERIFIER_SEED (64 hex).");
      const next = authority(Buffer.from(arg, "hex")).publicKey;
      const signature = guardian.sign(await escrow.rotateMessage(next, nonce));
      data = escrow.interface.encodeFunctionData("rotateVerifier", [next, nonce, signature]);
    } else {
      const signature = guardian.sign(await escrow.freezeMessage(nonce));
      data = escrow.interface.encodeFunctionData("freeze", [nonce, signature]);
    }
    console.log(command, "sent in", await submit(address, data));
    console.log("verifier key keccak256:", keccak256(await escrow.verifierKey()), "frozen:", await escrow.frozen());
  } else throw Error("Use: key | rotate <seed> | freeze");
}
