# Clainova: concept and build plan

> **"Pay anyone in Africa by phone number, before they have a wallet. They claim it into a quantum-safe QoreChain account they control, and if they don't, you get it back."**

- **Hackathon:** QoreChain "Build Before Q-Day". Category: **Post-Quantum dApp** (1st $1,500).
  - Stack: **Best AI-Native Build** ($500, via `AI_USAGE.md`).
  - Regional **Middle East & Africa** ($200, only if we win nothing else).
- **Deadline:** 2 Dec 2026, 23:59 UTC (00:59 on 3 Dec in Lagos). There's no submit button; the project page freezes. **Our own target: 1 Dec.**
- **Network:** QoreChain testnet (`qorechain-diana`, EVM 9800). The fest runs on testnet only.
- **Builder:** one person.

---

## 1. The pitch: growth for QoreChain, through Africa

**Every project in the gallery (108 of them) assumes the user is already on QoreChain.** Clainova is the one that **brings new people in**: an existing user can pay someone who has **never heard of QoreChain**, and that person ends up with **their own quantum-safe account**.

**Africa is where this playbook is proven:**
- Phone numbers are how Africa moves money (M-Pesa, MTN MoMo, OPay, Airtel Money).
- **MiniPay** (Opera, on Celo), where every wallet is a verified phone number, reported **over 20 million activations globally** (Opera press release, 19 Nov 2026), driven by African demand. *Credit that precedent honestly:* MiniPay also had Opera Mini's distribution, funding partners and apps to spend in.
- Stablecoins are about **43% of Sub-Saharan Africa's crypto volume** (Chainalysis, via secondary coverage; check the report year).

**Launch region: four of Africa's giants, Nigeria, Kenya, Ghana and South Africa.** SMS through Africa's Talking covers all four, and payments are addressed by country code (+234, +254, +233, +27).

**Precedent, not novelty:** Coinbase Wallet already sends by claim link and returns unclaimed funds after two weeks. **What's new is the destination:** the recipient's first account is **quantum-safe**, and **only such an account can collect.**

**Note:** "bring QoreChain millions of users" is **our growth thesis**, not one of the published judging criteria. The rubric for this category is: scoped EVM window, `pqcVerify`, a two-stage QCAI audit, and Foundry/Hardhat tests. **We meet each one explicitly.**

---

## 2. The first customer: an African community organiser who owes people money

**Who sends the first payment?** **A developer-community organiser** (in Lagos, Nairobi, Accra or Johannesburg) paying **workshop speakers, bounty winners or hackathon helpers** who don't have QoreX yet.

**Why this customer and not family remittances:**
- **The sender has a reason to send.** They owe the money.
- **The recipient expects a message** from someone they know, so they trust it.
- **Both sides are developers or builders,** comfortable creating a wallet.
- **No cash-out is needed** to make it useful. A family receiving money for household bills would need a local-currency cash-out, which this prototype doesn't provide.

**Why they come back:** a recipient who claims a bounty now has a working QoreChain account. **We measure whether they make their own first transaction** (§6).

---

## 3. How it works

