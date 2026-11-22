# Clainova festival assessment

## Event and eligibility

Build Before Q-Day is the QoreChain Association's Developer Fest. It encourages original testnet applications with post-quantum protection. The published tracks are Quantum Pass, Post-Quantum dApp, Post-Quantum AI Agents, Encrypted Apps, Cross-VM and Protocol Builders. The site advertises $20,000 across category and special prizes. The Post-Quantum dApp track fits Clainova's escrow and permits one to three people. Its three prizes are $1,500, $750 and $500. Its required evidence includes a scoped EVM window, pqcVerify, two QCAI audit rounds and Hardhat or Foundry tests. [Rules](https://build.qorechain.io/rules) · [Prizes](https://build.qorechain.io/prizes)

Each participant must be at least 18 and register with GitHub, X and a QoreX testnet address. Work must be built during the festival. The public MIT or Apache-2.0 repository needs a README and library/template credits. Include a featured image, a working demonstration video up to three minutes and the testnet addresses used. The project page becomes read-only on **2 December 2026 at 23:59 UTC**, which is **3 December at 00:59 in Lagos**. Checks follow on 3–5 December and judging on 6–15 December. Results are scheduled for 16 December. Finalists can receive a change request with a 48-hour response window. [Submission procedure](https://build.qorechain.io/start) · [Rules](https://build.qorechain.io/rules)

The special categories are Q-Day Survivor, People's Choice, Best AI-Native Build, Quantum Campus, Regional and Top-Quality. The optional AI-native award is $500 and requires the form selection and AI_USAGE.md. The regional award is $200 for the highest-scored eligible entry in each region that receives no other prize. Country selection should reflect the builder's actual residence. The drill registration deadline has passed. [Prizes](https://build.qorechain.io/prizes) · [Milestones](https://build.qorechain.io/start)

## Competition and refinement

The public gallery displayed **120 projects** during this review on 21 November. These are visible project pages at that moment. The deadline and eligibility review come later. A page listing or project description alone cannot establish that an entry meets the final requirements. [Public gallery](https://build.qorechain.io/projects)

| Entry | Published mechanics | Implication for Clainova |
|---|---|---|
| Postmark | GitHub issue bounties, test QOR and multiple signed verdicts with a challenge period. Its authors describe real deployments and extensive tests. | A developer bounty alone is a weak differentiator. Demonstrate payment before wallet creation and measure collection friction. [Postmark](https://build.qorechain.io/p/postmark) |
| Haven Escrow | fUSD milestones with the client and freelancer fixed up front, signed release and dispute handling. | The important difference is **when the recipient address becomes known**. Clainova sets it after phone verification. [Haven Escrow](https://build.qorechain.io/p/haven-escrow) |
| QoreFlow and Cista | Their public summaries describe payment streaming and sealed payroll respectively. | A simple professional payout overlaps with both. Focus the demonstration on the first invitation, account setup and a recipient-initiated second transaction. [Gallery](https://build.qorechain.io/projects) |

The strongest first customer is an organiser with an existing obligation and an expected recipient. A workshop speaker understands why the invitation arrived. A household remittance would need cash-out and additional trust. Neither adoption in four countries nor competing projects' lack of onboarding was verified. Country support in this build means phone validation, with carrier routing still subject to provider access. A direct sign-up and how long it takes remain empirical questions.

## Submission evidence

| Item | Local delivery |
|---|---|
| Source and tests | Present. Run the README commands from a clean checkout. |
| Signature compatibility | Live Diana read at block 10,513,660 on 21 November returned true for valid bytes and false after the message changed. fUSD returned six decimals. Reproduce with node scripts/probe.mjs. |
| Cover and recording | submission/cover.png and submission/rehearsal.mp4 show the actual local app. The recording uses a genuine one-minute expiry. The faster automated regression moves a disposable fixture to the same boundary. |
| Public repo and project registration | Owner publication, accounts and contest form pending. |
| Deployment, native transaction hashes and real SMS | Require operator funding, deployment, service configuration and a consenting recipient. |
| Two-stage QCAI review | Requires dashboard sign-in. Run the auditor on the escrow, save its report with the source revision, address findings, run again and save the second report. [Official auditor](https://docs.qorechain.io/dashboard/contract-auditor/) |
| Fresh-device trial | Record the initial address state, OTP, wallet creation, native registration and window transactions, EVM collection, fee payer, elapsed time, prompts and a later recipient transfer. Keep team runs labelled separately. |

The local demo opens with a phone payout, follows the private invitation through code verification and wallet creation, then spends from the receiving wallet. End at the organiser's ledger. For a festival submission, replace the rehearsal footage with a consenting recipient on Diana and show settlement evidence. Do not include OTPs, private links, passphrases, recovery words or private phone numbers from real recipients in public footage.
