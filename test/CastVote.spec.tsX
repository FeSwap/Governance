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

describe('castVote', () => {
  const provider = new MockProvider({
    ganacheOptions: {
      hardfork: 'istanbul',
      mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
      gasLimit: 9999999,
      gasPrice: '1',
      default_balance_ether: 100,
    },
  })
  const [wallet, other0, other1] = provider.getWallets()
  const loadFixture = createFixtureLoader([wallet], provider)

  let Feswa: Contract
  let timelock: Contract
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
    timelock = fixture.timelock
    governorAlpha = fixture.governorAlpha

 //   await enfranchise(other0, 50)
    await Feswa.delegate(wallet.address);
    await governorAlpha.propose(targets, values, signatures, callDatas, "do nothing");
    proposalId = await governorAlpha.latestProposalIds(wallet.address);
    lastBlock = await provider.getBlock('latest')
  })

  async function enfranchise(actor: Wallet, amount: number) {
    await Feswa.transfer(actor.address, expandTo18Decimals(amount));
    await Feswa.connect(actor).delegate(actor.address);
  }

  it("Voting block number should be between the proposal's start block (exclusive) and end block (inclusive)", async () => {
    //Voting block number should be between the proposal's start block (exclusive) and end block (inclusive)
//    lastBlock = await provider.getBlock('latest') ; console.log("lastBlockAAAA", lastBlock)
    await expect(governorAlpha.castVote(proposalId, true)).to.be.revertedWith('GovernorAlpha::_castVote: voting is closed')
 
    //Such proposal already has an entry in its voters set matching the sender
    let timestamp = lastBlock.timestamp
    await mineBlock(provider, timestamp + 10)

    let receipt = await governorAlpha.getReceipt(proposalId, other0.address)
    expect(receipt.hasVoted).to.be.equal(false)

    await governorAlpha.connect(other0).castVote(proposalId, true);

    receipt = await governorAlpha.getReceipt(proposalId, other0.address)
    expect(receipt.hasVoted).to.be.equal(true)
    expect(receipt.support).to.be.equal(true)
    expect(receipt.votes).to.be.equal(expandTo18Decimals(50))
    
    //cannot vote twice
    await expect(governorAlpha.connect(other0).castVote(proposalId, true))
          .to.be.revertedWith('GovernorAlpha::_castVote: voter already voted')
  })

  it("Proposal get voted", async () => {
    // Proposal threshold check
    await expect(governorAlpha.connect(other0).propose(targets, values, signatures, callDatas, "do nothing"))
          .to.be.revertedWith('GovernorAlpha::propose: proposer votes below proposal threshold')

    await Feswa.transfer(other0.address, expandTo18Decimals(10_000_000)); //still less than the threshold
    await Feswa.connect(other0).delegate(other0.address);

    await expect(governorAlpha.connect(other1).propose(targets, values, signatures, callDatas, "do nothing"))
          .to.be.revertedWith('GovernorAlpha::propose: proposer votes below proposal threshold')

    await enfranchise(other0, 1) 
    await governorAlpha.connect(other1).propose(targets, values, signatures, callDatas, "do nothing")
    proposalId = await governorAlpha.latestProposalIds(wallet.address);

    let receipt = await governorAlpha.getReceipt(proposalId, other0.address)
    expect(receipt.hasVoted).to.be.equal(false)

    await governorAlpha.connect(other0).castVote(proposalId, true);

    receipt = await governorAlpha.getReceipt(proposalId, other0.address)
    expect(receipt.hasVoted).to.be.equal(true)
    expect(receipt.support).to.be.equal(true)
    expect(receipt.votes).to.be.equal(expandTo18Decimals(50))
    
    //cannot vote twice
    await expect(governorAlpha.connect(other0).castVote(proposalId, true))
          .to.be.revertedWith('GovernorAlpha::_castVote: voter already voted')

          actor = accounts[1];
          await enfranchise(comp, actor, 400001);
  
          await send(gov, 'propose', [targets, values, signatures, callDatas, "do nothing"], { from: actor });
          proposalId = await call(gov, 'latestProposalIds', [actor]);
  
          let beforeFors = (await call(gov, 'proposals', [proposalId])).forVotes;
          await mineBlock();
          await send(gov, 'castVote', [proposalId, true], { from: actor });
  
          let afterFors = (await call(gov, 'proposals', [proposalId])).forVotes;
          expect(new BigNumber(afterFors)).toEqual(new BigNumber(beforeFors).plus(etherMantissa(400001)));

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
    expect(votingPeriod).to.be.eq(40320)
    const timelockAddress = await governorAlpha.timelock()
    expect(timelockAddress).to.be.eq(timelock.address)
    const FeswaFromGovernor = await governorAlpha.Feswa()
    expect(FeswaFromGovernor).to.be.eq(Feswa.address)
  })
})
