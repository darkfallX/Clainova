import fs from "node:fs";
import solc from "solc";
export function compile(files) {
  const sources = Object.fromEntries(
    files.map((name) => [name, { content: fs.readFileSync(name, "utf8") }]),
  );
  const input = {
    language: "Solidity",
    sources,
    settings: {
      evmVersion: "paris",
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"],
        },
      },
    },
  };
  const result = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors =
    result.errors?.filter((item) => item.severity === "error") || [];
  if (errors.length)
    throw new Error(errors.map((item) => item.formattedMessage).join("\n"));
  return Object.assign({}, ...Object.values(result.contracts));
}
