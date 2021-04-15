import chai, { expect } from 'chai'
import { BigNumber, Contract, constants, utils } from 'ethers'
import { solidity, MockProvider, createFixtureLoader, deployContract } from 'ethereum-waffle'
import { ecsign } from 'ethereumjs-util'
import { Block } from "@ethersproject/abstract-provider";

import { governanceFixture } from './shares/fixtures'
import { expandTo18Decimals, mineBlock, encodeParameters } from './shares/utils'

import FeswapByteCode from '../build/Fesw.json'

chai.use(solidity)

const TOTAL_SUPPLY = expandTo18Decimals(1_000_000_000)

const overrides = {
  gasLimit: 9999999
}

const DOMAIN_TYPEHASH = utils.keccak256(
  utils.toUtf8Bytes('EIP712Domain(string name,uint256 chainId,address verifyingContract)')
)

const PERMIT_TYPEHASH = utils.keccak256(
  utils.toUtf8Bytes('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)')
)

describe('Feswap', () => {
  const provider = new MockProvider({
    ganacheOptions: {
      hardfork: 'istanbul',
      mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
      gasLimit: 9999999,
    },
  })
  const [wallet, other0, other1] = provider.getWallets()
  const loadFixture = createFixtureLoader([wallet], provider)

  let Feswa: Contract
  let timelock: Contract
  let governorAlpha: Contract
  let proposalId: BigNumber
  let lastBlock: Block

  beforeEach(async () => {
    const fixture = await loadFixture(governanceFixture)
    Feswa = fixture.Feswa;
    timelock = fixture.timelock
    governorAlpha = fixture.governorAlpha
  })

  it('name, symbol, decimals, totalSupply, balanceOf, nonces, DOMAIN_SEPARATOR, PERMIT_TYPEHASH', async () => {
    const name = await Feswa.name()
    expect(name).to.eq('FeSwap DAO')
    expect(await Feswa.symbol()).to.eq('FESW')
    expect(await Feswa.decimals()).to.eq(18)
    expect(await Feswa.totalSupply()).to.eq(TOTAL_SUPPLY)
    expect(await Feswa.balanceOf(wallet.address)).to.eq(TOTAL_SUPPLY)
    expect(await Feswa.nonces(wallet.address)).to.eq(BigNumber.from(0))
    expect(await Feswa.minimumTimeBetweenMints()).to.eq(BigNumber.from(365*24*3600))
    expect(await Feswa.mintCap()).to.eq(BigNumber.from(10_000_000))
    expect(await Feswa.DOMAIN_TYPEHASH()).to.eq(
      utils.keccak256(utils.toUtf8Bytes('EIP712Domain(string name,uint256 chainId,address verifyingContract)'))
    )
    expect(await Feswa.DELEGATION_TYPEHASH()).to.eq(
      utils.keccak256(utils.toUtf8Bytes('Delegation(address delegatee,uint256 nonce,uint256 expiry)'))
    )
    expect(await Feswa.PERMIT_TYPEHASH()).to.eq(
      utils.keccak256(utils.toUtf8Bytes('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)'))
    )
  })

  it('setMinter', async () => {
    expect(await Feswa.minter()).to.eq(timelock.address)
    await expect(Feswa.setMinter(other0.address)).to.be.revertedWith('FESW::setMinter: only the minter can change the minter address')

    // Preprar the proposal, throuth the proposal to change the Minter.
    // In this way, also check governance mechanism 
    const targets = [Feswa.address];
    const values = ["0"];
    const signatures = ["setMinter(address)"];
    const callDatas = [encodeParameters(['address'], [other0.address])];
  
    await Feswa.delegate(wallet.address);
    await governorAlpha.propose(targets, values, signatures, callDatas, "setMinter to other0");
    proposalId = await governorAlpha.latestProposalIds(wallet.address);

    // increase the block number to prepare for casting vote
    lastBlock = await provider.getBlock('latest')
    await mineBlock(provider, lastBlock.timestamp + 10)

    await governorAlpha.castVote(proposalId, true, overrides);
 
//    does not work for ganache provider    
//    await advanceBlocks(provider, 40_320)
    //  Need to ine 6 blocks to queue the proposal (castVote mine one block automatically)
    await mineBlock(provider, lastBlock.timestamp + 20)
    await mineBlock(provider, lastBlock.timestamp + 30)
    await expect(governorAlpha.queue(proposalId, overrides))
          .to.be.revertedWith('GovernorAlpha::queue: proposal can only be queued if it is succeeded')

    await mineBlock(provider, lastBlock.timestamp + 40)
    await mineBlock(provider, lastBlock.timestamp + 50)
    await governorAlpha.queue(proposalId, overrides)

    // Simutate time daly (2 days) to execute proposal
    lastBlock = await provider.getBlock('latest') 
    await mineBlock(provider, lastBlock.timestamp + 3600 * 24)
    
    await expect(governorAlpha.execute(proposalId, overrides))
          .to.be.revertedWith('Timelock::executeTransaction: Transaction hasn\'t surpassed time lock.')

    lastBlock = await provider.getBlock('latest') 
    await mineBlock(provider, lastBlock.timestamp + 3600 * 24)
 
    await governorAlpha.execute(proposalId, overrides)
    expect(await Feswa.minter()).to.eq(other0.address)
  })
  
  it('permit', async () => {
    const domainSeparator = utils.keccak256(
      utils.defaultAbiCoder.encode(
        ['bytes32', 'bytes32', 'uint256', 'address'],
        [DOMAIN_TYPEHASH, utils.keccak256(utils.toUtf8Bytes('FeSwap Token')), 1, Feswa.address]
      )
    )

    const owner = wallet.address
    const spender = other0.address
    const value = 123456
    const nonce = await Feswa.nonces(wallet.address)
    const deadline = constants.MaxUint256
    const digest = utils.keccak256(
      utils.solidityPack(
        ['bytes1', 'bytes1', 'bytes32', 'bytes32'],
        [
          '0x19',
          '0x01',
          domainSeparator,
          utils.keccak256(
            utils.defaultAbiCoder.encode(
              ['bytes32', 'address', 'address', 'uint256', 'uint256', 'uint256'],
              [PERMIT_TYPEHASH, owner, spender, value, nonce, deadline]
            )
          ),
        ]
      )
    )

    const { v, r, s } = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(wallet.privateKey.slice(2), 'hex'))

    await Feswa.permit(owner, spender, value, deadline, v, utils.hexlify(r), utils.hexlify(s), overrides)

    expect(await Feswa.allowance(owner, spender)).to.eq(value)
    expect(await Feswa.nonces(owner)).to.eq(1)

    await Feswa.connect(other0).transferFrom(owner, spender, value)
  })

  it('nested delegation', async () => {
    await Feswa.transfer(other0.address, expandTo18Decimals(1))
    await Feswa.transfer(other1.address, expandTo18Decimals(2))

    let currectVotes0 = await Feswa.getCurrentVotes(other0.address)
    let currectVotes1 = await Feswa.getCurrentVotes(other1.address)
    expect(currectVotes0).to.be.eq(0)
    expect(currectVotes1).to.be.eq(0)

    await Feswa.connect(other0).delegate(other1.address)
    currectVotes1 = await Feswa.getCurrentVotes(other1.address)
    expect(currectVotes1).to.be.eq(expandTo18Decimals(1))

    await Feswa.connect(other1).delegate(other1.address)
    currectVotes1 = await Feswa.getCurrentVotes(other1.address)
    expect(currectVotes1).to.be.eq(expandTo18Decimals(1).add(expandTo18Decimals(2)))

    await Feswa.connect(other1).delegate(other0.address)
    currectVotes1 = await Feswa.getCurrentVotes(other1.address)
    expect(currectVotes1).to.be.eq(expandTo18Decimals(1))

    currectVotes0 = await Feswa.getCurrentVotes(other0.address)
    expect(currectVotes0).to.be.eq(expandTo18Decimals(2))

  })

  it('mints', async () => {
    const { timestamp: now } = await provider.getBlock('latest')
    const Feswa = await deployContract(wallet, FeswapByteCode, [wallet.address, wallet.address, now + 60 * 60])
    const supply = await Feswa.totalSupply()

    await expect(Feswa.mint(wallet.address, 1)).to.be.revertedWith('FESW::mint: minting not allowed yet')

    let timestamp = BigNumber.from(now + 60*60)
    await mineBlock(provider, timestamp.toNumber())

    await expect(Feswa.connect(other1).mint(other1.address, 1)).to.be.revertedWith('FESW::mint: only the minter can mint')
    await expect(Feswa.mint('0x0000000000000000000000000000000000000000', 1)).to.be.revertedWith('FESW::mint: cannot transfer to the zero address')

    // can mint up to 2%
    const mintCap = BigNumber.from(await Feswa.mintCap())
    await Feswa.mint(wallet.address, mintCap)
    expect(await Feswa.balanceOf(wallet.address)).to.be.eq(supply.add(mintCap))

    lastBlock = await provider.getBlock('latest')
    expect(await Feswa.mintingAllowedAfter()).to.be.eq(lastBlock.timestamp + 365*24*3600)

    timestamp = await Feswa.mintingAllowedAfter()
    await mineBlock(provider, timestamp.toNumber())

    // cannot mint more than 1000_000
    await expect(Feswa.mint(wallet.address, mintCap.add(1))).to.be.revertedWith('FESW::mint: exceeded mint cap')
  })
})
