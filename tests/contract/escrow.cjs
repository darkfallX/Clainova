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
  it("rejects a verifier key of zeros at deployment", async () => {
    await assert.rejects(
      deploy("ClainovaClaims", [token.target, new Uint8Array(2592)]),
    );
  });
  it("accepts tokens that return no data and rejects tokens that return false", async () => {
    const silent = await deploy("SilentTokenFixture");
    const escrow = await deploy("ClainovaClaims", [silent.target, signer.publicKey]);
    await (await silent.mint(sender.address, 5)).wait();
    await (await silent.approve(escrow.target, 5)).wait();
    await (await escrow.fund(E.toBeHex(7, 32), 5, deadline)).wait();
    assert.equal(await silent.balanceOf(escrow.target), 5n);
    const liar = await deploy("FalseTokenFixture");
    const broken = await deploy("ClainovaClaims", [liar.target, signer.publicKey]);
    await assert.rejects(broken.fund(E.toBeHex(8, 32), 5, deadline), /Deposit failed/);
  });
  it("blocks a token that re-enters during payout", async () => {
    const evil = await deploy("ReentrantTokenFixture");
    const escrow = await deploy("ClainovaClaims", [evil.target, signer.publicKey]);
    await (await evil.mint(sender.address, 50)).wait();
    await (await evil.approve(escrow.target, 50)).wait();
    const salt = E.toBeHex(9, 32);
    const pid = E.keccak256(
      E.AbiCoder.defaultAbiCoder().encode(["address", "bytes32"], [sender.address, salt]),
    );
    await (await escrow.fund(salt, 50, deadline)).wait();
    const bytes = await escrow.message(pid, recipient.address, deadline);
    const sig = signer.sign(bytes);
    await (await check.allow(signer.publicKey, sig, bytes)).wait();
    // During the payout transfer the token tries to call claim again.
    await (
      await evil.arm(escrow.target, escrow.interface.encodeFunctionData("claim", [pid, deadline, sig]))
    ).wait();
    await assert.rejects(escrow.connect(recipient).claim(pid, deadline, sig));
    assert.equal(await evil.balanceOf(escrow.target), 50n);
    assert.equal((await escrow.payments(pid)).state, 1n);
    // Control: the same claim succeeds once the token stops re-entering.
    await (await evil.arm(E.ZeroAddress, "0x")).wait();
    await (await escrow.connect(recipient).claim(pid, deadline, sig)).wait();
    assert.equal(await evil.balanceOf(recipient.address), 50n);
  });
  it("preserves escrow balances on duplicate and failed deposits", async () => {
    await assert.rejects(contract.fund(seed, 1, deadline));
    const next = E.toBeHex(999, 32);
    await assert.rejects(contract.connect(other).fund(next, 1, deadline));
    assert.equal(await token.balanceOf(contract.target), 20000000n);
  });
});
