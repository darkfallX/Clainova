// ClainovaClaimsV3: the guardian. Payments behave as in v2; these tests cover
// what is new. Signatures are real ML-DSA-87, made with @qorechain/pqc; the
// Hardhat double for pqcVerify (0x0a01) accepts exactly the triples allowed here.
const assert = require("node:assert/strict");
const hre = require("hardhat");
const E = require("ethers");
(process.env.ESCROW_ONLY === "ClainovaClaims" ? describe.skip : describe)("Clainova escrow v3 guardian", function () {
  this.timeout(120000);
  let artifacts, rpc, sender, recipient, other, token, contract, check, registry, verifier, guardian, intruder;
  let seq = 0;
  const addr = (n) => E.getAddress(E.toBeHex(n, 20));
  async function deploy(name, args = []) {
    const a = artifacts[name];
    const c = await new E.ContractFactory(a.abi, a.evm.bytecode.object, sender).deploy(...args);
    await c.waitForDeployment();
    return c;
  }
  const allow = async (key, sig, data) => (await check.allow(key, sig, data)).wait();
  // A guardian message signed and made acceptable to the precompile double.
  async function guardianSigned(bytes, by = guardian) {
    const sig = by.sign(bytes);
    assert.ok(by.verify(bytes, sig));
    await allow(by.publicKey, sig, bytes);
    return sig;
  }
  async function fund(amount = 5000000, seconds = 600) {
    const now = (await rpc.getBlock("latest")).timestamp;
    const salt = E.toBeHex(++seq, 32);
    const id = E.keccak256(E.AbiCoder.defaultAbiCoder().encode(["address", "bytes32"], [sender.address, salt]));
    await (await contract.fund(salt, amount, now + seconds)).wait();
    return { id, expiry: now + seconds };
  }
  async function attestation(id, by = verifier, to = recipient.address) {
    const deadline = (await rpc.getBlock("latest")).timestamp + 300;
    const bytes = await contract.message(id, to, deadline);
    const sig = by.sign(bytes);
    await allow(by.publicKey, sig, bytes);
    return { deadline, sig };
  }
  before(async () => {
    artifacts = await require("./harness.cjs").compiled(["contracts/ClainovaClaimsV3.sol", "tests/contract/Fixtures.sol"]);
    const { authority } = await import("../../server/network.mjs");
    verifier = authority(E.randomBytes(32));
    guardian = authority(E.randomBytes(32));
    intruder = authority(E.randomBytes(32));
  });
  beforeEach(async () => {
    await require("./harness.cjs").freshChain();
    rpc = new E.BrowserProvider(hre.network.provider, undefined, { cacheTimeout: -1 });
    [sender, recipient, other] = await Promise.all([0, 1, 2].map((i) => rpc.getSigner(i)));
    async function inject(name, n) {
      const a = artifacts[name];
      await hre.network.provider.send("hardhat_setCode", [addr(n), "0x" + a.evm.deployedBytecode.object]);
      return new E.Contract(addr(n), a.abi, sender);
    }
    check = await inject("VerificationFixture", 2561);
    registry = await inject("RegistryFixture", 2562);
    token = await deploy("TokenFixture");
    contract = await deploy("ClainovaClaimsV3", [token.target, verifier.publicKey, guardian.publicKey]);
    await (await token.mint(sender.address, 100000000)).wait();
    await (await token.approve(contract.target, 100000000)).wait();
    await (await registry.register(recipient.address)).wait();
  });

  it("starts with both keys, nonce 0 and claims open", async () => {
    assert.equal(await contract.verifierKey(), verifier.publicKey);
    assert.equal(await contract.guardianKey(), guardian.publicKey);
    assert.equal(await contract.guardianNonce(), 0n);
    assert.equal(await contract.frozen(), false);
  });

  it("refuses a guardian key equal to the verifier key, empty, or the wrong length", async () => {
    const zero = "0x" + "00".repeat(2592);
    for (const g of [verifier.publicKey, zero, "0x" + "11".repeat(2591)])
      await assert.rejects(deploy("ClainovaClaimsV3", [token.target, verifier.publicKey, g]), /Invalid configuration/);
  });

  it("pays a claim exactly as v2 does", async () => {
    const { id } = await fund();
    const { deadline, sig } = await attestation(id);
    await (await contract.connect(recipient).claim(id, deadline, sig)).wait();
    assert.equal(await token.balanceOf(recipient.address), 5000000n);
    assert.equal((await contract.payments(id)).state, 2n);
  });

  it("rotates the verifier with a guardian signature, and old attestations stop working at once", async () => {
    const { id } = await fund();
    const old = await attestation(id);
    const next = (await import("../../server/network.mjs")).authority(E.randomBytes(32));
    const bytes = await contract.rotateMessage(next.publicKey, 0);
    const sig = await guardianSigned(bytes);
    // Anyone may submit it: the signature is the authority.
    const tx = await contract.connect(other).rotateVerifier(next.publicKey, 0, sig);
    const receipt = await tx.wait();
    const event = receipt.logs.map((l) => contract.interface.parseLog(l)).find((e) => e?.name === "VerifierRotated");
    assert.equal(event.args.keyHash, E.keccak256(next.publicKey));
    assert.equal(await contract.verifierKey(), next.publicKey);
    assert.equal(await contract.guardianNonce(), 1n);
    await assert.rejects(contract.connect(recipient).claim(id, old.deadline, old.sig), /Invalid attestation/);
    const fresh = await attestation(id, next);
    await (await contract.connect(recipient).claim(id, fresh.deadline, fresh.sig)).wait();
    assert.equal(await token.balanceOf(recipient.address), 5000000n);
  });

  it("refuses a rotation signed by anyone but the guardian, including the verifier", async () => {
    const next = "0x" + "22".repeat(2592);
    for (const by of [intruder, verifier]) {
      const sig = await guardianSigned(await contract.rotateMessage(next, 0), by);
      await assert.rejects(contract.rotateVerifier(next, 0, sig), /Invalid guardian signature/);
    }
    assert.equal(await contract.verifierKey(), verifier.publicKey);
  });

  it("uses each guardian signature once: a replay or a skipped nonce is refused", async () => {
    const a = "0x" + "33".repeat(2592), b = "0x" + "44".repeat(2592);
    const sigA = await guardianSigned(await contract.rotateMessage(a, 0));
    await (await contract.rotateVerifier(a, 0, sigA)).wait();
    await assert.rejects(contract.rotateVerifier(a, 0, sigA), /Stale nonce/);
    const sigSkip = await guardianSigned(await contract.rotateMessage(b, 2));
    await assert.rejects(contract.rotateVerifier(b, 2, sigSkip), /Stale nonce/);
    // A signature for one key can't install another.
    const sigB = await guardianSigned(await contract.rotateMessage(b, 1));
    await assert.rejects(contract.rotateVerifier(a, 1, sigB), /Invalid guardian signature/);
    await (await contract.rotateVerifier(b, 1, sigB)).wait();
    assert.equal(await contract.verifierKey(), b);
  });

  it("binds guardian messages to this chain, this contract and their purpose", async () => {
    const key = "0x" + "55".repeat(2592);
    const coder = E.AbiCoder.defaultAbiCoder();
    const rotate = await contract.ROTATE(), freezeTag = await contract.FREEZE();
    assert.equal(rotate, E.id("Clainova/rotate-verifier/v3"));
    assert.equal(freezeTag, E.id("Clainova/freeze-claims/v3"));
    assert.equal(
      await contract.rotateMessage(key, 7),
      coder.encode(["bytes32", "uint256", "address", "uint64", "bytes32"], [rotate, 31337, contract.target, 7, E.keccak256(key)]),
    );
    assert.equal(await contract.freezeMessage(7), coder.encode(["bytes32", "uint256", "address", "uint64"], [freezeTag, 31337, contract.target, 7]));
    // A freeze signature cannot pass as a rotation, nor one for a twin contract.
    const freezeSig = await guardianSigned(await contract.freezeMessage(0));
    await assert.rejects(contract.rotateVerifier(key, 0, freezeSig), /Invalid guardian signature/);
    const twin = await deploy("ClainovaClaimsV3", [token.target, verifier.publicKey, guardian.publicKey]);
    const twinSig = await guardianSigned(await twin.rotateMessage(key, 0));
    await assert.rejects(contract.rotateVerifier(key, 0, twinSig), /Invalid guardian signature/);
  });

  it("refuses an empty key, the wrong length, or the guardian's own key as the new verifier", async () => {
    for (const key of ["0x" + "00".repeat(2592), "0x" + "66".repeat(2593), guardian.publicKey]) {
      const sig = await guardianSigned(await contract.rotateMessage(key, 0)).catch(() => "0x");
      await assert.rejects(contract.rotateVerifier(key, 0, sig), /Invalid key/);
    }
  });

  it("refuses a guardian signature of the wrong length", async () => {
    const key = "0x" + "77".repeat(2592);
    const bytes = await contract.rotateMessage(key, 0);
    const short = "0x" + "aa".repeat(4626);
    await allow(guardian.publicKey, short, bytes);
    await assert.rejects(contract.rotateVerifier(key, 0, short), /Invalid guardian signature/);
  });

  it("freezes claims but never funding or refunds, and a rotation lifts the freeze", async () => {
    const { id, expiry } = await fund(5000000, 100);
    const valid = await attestation(id);
    const sig = await guardianSigned(await contract.freezeMessage(0));
    const receipt = await (await contract.connect(other).freeze(0, sig)).wait();
    assert.ok(receipt.logs.some((l) => contract.interface.parseLog(l)?.name === "ClaimsFrozen"));
    assert.equal(await contract.frozen(), true);
    await assert.rejects(contract.connect(recipient).claim(id, valid.deadline, valid.sig), /Claims frozen/);
    await fund(1000000);
    await hre.network.provider.send("evm_setNextBlockTimestamp", [expiry]);
    const before = await token.balanceOf(sender.address);
    await (await contract.connect(other).refund(id)).wait();
    assert.equal(await token.balanceOf(sender.address), before + 5000000n);
    const next = (await import("../../server/network.mjs")).authority(E.randomBytes(32));
    const rot = await guardianSigned(await contract.rotateMessage(next.publicKey, 1));
    await (await contract.rotateVerifier(next.publicKey, 1, rot)).wait();
    assert.equal(await contract.frozen(), false);
  });

  it("gives the guardian no way to move funds: its calls never touch the token", async () => {
    const { id } = await fund();
    const escrowed = await token.balanceOf(contract.target);
    const key = (await import("../../server/network.mjs")).authority(E.randomBytes(32)).publicKey;
    await (await contract.rotateVerifier(key, 0, await guardianSigned(await contract.rotateMessage(key, 0)))).wait();
    await (await contract.freeze(1, await guardianSigned(await contract.freezeMessage(1)))).wait();
    assert.equal(await token.balanceOf(contract.target), escrowed);
    assert.equal((await contract.payments(id)).state, 1n);
    const writes = contract.interface.fragments
      .filter((f) => f.type === "function" && !["view", "pure"].includes(f.stateMutability))
      .map((f) => f.name)
      .sort();
    assert.deepEqual(writes, ["claim", "freeze", "fund", "refund", "rotateVerifier"]);
    const code = await rpc.getCode(contract.target);
    // No CALLCODE, DELEGATECALL or SELFDESTRUCT anywhere in the runtime code.
    const ops = [];
    for (let i = 2; i < code.length; i += 2) {
      const op = parseInt(code.slice(i, i + 2), 16);
      ops.push(op);
      if (op >= 0x60 && op <= 0x7f) i += (op - 0x5f) * 2;
    }
    for (const banned of [0xf2, 0xf4, 0xff]) assert.ok(!ops.includes(banned));
  });
});
