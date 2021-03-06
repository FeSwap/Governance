import chai, { expect } from 'chai'
import { Contract, BigNumber } from 'ethers'
import { solidity, MockProvider, createFixtureLoader, deployContract } from 'ethereum-waffle'

import TreasuryVester from '../../build/FeswVester.json'

import { governanceFixture } from '../shares/fixtures'
import { mineBlock, expandTo18Decimals } from '../shares/utils'

chai.use(solidity)

describe('scenario:TreasuryVester', () => {
  const provider = new MockProvider({
    ganacheOptions: {
      hardfork: 'istanbul',
      mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
      gasLimit: 9999999,
    },
  })
  const [wallet] = provider.getWallets()
  const loadFixture = createFixtureLoader([wallet], provider)

  let Feswa: Contract
  let timelock: Contract
  beforeEach(async () => {
    const fixture = await loadFixture(governanceFixture)
    Feswa = fixture.Feswa
    timelock = fixture.timelock
  })

  let treasuryVester: Contract
  let vestingAmount: BigNumber
  let vestingBegin: number
  let vestingCliff: number
  let vestingEnd: number
  beforeEach('deploy treasury vesting contract', async () => {
    const { timestamp: now } = await provider.getBlock('latest')
    vestingAmount = expandTo18Decimals(100)
    vestingBegin = now + 60
    vestingCliff = vestingBegin + 60
    vestingEnd = vestingBegin + 60 * 60 * 24 * 365
    treasuryVester = await deployContract(wallet, TreasuryVester, [
      Feswa.address,
      timelock.address,
      vestingAmount,
      vestingBegin,
      vestingCliff,
      vestingEnd,
    ])

    // fund the treasury
    await Feswa.transfer(treasuryVester.address, vestingAmount)
  })

  it('setRecipient:fail', async () => {
    await expect(treasuryVester.setRecipient(wallet.address)).to.be.revertedWith(
      'FeswVester::setRecipient: unauthorized'
    )
  })

  it('claim:fail', async () => {
    await expect(treasuryVester.claim()).to.be.revertedWith('FeswVester::claim: not time yet')
    await mineBlock(provider, vestingCliff - 2)
    await expect(treasuryVester.claim()).to.be.revertedWith('FeswVester::claim: not time yet')
  })

  it('claim:~half', async () => {
    await mineBlock(provider, vestingBegin + Math.floor((vestingEnd - vestingBegin) / 2))
    await treasuryVester.claim()
    const balance = await Feswa.balanceOf(timelock.address)
    expect(vestingAmount.div(2).sub(balance).abs().lte(vestingAmount.div(2).div(10000))).to.be.true
  })

  it('claim:all', async () => {
    await mineBlock(provider, vestingBegin + Math.floor((vestingEnd - vestingBegin) / 4))
    await treasuryVester.claim()
    await mineBlock(provider, vestingBegin + Math.floor((vestingEnd - vestingBegin) / 3))
    await treasuryVester.claim()
    await mineBlock(provider, vestingBegin + Math.floor(2* (vestingEnd - vestingBegin) / 3))
    await treasuryVester.claim()
    await mineBlock(provider, vestingEnd)
    await treasuryVester.claim()
    const balance = await Feswa.balanceOf(timelock.address)
    expect(balance).to.be.eq(vestingAmount)
  })
})
