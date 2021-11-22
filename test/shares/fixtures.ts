import chai, { expect } from 'chai'
import { Contract, Wallet, providers } from 'ethers'
import { solidity, deployContract } from 'ethereum-waffle'

import FeswapByteCode from '../../build/Fesw.json'
import Timelock from '../../build/Timelock.json'
import FeswGovernor from '../../build/FeswGovernor.json'
import FeswaNFTCode from '../../build/FeswaNFT.json'
import FeswaNFTBasic from '../../build/FeswaNFTBasic.json'
import FeswaNFTPatch from '../../build/FeswaNFTPatch.json'
import TestERC20 from '../../build/TestERC20.json'  
import FeswSponsor from '../../build/FeswSponsor.json'  
import FeSwapFactory from '../Feswap/FeSwapFactory.json'
import FeSwapRouter from '../Feswap/FeSwapRouter.json'
import MetamorphicContractFactory from '../../build/MetamorphicContractFactory.json'

import { expandTo18Decimals } from './utils'

import { DELAY } from './utils'   // 2 days

chai.use(solidity)

const overrides = {
  gasLimit: 9999999
}

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
  const Feswa = await deployContract(wallet, FeswapByteCode, [wallet.address, timelockAddress, now + 60 * 60, 'FESW-B'])

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
  const Feswa = await deployContract(wallet, FeswapByteCode, [wallet.address, timelockAddress, now + 60 * 60, 'FESW-B'])

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
  Factory:  Contract
  FeswaNFT: Contract
  Router:   Contract
}

interface FeswaNFTFixturePatch extends FeswaNFTFixture{
  MetamorphicFactory:   Contract
}

export async function FeswaNFTFixture(
  [wallet, other0]: Wallet[],
  provider: providers.Web3Provider
): Promise<FeswaNFTFixture> {
  // deploy FeSwap, sending the total supply to the deployer
  const { timestamp: now } = await provider.getBlock('latest')
  const Feswa = await deployContract(wallet, FeswapByteCode, [wallet.address, other0.address, now + 60 * 60, 'FESW-B'])

  const FeswaNFTAddress = Contract.getContractAddress({ from: wallet.address, nonce: 2 })
  const FeswaRouterAddress = Contract.getContractAddress({ from: wallet.address, nonce: 3 })
  const Factory = await deployContract(wallet, FeSwapFactory, [wallet.address, FeswaRouterAddress, FeswaNFTAddress])

  // deploy FeSwap NFT contract
  const FeswaNFT = await deployContract(wallet, FeswaNFTCode, [Feswa.address, Factory.address, BidStartTime])
  const Router = await deployContract(wallet, FeSwapRouter, [Factory.address, other0.address])   // other0 is fake WETH

  const Token0 = await deployContract(wallet, TestERC20, ['Test ERC20 A', 'TKA', 18, expandTo18Decimals(1000_000)])
  const Token1 = await deployContract(wallet, TestERC20, ['Test ERC20 B', 'TKB', 18, expandTo18Decimals(1000_000)])

  await Factory.setRouterFeSwap(other0.address)

  await Feswa.transfer(FeswaNFT.address, expandTo18Decimals(1000_000))

  // Token A address is always less than Token B addess for testing 
  if(Token0.address.toLowerCase() <= Token1.address.toLowerCase() ) {
    return { TokenA: Token0, TokenB: Token1, Feswa, Factory, FeswaNFT, Router }
  } else {
    return { TokenA: Token1, TokenB: Token0, Feswa, Factory, FeswaNFT, Router }
  }
}

export async function FeswaNFTFixturePatch(
  [wallet, other0]: Wallet[],
  provider: providers.Web3Provider
): Promise<FeswaNFTFixturePatch> {
  // deploy FeSwap, sending the total supply to the deployer
  const { timestamp: now } = await provider.getBlock('latest')
  const Feswa = await deployContract(wallet, FeswapByteCode, [wallet.address, other0.address, now + 60 * 60, 'FESW-B'])

  const FeswaNFTAddress = Contract.getContractAddress({ from: wallet.address, nonce: 2 })
  const FeswaRouterAddress = Contract.getContractAddress({ from: wallet.address, nonce: 3 })
  const Factory = await deployContract(wallet, FeSwapFactory, [wallet.address, FeswaRouterAddress, FeswaNFTAddress])

  // deploy FeSwap NFT contract
  const FeswaNFT = await deployContract(wallet, FeswaNFTBasic, [Feswa.address, Factory.address, BidStartTime])

  const Router = await deployContract(wallet, FeSwapRouter, [Factory.address, other0.address])   // other0 is fake WETH
  const Token0 = await deployContract(wallet, TestERC20, ['Test ERC20 A', 'TKA', 18, expandTo18Decimals(1000_000)])
  const Token1 = await deployContract(wallet, TestERC20, ['Test ERC20 B', 'TKB', 18, expandTo18Decimals(1000_000)])

  await Factory.setRouterFeSwap(other0.address)
  await Feswa.transfer(FeswaNFT.address, expandTo18Decimals(1000_000))

  // deploy FeSwap MetamorphicContractFactory
  const MetamorphicFactory = await deployContract(wallet, MetamorphicContractFactory)

  // deploy FeSwap NFT Patch implementation 
  const NFTPatchImplementation = await deployContract(wallet, FeswaNFTPatch, [Feswa.address, Factory.address, BidStartTime])

  const salt = "0x291AD4D300CBA1259F2807167DE059F45F0EA7EDC76A99BE5290E88E498EC62B"
  await MetamorphicFactory.deployMetamorphicContract(salt, NFTPatchImplementation.address, "0x", { ...overrides, value: 0 })

//  console.log("Factory", Factory.address)
  // Token A address is always less than Token B addess for testing 
  if(Token0.address.toLowerCase() <= Token1.address.toLowerCase() ) {
    return { TokenA: Token0, TokenB: Token1, Feswa, Factory, FeswaNFT, Router, MetamorphicFactory }
  } else {
    return { TokenA: Token1, TokenB: Token0, Feswa, Factory, FeswaNFT, Router, MetamorphicFactory }
  }
}

