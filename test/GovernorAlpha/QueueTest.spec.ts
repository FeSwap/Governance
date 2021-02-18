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

describe('GovernorAlpha Queue Test', () => {
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
  let governorAlpha: Contract
  let proposalId: BigNumber
  let lastBlock: Block

  const targets = [other0.address];
  const values = ["0"];
  const signatures = ["getBalanceOf(address)"];
  const callDatas = [encodeParameters(['address'], [wallet.address])];

  beforeEach(async () => {
    const fixture = await loadFixture(governanceFixture)
    Feswa = fixture.Feswa
    governorAlpha = fixture.governorAlpha

    await Feswa.delegate(wallet.address);
    await governorAlpha.propose(targets, values, signatures, callDatas, "do nothing");
    proposalId = await governorAlpha.latestProposalIds(wallet.address);
    lastBlock = await provider.getBlock('latest')
   })

  describe("overlapping actions", () => {
    it(" reverts on queueing while peoposal not succeedd && reverts on queueing overlapping actions in same proposal", async () => {
      await Feswa.transfer(other0.address, expandTo18Decimals(40_000_000))
      await Feswa.connect(other0).delegate(other0.address);

      // prepare two same transactions
      const targets = [Feswa.address, Feswa.address];
      const values = ["0", "0"];
      const signatures = ["getBalanceOf(address)", "getBalanceOf(address)"];
      const callDatas = [encodeParameters(['address'], [other0.address]), encodeParameters(['address'], [other0.address])];

      await governorAlpha.connect(other0).propose(targets, values, signatures, callDatas, "do nothing");
      proposalId = await governorAlpha.latestProposalIds(other0.address);

      // increase the block number to prepare for casting vote
      lastBlock = await provider.getBlock('latest')
      await mineBlock(provider, lastBlock.timestamp + 10)

      await governorAlpha.connect(other0).castVote(proposalId, true, overrides)

      await mineBlock(provider, lastBlock.timestamp + 20)
      await mineBlock(provider, lastBlock.timestamp + 30)

      // TP1：Check the proposal state be in Active state
      expect(await governorAlpha.state(proposalId)).to.be.equal(BigNumber.from(ProposalState.Active)) 

      // TP2：Proposal still be active, not be ready for Queue
      await expect(governorAlpha.connect(other0).queue(proposalId, overrides))
            .to.be.revertedWith("GovernorAlpha::queue: proposal can only be queued if it is succeeded")

      await mineBlock(provider, lastBlock.timestamp + 40)
      await mineBlock(provider, lastBlock.timestamp + 50)

      // TP3: Reverts on queueing overlapping actions in same proposal
      await expect(governorAlpha.connect(other0).queue(proposalId, overrides))
            .to.be.revertedWith("GovernorAlpha::_queueOrRevert: proposal action already queued at eta")
    });

    it("reverts on queueing overlapping actions in different proposals, works if waiting", async () => {
      await Feswa.transfer(other0.address, expandTo18Decimals(40_000_000))
      await Feswa.connect(other0).delegate(other0.address);
      await Feswa.transfer(other1.address, expandTo18Decimals(40_000_000))
      await Feswa.connect(other1).delegate(other1.address);

      // prepare two same transactions
      const targets = [Feswa.address];
      const values = ["0"];
      const signatures = ["getBalanceOf(address)"];
      const callDatas = [encodeParameters(['address'], [other0.address])];

      await governorAlpha.connect(other0).propose(targets, values, signatures, callDatas, "do nothing");
      await governorAlpha.connect(other1).propose(targets, values, signatures, callDatas, "do nothing");

      const proposalId1 = await governorAlpha.latestProposalIds(other0.address);
      const proposalId2 = await governorAlpha.latestProposalIds(other1.address);

      // increase the block number to prepare for casting vote
      lastBlock = await provider.getBlock('latest')
      await mineBlock(provider, lastBlock.timestamp + 10)

      await governorAlpha.connect(other0).castVote(proposalId1, true, overrides)
      await governorAlpha.connect(other1).castVote(proposalId2, true, overrides)

      await mineBlock(provider, lastBlock.timestamp + 20)
      await mineBlock(provider, lastBlock.timestamp + 30)
      await mineBlock(provider, lastBlock.timestamp + 40)
      await mineBlock(provider, lastBlock.timestamp + 50)

      // TP1: Queue succeed for proposal 1
      await governorAlpha.queue(proposalId1, overrides)
      let proposal = await governorAlpha.proposals(proposalId1, overrides)

      // TP2: Check the eta be set correctly
      lastBlock = await provider.getBlock('latest')
      expect(proposal.eta).to.be.equal(lastBlock.timestamp + 3600*48)
  
      // TP3: Reverts on queueing overlapping actions in different proposals
      await expect(governorAlpha.queue(proposalId2, overrides))
            .to.be.revertedWith("GovernorAlpha::_queueOrRevert: proposal action already queued at eta")
      
      // TP4: Move timestamp forward, and Queue once again
      await mineBlock(provider, lastBlock.timestamp + 60)
      await governorAlpha.queue(proposalId2, overrides)

      // TP5：Check the proposal state be in Active state
      expect(await governorAlpha.state(proposalId2)).to.be.equal(BigNumber.from(ProposalState.Queued)) 

      // TP6: Reverts on queueing while already queued
      await expect(governorAlpha.queue(proposalId2, overrides))
            .to.be.revertedWith("GovernorAlpha::queue: proposal can only be queued if it is succeeded")

    });
  });
})
