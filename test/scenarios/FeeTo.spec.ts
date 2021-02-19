import chai, { expect } from 'chai'
import { Contract, constants} from 'ethers'

import { solidity, MockProvider, createFixtureLoader, deployContract } from 'ethereum-waffle'

import FeswapFactory from '../Feswap/FeswapFactory.json'
import FeSwapRouter from '../Feswap/FeSwapRouter.json'
import FeSwapPair from '../Feswap/FeSwapPair.json'
import FeeToSetter from '../../build/FeeToSetter.json'
import FeeTo from '../../build/FeeTo.json'
import FeswapToken from '../../build/Fesw.json'

import { governanceFixture } from '../shares/fixtures'
import { mineBlock, expandTo18Decimals } from '../shares/utils'

chai.use(solidity)

const overrides = {
  gasLimit: 9999999
}

describe('scenario:FeeTo', () => {
  const provider = new MockProvider({
    ganacheOptions: {
      hardfork: 'istanbul',
      mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
      gasLimit: 9999999,
    },
  })
  const [wallet, other0, other1] = provider.getWallets()
  const loadFixture = createFixtureLoader([wallet], provider)

  beforeEach(async () => {
    await loadFixture(governanceFixture)
  })

  let factory: Contract
  let router: Contract
  beforeEach('deploy Feswap', async () => {
    factory = await deployContract(wallet, FeswapFactory, [wallet.address])
    router = await deployContract(wallet, FeSwapRouter, [factory.address, other0.address])   // other0 is fake WETH
  })

  let feeToSetter: Contract
  let vestingEnd: number
  let feeTo: Contract
  beforeEach('deploy feeToSetter vesting contract', async () => {
    // deploy feeTo
    // constructor arg should be timelock, just mocking for testing purposes
    feeTo = await deployContract(wallet, FeeTo, [wallet.address])

    const { timestamp: now } = await provider.getBlock('latest')
    vestingEnd = now + 60
    // 3rd constructor arg should be timelock, just mocking for testing purposes
    // 4th constructor arg should be feeTo, just mocking for testing purposes
    feeToSetter = await deployContract(wallet, FeeToSetter, [
      factory.address,
      vestingEnd,
      wallet.address,
      feeTo.address,
    ])

    // set feeToSetter to be the vesting contract
    await factory.setRouterFeSwap(router.address)    
    await factory.setFeeToSetter(feeToSetter.address)

    await mineBlock(provider, vestingEnd)
  })

  it('permissions', async () => {
    await expect(feeTo.connect(other0).setOwner(other0.address)).to.be.revertedWith('FeeTo::setOwner: not allowed')

    await expect(feeTo.connect(other0).setFeeRecipient(other0.address)).to.be.revertedWith(
      'FeeTo::setFeeRecipient: not allowed'
    )
  })

  describe('tokens', () => {
    const tokens: Contract[] = []
    beforeEach('make test tokens', async () => {
      const { timestamp: now } = await provider.getBlock('latest')
      const token0 = await deployContract(wallet, FeswapToken, [wallet.address, constants.AddressZero, now + 60 * 60])
      tokens.push(token0)
      const token1 = await deployContract(wallet, FeswapToken, [wallet.address, constants.AddressZero, now + 60 * 60])
      tokens.push(token1)
    })

    let pairAAB: Contract
    let pairABB: Contract
    beforeEach('create fee liquidity', async () => {
      // turn the fee on
      await feeToSetter.toggleFees(true)

      // create the pair
      await router.createFeswaPair(tokens[0].address, tokens[1].address, other1.address, constants.MaxUint256,
            { ...overrides, value: expandTo18Decimals(1) }
        )
      const pairAddressAAB = await factory.getPair(tokens[0].address, tokens[1].address)
      const pairAddressABB = await factory.getPair(tokens[1].address, tokens[0].address)      
      pairAAB = new Contract(pairAddressAAB, FeSwapPair.abi).connect(wallet)
      pairABB = new Contract(pairAddressABB, FeSwapPair.abi).connect(wallet)      

      // add liquidity
      await tokens[0].transfer(pairAAB.address, expandTo18Decimals(1))
      await tokens[1].transfer(pairAAB.address, expandTo18Decimals(1))
      await pairAAB.mint(wallet.address)

      await tokens[0].transfer(pairABB.address, expandTo18Decimals(1))
      await tokens[1].transfer(pairABB.address, expandTo18Decimals(1))
      await pairABB.mint(wallet.address)

      // swap
      await tokens[0].transfer(pairAAB.address, expandTo18Decimals(1).div(10))
      const amount = expandTo18Decimals(1).div(20)
      await pairAAB.swap(amount, wallet.address, '0x', { gasLimit: 9999999 })

      // mint again to collect the rewards
      await tokens[0].transfer(pairAAB.address, expandTo18Decimals(1))
      await tokens[1].transfer(pairAAB.address, expandTo18Decimals(1))
      await pairAAB.mint(wallet.address, { gasLimit: 9999999 })
      
    })

    it('updateTokenAllowState', async () => {
      let tokenAllowState = await feeTo.tokenAllowStates(tokens[0].address)
      expect(tokenAllowState[0]).to.be.false
      expect(tokenAllowState[1]).to.be.eq(0)

      await feeTo.updateTokenAllowState(tokens[0].address, true)
      tokenAllowState = await feeTo.tokenAllowStates(tokens[0].address)
      expect(tokenAllowState[0]).to.be.true
      expect(tokenAllowState[1]).to.be.eq(1)

      await feeTo.updateTokenAllowState(tokens[0].address, false)
      tokenAllowState = await feeTo.tokenAllowStates(tokens[0].address)
      expect(tokenAllowState[0]).to.be.false
      expect(tokenAllowState[1]).to.be.eq(2)

      await feeTo.updateTokenAllowState(tokens[0].address, false)
      tokenAllowState = await feeTo.tokenAllowStates(tokens[0].address)
      expect(tokenAllowState[0]).to.be.false
      expect(tokenAllowState[1]).to.be.eq(2)

      await feeTo.updateTokenAllowState(tokens[0].address, true)
      tokenAllowState = await feeTo.tokenAllowStates(tokens[0].address)
      expect(tokenAllowState[0]).to.be.true
      expect(tokenAllowState[1]).to.be.eq(2)

      await feeTo.updateTokenAllowState(tokens[0].address, false)
      tokenAllowState = await feeTo.tokenAllowStates(tokens[0].address)
      expect(tokenAllowState[0]).to.be.false
      expect(tokenAllowState[1]).to.be.eq(3)
    })

    it('claim is a no-op if renounce has not been called', async () => {
      await feeTo.updateTokenAllowState(tokens[0].address, true)
      await feeTo.updateTokenAllowState(tokens[1].address, true)
      await feeTo.setFeeRecipient(other0.address)

      const balanceBefore = await pairAAB.balanceOf(other0.address)
      expect(balanceBefore).to.be.eq(0)

      await feeTo.claim(pairAAB.address)
      const balanceAfter = await pairAAB.balanceOf(other0.address)
      expect(balanceAfter).to.be.eq(0)
    })

    it('renounce works', async () => {
      await feeTo.updateTokenAllowState(tokens[0].address, true)
      await feeTo.updateTokenAllowState(tokens[1].address, true)
      await feeTo.setFeeRecipient(other0.address)

      const totalSupplyBefore = await pairAAB.totalSupply()
      await feeTo.renounce(pairAAB.address, { gasLimit: 9999999 })
      const totalSupplyAfter = await pairAAB.totalSupply()
      expect(totalSupplyAfter.lt(totalSupplyBefore)).to.be.true
    })

    it('claim works', async () => {
      await feeTo.updateTokenAllowState(tokens[0].address, true)
      await feeTo.updateTokenAllowState(tokens[1].address, true)
      await feeTo.setFeeRecipient(other0.address)

      await feeTo.renounce(pairAAB.address, { gasLimit: 9999999 })

      // swap

      let other0balance = await pairAAB.balanceOf(feeTo.address)
      console.log("other0balanceAAAAAAAAA:", other0balance)

      await tokens[0].transfer(pairAAB.address, expandTo18Decimals(1).div(10000))
      const amount = expandTo18Decimals(1).div(12000)
      await pairAAB.swap(amount, wallet.address, '0x', { gasLimit: 9999999 })

      other0balance = await pairAAB.balanceOf(feeTo.address)
      console.log("other0balanceBBBBBBBBBBB:", other0balance)

      // mint again to collect the rewards
      await tokens[0].transfer(pairAAB.address, expandTo18Decimals(1))
      await tokens[1].transfer(pairAAB.address, expandTo18Decimals(1))
      await pairAAB.mint(wallet.address, { gasLimit: 9999999 })

      other0balance = await pairAAB.balanceOf(feeTo.address)
      console.log("other0balanceCCCCCCCCCCCCCCC:", other0balance)

      const balanceBefore = await pairAAB.balanceOf(other0.address)
      await feeTo.claim(pairAAB.address, { gasLimit: 9999999 })
      const balanceAfter = await pairAAB.balanceOf(other0.address)
      expect(balanceAfter.gt(balanceBefore)).to.be.true

      console.log("balanceBefore:", balanceBefore)
      console.log("balanceAfter:", balanceAfter)

    })
  })
})
