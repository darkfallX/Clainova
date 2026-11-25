# Clainova security review · 24 November 2026

**Reviewer:** Claude Code (Anthropic, Claude Opus 5.5). This is an AI code review. It is not a human security review and not a substitute for the two QCAI audit rounds, which are in [AUDIT.md](AUDIT.md).

**Scope:** `contracts/ClainovaClaims.sol` and the Node service (`server/*.mjs`). The review was done by reading the code and checking each finding against its code path. The browser wallet code was out of scope except where it calls the service.

## Findings

| # | Severity | Area | Finding | Status |
|---|---|---|---|---|
| 1 | Medium (tunnel deployment) | `server/start.mjs` | Rate limits key on the socket address. Behind a Cloudflare tunnel every request arrives from loopback, so all visitors share one bucket. Eight wrong organiser passwords from anyone would block the real organiser's sign-in for ten minutes. | **Fixed.** With `TRUST_PROXY=cloudflare`, a loopback request uses `CF-Connecting-IP`. The header is ignored otherwise, so it can't be spoofed on a directly exposed port. |
| 2 | Low | `ClainovaClaims` | The verifier key is fixed at deployment, and there is no pause or rotation. A compromised verifier seed can authorise any wallet for any funded, unexpired payment. | Accepted and documented as the main trust assumption. The seed stays in operator configuration only. A future version needs key rotation or multiple verifiers. |
| 3 | Low | `server/service.mjs` attest | The first attested wallet is bound to the invitation permanently. If the recipient loses that wallet before collecting, they can't rebind, and the funds wait for the organiser's refund at expiry. | Accepted. Binding prevents a later SIM takeover from redirecting a payment. Recovery is the encrypted backup or the refund. |
| 4 | Low | `server/native.mjs` | The native broadcast proxy needs no sign-in. Anyone can relay a key registration, a window opening or a coin conversion through the service. | Accepted. Only three message types are relayed, each is signed by its own account, and requests are size-capped and rate-limited. |
| 5 | Info | `ClainovaClaims` | Checks-effects-interactions holds in `fund`, `claim` and `refund`, because state is set before every token call. The payment ID commits to the sender, so another account can't occupy it. The claim message binds the domain, chain, contract, payment, `msg.sender` and deadline, and the deadline can't exceed expiry. | No action. |
| 6 | Info | Verification | A code has 5 attempts, and each invitation can request 5 codes an hour, so at most 25 guesses an hour against 10⁶ codes. Comparisons are constant-time over hashes. | No action. |
| 7 | Info | HTTP | The service sends a strict CSP, `no-store`, `no-referrer`, `nosniff` and `DENY` framing. Every POST must carry the exact origin and JSON. Organiser cookies are HttpOnly, SameSite=Strict and Secure on testnet. Bodies are capped at 24 kB. | No action. |

## Update, 25 November 2026

Claude Code's notes on its own changes. This is not an independent review.

| Severity | Area | Change |
|---|---|---|
| Low | Gas sponsor | The sponsor used an EVM transfer, which needed a native-only window kept open by hand. It now sends a hybrid-signed native transfer, so its classical key alone cannot spend. |
| Low | Gas sponsor | A grant could stay blocked behind a stale nonce. A replacement is now signed once the saved bytes can no longer land. Diana's index gets ten seconds before that decision, so a slower index could pay one extra grant. |
| Low | Receipts | A closed browser left a collection without a receipt, so later spends were refused as evidence. The server now finds the event on Diana. |
| Info | `/api/health` | Public and cached for ten seconds. It shows the block, the escrow, the message channel and the sponsor's account and balance, and no phone data. |
| Info | Test outbox | `SMS_PROVIDER=outbox` stores phone numbers and codes in plain text in the data folder. Use it for team runs only and delete the file afterwards. |
| Info | Public demo | `/try` hands out pre-funded payments whose code is shown on the page. Anyone can collect one, so fund only small amounts. Each network address can start five a day, each visitor holds one, and a payment bound to a wallet is never reassigned. Grants count against the sponsor's 20 a day. |
| Info | Wallet encryption | Keystore work moved to a same-origin worker, so a slow phone no longer freezes. The recovery phrase and passphrase are passed to that worker in memory. The encryption strength is unchanged. |
| Info | Proxy headers | `TRUST_PROXY` now also covers Fly.io and hosts that append to `X-Forwarded-For`, using only the entry the nearest proxy added. |
| Info | Recipient page | The organiser menu was visible to recipients because a style overrode its hidden state. Fixed. |

## Operating notes for the tunnel deployment

- The private invitation link is a bearer secret for viewing the receipt. Collection still needs the code sent to the phone. Don't log request URLs. `cloudflared` doesn't log paths at its default level.
- A quick-tunnel URL changes on every restart. Restart the service with the new `PUBLIC_ORIGIN` so the SMS links stay valid.
- Keep `.env` and `.data/` private and back them up together.
