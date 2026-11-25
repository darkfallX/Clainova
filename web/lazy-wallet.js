// Key generation, signatures and chain access are most of the bundle. This
// stands in for the wallet until that code has loaded, so a page appears first.
export function lazyWallet(cfg, api, progress) {
  let real, job;
  function load() {
    job ||= import("./wallet.js").then(
      (module) => (real = module.walletTools(cfg, api, progress)),
      () => {
        job = null;
        throw Error("The wallet could not load. Check your connection and retry.");
      },
    );
    return job;
  }
  return new Proxy(
    {},
    {
      get(_, key) {
        if (key === "preload") return () => load().catch(() => {});
        if (real) return real[key];
        if (key === "current") return undefined;
        if (key === "external") return false;
        if (key === "saved")
          return !!localStorage.getItem("clainova.keystore." + cfg.mode);
        return async (...args) => (await load())[key](...args);
      },
    },
  );
}
