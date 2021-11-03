import chai, { expect } from 'chai'
import { Contract, constants } from 'ethers'
import { solidity, MockProvider, createFixtureLoader, deployContract } from 'ethereum-waffle'

import FeSwapFactory from '../Feswap/FeswapFactory.json'
import FeeToSetter from '../../build/FeeToSetter.json'

import { governanceFixture } from '../shares/fixtures'
import { mineBlock } from '../shares/utils'

chai.use(solidity)

describe('scenario:FeeToSetter', () => {
  const provider = new MockProvider({
    ganacheOptions: {
      hardfork: 'istanbul',
      mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
      gasLimit: 9999999,
    },
  })
  const [wallet, other, NFTSimu] = provider.getWallets()
  const loadFixture = createFixtureLoader([wallet], provider)

  beforeEach(async () => {
    await loadFixture(governanceFixture)
  })

  let factory: Contract
  beforeEach('deploy FeSwap', async () => {
    factory = await deployContract(wallet, FeSwapFactory, [wallet.address, other.address, NFTSimu.address])
  })

  let feeToSetter: Contract
  let vestingEnd: number
  beforeEach('deploy feeToSetter vesting contract', async () => {
    const { timestamp: now } = await provider.getBlock('latest')
    vestingEnd = now + 60
    // 3rd constructor arg should be timelock, just mocking for testing purposes
    // 4th constructor arg should be feeTo, just mocking for testing purposes
    feeToSetter = await deployContract(wallet, FeeToSetter, [
      factory.address,
      vestingEnd,
      wallet.address,
      other.address,
    ])

    // set feeToSetter to be the vesting contract
    await factory.setFactoryAdmin(feeToSetter.address)
  })

  it('setOwner:fail', async () => {
    await expect(feeToSetter.connect(other).setOwner(other.address)).to.be.revertedWith(
      'FeeToSetter::setOwner: not allowed'
    )
  })

  it('setOwner', async () => {
    await feeToSetter.setOwner(other.address)
  })

  it('setFactoryAdmin:fail', async () => {
    await expect(feeToSetter.setFactoryAdmin(other.address)).to.be.revertedWith(
      'FeeToSetter::setFactoryAdmin: not time yet'
    )
    await mineBlock(provider, vestingEnd)
    await expect(feeToSetter.connect(other).setFactoryAdmin(other.address)).to.be.revertedWith(
      'FeeToSetter::setFactoryAdmin: not allowed'
    )
  })

  it('setFactoryAdmin', async () => {
    await mineBlock(provider, vestingEnd)
    await feeToSetter.setFactoryAdmin(other.address)
  })

  it('toggleFees:fail', async () => {
    await expect(feeToSetter.toggleFees(true)).to.be.revertedWith('FeeToSetter::toggleFees: not time yet')
    await mineBlock(provider, vestingEnd)
    await expect(feeToSetter.connect(other).toggleFees(true)).to.be.revertedWith('FeeToSetter::toggleFees: not allowed')
  })

  it('toggleFees', async () => {
    let feeTo = await factory.feeTo()
    expect(feeTo).to.be.eq(constants.AddressZero)
  
    await mineBlock(provider, vestingEnd)

    await feeToSetter.toggleFees(true)
    feeTo = await factory.feeTo()
    expect(feeTo).to.be.eq(other.address)

    await feeToSetter.toggleFees(false)
    feeTo = await factory.feeTo()
    expect(feeTo).to.be.eq(constants.AddressZero)
  })
})
