import chai, { expect } from 'chai'
import { BigNumber, Contract, constants, Wallet } from 'ethers'
import { solidity, MockProvider, createFixtureLoader } from 'ethereum-waffle'

import { governanceFixture } from '../shares/fixtures'
import { DELAY, mineBlock, encodeParameters, expandTo18Decimals} from '../shares/utils'

import { Block } from "@ethersproject/abstract-provider";

chai.use(solidity)

const overrides = {
  gasLimit: 9999999
}

enum ProposalState {
  Pending,
  Active,
  Canceled,
  Defeated,
  Succeeded,
  Queued,
  Expired,
  Executed
}

describe('FeswGovernor Config Test', () => {
  const provider = new MockProvider({
    ganacheOptions: {
      hardfork: 'istanbul',
      mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
      gasLimit: 9999999,
      gasPrice: '1',
      default_balance_ether: 100,
    },
  })
  const [wallet, other0,other1] = provider.getWallets()
  const loadFixture = createFixtureLoader([wallet], provider)

  let Feswa: Contract
  let timelock: Contract
  let feswGovernor: Contract
  let proposalId: BigNumber
  let lastBlock: Block
  let trivialProposal: any
  let targets: string[]
  let values: string[]
  let signatures: string[]
  let callDatas: string[]
  
  beforeEach(async () => {
    const fixture = await loadFixture(governanceFixture)
    Feswa = fixture.Feswa
    timelock = fixture.timelock
    feswGovernor = fixture.feswGovernor

    targets = [feswGovernor.address];
    values = ["0"];
    signatures = ["config(uint256,uint256,uint256,uint256)"];
    callDatas = [encodeParameters(
      ['uint256', 'uint256', 'uint256', 'uint256'],
      [expandTo18Decimals(30_000_000), 0, 0, 0])]
  })

  it("Config Normal Executed", async () => {
    await Feswa.transfer(other0.address, expandTo18Decimals(40_000_000))
    await Feswa.connect(other0).delegate(other0.address);
    await feswGovernor.connect(other0).propose(targets, values, signatures, callDatas, "Change Config");
    let newProposalId = await feswGovernor.proposalCount();

    lastBlock = await provider.getBlock('latest')
    await mineBlock(provider, lastBlock.timestamp + 10)
    await feswGovernor.connect(other0).castVote(newProposalId, true)
 
    await mineBlock(provider, lastBlock.timestamp + 7 *24 *3600 + 1)

    await feswGovernor.queue(newProposalId)
    expect(await feswGovernor.state(newProposalId)).to.be.eq(ProposalState.Queued)

    let gracePeriod = await timelock.GRACE_PERIOD()
    trivialProposal = await feswGovernor.proposals(newProposalId);
    let periodtime: number = (gracePeriod as BigNumber).add(trivialProposal.eta).toNumber()

    await mineBlock(provider,periodtime-2)
    expect(await feswGovernor.state(newProposalId)).to.be.eq(ProposalState.Queued)

    await feswGovernor.connect(other0).execute(newProposalId, overrides)
    expect(await feswGovernor.state(newProposalId)).to.be.eq(ProposalState.Executed)

    await mineBlock(provider,periodtime)
    expect(await feswGovernor.state(newProposalId)).to.be.eq(ProposalState.Executed)
  })
})
