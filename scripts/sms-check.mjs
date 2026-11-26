// Sends one test SMS through the configured channel and follows its status.
//   node --env-file=.env scripts/sms-check.mjs +2348012345678
// With SMS_PROVIDER=android it waits for the phone to report Sent, then Delivered.
// The number is only taken from the command line and is printed masked.
import { smsChannel } from "../server/sms.mjs";

const to = process.argv[2] || "";
if (!/^\+\d{8,15}$/.test(to)) {
  console.error("Usage: node --env-file=.env scripts/sms-check.mjs +2348012345678");
  process.exit(1);
}
const masked = "•••• " + to.slice(-4);
const channel = smsChannel(process.env, ".data");
const started = Date.now();
const seconds = () => ((Date.now() - started) / 1000).toFixed(1) + "s";
const sent = await channel.send(
  to,
  "Clainova delivery check " + new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC. No action needed.",
);
console.log(seconds(), "accepted by", channel.channel, "for", masked, sent?.id ? "id " + sent.id : "");
if (!channel.status || !sent?.id) {
  console.log("This channel reports no delivery status. Look at the phone to confirm the message arrived.");
  process.exit(0);
}

let last = "";
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const s = await channel.status(sent.id).catch((e) => ({ state: "unknown (" + e.message + ")" }));
  if (s.state !== last) {
    last = s.state;
    const reason = s.recipients?.find((r) => r.error)?.error;
    console.log(seconds(), "state", s.state, reason ? "· " + reason : "");
  }
  if (["Delivered", "Failed"].includes(s.state)) break;
}
console.log(last === "Delivered" ? "DELIVERED to a real handset." : "Final state: " + last);
process.exitCode = last === "Delivered" ? 0 : 2;
