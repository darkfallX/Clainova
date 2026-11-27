# Clainova

**Pay someone by phone number, before they have a wallet.** An organiser funds a payment. It waits in escrow on QoreChain until that person verifies a code and collects it into a new wallet with an ML-DSA-87 key. If nobody collects, the sender can get it back.

**Try it in about two minutes: [clainova.onrender.com/try](https://clainova.onrender.com/try).** Send a test payment as the organiser, then collect it into a new post-quantum wallet. Every step is a real transaction on Diana, and you need no phone, wallet, extension or QOR.

**What QoreChain does in each payment** (since 27 November 2026):

- **No classical-only transaction anywhere.** Funding, collecting, refunding and spending are each one hybrid-signed native transaction carrying `MsgCrossVMCall`. Diana checks the wallet's ML-DSA-87 signature on every one, the escrow sees the wallet as `msg.sender`, and no EVM window is ever opened. A stolen secp256k1 key alone moves nothing: [try to steal one](https://clainova.onrender.com/try/steal), where three wallets' keys are published and Diana's refusals are shown live.
- **The recipient pays their own fees.** One tap swaps 0.01 test fUSD for about 1 test QOR in QoreChain's native fUSD/QOR pool (`MsgSwapExactIn`, pool 2, with a 3% price limit), so the wallet stops depending on the sponsor.
- **Notes the server cannot read.** After collection, the organiser and the recipient can exchange notes (a receipt, an event pass, invoice details) sealed with QoreSeal's ML-KEM-1024 to both wallets' keys on QoreChain's encryption-key registry. Each wallet registers its key inside its claim or deposit transaction.
- **QoreX without a command line.** A QoreX account signs the same cross-VM transactions through QoreX's `signAndBroadcast`.

| Five new wallets each, no QOR, 25 November 2026, Diana | Could spend the money |
|---|---|
| Paid through Clainova | **5 of 5** |
| Sent the same token directly | **0 of 5** |

The chain refused the direct ones with `account has no PQC key`, and they held no QOR to register one. They could get QOR from the faucet, which needs its own sign-in. Clainova's five needed nothing else. The fastest collected in 27 seconds. [Every transaction and answer](submission/live-check.json) · [the script](scripts/live-check.mjs)

**11 of 11 attacks were refused**, by Diana or by the server: a stolen link without the code, a guessed code, one changed bit in the signature, another registered wallet using the real signature, a wallet with no key, a second wallet for the same payment, an early refund, a second collection, and a leaked classical key trying an EVM transfer, a new window and a native transfer.

**You can ask the chain yourself.** On every collected payment, your own browser asks QoreChain's `pqcVerify` and `pqcKeyStatus` live. The real signature is accepted. The same signature with one bit changed, for another wallet, or for a wallet without a proven key is refused.

**A real phone, by SMS.** On 26 November 2026 an invitation for 2 test fUSD, and then its six-digit code, reached a handset as ordinary SMS on a Nigerian network. They were sent from the organiser's own phone through [Traccar SMS Gateway](https://github.com/traccar/traccar-sms-gateway), at the SIM's normal rate. On that handset a new wallet verified the code, registered its ML-DSA-87 key and collected the payment on Diana: [funded](https://explore.qore.network/tx/0x78366ccd4a86b1a23fff33fac6e07f370996b5bb79d20f9a36baaabf7376f8e8) at 10:02 UTC, [collected](https://explore.qore.network/tx/0x6b720acf800df27c932cb245965ac6a52be8d10552879074cc02c86edeb84bf9) at 10:17 UTC by the new wallet, which paid its own gas (switch the explorer to Testnet). The first send failed because the server could not reach the relay; it now retries once and says so.

Closest alternative: [Pocket Drop](https://github.com/mohamedwael201193/pocket-drop), also on QoreChain. In its default Confirmed mode, someone who intercepts the link can bind it to their own key but can't claim it (they keep only the small drip that pays for key registration). The money moves only after the recipient reads four words of their key to the sender, aloud or in chat, and the sender confirms that they match. So the sender has to take part again after funding. Clainova needs no second step from the sender: the recipient collects whenever they choose, with a code sent to the phone number, and a link without that code is refused. The price is that the number is the key. Someone who takes over the SIM, or is given the number after the carrier recycles it, can collect if they get there first.

## Why it matters

| What happened | Would Clainova have helped? |
|---|---|
| 20 December 2025: someone copied a lookalike address from their history and lost [49,999,950 USDT](https://finance.yahoo.com/news/crypto-user-loses-50-million-174321722.html). | **Reduced.** The organiser pays a number and never handles an address, so there is nothing to copy. It doesn't help later, when the recipient pastes an address to send onwards. |
| July 2022 to June 2024: Carnegie Mellon counted about 270 million of these attempts, 17 million targets and at least [$83.8 million lost](https://cylab.cmu.edu/news/2026/01/07-blockchain-address-poisoning.html) on Ethereum and BNB Smart Chain. | **Reduced**, for the same first payment. |
| March 2026: Nigeria's regulator called recycled and swapped numbers a significant route for [fraud and identity theft](https://nairametrics.com/2026/03/27/ncc-to-introduce-platform-to-curb-sim-related-fraud/). | **Not helped, and exposed to it.** Someone who takes over the number before collection can collect. Payments expire and are small test amounts. |

## Check it on Diana

On 25 November 2026 a new wallet with no account record and no test QOR collected 20 test fUSD 33 seconds after approving, then spent 1. The payment had been funded 68,759 blocks before that wallet registered its key.

```sh
npm ci
node scripts/verify-run.mjs
```

The script is read-only, needs no keys and runs 76 checks against Diana.

| Step | Transaction |
|---|---|
| Funded by the organiser | `0x941dfc1aa8794f6c15fe1cbf03a0dd0fe0e5320f38cb81afc3c2b9814486553b` |
| Gas sent by the sponsor, hybrid-signed | `B6709E315792A0BE952D08ACC37BFC2B2C465966CF08FB72ACD96D88D7891A32` |
| ML-DSA-87 key registered | `245A9CA04128FB88754764BFFDA1DA8D969891AF85966212CE4EECC686FBA238` |
| One-call window, escrow only | `848F3585270034BEF1F43AD099DD75E857D75083C6FA43CFFEBFA79D13AAB9F6` |
| Collected by the recipient | `0x9b01ecbeed92c1c4e3044add83d89f18d8899ae7d7e30e6d18152a2423bddd83` |
| Recipient's own spend | `0x033c9842f0abdfd5087ae714ab5a1fd336e7c220146ce17d23839e0b50340ab3` |

Five more payments cover a page closed right after the claim was broadcast, a refund triggered by a different account, two collections through the public demo on an emulated slow phone, and one whose invitation and code went through the SMS provider's test handset. [All transactions](submission/diana-run.json)

These were **team runs**. The team operated every wallet. The real-handset SMS run above used the builder's own phone, so use by someone outside the team is still to be shown.

### Try it without a phone

A server started with `DEMO_PAYMENTS=on` serves `/try`. It offers two ways in, and every step is a real transaction on Diana.

- **Send, then collect.** The visitor is the organiser. They create a sender wallet in the browser, the sponsor gives it 1 test fUSD and 0.3 test QOR, and that wallet registers its key, converts, opens a window and funds the escrow. Then they open the invitation and collect it with a second, separate wallet. The sender's page updates when Diana records the collection and links both transactions. This needs a sponsor.
- **Only collect.** The visitor takes a payment from a pre-funded pool. `scripts/fund-demo.mjs` fills the pool.

The code appears on the page instead of going to a phone, and the page says so. A sample number stands in for a real one, so no visitor's number is asked for or stored. Demo payments stay out of the ledger's counts. Each visitor sends one payment and holds one pool payment. An unused pool payment is released after two hours. Limits: 40 visitors a day per network address, 20 sends and 30 recipient grants a day.

**Delivery status, 25 November 2026.** ClainovaClaims v2 is deployed on Diana at `0x5fD1e7D06Eb60AEdDe19B4bFcEA3242F293b65F6`. It returned the expected festival fUSD address and ML-DSA-87 verifier key. v2 adds a reentrancy guard and checked token calls after QCAI audit round 1. The first deployment, `0x72fdfB887a73Ab6aBBEB1602F9d16dB29604d822`, stays on-chain unchanged and is no longer used. [v2 receipts](submission/diana-deployment-v2.json) · [v1 receipts](submission/diana-deployment.json) · [Audit and PQ design](docs/AUDIT.md) · [Security review](docs/security-review.md)

Both QCAI audit stages are complete: 65/100 with six findings on v1, then 85/100 with four on v2, none needing a contract change. The reports and the response to each finding are in [docs/AUDIT.md](docs/AUDIT.md). Carrier delivery to a handset is pending.

[Pocket Fold desktop](submission/pocket-fold/desktop.png) · [Mobile invitation](submission/pocket-fold/phone-invitation.png) · [Pocket Fold motion](submission/pocket-fold/motion.mp4) · [Earlier end-to-end rehearsal](submission/rehearsal.mp4) · [Design decisions](docs/design-direction.md) · [AI usage](AI_USAGE.md)

## Run locally

Install Node.js 22.13 or later in the Node 22 series. From the project directory run:

```sh
npm ci
npm run build
npm start
```

Open [the payment counter](http://127.0.0.1:4173). Development on Windows can use `npm.cmd` in place of `npm`. The local service binds to loopback. Each organiser browser starts with 1,000 rehearsal test fUSD. Local mode can run offline after installation and build. There is no SMS charge and no on-chain transaction.

1. Enter a sample Nigerian phone number such as **801 234 5678** and choose **Continue**. Enter **20** test fUSD. Open **Payment details** to add a workshop note or change the collection period. Review the payment and issue the invitation.
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

**107 contract tests** cover each rule of the deployed escrow at its exact boundary: expiry and deadline to the second, every key status the registry can report, signatures of the wrong length or from another verifier, attestations for another payment, escrow or deadline, refunds, accounting across 25 random payments, tokens that return nothing, return false, take a fee or re-enter. One test runs 300 seeded random steps of funding, collecting, refunding and moving the clock across eight accounts, including duplicates, wrong callers and the exact expiry second. After every step it checks that the escrow holds exactly the payments still open, that every account's balance moved by exactly what was expected (a collection pays only the attested wallet, a refund pays only the original sender), and that no settled payment changes again. A failure prints its seed, and `INVARIANT_SEED=<seed>` replays it.

`npm run coverage` measures the deployed contract with [solidity-coverage](https://github.com/sc-forks/solidity-coverage) on 27 November 2026: **100% of lines (31 of 31) and 100% of branches (28 of 28)**, plus 21 of 21 statements and 7 of 7 functions, in `contracts/ClainovaClaims.sol`. To show the tests would catch a real bug, `node scripts/mutation-check.mjs` breaks one rule of the contract at a time and runs them. All 6 broken versions fail, including one with the reentrancy guard removed. The script restores the audited source and checks it is byte-identical.

Browser tests launch a separate service on port 4283 with a temporary database and no external SMS. They use installed Chrome or Edge on Windows when present. Elsewhere, install Playwright Chromium or set `BROWSER_PATH`. They exercise phone, tablet and desktop widths, keyboard access, error and success states, wallet backup, follow-on payment, privacy between sessions and refund. For a deterministic refund test, the test advances only the disposable payment's expiry. The ordinary UI and the recorded demonstration use elapsed wall-clock time. To regenerate the cover and MP4, install FFmpeg on PATH, run `npx playwright install ffmpeg` and set `RECORD_DEMO=1` for the browser test.

## How settlement works

| Component | Responsibility |
|---|---|
| Browser | Review the slip, generate a coin-60 wallet, encrypt its recoverable mnemonic in an ethers keystore, sign locally and track progress. An existing QoreX account can be paired with a compatible EVM signer. |
| Node and SQLite | Authenticate the single organiser, persist a payment before funding, track delivery and claims, cap verification attempts, encrypt phone records, issue short-lived attestations and reconcile Diana state. |
| ClainovaClaims | Hold one immutable ERC-20 asset. A deposit ID commits to the sender and a random salt. A valid claim needs the registered possession-proven ML-DSA-87 destination, the verifier signature and the recipient as transaction sender. Anyone can trigger an expired refund to the deposit sender. |
| Native lane | QoreSign builds the proof of possession. Every escrow and token call is a `MsgCrossVMCall` inside one hybrid-signed transaction: an approval and its deposit together, a claim (with the ML-KEM-1024 key registration the first time), a refund or a transfer. The server relays only those calls, to this escrow and token. Older QoreX builds without `signAndBroadcast` still use a scoped window: at most two calls, the required contracts only, 120 blocks and 250,000 uqor. Payments before 27 November used that window path, and the runs listed above record it. |
| Optional sponsor | While collecting, a phone-verified recipient who holds less than 0.2 test QOR receives 0.3 from a dedicated test-only account. The transfer is native and hybrid-signed, so paying gas needs no open EVM window. The signed bytes are saved before broadcast. A retry resends those bytes and signs a replacement only once they can no longer land. One grant per wallet and per invitation, 30 a day. Demo senders have a separate allowance of 20. |

The contract binds the attestation to its purpose, chain, contract, payment ID, destination and deadline. It terminates the claim before transferring tokens. The sender authorises the exact shortfall in token allowance by approving the payment amount when needed. The verifier signs once a destination is bound and may reissue a short-lived attestation for that same destination. Reopening a private link and verifying a new code recovers from an expired browser grant.

The browser-created account avoids a second wallet installation. Its QoreSign derivation follows the address-bound, mnemonic-based coin-60 convention. Only locally generated Clainova wallets and their encrypted backups use the built-in signing path. Clainova never asks for an existing wallet's seed phrase. Restore in Clainova with the downloaded backup. Recovery in the QoreX application itself remains untested. [Key binding](https://docs.qorechain.io/build-before-qday/key-binding/) · [Hybrid signing](https://docs.qorechain.io/qoresign/spec/hybrid-signing-v1/)

## Testnet deployment handoff

The [Dockerfile](Dockerfile) builds one process. Give it one persistent volume at `/data`, the settings below and `TRUST_PROXY` for the host in use. The database and the sponsor queue expect a single instance.

The current deployment already has its address and matching verifier seed in the operator's local configuration. Preserve the seed when moving the service to a host. Steps 2 and 3 below describe setup for a fresh deployment.

1. Use a single Node process behind an HTTPS reverse proxy and attach a persistent volume. Build once with `npm ci && npm run build`. Restrict the data directory and secret configuration to the service account. Disable URL logging for private invitation paths. Back up the database and encryption key together. Do not run multiple replicas against the same sponsor account.
2. Copy `.env.example` to `.env`. Generate independent 32-byte hexadecimal values for `DATA_KEY` and `VERIFIER_SEED` with a cryptographic secret generator. Set `OPERATOR_PASSWORD` to a distinct secret of at least 16 characters. Keep the resulting file private.
3. Fund a dedicated coin-60 deployer on Diana, register its PQ key with proof of possession and open a short EVM window allowing contract creation. Set `DEPLOYER_PRIVATE_KEY`, run `npm run deploy:testnet` and record the confirmed address and deployment transaction. Remove the deployer key from the running application environment. Contract creation needs an unrestricted target list for this one deployment. [Deployment guide](https://docs.qorechain.io/getting-started/deploy-in-5-minutes/)
4. Set `MODE=testnet`, `ESCROW_ADDRESS`, `PUBLIC_ORIGIN` to the public HTTPS origin, `ORGANISER_NAME` to the name recipients will recognise in the message, and `AT_USERNAME` and `AT_API_KEY`. For a team run without SMS, set `SMS_PROVIDER=outbox`. Messages then go to a private file in the data folder, receipts say so, and `COHORT=field` is refused. Africa's Talking's `sandbox` username sends to its simulator. Real handsets need an appropriately enabled account and sender configuration for the destination. Set `AT_FROM` only when applicable. The app checks the recipient outcome before showing provider acceptance. Receipt by a handset is a separate observation. [SMS SDK](https://github.com/AfricasTalkingLtd/africastalking-node.js/)

   With no SMS budget, set `SMS_PROVIDER=android`. The organiser's own Android phone then sends each invitation and code as an ordinary SMS from its SIM, through the free, open-source [SMS Gateway for Android](https://github.com/capcom6/android-sms-gateway). Install it, turn on its cloud server, and put the username and password it shows in `SMSGATE_USERNAME` and `SMSGATE_PASSWORD`. Recipients see a message from a number they know. `node --env-file=.env scripts/sms-check.mjs +234…` sends one test message and follows it until the phone reports it delivered. If that app will not install, `SMS_PROVIDER=traccar` does the same with [Traccar SMS Gateway](https://github.com/traccar/traccar-sms-gateway) from Google Play: put the cloud token it shows in `TRACCAR_SMS_TOKEN`. It reports no delivery status, so confirm on the receiving phone.
5. `HOST` defaults to loopback and `PORT` to 4173. Set the host as needed behind the proxy. `RPC_URL` defaults to the Diana EVM endpoint for the backend. Browser EVM and native REST connections are pinned to Diana. `DATA_DIR` defaults to `.data`. The app uses a separate database and requires explicit keys in testnet mode. Set `COHORT=field` only for deliberately observed external trials. The default is `team`.
6. For gas sponsorship, set `SPONSOR_MNEMONIC` to the phrase of a dedicated coin-60 test account and fund it from the faucet. The server registers its PQ key on first use. Each recipient costs about 0.33 test QOR. `GET /api/health` reports the sponsor's balance, the message channel and the latest block. With no sponsor, the UI links to the festival faucet.
7. Start the service and sign in at the organiser counter. The wallet needs test QOR and festival fUSD. The faucet pays bank coins. When using the built-in wallet, the review dialog can convert only the ERC-20 shortfall into the organiser's own address for a disclosed native fee. An external wallet user can convert in advance. For external signing, select the same coin-60 account in QoreX and in the EVM signer. A QoreX build that offers `signAndBroadcast` signs Clainova's cross-VM transactions itself and needs no window. With an older build, prepare a short window with the required targets using the native CLI or SDK. For example, with the release CLI use `qorechaind tx pqc open-evm-window 120 2 250000uqor --allowed-targets TOKEN,ESCROW --from YOUR_KEY --chain-id qorechain-diana` with the account's configured hybrid signer and testnet node. For collection allow just ESCROW and one transaction. The app checks the scope before submitting an external EVM write. [Festival assets](https://docs.qorechain.io/dashboard/faucet/) · [Wallet support](https://docs.qorechain.io/developer-tools/qorex-integrations/)

## Privacy, trust and operating limits

The ledger keeps a random salt and private, authenticated invitation link separate from the public deposit ID. The server encrypts phone numbers using AES-256-GCM. A keyed digest protects each six-digit OTP, which expires after five minutes and is disabled after five guesses. The verifier grants a 15-minute session after verification. Rehearsal deliberately displays the code. Testnet replies never include it. The web server sends private pages with no-store, no-referrer and noindex headers.

The verifier can authorise the wrong wallet if compromised. Telecom reassignment or SIM takeover can give someone else the current code. A forwarded link reveals the receipt and masked number. On-chain amounts, dates and wallet reuse can correlate payments. There is no permanent phone-to-wallet directory. Operators can read the organiser's payment note and decrypt numbers. Sealed notes after collection are ML-KEM-1024 ciphertext for keys the operator never holds. Protect and remove settled off-chain records under the organiser's retention policy. The privacy and terms screens describe these properties in the app.

The board counts issued payments, opened links, successful codes and completed claims. Rehearsal measures transfers from its own signed ledger. Diana outgoing transfers recorded through the application require an actual token-transfer receipt. If a recipient's browser closes before reporting a collection, the server finds the event on Diana by payment ID. A new-account observation means Diana returned an absent account record before setup. It is evidence about that address, not unique people or all prior activity. Direct wallet activity outside Clainova and abandoned steps during third-party wallet prompts are not fully indexed. Live EVM receipts include the actual payer and fee when recorded. Native setup fees are displayed before signing. The number of wallet approval screens and device-level completion times require the fresh-device trial.

## Dependencies and licence

Original application code is MIT licensed. QoreChain PQC supplies ML-DSA-87, QoreSign constructs registrations and hybrid signatures, and the wallet adapter composes scoped windows. QoreSeal (Apache-2.0) seals notes with ML-KEM-1024 and builds the key registration, and QoreX types (Apache-2.0) supply the QoreX provider helpers. Cosmos protobuf types encode the native transaction envelope. Ethers handles EVM access, wallet signatures and encrypted backups. Node SQLite persists application state. Africa's Talking supplies SMS transport, and SMS Gateway for Android (Apache-2.0) can send it from the organiser's own phone. Hardhat, solc-js, esbuild, Playwright and axe-core support build and validation. Outfit is bundled from Fontsource under the SIL Open Font License. The app was built from the supplied concept without a starter application.
