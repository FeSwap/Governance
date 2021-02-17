import chai, { expect } from 'chai'
import { Contract, Wallet, providers } from 'ethers'
import { solidity, deployContract } from 'ethereum-waffle'

import FeswapByteCode from '../../build/Fesw.json'
import Timelock from '../../build/Timelock.json'
import GovernorAlpha from '../../build/GovernorAlpha.json'

import { DELAY } from './utils'   // 2 days

chai.use(solidity)

interface GovernanceFixture {
  Feswa: Contract
  timelock: Contract
  governorAlpha: Contract
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
  const governorAlphaAddress = Contract.getContractAddress({ from: wallet.address, nonce: 2 })
  const timelock = await deployContract(wallet, Timelock, [governorAlphaAddress, DELAY])
  expect(timelock.address).to.be.eq(timelockAddress)

  // deploy governorAlpha
  const governorAlpha = await deployContract(wallet, GovernorAlpha, [timelock.address, Feswa.address])
  expect(governorAlpha.address).to.be.eq(governorAlphaAddress)

  return { Feswa, timelock, governorAlpha }
}
