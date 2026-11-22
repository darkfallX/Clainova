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
for (const file of ["index.html", "styles.css"])
  fs.copyFileSync("web/" + file, "dist/" + file);
fs.copyFileSync(
  "node_modules/@fontsource-variable/outfit/files/outfit-latin-wght-normal.woff2",
  "dist/outfit.woff2",
);
await build({
  entryPoints: ["web/app.js"],
  outfile: "dist/app.js",
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  minify: true,
});
console.log("Built browser client and escrow bytecode.");
