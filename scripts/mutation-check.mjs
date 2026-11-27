// Mutation check: breaks one rule of the escrow at a time, runs the contract
// tests, and expects them to fail. Shows the tests would catch a real bug.
//   node scripts/mutation-check.mjs
// It edits contracts/ClainovaClaims.sol (v2, deployed) and ClainovaClaimsV3.sol
// in place for each run, always restores the original bytes, and then confirms
// each file is unchanged.
import fs from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";

const digest = (b) => createHash("sha256").update(b).digest("hex");
// The same six rules hold in both versions; v3 adds its guardian's.
const shared = [
  ["claim deadline may exceed the payment expiry", "deadline <= payment.expiry", "true"],
  ["refund allowed one second early", "block.timestamp >= payment.expiry", "block.timestamp + 1 >= payment.expiry"],
  ["reentrancy guard removed", 'require(unlocked == 1, "Reentrant call");', ""],
  ["claim message ignores the caller", "message(id, msg.sender, deadline)", "message(id, payment.sender, deadline)"],
  ["proof of possession not required", "active && algorithm == 1 && proven", "active && algorithm == 1"],
  ["token returning false accepted", "(result.length == 32 && abi.decode(result, (bool)))", "result.length == 32"],
];
const files = [
  ["contracts/ClainovaClaims.sol", shared],
  [
    "contracts/ClainovaClaimsV3.sol",
    [
      ...shared,
      ["v3: a stale guardian nonce accepted", 'require(nonce == guardianNonce, "Stale nonce");', ""],
      ["v3: the guardian nonce never advances", "guardianNonce = nonce + 1;", ""],
      ["v3: the guardian signature not checked", "PQ.pqcVerify(guardianKey, signature, signed)", "true"],
      ["v3: the rotation message ignores the new key", "address(this), nonce, keccak256(newKey));", "address(this), nonce, bytes32(0));"],
      ["v3: a freeze does not stop claims", 'require(!frozen, "Claims frozen");', ""],
      ["v3: a rotation keeps the freeze", "frozen = false;", ""],
      ["v3: the guardian may be the verifier", " && keccak256(key) != keccak256(guardian)", ""],
    ],
  ],
];
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
let caught = 0,
  total = 0;
for (const [file, mutants] of files) {
  const original = fs.readFileSync(file);
  const source = original.toString("utf8");
  try {
    for (const [name, from, to] of mutants) {
      if (!source.includes(from)) throw Error("Mutation does not apply: " + name);
      fs.writeFileSync(file, source.replace(from, to));
      let out = "";
      try {
        // Only the tests of the contract being broken run, which halves the time.
        out = execSync(npx + " hardhat test --no-compile", {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, ESCROW_ONLY: file.split("/").pop().replace(".sol", "") },
        });
      } catch (e) {
        out = (e.stdout || "") + (e.stderr || "");
      }
      const failing = Number((out.match(/(d+) failing/) || [0, 0])[1]);
      total++;
      if (failing) caught++;
      console.log((failing ? "caught   " : "MISSED   ") + file.split("/").pop() + ": " + name + (failing ? ` (${failing} failing)` : ""));
    }
  } finally {
    fs.writeFileSync(file, original);
  }
  if (digest(fs.readFileSync(file)) !== digest(original)) throw Error(file + " was not restored.");
}
console.log(`${caught} of ${total} broken versions caught. Contracts restored.`);
process.exitCode = caught === total ? 0 : 1;
