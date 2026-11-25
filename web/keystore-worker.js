// Encrypting a backup is deliberately slow work. It runs here so the page can
// keep drawing. Nothing in this file touches the network or storage.
import { runKeystore } from "./keystore.js";
self.onmessage = async ({ data }) => {
  try {
    const result = await runKeystore(data, (done) =>
      self.postMessage({ done }),
    );
    self.postMessage({ result });
  } catch {
    self.postMessage({ failed: true });
  }
  self.close();
};
