import {
  HDNodeWallet,
  Contract,
  Interface,
  decodeBase64,
  JsonRpcProvider,
  VoidSigner,
  getAddress,
  getBytes,
  parseUnits,
} from "ethers";
import { keystore } from "./keystore.js";
import {
  buildRegisterKemKeyMessage,
  deriveSealKeys,
  envelopeFromText,
  envelopeToText,
  open as openEnvelope,
  seal as sealEnvelope,
} from "@qorechain/qoreseal";
import {
  QORECHAIN_TESTNET_EVM_CHAIN_ID,
  QOREX_DOWNLOAD_URLS,
  discoverQorexEip1193,
} from "@qorechain/qorex-types";
import {
  qorAddress,
  openWindow,
  convertFusd,
  callEvm,
  prepareKey,
  swapForFees,
} from "./native.js";
const erc20 = [
  "function approve(address,uint256) returns(bool)",
  "function balanceOf(address) view returns(uint256)",
  "function allowance(address,address) view returns(uint256)",
  "function transfer(address,uint256) returns(bool)",
];
const escrow = [
  "function fund(bytes32,uint128,uint64)",
  "function claim(bytes32,uint64,bytes)",
  "function refund(bytes32)",
];
const rpc = "https://evm-testnet.qore.host";
// Sealed notes: ML-KEM-1024 envelopes made with QoreSeal, to keys published
// on QoreChain's encryption-key registry.
const NOTE = { chainId: "qorechain-diana", purpose: "clainova-note-v1" };
const tokenCalls = new Interface(erc20),
  escrowCalls = new Interface(escrow);
