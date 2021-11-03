import chai, { expect } from 'chai'
import { BigNumber, Contract, constants, utils } from 'ethers'
import { solidity, MockProvider, createFixtureLoader, deployContract } from 'ethereum-waffle'

import { sponsorFixture } from './shares/fixtures'
import { expandTo18Decimals, mineBlock, encodeParameters } from './shares/utils'

chai.use(solidity)

const RAISING_TARGET = expandTo18Decimals(1_000)
const RAISING_CAP = expandTo18Decimals(1_001)
const ETHOne = expandTo18Decimals(1)
const ETH100 = expandTo18Decimals(100)

const overrides = {
  gasLimit: 9999999,
  gasPrice: 1000
}

function getGiveRate(nETH: BigNumber): BigNumber {
  return BigNumber.from(100_000).sub(nETH.mul(20).div(ETHOne))
}

describe('FeswapSponsor', () => {
  const provider = new MockProvider({
    ganacheOptions: {
      hardfork: 'istanbul',
      mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
      gasLimit: 9999999,
      gasPrice: '1000',
      default_balance_ether: 1000,
    },
  })
  const [wallet, other0, other1] = provider.getWallets()
  const loadFixture = createFixtureLoader([wallet], provider)

  let Feswa: Contract
  let timelock: Contract
  let feswGovernor: Contract
  let sponsorContract: Contract


  beforeEach(async () => {
    const fixture = await loadFixture(sponsorFixture)
    Feswa = fixture.Feswa;
    timelock = fixture.timelock
    feswGovernor = fixture.feswGovernor
    sponsorContract = fixture.sponsor
  })

  it('Sponsor contract basic checking', async () => {
    expect(await sponsorContract.TARGET_RAISING_ETH()).to.eq(RAISING_TARGET)
    expect(await sponsorContract.MIN_GUARANTEE_ETH()).to.eq(ETHOne)
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
    await expect(sponsorContract.Sponsor(other0.address, { ...overrides, value: ETHOne } ))
            .to.be.revertedWith('FESW: SPONSOR NOT STARTED')

    // Skip to start time          
    let lastBlock  = await provider.getBlock('latest')
    await mineBlock(provider, lastBlock.timestamp + 60 * 60)       
    const {timestamp: startTime}  = await provider.getBlock('latest')
    giveRate = getGiveRate(BigNumber.from(0))
        
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
    giveRate = getGiveRate(TotalSponsor)
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
    giveRate = getGiveRate(TotalSponsor)
    await mineBlock(provider, startTime + 20)
    await expect(sponsorContract.connect(other0).Sponsor(other0.address, { ...overrides, value: ETHOne.mul(790) } ))
            .to.emit(sponsorContract,'EvtSponsorReceived')
            .withArgs(other0.address, other0.address, ETHOne.mul(790))
    TotalSponsor = TotalSponsor.add(ETHOne.mul(790))   

    feswOther0 = feswOther0.add(ETHOne.mul(790).mul(giveRate))    
    expect(await Feswa.balanceOf(other0.address)).to.eq(feswOther0)   
    expect(await sponsorContract.TotalETHReceived()).to.eq(TotalSponsor)    

    // 7. Continue to sponsor to 1012 ETH by sponsoring 20ETH, 12ETH are returned
    giveRate = getGiveRate(TotalSponsor)
    await mineBlock(provider, startTime + 30)
    await expect(sponsorContract.connect(other1).Sponsor(other1.address, { ...overrides, value: ETHOne.mul(20) } ))
            .to.emit(sponsorContract,'EvtSponsorReceived')
            .withArgs(other1.address, other1.address, ETHOne.mul(8))
    TotalSponsor = TotalSponsor.add(ETHOne.mul(8))   

    feswOther1 = feswOther1.add(ETHOne.mul(8).mul(giveRate))    
    expect(await Feswa.balanceOf(other1.address)).to.eq(feswOther1)   
    expect(await sponsorContract.TotalETHReceived()).to.eq(TotalSponsor)   

    // 9. Check ETH balance  
    expect(await provider.getBalance(sponsorContract.address)).to.eq(TotalSponsor)   
    
    // 10. Continue to sponsor: reverted, and sponsor cap reached 
    await mineBlock(provider, startTime + 40)
    await expect(sponsorContract.connect(other0).Sponsor(other0.address, { ...overrides, value: ETHOne} ))
            .to.be.revertedWith('FESW: SPONSOR COMPLETED')

    // 11. Check sponsor end time 
    lastBlock = await provider.getBlock('latest')
    await mineBlock(provider, startTime + 30*24*3600)
    await expect(sponsorContract.Sponsor(other0.address, { ...overrides, value: ETHOne } ))
            .to.be.revertedWith('FESW: SPONSOR ENDED')

    // 12. Finalize the sponsor 
    await expect(sponsorContract.finalizeSponsor())
            .to.emit(sponsorContract,'EvtSponsorFinalized')
            .withArgs(wallet.address,  ETHOne.mul(1000))

  })

    it('Raising Sponsor: Minimum 1ETH accepted for the last person', async () => {
        let TotalSponsor = BigNumber.from(0)
        let feswOther0: BigNumber
        let feswOther1: BigNumber
        let giveRate: BigNumber
    
        // Skip to start time          
        let lastBlock  = await provider.getBlock('latest')
        await mineBlock(provider, lastBlock.timestamp + 60 * 60)       
        const {timestamp: startTime}  = await provider.getBlock('latest')
        giveRate = getGiveRate(BigNumber.from(0))
            
        // 1. Normal sponsor: 500ETH
        feswOther0 = ETHOne.mul(500).mul(giveRate)
        await mineBlock(provider, startTime + 10)
        await expect(sponsorContract.connect(other0).Sponsor(other0.address, { ...overrides, value: ETHOne.mul(500) } ))
                .to.emit(Feswa,'Transfer')
                .withArgs(sponsorContract.address, other0.address, feswOther0)
                .to.emit(sponsorContract,'EvtSponsorReceived')
                .withArgs(other0.address, other0.address, ETHOne.mul(500))
        TotalSponsor = TotalSponsor.add(ETHOne.mul(500))        
        expect(await Feswa.balanceOf(other0.address)).to.eq(feswOther0)

        // 2. Normal sponsor: 499.8ETH
        giveRate = getGiveRate(TotalSponsor)
        await mineBlock(provider, startTime + 20)
        await expect(sponsorContract.connect(other1).Sponsor(other1.address, { ...overrides, value: ETHOne.mul(4998).div(10) } ))
                .to.emit(sponsorContract,'EvtSponsorReceived')
                .withArgs(other1.address, other1.address, ETHOne.mul(4998).div(10))
        feswOther1 = ETHOne.mul(4998).div(10).mul(giveRate)
        TotalSponsor = TotalSponsor.add(ETHOne.mul(4998).div(10))   
        expect(await Feswa.balanceOf(other1.address)).to.eq(feswOther1)

        // 3. Sponsor to 1.6 ETH, only 1 ETH accepted
        giveRate = getGiveRate(TotalSponsor)
        await mineBlock(provider, startTime + 30)
        await expect(sponsorContract.connect(other1).Sponsor(other1.address, { ...overrides, value: ETHOne.mul(16).div(10) } ))
                .to.emit(sponsorContract,'EvtSponsorReceived')
                .withArgs(other1.address, other1.address, ETHOne)

        feswOther1 = feswOther1.add(ETHOne.mul(giveRate))
        TotalSponsor = TotalSponsor.add(ETHOne)   

        expect(await sponsorContract.CurrentGiveRate()).to.eq(giveRate)  
        expect(await Feswa.balanceOf(other1.address)).to.eq(feswOther1)   
        expect(await sponsorContract.TotalETHReceived()).to.eq(TotalSponsor)   
       
        // 4. Continue to sponsor: reverted, and sponsor cap reached 
        await mineBlock(provider, startTime + 40)
        await expect(sponsorContract.connect(other0).Sponsor(other0.address, { ...overrides, value: ETHOne} ))
                .to.be.revertedWith('FESW: SPONSOR COMPLETED')
    
        })

        it('Raising Sponsor: last Sponor could surpass 1000ETH', async () => {
                let TotalSponsor = BigNumber.from(0)
                let feswOther0: BigNumber
                let feswOther1: BigNumber
                let giveRate: BigNumber
            
                // Skip to start time          
                let lastBlock  = await provider.getBlock('latest')
                await mineBlock(provider, lastBlock.timestamp + 60 * 60)       
                const {timestamp: startTime}  = await provider.getBlock('latest')
                giveRate = getGiveRate(BigNumber.from(0))
                    
                // 1. Normal sponsor: 500ETH
                await mineBlock(provider, startTime + 10)
                await expect(sponsorContract.connect(other0).Sponsor(other0.address, { ...overrides, value: ETHOne.mul(500) } ))
                        .to.emit(sponsorContract,'EvtSponsorReceived')
                        .withArgs(other0.address, other0.address, ETHOne.mul(500))
                feswOther0 = ETHOne.mul(500).mul(giveRate)
                TotalSponsor = TotalSponsor.add(ETHOne.mul(500))        
                expect(await Feswa.balanceOf(other0.address)).to.eq(feswOther0)
            
                // 2. Normal sponsor: 499.8ETH
                giveRate = getGiveRate(TotalSponsor)
                await mineBlock(provider, startTime + 20)
                await expect(sponsorContract.connect(other1).Sponsor(other1.address, { ...overrides, value: ETHOne.mul(4998).div(10) } ))
                        .to.emit(sponsorContract,'EvtSponsorReceived')
                        .withArgs(other1.address, other1.address, ETHOne.mul(4998).div(10))
                feswOther1 = ETHOne.mul(4998).div(10).mul(giveRate)
                TotalSponsor = TotalSponsor.add(ETHOne.mul(4998).div(10))   
                expect(await Feswa.balanceOf(other1.address)).to.eq(feswOther1)
        
                // 3. Sponsor to 1.6 ETH, only 1 ETH accepted
                giveRate = getGiveRate(TotalSponsor)
                await mineBlock(provider, startTime + 30)
                await expect(sponsorContract.connect(other1).Sponsor(other1.address, { ...overrides, value: ETHOne.mul(6).div(10) } ))
                        .to.emit(sponsorContract,'EvtSponsorReceived')
                        .withArgs(other1.address, other1.address, ETHOne.mul(6).div(10) )
                feswOther1 = feswOther1.add(ETHOne.mul(6).div(10).mul(giveRate))
                TotalSponsor = TotalSponsor.add(ETHOne.mul(6).div(10) )   
        
                expect(await sponsorContract.CurrentGiveRate()).to.eq(giveRate)  
                expect(await Feswa.balanceOf(other1.address)).to.eq(feswOther1)   
                expect(await sponsorContract.TotalETHReceived()).to.eq(TotalSponsor)   
               
                // 4. Continue to sponsor: reverted, and sponsor cap reached 
                await mineBlock(provider, startTime + 40)
                await expect(sponsorContract.connect(other0).Sponsor(other0.address, { ...overrides, value: ETHOne} ))
                        .to.be.revertedWith('FESW: SPONSOR COMPLETED')
            
        }) 
        

  it('Finalize sponsor testing: Sponor raising failed', async () => {
    // Skip to start time          
    let lastBlock  = await provider.getBlock('latest')
    await mineBlock(provider, lastBlock.timestamp + 60 * 60)       
    const {timestamp: startTime}  = await provider.getBlock('latest')
        
    // Start normal sponsor: 500ETH
    await expect(sponsorContract.connect(other0).Sponsor(other0.address, { ...overrides, value: ETHOne.mul(500) } ))
            .to.emit(sponsorContract,'EvtSponsorReceived')
            .withArgs(other0.address, other0.address, ETHOne.mul(500))

    // Normal sponsor: 200ETH
    await mineBlock(provider, startTime + 10)
    let tx = await sponsorContract.connect(other1).Sponsor(other0.address, { ...overrides, value: ETHOne.mul(200) } )
    let receipt = await tx.wait()   
    expect(receipt.gasUsed).to.eq(66680)       //  66658

    // 1. Try to finalize the sponsor while it is still on going 
    await expect(sponsorContract.finalizeSponsor())
            .to.be.revertedWith('FESW: SPONSOR ONGOING')            
    
    // skip to the end time 
    await mineBlock(provider, startTime + 30 * 24 * 3600 + 1)
      
    // 2. Only feswFund address could finalize the sponsor 
    await expect(sponsorContract.connect(other0).finalizeSponsor())
            .to.be.revertedWith('FESW: NOT ALLOWED')    
    
    // 3. Finalize the sponsor 
    let feswFundBalance = await provider.getBalance(wallet.address)
    let totalFeswLeft = await Feswa.balanceOf(sponsorContract.address)
    let FeswNumWallet = await Feswa.balanceOf(wallet.address)
    tx = await sponsorContract.finalizeSponsor()
    receipt = await tx.wait()

    // 4. Check feswFund balance
    expect(await provider.getBalance(wallet.address)).
      to.eq(feswFundBalance.add(expandTo18Decimals(700)).sub(receipt.gasUsed.mul(overrides.gasPrice)))

    // 5. Check feswFund balance, returned to feswFund address
    expect(await Feswa.balanceOf(sponsorContract.address)).to.eq(0)
    expect(await Feswa.balanceOf(wallet.address)).to.eq(FeswNumWallet.add(totalFeswLeft))

    // 6. Cannot finalize the sponsor twice 
    await expect(sponsorContract.finalizeSponsor())
            .to.be.revertedWith('FESW: SPONSOR FINALIZED')       
  })


  it('Finalize sponsor testing: Sponor raising succeed', async () => {
    // Skip to start time          
    let lastBlock  = await provider.getBlock('latest')
    await mineBlock(provider, lastBlock.timestamp + 60 * 60)       
    const {timestamp: startTime}  = await provider.getBlock('latest')
        
    // Start normal sponsor: 500ETH
    await expect(sponsorContract.Sponsor(other0.address, { ...overrides, value: ETHOne.mul(500) } ))
            .to.emit(sponsorContract,'EvtSponsorReceived')
            .withArgs(wallet.address, other0.address, ETHOne.mul(500))

    // Normal sponsor: 600ETH, sponsor target achievded, only 500 ETH accepted
    await mineBlock(provider, startTime + 10)
    await expect(sponsorContract.Sponsor(other0.address, { ...overrides, value: ETHOne.mul(600) } ))
            .to.emit(sponsorContract,'EvtSponsorReceived')
            .withArgs(wallet.address, other0.address, ETHOne.mul(500))

    // 1. Only feswFund address could finalize the sponsor 
    await expect(sponsorContract.connect(other0).finalizeSponsor())
            .to.be.revertedWith('FESW: NOT ALLOWED')    
    
    // 2. Finalize the sponsor ahead of the end time 
    let feswFundBalance0 = await provider.getBalance(wallet.address)
    let totalETHReceived = await sponsorContract.TotalETHReceived()
    let totalFeswLeft = await Feswa.balanceOf(sponsorContract.address)

    const tx = await sponsorContract.finalizeSponsor()
    const receipt = await tx.wait()

    // 3. Check feswFund balance
    expect(await provider.getBalance(wallet.address)).
      to.eq(feswFundBalance0.add(totalETHReceived).sub(receipt.gasUsed.mul(overrides.gasPrice)))

    // 4. Check feswFund balance
    expect(await Feswa.balanceOf(sponsorContract.address)).to.eq(0)
    expect(await Feswa.balanceOf(timelock.address)).to.eq(totalFeswLeft)

    // 5. Cannot finalize the sponsor twice 
    await expect(sponsorContract.finalizeSponsor())
            .to.be.revertedWith('FESW: SPONSOR FINALIZED')            
  })
})
