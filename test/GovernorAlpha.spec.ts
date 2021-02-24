import chai, { expect } from 'chai'
import { Contract, constants } from 'ethers'
import { solidity, MockProvider, createFixtureLoader } from 'ethereum-waffle'

import { governanceFixture } from './shares/fixtures'
import { DELAY } from './shares/utils'

chai.use(solidity)

describe('GovernorAlpha', () => {
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
  let governorAlpha: Contract
  beforeEach(async () => {
    const fixture = await loadFixture(governanceFixture)
    Feswa = fixture.Feswa
    timelock = fixture.timelock
    governorAlpha = fixture.governorAlpha
  })

  it('Feswa', async () => {
    const balance = await Feswa.balanceOf(wallet.address)
    const totalSupply = await Feswa.totalSupply()
    expect(balance).to.be.eq(totalSupply)
  })

  it('timelock', async () => {
    const admin = await timelock.admin()
    expect(admin).to.be.eq(governorAlpha.address)
    const pendingAdmin = await timelock.pendingAdmin()
    expect(pendingAdmin).to.be.eq(constants.AddressZero)
    const delay = await timelock.delay()
    expect(delay).to.be.eq(DELAY)
  })

  it('governor', async () => {
    const votingPeriod = await governorAlpha.votingPeriod()
//    expect(votingPeriod).to.be.eq(40320)
    expect(votingPeriod).to.be.eq(5)        // for Testing
    const timelockAddress = await governorAlpha.timelock()
    expect(timelockAddress).to.be.eq(timelock.address)
    const FeswaFromGovernor = await governorAlpha.Feswa()
    expect(FeswaFromGovernor).to.be.eq(Feswa.address)
  })
})