import {
  Wallet,
  Contract,
  BrowserProvider,
  JsonRpcProvider,
  getAddress,
  getBytes,
  parseUnits,
} from "ethers";
import { qorAddress, openWindow, convertFusd } from "./native.js";
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
export function walletTools(cfg, api, progress) {
  const local = cfg.mode === "rehearsal",
    storage = "clainova.keystore." + cfg.mode;
  let wallet,
    external = false;
  const provider = local
    ? null
    : new JsonRpcProvider(rpc, 9800, { staticNetwork: true, cacheTimeout: -1 });
  async function unlock(password, file) {
    if (password.length < 10)
      throw Error("Use a passphrase of at least 10 characters.");
    const saved = file || localStorage.getItem(storage);
    if (saved) {
      try {
        wallet = await Wallet.fromEncryptedJson(saved, password);
      } catch {
        throw Error("The passphrase or encrypted backup is incorrect.");
      }
      if (!wallet.mnemonic)
        throw Error("Choose a Clainova backup with recovery data.");
      if (file) localStorage.setItem(storage, saved);
    } else {
      wallet = Wallet.createRandom();
      const json = await wallet.encrypt(password);
      localStorage.setItem(storage, json);
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
    a.download = "Clainova-" + cfg.mode + "-wallet.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
  async function connect() {
    const q = window.qorex?.evm;
    if (!q) throw Error("Open QoreX on Diana or create a Clainova wallet.");
    if (BigInt(await q.request({ method: "eth_chainId" })) !== 9800n)
      throw Error("Select Diana testnet inside QoreX.");
    const [account] = await q.request({ method: "eth_requestAccounts" });
    const evm = window.ethereum || q;
    const browser = new BrowserProvider(evm);
    if ((await browser.getNetwork()).chainId !== 9800n)
      throw Error("Select Diana (9800) in the EVM wallet.");
    wallet = await browser.getSigner();
    if (wallet.address !== getAddress(account)) {
      wallet = null;
      throw Error("Select the same coin-60 account in both wallets.");
    }
    external = true;
    return wallet.address;
  }
  async function scope(targets, conversion) {
    if (!external)
      return openWindow(wallet, targets, api, progress, conversion);
    const state = await api("/api/native/window/" + qorAddress(wallet.address));
    const allowed = (state.allowed_targets || []).map((x) => x.toLowerCase());
    if (
      !state.live ||
      Number(state.remaining_txs) < targets.length ||
      Number(state.max_txs) > 2 ||
      Number(state.remaining_blocks) > 120 ||
      allowed.length !== targets.length ||
      !targets.every((t) => allowed.includes(t.toLowerCase()))
    )
      throw Error(
        "Open a 120-block window with " +
          targets.length +
          " transaction(s), limited to " +
          targets.join(", ") +
          ". See the wallet setup in the README.",
      );
  }
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
      await scope(
        approval ? [cfg.token, cfg.contract] : [cfg.contract],
        conversion,
      );
      if (approval) {
        progress("Approving the exact payment amount…");
        await confirm(token.approve(cfg.contract, row.amount));
      }
      progress("Funding escrow…");
      return confirm(
        new Contract(cfg.contract, escrow, wallet).fund(
          row.salt,
          row.amount,
          row.expiry,
        ),
      );
    },
    async prepare() {
      if (!local) await scope([cfg.contract]);
    },
    async claim(row, a) {
      return confirm(
        new Contract(cfg.contract, escrow, wallet).claim(
          row.id,
          a.deadline,
          a.signature,
        ),
      );
    },
    async refund(row) {
      await scope([cfg.contract]);
      return confirm(new Contract(cfg.contract, escrow, wallet).refund(row.id));
    },
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
      if (!local) {
        await scope([cfg.token]);
        return confirm(
          new Contract(cfg.token, erc20, wallet).transfer(to, amount),
        );
      }
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
