# Festival entry text

Draft for build.qorechain.io/p/clainova. Nothing here is published until the builder pastes it.

## Tagline

Pay someone by phone number, before they have a wallet.

## About

Every app on QoreChain assumes its users already have an account. Clainova starts one step earlier.

An organiser funds a payment for a phone number, for example a workshop speaker's. The money waits in an escrow contract. The speaker gets a message, verifies the number with a one-time code, creates a wallet in the browser and collects. They need no QOR, no extension and no wallet address beforehand. If nobody collects before the deadline, the sender can get the money back.

On Diana, a new wallet with no account record and no QOR collected 20 test fUSD 33 seconds after approving, then spent 1 on its own. The payment had been funded 68,759 blocks before that wallet registered its ML-DSA-87 key. These were team runs, and no code came from a carrier yet. Run `node scripts/verify-run.mjs` to check all the recorded transactions yourself.

No phone number or phone hash goes on-chain. One verifier decides which wallet belongs to a number, and the security review says so plainly.

## How it's made

Solidity 0.8.28, Hardhat. ClainovaClaims v2 (`0x5fD1e7D06Eb60AEdDe19B4bFcEA3242F293b65F6`) holds the money. `claim` calls `pqcVerify` on an ML-DSA-87 attestation bound to one payment, wallet, contract, chain and deadline, and calls `pqcKeyStatus` so only a wallet with a possession-proven key can be paid.

The wallet is created in the browser and encrypted with the recipient's passphrase. Each EVM call runs inside a hybrid-signed window with one call (two when funding needs an approval), only to the required contracts, for 120 blocks. A sponsor pays the first fees with a hybrid-signed native transfer, so that needs no EVM window.

Node 22 and SQLite store the invitations. Phone numbers are encrypted. QCAI audit reports and post-quantum design: docs/audit/ and docs/AUDIT.md in the repository.

## Boxes to change

| Field | Change |
|---|---|
| Kits | Untick `create-qorechain-dapp` and QoreChain SDK. Neither is in the code. Keep qorechain-pqc, QoreSign and Wallet adapter. |
| Network features | Tick EVM window (scoped), Solidity PQC signature check and Solidity PQC key status. Keep the three already verified. |
| Addresses | Add `qor1c3esrl8avk9taymhdc48l88grnrl2mck8k9t5v` (organiser), `qor19ua0dd96enusf63r7fsqlrc7zzezrahvg6h2hy` (sponsor and deployer) and `qor1han639ddwrk8shtdyqz7c6qh2rz8guw7xwn6w3` (test recipient), then press **Check again**. |
| Quantum Campus | Keep only with proof of enrolment. |
| Demo link | The public address with `/try` at the end, once it is on a permanent host. |
| Video | Required, up to 3 minutes. |
