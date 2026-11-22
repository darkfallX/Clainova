const assert = require("node:assert/strict");
const hre = require("hardhat");
const E = require("ethers");
describe("Clainova escrow", function () {
  this.timeout(60000);
  let artifacts,
    rpc,
    sender,
    recipient,
    other,
    token,
    contract,
    check,
    registry,
    seed,
    deadline,
    id,
    attest,
    signer,
    seq = 0;
  const addr = (n) => E.getAddress(E.toBeHex(n, 20));
  async function deploy(name, args = []) {
    const a = artifacts[name];
    const c = await new E.ContractFactory(
      a.abi,
      a.evm.bytecode.object,
      sender,
    ).deploy(...args);
    await c.waitForDeployment();
    return c;
  }
  before(async () => {
    const { compile } = await import("../../scripts/compile.mjs");
    artifacts = compile([
      "contracts/ClainovaClaims.sol",
      "tests/contract/Fixtures.sol",
    ]);
    signer = (await import("../../server/network.mjs")).authority(
      E.randomBytes(32),
    );
  });
  beforeEach(async () => {
    await hre.network.provider.send("hardhat_reset");
    rpc = new E.BrowserProvider(hre.network.provider, undefined, {
      cacheTimeout: -1,
    });
    [sender, recipient, other] = await Promise.all(
      [0, 1, 2].map((i) => rpc.getSigner(i)),
    );
    async function inject(name, n) {
      const a = artifacts[name];
      await hre.network.provider.send("hardhat_setCode", [
        addr(n),
        "0x" + a.evm.deployedBytecode.object,
      ]);
      return new E.Contract(addr(n), a.abi, sender);
    }
    check = await inject("VerificationFixture", 2561);
    registry = await inject("RegistryFixture", 2562);
    token = await deploy("TokenFixture");
    contract = await deploy("ClainovaClaims", [token.target, signer.publicKey]);
    await (await token.mint(sender.address, 100000000)).wait();
    await (await token.approve(contract.target, 100000000)).wait();
    deadline = (await rpc.getBlock("latest")).timestamp + 600;
    seed = E.toBeHex(++seq, 32);
    id = E.keccak256(
      E.AbiCoder.defaultAbiCoder().encode(
        ["address", "bytes32"],
        [sender.address, seed],
      ),
    );
    await (await contract.fund(seed, 20000000, deadline)).wait();
    const bytes = await contract.message(id, recipient.address, deadline);
    const { message } = await import("../../server/common.mjs");
    assert.equal(
      bytes,
      message(31337, contract.target, id, recipient.address, deadline),
    );
    attest = signer.sign(bytes);
    assert.ok(signer.verify(bytes, attest));
    await (await check.allow(signer.publicKey, attest, bytes)).wait();
    await (await registry.register(recipient.address)).wait();
  });
  const collect = () => contract.connect(recipient).claim(id, deadline, attest);
  it("pays the named recipient exactly once", async () => {
    await (await collect()).wait();
    assert.equal(await token.balanceOf(recipient.address), 20000000n);
    await assert.rejects(collect);
  });
  it("rejects an unproven key", async () => {
    await assert.rejects(contract.connect(other).claim(id, deadline, attest));
  });
  it("rejects wrong destination and forged attestations", async () => {
    await (await registry.register(other.address)).wait();
    await assert.rejects(contract.connect(other).claim(id, deadline, attest));
    await assert.rejects(
      contract
        .connect(recipient)
        .claim(id, deadline, E.hexlify(E.randomBytes(4627))),
    );
  });
  it("binds chain, claim, contract and deadline", async () => {
    const { message } = await import("../../server/common.mjs");
    for (const args of [
      [1, contract.target, id, deadline],
      [31337, other.address, id, deadline],
      [31337, contract.target, E.ZeroHash, deadline],
      [31337, contract.target, id, deadline - 1],
    ]) {
      const bytes = message(
        args[0],
        args[1],
        args[2],
        recipient.address,
        args[3],
      );
      const sig = signer.sign(bytes);
      await (await check.allow(signer.publicKey, sig, bytes)).wait();
      await assert.rejects(
        contract.connect(recipient).claim(id, deadline, sig),
      );
    }
  });
  it("refunds only the sender at expiry even when called by a stranger", async () => {
    await assert.rejects(contract.connect(other).refund(id));
    await hre.network.provider.send("evm_setNextBlockTimestamp", [deadline]);
    await hre.network.provider.send("evm_mine");
    await assert.rejects(collect);
    await (await contract.connect(other).refund(id)).wait();
    assert.equal(await token.balanceOf(sender.address), 100000000n);
    await assert.rejects(contract.refund(id));
  });
  it("preserves escrow balances on duplicate and failed deposits", async () => {
    await assert.rejects(contract.fund(seed, 1, deadline));
    const next = E.toBeHex(999, 32);
    await assert.rejects(contract.connect(other).fund(next, 1, deadline));
    assert.equal(await token.balanceOf(contract.target), 20000000n);
  });
});
