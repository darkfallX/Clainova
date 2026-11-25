# Audit and post-quantum design of ClainovaClaims

The Post-Quantum dApp track asks for a two-stage QoreChain AI audit. Both stages use the official auditor at `dashboard.qorechain.io/audit`. Automatic detection read stage 1 as `ethereum`, so stage 2 uses the same EVM/Solidity setting.

| Stage | Date | Source | Score | Report |
|---|---|---|---|---|
| 1 | 24 Nov 2026 | v1, deployed at `0x72fdfB887a73Ab6aBBEB1602F9d16dB29604d822` | 65/100, risk HIGH, 6 findings | [PDF](audit/qcai-stage-1-2026-11-24.pdf) |
| 2 | 25 Nov 2026 | v2, deployed at `0x5fD1e7D06Eb60AEdDe19B4bFcEA3242F293b65F6` | 85/100, risk MEDIUM, 4 findings | [PDF](audit/qcai-stage-2-2026-11-25.pdf) |

Stage 2 reviewed the exact v2 source (SHA-256 `8e428a194ac9287030b3411b0624a63215e530a30d575b56900341ca11059bd0` with LF line endings). The contract has not changed since v2 was deployed. Only the CosmWasm setting produces a quantum readiness rating, so an EVM report shows "Not scored".

## Where post-quantum checks happen

| Check | Where | What it protects | Tests |
|---|---|---|---|
| `pqcVerify` (0x0a01), ML-DSA-87 | `claim`, over `message(id, msg.sender, deadline)` | Only the verifier's signature for this payment, wallet, contract, chain and deadline releases the money. | "rejects wrong destination and forged attestations", "binds chain, claim, contract and deadline", "pays the named recipient exactly once" |
| `pqcKeyStatus` (0x0a02) | `claim`, on `msg.sender` | The receiving wallet must hold an active ML-DSA-87 key with proof of possession before it can be paid. | "rejects an unproven key" |
| Scoped EVM window, hybrid-signed | `web/native.js`, before every EVM call from the built-in wallet | A leaked classical key alone cannot call the escrow. The window allows one call (two when funding needs an approval), only to the required contracts, for 120 blocks. | "new coin-60 wallet signs a registration and a target-limited hybrid window offline", "a retry reuses an untouched window for the same target and never any other" |
| Hybrid-signed native transfer | `server/sponsor.mjs` | Paying gas needs no open EVM window, so the sponsor's classical key alone cannot spend while no window is open. | "the sponsor sends one hybrid-signed native grant and repeats return the same payment" |

The Hardhat tests use doubles for the two precompiles. A valid claim also ran against the real precompiles on Diana on 25 November 2026. `node scripts/verify-run.mjs` re-checks those transactions. [Recorded run](../submission/diana-run.json)

**Trust limit.** One verifier key decides which wallet belongs to a phone number. A compromised verifier seed could authorise the wrong wallet for a payment that is still funded. See the [security review](security-review.md).

## Stage 1 findings and responses

The responses were checked against the code and the contract tests. On analysis, none of the six findings was an exploitable vulnerability in v1. Two had standard hardening fixes, so v2 adds them. The other four are answered in the contract's own documentation, so a reviewer can see the reasoning next to the code.

| Finding (auditor severity) | Analysis | Change in v2 | Evidence |
|---|---|---|---|
| Potential reentrancy in token transfers (HIGH) | v1 already set state before every token call, and the token is a fixed festival asset. A re-entered call would find the payment closed. | Added a `nonReentrant` guard to `fund`, `claim` and `refund` as defence in depth. | Test "blocks a token that re-enters during payout": the claim reverts and the funds stay in escrow. A control step shows the same claim succeeds without re-entry. |
| Unchecked return values from external calls (HIGH) | v1 wrapped every call in `require(token.transfer(...))`. However, a token that returns no data would always revert. | Token calls go through `_call`, which requires success and accepts either `true` or empty return data. | Test "accepts tokens that return no data and rejects tokens that return false". |
| Missing access control on key configuration (MEDIUM) | The verifier key is written once in the constructor and has no setter, so no account can update it. | The constructor now also rejects an all-zero key. | Test "rejects a verifier key of zeros at deployment". |
| Front-running in claim (MEDIUM) | The signed message includes `msg.sender`. A signature copied from the mempool fails for any other sender. | NatSpec now explains this binding. | The existing test "rejects wrong destination and forged attestations". |
| Overflow in expiry calculation (LOW) | Solidity 0.8 checks arithmetic, and the expiry is bounded to 30 days. | Bound exposed as `MAX_PERIOD`. | Compiler-enforced. |
| Unbounded storage mapping (LOW) | Gas for a mapping lookup doesn't grow with its size. Settled entries must stay so an ID can't be funded twice. | Documented. | Not applicable. |

## Stage 2 findings and responses

The two HIGH findings from stage 1, reentrancy and unchecked return values, are gone. The auditor's summary says the contract has "proper reentrancy guards and checks-effects-interactions patterns". Of the four remaining entries, none needed a contract change, so the audited source is the deployed source.

| Finding (auditor severity) | Analysis | Evidence |
|---|---|---|
| Missing access control on verifier key update (HIGH) | False positive. The report itself says the key "is set only in the constructor and is immutable" and raises the case of a future upgrade. The contract has no setter, no proxy and no delegated call, so an upgrade isn't possible. | Regression test "has no way to change the verifier key, upgrade or delegate". The EIP-1967 implementation slot on Diana is zero. |
| Potential overflow in expiry calculation (MEDIUM) | False positive. The report notes that Solidity 0.8 prevents overflow. The expiry is also checked against an explicit bound, `MAX_PERIOD`. | Regression test "accepts an expiry of exactly 30 days and rejects past, longer and maximum values". |
| Unbounded storage growth (LOW) | Accepted. Mapping lookups cost the same at any size, and settled entries must stay so an ID can't be funded twice. | Test "preserves escrow balances on duplicate and failed deposits". |
| Front-running protection (INFO) | Not a problem. The auditor confirms that signatures are bound to `msg.sender`. | Tests "rejects wrong destination and forged attestations" and "binds chain, claim, contract and deadline". |

The immutable key is also a real limit: a compromised verifier seed can't be rotated. That is recorded in the [security review](security-review.md) and is the main trust assumption.

v2 deployment receipts: [diana-deployment-v2.json](../submission/diana-deployment-v2.json). v1 stays on-chain unchanged and is no longer used by the app.
