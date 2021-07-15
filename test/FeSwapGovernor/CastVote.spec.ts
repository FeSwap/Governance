import chai, { expect } from 'chai'
import { BigNumber, Contract, constants, Wallet, utils } from 'ethers'
import { solidity, MockProvider, createFixtureLoader } from 'ethereum-waffle'
import { Block } from "@ethersproject/abstract-provider";
import { ecsign } from 'ethereumjs-util'

import { governanceFixture } from '../shares/fixtures'
import { DELAY, mineBlock, encodeParameters, expandTo18Decimals} from '../shares/utils'

chai.use(solidity)

const overrides = {
  gasLimit: 9999999
}

const DOMAIN_TYPEHASH = utils.keccak256(
  utils.toUtf8Bytes('EIP712Domain(string name,uint256 chainId,address verifyingContract)')
)

const BALLOT_TYPEHASH = utils.keccak256(
  utils.toUtf8Bytes('Ballot(uint256 proposalId,bool support)')
)

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
    timelock = fixture.timelock
    feswGovernor = fixture.feswGovernor

    await enfranchise(other0, 50)
    await Feswa.delegate(wallet.address);
    await feswGovernor.propose(targets, values, signatures, callDatas, "do nothing");
    proposalId = await feswGovernor.latestProposalIds(wallet.address);
    lastBlock = await provider.getBlock('latest')
  })

  async function enfranchise(actor: Wallet, amount: number) {
    await Feswa.transfer(actor.address, expandTo18Decimals(amount));
    await Feswa.connect(actor).delegate(actor.address);
  }

  it("Voting block number should be between the proposal's start block (exclusive) and end block (inclusive)", async () => {
    let timestamp = lastBlock.timestamp
    await mineBlock(provider, timestamp-1)
    await expect(feswGovernor.castVote(proposalId, true)).to.be.revertedWith('FeswGovernor::_castVote: voting is closed')
  })

  it("Such proposal already has an entry in its voters set matching the sender", async () => {
    let timestamp = lastBlock.timestamp
    await mineBlock(provider, timestamp + 10)
    await mineBlock(provider, timestamp + 20)

    await feswGovernor.connect(other0).castVote(proposalId, true);

    //cannot vote twice
    await expect(feswGovernor.connect(other0).castVote(proposalId, true))
          .to.be.revertedWith('FeswGovernor::_castVote: voter already voted')
  });

  it("we add the sender to the proposal's voters set", async () => {
    //Such proposal already has an entry in its voters set matching the sender
    let timestamp = lastBlock.timestamp
    await mineBlock(provider, timestamp + 10)

    let receipt = await feswGovernor.getReceipt(proposalId, other0.address)
    expect(receipt.hasVoted).to.be.equal(false)

    await feswGovernor.connect(other0).castVote(proposalId, true);

    receipt = await feswGovernor.getReceipt(proposalId, other0.address)
    expect(receipt.hasVoted).to.be.equal(true)
    expect(receipt.support).to.be.equal(true)
    expect(receipt.votes).to.be.equal(expandTo18Decimals(50))
  });

  describe("Check the balance returned by GetPriorVotes", () => {

    it("Check ForVotes balance", async () => {

      await enfranchise(other1, 40_000_001)
      await feswGovernor.connect(other1).propose(targets, values, signatures, callDatas, "do nothing");
      proposalId = await feswGovernor.latestProposalIds(other1.address);
      lastBlock = await provider.getBlock('latest')

      let beforeFors = await feswGovernor.proposals(proposalId)

      lastBlock = await provider.getBlock('latest')
      await mineBlock(provider, lastBlock.timestamp + 10)

      await feswGovernor.connect(other1).castVote(proposalId, true);
      let afterFors = await feswGovernor.proposals(proposalId)

      expect(afterFors.forVotes).to.be.equal(beforeFors.forVotes.add(expandTo18Decimals(40_000_001)))

    })

    it("Check AgainstVotes balance", async () => {

      await enfranchise(other1, 40_000_001)
      await feswGovernor.connect(other1).propose(targets, values, signatures, callDatas, "do nothing");
      proposalId = await feswGovernor.latestProposalIds(other1.address);
      lastBlock = await provider.getBlock('latest')

      let beforeFors = await feswGovernor.proposals(proposalId)

      lastBlock = await provider.getBlock('latest')
      await mineBlock(provider, lastBlock.timestamp + 10)

      await feswGovernor.connect(other1).castVote(proposalId, false);

      let afterFors = await feswGovernor.proposals(proposalId)
      expect(afterFors.againstVotes).to.be.equal(beforeFors.againstVotes.add(expandTo18Decimals(40_000_001)))

    });
  });

  describe('castVoteBySig', () => {
 
    it('reverts if the signatory is invalid', async () => {
      lastBlock = await provider.getBlock('latest')
      await mineBlock(provider, lastBlock.timestamp + 10)
      await expect(feswGovernor.castVoteBySig(proposalId, false, 0x00, BALLOT_TYPEHASH, BALLOT_TYPEHASH))
            .to.be.revertedWith("FeswGovernor::castVoteBySig: invalid signature");
    });

    it('casts vote on behalf of the signatory', async () => {

      await enfranchise(other1, 40_000_001)
      await feswGovernor.connect(other1).propose(targets, values, signatures, callDatas, "do nothing");
      proposalId = await feswGovernor.latestProposalIds(other1.address);

      const domainSeparator = utils.keccak256(
        utils.defaultAbiCoder.encode(
          ['bytes32', 'bytes32', 'uint256', 'address'],
          [DOMAIN_TYPEHASH, utils.keccak256(utils.toUtf8Bytes('Feswap Governor Alpha')), 1, feswGovernor.address]
        )
      )
  
      const digest = utils.keccak256(
        utils.solidityPack(
          ['bytes1', 'bytes1', 'bytes32', 'bytes32'],
          [
            '0x19', '0x01', domainSeparator,
            utils.keccak256(utils.defaultAbiCoder.encode(
                ['bytes32', 'uint256', 'bool'],
                [BALLOT_TYPEHASH, proposalId, true])),
          ]
        )
      )
  
      const { v, r, s } = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(other1.privateKey.slice(2), 'hex'))
  
      let beforeFors = await feswGovernor.proposals(proposalId)

      lastBlock = await provider.getBlock('latest')
      await mineBlock(provider, lastBlock.timestamp + 10)

      const castVoteBySigTrx = await feswGovernor.castVoteBySig(proposalId, true, v, r, s)

      const receipt = await castVoteBySigTrx.wait()
      expect(receipt.gasUsed).to.eq(61768)    // 82868

      let afterFors = await feswGovernor.proposals(proposalId)
      expect(afterFors.forVotes).to.be.equal(beforeFors.forVotes.add(expandTo18Decimals(40_000_001)))

    });
  });

  it("receipt uses one load", async () => {
    await enfranchise(other0, 40_000_001)
    await enfranchise(other1, 40_000_001)    
    await feswGovernor.connect(other0).propose(targets, values, signatures, callDatas, "do nothing");
    proposalId = await feswGovernor.latestProposalIds(other0.address);

    lastBlock = await provider.getBlock('latest')
    await mineBlock(provider, lastBlock.timestamp + 10)
    await mineBlock(provider, lastBlock.timestamp + 20)

    await expect(feswGovernor.connect(other0).castVote(proposalId, true, overrides))
          .to.emit(feswGovernor, 'VoteCast')
          .withArgs(other0.address, proposalId, true, expandTo18Decimals(40_000_051))

    await expect(feswGovernor.connect(other1).castVote(proposalId, false, overrides))
          .to.emit(feswGovernor, 'VoteCast')
          .withArgs(other1.address, proposalId, false, expandTo18Decimals(40_000_001))     
  })

})
