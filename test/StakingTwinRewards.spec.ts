import chai, { expect } from 'chai'
import { Contract, BigNumber, constants } from 'ethers'
import { solidity, MockProvider, createFixtureLoader, deployContract } from 'ethereum-waffle'
import { ecsign } from 'ethereumjs-util'

import { stakingTwinRewardsFixture } from './shares/stakingTwinfixtures'
import { REWARDS_DURATION, expandTo18Decimals, mineBlock, getApprovalDigest } from './shares/utils'

import StakingTwinRewards from '../build/StakingTwinRewards.json'

chai.use(solidity)

describe('StakingTwinRewards', () => {
  const provider = new MockProvider({
    ganacheOptions: {
      hardfork: 'istanbul',
      mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
      gasLimit: 9999999,
    },
  })
  const [wallet, staker, secondStaker] = provider.getWallets()
  const loadFixture = createFixtureLoader([wallet], provider)

  let stakingRewards: Contract
  let rewardsToken: Contract
  let stakingTokenA: Contract
  let stakingTokenB: Contract
  beforeEach(async () => {
    const fixture = await loadFixture(stakingTwinRewardsFixture)
    stakingRewards = fixture.stakingTwinRewards
    rewardsToken = fixture.rewardsToken
    stakingTokenA = fixture.stakingTokenA
    stakingTokenB = fixture.stakingTokenB    
  })

  it('deploy cost', async () => {
    const stakingRewards = await deployContract(wallet, StakingTwinRewards, [
      wallet.address,
      rewardsToken.address,
      stakingTokenA.address,
      stakingTokenB.address,
    ])
    const receipt = await provider.getTransactionReceipt(stakingRewards.deployTransaction.hash)
    expect(receipt.gasUsed).to.eq('1648727')          // 1467786
  })

  it('rewardsDuration', async () => {
    const rewardsDuration = await stakingRewards.rewardsDuration()
    expect(rewardsDuration).to.be.eq(0)
  })

  const reward = expandTo18Decimals(100)
  async function start(reward: BigNumber): Promise<{ startTime: BigNumber; endTime: BigNumber }> {
    // send reward to the contract
    await rewardsToken.transfer(stakingRewards.address, reward)
    // must be called by rewardsDistribution
    await stakingRewards.notifyRewardAmount(reward,REWARDS_DURATION)

    const startTime: BigNumber = await stakingRewards.lastUpdateTime()
    const endTime: BigNumber = await stakingRewards.periodFinish()
    expect(endTime).to.be.eq(startTime.add(REWARDS_DURATION))
    return { startTime, endTime }
  }

  it('notifyRewardAmount: full', async () => {
    // stake with staker
    const stakeA = expandTo18Decimals(2)
    await stakingTokenA.transfer(staker.address, stakeA)
    await stakingTokenA.connect(staker).approve(stakingRewards.address, stakeA)
    const stakeB = expandTo18Decimals(2)
    await stakingTokenB.transfer(staker.address, stakeB)
    await stakingTokenB.connect(staker).approve(stakingRewards.address, stakeB)

    await stakingRewards.connect(staker).stake(stakeA, stakeB)
    const { endTime } = await start(reward)
    
    // fast-forward past the reward window
    await mineBlock(provider, endTime.add(1).toNumber())

    // unstake
    await stakingRewards.connect(staker).exit()
    const stakeEndTime: BigNumber = await stakingRewards.lastUpdateTime()
    expect(stakeEndTime).to.be.eq(endTime)

    const rewardAmount = await rewardsToken.balanceOf(staker.address)
    expect(reward.sub(rewardAmount).lte(reward.div(10000))).to.be.true // ensure result is within .01%
    expect(rewardAmount).to.be.eq(reward.div(REWARDS_DURATION).mul(REWARDS_DURATION))
  
  })


  it('withdraw', async () => {
    // stake with staker
    const stakeA = expandTo18Decimals(2)
    await stakingTokenA.transfer(staker.address, stakeA)
    await stakingTokenA.connect(staker).approve(stakingRewards.address, stakeA)

    const stakeB = expandTo18Decimals(2)
    await stakingTokenB.transfer(staker.address, stakeB)
    await stakingTokenB.connect(staker).approve(stakingRewards.address, stakeB)

    await stakingRewards.connect(staker).stake(stakeA, stakeB)
    const { endTime } = await start(reward)
    
    // fast-forward past the reward window
    await mineBlock(provider, endTime.add(1).toNumber())

    // with normal
    await stakingRewards.connect(staker).withdraw(stakeA.div(2), stakeB.div(2))

    // with underflow
    await expect(stakingRewards.connect(staker).withdraw(stakeA.div(2).add(stakeA.div(100)), 0))
            .to.be.revertedWith('SafeMath: subtraction overflow')

    // unstake
    await stakingRewards.connect(staker).exit()
    const stakeEndTime: BigNumber = await stakingRewards.lastUpdateTime()
    expect(stakeEndTime).to.be.eq(endTime)

    const rewardAmount = await rewardsToken.balanceOf(staker.address)
    expect(reward.sub(rewardAmount).lte(reward.div(10000))).to.be.true // ensure result is within .01%
    expect(rewardAmount).to.be.eq(reward.div(REWARDS_DURATION).mul(REWARDS_DURATION))
  
  })

  it('stakeWithPermit', async () => {
    // stake with staker
    const stakeA = expandTo18Decimals(2)
    await stakingTokenA.transfer(staker.address, stakeA)

    // get permit
    const nonce0 = await stakingTokenA.nonces(staker.address)
    const deadline0 = constants.MaxUint256
    const digest0 = await getApprovalDigest(
      stakingTokenA,
      { owner: staker.address, spender: stakingRewards.address, value: stakeA },
      nonce0,
      deadline0
    )
    const { v:v0, r:r0, s:s0 } = ecsign(Buffer.from(digest0.slice(2), 'hex'), Buffer.from(staker.privateKey.slice(2), 'hex'))


    const stakeB = expandTo18Decimals(2)
    await stakingTokenB.transfer(staker.address, stakeB)

    // get permit
    const nonce1 = await stakingTokenB.nonces(staker.address)
    const deadline1 = constants.MaxUint256
    const digest1 = await getApprovalDigest(
      stakingTokenB,
      { owner: staker.address, spender: stakingRewards.address, value: stakeB },
      nonce1,
      deadline1
    )
    const { v:v1, r:r1, s:s1} = ecsign(Buffer.from(digest1.slice(2), 'hex'), Buffer.from(staker.privateKey.slice(2), 'hex'))

    await stakingRewards.connect(staker).stakeWithPermit([stakeA, deadline0, v0, r0, s0], [stakeB, deadline1, v1, r1, s1])

    const { endTime } = await start(reward)

    // fast-forward past the reward window
    await mineBlock(provider, endTime.add(1).toNumber())

    // unstake
    await stakingRewards.connect(staker).exit()
    const stakeEndTime: BigNumber = await stakingRewards.lastUpdateTime()
    expect(stakeEndTime).to.be.eq(endTime)

    const rewardAmount = await rewardsToken.balanceOf(staker.address)
    expect(reward.sub(rewardAmount).lte(reward.div(10000))).to.be.true // ensure result is within .01%
    expect(rewardAmount).to.be.eq(reward.div(REWARDS_DURATION).mul(REWARDS_DURATION))
  })

  it('notifyRewardAmount: ~half', async () => {
    const { startTime, endTime } = await start(reward)

    // fast-forward ~halfway through the reward window
    await mineBlock(provider, startTime.add(endTime.sub(startTime).div(2)).toNumber())

    // stake with staker
    const stake = expandTo18Decimals(2)
    await stakingTokenA.transfer(staker.address, stake)
    await stakingTokenA.connect(staker).approve(stakingRewards.address, stake)
    await stakingRewards.connect(staker).stake(stake,0)
    const stakeStartTime: BigNumber = await stakingRewards.lastUpdateTime()

    // fast-forward past the reward window
    await mineBlock(provider, endTime.add(1).toNumber())

    // unstake
    await stakingRewards.connect(staker).exit()
    const stakeEndTime: BigNumber = await stakingRewards.lastUpdateTime()
    expect(stakeEndTime).to.be.eq(endTime)

    const rewardAmount = await rewardsToken.balanceOf(staker.address)
    expect(reward.div(2).sub(rewardAmount).lte(reward.div(2).div(10000))).to.be.true // ensure result is within .01%
    expect(rewardAmount).to.be.eq(reward.div(REWARDS_DURATION).mul(endTime.sub(stakeStartTime)))
  }).retries(2) // TODO investigate flakiness

  it('notifyRewardAmount: two stakers', async () => {
    // stake with first staker
    const stake = expandTo18Decimals(2)
    await stakingTokenA.transfer(staker.address, stake)
    await stakingTokenA.connect(staker).approve(stakingRewards.address, stake)
    await stakingRewards.connect(staker).stake(stake,0)

    const { startTime, endTime } = await start(reward)

    // fast-forward ~halfway through the reward window
    await mineBlock(provider, startTime.add(endTime.sub(startTime).div(2)).toNumber())

    // stake with second staker
    await stakingTokenB.transfer(secondStaker.address, stake)
    await stakingTokenB.connect(secondStaker).approve(stakingRewards.address, stake)
    await stakingRewards.connect(secondStaker).stake(0,stake)

    // fast-forward past the reward window
    await mineBlock(provider, endTime.add(1).toNumber())

    // unstake
    await stakingRewards.connect(staker).exit()
    const stakeEndTime: BigNumber = await stakingRewards.lastUpdateTime()
    expect(stakeEndTime).to.be.eq(endTime)
    await stakingRewards.connect(secondStaker).exit()

    const rewardAmount = await rewardsToken.balanceOf(staker.address)
    const secondRewardAmount = await rewardsToken.balanceOf(secondStaker.address)
    const totalReward = rewardAmount.add(secondRewardAmount)

    // ensure results are within .01%
    expect(reward.sub(totalReward).lte(reward.div(10000))).to.be.true
    expect(totalReward.mul(3).div(4).sub(rewardAmount).lte(totalReward.mul(3).div(4).div(10000)))
    expect(totalReward.div(4).sub(secondRewardAmount).lte(totalReward.div(4).div(10000)))
  })
})
