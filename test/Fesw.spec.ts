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
  let feswGovernor: Contract
  let proposalId: BigNumber
  let lastBlock: Block

  beforeEach(async () => {
    const fixture = await loadFixture(governanceFixture)
    Feswa = fixture.Feswa;
    timelock = fixture.timelock
    feswGovernor = fixture.feswGovernor
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
    expect(await Feswa.mintCap()).to.eq(expandTo18Decimals(10_000_000))
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

  it('setMinterBurner', async () => {
    // check miner is set to TimeLock contract
    expect(await Feswa.minterBurner()).to.eq(timelock.address)

    // SetMiner can only be called by TimeLock
    await expect(Feswa.setMinterBurner(other0.address))
            .to.be.revertedWith('FESW::setMinter: only the minter can change the minter address')

    // Prepare the proposal, through the proposal to change the Minter.
    // In this way, also check governance mechanism 
    const targets = [Feswa.address];
    const values = ["0"];
    const signatures = ["setMinterBurner(address)"];
    const callDatas = [encodeParameters(['address'], [other0.address])];

    // only the initial account need to delegate to itself
    await Feswa.delegate(wallet.address);
    await feswGovernor.propose(targets, values, signatures, callDatas, "setMinter to other0");
    proposalId = await feswGovernor.latestProposalIds(wallet.address);

    // increase the block number to prepare for casting vote
    lastBlock = await provider.getBlock('latest')
    await mineBlock(provider, lastBlock.timestamp + 10)

    await feswGovernor.castVote(proposalId, true, overrides);
 
    //  Need to increase 7*24*3600 seconds to queue the proposal 
    await mineBlock(provider, lastBlock.timestamp + 20)
    await expect(feswGovernor.queue(proposalId, overrides))
          .to.be.revertedWith('FeswGovernor::queue: proposal can only be queued if it is succeeded')

    await mineBlock(provider, lastBlock.timestamp +  7*24*3600 + 1)
    await feswGovernor.queue(proposalId, overrides)

    // Simutate time daly (2 days) to execute proposal
    lastBlock = await provider.getBlock('latest') 
    await mineBlock(provider, lastBlock.timestamp + 3600 * 24)
    
    await expect(feswGovernor.execute(proposalId, overrides))
          .to.be.revertedWith('Timelock::executeTransaction: Transaction hasn\'t surpassed time lock.')

    lastBlock = await provider.getBlock('latest') 
    await mineBlock(provider, lastBlock.timestamp + 3600 * 24)
 
    await feswGovernor.execute(proposalId, overrides)
    expect(await Feswa.minterBurner()).to.eq(other0.address)
  
  })
  
  it('permit', async () => {
    const domainSeparator = utils.keccak256(
      utils.defaultAbiCoder.encode(
        ['bytes32', 'bytes32', 'uint256', 'address'],
        [DOMAIN_TYPEHASH, utils.keccak256(utils.toUtf8Bytes('FeSwap DAO')), 1, Feswa.address]
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

    // cannot mint more than 1000_000
    await expect(Feswa.connect(other0).transferFrom(owner, spender, value))
            .to.be.revertedWith('FESW::transferFrom: transfer amount exceeds spender allowance')

    await expect(Feswa.permit(other1.address, spender, value, deadline, v, utils.hexlify(r), utils.hexlify(s), overrides))
            .to.be.revertedWith('FESW::permit: unauthorized')    

    await Feswa.permit(owner, spender, value, deadline, v, utils.hexlify(r), utils.hexlify(s), overrides)

    expect(await Feswa.allowance(owner, spender)).to.eq(value)
    expect(await Feswa.nonces(owner)).to.eq(1)

    await Feswa.connect(other0).transferFrom(owner, spender, value)
  })


  it('Transfer/TransferFrom gas fee', async () => {
    // initial supply has no vote rights by default
    expect(await Feswa.getCurrentVotes(wallet.address)).to.be.eq(expandTo18Decimals(0)) 

    let tx = await Feswa.transfer(other0.address, expandTo18Decimals(200))
    let currentVotes0 = await Feswa.getCurrentVotes(other0.address)
    expect(currentVotes0).to.be.eq(expandTo18Decimals(0))
    let receipt = await tx.wait()   
    expect(receipt.gasUsed).to.eq(55100)       

    tx = await Feswa.connect(other0).transfer(other1.address, expandTo18Decimals(50))
    let currentVotes1 = await Feswa.getCurrentVotes(other1.address)
    expect(currentVotes1).to.be.eq(expandTo18Decimals(0))
    receipt = await tx.wait()   
    expect(receipt.gasUsed).to.eq(55100)        
  })

  it('nested delegation', async () => {
    await Feswa.transfer(other0.address, expandTo18Decimals(1))
    await Feswa.transfer(other1.address, expandTo18Decimals(2))

    let currentVotes0 = await Feswa.getCurrentVotes(other0.address)
    let currentVotes1 = await Feswa.getCurrentVotes(other1.address)
    expect(currentVotes0).to.be.eq(expandTo18Decimals(0))
    expect(currentVotes1).to.be.eq(expandTo18Decimals(0))

    let tx = await Feswa.connect(other0).delegate(other1.address)
    let receipt = await tx.wait()   
    expect(receipt.gasUsed).to.eq(90922)  

    currentVotes1 = await Feswa.getCurrentVotes(other1.address)
    expect(currentVotes1).to.be.eq(expandTo18Decimals(1))

    await Feswa.connect(other1).delegate(other1.address)
    currentVotes1 = await Feswa.getCurrentVotes(other1.address)
    expect(currentVotes1).to.be.eq(expandTo18Decimals(1).add(expandTo18Decimals(2)))

    // only can delegate the part corresponding to balance oneself
    await Feswa.connect(other1).delegate(other0.address)
    currentVotes1 = await Feswa.getCurrentVotes(other1.address)
    expect(currentVotes1).to.be.eq(expandTo18Decimals(1))

    currentVotes0 = await Feswa.getCurrentVotes(other0.address)
    expect(currentVotes0).to.be.eq(expandTo18Decimals(2))
  })

  it('mints', async () => {
    const { timestamp: now } = await provider.getBlock('latest')
    const Feswa = await deployContract(wallet, FeswapByteCode, [wallet.address, other0.address, now + 60 * 60])
    const feswSupply = await Feswa.totalSupply()

    await expect(Feswa.connect(other0).mint(wallet.address, 1))
            .to.be.revertedWith('FESW::mint: minting not allowed yet')

    let timestamp = BigNumber.from(now + 60*60)
    await mineBlock(provider, timestamp.toNumber())

    await expect(Feswa.connect(other1).mint(other1.address, 1))
            .to.be.revertedWith('FESW::mint: only the minter can mint')

    await expect(Feswa.connect(other0).mint(constants.AddressZero, 1))
            .to.be.revertedWith('FESW::mint: cannot transfer to the zero address')

    // can mint up to 10_000_000
    const mintCap = BigNumber.from(await Feswa.mintCap())
    await Feswa.connect(other0).mint(other1.address, mintCap)

    expect(await Feswa.balanceOf(other1.address)).to.be.eq(mintCap)
    expect(await Feswa.getCurrentVotes(other1.address)).to.be.eq(0)
    expect(await Feswa.totalSupply()).to.be.eq(feswSupply.add(mintCap))
   
    lastBlock = await provider.getBlock('latest')
    expect(await Feswa.mintingAllowedAfter()).to.be.eq(lastBlock.timestamp + 365*24*3600)

    await expect(Feswa.connect(other0).mint(other1.address, 1))
            .to.be.revertedWith('FESW::mint: minting not allowed yet')

    // skip to next minting-available time 
    timestamp = await Feswa.mintingAllowedAfter()
    await mineBlock(provider, timestamp.toNumber())

    // cannot mint more than 10_000_000
    await expect(Feswa.connect(other0).mint(wallet.address, mintCap.add(1)))
            .to.be.revertedWith('FESW::mint: exceeded mint cap')

  })

  it('burn', async () => {
    const { timestamp: now } = await provider.getBlock('latest')
    const Feswa = await deployContract(wallet, FeswapByteCode, [wallet.address, other0.address, now + 60 * 60])

    await expect(Feswa.connect(other1).burn())
            .to.be.revertedWith('FESW::burn: Only the burner can burn')

    await expect(Feswa.connect(other0).burn())
            .to.be.revertedWith(' FESW::burn: No FESW token to burn')

    // prepare to burn 1000 FESW     
    await Feswa.transfer(other1.address, expandTo18Decimals(1000))
    await Feswa.connect(other1).delegate(other1.address)
    let currentVotes1 = await Feswa.getCurrentVotes(other1.address)
    expect(currentVotes1).to.be.eq(expandTo18Decimals(1000))   
    
    await Feswa.connect(other1).transfer(other0.address, expandTo18Decimals(300))

    // default to no vote right to save gas fee for transfer
    currentVotes1 = await Feswa.getCurrentVotes(other1.address)
    expect(currentVotes1).to.be.eq(expandTo18Decimals(700)) 
    let currentVotes = await Feswa.getCurrentVotes(other0.address)
    expect(currentVotes).to.be.eq(expandTo18Decimals(0))

    let totalSupply:BigNumber = await Feswa.totalSupply()
    expect(totalSupply).to.be.eq(expandTo18Decimals(1_000_000_000))

    await expect(Feswa.connect(other0).burn(overrides))
            .to.emit(Feswa,'Transfer')
            .withArgs(other0.address, constants.AddressZero, expandTo18Decimals(300))

    // check balance, vote, and total supply         
    expect(await Feswa.balanceOf(other0.address)).to.be.eq(expandTo18Decimals(0))  
    expect(await Feswa.getCurrentVotes(other0.address)).to.be.eq(expandTo18Decimals(0))  
    expect(await Feswa.totalSupply()).to.be.eq(totalSupply.sub(expandTo18Decimals(300)))  

  })

})

