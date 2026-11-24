# QCAI audits of ClainovaClaims

The Post-Quantum dApp track asks for two QoreChain AI audit rounds. Both use the official auditor at `dashboard.qorechain.io/audit` with automatic chain detection.

| Round | Date | Source | Score | Report |
|---|---|---|---|---|
| 1 | 24 Nov 2026 | v1, deployed at `0x72fd…d822` | 65/100, risk HIGH, 6 findings | [qcai-round-1.pdf](qcai-round-1.pdf) |
| 2 | pending | v2, deployed at `0x5fD1…65F6` | pending | pending |

## Round 1 findings and responses

The responses were checked against the code and the contract tests. On analysis, none of the six findings was an exploitable vulnerability in v1. Two had standard hardening fixes, so v2 adds them. The other four are answered in the contract's own documentation, so a reviewer can see the reasoning next to the code.

| Finding (auditor severity) | Analysis | Change in v2 | Evidence |
|---|---|---|---|
| Potential reentrancy in token transfers (HIGH) | v1 already set state before every token call, and the token is a fixed festival asset. A re-entered call would find the payment closed. | Added a `nonReentrant` guard to `fund`, `claim` and `refund` as defence in depth. | Test "blocks a token that re-enters during payout": the claim reverts and the funds stay in escrow. A control step shows the same claim succeeds without re-entry. |
| Unchecked return values from external calls (HIGH) | v1 wrapped every call in `require(token.transfer(...))`. However, a token that returns no data would always revert. | Token calls go through `_call`, which requires success and accepts either `true` or empty return data. | Test "accepts tokens that return no data and rejects tokens that return false". |
| Missing access control on key configuration (MEDIUM) | The verifier key is written once in the constructor and has no setter, so no account can update it. | The constructor now also rejects an all-zero key. | Test "rejects a verifier key of zeros at deployment". |
| Front-running in claim (MEDIUM) | The signed message includes `msg.sender`. A signature copied from the mempool fails for any other sender. | NatSpec now explains this binding. | The existing test "rejects wrong destination and forged attestations". |
| Overflow in expiry calculation (LOW) | Solidity 0.8 checks arithmetic, and the expiry is bounded to 30 days. | Bound exposed as `MAX_PERIOD`. | Compiler-enforced. |
| Unbounded storage mapping (LOW) | Gas for a mapping lookup doesn't grow with its size. Settled entries must stay so an ID can't be funded twice. | Documented. | Not applicable. |

v2 deployment receipts: [diana-deployment-v2.json](../../submission/diana-deployment-v2.json). v1 stays on-chain unchanged and is no longer used by the app.
