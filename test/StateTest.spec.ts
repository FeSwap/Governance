import chai, { expect } from 'chai'
import { BigNumber, Contract, constants, Wallet } from 'ethers'
import { solidity, MockProvider, createFixtureLoader } from 'ethereum-waffle'

import { governanceFixture } from './fixtures'
import { DELAY, mineBlock, encodeParameters, expandTo18Decimals} from './utils'

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

describe('GovernorAlpha State Test', () => {
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
  let governorAlpha: Contract
  let proposalId: BigNumber
  let lastBlock: Block
  let trivialProposal: any

  const targets = [other0.address];
  const values = ["0"];
  const signatures = ["getBalanceOf(address)"];
  const callDatas = [encodeParameters(['address'], [wallet.address])];

  beforeEach(async () => {
    const fixture = await loadFixture(governanceFixture)
    Feswa = fixture.Feswa
    timelock = fixture.timelock
    governorAlpha = fixture.governorAlpha

    await Feswa.delegate(wallet.address);
    await governorAlpha.propose(targets, values, signatures, callDatas, "do nothing");
    proposalId = await governorAlpha.latestProposalIds(wallet.address);
    lastBlock = await provider.getBlock('latest')
    trivialProposal = await governorAlpha.proposals(proposalId);
  })

  it("Invalid for proposal not found", async () => {
    await expect(governorAlpha.state(proposalId.add(1))).to.be.revertedWith("GovernorAlpha::state: invalid proposal id")
  })

  it("Pending", async () => {
    expect(await governorAlpha.state(proposalId)).to.be.eq(ProposalState.Pending)
  })

  it("Active", async () => {
    lastBlock = await provider.getBlock('latest')
    await mineBlock(provider, lastBlock.timestamp + 10)
    await mineBlock(provider, lastBlock.timestamp + 20)
    expect(await governorAlpha.state(proposalId)).to.be.eq(ProposalState.Active)
  })

  it("Canceled", async () => {
    await Feswa.transfer(other0.address, expandTo18Decimals(40_000_000))
    await Feswa.connect(other0).delegate(other0.address);
    lastBlock = await provider.getBlock('latest')
    await mineBlock(provider, lastBlock.timestamp + 10)

    await governorAlpha.connect(other0).propose(targets, values, signatures, callDatas, "do nothing");
    let newProposalId = await governorAlpha.proposalCount();

    // send away the delegates
    await Feswa.connect(other0).delegate(wallet.address); 
    await governorAlpha.cancel(newProposalId)

    expect(await governorAlpha.state(+newProposalId)).to.be.eq(ProposalState.Canceled)
  })

  it("Defeated", async () => {
    // travel to end block
    lastBlock = await provider.getBlock('latest')
    await mineBlock(provider, lastBlock.timestamp + 10)
    await mineBlock(provider, lastBlock.timestamp + 20)
    await mineBlock(provider, lastBlock.timestamp + 30)
    await mineBlock(provider, lastBlock.timestamp + 40)
    await mineBlock(provider, lastBlock.timestamp + 50)
    await mineBlock(provider, lastBlock.timestamp + 60)
    await mineBlock(provider, lastBlock.timestamp + 70)

    expect(await governorAlpha.state(proposalId)).to.be.eq(ProposalState.Defeated)
  })

  it("Succeeded", async () => {
    await Feswa.transfer(other0.address, expandTo18Decimals(40_000_000))
    await Feswa.connect(other0).delegate(other0.address);
    await governorAlpha.connect(other0).propose(targets, values, signatures, callDatas, "do nothing");
    let newProposalId = await governorAlpha.proposalCount();

    lastBlock = await provider.getBlock('latest')
    await mineBlock(provider, lastBlock.timestamp + 10)
    await governorAlpha.connect(other0).castVote(newProposalId, true)
 
    await mineBlock(provider, lastBlock.timestamp + 30)
    await mineBlock(provider, lastBlock.timestamp + 40)
    await mineBlock(provider, lastBlock.timestamp + 50)
    await mineBlock(provider, lastBlock.timestamp + 60)
    await mineBlock(provider, lastBlock.timestamp + 70)

    expect(await governorAlpha.state(newProposalId)).to.be.eq(ProposalState.Succeeded)
  })

  it("Queued", async () => {
    await Feswa.transfer(other0.address, expandTo18Decimals(40_000_000))
    await Feswa.connect(other0).delegate(other0.address);
    await governorAlpha.connect(other0).propose(targets, values, signatures, callDatas, "do nothing");
    let newProposalId = await governorAlpha.proposalCount();

    lastBlock = await provider.getBlock('latest')
    await mineBlock(provider, lastBlock.timestamp + 10)
    await governorAlpha.connect(other0).castVote(newProposalId, true)
 
    await mineBlock(provider, lastBlock.timestamp + 30)
    await mineBlock(provider, lastBlock.timestamp + 40)
    await mineBlock(provider, lastBlock.timestamp + 50)
    await mineBlock(provider, lastBlock.timestamp + 60)
    await mineBlock(provider, lastBlock.timestamp + 70)

    await governorAlpha.queue(newProposalId)
    expect(await governorAlpha.state(newProposalId)).to.be.eq(ProposalState.Queued)
  })

  it("Expired", async () => {
    await Feswa.transfer(other0.address, expandTo18Decimals(40_000_000))
    await Feswa.connect(other0).delegate(other0.address);
    await governorAlpha.connect(other0).propose(targets, values, signatures, callDatas, "do nothing");
    let newProposalId = await governorAlpha.proposalCount();

    lastBlock = await provider.getBlock('latest')
    await mineBlock(provider, lastBlock.timestamp + 10)
    await governorAlpha.connect(other0).castVote(newProposalId, true)
 
    await mineBlock(provider, lastBlock.timestamp + 30)
    await mineBlock(provider, lastBlock.timestamp + 40)
    await mineBlock(provider, lastBlock.timestamp + 50)
    await mineBlock(provider, lastBlock.timestamp + 60)
    await mineBlock(provider, lastBlock.timestamp + 70)

    await governorAlpha.queue(newProposalId)
    expect(await governorAlpha.state(newProposalId)).to.be.eq(ProposalState.Queued)

    let gracePeriod = await timelock.GRACE_PERIOD()
    trivialProposal = await governorAlpha.proposals(newProposalId);
    let periodtime: number = (gracePeriod as BigNumber).add(trivialProposal.eta).toNumber()

    await mineBlock(provider,periodtime-1)
    expect(await governorAlpha.state(newProposalId)).to.be.eq(ProposalState.Queued)

    await mineBlock(provider,periodtime)
    expect(await governorAlpha.state(newProposalId)).to.be.eq(ProposalState.Expired)

  })

  it("Executed", async () => {
    await Feswa.transfer(other0.address, expandTo18Decimals(40_000_000))
    await Feswa.connect(other0).delegate(other0.address);
    await governorAlpha.connect(other0).propose(targets, values, signatures, callDatas, "do nothing");
    let newProposalId = await governorAlpha.proposalCount();

    lastBlock = await provider.getBlock('latest')
    await mineBlock(provider, lastBlock.timestamp + 10)
    await governorAlpha.connect(other0).castVote(newProposalId, true)
 
    await mineBlock(provider, lastBlock.timestamp + 30)
    await mineBlock(provider, lastBlock.timestamp + 40)
    await mineBlock(provider, lastBlock.timestamp + 50)
    await mineBlock(provider, lastBlock.timestamp + 60)
    await mineBlock(provider, lastBlock.timestamp + 70)

    await governorAlpha.queue(newProposalId)
    expect(await governorAlpha.state(newProposalId)).to.be.eq(ProposalState.Queued)

    let gracePeriod = await timelock.GRACE_PERIOD()
    trivialProposal = await governorAlpha.proposals(newProposalId);
    let periodtime: number = (gracePeriod as BigNumber).add(trivialProposal.eta).toNumber()

    await mineBlock(provider,periodtime-1)
    expect(await governorAlpha.state(newProposalId)).to.be.eq(ProposalState.Queued)

    await governorAlpha.connect(other0).execute(newProposalId)
    expect(await governorAlpha.state(newProposalId)).to.be.eq(ProposalState.Executed)

    await mineBlock(provider,periodtime)
    expect(await governorAlpha.state(newProposalId)).to.be.eq(ProposalState.Executed)
  })
})