1. **The organiser sends.** In Clainova they enter `+254 7…` and **20 test fUSD**, plus an optional note ("Workshop speaker, 18 Nov"). The funds go into `ClainovaClaims` under a **fresh, opaque claim ID for this one payment.** **No phone number or phone hash goes on-chain.** The claim ID ↔ phone link stays **off-chain**, in the verifier.
2. **The recipient gets an SMS:** *"Ada (Lagos Web3 Club) sent you 20 test fUSD on QoreChain testnet. Claim by 4 Dec: clainova.example/c/…"* It says **"test fUSD"** exactly, never "USD".
3. **They verify control of the number** with a one-time code. **That proves current control of the number, not legal identity**, and we say so.
4. **They create a QoreX account.** Clainova guides them through:
   - registering the **ML-DSA-87 key** (that needs ~0.1 test QOR for the fee, which **Clainova's sponsor covers**: rate-limited and tied to this claim)
   - opening a **scoped EVM window** (expiry, a maximum of 1–2 transactions, only the `ClainovaClaims` contract)
5. **The verifier signs an ML-DSA-87 attestation bound to exactly one claim:** `(claimId, destination address, chainId, ClainovaClaims address, expiry)`.
6. **They claim.** `ClainovaClaims.claim(claimId, destination, attestation)`:
   - checks the attestation with **`pqcVerify`**
   - requires that **`msg.sender == destination`**, so the attestation can only be used by the account it names
   - pays out **once**
7. **If nobody claims by the expiry,** a refund becomes **available**. **The organiser** (or anyone, on their behalf) calls `refund(claimId)`, and the funds go back to the sender. We say who sends that transaction; we don't call it "automatic".

**If gas is sponsored through a relayer** (instead of the recipient sending the claim themselves): the recipient **signs the claim intent with their registered ML-DSA key**, and the contract checks *that* signature with `pqcVerify` too. That's because a relayer's own window says nothing about the recipient. **Day 1 decides which path we use** (§7).

---

## 4. Why it's deeply QoreChain (each rubric item has a real job)

| Rubric item | Its job in Clainova |
|---|---|
| **Scoped EVM window** | The recipient's first window is opened by their new post-quantum key: short expiry, 1–2 transactions, **only `ClainovaClaims`**. The organiser's sends are also inside a window. |
| **`pqcVerify`** | Checks the verifier's attestation, bound to claim + destination + chain + contract + expiry. In the relayer path it also checks **the recipient's own ML-DSA-signed claim intent.** |
| **Two-stage QCAI audit** | Run on `ClainovaClaims` before and after fixes, with both reports in the repo |
| **Foundry tests** | Claim, double claim, wrong destination, expired attestation, forged attestation, attestation replayed on another claim or contract, refund before and after expiry |

**Two honest notes:**
- The docs list **`pqcVerify` as active on testnet and inactive on mainnet** in the current release.
- The **abstract-account module is disabled on mainnet.** So the launch story depends on QoreChain enabling these, and we say so.

---

## 5. Safety and limits (stated plainly)

| Topic | What's true |
|---|---|
| **Who controls an unclaimed payment** | The **contract** holds the funds. **The verifier decides which wallet a claim can go to**, by signing the attestation. If the verifier is wrong or compromised, a valid signature authorises the wrong wallet. That's why each attestation is bound to **one claim, one destination, one chain, one contract and one expiry**. It's the main trust assumption, and it's in the threat model. |
| **Privacy** | No phone number and no phone hash on-chain (a hash of a phone number is guessable). A fresh claim ID per payment, so payments can't be linked. The verifier does see phone numbers. |
| **Recycled numbers** | v1 has **no permanent phone → wallet mapping**, so a recycled number can't inherit someone's routing. Each payment is a fresh invitation. |
| **Not real money** | Test fUSD only. Real use needs a stablecoin plus local cash-out in each country. |
| **One verifier** | v1 is centralised, like Celo's phone verification. Later: several verifiers. **Not in this build.** |

---

## 6. What we measure (honest growth numbers)

| Count | Definition |
|---|---|
| **Invitations** | Payments sent to numbers with no claimed account. **An invitation is not a user.** |
| **Completed claims** | Invitations claimed into an account |
| **First-time accounts** | Claims whose destination had **no QoreChain history** before the claim |
| **Returning recipients** | Recipients who later **start their own transaction** (the real sign of a new user) |
| **Drop-off** | The step where each unfinished claim stopped: SMS opened / code verified / wallet created / key registered / window opened / claimed |
| **Time and prompts** | Time from SMS to funds, **how many approval prompts** the recipient saw, **who paid each fee** |

**Team test runs are labelled separately.** A payment to someone who's already a user is ordinary use, not growth.

---

## 7. Build plan (solo, 20 Nov → 1 Dec)

| Day | Goal | Done when |
|---|---|---|
| **1 (21 Nov)** | **The first-claim experiment, before any registry or extra feature** | From a **fresh phone or browser profile, with no QoreX and zero QOR**: create a wallet → register the ML-DSA key → open a window → collect a hand-made claim. **Record every fee and who paid it, every prompt, and whether the person gets back to the claim after setting up the wallet.** This decides between the direct path and the relayer path. |
| 2 | Accounts and first post | Register for the fest, faucet, `create-qorechain-dapp` starter, first hybrid transaction. **First X post** (#BuildBeforeQDay) about the onboarding problem. |
| 3–4 | `ClainovaClaims` | send (opaque claim ID), claim (`pqcVerify` attestation, `msg.sender == destination`, single use), refund after expiry. Foundry tests (§4). |
| 5 | Verifier + sponsor | One-time code by SMS (Africa's Talking sandbox; real phones if possible), ML-DSA-87 attestation (`@qorechain/pqc`), the rate-limited gas sponsor for new accounts |
| 6–7 | Web app | **Send** (organiser) · **Claim** (recipient: SMS link → code → wallet setup → claim, with the steps shown clearly) · **Refund** · **Board** (the §6 numbers) |
| 8 | Audit | QCAI audit round 1 → fixes → round 2. All refusal cases recorded on testnet. |
| **9 (29 Nov)** | **Real recipients** | One organiser (you) pays real people who are new to QoreChain: **in Nigeria first**, plus anyone reachable in **Kenya, Ghana or South Africa**. Record who finished, who dropped out, and why. **Fix whatever made someone need help.** |
| 10 | Story | README (threat model, limits, measurements), `AI_USAGE.md`, 16:9 cover, video |
| **11 (1 Dec)** | **Done** | Every submission item checked. One day of margin before 2 Dec 23:59 UTC. |

**Cut from this build:** Handles, a permanent phone registry, a country map, several verifiers, family remittances, cash-out.

---

## 8. The demo (what the judges see)

**Hand the judge the recipient's phone.**
1. The organiser sends **20 test fUSD** to a number with **no QoreChain account**.
2. The judge opens the SMS → enters the code → creates a wallet (the post-quantum key is registered, the window opens) → approves the claim → **sees the funds.**
3. The judge **sends a small test payment from that new wallet.** It's a real account, not just an address.
4. On screen: **time taken, number of prompts, who paid each fee.**
5. Finally, **an expired claim whose sender has already recovered the funds** (transaction link).
6. **The refusal tests:** forged attestation, double claim, wrong destination, replay on another claim. Each shows its result. Some are refused **before** they reach a block, so they show an error, not a transaction hash.

## 9. Demo video (under 3 minutes)

| Time | Scene |
|---|---|
| 0:00 | "Every app on QoreChain assumes you're already here. How does someone in Nairobi or Accra who's never heard of it get in?" |
| 0:20 | **Clainova.** Pay anyone in Africa by phone number, before they have a wallet. |
| 0:30 | An organiser in Lagos pays a workshop speaker in Nairobi 20 test fUSD. The SMS arrives. |
| 0:50 | The claim on a fresh phone: code → wallet → post-quantum key → window → funds. **The timer and prompt count on screen.** |
| 1:40 | The recipient makes their own first payment. **A new QoreChain user.** |
| 2:00 | The expired claim refunded. The refusals. The real-recipient numbers, drop-outs included. |
| 2:30 | Limits, plainly (one verifier, test tokens, mainnet features still to be enabled). Links. |

## 10. Submission checklist
- [ ] Public repo (MIT or Apache-2.0) + README, with kits and templates credited
- [ ] Testnet `qor1…` addresses (organiser, `ClainovaClaims`, verifier)
- [ ] Kits ticked only where they're really used in the code (`@qorechain/sdk`, `@qorechain/pqc`, QoreX integration…)
- [ ] Foundry tests + **both** QCAI audit reports
- [ ] `AI_USAGE.md` + the AI-native option ticked
- [ ] 16:9 cover (≥1200×675) and a video of up to 3 minutes
- [ ] The real-recipient results, including drop-outs
- [ ] Commits throughout the fest; build posts on X with #BuildBeforeQDay
- [ ] Country set to Nigeria on the project form (for the regional award)

Sources:
- QoreChain: [Prizes and rubrics](https://build.qorechain.io/prizes) · [Start here](https://build.qorechain.io/start) · [Wallet setup](https://docs.qorechain.io/getting-started/wallet-setup/) · [EVM development and precompiles](https://docs.qorechain.io/developer-guide/evm-development/) · [EVM window](https://docs.qorechain.io/qoresign/guides/evm-quantum-ready) · [BillPay Guard](https://build.qorechain.io/p/billpay-guard)
- Precedents: [Coinbase claim links](https://help.coinbase.com/en-gb/wallet/sending-and-receiving/how-do-i-send-and-receive-crypto-through-wallet) · [Opera, 19 Nov 2026](https://press.opera.com/2026/11/19/minipay-privy/)
- Stablecoins in Africa: [Chainalysis via dig.watch](https://dig.watch/updates/stablecoins-now-represent-43-of-africas-crypto-market)
