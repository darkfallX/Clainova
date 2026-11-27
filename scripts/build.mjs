import fs from "node:fs";
import { build } from "esbuild";
import { compile } from "./compile.mjs";
// dist/contract.json is v3, which the app and the deploy script use. Its ABI
// covers every v2 function the server reads, so v2 stays readable with it.
// dist/contract-v2.json keeps the deployed v2 build for checks of its history.
const built = compile(["contracts/ClainovaClaims.sol", "contracts/ClainovaClaimsV3.sol"]);
const artifact = (c) => JSON.stringify({ abi: c.abi, bytecode: "0x" + c.evm.bytecode.object });
fs.mkdirSync("dist", { recursive: true });
fs.writeFileSync("dist/contract.json", artifact(built.ClainovaClaimsV3));
fs.writeFileSync("dist/contract-v2.json", artifact(built.ClainovaClaims));
for (const file of ["index.html", "styles.css", "pocket-fold.webp"])
  fs.copyFileSync("web/" + file, "dist/" + file);
fs.copyFileSync(
  "node_modules/@fontsource-variable/outfit/files/outfit-latin-wght-normal.woff2",
  "dist/outfit.woff2",
);
for (const file of fs.readdirSync("dist"))
  if (/^(wallet|chunk|proof)-[A-Z0-9]{8}\.js$/.test(file)) fs.rmSync("dist/" + file);
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
