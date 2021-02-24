import chai, { expect } from 'chai'
import { Contract, Wallet, providers } from 'ethers'
import { solidity, deployContract } from 'ethereum-waffle'

import FeswapByteCode from '../../build/Fesw.json'
import Timelock from '../../build/Timelock.json'
import GovernorAlpha from '../../build/GovernorAlpha.json'
import FeswaBidCode from '../../build/FeswaBid.json'
import TestERC20 from '../../build/TestERC20.json'    

import { expandTo18Decimals } from './utils'

import { DELAY } from './utils'   // 2 days

chai.use(solidity)

interface GovernanceFixture {
  Feswa: Contract
  timelock: Contract
  governorAlpha: Contract
}

export async function governanceFixture(
  [wallet]: Wallet[],
  provider: providers.Web3Provider
): Promise<GovernanceFixture> {
  // deploy FeSwap, sending the total supply to the deployer
  const { timestamp: now } = await provider.getBlock('latest')
  const timelockAddress = Contract.getContractAddress({ from: wallet.address, nonce: 1 })
  const Feswa = await deployContract(wallet, FeswapByteCode, [wallet.address, timelockAddress, now + 60 * 60])

  // deploy timelock, controlled by what will be the governor
  const governorAlphaAddress = Contract.getContractAddress({ from: wallet.address, nonce: 2 })
  const timelock = await deployContract(wallet, Timelock, [governorAlphaAddress, DELAY])
  expect(timelock.address).to.be.eq(timelockAddress)

  // deploy governorAlpha
  const governorAlpha = await deployContract(wallet, GovernorAlpha, [timelock.address, Feswa.address])
  expect(governorAlpha.address).to.be.eq(governorAlphaAddress)

  return { Feswa, timelock, governorAlpha }
}

const initPoolPrice = expandTo18Decimals(1).div(2)
const BidStartTime: number = 1615338000   // 2021/02/22 03/10 9:00

interface FeswaBidFixture {
  TokenA:   Contract
  TokenB:   Contract
  FeswaBid: Contract
}

export async function feswaBidFixture(
  [wallet]: Wallet[],
  provider: providers.Web3Provider
): Promise<FeswaBidFixture> {
  // deploy FeSwap NFT contract
  // deploy governorAlpha
  const { timestamp: now } = await provider.getBlock('latest')
  const FeswaBid = await deployContract(wallet, FeswaBidCode, [initPoolPrice, BidStartTime, "Feswap Pair Bid NFT", "FESN"])

  const Token0 = await deployContract(wallet, TestERC20, ['Test ERC20 A', 'TKA', expandTo18Decimals(1000_000)])
  const Token1 = await deployContract(wallet, TestERC20, ['Test ERC20 B', 'TKB', expandTo18Decimals(1000_000)])

  // Token A address is always less than Token B addess for testing 
  if(Token0.address.toLowerCase() <= Token1.address.toLowerCase() ) {
    return { TokenA: Token0, TokenB: Token1, FeswaBid }
  } else {
    return { TokenA: Token1, TokenB: Token0, FeswaBid }
  }
}
