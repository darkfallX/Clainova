# Clainova

Clainova lets a community organiser pay a workshop speaker by phone number before the speaker has a wallet. The speaker opens a private invitation, verifies the number, creates an encrypted wallet and collects test fUSD. An expired invitation makes a refund available to the original sender.

**Delivery status, 22 November 2026.** ClainovaClaims is deployed on Diana at `0x72fdfB887a73Ab6aBBEB1602F9d16dB29604d822`. The deployed contract returned the expected festival fUSD address and ML-DSA-87 verifier key. The recording shows the local rehearsal. Carrier SMS, a live recipient claim and the two official audit reports are pending. [Deployment receipts](submission/diana-deployment.json)

[Watch the rehearsal](submission/rehearsal.mp4) · [Cover](submission/cover.png) · [Festival research](docs/festival.md) · [Design decisions](docs/design-direction.md) · [AI usage](AI_USAGE.md)

## Run locally

Install Node.js 22.13 or later in the Node 22 series. From the project directory run:

```sh
npm ci
npm run build
npm start
```

Open [the payment counter](http://127.0.0.1:4173). Development on Windows can use `npm.cmd` in place of `npm`. The local service binds to loopback. Each organiser browser starts with 1,000 rehearsal test fUSD. Local mode can run offline after installation and build. There is no SMS charge and no on-chain transaction.

1. Enter a sample Nigerian phone number such as **801 234 5678**, 20 test fUSD and a workshop note. Review the phone number and issue the invitation.
2. Open **Open recipient inbox**, request the code and enter the six digits from the labelled local inbox. An invite can also be opened in another browser profile on the same machine.
3. Choose a wallet passphrase of at least ten characters. Save the encrypted JSON backup, then approve collection. Use **More wallet options** and select your backup to restore it with the same passphrase.
4. From the receipt, send 1 test fUSD to a second test wallet address. The recipient balance becomes 19. The ledger records the outgoing payment.
5. For a refund, issue another invitation with the **1 minute · rehearsal** collection period. After a minute, refresh the ledger, open the receipt and select **Refund sender**.

Rehearsal balances and receipts survive a server restart in `.data/rehearsal`. The browser's session cookie determines which organiser ledger it can open. Recipient ownership survives through the encrypted wallet backup. A browser that opens a previously collected invitation can view the receipt. Only the destination wallet can authorise its next payment.

## Validate

```sh
npm run build
npm test
npx playwright install chromium
npm run test:browser
node scripts/probe.mjs
```

The last command makes read-only calls to Diana. It checks the chain ID, festival token decimals, a valid ML-DSA-87 signature and a signature presented with different message bytes. It does not require credentials. The contract tests compile using the pinned local Solidity compiler and execute on Hardhat's in-memory EVM. The two QoreChain precompiles have explicit test doubles there. The native signing test independently verifies a real hybrid transaction locally.

Browser tests launch a separate service on port 4283 with a temporary database and no external SMS. They use installed Chrome or Edge on Windows when present. Elsewhere, install Playwright Chromium or set `BROWSER_PATH`. They exercise phone, tablet and desktop widths, keyboard access, error and success states, wallet backup, follow-on payment, privacy between sessions and refund. For a deterministic refund test, the test advances only the disposable payment's expiry. The ordinary UI and the recorded demonstration use elapsed wall-clock time. To regenerate the cover and MP4, install FFmpeg on PATH, run `npx playwright install ffmpeg` and set `RECORD_DEMO=1` for the browser test.

## How settlement works

| Component | Responsibility |
|---|---|
| Browser | Review the slip, generate a coin-60 wallet, encrypt its recoverable mnemonic in an ethers keystore, sign locally and track progress. An existing QoreX account can be paired with a compatible EVM signer. |
| Node and SQLite | Authenticate the single organiser, persist a payment before funding, track delivery and claims, cap verification attempts, encrypt phone records, issue short-lived attestations and reconcile Diana state. |
| ClainovaClaims | Hold one immutable ERC-20 asset. A deposit ID commits to the sender and a random salt. A valid claim needs the registered possession-proven ML-DSA-87 destination, the verifier signature and the recipient as transaction sender. Anyone can trigger an expired refund to the deposit sender. |
| Native lane | QoreSign builds the proof of possession. A hybrid-signed window admits at most two EVM calls for funding or one for collection. The target list contains only the required contracts, the duration is 120 blocks and the cap is 250,000 uqor. |
| Optional sponsor | A dedicated test-only wallet sends 0.3 test QOR to a low-balance recipient. The verifier requires an active, phone-verified invitation. A durable signed transaction, per-wallet and per-invitation uniqueness and a 20-top-up rolling daily limit bound retries and cost. |

The contract binds the attestation to its purpose, chain, contract, payment ID, destination and deadline. It terminates the claim before transferring tokens. The sender authorises the exact shortfall in token allowance by approving the payment amount when needed. The verifier signs once a destination is bound and may reissue a short-lived attestation for that same destination. Reopening a private link and verifying a new code recovers from an expired browser grant.

The browser-created account avoids a second wallet installation. Its QoreSign derivation follows the address-bound, mnemonic-based coin-60 convention. Only locally generated Clainova wallets and their encrypted backups use the built-in signing path. Clainova never asks for an existing wallet's seed phrase. Restore in Clainova with the downloaded backup. Recovery in the QoreX application itself remains untested. [Key binding](https://docs.qorechain.io/build-before-qday/key-binding/) · [Hybrid signing](https://docs.qorechain.io/qoresign/spec/hybrid-signing-v1/)

## Testnet deployment handoff

The current deployment already has its address and matching verifier seed in the operator's local configuration. Preserve the seed when moving the service to a host. Steps 2 and 3 below describe setup for a fresh deployment.

1. Use a single Node process behind an HTTPS reverse proxy and attach a persistent volume. Build once with `npm ci && npm run build`. Restrict the data directory and secret configuration to the service account. Disable URL logging for private invitation paths. Back up the database and encryption key together. Do not run multiple replicas against the same sponsor account.
2. Copy `.env.example` to `.env`. Generate independent 32-byte hexadecimal values for `DATA_KEY` and `VERIFIER_SEED` with a cryptographic secret generator. Set `OPERATOR_PASSWORD` to a distinct secret of at least 16 characters. Keep the resulting file private.
3. Fund a dedicated coin-60 deployer on Diana, register its PQ key with proof of possession and open a short EVM window allowing contract creation. Set `DEPLOYER_PRIVATE_KEY`, run `npm run deploy:testnet` and record the confirmed address and deployment transaction. Remove the deployer key from the running application environment. Contract creation needs an unrestricted target list for this one deployment. [Deployment guide](https://docs.qorechain.io/getting-started/deploy-in-5-minutes/)
4. Set `MODE=testnet`, `ESCROW_ADDRESS`, `PUBLIC_ORIGIN` to the public HTTPS origin, and `AT_USERNAME` and `AT_API_KEY`. Africa's Talking's `sandbox` username sends to its simulator. Real handsets need an appropriately enabled account and sender configuration for the destination. Set `AT_FROM` only when applicable. The app checks the recipient outcome before showing provider acceptance. Receipt by a handset is a separate observation. [SMS SDK](https://github.com/AfricasTalkingLtd/africastalking-node.js/)
5. `HOST` defaults to loopback and `PORT` to 4173. Set the host as needed behind the proxy. `RPC_URL` defaults to the Diana EVM endpoint for the backend. Browser EVM and native REST connections are pinned to Diana. `DATA_DIR` defaults to `.data`. The app uses a separate database and requires explicit keys in testnet mode. Set `COHORT=field` only for deliberately observed external trials. The default is `team`.
6. For gas sponsorship, configure a dedicated funded `SPONSOR_PRIVATE_KEY` with a registered PQ key and a live native-transfer-only EVM window. Monitor its balance and window expiry. With no sponsor, the UI links to the festival faucet. A rejected sponsored transaction can be retried from its original signed bytes. Check its hash and nonce before operator intervention. [Window reference](https://docs.qorechain.io/developer-guide/evm-window-reference/)
7. Start the service and sign in at the organiser counter. The wallet needs test QOR and festival fUSD. The faucet pays bank coins. When using the built-in wallet, the review dialog can convert only the ERC-20 shortfall into the organiser's own address for a disclosed native fee. An external wallet user can convert in advance. For external signing, select the same coin-60 account in QoreX and in the EVM signer. Prepare a short window with the required targets using the native CLI or SDK. For example, with the release CLI use `qorechaind tx pqc open-evm-window 120 2 250000uqor --allowed-targets TOKEN,ESCROW --from YOUR_KEY --chain-id qorechain-diana` with the account's configured hybrid signer and testnet node. For collection allow just ESCROW and one transaction. The app checks the scope before submitting an external EVM write. [Festival assets](https://docs.qorechain.io/dashboard/faucet/) · [Wallet support](https://docs.qorechain.io/developer-tools/qorex-integrations/)

## Privacy, trust and operating limits

The ledger keeps a random salt and private, authenticated invitation link separate from the public deposit ID. The server encrypts phone numbers using AES-256-GCM. A keyed digest protects each six-digit OTP, which expires after five minutes and is disabled after five guesses. The verifier grants a 15-minute session after verification. Rehearsal deliberately displays the code. Testnet replies never include it. The web server sends private pages with no-store, no-referrer and noindex headers.

The verifier can authorise the wrong wallet if compromised. Telecom reassignment or SIM takeover can give someone else the current code. A forwarded link reveals the receipt and masked number. On-chain amounts, dates and wallet reuse can correlate payments. There is no permanent phone-to-wallet directory. Operators can read notes and decrypt numbers. Protect and remove settled off-chain records under the organiser's retention policy. The privacy and terms screens describe these properties in the app.

The board counts issued payments, opened links, successful codes and completed claims. Rehearsal measures transfers from its own signed ledger. Diana outgoing transfers recorded through the application require an actual token-transfer receipt. A new-account observation means Diana returned an absent account record before setup. It is evidence about that address, not unique people or all prior activity. Direct wallet activity outside Clainova and abandoned steps during third-party wallet prompts are not fully indexed. Live EVM receipts include the actual payer and fee when recorded. Native setup fees are displayed before signing. The number of wallet approval screens and device-level completion times require the fresh-device trial.

## Dependencies and licence

Original application code is MIT licensed. QoreChain PQC supplies ML-DSA-87, QoreSign constructs registrations and hybrid signatures, and the wallet adapter composes scoped windows. Cosmos protobuf types encode the native transaction envelope. Ethers handles EVM access, wallet signatures and encrypted backups. Node SQLite persists application state. Africa's Talking supplies SMS transport. Hardhat, solc-js, esbuild, Playwright and axe-core support build and validation. Outfit is bundled from Fontsource under the SIL Open Font License. The app was built from the supplied concept without a starter application.
