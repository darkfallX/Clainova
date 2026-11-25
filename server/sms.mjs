import fs from "node:fs";
import path from "node:path";
import africastalking from "africastalking";
import { requireThat } from "./common.mjs";

// Delivery channel for invitations and codes. "africastalking" sends SMS (its
// "sandbox" username only reaches a simulator). "outbox" appends messages to a
// private file on the server for team runs. It never reaches a phone, so it is
// refused for the field cohort.
export function smsChannel(env, folder) {
  const provider = env.SMS_PROVIDER || "africastalking";
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
    throw Error("SMS_PROVIDER must be africastalking or outbox.");
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
