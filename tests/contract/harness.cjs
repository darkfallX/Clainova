// Shared by the contract tests, so `npm run coverage` measures the same tests.
// Normally: contracts compiled with the build's own solc settings
// (scripts/compile.mjs), and a fresh chain per test via hardhat_reset.
// Under solidity-coverage: the escrow comes from the instrumented copy Hardhat
// compiled (the fixtures in this folder stay as they are), and the chain is reset
// with a snapshot instead, because the plugin attaches one more per-opcode
// listener on every hardhat_reset and a run would slow to a crawl.
const hre = require("hardhat");
const covering = () => Boolean(hre.__SOLIDITY_COVERAGE_RUNNING);

async function compiled(files) {
  const { compile } = await import("../../scripts/compile.mjs");
  const out = compile(files);
  if (!covering()) return out;
  for (const name of Object.keys(out)) {
    if (!(await hre.artifacts.artifactExists(name))) continue;
    const a = await hre.artifacts.readArtifact(name);
    out[name] = {
      abi: a.abi,
      evm: { bytecode: { object: a.bytecode.slice(2) }, deployedBytecode: { object: a.deployedBytecode.slice(2) } },
    };
  }
  return out;
}

let snapshot;
async function freshChain() {
  if (!covering()) return hre.network.provider.send("hardhat_reset");
  // The first call keeps the chain the plugin started, before any test touched it.
  if (snapshot !== undefined) await hre.network.provider.send("evm_revert", [snapshot]);
  snapshot = await hre.network.provider.send("evm_snapshot");
}

module.exports = { compiled, freshChain };
