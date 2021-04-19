import chai, { expect } from 'chai'
import { BigNumber, Contract, constants, Wallet } from 'ethers'
import { solidity, MockProvider, createFixtureLoader } from 'ethereum-waffle'

import { governanceFixture } from '../shares/fixtures'
import { DELAY, mineBlock, encodeParameters, expandTo18Decimals, setBlockTime} from '../shares/utils'

import { Block } from "@ethersproject/abstract-provider";

chai.use(solidity)

const overrides = {
  gasLimit: 9999999
}

describe('GovernorAlpha_Propose', () => {
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
  let trivialProposal: any

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
    trivialProposal = await governorAlpha.proposals(proposalId);
  })

  it("ID is set to a globally unique identifier", async () => {
    expect(trivialProposal.id).to.be.equal(proposalId);
  });

  it("Proposer is set to the sender", async () => {
    expect(trivialProposal.proposer).to.be.equal(wallet.address);
  });

  it("Start block is set to the current block number, and the block time", async () => {
    expect(trivialProposal.startBlock).to.be.equal(lastBlock.number);
    expect(trivialProposal.startBlockTime).to.be.equal(lastBlock.timestamp);
  });

  it("End block time is set to the current block number plus the vote period", async () => {
    expect(trivialProposal.endBlockTime).to.be.equal(lastBlock.timestamp + 7*24*3600); 
  });

  it("ForVotes and AgainstVotes are initialized to zero", async () => {
    expect(trivialProposal.forVotes).to.be.equal(0);
    expect(trivialProposal.againstVotes).to.be.equal(0);
  });

  it("Executed and Canceled flags are initialized to false", async () => {
    expect(trivialProposal.canceled).to.be.equal(false);
    expect(trivialProposal.executed).to.be.equal(false);
  });

  it("ETA is initialized to zero", async () => {
    expect(trivialProposal.eta).to.be.equal("0");
  });

  it("Targets, Values, Signatures, Calldatas are set according to parameters", async () => {
    let dynamicFields = await governorAlpha.getActions(proposalId);

    expect(dynamicFields.targets).to.deep.equal(targets)
    expect(dynamicFields[1][0]).to.deep.equal(BigNumber.from(0))  
    expect(dynamicFields.signatures).to.deep.equal(signatures)
    expect(dynamicFields.calldatas).to.deep.equal(callDatas);
  });

  describe("This function must revert if", () => {
    it("the length of the values, signatures or calldatas arrays are not the same length,", async () => {
      await expect(governorAlpha.propose(targets.concat(other0.address), values, signatures, callDatas, "do nothing"))
              .to.be.revertedWith("revert GovernorAlpha::propose: proposal function information arity mismatch");

      await expect(governorAlpha.propose(targets, values.concat(values), signatures, callDatas, "do nothing"))
              .to.be.revertedWith("revert GovernorAlpha::propose: proposal function information arity mismatch");

      await expect(governorAlpha.propose(targets, values, signatures.concat(signatures), callDatas, "do nothing"))
              .to.be.revertedWith("revert GovernorAlpha::propose: proposal function information arity mismatch");

      await expect(governorAlpha.propose(targets, values, signatures, callDatas.concat(callDatas), "do nothing"))
              .to.be.revertedWith("revert GovernorAlpha::propose: proposal function information arity mismatch");
    });

    it("or if that length is zero or greater than Max Operations.", async () => {
      await expect(governorAlpha.propose([], [], [], [], "do nothing"))
        .to.be.revertedWith("revert GovernorAlpha::propose: must provide actions");
    });

    describe("Additionally, if there exists a pending or active proposal from the same proposer, we must revert.", () => {
      it("reverts with pending", async () => {
        lastBlock = await provider.getBlock('latest') 
        await mineBlock(provider, lastBlock.timestamp -1) 
        await expect(governorAlpha.propose(targets, values, signatures, callDatas, "do nothing"))
                .to.be.revertedWith("GovernorAlpha::propose: one live proposal per proposer, found an already pending proposal");
      });

      it("reverts with active", async () => {
        lastBlock = await provider.getBlock('latest') 
        await mineBlock(provider, lastBlock.timestamp + 10) 
        await mineBlock(provider, lastBlock.timestamp + 20) 

        await expect(governorAlpha.propose(targets, values, signatures, callDatas, "do nothing"))
                .to.be.revertedWith("GovernorAlpha::propose: one live proposal per proposer, found an already active proposal");
      });
    });
  });

  it("This function returns the id of the newly created proposal. # proposalId(n) = succ(proposalId(n-1))", async () => {
    await Feswa.transfer(other1.address, expandTo18Decimals(10_000_001))
    await Feswa.connect(other1).delegate(other1.address)

    lastBlock = await provider.getBlock('latest') 
    await mineBlock(provider, lastBlock.timestamp + 10) 

    await governorAlpha.connect(other1).propose(targets, values, signatures, callDatas, "yoot")
    let nextProposalId = await governorAlpha.latestProposalIds(other1.address);
  
    expect(nextProposalId).to.deep.equal(proposalId.add(1))
  });

  it("emits log with id and description", async () => {
    await Feswa.transfer(other1.address, expandTo18Decimals(10_000_001))
    await Feswa.connect(other1).delegate(other1.address)

    lastBlock = await provider.getBlock('latest') 
    await mineBlock(provider, lastBlock.timestamp + 10) 

    let response = await governorAlpha.connect(other1).propose(targets, values, signatures, callDatas, "second proposal")
    lastBlock = await provider.getBlock('latest') 

    await expect(response)    
      .to.emit(governorAlpha, 'ProposalCreated')
      .withArgs(  proposalId.add(1), other1.address, targets, values, signatures, callDatas, lastBlock.timestamp, 
                  lastBlock.timestamp + 7*24*3600, "second proposal")
  })
})