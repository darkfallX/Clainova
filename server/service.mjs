import { randomInt, timingSafeEqual } from "node:crypto";
import { getBytes, verifyMessage, Wallet } from "ethers";
import {
  FEST,
  now,
  secret,
  hash,
  claimId,
  message,
  requireThat,
  address,
  paymentInput,
} from "./common.mjs";
const LOCAL_CONTRACT = "0x000000000000000000000000000000000000c1a1";
export const equal = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  timingSafeEqual(Buffer.from(hash(a), "hex"), Buffer.from(hash(b), "hex"));
export function service({ store, authority, live, config, clock = now }) {
  const local = !live,
    chain = local ? 31337 : 9800,
    contract = config.contract || LOCAL_CONTRACT;
  const locks = new Set();
  async function locked(key, fn) {
    requireThat(
      !locks.has(key),
      "Request in progress. Try again shortly.",
      409,
    );
    locks.add(key);
    try {
      return await fn();
    } finally {
      locks.delete(key);
    }
  }
  const linkFor = (id) => id.slice(2) + "." + store.sign("invite:" + id);
  function fromLink(link) {
    const id = "0x" + String(link).slice(0, 64);
    requireThat(equal(link, linkFor(id)), "Invitation unavailable.", 404);
    const row = store.get(id);
    requireThat(row, "Invitation unavailable.", 404);
    return row;
  }
  const active = (row) =>
    requireThat(
      row.state === "funded" && row.expiry > clock(),
      "This payment is closed or has expired.",
      409,
    );
  const mine = (owner, id) => {
    const row = store.get(id);
    requireThat(row && row.owner === owner, "Payment unavailable.", 404);
    return row;
  };
  function spendable(owner) {
    return (
      1000e6 -
      store
        .list(owner)
        .filter((r) => ["funded", "collected"].includes(r.state))
        .reduce((v, r) => v + r.amount, 0)
    );
  }
  async function sync(row) {
    if (local || ["collected", "refunded"].includes(row.state)) return row;
    const p = await live.read(row.id);
    if (p.state !== "draft") {
      requireThat(
        p.amount === row.amount &&
          p.expiry === row.expiry &&
          p.sender === row.sender,
        "Deposit differs from invitation.",
        409,
      );
      if (p.state !== row.state)
        return store.patch(row.id, {
          state: p.state,
          ...(p.state === "collected"
            ? { destination: p.destination, ended: clock() }
            : {}),
          ...(p.state === "refunded" ? { ended: clock() } : {}),
        });
    }
    return store.get(row.id);
  }
  function view(row, owner = false) {
    const {
      id,
      amount,
      note,
      state,
      expiry,
      created,
      opened,
      verified,
      destination,
      ended,
      sender,
      delivery,
    } = row;
    return {
      evidence: row.evidence || {},
      observed:
        row.observed?.wallet === row.destination
          ? row.observed?.status
          : undefined,
      cohort: row.cohort,
      id,
      amount,
      note,
      state,
      expiry,
      created,
      opened,
      verified,
      destination,
      ended,
      sender,
      delivery,
      mask: "•••• " + row.last4,
      ...(owner
        ? { salt: row.salt, link: local ? linkFor(id) : undefined }
        : {}),
    };
  }
  async function notify(row) {
    active(row);
    return locked("sms:" + row.id, async () => {
      requireThat(
        store.limit("notify:" + row.id, 5, 3600, clock()),
        "Invitation retry limit reached.",
        429,
      );
      if (!local)
        await live.send(
          store.decrypt(row.phone),
          "Clainova: " +
            row.amount / 1e6 +
            " test fUSD. Claim by " +
            new Date(row.expiry * 1000).toISOString().slice(0, 10) +
            ". " +
            config.origin +
            "/c/" +
            linkFor(row.id),
        );
      return store.patch(row.id, {
        delivery: local ? "local inbox" : "accepted by SMS provider",
      });
    });
  }
  function grant(row, token) {
    requireThat(
      token && equal(row.grant, hash(token)) && clock() < row.grantUntil,
      "Verify your number again.",
      401,
    );
  }
  return {
    local,
    contract,
    chain,
    token: FEST,
    sponsored: !!live?.sponsored,
    list: async (owner) => {
      const rows = await Promise.all(store.list(owner).map(sync));
      const recipients = new Set(
        rows.filter((r) => r.state === "collected").map((r) => r.destination),
      );
      const returning = local
        ? [...recipients].filter((dest) =>
            store.db
              .prepare("SELECT 1 FROM transfers WHERE owner=? LIMIT 1")
              .get(dest),
          ).length
        : new Set(
            rows.filter((r) => r.evidence?.transfer).map((r) => r.destination),
          ).size;
      return {
        rows: rows.map((r) => view(r, true)),
        balance: local ? spendable(owner) : null,
        returning,
      };
    },
    async create(owner, body) {
      requireThat(
        /^[a-f0-9-]{36}$/.test(body.requestKey || ""),
        "Missing payment request identifier.",
      );
      const prior = store.db
        .prepare(
          "SELECT id FROM invites WHERE owner=? AND json_extract(data,'$.requestKey')=?",
        )
        .get(owner, body.requestKey);
      if (prior) return view(store.get(prior.id), true);
      const data = paymentInput(body);
      const seconds = Number(body.seconds);
      requireThat(
        [86400, 604800, ...(local ? [60] : [])].includes(seconds),
        "Choose a listed collection period.",
      );
      const sender = local
        ? new Wallet("0x" + store.sign("organiser:" + owner)).address
        : address(body.sender);
      const salt = "0x" + secret(),
        id = claimId(sender, salt),
        t = clock();
      requireThat(
        !local || data.amount <= spendable(owner),
        "Insufficient rehearsal funds.",
        409,
      );
      const row = {
        ...data,
        cohort: local ? "rehearsal" : config.cohort,
        requestKey: body.requestKey,
        phone: store.encrypt(data.phone),
        last4: data.phone.slice(-4),
        id,
        owner,
        sender,
        salt,
        created: t,
        expiry: t + seconds,
        state: local ? "funded" : "draft",
        delivery: "unsent",
      };
      store.save(row);
      if (local) await notify(row);
      return view(store.get(id), true);
    },
    async deliver(owner, id) {
      const row = await sync(mine(owner, id));
      return view(await notify(row), true);
    },
    async refund(owner, id) {
      const row = await sync(mine(owner, id));
      if (!local) return view(row, true);
      requireThat(
        row.state === "funded" && row.expiry <= clock(),
        "Refund is available after expiry.",
        409,
      );
      return view(store.patch(id, { state: "refunded", ended: clock() }), true);
    },
    async open(link) {
      let row = await sync(fromLink(link));
      if (!row.opened && row.state === "funded")
        row = store.patch(row.id, { opened: clock() });
      return view(row);
    },
    async code(link) {
      const row = await sync(fromLink(link));
      active(row);
      requireThat(
        !row.nextCode || clock() >= row.nextCode,
        "Please wait before requesting another code.",
        429,
      );
      requireThat(
        store.limit("otp:" + row.id, 5, 3600, clock()),
        "Code request limit reached.",
        429,
      );
      const pin = String(randomInt(0, 1000000)).padStart(6, "0");
      store.patch(row.id, {
        pin: store.sign(row.id + ":" + pin),
        pinUntil: clock() + 300,
        attempts: 0,
        nextCode: clock() + 30,
      });
      if (!local)
        await live.send(
          store.decrypt(row.phone),
          "Clainova collection code: " +
            pin +
            ". Valid for five minutes. Do not share it.",
        );
      return local ? { localCode: pin } : { sent: true };
    },
    async verify(link, code) {
      const row = fromLink(link);
      active(row);
      requireThat(
        row.pin && clock() < row.pinUntil && row.attempts < 5,
        "Request a new verification code.",
        409,
      );
      store.patch(row.id, { attempts: row.attempts + 1 });
      requireThat(
        /^\d{6}$/.test(code) && equal(row.pin, store.sign(row.id + ":" + code)),
        "That code is incorrect.",
      );
      const token = secret();
      store.patch(row.id, {
        pin: null,
        grant: hash(token),
        grantUntil: clock() + 900,
        verified: row.verified || clock(),
      });
      return { token };
    },
    async observe(link, token, dest) {
      const row = fromLink(link);
      active(row);
      grant(row, token);
      const wallet = address(dest);
      if (local) return { status: "rehearsal" };
      if (row.observed?.wallet === wallet) return row.observed;
      const observed = { wallet, status: await live.observeWallet(wallet) };
      store.patch(row.id, { observed });
      return observed;
    },
    async evidence(row, kind, hash) {
      requireThat(!local, "On-chain receipts are available on Diana.", 409);
      const fact = await live.evidence(row, kind, hash);
      const current = store.get(row.id);
      store.patch(row.id, { evidence: { ...current.evidence, [kind]: fact } });
      return fact;
    },
    async recipientEvidence(link, kind, hash) {
      requireThat(
        ["transfer", "collection"].includes(kind),
        "Unknown receipt type.",
      );
      return this.evidence(await sync(fromLink(link)), kind, hash);
    },
    async operatorEvidence(owner, id, kind, hash) {
      requireThat(
        ["refund", "funding"].includes(kind),
        "Unknown receipt type.",
      );
      return this.evidence(await sync(mine(owner, id)), kind, hash);
    },
    async sponsor(link, token, dest) {
      const row = await sync(fromLink(link));
      active(row);
      grant(row, token);
      requireThat(live?.sponsored, "Use the festival faucet.", 409);
      return live.sponsor(row.id, address(dest));
    },
    async attest(link, token, dest) {
      const row = await sync(fromLink(link));
      active(row);
      grant(row, token);
      const destination = address(dest);
      requireThat(
        !row.bound || row.bound === destination,
        "This invitation is already bound to another wallet.",
        409,
      );
      const deadline = Math.min(clock() + 300, row.expiry);
      const payload = message(chain, contract, row.id, destination, deadline);
      store.patch(row.id, { bound: destination });
      return { payload, signature: authority.sign(payload), deadline };
    },
    async settle(link, body) {
      const row = await sync(fromLink(link));
      if (!local) return view(row);
      active(row);
      grant(row, body.token);
      requireThat(
        Number.isSafeInteger(body.deadline) &&
          body.deadline <= row.expiry &&
          body.deadline > clock(),
        "Attestation expired.",
      );
      const payload = message(
        chain,
        contract,
        row.id,
        row.bound,
        body.deadline,
      );
      requireThat(
        authority.verify(payload, body.signature) &&
          verifyMessage(getBytes(payload), body.proof) === row.bound,
        "Wallet approval failed.",
      );
      return view(
        store.patch(row.id, {
          state: "collected",
          destination: row.bound,
          ended: clock(),
          grant: null,
        }),
      );
    },
    localBalance(wallet) {
      const dest = address(wallet);
      const amounts = store.db
        .prepare(
          "SELECT coalesce(sum(json_extract(data,'$.amount')),0) AS n FROM invites WHERE json_extract(data,'$.state')='collected' AND json_extract(data,'$.destination')=?",
        )
        .get(dest).n;
      const transferred = store.db
        .prepare(
          "SELECT coalesce(sum(CASE WHEN destination=? THEN amount ELSE 0 END),0)-coalesce(sum(CASE WHEN owner=? THEN amount ELSE 0 END),0) AS n FROM transfers",
        )
        .get(dest, dest).n;
      return amounts + transferred;
    },
    transfer(body) {
      requireThat(local, "Use your testnet wallet.", 409);
      const dest = address(body.to),
        from = address(body.from);
      requireThat(
        from !== dest &&
          Number.isSafeInteger(body.amount) &&
          body.amount > 0 &&
          body.amount <= this.localBalance(from),
        "Check the amount and destination.",
      );
      requireThat(
        Number.isSafeInteger(body.time) &&
          Math.abs(clock() - body.time) < 120 &&
          /^[a-f0-9]{32}$/.test(body.nonce),
        "Transfer request expired.",
      );
      requireThat(
        verifyMessage(
          [
            "Clainova rehearsal transfer",
            from,
            dest,
            body.amount,
            body.time,
            body.nonce,
          ].join("|"),
          body.proof,
        ) === from,
        "Wallet approval failed.",
      );
      requireThat(
        store.limit("transfer:" + from + body.nonce, 1, 300, clock()),
        "Transfer already used.",
        409,
      );
      store.db
        .prepare("INSERT INTO transfers VALUES(?,?,?,?)")
        .run(from, body.amount, dest, clock());
      return { balance: this.localBalance(from) };
    },
  };
}
