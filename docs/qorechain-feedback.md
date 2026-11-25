# What we found while building on QoreChain

Notes for the QoreChain team from building Clainova, 25 November 2026. Each one was checked in a clean browser or on Diana. Thank you for the kits: `@qorechain/qoresign` and the `pqcVerify` precompile did exactly what their docs say.

## 1. The explorer rejects Ethereum-style transaction hashes

- **See it:** open `https://explore.qore.network/tx/0x3b932cfe10e2cd782bfe8bf139271c525695e7a6a097e54fcf0838ae1ae2caf2`.
- **Result:** `encoding/hex: invalid byte: U+0078 'x'`.
- **Why it matters:** every EVM wallet and library shows this form, so a dApp's "view transaction" link fails.
- **Suggested fix:** when the hash starts with `0x`, look it up with the query `ethereum_tx.ethereumTxHash='0x…'`, which the REST API already answers, and redirect to the native hash. Clainova does this in `server/evidence.mjs`.

## 2. A shared testnet link opens on mainnet

- **See it:** in a private window, open `https://explore.qore.network/tx/194CBDE372C1C585D7D5BE65A4AE694A9A9034A3D710A1507EE6506C4DC415F8`. It is a Diana transaction in block 10,736,121.
- **Result:** "Transaction not found". Adding `?network=testnet` does not change it. The network is kept in a cookie.
- **Why it matters:** jurors who follow a builder's link see a missing transaction.
- **Suggested fix:** accept the network in the URL, or try the other network before saying "not found".

## 3. A new wallet that receives tokens cannot move them

- **See it:** send 1 test fUSD to a new address, then try to send it on. We did this with five new wallets. [Results](../submission/live-check.json)
- **Result:** `code 8: account has no PQC key and classical fallback is disabled`. Registering the key first fails with `code 5: spendable balance 0uqor is smaller than 50000uqor`.
- **Why it matters:** refusing the transfer is right. But someone paid in a token, who holds no QOR, has no way forward without finding QOR elsewhere. It is the gap Clainova's sponsor fills.
- **Question:** could the first possession-proven registration be free, or could a fee grant cover it? Every payment app on QoreChain would benefit.
