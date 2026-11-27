// Rule-by-rule tests for ClainovaClaims. Each test checks one behaviour of the
// deployed source, including the exact boundaries. Precompiles are test doubles
// injected at their Diana addresses (0x0a01, 0x0a02) in Hardhat's in-memory EVM.
const assert = require("node:assert/strict");
const hre = require("hardhat");
const E = require("ethers");

const DAY = 86400;
const LEN = 4627;
// Every rule here also holds for v3, which adds an ML-DSA-87 guardian (see
// escrow-v3.cjs). Each suite runs once per contract; v3 gets a placeholder
// guardian key, because these tests never use it.
const GUARDIAN = "0x" + "5a".repeat(2592);
const withGuardian = (name, args) => (name === "ClainovaClaimsV3" && args.length === 2 ? [...args, GUARDIAN] : args);
// ESCROW_ONLY limits a run to one contract (scripts/mutation-check.mjs uses it).
for (const NAME of ["ClainovaClaims", "ClainovaClaimsV3"].filter((n) => !process.env.ESCROW_ONLY || n === process.env.ESCROW_ONLY))
describe("ClainovaClaims rules" + (NAME === "ClainovaClaimsV3" ? " (v3)" : ""), function () {
  this.timeout(120000);
  let A, rpc, accounts, sender, recipient, other, token, escrow, check, registry, signer, message;
  const addr = (n) => E.getAddress(E.toBeHex(n, 20));
  const salt = (n) => E.toBeHex(n, 32);
  const pid = (from, s) => E.keccak256(E.AbiCoder.defaultAbiCoder().encode(["address", "bytes32"], [from, s]));
  const now = async () => (await rpc.getBlock("latest")).timestamp;
  const at = (t) => hre.network.provider.send("evm_setNextBlockTimestamp", [t]);
  const mine = (t) => hre.network.provider.send("evm_mine", t ? [t] : []);
  const wait = async (p) => (await p).wait();
  async function deploy(name, args = [], from = sender) {
    const a = A[name];
    const c = await new E.ContractFactory(a.abi, a.evm.bytecode.object, from).deploy(...withGuardian(name, args));
    await c.waitForDeployment();
    return c;
  }
  async function inject(name, n) {
    await hre.network.provider.send("hardhat_setCode", [addr(n), "0x" + A[name].evm.deployedBytecode.object]);
    return new E.Contract(addr(n), A[name].abi, sender);
  }
  async function fund(s, amount, expiry, from = sender, on = escrow) {
    await wait(on.connect(from).fund(salt(s), amount, expiry));
    return pid(from.address, salt(s));
  }
  async function attest(id, dest, deadline, on = escrow) {
    const bytes = await on.message(id, dest, deadline);
    const sig = signer.sign(bytes);
    await wait(check.allow(signer.publicKey, sig, bytes));
    return sig;
  }
  async function reverts(p, reason) {
    await assert.rejects(p, reason ? new RegExp(reason) : undefined);
  }

  before(async () => {
    A = await require("./harness.cjs").compiled(["contracts/ClainovaClaims.sol", "contracts/ClainovaClaimsV3.sol", "tests/contract/Fixtures.sol"]);
    signer = (await import("../../server/network.mjs")).authority(E.randomBytes(32));
    ({ message } = await import("../../server/common.mjs"));
  });
  beforeEach(async () => {
    await require("./harness.cjs").freshChain();
    rpc = new E.BrowserProvider(hre.network.provider, undefined, { cacheTimeout: -1 });
    accounts = await Promise.all([...Array(12).keys()].map((i) => rpc.getSigner(i)));
    [sender, recipient, other] = accounts;
    check = await inject("VerificationFixture", 2561);
    registry = await inject("RegistryFixture", 2562);
    token = await deploy("TokenFixture");
    escrow = await deploy(NAME, [token.target, signer.publicKey]);
    for (const a of accounts.slice(0, 4)) {
      await wait(token.mint(a.address, 10n ** 30n));
      await wait(token.connect(a).approve(escrow.target, 10n ** 30n));
    }
    await wait(registry.register(recipient.address));
  });

  describe("deployment", () => {
    it("stores the token", async () => assert.equal(await escrow.token(), token.target));
    it("stores the verifier key exactly", async () => assert.equal(await escrow.verifierKey(), signer.publicKey));
    it("exposes the domain tag", async () => assert.equal(await escrow.DOMAIN(), E.id("Clainova/collect/v1")));
    it("exposes a 30-day maximum period", async () => assert.equal(await escrow.MAX_PERIOD(), BigInt(30 * DAY)));
    it("refuses a token address with no code", async () => reverts(deploy(NAME, [other.address, signer.publicKey]), "Invalid configuration"));
    for (const n of [0, 1, 2591, 2593, 4627])
      it(`refuses a ${n}-byte verifier key`, async () => reverts(deploy(NAME, [token.target, new Uint8Array(n).fill(1)]), "Invalid configuration"));
    it("accepts a key whose only non-zero byte is the last", async () => {
      const key = new Uint8Array(2592);
      key[2591] = 1;
      await deploy(NAME, [token.target, key]);
    });
    it("rejects plain QOR sent to it", async () =>
      reverts(sender.sendTransaction({ to: escrow.target, value: 1n })));
    it("rejects calls to functions it does not have", async () =>
      reverts(sender.sendTransaction({ to: escrow.target, data: "0xdeadbeef" })));
  });

  describe("funding", () => {
    it("records sender, expiry, state, amount and an empty recipient", async () => {
      const exp = (await now()) + DAY;
      const id = await fund(1, 25, exp);
      const p = await escrow.payments(id);
      assert.deepEqual([p.sender, p.expiry, p.state, p.amount, p.recipient], [sender.address, BigInt(exp), 1n, 25n, E.ZeroAddress]);
    });
    it("emits Funded with the payment id, sender, amount and expiry", async () => {
      const exp = (await now()) + DAY;
      const r = await wait(escrow.fund(salt(2), 7, exp));
      const ev = escrow.interface.parseLog(r.logs.find((l) => l.address === escrow.target));
      assert.deepEqual([ev.name, ev.args.id, ev.args.sender, ev.args.amount, ev.args.expiry], ["Funded", pid(sender.address, salt(2)), sender.address, 7n, BigInt(exp)]);
    });
    it("returns keccak256(sender, salt) as the id", async () => {
      const id = await escrow.fund.staticCall(salt(3), 1, (await now()) + DAY);
      assert.equal(id, pid(sender.address, salt(3)));
    });
    it("moves exactly the amount from sender to escrow", async () => {
      const before = await token.balanceOf(sender.address);
      await fund(4, 123456, (await now()) + DAY);
      assert.equal(before - (await token.balanceOf(sender.address)), 123456n);
      assert.equal(await token.balanceOf(escrow.target), 123456n);
    });
    it("refuses an amount of zero", async () => reverts(escrow.fund(salt(5), 0, (await now()) + DAY), "Invalid payment"));
    it("accepts the largest uint128 amount", async () => {
      const max = 2n ** 128n - 1n;
      await wait(token.mint(sender.address, max));
      await wait(token.approve(escrow.target, max));
      await fund(6, max, (await now()) + DAY);
      assert.equal((await escrow.payments(pid(sender.address, salt(6)))).amount, max);
    });
    it("gives two senders using the same salt two different payments", async () => {
      const exp = (await now()) + DAY;
      const a = await fund(7, 1, exp, sender);
      const b = await fund(7, 2, exp, other);
      assert.notEqual(a, b);
      assert.equal((await escrow.payments(a)).amount, 1n);
      assert.equal((await escrow.payments(b)).amount, 2n);
    });
    it("refuses a second payment with the same sender and salt", async () => {
      const exp = (await now()) + DAY;
      await fund(8, 1, exp);
      await reverts(escrow.fund(salt(8), 1, exp), "Duplicate payment");
    });
    it("refuses a reused salt even after the first payment was collected", async () => {
      const exp = (await now()) + DAY;
      const id = await fund(9, 1, exp);
      await wait(escrow.connect(recipient).claim(id, exp, await attest(id, recipient.address, exp)));
      await reverts(escrow.fund(salt(9), 1, exp), "Duplicate payment");
    });
    it("refuses a reused salt even after a refund", async () => {
      const t = await now();
      const id = await fund(10, 1, t + 60);
      await at(t + 60);
      await wait(escrow.refund(id));
      await reverts(escrow.fund(salt(10), 1, t + 3600), "Duplicate payment");
    });
    it("refuses a deposit without allowance and leaves no record", async () => {
      const fresh = accounts[5];
      await wait(token.mint(fresh.address, 100));
      await reverts(escrow.connect(fresh).fund(salt(11), 10, (await now()) + DAY));
      assert.equal((await escrow.payments(pid(fresh.address, salt(11)))).state, 0n);
    });
    it("refuses a deposit larger than the allowance", async () => {
      const fresh = accounts[5];
      await wait(token.mint(fresh.address, 100));
      await wait(token.connect(fresh).approve(escrow.target, 9));
      await reverts(escrow.connect(fresh).fund(salt(12), 10, (await now()) + DAY));
    });
    it("refuses a deposit larger than the balance", async () => {
      const fresh = accounts[5];
      await wait(token.mint(fresh.address, 9));
      await wait(token.connect(fresh).approve(escrow.target, 100));
      await reverts(escrow.connect(fresh).fund(salt(13), 10, (await now()) + DAY));
    });
    it("lets a refused deposit be retried with the same salt", async () => {
      const fresh = accounts[5];
      await wait(token.mint(fresh.address, 100));
      const exp = (await now()) + DAY;
      await reverts(escrow.connect(fresh).fund(salt(14), 10, exp));
      await wait(token.connect(fresh).approve(escrow.target, 10));
      await wait(escrow.connect(fresh).fund(salt(14), 10, exp));
      assert.equal(await token.balanceOf(escrow.target), 10n);
    });
    for (const [label, offset] of [["now", 0], ["one second ago", -1], ["30 days and one second ahead", 30 * DAY + 1], ["a year ahead", 365 * DAY]])
      it(`refuses an expiry of ${label}`, async () => {
        const t = (await now()) + 10;
        await at(t);
        await reverts(escrow.fund(salt(15), 1, t + offset), "Invalid payment");
      });
    for (const [label, offset] of [["one second ahead", 1], ["one hour ahead", 3600], ["exactly 30 days ahead", 30 * DAY]])
      it(`accepts an expiry ${label}`, async () => {
        const t = (await now()) + 10;
        await at(t);
        await wait(escrow.fund(salt(16), 1, t + offset));
      });
  });

  describe("message", () => {
    it("matches the server's encoding byte for byte", async () => {
      const id = salt(20), d = 1_900_000_000;
      assert.equal(await escrow.message(id, recipient.address, d), message(31337, escrow.target, id, recipient.address, d));
    });
    it("starts with the domain tag and the chain id", async () => {
      const [domain, chain] = E.AbiCoder.defaultAbiCoder().decode(["bytes32", "uint256"], await escrow.message(salt(21), recipient.address, 5));
      assert.deepEqual([domain, chain], [E.id("Clainova/collect/v1"), 31337n]);
    });
    it("changes when any one field changes", async () => {
      const base = [salt(22), recipient.address, 100];
      const seen = new Set([await escrow.message(...base)]);
      for (const v of [[salt(23), base[1], 100], [base[0], other.address, 100], [base[0], base[1], 101]])
        seen.add(await escrow.message(...v));
      const second = await deploy(NAME, [token.target, signer.publicKey]);
      seen.add(await second.message(...base));
      assert.equal(seen.size, 5);
    });
    it("can be read for an unknown payment", async () => assert.ok((await escrow.message(salt(24), other.address, 1)).length > 2));
  });

  describe("collection", () => {
    let id, exp, sig;
    beforeEach(async () => {
      exp = (await now()) + DAY;
      id = await fund(30, 40, exp);
      sig = await attest(id, recipient.address, exp);
    });
    const claim = (s = sig, d = exp, who = recipient, which = id) => escrow.connect(who).claim(which, d, s);
    it("emits Collected with the payment id and recipient", async () => {
      const r = await wait(claim());
      const ev = escrow.interface.parseLog(r.logs.find((l) => l.address === escrow.target));
      assert.deepEqual([ev.name, ev.args.id, ev.args.recipient], ["Collected", id, recipient.address]);
    });
    it("marks the payment collected and names the recipient", async () => {
      await wait(claim());
      const p = await escrow.payments(id);
      assert.deepEqual([p.state, p.recipient, p.amount], [2n, recipient.address, 40n]);
    });
    it("pays the exact amount and empties the escrow", async () => {
      const before = await token.balanceOf(recipient.address);
      await wait(claim());
      assert.equal((await token.balanceOf(recipient.address)) - before, 40n);
      assert.equal(await token.balanceOf(escrow.target), 0n);
    });
    it("works one second before the attestation deadline", async () => {
      const d = (await now()) + 100;
      const s = await attest(id, recipient.address, d);
      await at(d - 1);
      await wait(claim(s, d));
    });
    it("works with a deadline equal to the payment expiry", async () => wait(claim()));
    it("refuses at the attestation deadline", async () => {
      const d = (await now()) + 100;
      const s = await attest(id, recipient.address, d);
      await at(d);
      await reverts(claim(s, d), "Signature expired");
    });
    it("refuses a deadline beyond the payment expiry, even when signed", async () => {
      const s = await attest(id, recipient.address, exp + 1);
      await reverts(claim(s, exp + 1), "Signature expired");
    });
    it("refuses after the payment expiry", async () => {
      await at(exp);
      await reverts(claim(), "Signature expired");
    });
    it("refuses an unknown payment", async () => reverts(claim(sig, exp, recipient, salt(31)), "Payment closed"));
    it("refuses a second collection", async () => {
      await wait(claim());
      await reverts(claim(), "Payment closed");
    });
    it("refuses after a refund", async () => {
      const t = await now();
      const id2 = await fund(32, 5, t + 50);
      const s2 = await attest(id2, recipient.address, t + 50);
      await at(t + 50);
      await wait(escrow.refund(id2));
      await reverts(claim(s2, t + 50, recipient, id2), "Payment closed");
    });
    for (const [label, active, algo, proven] of [
      ["an inactive key", false, 1, true],
      ["a key of another algorithm", true, 2, true],
      ["algorithm zero", true, 0, true],
      ["a key without proof of possession", true, 1, false],
      ["no key at all", false, 0, false],
    ])
      it(`refuses a recipient with ${label}`, async () => {
        const status = await inject("StatusFixture", 2562);
        await wait(status.set(recipient.address, active, algo, proven));
        await reverts(claim(), "possession-proven ML-DSA key");
      });
    it("accepts a recipient whose key is active, ML-DSA and proven", async () => {
      const status = await inject("StatusFixture", 2562);
      await wait(status.set(recipient.address, true, 1, true));
      await wait(claim());
    });
    for (const n of [0, 1, 64, 4626, 4628, 9254])
      it(`refuses a ${n}-byte signature`, async () => reverts(claim(E.hexlify(new Uint8Array(n).fill(7))), "Invalid attestation"));
    it("refuses a random signature of the right length", async () => reverts(claim(E.hexlify(E.randomBytes(LEN))), "Invalid attestation"));
    it("refuses the real signature with one byte changed", async () => {
      const b = E.getBytes(sig);
      b[100] ^= 1;
      await reverts(claim(E.hexlify(b)), "Invalid attestation");
    });
    it("refuses a signature by a different verifier key", async () => {
      const rogue = (await import("../../server/network.mjs")).authority(E.randomBytes(32));
      const bytes = await escrow.message(id, recipient.address, exp);
      const s = rogue.sign(bytes);
      await wait(check.allow(rogue.publicKey, s, bytes));
      await reverts(claim(s), "Invalid attestation");
    });
    it("refuses an attestation made for another payment", async () => {
      const id2 = await fund(33, 1, exp);
      const s2 = await attest(id2, recipient.address, exp);
      await reverts(claim(s2), "Invalid attestation");
    });
    it("refuses an attestation made for another escrow", async () => {
      const second = await deploy(NAME, [token.target, signer.publicKey]);
      const s2 = await attest(id, recipient.address, exp, second);
      await reverts(claim(s2), "Invalid attestation");
    });
    it("refuses an attestation made for another deadline", async () => reverts(claim(sig, exp - 1), "Invalid attestation"));
    for (const k of [2, 3, 4, 6, 8, 11])
      it(`refuses registered wallet #${k} presenting the recipient's signature`, async () => {
        await wait(registry.register(accounts[k].address));
        await reverts(claim(sig, exp, accounts[k]), "Invalid attestation");
      });
    it("leaves funds and state untouched after a refused claim", async () => {
      await reverts(claim(E.hexlify(E.randomBytes(LEN))));
      const p = await escrow.payments(id);
      assert.deepEqual([p.state, p.recipient], [1n, E.ZeroAddress]);
      assert.equal(await token.balanceOf(escrow.target), 40n);
    });
    it("lets the sender attested as recipient collect their own payment", async () => {
      await wait(registry.register(sender.address));
      const s = await attest(id, sender.address, exp);
      await wait(claim(s, exp, sender));
      assert.equal((await escrow.payments(id)).recipient, sender.address);
    });
  });

  describe("refund", () => {
    let id, exp;
    beforeEach(async () => {
      exp = (await now()) + 1000;
      id = await fund(40, 9, exp);
    });
    it("is refused one second before expiry", async () => {
      await at(exp - 1);
      await reverts(escrow.refund(id), "Refund unavailable");
    });
    it("works at exactly the expiry", async () => {
      await at(exp);
      await wait(escrow.refund(id));
    });
    it("works long after the expiry", async () => {
      await at(exp + 365 * DAY);
      await wait(escrow.refund(id));
    });
    it("emits Refunded with the payment id and sender", async () => {
      await at(exp);
      const r = await wait(escrow.connect(other).refund(id));
      const ev = escrow.interface.parseLog(r.logs.find((l) => l.address === escrow.target));
      assert.deepEqual([ev.name, ev.args.id, ev.args.sender], ["Refunded", id, sender.address]);
    });
    it("pays the sender even when the recipient triggers it", async () => {
      const before = await token.balanceOf(sender.address);
      await at(exp);
      await wait(escrow.connect(recipient).refund(id));
      assert.equal((await token.balanceOf(sender.address)) - before, 9n);
      assert.equal(await token.balanceOf(recipient.address), 10n ** 30n);
    });
    it("marks the payment refunded and keeps the amount on record", async () => {
      await at(exp);
      await wait(escrow.refund(id));
      const p = await escrow.payments(id);
      assert.deepEqual([p.state, p.amount, p.recipient], [3n, 9n, E.ZeroAddress]);
    });
    it("is refused twice", async () => {
      await at(exp);
      await wait(escrow.refund(id));
      await reverts(escrow.refund(id), "Refund unavailable");
    });
    it("is refused for an unknown payment", async () => reverts(escrow.refund(salt(41)), "Refund unavailable"));
    it("is refused after collection, even past expiry", async () => {
      await wait(escrow.connect(recipient).claim(id, exp, await attest(id, recipient.address, exp)));
      await at(exp + 10);
      await reverts(escrow.refund(id), "Refund unavailable");
    });
  });

  describe("accounting across payments", () => {
    it("keeps the escrow balance equal to the open payments", async () => {
      const t = await now();
      const ids = [];
      for (let i = 0; i < 6; i++) ids.push(await fund(50 + i, (i + 1) * 100, t + 2000 + i));
      await wait(escrow.connect(recipient).claim(ids[0], t + 2000, await attest(ids[0], recipient.address, t + 2000)));
      await wait(escrow.connect(recipient).claim(ids[3], t + 2003, await attest(ids[3], recipient.address, t + 2003)));
      await at(t + 2010);
      await wait(escrow.refund(ids[5]));
      assert.equal(await token.balanceOf(escrow.target), 200n + 300n + 500n);
    });
    it("collecting one payment leaves another to the same recipient collectable", async () => {
      const exp = (await now()) + DAY;
      const a = await fund(60, 3, exp), b = await fund(61, 4, exp);
      await wait(escrow.connect(recipient).claim(a, exp, await attest(a, recipient.address, exp)));
      assert.equal((await escrow.payments(b)).state, 1n);
      await wait(escrow.connect(recipient).claim(b, exp, await attest(b, recipient.address, exp)));
      assert.equal(await token.balanceOf(recipient.address), 10n ** 30n + 7n);
    });
    it("payments from different senders never mix", async () => {
      const exp = (await now()) + DAY;
      const a = await fund(62, 11, exp, sender), b = await fund(62, 22, exp, other);
      await wait(escrow.connect(recipient).claim(b, exp, await attest(b, recipient.address, exp)));
      assert.equal((await escrow.payments(a)).state, 1n);
      assert.equal(await token.balanceOf(escrow.target), 11n);
    });
    it("holds 25 random payments and returns every unit through collection or refund", async () => {
      const rnd = (n) => BigInt(1 + Math.floor(Math.random() * n));
      const t = await now();
      const open = [];
      let total = 0n;
      for (let i = 0; i < 25; i++) {
        const amount = rnd(1_000_000);
        total += amount;
        open.push({ id: await fund(100 + i, amount, t + 5000), amount });
      }
      assert.equal(await token.balanceOf(escrow.target), total);
      let paid = 0n;
      for (const p of open.filter((_, i) => i % 2 === 0)) {
        await wait(escrow.connect(recipient).claim(p.id, t + 5000, await attest(p.id, recipient.address, t + 5000)));
        paid += p.amount;
      }
      await at(t + 5000);
      for (const p of open.filter((_, i) => i % 2 === 1)) await wait(escrow.connect(other).refund(p.id));
      assert.equal(await token.balanceOf(escrow.target), 0n);
      assert.equal(await token.balanceOf(recipient.address), 10n ** 30n + paid);
    });
    it("cannot pay out more than it holds with a fee-on-transfer token", async () => {
      const short = await deploy("ShortTokenFixture");
      const e2 = await deploy(NAME, [short.target, signer.publicKey]);
      await wait(short.mint(sender.address, 1000));
      await wait(short.approve(e2.target, 1000));
      const exp = (await now()) + DAY;
      const id = await fund(70, 100, exp, sender, e2);
      assert.equal(await short.balanceOf(e2.target), 90n);
      await reverts(e2.connect(recipient).claim(id, exp, await attest(id, recipient.address, exp, e2)), "Payout failed");
      assert.equal((await e2.payments(id)).state, 1n);
    });
  });

  describe("re-entry", () => {
    let evil, e2, exp;
    beforeEach(async () => {
      evil = await deploy("ReentrantAnyFixture");
      e2 = await deploy(NAME, [evil.target, signer.publicKey]);
      await wait(evil.mint(sender.address, 1000));
      await wait(evil.approve(e2.target, 1000));
      exp = (await now()) + 500;
    });
    it("blocks a deposit token that re-enters fund", async () => {
      await wait(evil.arm(e2.target, e2.interface.encodeFunctionData("fund", [salt(81), 1, exp]), true));
      await reverts(e2.fund(salt(80), 10, exp));
      assert.equal((await e2.payments(pid(sender.address, salt(80)))).state, 0n);
    });
    it("blocks a payout token that re-enters refund", async () => {
      const id = await fund(82, 10, exp, sender, e2);
      await wait(evil.arm(e2.target, e2.interface.encodeFunctionData("refund", [id]), false));
      await at(exp);
      await reverts(e2.refund(id));
      assert.equal((await e2.payments(id)).state, 1n);
    });
    it("blocks a payout token that triggers a refund during collection", async () => {
      const id = await fund(83, 10, exp, sender, e2);
      const sig = await attest(id, recipient.address, exp, e2);
      await wait(evil.arm(e2.target, e2.interface.encodeFunctionData("refund", [id]), false));
      await reverts(e2.connect(recipient).claim(id, exp, sig));
      assert.equal(await evil.balanceOf(e2.target), 10n);
    });
    it("answers a re-entered call with the guard's own error", async () => {
      const probe = await deploy("ReentrantProbeFixture");
      const e3 = await deploy(NAME, [probe.target, signer.publicKey]);
      await wait(probe.mint(sender.address, 100));
      await wait(probe.approve(e3.target, 100));
      const id = await fund(85, 10, exp, sender, e3);
      const sig = await attest(id, recipient.address, exp, e3);
      // During the payout the token tries refund(id) on the escrow, then finishes.
      await wait(probe.arm(e3.target, e3.interface.encodeFunctionData("refund", [id])));
      await wait(e3.connect(recipient).claim(id, exp, sig));
      assert.equal(await probe.tried(), true);
      assert.equal(await probe.lastError(), e3.interface.encodeErrorResult("Error", ["Reentrant call"]));
      assert.equal(await probe.balanceOf(recipient.address), 10n);
    });
    it("allows the same deposit once the token stops re-entering", async () => {
      await wait(evil.arm(E.ZeroAddress, "0x", true));
      await fund(84, 10, exp, sender, e2);
      assert.equal(await evil.balanceOf(e2.target), 10n);
    });
  });

  // Seeded, so a failure replays exactly: INVARIANT_SEED=<seed> npx hardhat test.
  describe("random sequences (seeded)", () => {
    const SEED = Number(process.env.INVARIANT_SEED ?? 20261127);
    const STEPS = Number(process.env.INVARIANT_STEPS ?? 300);
    function mulberry32(a) {
      return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    it(`keeps every invariant over ${STEPS} random fund, claim, refund and time steps (seed ${SEED})`, async function () {
      this.timeout(600000);
      const rand = mulberry32(SEED);
      const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
      const pick = (xs) => xs[int(0, xs.length - 1)];
      const people = accounts.slice(0, 8);
      const funders = people.slice(0, 4); // hold tokens and have approved the escrow
      const registered = [1, 4, 5, 6, 7].map((i) => people[i]);
      for (const w of registered.slice(1)) await wait(registry.register(w.address));
      const isRegistered = (a) => registered.some((w) => w.address === a.address);
      const model = []; // { id, sender, salt, amount, expiry, state, recipient }
      const STATE = { Funded: 1n, Collected: 2n, Refunded: 3n };
      let nextSalt = 1000;
      const balances = async () => {
        const who = [...people.map((w) => w.address), escrow.target];
        const got = await Promise.all(who.map((a) => token.balanceOf(a)));
        return new Map(who.map((a, i) => [a, got[i]]));
      };
      const reason = async (p) => {
        try {
          await wait(p);
          return null;
        } catch (e) {
          return e?.reason ?? String(e?.message ?? e);
        }
      };
      const counts = { fund: 0, claim: 0, refund: 0, time: 0, refused: 0 };
      let balancesBefore = await balances();
      for (let step = 0; step < STEPS; step++) {
        const roll = rand();
        const expected = new Map(); // address -> delta
        const move = (a, n) => expected.set(a, (expected.get(a) ?? 0n) + n);
        let action = "";
        try {
          if (roll < 0.3 || model.length === 0) {
            counts.fund++;
            const from = pick(funders);
            const own = model.filter((p) => p.sender === from.address);
            const dup = own.length > 0 && rand() < 0.1;
            const s = dup ? pick(own).salt : nextSalt++;
            const amount = BigInt(rand() < 0.1 ? int(1, 3) : int(1, 1_000_000));
            const t = (await now()) + 1;
            const expiry = t + int(60, 2 * DAY);
            action = `fund salt ${s} amount ${amount} by ${from.address}${dup ? " (duplicate)" : ""}`;
            await at(t);
            const got = await reason(escrow.connect(from).fund(salt(s), amount, expiry));
            if (dup) {
              assert.equal(got, "Duplicate payment");
              counts.refused++;
            } else {
              assert.equal(got, null);
              model.push({ id: pid(from.address, salt(s)), sender: from.address, salt: s, amount, expiry, state: STATE.Funded, recipient: E.ZeroAddress });
              move(from.address, -amount);
              move(escrow.target, amount);
            }
          } else if (roll < 0.6) {
            counts.claim++;
            const p = pick(model);
            const dest = rand() < 0.9 ? pick(registered) : people[pick([0, 2, 3])];
            const caller = rand() < 0.75 ? dest : pick(people);
            const base = await now();
            const deadline = Math.min(p.expiry, base + int(2, DAY));
            const sig = await attest(p.id, dest.address, deadline);
            const t = (await now()) + 1;
            action = `claim ${p.id} for ${dest.address} by ${caller.address} at ${t}, deadline ${deadline}, expiry ${p.expiry}, state ${p.state}`;
            await at(t);
            const got = await reason(escrow.connect(caller).claim(p.id, deadline, sig));
            const want =
              p.state !== STATE.Funded ? "Payment closed"
              : !(t < deadline && deadline <= p.expiry) ? "Signature expired"
              : !isRegistered(caller) ? "Register a possession-proven ML-DSA key"
              : caller.address !== dest.address ? "Invalid attestation"
              : null;
            assert.equal(got, want);
            if (want === null) {
              p.state = STATE.Collected;
              p.recipient = dest.address;
              move(dest.address, p.amount);
              move(escrow.target, -p.amount);
            } else counts.refused++;
          } else if (roll < 0.8) {
            counts.refund++;
            const p = pick(model);
            const caller = pick(people);
            let t = (await now()) + 1;
            if (rand() < 0.3 && p.expiry - 1 > t) t = p.expiry - 1 + int(0, 1); // the boundary second
            action = `refund ${p.id} by ${caller.address} at ${t}, expiry ${p.expiry}, state ${p.state}`;
            await at(t);
            const got = await reason(escrow.connect(caller).refund(p.id));
            const want = p.state === STATE.Funded && t >= p.expiry ? null : "Refund unavailable";
            assert.equal(got, want);
            if (want === null) {
              p.state = STATE.Refunded;
              move(p.sender, p.amount);
              move(escrow.target, -p.amount);
            } else counts.refused++;
          } else {
            counts.time++;
            const t = (await now()) + int(1, 8 * 3600);
            action = `advance to ${t}`;
            await mine(t);
          }
          // 1. Every balance moved by exactly what the model expects: a claim pays only
          //    the attested destination, a refund pays only the original sender.
          const after = await balances();
          for (const [a, b] of after) assert.equal(b - balancesBefore.get(a), expected.get(a) ?? 0n, `balance of ${a}`);
          balancesBefore = after;
          // 2. The escrow holds exactly the payments still Funded.
          const open = model.filter((p) => p.state === STATE.Funded).reduce((n, p) => n + p.amount, 0n);
          assert.equal(after.get(escrow.target), open, "escrow balance");
          // 3. Every payment's on-chain record matches the model, so none leaves Collected or Refunded.
          const records = await Promise.all(model.map((p) => escrow.payments(p.id)));
          for (const [i, p] of model.entries()) {
            const c = records[i];
            assert.deepEqual([c.sender, c.state, c.amount, c.recipient, c.expiry], [p.sender, p.state, p.amount, p.recipient, BigInt(p.expiry)], `payment ${p.id}`);
          }
        } catch (e) {
          e.message = `seed ${SEED}, step ${step}: ${action}\n${e.message}`;
          throw e;
        }
      }
      if (process.env.INVARIANT_VERBOSE) console.log({ ...counts, payments: model.length, collected: model.filter((p) => p.state === STATE.Collected).length, refunded: model.filter((p) => p.state === STATE.Refunded).length });
      // The sequence must actually exercise each path, or it proves little.
      const settled = model.filter((p) => p.state !== STATE.Funded);
      assert.ok(counts.fund > 50 && counts.claim > 50 && counts.refund > 30 && counts.time > 30, JSON.stringify(counts));
      assert.ok(settled.some((p) => p.state === STATE.Collected) && settled.some((p) => p.state === STATE.Refunded), "both outcomes reached");
      assert.ok(counts.refused > 30, "refused attempts exercised");
    });
  });

  describe("random wrong destinations", () => {
    it("never pays any of 10 random registered wallets with someone else's attestation", async () => {
      const exp = (await now()) + DAY;
      const id = await fund(90, 5, exp);
      const sig = await attest(id, recipient.address, exp);
      for (let i = 0; i < 10; i++) {
        const w = E.Wallet.createRandom().connect(rpc);
        await hre.network.provider.send("hardhat_setBalance", [w.address, "0xDE0B6B3A7640000"]);
        await wait(registry.register(w.address));
        await reverts(escrow.connect(w).claim(id, exp, sig), "Invalid attestation");
      }
      assert.equal(await token.balanceOf(escrow.target), 5n);
    });
  });
});
