import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { smsChannel, SMS_GATE_CLOUD, TRACCAR_CLOUD } from "../server/sms.mjs";

const creds = { SMS_PROVIDER: "android", SMSGATE_USERNAME: "user", SMSGATE_PASSWORD: "pass-1234" };
function fakeGateway(reply = { status: 202, body: { id: "m1", state: "Pending" } }) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    return { status: reply.status, ok: reply.status < 300, json: async () => reply.body };
  };
  return { calls, fetchImpl };
}

test("android gateway posts the message to the cloud relay with basic auth", async () => {
  const g = fakeGateway();
  const sms = smsChannel(creds, ".", g.fetchImpl);
  const out = await sms.send("+2348012345678", "Clainova code: 123456");
  assert.deepEqual(out, { id: "m1", state: "Pending" });
  assert.equal(g.calls[0].url, SMS_GATE_CLOUD);
  assert.equal(g.calls[0].init.method, "POST");
  assert.equal(g.calls[0].init.headers.Authorization, "Basic " + Buffer.from("user:pass-1234").toString("base64"));
  assert.deepEqual(g.calls[0].body.phoneNumbers, ["+2348012345678"]);
  assert.equal(g.calls[0].body.textMessage.text, "Clainova code: 123456");
  assert.equal(g.calls[0].body.withDeliveryReport, true);
  assert.equal(g.calls[0].body.priority, 100);
  assert.equal(sms.channel, "sms from the organiser's phone");
});

test("android gateway refuses missing credentials", () => {
  assert.throws(() => smsChannel({ SMS_PROVIDER: "android" }, "."), /SMSGATE_USERNAME/);
  assert.throws(() => smsChannel({ ...creds, SMSGATE_PASSWORD: "" }, "."), /SMSGATE_PASSWORD/);
});

test("android gateway reports refused credentials and rejected messages", async () => {
  await assert.rejects(
    smsChannel(creds, ".", fakeGateway({ status: 401, body: {} }).fetchImpl).send("+2348012345678", "x"),
    /refused its credentials/,
  );
  await assert.rejects(
    smsChannel(creds, ".", fakeGateway({ status: 400, body: { message: "bad" } }).fetchImpl).send("+2348012345678", "x"),
    /did not accept/,
  );
  await assert.rejects(
    smsChannel(creds, ".", fakeGateway({ status: 202, body: {} }).fetchImpl).send("+2348012345678", "x"),
    /did not accept/,
  );
});

test("android gateway only sends to international numbers", async () => {
  const g = fakeGateway();
  const sms = smsChannel(creds, ".", g.fetchImpl);
  for (const bad of ["08012345678", "+234", "+2348012345678; rm", ""])
    await assert.rejects(sms.send(bad, "x"), /international/);
  assert.equal(g.calls.length, 0);
});

test("android gateway reads delivery status by message id", async () => {
  const g = fakeGateway({ status: 200, body: { id: "m1", state: "Delivered" } });
  const sms = smsChannel(creds, ".", g.fetchImpl);
  assert.equal((await sms.status("m1")).state, "Delivered");
  assert.equal(g.calls[0].url, SMS_GATE_CLOUD + "/m1");
  await assert.rejects(sms.status("../admin"), /Invalid message id/);
});

test("android gateway accepts a local phone address but not plain http elsewhere", () => {
  assert.ok(smsChannel({ ...creds, SMSGATE_URL: "http://192.168.1.20:8080/message" }, "."));
  assert.throws(() => smsChannel({ ...creds, SMSGATE_URL: "http://example.com/message" }, "."), /https or a local/);
});

test("outbox stays refused for the field cohort and writes privately otherwise", async () => {
  assert.throws(() => smsChannel({ SMS_PROVIDER: "outbox", COHORT: "field" }, "."), /field/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clainova-sms-"));
  await smsChannel({ SMS_PROVIDER: "outbox" }, dir).send("+2348012345678", "hello");
  const line = JSON.parse(fs.readFileSync(path.join(dir, "outbox.jsonl"), "utf8"));
  assert.equal(line.message, "hello");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("unknown providers are refused", () => {
  assert.throws(() => smsChannel({ SMS_PROVIDER: "carrier-pigeon" }, "."), /africastalking, android, traccar or outbox/);
});

const traccar = { SMS_PROVIDER: "traccar", TRACCAR_SMS_TOKEN: "fcm-token-123" };
test("traccar gateway posts to and message with the raw token", async () => {
  const g = fakeGateway({ status: 200, body: {} });
  const out = await smsChannel(traccar, ".", g.fetchImpl).send("+2348012345678", "Clainova code: 654321");
  assert.deepEqual(out, { id: null, state: "Accepted" });
  assert.equal(g.calls[0].url, TRACCAR_CLOUD);
  assert.equal(g.calls[0].init.headers.Authorization, "fcm-token-123");
  assert.deepEqual(g.calls[0].body, { to: "+2348012345678", message: "Clainova code: 654321" });
});

test("traccar gateway needs a token and refuses bad replies", async () => {
  assert.throws(() => smsChannel({ SMS_PROVIDER: "traccar" }, "."), /TRACCAR_SMS_TOKEN/);
  await assert.rejects(smsChannel(traccar, ".", fakeGateway({ status: 401, body: {} }).fetchImpl).send("+2348012345678", "x"), /refused its token/);
  await assert.rejects(smsChannel(traccar, ".", fakeGateway({ status: 500, body: {} }).fetchImpl).send("+2348012345678", "x"), /did not accept/);
  await assert.rejects(smsChannel(traccar, ".", fakeGateway().fetchImpl).send("0801", "x"), /international/);
});

test("a gateway that cannot be reached is retried once, then reported clearly", async () => {
  let tries = 0;
  const offline = async () => {
    tries++;
    throw Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } });
  };
  await assert.rejects(smsChannel(traccar, ".", offline).send("+2348012345678", "x"), (e) => e.status === 502 && /could not be reached/.test(e.message));
  assert.equal(tries, 2);
  let second = 0;
  const flaky = async () => {
    if (second++ === 0) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    return { status: 200, ok: true, json: async () => ({}) };
  };
  assert.deepEqual(await smsChannel(traccar, ".", flaky).send("+2348012345678", "x"), { id: null, state: "Accepted" });
});

test("a gateway that timed out after connecting is not retried, so nothing is sent twice", async () => {
  let tries = 0;
  const slow = async () => {
    tries++;
    throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
  };
  await assert.rejects(smsChannel(traccar, ".", slow).send("+2348012345678", "x"), /could not be reached/);
  assert.equal(tries, 1);
});

test("traccar gateway accepts the phone's local address", () => {
  assert.ok(smsChannel({ ...traccar, TRACCAR_SMS_URL: "http://192.168.0.5:8082" }, "."));
  assert.throws(() => smsChannel({ ...traccar, TRACCAR_SMS_URL: "http://evil.example/sms" }, "."), /https or a local/);
});
