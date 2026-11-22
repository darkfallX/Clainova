import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright";
import { Wallet } from "ethers";
import axe from "axe-core";
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "clainova-e2e-"));
const origin = "http://127.0.0.1:4283",
  record = process.env.RECORD_DEMO === "1";
const server = spawn(process.execPath, ["server/start.mjs"], {
  env: { ...process.env, PORT: "4283", MODE: "rehearsal", DATA_DIR: folder },
  stdio: ["ignore", "pipe", "inherit"],
  windowsHide: true,
});
let browser;
try {
  await Promise.race([
    once(server.stdout, "data"),
    once(server, "exit").then(() => {
      throw Error("Test service failed to start.");
    }),
  ]);
  const installed =
    process.env.BROWSER_PATH ||
    [
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    ].find(fs.existsSync);
  browser = await chromium.launch({
    executablePath: installed,
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
    ...(record
      ? { recordVideo: { dir: folder, size: { width: 1440, height: 900 } } }
      : {}),
  });
  if (record) {
    await context.request.get(origin + "/api/config");
    const fixture = await context.request.post(origin + "/api/payments", {
      headers: { Origin: origin },
      data: {
        phone: "+2348012345678",
        amount: "4",
        seconds: 60,
        note: "Expiry rehearsal",
        requestKey: randomUUID(),
      },
    });
    assert.equal(fixture.status(), 200);
    const { expiry } = await fixture.json();
    console.log(
      "Preparing the recording with a genuine one-minute rehearsal expiry.",
    );
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, expiry * 1000 - Date.now()) + 100),
    );
  }
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(12000);
  async function accessibility(target) {
    await target.evaluate(axe.source);
    const violations = await target.evaluate(async () =>
      (
        await window.axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
        })
      ).violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    );
    assert.deepEqual(violations, []);
  }
  const hold = async () => {
    if (record) await page.waitForTimeout(1500);
  };
  async function issue(note, quick = false) {
    await page.goto(origin);
    await page.getByLabel("Recipient phone number").fill("801 234 5678");
    await page.getByLabel("Payment note").fill(note);
    if (quick) await page.getByLabel("Collection period").selectOption("60");
    await hold();
    await page.getByRole("button", { name: "Review payment" }).click();
    await hold();
    await page.getByRole("button", { name: "Issue payment" }).click();
    await page.getByRole("heading", { name: "Payment issued." }).waitFor();
    await hold();
    return page
      .getByRole("link", { name: "Open recipient inbox" })
      .getAttribute("href");
  }
  await page.goto(origin);
  await page.getByLabel("Recipient phone number").waitFor();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "overflow at " + width,
    );
    await page.getByRole("button", { name: "Review payment" }).focus();
    assert.equal(
      await page.evaluate(() => document.activeElement.tagName),
      "BUTTON",
    );
  }
  await accessibility(page);
  await page.locator("#phone").focus();
  await page.locator("#phone").blur();
  // A 16:9 image of the actual working counter.
  if (record) {
    fs.mkdirSync("submission", { recursive: true });
    await page.setViewportSize({ width: 1440, height: 810 });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: "submission/cover.png" });
  }
  const link = await issue("Workshop speaker fee");
  await page.goto(origin + link);
  await page.getByRole("button", { name: "Get verification code" }).click();
  const code = await page.locator("#demoPin").textContent();
  await page
    .getByLabel("Verification code", { exact: true })
    .fill(code === "111111" ? "222222" : "111111");
  await page.getByRole("button", { name: "Verify code", exact: true }).click();
  await page.getByText("That code is incorrect.").first().waitFor();
  await page.getByLabel("Verification code", { exact: true }).fill(code);
  await hold();
  await page.getByRole("button", { name: "Verify code", exact: true }).click();
  await page.reload();
  await page.getByLabel("Wallet passphrase").waitFor();
  const password = randomBytes(16).toString("hex");
  await page.getByLabel("Wallet passphrase").fill(password);
  await page.getByRole("button", { name: "Create my wallet" }).click();
  await page.getByRole("button", { name: "Save encrypted backup" }).waitFor();
  const backup = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save encrypted backup" }).click();
  const downloaded = await backup;
  assert.match(downloaded.suggestedFilename(), /wallet\.json$/);
  const backupPath = path.join(folder, "recipient-backup.json");
  await downloaded.saveAs(backupPath);
  await hold();
  await page.getByRole("button", { name: "Collect 20 test fUSD" }).click();
  await hold();
  await page.getByRole("button", { name: "Approve and collect" }).click();
  await page.getByRole("heading", { name: "Payment collected." }).waitFor();
  await hold();
  const destination = Wallet.createRandom().address;
  await page.getByLabel("Destination wallet").fill(destination);
  await page.getByRole("button", { name: "Review transfer" }).click();
  await hold();
  await page
    .getByRole("button", { name: "Send transfer", exact: true })
    .click();
  await page.getByText("Available · 19 test fUSD").waitFor();
  await hold();
  await page.goto(origin + "/ledger");
  await page.getByRole("heading", { name: "Payment ledger." }).waitFor();
  if (!record) {
    const refundLink = await issue("Expiry rehearsal", true);
    // Move only the isolated rehearsal fixture to the expiry boundary.
    const db = new DatabaseSync(
      path.join(folder, "rehearsal", "payments.sqlite"),
    );
    db.prepare(
      "UPDATE invites SET data=json_set(data,'$.expiry',?) WHERE id=?",
    ).run(
      Math.floor(Date.now() / 1000) - 1,
      "0x" + refundLink.split("/").pop().split(".")[0],
    );
    db.close();
  }
  await page.goto(origin + "/ledger");
  await page
    .getByRole("article")
    .filter({ hasText: "Expiry rehearsal" })
    .getByRole("button")
    .click();
  await page.getByRole("button", { name: "Refund sender" }).click();
  await page.getByText("Refunded", { exact: true }).waitFor();
  await hold();
  const second = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const mobile = await second.newPage();
  await mobile.goto(origin + "/ledger");
  await mobile.getByText("No payments yet.", { exact: false }).waitFor();
  await mobile.goto(origin + link);
  await mobile.getByRole("heading", { name: "Payment collected." }).waitFor();
  assert.ok(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await accessibility(mobile);
  await mobile.getByText("More wallet options").click();
  await mobile.locator("#restore").setInputFiles(backupPath);
  await mobile.getByLabel("Wallet passphrase").fill(password);
  await mobile.getByRole("button", { name: "Restore wallet" }).click();
  await mobile.getByText("Available · 19 test fUSD").waitFor();
  await second.close();
  assert.deepEqual(errors, []);
  const video = page.video();
  await context.close();
  if (record) {
    const src = await video.path();
    execFileSync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        src,
        "-vf",
        "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2",
        "-c:v",
        "libx264",
        "-crf",
        "24",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "submission/rehearsal.mp4",
      ],
      { windowsHide: true },
    );
  }
  console.log(
    "Browser passed: 3 viewport sizes, keyboard focus, review, wrong code, reload, wallet backup, collection, follow-on payment, refund, isolated sessions and no unhandled browser errors.",
  );
} finally {
  await browser?.close();
  server.kill();
  if (server.exitCode === null && server.signalCode === null)
    await once(server, "exit");
  if (
    path.dirname(folder) === os.tmpdir() &&
    path.basename(folder).startsWith("clainova-e2e-")
  )
    fs.rmSync(folder, { recursive: true, force: true });
}
