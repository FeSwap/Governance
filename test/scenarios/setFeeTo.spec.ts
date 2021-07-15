import chai, { expect } from 'chai'
import { Contract, utils } from 'ethers'
import { solidity, MockProvider, createFixtureLoader, deployContract } from 'ethereum-waffle'

import FeswapFactory from '../Feswap/FeswapFactory.json'

import { governanceFixture } from '../shares/fixtures'
import { mineBlock } from '../shares/utils'

chai.use(solidity)

describe('scenario:setFeeTo', () => {
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
  let feswGovernor: Contract
  beforeEach(async () => {
    const fixture = await loadFixture(governanceFixture)
    Feswa = fixture.Feswa
    timelock = fixture.timelock
    feswGovernor = fixture.feswGovernor
  })

  let factory: Contract
  beforeEach('deploy FeSwap', async () => {
    factory = await deployContract(wallet, FeswapFactory, [timelock.address])
  })

  it('setFeeTo', async () => {
    const target = factory.address
    const value = 0
    const signature = 'setFeeTo(address)'
    const calldata = utils.defaultAbiCoder.encode(['address'], [timelock.address])
    const description = 'Set feeTo on the FeswapFactory to the timelock address.'

    // activate balances
    await Feswa.delegate(wallet.address)
    const { timestamp: now } = await provider.getBlock('latest')
    await mineBlock(provider, now)

    const proposalId = await feswGovernor.callStatic.propose([target], [value], [signature], [calldata], description)
    await feswGovernor.propose([target], [value], [signature], [calldata], description)

    await mineBlock(provider, now + 10)
    await feswGovernor.castVote(proposalId, true)

    let lastBlock = await provider.getBlock('latest') 
    await mineBlock(provider, lastBlock.timestamp +  7*24*3600 + 1)
 
    await feswGovernor.queue(proposalId)

    lastBlock = await provider.getBlock('latest') 
    await mineBlock(provider, lastBlock.timestamp +  2 * 24 * 3600 + 1)

    await feswGovernor.execute(proposalId)

    const feeTo = await factory.feeTo()
    expect(feeTo).to.be.eq(timelock.address)
 
  })
})
