import fs from "node:fs";
import path from "node:path";
import africastalking from "africastalking";
import { requireThat } from "./common.mjs";

// Delivery channel for invitations and codes. "africastalking" sends SMS (its
// "sandbox" username only reaches a simulator). "android" sends a real SMS from
// the organiser's own Android phone through the free, open-source SMS Gateway
// app (sms-gate.app), so it costs only the SIM's normal SMS rate. "outbox"
// appends messages to a private file on the server for team runs. It never
// reaches a phone, so it is refused for the field cohort.
export const SMS_GATE_CLOUD = "https://api.sms-gate.app/3rdparty/v1/messages";
export function smsChannel(env, folder, fetchImpl = fetch) {
  const provider = env.SMS_PROVIDER || "africastalking";
  if (provider === "android") return androidGateway(env, fetchImpl);
  if (provider === "traccar") return traccarGateway(env, fetchImpl);
  if (provider === "outbox") {
    if (env.COHORT === "field")
      throw Error("SMS_PROVIDER=outbox cannot be used with COHORT=field.");
    const file = path.join(folder, "outbox.jsonl");
    return {
      channel: "outbox",
      accepted: "written to the test outbox",
      send: async (to, message) =>
        fs.appendFileSync(
          file,
          JSON.stringify({ at: new Date().toISOString(), to, message }) + "\n",
          { mode: 0o600 },
        ),
    };
  }
  if (provider !== "africastalking")
    throw Error("SMS_PROVIDER must be africastalking, android, traccar or outbox.");
  if (!env.AT_USERNAME || !env.AT_API_KEY)
    throw Error("Set AT_USERNAME and AT_API_KEY, or SMS_PROVIDER=outbox.");
  const sms = africastalking({
    apiKey: env.AT_API_KEY,
    username: env.AT_USERNAME,
  }).SMS;
  const sandbox = env.AT_USERNAME === "sandbox";
  return {
    channel: sandbox ? "sms sandbox" : "sms",
    accepted: sandbox
      ? "accepted by the SMS sandbox"
      : "accepted by SMS provider",
    send: async (to, message) => {
      const result = await sms.send({
        to: [to],
        message,
        ...(env.AT_FROM ? { from: env.AT_FROM } : {}),
      });
      requireThat(
        result.SMSMessageData?.Recipients?.some(
          (r) => r.status === "Success" && r.number === to,
        ),
        "SMS provider did not accept the message.",
        502,
      );
    },
  };
}

// Traccar SMS Gateway (Google Play: org.traccar.gateway, GPL-3.0): the app shows a
// cloud token that reaches the phone through traccar.org, or a local address and
// key for the same Wi-Fi. It takes {"to","message"} with the token or key as the
// raw Authorization header and reports no delivery status.
export const TRACCAR_CLOUD = "https://www.traccar.org/sms/";

// Reaches a gateway, retrying once only when no connection was made, so a
// message is never sent twice. Any failure becomes a clear 502 for the caller.
const NOT_CONNECTED = new Set(["UND_ERR_CONNECT_TIMEOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"]);
async function reach(fetchImpl, url, init) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(15000) });
    } catch (err) {
      const code = err?.cause?.code || err?.code;
      if (attempt < 2 && NOT_CONNECTED.has(code)) continue;
      throw Object.assign(new Error("The SMS gateway could not be reached. Try again."), { status: 502 });
    }
  }
}
function traccarGateway(env, fetchImpl) {
  if (!env.TRACCAR_SMS_TOKEN)
    throw Error("Set TRACCAR_SMS_TOKEN to the cloud token or local key shown in Traccar SMS Gateway.");
  const endpoint = env.TRACCAR_SMS_URL || TRACCAR_CLOUD;
  requireThat(/^https:\/\/|^http:\/\/(10|172|192\.168)\./.test(endpoint), "TRACCAR_SMS_URL must be https or a local network address.");
  return {
    channel: "sms from the organiser's phone",
    accepted: "sent from the organiser's phone",
    async send(to, message) {
      requireThat(/^\+\d{8,15}$/.test(to), "Use an international number.");
      const res = await reach(fetchImpl, endpoint, {
        method: "POST",
        headers: { Authorization: env.TRACCAR_SMS_TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify({ to, message }),
      });
      requireThat(res.status !== 401, "The SMS gateway refused its token.", 502);
      requireThat(res.ok, "The SMS gateway did not accept the message.", 502);
      return { id: null, state: "Accepted" };
    },
  };
}

// SMS Gateway for Android: the app signs up to its free cloud relay (or runs a
// local server on the phone) and shows a username and password. SMSGATE_URL
// defaults to the cloud endpoint; a local phone uses http://<phone-ip>:8080/message.
function androidGateway(env, fetchImpl) {
  if (!env.SMSGATE_USERNAME || !env.SMSGATE_PASSWORD)
    throw Error("Set SMSGATE_USERNAME and SMSGATE_PASSWORD from the SMS Gateway app.");
  const endpoint = env.SMSGATE_URL || SMS_GATE_CLOUD;
  requireThat(/^https:\/\/|^http:\/\/(10|172|192\.168)\./.test(endpoint), "SMSGATE_URL must be https or a local network address.");
  const auth =
    "Basic " + Buffer.from(env.SMSGATE_USERNAME + ":" + env.SMSGATE_PASSWORD).toString("base64");
  const call = (url, init = {}) =>
    reach(fetchImpl, url, {
      ...init,
      headers: { Authorization: auth, "Content-Type": "application/json" },
    });
  return {
    channel: "sms from the organiser's phone",
    accepted: "sent from the organiser's phone",
    async send(to, message) {
      requireThat(/^\+\d{8,15}$/.test(to), "Use an international number.");
      const res = await call(endpoint, {
        method: "POST",
        body: JSON.stringify({
          textMessage: { text: message },
          phoneNumbers: [to],
          withDeliveryReport: true,
          // Codes are time-sensitive: skip the app's rate limits and quiet hours.
          priority: 100,
          ttl: 900,
        }),
      });
      requireThat(res.status !== 401, "The SMS gateway refused its credentials.", 502);
      const body = await res.json().catch(() => ({}));
      requireThat(res.ok && body.id, "The SMS gateway did not accept the message.", 502);
      return { id: body.id, state: body.state };
    },
    // Pending, Processed, Sent, Delivered or Failed, as reported by the phone.
    async status(id) {
      requireThat(/^[\w-]{1,64}$/.test(String(id)), "Invalid message id.");
      const res = await call(endpoint.replace(/\/$/, "") + "/" + id);
      requireThat(res.ok, "The SMS gateway did not return a status.", 502);
      return res.json();
    },
  };
}
