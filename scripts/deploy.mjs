import fs from "node:fs";
import { ContractFactory, Wallet, JsonRpcProvider } from "ethers";
import { authority, TEST_RPC } from "../server/network.mjs";
import { FEST } from "../server/common.mjs";
const { VERIFIER_SEED, DEPLOYER_PRIVATE_KEY } = process.env;
if (!/^[0-9a-f]{64}$/i.test(VERIFIER_SEED || "") || !DEPLOYER_PRIVATE_KEY)
  throw Error("Set VERIFIER_SEED and DEPLOYER_PRIVATE_KEY for Diana first.");
const rpc = new JsonRpcProvider(process.env.RPC_URL || TEST_RPC);
if ((await rpc.getNetwork()).chainId !== 9800n)
  throw Error("Diana chain 9800 required.");
const { abi, bytecode } = JSON.parse(fs.readFileSync("dist/contract.json"));
const factory = new ContractFactory(
  abi,
  bytecode,
  new Wallet(DEPLOYER_PRIVATE_KEY, rpc),
);
const instance = await factory.deploy(
  FEST,
  authority(Buffer.from(VERIFIER_SEED, "hex")).publicKey,
);
await instance.waitForDeployment();
console.log("ESCROW_ADDRESS=" + (await instance.getAddress()));
console.log("Deployment transaction", instance.deploymentTransaction().hash);
