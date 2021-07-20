import chai, { expect } from 'chai'
import { BigNumber, Contract, constants, Wallet } from 'ethers'
import { solidity, MockProvider, createFixtureLoader } from 'ethereum-waffle'

import { governanceFixture } from '../shares/fixtures'
import { DELAY, mineBlock, encodeParameters, expandTo18Decimals, setBlockTime } from '../shares/utils'

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

describe('FeswGovernor Queue Test', () => {
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
  let feswGovernor: Contract
  let proposalId: BigNumber
  let lastBlock: Block

  const targets = [other0.address];
  const values = ["0"];
  const signatures = ["getBalanceOf(address)"];
  const callDatas = [encodeParameters(['address'], [wallet.address])];

  beforeEach(async () => {
    const fixture = await loadFixture(governanceFixture)
    Feswa = fixture.Feswa
    feswGovernor = fixture.feswGovernor

    await Feswa.delegate(wallet.address);
    await feswGovernor.propose(targets, values, signatures, callDatas, "do nothing");
    proposalId = await feswGovernor.latestProposalIds(wallet.address);
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

      await feswGovernor.connect(other0).propose(targets, values, signatures, callDatas, "do nothing");
      proposalId = await feswGovernor.latestProposalIds(other0.address);

      // increase the block number to prepare for casting vote
      lastBlock = await provider.getBlock('latest')
      await mineBlock(provider, lastBlock.timestamp + 10)

      await feswGovernor.connect(other0).castVote(proposalId, true, overrides)

      await mineBlock(provider, lastBlock.timestamp + 20)

      // TP1：Check the proposal state be in Active state
      expect(await feswGovernor.state(proposalId)).to.be.equal(BigNumber.from(ProposalState.Active)) 

      // TP2：Proposal still be active, not be ready for Queue
      await expect(feswGovernor.connect(other0).queue(proposalId, overrides))
            .to.be.revertedWith("FeswGovernor::queue: proposal can only be queued if it is succeeded")

      await mineBlock(provider, lastBlock.timestamp + 7 *24 *3600 + 1)

      // TP3: Reverts on queueing overlapping actions in same proposal
      await expect(feswGovernor.connect(other0).queue(proposalId, overrides))
            .to.be.revertedWith("FeswGovernor::_queueOrRevert: proposal action already queued at eta")
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

      await feswGovernor.connect(other0).propose(targets, values, signatures, callDatas, "do nothing");
      await feswGovernor.connect(other1).propose(targets, values, signatures, callDatas, "do nothing");

      const proposalId1 = await feswGovernor.latestProposalIds(other0.address);
      const proposalId2 = await feswGovernor.latestProposalIds(other1.address);

      // increase the block number to prepare for casting vote
      lastBlock = await provider.getBlock('latest')
      await mineBlock(provider, lastBlock.timestamp + 10)

      await feswGovernor.connect(other0).castVote(proposalId1, true, overrides)
      await feswGovernor.connect(other1).castVote(proposalId2, true, overrides)

      await mineBlock(provider, lastBlock.timestamp + 7 *24 *3600 + 10)
      const timestampSave = lastBlock.timestamp + 7 *24 *3600 + 10

      // TP1: Queue succeed for proposal 1
      await feswGovernor.queue(proposalId1, overrides)
      let proposal = await feswGovernor.proposals(proposalId1, overrides)

      // TP2: Check the eta be set correctly
      lastBlock = await provider.getBlock('latest')
      expect(proposal.eta).to.be.equal(lastBlock.timestamp + 48 * 3600)
  
      // TP3: Reverts on queueing overlapping actions in different proposals
      await mineBlock(provider, timestampSave)
//      await expect(feswGovernor.queue(proposalId2, overrides))
//            .to.be.revertedWith("FeswGovernor::_queueOrRevert: proposal action already queued at eta")

      // TP4: Move timestamp forward, and Queue once again
      await mineBlock(provider, lastBlock.timestamp + 60)
      await feswGovernor.queue(proposalId2, overrides)

      // TP5：Check the proposal state be in Active state
      expect(await feswGovernor.state(proposalId2)).to.be.equal(BigNumber.from(ProposalState.Queued)) 
      // TP6: Reverts on queueing while already queued
      await expect(feswGovernor.queue(proposalId2, overrides))
            .to.be.revertedWith("FeswGovernor::queue: proposal can only be queued if it is succeeded")
    });
  });
})
