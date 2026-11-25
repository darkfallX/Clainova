import fs from "node:fs";
import { build } from "esbuild";
import { compile } from "./compile.mjs";
const escrow = compile(["contracts/ClainovaClaims.sol"]).ClainovaClaims;
fs.mkdirSync("dist", { recursive: true });
fs.writeFileSync(
  "dist/contract.json",
  JSON.stringify({
    abi: escrow.abi,
    bytecode: "0x" + escrow.evm.bytecode.object,
  }),
);
for (const file of ["index.html", "styles.css", "pocket-fold.webp"])
  fs.copyFileSync("web/" + file, "dist/" + file);
fs.copyFileSync(
  "node_modules/@fontsource-variable/outfit/files/outfit-latin-wght-normal.woff2",
  "dist/outfit.woff2",
);
for (const file of fs.readdirSync("dist"))
  if (/^(wallet|chunk)-[A-Z0-9]{8}\.js$/.test(file)) fs.rmSync("dist/" + file);
await build({
  entryPoints: ["web/app.js", "web/keystore-worker.js"],
  outdir: "dist",
  splitting: true,
  chunkNames: "[name]-[hash]",
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  minify: true,
});
console.log("Built browser client and escrow bytecode.");