// The demo sender keeps its wallet in its own slot, so the same browser can also
// be the recipient with a different wallet.
export function walletTools(cfg, api, progress, slot = "") {
  const local = cfg.mode === "rehearsal",
    storage = "clainova.keystore." + cfg.mode + slot;
  let wallet,
    external = false;
  const provider = local
    ? null
    : new JsonRpcProvider(rpc, 9800, { staticNetwork: true, cacheTimeout: -1 });
  // Reports every tenth only: redrawing on each callback slows the work itself.
  function share(verb) {
    let last = -1;
    return (done) => {
      const tenth = Math.floor(done * 10) * 10;
      if (tenth === last) return;
      last = tenth;
      progress(verb + " your wallet… " + tenth + "%");
    };
  }
  async function unlock(password, file) {
    if (password.length < 10)
      throw Error("Use a password of at least 10 characters.");
    const saved = file || localStorage.getItem(storage);
    if (saved) {
      let opened;
      try {
        opened = await keystore({ json: saved, password }, share("Unlocking"));
      } catch {
        throw Error("That password does not open this wallet or backup.");
      }
      if (!opened.phrase)
        throw Error("Choose a Clainova backup with recovery data.");
      wallet = HDNodeWallet.fromPhrase(opened.phrase, "", opened.path);
      if (file) localStorage.setItem(storage, saved);
    } else {
      const created = HDNodeWallet.createRandom();
      // Deliberately slow, so a stolen backup is hard to guess. Slow phones need
      // up to half a minute, so the share done is shown.
      const json = await keystore(
        { phrase: created.mnemonic.phrase, password },
        share("Encrypting"),
      );
      localStorage.setItem(storage, json);
      wallet = created;
    }
    external = false;
    if (provider) wallet = wallet.connect(provider);
    return wallet.address;
  }
  function backup() {
    const url = URL.createObjectURL(
      new Blob([localStorage.getItem(storage)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "Clainova-" + cfg.mode + slot.replace(".", "-") + "-wallet.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
  // QoreX signs Clainova's contract calls on its EVM lane. Its approval shows
  // the decoded call and opens a one-transaction EVM window for that contract,
  // signed with the account's ML-DSA-87 key on the native lane. QoreX refuses
  // MsgCrossVMCall, which it cannot display, and windows opened by a site, so
  // QoreX accounts do not use the cross-VM path of Clainova's own wallets.
  // Only an Ethereum-style (coin 60) QoreX account can send on the EVM lane.
  let qorex;
  async function connect() {
    // Found by its EIP-6963 announcement, as QoreX asks; QoreChain's test
    // double announces under another name and is reached through window.qorex.
    const q = (await discoverQorexEip1193()) || window.qorex?.evm;
    if (!q)
      throw Error("QoreX is not installed in this browser. Get it at " + QOREX_DOWNLOAD_URLS.chrome + " or create a Clainova wallet.");
    if (BigInt(await q.request({ method: "eth_chainId" })) !== BigInt(QORECHAIN_TESTNET_EVM_CHAIN_ID))
      throw Error("Select Diana testnet inside QoreX.");
    const [account] = await q.request({ method: "eth_requestAccounts" });
    if (!account) throw Error("Choose an account in QoreX, then connect again.");
    // Reads, gas and receipts go through Clainova's own Diana connection.
    wallet = new VoidSigner(getAddress(account), provider);
    qorex = q;
    external = true;
    return wallet.address;
  }
  // Gas for one EVM call, from receipts on Diana with about 35% headroom:
  // claim used 441,833 to 446,441, fund 92,093 to 104,393, a transfer 51,577
  // and a refund 45,194. Diana's estimate for a claim, which runs pqcVerify, is
  // about four times too high, and the account pays for the whole limit up front.
  const EVM_GAS = { claim: 600000n, fund: 150000n, transfer: 80000n, refund: 80000n };
  async function viaQorex(to, data, kind) {
    const from = wallet.address;
    const gas = EVM_GAS[kind];
    progress("Approve in QoreX. It opens a one-transaction window for this contract…");
    let hash;
    try {
      hash = await qorex.request({
        method: "eth_sendTransaction",
        params: [{ from, to, data, gas: "0x" + gas.toString(16), chainId: "0x2648" }],
      });
    } catch (err) {
      const text = String(err?.message || err);
      if (/coin.?60|ethereum-style/i.test(text))
        throw Error("QoreX sends contract calls only from an Ethereum-style account. In QoreX, add or select one, then connect again. (" + text + ")");
      throw err;
    }
    progress("Waiting for confirmation… " + hash);
    const r = await provider.waitForTransaction(hash, 1, 120000);
    if (r?.status !== 1) throw Error("The transaction did not settle.");
    return r;
  }
  // The wallet's ML-KEM-1024 keys come from its recovery phrase, so a restored
  // backup opens the same notes. QoreX keeps its phrase, and refuses this
  // registration from websites, so QoreX accounts have no sealed notes.
  let sealKeys;
  const ownSealKeys = () =>
    (sealKeys ||= deriveSealKeys({ mnemonic: wallet.mnemonic.phrase }));
  async function kemKeyOf(address) {
    const r = await api("/api/native/kem/" + qorAddress(address));
    return r.found ? decodeBase64(r.key.public_key) : null;
  }
  // The registration rides in the claim or deposit transaction, the first time.
  async function kemRegistration() {
    if (local || external) return [];
    const mine = ownSealKeys().mlkemPublicKey;
    const listed = await kemKeyOf(wallet.address).catch(() => null);
    if (listed && listed.length === mine.length && listed.every((b, i) => b === mine[i]))
      return [];
    return [
      buildRegisterKemKeyMessage({
        sender: qorAddress(wallet.address),
        mlkemPublicKey: mine,
      }),
    ];
  }
  // Every escrow and token call from a Clainova wallet: one hybrid transaction.
  async function call(calls, kind, conversion, withKem = false) {
    const before = withKem ? await kemRegistration() : [];
    return callEvm(wallet, api, progress, calls, kind, conversion, before);
  }
  const scope = (targets, conversion) =>
    openWindow(wallet, targets, api, progress, conversion);
  async function confirm(tx) {
    const sent = await tx;
    progress("Waiting for confirmation… " + sent.hash);
    const r = await sent.wait(1, 90000);
    if (r?.status !== 1) throw Error("The transaction did not settle.");
    return r;
  }
  return {
    unlock,
    backup,
    connect,
    get saved() {
      return !!localStorage.getItem(storage);
    },
    get current() {
      return wallet;
    },
    get external() {
      return external;
    },
    async fund(row, allowConversion = false) {
      const token = new Contract(cfg.token, erc20, wallet);
      const shortfall =
        BigInt(row.amount) - (await token.balanceOf(wallet.address));
      if (shortfall > 0n && (external || !allowConversion))
        throw Error(
          "Insufficient ERC-20 test fUSD. Enable faucet conversion or fund your ERC-20 balance.",
        );
      const conversion =
        shortfall > 0n
          ? convertFusd(
              qorAddress(wallet.address),
              wallet.address,
              cfg.token,
              shortfall,
            )
          : undefined;
      const approval =
        (await token.allowance(wallet.address, cfg.contract)) <
        BigInt(row.amount);
      if (!external) {
        progress("Approving and funding in one post-quantum transaction…");
        return call(
          [
            ...(approval
              ? [
                  {
                    to: cfg.token,
                    data: tokenCalls.encodeFunctionData("approve", [
                      cfg.contract,
                      row.amount,
                    ]),
                  },
                ]
              : []),
            {
              to: cfg.contract,
              data: escrowCalls.encodeFunctionData("fund", [
                row.salt,
                row.amount,
                row.expiry,
              ]),
            },
          ],
          "fund",
          conversion,
          true,
        );
      }
      // QoreX: two approvals, each opening a window for its one contract.
      if (approval) {
        progress("Approving the exact payment amount…");
        await viaQorex(cfg.token, tokenCalls.encodeFunctionData("approve", [cfg.contract, row.amount]), "transfer");
      }
      progress("Funding escrow…");
      return viaQorex(cfg.contract, escrowCalls.encodeFunctionData("fund", [row.salt, row.amount, row.expiry]), "fund");
    },
    async prepare() {
      if (local || external) return;
      return prepareKey(wallet, api, progress);
    },
    async claim(row, a) {
      if (!local && !external) {
        progress("Collecting in one post-quantum transaction…");
        return call(
          [
            {
              to: cfg.contract,
              data: escrowCalls.encodeFunctionData("claim", [
                row.id,
                a.deadline,
                a.signature,
              ]),
            },
          ],
          "claim",
          undefined,
          true,
        );
      }
      return viaQorex(
        cfg.contract,
        escrowCalls.encodeFunctionData("claim", [row.id, a.deadline, a.signature]),
        "claim",
      );
    },
    async refund(row) {
      if (!local && !external)
        return call(
          [{ to: cfg.contract, data: escrowCalls.encodeFunctionData("refund", [row.id]) }],
          "refund",
        );
      if (external)
        return viaQorex(cfg.contract, escrowCalls.encodeFunctionData("refund", [row.id]), "refund");
      await scope([cfg.contract]);
      return confirm(new Contract(cfg.contract, escrow, wallet).refund(row.id));
    },
    // Test QOR held by this wallet, in wei, to decide on a gas top-up.
    gas: async () => (local ? 0n : provider.getBalance(wallet.address)),
    async waitForGas(minimum) {
      for (let i = 0; i < 30; i++) {
        if ((await provider.getBalance(wallet.address)) >= minimum) return;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      throw Error("The gas top-up is still confirming. Wait a moment, then retry.");
    },
    qor: () => qorAddress(wallet.address),
    // Sealed notes need a Clainova wallet whose key is on the registry.
    get canSeal() {
      return !local && !external && !!wallet?.mnemonic;
    },
    kemKeyOf,
    // Seals to the other party and to this wallet, so both can read the thread.
    async sealNote(text, to) {
      const theirs = await kemKeyOf(to);
      if (!theirs) throw Error("The other wallet has no encryption key on QoreChain yet.");
      const envelope = sealEnvelope({
        ...NOTE,
        recipients: [{ mlkemPublicKey: theirs }, { mlkemPublicKey: ownSealKeys().mlkemPublicKey }],
        plaintext: new TextEncoder().encode(text),
        mode: "mlkem",
      });
      return envelopeToText(envelope);
    },
    openNote(text) {
      try {
        return new TextDecoder().decode(
          openEnvelope({ ...NOTE, envelope: envelopeFromText(text), keys: ownSealKeys() }),
        );
      } catch {
        return null;
      }
    },
    // 0.01 test fUSD by default, swapped for QOR in QoreChain's own pool.
    swapForFees: (amount = 10000n) =>
      swapForFees(wallet, api, progress, cfg.token, amount),
    sign: (payload) => wallet.signMessage(getBytes(payload)),
    balance: async () =>
      local
        ? (await api("/api/balance/" + wallet.address)).balance
        : Number(
            await new Contract(cfg.token, erc20, provider).balanceOf(
              wallet.address,
            ),
          ),
    async send(to, value) {
      to = getAddress(to);
      const amount = parseUnits(value, 6);
      if (amount <= 0n || amount > 10000n * 1000000n)
        throw Error("Enter a positive amount up to 10,000 test fUSD.");
      if (!local && !external) {
        progress("Sending in one post-quantum transaction…");
        return call(
          [{ to: cfg.token, data: tokenCalls.encodeFunctionData("transfer", [to, amount]) }],
          "transfer",
        );
      }
      if (!local)
        return viaQorex(cfg.token, tokenCalls.encodeFunctionData("transfer", [to, amount]), "transfer");
      const body = {
        to,
        from: wallet.address,
        amount: Number(amount),
        time: Math.floor(Date.now() / 1000),
        nonce: crypto.randomUUID().replaceAll("-", ""),
      };
      body.proof = await wallet.signMessage(
        [
          "Clainova rehearsal transfer",
          body.from,
          to,
          body.amount,
          body.time,
          body.nonce,
        ].join("|"),
      );
      return api("/api/transfer", body);
    },
  };
}
