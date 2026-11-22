import { DatabaseSync } from "node:sqlite";
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
export function openStore(path, key) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS invites(id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS request_key ON invites(owner,json_extract(data,'$.requestKey'));
    CREATE INDEX IF NOT EXISTS invites_owner ON invites(owner);
    CREATE TABLE IF NOT EXISTS limits(k TEXT PRIMARY KEY, hits INTEGER, until INTEGER);
    CREATE TABLE IF NOT EXISTS transfers(owner TEXT, amount INTEGER, destination TEXT, created INTEGER);
    CREATE TABLE IF NOT EXISTS sponsor(id TEXT PRIMARY KEY,wallet TEXT UNIQUE,raw TEXT NOT NULL,created INTEGER NOT NULL);`);
  function sign(value) {
    return createHmac("sha256", key).update(value).digest("hex");
  }
  function encrypt(text) {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", key, iv);
    const bytes = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), bytes]
      .map((b) => b.toString("base64"))
      .join(".");
  }
  function decrypt(text) {
    const [iv, tag, bytes] = text
      .split(".")
      .map((x) => Buffer.from(x, "base64"));
    const cipher = createDecipheriv("aes-256-gcm", key, iv);
    cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(bytes), cipher.final()]).toString();
  }
  const get = (id) => {
    const row = db.prepare("SELECT data FROM invites WHERE id=?").get(id);
    return row && JSON.parse(row.data);
  };
  const list = (owner) =>
    db
      .prepare("SELECT data FROM invites WHERE owner=? ORDER BY rowid DESC")
      .all(owner)
      .map((row) => JSON.parse(row.data));
  const save = (row) =>
    db
      .prepare(
        "INSERT INTO invites VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(row.id, row.owner, JSON.stringify(row));
  function patch(id, fields) {
    const row = { ...get(id), ...fields };
    save(row);
    return row;
  }
  function limit(k, max, seconds, time) {
    db.prepare("DELETE FROM limits WHERE until<=?").run(time);
    const v = db
      .prepare(
        "INSERT INTO limits VALUES(?,1,?) ON CONFLICT(k) DO UPDATE SET hits=hits+1 RETURNING hits",
      )
      .get(k, time + seconds);
    return v.hits <= max;
  }
  return { db, sign, encrypt, decrypt, get, list, save, patch, limit };
}
