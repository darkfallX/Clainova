// Mutation check: breaks one rule of the escrow at a time, runs the contract
// tests, and expects them to fail. Shows the tests would catch a real bug.
//   node scripts/mutation-check.mjs
// It edits contracts/ClainovaClaims.sol in place for each run and always
// restores the original bytes, then confirms the file is unchanged.
import fs from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";

const file = "contracts/ClainovaClaims.sol";
const original = fs.readFileSync(file);
const source = original.toString("utf8");
const digest = (b) => createHash("sha256").update(b).digest("hex");
const mutants = [
  ["claim deadline may exceed the payment expiry", "deadline <= payment.expiry", "true"],
  ["refund allowed one second early", "block.timestamp >= payment.expiry", "block.timestamp + 1 >= payment.expiry"],
  ["reentrancy guard removed", 'require(unlocked == 1, "Reentrant call");', ""],
  ["claim message ignores the caller", "message(id, msg.sender, deadline)", "message(id, payment.sender, deadline)"],
  ["proof of possession not required", "active && algorithm == 1 && proven", "active && algorithm == 1"],
  ["token returning false accepted", "(result.length == 32 && abi.decode(result, (bool)))", "result.length == 32"],
];
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
let caught = 0;
try {
  for (const [name, from, to] of mutants) {
    if (!source.includes(from)) throw Error("Mutation does not apply: " + name);
    fs.writeFileSync(file, source.replace(from, to));
    let out = "";
    try {
      out = execSync(npx + " hardhat test --no-compile", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      out = (e.stdout || "") + (e.stderr || "");
    }
    const failing = Number((out.match(/(\d+) failing/) || [0, 0])[1]);
    if (failing) caught++;
    console.log((failing ? "caught   " : "MISSED   ") + name + (failing ? ` (${failing} failing)` : ""));
  }
} finally {
  fs.writeFileSync(file, original);
}
if (digest(fs.readFileSync(file)) !== digest(original)) throw Error("Contract was not restored.");
console.log(`${caught} of ${mutants.length} broken versions caught. Contract restored.`);
process.exitCode = caught === mutants.length ? 0 : 1;
