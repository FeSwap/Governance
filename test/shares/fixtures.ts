import chai, { expect } from 'chai'
import { Contract, Wallet, providers } from 'ethers'
import { solidity, deployContract } from 'ethereum-waffle'

import FeswapByteCode from '../../build/Fesw.json'
import Timelock from '../../build/Timelock.json'
import FeswGovernor from '../../build/FeswGovernor.json'
import FeswaNFTCode from '../../build/FeswaNFT.json'
import TestERC20 from '../../build/TestERC20.json'  
import FeswSponsor from '../../build/FeswSponsor.json'  

import { expandTo18Decimals } from './utils'

import { DELAY } from './utils'   // 2 days

chai.use(solidity)

interface GovernanceFixture {
  Feswa: Contract
  timelock: Contract
  feswGovernor: Contract
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
  const feswGovernorAddress = Contract.getContractAddress({ from: wallet.address, nonce: 2 })
  const timelock = await deployContract(wallet, Timelock, [feswGovernorAddress, DELAY])
  expect(timelock.address).to.be.eq(timelockAddress)

  // deploy feswGovernor
  const feswGovernor = await deployContract(wallet, FeswGovernor, [timelock.address, Feswa.address])
  expect(feswGovernor.address).to.be.eq(feswGovernorAddress)

  return { Feswa, timelock, feswGovernor }
}


interface SponsorFixture {
  Feswa: Contract
  timelock: Contract
  feswGovernor: Contract
  sponsor: Contract
}

export async function sponsorFixture(
  [wallet]: Wallet[],
  provider: providers.Web3Provider
): Promise<SponsorFixture> {
  // deploy FeSwap, sending the total supply to the deployer
  const { timestamp: now } = await provider.getBlock('latest')
  const timelockAddress = Contract.getContractAddress({ from: wallet.address, nonce: 1 })
  const Feswa = await deployContract(wallet, FeswapByteCode, [wallet.address, timelockAddress, now + 60 * 60])

  // deploy timelock, controlled by what will be the governor
  const feswGovernorAddress = Contract.getContractAddress({ from: wallet.address, nonce: 2 })
  const timelock = await deployContract(wallet, Timelock, [feswGovernorAddress, DELAY])
  expect(timelock.address).to.be.eq(timelockAddress)

  // deploy feswGovernor
  const feswGovernor = await deployContract(wallet, FeswGovernor, [timelock.address, Feswa.address])
  expect(feswGovernor.address).to.be.eq(feswGovernorAddress)

  // deploy feswGovernor
  const lastBlock = await provider.getBlock('latest')
  const sponsor = await deployContract(wallet, FeswSponsor, [Feswa.address, wallet.address, timelock.address, lastBlock.timestamp + 60 *60])

  // total giveaway FESW
  await Feswa.transfer(sponsor.address, expandTo18Decimals(100_000_000))

  return { Feswa, timelock, feswGovernor, sponsor }
}

const initPoolPrice = expandTo18Decimals(1).div(5)
const BidStartTime: number = 1615338000   // 2021/02/22 03/10 9:00

interface FeswaNFTFixture {
  TokenA:   Contract
  TokenB:   Contract
  Feswa:    Contract
  FeswaNFT: Contract
}

export async function FeswaNFTFixture(
  [wallet, other0]: Wallet[],
  provider: providers.Web3Provider
): Promise<FeswaNFTFixture> {
  // deploy FeSwap, sending the total supply to the deployer
  const { timestamp: now } = await provider.getBlock('latest')
  const Feswa = await deployContract(wallet, FeswapByteCode, [wallet.address, other0.address, now + 60 * 60])

  // deploy FeSwap NFT contract
  const FeswaNFT = await deployContract(wallet, FeswaNFTCode, [Feswa.address, initPoolPrice, BidStartTime])

  const Token0 = await deployContract(wallet, TestERC20, ['Test ERC20 A', 'TKA', 18, expandTo18Decimals(1000_000)])
  const Token1 = await deployContract(wallet, TestERC20, ['Test ERC20 B', 'TKB', 18, expandTo18Decimals(1000_000)])

  await Feswa.transfer(FeswaNFT.address, expandTo18Decimals(1000_000))

  // Token A address is always less than Token B addess for testing 
  if(Token0.address.toLowerCase() <= Token1.address.toLowerCase() ) {
    return { TokenA: Token0, TokenB: Token1, Feswa, FeswaNFT }
  } else {
    return { TokenA: Token1, TokenB: Token0, Feswa, FeswaNFT }
  }
}
