import chai from 'chai'
import { Contract, Wallet, BigNumber, providers } from 'ethers'
import { solidity, deployContract } from 'ethereum-waffle'

import { expandTo18Decimals } from './utils'

import FeswapTestERC20 from '../Feswap/ERC20.json'    // staking
import TestERC20 from '../../build/TestERC20.json'    // reward
import FeSwapPair from '../Feswap/FeSwapPair.json'    // Pair
import FeSwapFactory from '../Feswap/FeSwapFactory.json'
import FeSwapRouter from '../Feswap/FeSwapRouter.json'
import FeswaNFTCode from '../../build/FeswaNFT.json'
import FeswapByteCode from '../../build/Fesw.json'

import StakingTwinRewards from '../../build/StakingTwinRewards.json'
import StakingTwinRewardsFactory from '../../build/StakingTwinRewardsFactory.json'

const BidStartTime: number = 1615338000   // 2021/02/22 03/10 9:00
const rateTriggerArbitrage: number = 10

///////////////
//import UniswapV2ERC20 from '@uniswap/v2-core/build/ERC20.json'
//import TestERC20 from '../build/TestERC20.json'
//import StakingTwinRewards from '../build/StakingTwinRewards.json'
//import StakingTwinRewardsFactory from '../build/StakingTwinRewardsFactory.json'


chai.use(solidity)

const NUMBER_OF_STAKING_TOKENS = 4

interface StakingTwinRewardsFixture {
  stakingTwinRewards: Contract
  rewardsToken: Contract
  stakingTokenA: Contract
  stakingTokenB: Contract

}

export async function stakingTwinRewardsFixture([wallet]: Wallet[]): Promise<StakingTwinRewardsFixture> {
  const rewardsDistribution = wallet.address
  const rewardsToken = await deployContract(wallet, TestERC20, ['Test ERC20', 'TEST', 18, expandTo18Decimals(1000000)])
  const stakingToken0 = await deployContract(wallet, FeswapTestERC20, [expandTo18Decimals(1000000),'StakeTokenA'])
  const stakingToken1 = await deployContract(wallet, FeswapTestERC20, [expandTo18Decimals(1000000),'StakeTokenB'])
  const [stakingTokenA, stakingTokenB] =  (stakingToken0.address.toLowerCase() < stakingToken1.address.toLowerCase())
                                          ? [stakingToken0, stakingToken1] : [stakingToken1, stakingToken0]

  const stakingTwinRewards = await deployContract(wallet, StakingTwinRewards, [
    rewardsDistribution,
    rewardsToken.address,
    stakingTokenA.address,
    stakingTokenB.address,  
  ])

  return { stakingTwinRewards, rewardsToken, stakingTokenA, stakingTokenB }
}

interface StakingTwinRewardsFactoryFixture {
  rewardsToken: Contract
  stakingTokens: Contract[][]
  genesis: number
  rewardAmounts: BigNumber[]
  stakingTwinRewardsFactory: Contract
}

export async function stakingTwinRewardsFactoryFixture(
  [wallet, other0]: Wallet[],
  provider: providers.Web3Provider
): Promise<StakingTwinRewardsFactoryFixture> {
  let lastBlock = await provider.getBlock('latest')
  const rewardsToken = await deployContract(wallet, FeswapByteCode, [wallet.address, other0.address, lastBlock.timestamp + 60 * 60])

  const FeswaNFTAddress = Contract.getContractAddress({ from: wallet.address, nonce: 2 })
  const FeswaRouterAddress = Contract.getContractAddress({ from: wallet.address, nonce: 3 })
  const Factory = await deployContract(wallet, FeSwapFactory, [wallet.address, FeswaRouterAddress, FeswaNFTAddress])

  // deploy FeSwap NFT contract
  const FeswaNFT = await deployContract(wallet, FeswaNFTCode, [rewardsToken.address, Factory.address, BidStartTime])
  const Router = await deployContract(wallet, FeSwapRouter, [Factory.address, other0.address])   // other0 is fake WETH

  // deploy staking tokens
  const stakingTokens = []
  for (let i = 0; i < NUMBER_OF_STAKING_TOKENS; i++) {
    const swapToken0 = await deployContract(wallet, TestERC20, ['Test ERC20', 'TEST0', 18, expandTo18Decimals(1_000_000_000)])
    const swapToken1 = await deployContract(wallet, TestERC20, ['Test ERC20', 'TEST1', 18, expandTo18Decimals(1_000_000_000)])

    await Factory.createUpdatePair(swapToken0.address, swapToken1.address, wallet.address, rateTriggerArbitrage, 0)  
    const [stakingToken0, stakingToken1] = await Factory.getPair(swapToken0.address, swapToken1.address)

    const stakingTokenPair = stakingToken0.toLowerCase() < stakingToken1.toLowerCase()
      ? [stakingToken0, stakingToken1]
      : [stakingToken1, stakingToken0]
    stakingTokens.push(stakingTokenPair)
  }

  // deploy the staking rewards factory
  const { timestamp: now } = await provider.getBlock('latest')
  const genesis = now + 60 * 60
  const rewardAmounts: BigNumber[] = new Array(stakingTokens.length).fill(expandTo18Decimals(10))
  const stakingTwinRewardsFactory = await deployContract(wallet, StakingTwinRewardsFactory, [rewardsToken.address, genesis])

  return { rewardsToken, stakingTokens, genesis, rewardAmounts, stakingTwinRewardsFactory }
}
