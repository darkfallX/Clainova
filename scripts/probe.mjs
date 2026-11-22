import { JsonRpcProvider, Contract, randomBytes, hexlify } from "ethers";
import { authority, TEST_RPC } from "../server/network.mjs";
import { FEST } from "../server/common.mjs";
const rpc = new JsonRpcProvider(TEST_RPC);
const network = await rpc.getNetwork(),
  block = await rpc.getBlockNumber();
const sig = authority(randomBytes(32)),
  payload = hexlify(randomBytes(32)),
  signed = sig.sign(payload);
const pq = new Contract(
  "0x0000000000000000000000000000000000000a01",
  ["function pqcVerify(bytes,bytes,bytes) view returns(bool)"],
  rpc,
);
const token = new Contract(
  FEST,
  ["function decimals() view returns(uint8)"],
  rpc,
);
const [valid, wrongMessage, precision] = await Promise.all([
  pq.pqcVerify(sig.publicKey, signed, payload),
  pq.pqcVerify(sig.publicKey, signed, randomBytes(32)),
  token.decimals(),
]);
if (network.chainId !== 9800n || precision !== 6n || !valid || wrongMessage)
  throw Error("Diana read checks failed.");
console.log(
  JSON.stringify(
    {
      chain: Number(network.chainId),
      observedBlock: block,
      fUSDDecimals: Number(precision),
      validSignature: valid,
      changedMessage: wrongMessage,
      operation: "eth_call only",
    },
    null,
    2,
  ),
);
await rpc.destroy();
