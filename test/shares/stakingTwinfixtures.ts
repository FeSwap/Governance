import chai from 'chai'
import { Contract, Wallet, BigNumber, providers } from 'ethers'
import { solidity, deployContract } from 'ethereum-waffle'

import { expandTo18Decimals } from './utils'

import FeswapTestERC20 from '../Feswap/ERC20.json'    // staking
import TestERC20 from '../../build/TestERC20.json'    // reward
import FeswapPair from '../Feswap/FeSwapPair.json'    // Pair

import StakingTwinRewards from '../../build/StakingTwinRewards.json'
import StakingTwinRewardsFactory from '../../build/StakingTwinRewardsFactory.json'


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
  [wallet]: Wallet[],
  provider: providers.Web3Provider
): Promise<StakingTwinRewardsFactoryFixture> {
  const rewardsToken = await deployContract(wallet, TestERC20, ['Test ERC20', 'TEST', 18, expandTo18Decimals(1_000_000_000)])

  // deploy staking tokens
  const stakingTokens = []
  for (let i = 0; i < NUMBER_OF_STAKING_TOKENS; i++) {
    const swapToken0 = await deployContract(wallet, TestERC20, ['Test ERC20', 'TEST0', 18, expandTo18Decimals(1_000_000_000)])
    const swapToken1 = await deployContract(wallet, TestERC20, ['Test ERC20', 'TEST1', 18, expandTo18Decimals(1_000_000_000)])
    const stakingToken0 = await deployContract(wallet, FeswapPair)
    const stakingToken1 = await deployContract(wallet, FeswapPair)
    await stakingToken0.initialize(swapToken0.address, swapToken1.address, wallet.address, rewardsToken.address, 10100)
    await stakingToken1.initialize(swapToken1.address, swapToken0.address, wallet.address, rewardsToken.address, 10100)

    const stakingTokenPair =stakingToken0.address.toLowerCase() < stakingToken1.address.toLowerCase()
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
