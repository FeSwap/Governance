import chai, { expect } from 'chai'
import { BigNumber, Contract, constants, utils } from 'ethers'
import { solidity, MockProvider, createFixtureLoader, deployContract } from 'ethereum-waffle'
import { ecsign } from 'ethereumjs-util'
import { Block } from "@ethersproject/abstract-provider";

import { sponsorFixture } from './shares/fixtures'
import { expandTo18Decimals, mineBlock, encodeParameters } from './shares/utils'

import FeswapByteCode from '../build/Fesw.json'

chai.use(solidity)

const RAISING_TARGET = expandTo18Decimals(1_000)
const RAISING_CAP = expandTo18Decimals(1_001)
const ETHOne = expandTo18Decimals(1)
const ETH100 = expandTo18Decimals(100)

const overrides = {
  gasLimit: 9999999
}

function getGiveRate(nETH: number): BigNumber {
  return BigNumber.from(100_000).sub(BigNumber.from(nETH).mul(20))
}

describe('FeswapSponsor', () => {
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
  let sponsorContract: Contract


  beforeEach(async () => {
    const fixture = await loadFixture(sponsorFixture)
    Feswa = fixture.Feswa;
    timelock = fixture.timelock
    governorAlpha = fixture.governorAlpha
    sponsorContract = fixture.sponsor
  })

  it('Sponsor contract basic checking', async () => {
    expect(await sponsorContract.TARGET_RAISING_ETH()).to.eq(RAISING_TARGET)
    expect(await sponsorContract.CAP_RAISING_ETH()).to.eq(RAISING_CAP)
    expect(await sponsorContract.INITIAL_FESW_RATE_PER_ETH()).to.eq(100_000)
    expect(await sponsorContract.FESW_CHANGE_RATE_VERSUS_ETH()).to.eq(20)
    expect(await sponsorContract.SPONSOR_DURATION()).to.eq(30*24*60*60)
    expect(await sponsorContract.FeswapToken()).to.eq(Feswa.address)
    expect(await sponsorContract.FeswapFund()).to.eq(wallet.address)
    expect(await sponsorContract.FeswapBurner()).to.eq(timelock.address)
    expect(await Feswa.balanceOf(sponsorContract.address)).to.eq(expandTo18Decimals(100_000_000))
  })


  it('Raising Sponsor ', async () => {
    let TotalSponsor = BigNumber.from(0)
    let feswOther0: BigNumber
    let feswOther1: BigNumber
    let giveRate: BigNumber

    // 1. Check sponsor start time 
    // 1. Check sponsor start time 
    await expect(sponsorContract.Sponsor(other0.address, { ...overrides, value: ETHOne } ))
            .to.be.revertedWith('FESW: SPONSOR NOT STARTED')

    // Skip to start time          
    let lastBlock  = await provider.getBlock('latest')
    await mineBlock(provider, lastBlock.timestamp + 60 * 60)       
    const {timestamp: startTime}  = await provider.getBlock('latest')
    giveRate = getGiveRate(0)
        
    // 2. Normal sponsor: 1ETH
    await expect(sponsorContract.Sponsor(other0.address, { ...overrides, value: ETHOne } ))
            .to.emit(sponsorContract,'EvtSponsorReceived')
            .withArgs(wallet.address, other0.address, ETHOne)
    feswOther0 = ETHOne.mul(giveRate)
    TotalSponsor = TotalSponsor.add(ETHOne)        
    expect(await Feswa.balanceOf(other0.address)).to.eq(feswOther0)

    
    // keep same time to simulate the same block
    await mineBlock(provider, startTime - 1)
    await expect(sponsorContract.Sponsor(other1.address, { ...overrides, value: ETH100 } ))
            .to.emit(sponsorContract,'EvtSponsorReceived')
            .withArgs(wallet.address, other1.address, ETH100)

    // 3. Same rate in the same block for two sponsors        
    feswOther1 = ETH100.mul(giveRate)
    TotalSponsor = TotalSponsor.add(ETH100)    
    expect(await sponsorContract.CurrentGiveRate()).to.eq(giveRate)            
    expect(await Feswa.balanceOf(other1.address)).to.eq(feswOther1)

    // 4. Skip the block timestamp, and check the rate
    giveRate = getGiveRate(TotalSponsor.div(ETHOne).toNumber())
    await mineBlock(provider, startTime + 10)
    await expect(sponsorContract.connect(other0).Sponsor(other0.address, { ...overrides, value: ETHOne } ))
            .to.emit(sponsorContract,'EvtSponsorReceived')
            .withArgs(other0.address, other0.address, ETHOne)
    TotalSponsor = TotalSponsor.add(ETHOne)            
    
    // Revert time to simulate same block        
    await mineBlock(provider, startTime + 9)
    await expect(sponsorContract.connect(other1).Sponsor(other1.address, { ...overrides, value: ETH100 } ))
            .to.emit(sponsorContract,'EvtSponsorReceived')
            .withArgs(other1.address, other1.address, ETH100)
    TotalSponsor = TotalSponsor.add(ETH100)                  

    // 5. Check the rate
    expect(await sponsorContract.CurrentGiveRate()).to.eq(giveRate)    
    feswOther0 = feswOther0.add(ETHOne.mul(giveRate))    
    feswOther1 = feswOther1.add(ETH100.mul(giveRate))    
    expect(await Feswa.balanceOf(other0.address)).to.eq(feswOther0)
    expect(await Feswa.balanceOf(other1.address)).to.eq(feswOther1)
 
    // 6. Continue to sponsor to 992 ETH: 790ETH
    giveRate = getGiveRate(TotalSponsor.div(ETHOne).toNumber())
    await mineBlock(provider, startTime + 20)
    await expect(sponsorContract.connect(other0).Sponsor(other0.address, { ...overrides, value: ETHOne.mul(790) } ))
            .to.emit(sponsorContract,'EvtSponsorReceived')
            .withArgs(other0.address, other0.address, ETHOne.mul(790))
    TotalSponsor = TotalSponsor.add(ETHOne.mul(790))   

    feswOther0 = feswOther0.add(ETHOne.mul(790).mul(giveRate))    
    expect(await Feswa.balanceOf(other0.address)).to.eq(feswOther0)   
    expect(await sponsorContract.TotalETHReceived()).to.eq(TotalSponsor)    
    
    // 7. Continue to sponsor to 1012 ETH by sponsoring 20ETH, 11ETH are returned
    giveRate = getGiveRate(TotalSponsor.div(ETHOne).toNumber())
    await mineBlock(provider, startTime + 30)
    await expect(sponsorContract.connect(other1).Sponsor(other1.address, { ...overrides, value: ETHOne.mul(20) } ))
            .to.emit(sponsorContract,'EvtSponsorReceived')
            .withArgs(other1.address, other1.address, ETHOne.mul(9))
    TotalSponsor = TotalSponsor.add(ETHOne.mul(9))   

    feswOther1 = feswOther1.add(ETHOne.mul(9).mul(giveRate))    
    expect(await Feswa.balanceOf(other1.address)).to.eq(feswOther1)   
    expect(await sponsorContract.TotalETHReceived()).to.eq(TotalSponsor)   

    // 9. Check ETH balance  
    expect(await provider.getBalance(sponsorContract.address)).to.eq(TotalSponsor)   
    
    // 10. Continue to sponsor: reverted 
    await mineBlock(provider, startTime + 40)
    await expect(sponsorContract.connect(other0).Sponsor(other0.address, { ...overrides, value: ETHOne} ))
            .to.be.revertedWith('FESW: SPONSOR COMPLETED')

    // 11. Check sponsor end time 
    lastBlock = await provider.getBlock('latest')
    await mineBlock(provider, startTime + 30*24*3600)
    await expect(sponsorContract.Sponsor(other0.address, { ...overrides, value: ETHOne } ))
            .to.be.revertedWith('FESW: SPONSOR ENDED')

  })



/*  
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

    await Feswa.permit(owner, spender, value, deadline, v, utils.hexlify(r), utils.hexlify(s), overrides)

    expect(await Feswa.allowance(owner, spender)).to.eq(value)
    expect(await Feswa.nonces(owner)).to.eq(1)

    await Feswa.connect(other0).transferFrom(owner, spender, value)
  })

*/  

/*
  it('nested delegation', async () => {
    await Feswa.transfer(other0.address, expandTo18Decimals(1))
    await Feswa.transfer(other1.address, expandTo18Decimals(2))

    let currentVotes0 = await Feswa.getCurrentVotes(other0.address)
    let currentVotes1 = await Feswa.getCurrentVotes(other1.address)
    expect(currentVotes0).to.be.eq(0)
    expect(currentVotes1).to.be.eq(0)

    await Feswa.connect(other0).delegate(other1.address)
    currentVotes1 = await Feswa.getCurrentVotes(other1.address)
    expect(currentVotes1).to.be.eq(expandTo18Decimals(1))

    await Feswa.connect(other1).delegate(other1.address)
    currentVotes1 = await Feswa.getCurrentVotes(other1.address)
    expect(currentVotes1).to.be.eq(expandTo18Decimals(1).add(expandTo18Decimals(2)))

    await Feswa.connect(other1).delegate(other0.address)
    currentVotes1 = await Feswa.getCurrentVotes(other1.address)
    expect(currentVotes1).to.be.eq(expandTo18Decimals(1))

    currentVotes0 = await Feswa.getCurrentVotes(other0.address)
    expect(currentVotes0).to.be.eq(expandTo18Decimals(2))

  })
*/

/*
  it('mints', async () => {
    const { timestamp: now } = await provider.getBlock('latest')
    const Feswa = await deployContract(wallet, FeswapByteCode, [wallet.address, wallet.address, now + 60 * 60])
    const supply = await Feswa.totalSupply()

    await expect(Feswa.mint(wallet.address, 1))
            .to.be.revertedWith('FESW::mint: minting not allowed yet')

    let timestamp = BigNumber.from(now + 60*60)
    await mineBlock(provider, timestamp.toNumber())

    await expect(Feswa.connect(other1).mint(other1.address, 1))
            .to.be.revertedWith('FESW::mint: only the minter can mint')

    await expect(Feswa.mint('0x0000000000000000000000000000000000000000', 1))
            .to.be.revertedWith('FESW::mint: cannot transfer to the zero address')

    // can mint up to 10_000_000
    const mintCap = BigNumber.from(await Feswa.mintCap())
    await Feswa.mint(wallet.address, mintCap)
    expect(await Feswa.balanceOf(wallet.address)).to.be.eq(supply.add(mintCap))

    lastBlock = await provider.getBlock('latest')
    expect(await Feswa.mintingAllowedAfter()).to.be.eq(lastBlock.timestamp + 365*24*3600)

    timestamp = await Feswa.mintingAllowedAfter()
    await mineBlock(provider, timestamp.toNumber())

    // cannot mint more than 10_000_000
    await expect(Feswa.mint(wallet.address, mintCap.add(1)))
            .to.be.revertedWith('FESW::mint: exceeded mint cap')
  })
*/

})
