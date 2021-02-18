import { providers, BigNumber, utils } from 'ethers'

export const DELAY = 60 * 60 * 24 * 2
export const GRACE_PERIOD = 60 * 60 * 24 * 14

export async function mineBlock(provider: providers.Web3Provider, timestamp: number): Promise<void> {
  return provider.send('evm_mine', [timestamp])
}

export async function freezeTime(provider: providers.Web3Provider, timestamp: number): Promise<void> {
  return provider.send('evm_setTime', [timestamp])
}

export function expandTo18Decimals(n: number): BigNumber {
  return BigNumber.from(n).mul(BigNumber.from(10).pow(18))
}

export function encodeParameters(types: Array<string>, values: Array<any>): string {
  const abi = new utils.AbiCoder();
  return abi.encode(types, values);
}

export async function advanceBlocks(provider: providers.Web3Provider, blocks:number): Promise<void> {
  let  currentBlock = await provider.getBlock('latest') ;
  provider.resetEventsBlock(blocks + currentBlock.number);
//  await provider.send('evm_mineStart', [blocks + currentBlock.number]);
}
