# Clainova • decision record, 21 November 2026

A community organiser owes a speaker for a workshop. The organiser knows their phone number before either party knows the receiving wallet. Clainova should make the invitation, collection deadline and recovery of unclaimed funds visible on one receipt.

## Product and interface

We considered a wallet dashboard, a marketing landing page and a payment counter. The counter puts the form and its live payment slip side by side. The slip follows the recipient through verification and collection. Warm paper (#f6f2e7), aubergine ink (#29212e), orange-red postage (#bc4527), and dark green confirmations (#285244) reference printed money orders. Use local Outfit, tabular digits, 4–24 px spacing, thin rules, square receipts and modest control radii. Maximum page width 1160 px. The paper folds beneath the form on phones. When a payment changes state the status stamp settles over 220 ms. Under reduced motion it appears immediately. The reference for the input, review and confirmation sequence is Coinbase's [send flow](https://help.coinbase.com/en-gb/wallet/sending-and-receiving/how-do-i-send-and-receive-crypto-through-wallet).

## Architecture review

Use one Node 22 service, SQLite for durable invitations and throttles, a bundled browser client and one immutable Solidity escrow for the six-decimal festival token. A phone record stays off-chain. A private random link is distinct from the public on-chain ID. A server-generated ML-DSA-87 attestation authorises one destination. Recipient submits directly. The escrow independently checks proof of possession and signs over the full settlement domain. An organiser can recover expired deposits. A failed SMS must preserve the funded claim and permit redelivery.

Testing the published adapter revealed that it refuses a third-party window-open message. The implemented default creates an encrypted coin-60 wallet in the browser and uses QoreSign for possession-proven registration and a target-limited native window. The external option checks an already-open window and matches QoreX to its EVM signer. Live funding requires converted ERC-20 fUSD and two scoped targets (token approval and escrow). Recipient requires one target. The built-in wallet generates its own recovery material on the device. Existing wallet recovery phrases are never requested. A single-organiser deployment uses operator authentication for sending and listing. A separate loopback rehearsal uses SQLite balances, browser-owned signing keys and a visible local inbox. Demonstration numbers must never be reported as adoption. Primary release gate is a real zero-balance recipient completing setup, funded claim and follow-on transfer.

## Build order

Implement and test settlement, OTP and state transitions, connect wallet and SMS adapters, then build counter, recipient receipt and ledger. Check wrong destinations, expiry boundaries, recoverability and narrow screens before recording the demo. Exclude cash-out, persistent phone handles and disputes.
