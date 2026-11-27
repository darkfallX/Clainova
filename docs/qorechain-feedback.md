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

## 4. A cross-VM call into the EVM leaves no EVM log

- **See it:** native transaction `4267CB572E6BBAF79CE21EBF2165B1A326EF432C897366FCC22073C6E69FB916` (Diana, block 10,840,415) is a `MsgCrossVMCall` that ran `claim` on our escrow. Its `crossvm_response` says `executed`, and the escrow's state changed. But `eth_getLogs` for blocks 10,840,414 to 10,840,416 returns nothing, and `eth_getBlockByNumber` lists no EVM transaction.
- **Result:** the escrow's `Collected` event and the token's `Transfer` event exist only in the contract's state. EVM indexers, explorers and any app that waits for an event never see the call.
- **Why it matters:** cross-VM is the way to reach the EVM with a post-quantum signature and no window, which is what we moved Clainova to. Every app that does the same loses its event history.
- **What we do meanwhile:** `server/evidence.mjs` checks a cross-VM receipt from the signed `MsgCrossVMCall` payload, the `crossvm_response` event and the escrow's current state. It finds unreported ones with the native query `crossvm_request.target_contract='…' AND crossvm_request.sender='qor1…'`.
- **Suggested fix:** record the EVM logs of a synchronous cross-VM call in the native transaction's events (as `tx_log` does for EVM transactions), or index them for `eth_getLogs` under the native hash.

## 5. The cross-VM reference leaves out one rule

- **See it:** send `MsgCrossVMCall` with `source_vm` set to `evm` and `target_vm` set to `evm`, as SDK 0.14.0's `buildCall` default suggests for a native account.
- **Result:** `source and target VM must differ: invalid cross-VM message`, refused at broadcast. The reference says the chain ignores `source_vm`. With `source_vm` set to `cosmwasm`, the same call runs, and the chain records it as `native`.
- **Suggested fix:** say in the reference that `source_vm` must still differ from `target_vm`, or have the chain ignore it as documented.

## 6. Spending rules cannot protect a new user's own key

- **What we wanted:** Clainova creates a wallet in the recipient's browser. We wanted QoreChain's spending rules to cap what that wallet can send each day, so a stolen device or password loses at most the cap.
- **What we found:** the [account abstraction guide](https://docs.qorechain.io/developer-guide/account-abstraction) says `MsgUpdateSpendingRules` limits linked keys and session keys acting through `MsgExecuteEVM` or `MsgExecuteCosmos`, never the account owner's own key. The permission schema on Diana (`/qorechain/abstractaccount/v1/permission_schema`) has no entry for `MsgCrossVMCall`, so a linked key cannot make the cross-VM calls Clainova uses either. We dropped the feature rather than fake the cap in the app.
- **Why it matters:** first-time users hold their keys in a browser, and a daily cap on the owner's own outgoing value would be the simplest protection for them. Linked keys are classical (secp256k1 or Ed25519), so moving spending to one would also weaken the post-quantum story.
- **Question:** could a spending rule optionally bind the owner's own key, with a timelock to raise it, signed with the owner's ML-DSA-87 key?
