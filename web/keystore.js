import { HDNodeWallet, Wallet } from "ethers";
// Encrypts a recovery phrase into a keystore, or opens one again.
export async function runKeystore({ phrase, json, password }, report) {
  if (phrase) return HDNodeWallet.fromPhrase(phrase).encrypt(password, report);
  const wallet = await Wallet.fromEncryptedJson(json, password, report);
  return wallet.mnemonic
    ? { phrase: wallet.mnemonic.phrase, path: wallet.path }
    : {};
}
// Uses a worker where one is available, and the page itself where it is not.
export function keystore(job, report) {
  return new Promise((resolve, reject) => {
    const direct = () => runKeystore(job, report).then(resolve, reject);
    let worker;
    try {
      worker = new Worker("/keystore-worker.js", { type: "module" });
    } catch {
      return direct();
    }
    let started = false;
    worker.onmessage = ({ data }) => {
      started = true;
      if ("done" in data) return report(data.done);
      worker.terminate();
      if (data.failed) reject(Error("The keystore could not be opened."));
      else resolve(data.result);
    };
    worker.onerror = () => {
      worker.terminate();
      if (started) reject(Error("The wallet stopped unexpectedly. Retry."));
      else direct();
    };
    worker.postMessage(job);
  });
}
