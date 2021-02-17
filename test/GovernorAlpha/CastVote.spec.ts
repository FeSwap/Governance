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

//const DOMAIN_TYPEHASH = utils.keccak256(
//  utils.toUtf8Bytes('EIP712Domain(string name,uint256 chainId,address verifyingContract)')
//)

//const BALLOT_TYPEHASH = utils.keccak256(
//  utils.toUtf8Bytes('Ballot(uint256 proposalId,bool support)')
//)

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

//    await enfranchise(other0, 50)
    await Feswa.delegate(wallet.address);
    await governorAlpha.propose(targets, values, signatures, callDatas, "do nothing");
    proposalId = await governorAlpha.latestProposalIds(wallet.address);
    lastBlock = await provider.getBlock('latest')
  })

  async function enfranchise(actor: Wallet, amount: number) {
    await Feswa.transfer(actor.address, expandTo18Decimals(amount));
    await Feswa.connect(actor).delegate(actor.address);
  }

  /*
  it("Voting block number should be between the proposal's start block (exclusive) and end block (inclusive)", async () => {
    //Voting block number should be between the proposal's start block (exclusive) and end block (inclusive)
//    lastBlock = await provider.getBlock('latest') ; console.log("lastBlockAAAA", lastBlock)
    await expect(governorAlpha.castVote(proposalId, true)).to.be.revertedWith('GovernorAlpha::_castVote: voting is closed')
   })

   */

  it("Such proposal already has an entry in its voters set matching the sender", async () => {
    let timestamp = lastBlock.timestamp
    await mineBlock(provider, timestamp + 10)
    await mineBlock(provider, timestamp + 20)

    await governorAlpha.connect(other0).castVote(proposalId, true);

    //cannot vote twice
    await expect(governorAlpha.connect(other0).castVote(proposalId, true))
          .to.be.revertedWith('GovernorAlpha::_castVote: voter already voted')
  });

  it("we add the sender to the proposal's voters set", async () => {
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
  });

  describe("Check the balance returned by GetPriorVotes", () => {

    it("Check ForVotes balance", async () => {

      await enfranchise(other1, 40_000_001)
      await governorAlpha.connect(other1).propose(targets, values, signatures, callDatas, "do nothing");
      proposalId = await governorAlpha.latestProposalIds(other1.address);
      lastBlock = await provider.getBlock('latest')

      let beforeFors = await governorAlpha.proposals(proposalId)

      lastBlock = await provider.getBlock('latest')
      await mineBlock(provider, lastBlock.timestamp + 10)

      await governorAlpha.connect(other1).castVote(proposalId, true);
      let afterFors = await governorAlpha.proposals(proposalId)

      expect(afterFors.forVotes).to.be.equal(beforeFors.forVotes.add(expandTo18Decimals(40_000_001)))

    })

    it("Check AgainstVotes balance", async () => {

      await enfranchise(other1, 40_000_001)
      await governorAlpha.connect(other1).propose(targets, values, signatures, callDatas, "do nothing");
      proposalId = await governorAlpha.latestProposalIds(other1.address);
      lastBlock = await provider.getBlock('latest')

      let beforeFors = await governorAlpha.proposals(proposalId)

      lastBlock = await provider.getBlock('latest')
      await mineBlock(provider, lastBlock.timestamp + 10)

      await governorAlpha.connect(other1).castVote(proposalId, false);

      let afterFors = await governorAlpha.proposals(proposalId)
      expect(afterFors.againstVotes).to.be.equal(beforeFors.againstVotes.add(expandTo18Decimals(40_000_001)))

    });
  });

  describe('castVoteBySig', () => {
 
    it('reverts if the signatory is invalid', async () => {
      lastBlock = await provider.getBlock('latest')
      await mineBlock(provider, lastBlock.timestamp + 10)
      await expect(governorAlpha.castVoteBySig(proposalId, false, 0x00, BALLOT_TYPEHASH, BALLOT_TYPEHASH))
            .to.be.revertedWith("GovernorAlpha::castVoteBySig: invalid signature");
    });

    it('casts vote on behalf of the signatory', async () => {

      await enfranchise(other1, 40_000_001)
      await governorAlpha.connect(other1).propose(targets, values, signatures, callDatas, "do nothing");
      proposalId = await governorAlpha.latestProposalIds(other1.address);

      const domainSeparator = utils.keccak256(
        utils.defaultAbiCoder.encode(
          ['bytes32', 'bytes32', 'uint256', 'address'],
          [DOMAIN_TYPEHASH, utils.keccak256(utils.toUtf8Bytes('Feswap Governor Alpha')), 1, governorAlpha.address]
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
  
      let beforeFors = await governorAlpha.proposals(proposalId)

      lastBlock = await provider.getBlock('latest')
      await mineBlock(provider, lastBlock.timestamp + 10)

      const castVoteBySigTrx = await governorAlpha.castVoteBySig(proposalId, true, v, r, s)

      const receipt = await castVoteBySigTrx.wait()
      expect(receipt.gasUsed).to.lt(85000)    

      let afterFors = await governorAlpha.proposals(proposalId)
      expect(afterFors.forVotes).to.be.equal(beforeFors.forVotes.add(expandTo18Decimals(40_000_001)))

    });
  });

//  it("receipt uses one load", async () => {
//    await enfranchise(other0, 40_000_001)
//    await enfranchise(other1, 40_000_001)    
//    await governorAlpha.connect(other0).propose(targets, values, signatures, callDatas, "do nothing");
//    proposalId = await governorAlpha.latestProposalIds(other0.address);

//    lastBlock = await provider.getBlock('latest')
//    await mineBlock(provider, lastBlock.timestamp + 10)
//    await mineBlock(provider, lastBlock.timestamp + 20)

//    const castVoteTrx0 = await governorAlpha.connect(other0).castVote(proposalId, true);
//    const castVote0Receipt = await castVoteTrx0.wait()
//    const castVoteTrx1 = await governorAlpha.connect(other1).castVote(proposalId, false);    
//    const castVote1Receipt = await castVoteTrx1.wait()

//    console.log(castVoteTrx0, castVote0Receipt)
//    console.log(castVoteTrx1, castVote1Receipt)  
//  })


//    let afterFors = await governorAlpha.proposals(proposalId)
//    const receipt = await castVoteBySigTrx.wait()
//    expect(receipt.gasUsed).to.lt(85000)    

//    let actor = accounts[2];e:

//    let actor2 = accounts[3];
//    await enfranchise(comp, actor, 400001);
//    await enfranchise(comp, actor2, 400001);
//    await send(gov, 'propose', [targets, values, signatures, callDatas, "do nothing"], { from: actor });
//    proposalId = await call(gov, 'latestProposalIds', [actor]);

//    await mineBlock();
//    await mineBlock();
//    await send(gov, 'castVote', [proposalId, true], { from: actor });
//    await send(gov, 'castVote', [proposalId, false], { from: actor2 });

//    let trxReceipt = await send(gov, 'getReceipt', [proposalId, actor]);
//    let trxReceipt2 = await send(gov, 'getReceipt', [proposalId, actor2]);

/*
    await saddle.trace(trxReceipt, {
      constants: {
        "account": actor
      },
      preFilter: ({op}) => op === 'SLOAD',
      postFilter: ({source}) => !source || source.includes('receipts'),
      execLog: (log) => {
        let [output] = log.outputs;
        let votes = "000000000000000000000000000000000000000054b419003bdf81640000";
        let voted = "01";
        let support = "01";

        expect(output).toEqual(
          `${votes}${support}${voted}`
        );
      },
      exec: (logs) => {
        expect(logs.length).toEqual(1); // require only one read
      }
    });
*/
    /*
    await saddle.trace(trxReceipt2, {
      constants: {
        "account": actor2
      },
      preFilter: ({op}) => op === 'SLOAD',
      postFilter: ({source}) => !source || source.includes('receipts'),
      execLog: (log) => {
        let [output] = log.outputs;
        let votes = "0000000000000000000000000000000000000000a968320077bf02c80000";
        let voted = "01";
        let support = "00";

        expect(output).toEqual(
          `${votes}${support}${voted}`
        );
      }
    });
*/




  /*

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

  */

  describe("Otherwise", () => {


/*

    it("receipt uses one load", async () => {
      let actor = accounts[2];
      let actor2 = accounts[3];
      await enfranchise(comp, actor, 400001);
      await enfranchise(comp, actor2, 400001);
      await send(gov, 'propose', [targets, values, signatures, callDatas, "do nothing"], { from: actor });
      proposalId = await call(gov, 'latestProposalIds', [actor]);

      await mineBlock();
      await mineBlock();
      await send(gov, 'castVote', [proposalId, true], { from: actor });
      await send(gov, 'castVote', [proposalId, false], { from: actor2 });

      let trxReceipt = await send(gov, 'getReceipt', [proposalId, actor]);
      let trxReceipt2 = await send(gov, 'getReceipt', [proposalId, actor2]);

      await saddle.trace(trxReceipt, {
        constants: {
          "account": actor
        },
        preFilter: ({op}) => op === 'SLOAD',
        postFilter: ({source}) => !source || source.includes('receipts'),
        execLog: (log) => {
          let [output] = log.outputs;
          let votes = "000000000000000000000000000000000000000054b419003bdf81640000";
          let voted = "01";
          let support = "01";

          expect(output).toEqual(
            `${votes}${support}${voted}`
          );
        },
        exec: (logs) => {
          expect(logs.length).toEqual(1); // require only one read
        }
      });

      await saddle.trace(trxReceipt2, {
        constants: {
          "account": actor2
        },
        preFilter: ({op}) => op === 'SLOAD',
        postFilter: ({source}) => !source || source.includes('receipts'),
        execLog: (log) => {
          let [output] = log.outputs;
          let votes = "0000000000000000000000000000000000000000a968320077bf02c80000";
          let voted = "01";
          let support = "00";

          expect(output).toEqual(
            `${votes}${support}${voted}`
          );
        }
      });
    })

    */
  })

})
