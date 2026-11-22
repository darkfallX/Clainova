import { AbiCoder, id, keccak256, getAddress, isAddress } from "ethers";
import { createHash, randomBytes } from "node:crypto";
export const FEST = "0x97143B771D34ddb9130b807b135Ae675A5a963CA";
export const now = () => Math.floor(Date.now() / 1000);
export const secret = () => randomBytes(32).toString("hex");
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const coder = AbiCoder.defaultAbiCoder();
export const claimId = (sender, salt) =>
  keccak256(coder.encode(["address", "bytes32"], [sender, salt]));
export const message = (chain, contract, claim, destination, expiry) =>
  coder.encode(
    ["bytes32", "uint256", "address", "bytes32", "address", "uint64"],
    [id("Clainova/collect/v1"), chain, contract, claim, destination, expiry],
  );
export function requireThat(condition, reason, status = 400) {
  if (!condition) throw Object.assign(new Error(reason), { status });
}
export function address(input) {
  requireThat(
    typeof input === "string" && isAddress(input) && BigInt(input) !== 0n,
    "Enter a valid wallet address.",
  );
  return getAddress(input);
}
export function paymentInput(input) {
  const phone = String(input.phone || "").replace(/[ ()-]/g, "");
  requireThat(
    /^(?:\+234[1-9]\d{9}|\+254[1-9]\d{8}|\+233[1-9]\d{8}|\+27[1-9]\d{8})$/.test(
      phone,
    ),
    "Enter a full mobile number in Nigeria, Kenya, Ghana or South Africa.",
  );
  requireThat(
    /^\d{1,5}(\.\d{1,6})?$/.test(String(input.amount)),
    "Enter an amount with up to six decimal places.",
  );
  const [whole, part = ""] = String(input.amount).split(".");
  const amount = Number(whole) * 1e6 + Number(part.padEnd(6, "0"));
  requireThat(
    amount > 0 && amount <= 10000e6,
    "Enter an amount above zero and at most 10,000 test fUSD.",
  );
  requireThat(
    typeof input.note === "string" && input.note.length <= 80,
    "Use up to 80 characters for the payment note.",
  );
  return { phone, amount, note: input.note.trim() };
}
