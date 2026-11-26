# Festival entry text

Draft for build.qorechain.io/p/clainova. Nothing here is published until the builder pastes it.

## Tagline

Pay someone by phone number, before they have a wallet.

## About

Every app on QoreChain assumes its users already have an account. Clainova starts one step earlier.

An organiser funds a payment for a phone number, for example a workshop speaker's. The money waits in an escrow contract. The speaker gets a message, verifies the number with a one-time code, creates a wallet in the browser and collects. They need no QOR, no extension and no wallet address beforehand. If nobody collects before the deadline, the sender can get the money back.

On Diana, a new wallet with no account record and no QOR collected 20 test fUSD 33 seconds after approving, then spent 1 on its own. The payment had been funded 68,759 blocks before that wallet registered its ML-DSA-87 key. Run `node scripts/verify-run.mjs` to check all the recorded transactions yourself.

On 26 November an invitation and its code reached a real handset as ordinary SMS on a Nigerian network, sent from the organiser's own phone at the SIM's normal rate. On that handset a new wallet collected 2 test fUSD on Diana (funded `0x78366ccd…f8e8`, collected `0x6b720acf…84bf9`). That was the builder's own phone: nobody outside the team has collected yet.

No phone number or phone hash goes on-chain. One verifier decides which wallet belongs to a number, and the security review says so plainly.

## How it's made

Solidity 0.8.28, Hardhat, 106 contract tests. `node scripts/mutation-check.mjs` breaks one rule of the contract at a time and all 6 broken versions fail the tests, including one with the reentrancy guard removed. ClainovaClaims v2 (`0x5fD1e7D06Eb60AEdDe19B4bFcEA3242F293b65F6`) holds the money. `claim` calls `pqcVerify` on an ML-DSA-87 attestation bound to one payment, wallet, contract, chain and deadline, and calls `pqcKeyStatus` so only a wallet with a possession-proven key can be paid.

The wallet is created for the recipient in the browser, with a new post-quantum key, and locked with a password they type twice. Invitations and codes go out by SMS, either through Africa's Talking or from the organiser's own Android phone through Traccar SMS Gateway, which costs nothing beyond the SIM's normal rate. Each EVM call runs inside a hybrid-signed window with one call (two when funding needs an approval), only to the required contracts, for 120 blocks. A sponsor pays the first fees with a hybrid-signed native transfer, so that needs no EVM window.

Node 22 and SQLite store the invitations. Phone numbers are encrypted. Two-stage QCAI audit: 65 with six findings on v1, then 85 with four on v2, each answered with a fix, a test or a reason. Reports and post-quantum design: docs/audit/ and docs/AUDIT.md in the repository.

## Sentences to replace on the live page (26 November)

The live page still says three things that are no longer true. Replace them:

| Live page says | Replace with |
|---|---|
| "These were team runs, and no code came from a carrier yet." | The new paragraph about the real handset above. |
| "Contract: Solidity 0.8.28, 11 Hardhat tests." | "Contract: Solidity 0.8.28, 106 Hardhat tests; all 6 deliberately broken contracts fail them (`node scripts/mutation-check.mjs`)." |
| "Wallet: created in the browser and encrypted with the recipient's passphrase." | The new wallet and SMS sentences above. |

## Boxes to change

| Field | Change |
|---|---|
| Kits | Untick `create-qorechain-dapp` and QoreChain SDK. Neither is in the code. Keep qorechain-pqc, QoreSign and Wallet adapter. |
| Network features | Tick EVM window (scoped), Solidity PQC signature check and Solidity PQC key status. Keep the three already verified. |
| Addresses | Add `qor1c3esrl8avk9taymhdc48l88grnrl2mck8k9t5v` (organiser), `qor19ua0dd96enusf63r7fsqlrc7zzezrahvg6h2hy` (sponsor and deployer) and `qor1han639ddwrk8shtdyqz7c6qh2rz8guw7xwn6w3` (test recipient), then press **Check again**. |
| Quantum Campus | Keep only with proof of enrolment. |
| Demo link | The public address with `/try` at the end, once it is on a permanent host. Visitors can send as the organiser and collect as the recipient. |
| Video | Required, up to 3 minutes. |
