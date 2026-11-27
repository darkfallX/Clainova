const assert = require("node:assert/strict");
const hre = require("hardhat");
const E = require("ethers");
// Every rule here also holds for v3, which adds an ML-DSA-87 guardian (see
// escrow-v3.cjs). Each suite runs once per contract; v3 gets a placeholder
// guardian key, because these tests never use it.
const GUARDIAN = "0x" + "5a".repeat(2592);
const withGuardian = (name, args) => (name === "ClainovaClaimsV3" && args.length === 2 ? [...args, GUARDIAN] : args);
// ESCROW_ONLY limits a run to one contract (scripts/mutation-check.mjs uses it).
for (const NAME of ["ClainovaClaims", "ClainovaClaimsV3"].filter((n) => !process.env.ESCROW_ONLY || n === process.env.ESCROW_ONLY))
describe("Clainova escrow" + (NAME === "ClainovaClaimsV3" ? " (v3)" : ""), function () {
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
    ).deploy(...withGuardian(name, args));
    await c.waitForDeployment();
    return c;
  }
  before(async () => {
    artifacts = await require("./harness.cjs").compiled([
      "contracts/ClainovaClaims.sol", "contracts/ClainovaClaimsV3.sol",
      "tests/contract/Fixtures.sol",
    ]);
    signer = (await import("../../server/network.mjs")).authority(
      E.randomBytes(32),
    );
  });
  beforeEach(async () => {
    await require("./harness.cjs").freshChain();
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
    contract = await deploy(NAME, [token.target, signer.publicKey]);
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
      deploy(NAME, [token.target, new Uint8Array(2592)]),
    );
  });
  it("accepts tokens that return no data and rejects tokens that return false", async () => {
    const silent = await deploy("SilentTokenFixture");
    const escrow = await deploy(NAME, [silent.target, signer.publicKey]);
    await (await silent.mint(sender.address, 5)).wait();
    await (await silent.approve(escrow.target, 5)).wait();
    await (await escrow.fund(E.toBeHex(7, 32), 5, deadline)).wait();
    assert.equal(await silent.balanceOf(escrow.target), 5n);
    const liar = await deploy("FalseTokenFixture");
    const broken = await deploy(NAME, [liar.target, signer.publicKey]);
    await assert.rejects(broken.fund(E.toBeHex(8, 32), 5, deadline), /Deposit failed/);
  });
  it("blocks a token that re-enters during payout", async () => {
    const evil = await deploy("ReentrantTokenFixture");
    const escrow = await deploy(NAME, [evil.target, signer.publicKey]);
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
  it("has no way to change the verifier key, upgrade or delegate", async () => {
    const { abi, evm } = artifacts[NAME];
    const writes = abi
      .filter((x) => x.type === "function" && !["view", "pure"].includes(x.stateMutability))
      .map((x) => x.name)
      .sort();
    // v3 adds only its guardian's two calls, which never touch the token.
    assert.deepEqual(
      writes,
      NAME === "ClainovaClaimsV3" ? ["claim", "freeze", "fund", "refund", "rotateVerifier"] : ["claim", "fund", "refund"],
    );
    // Walks real opcodes, skipping pushed data and the metadata trailer.
    const code = E.getBytes("0x" + evm.deployedBytecode.object);
    const end = code.length - 2 - (code.at(-2) * 256 + code.at(-1));
    for (let i = 0; i < end; i++) {
      const op = code[i];
      assert.ok(![0xf2, 0xf4, 0xff].includes(op), "unexpected opcode at " + i);
      if (op >= 0x60 && op <= 0x7f) i += op - 0x5f;
    }
    const key = await contract.verifierKey();
    await (await collect()).wait();
    assert.equal(await contract.verifierKey(), key);
  });
  it("accepts an expiry of exactly 30 days and rejects past, longer and maximum values", async () => {
    const at = (await rpc.getBlock("latest")).timestamp + 100;
    const next = () =>
      hre.network.provider.send("evm_setNextBlockTimestamp", [at]);
    const max = 30 * 86400;
    const attempt = async (expiry) => {
      await next();
      return contract.fund.staticCall(E.toBeHex(5000, 32), 1, expiry, {
        blockTag: "pending",
      });
    };
    for (const bad of [at - 1, at, at + max + 1, 2n ** 64n - 1n])
      await assert.rejects(attempt(bad), /Invalid payment/);
    await attempt(at + 1);
    await next();
    await (await contract.fund(E.toBeHex(5000, 32), 1, at + max)).wait();
    assert.equal(await token.balanceOf(contract.target), 20000001n);
  });
  it("preserves escrow balances on duplicate and failed deposits", async () => {
    await assert.rejects(contract.fund(seed, 1, deadline));
    const next = E.toBeHex(999, 32);
    await assert.rejects(contract.connect(other).fund(next, 1, deadline));
    assert.equal(await token.balanceOf(contract.target), 20000000n);
  });
});
