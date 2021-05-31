import chai, { expect } from 'chai'
import { Contract, BigNumber, constants, utils } from 'ethers'
import { solidity, MockProvider, createFixtureLoader, deployContract } from 'ethereum-waffle'

import { FeswaNFTFixture } from './shares/fixtures'
import { expandTo18Decimals, mineBlock } from './shares/utils'
import { Block } from "@ethersproject/abstract-provider";
import TestERC20 from '../build/TestERC20.json'

chai.use(solidity)

const overrides = {
  gasLimit: 9999999,
  gasPrice: 2000000000
}

enum PoolRunningPhase {
  BidToStart,
  BidPhase, 
  BidDelaying,
  BidSettled,
  PoolHolding, 
  PoolForSale
}

const initPoolPrice = expandTo18Decimals(1).div(5)
const PriceOneETH = expandTo18Decimals(1)
const BidStartTime: number = 1615338000   // 2021/02/22 03/10 9:00
const OPEN_BID_DURATION: number =  (3600 * 24 * 14)
const CLOSE_BID_DELAY: number =  (3600 * 2)

// Airdrop for the first tender: 1000 FEST
const AIRDROP_FOR_FIRST = expandTo18Decimals(1000);  

// Airdrop for the next tender: 500 FEST
const AIRDROP_FOR_NEXT = expandTo18Decimals(500);
const AIRDROP_RATE_FOR_WINNER = 20000;  

describe('FeswaNFT', () => {
  const provider = new MockProvider({
    ganacheOptions: {
      hardfork: 'istanbul',
      mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
      gasLimit: 9999999,
    },
  })
  const [wallet, other0, other1] = provider.getWallets()
  const loadFixture = createFixtureLoader([wallet, other0], provider)

  let TokenA: Contract
  let TokenB: Contract
  let Feswa: Contract
  let FeswaNFT: Contract

  beforeEach('load fixture', async () => {
    const fixture = await loadFixture(FeswaNFTFixture)
    TokenA = fixture.TokenA
    TokenB = fixture.TokenB   
    Feswa = fixture.Feswa
    FeswaNFT = fixture.FeswaNFT
  })

  /* 
  it('deployment gas', async () => {
    const receipt = await provider.getTransactionReceipt(FeswaNFT.deployTransaction.hash)
    expect(receipt.gasUsed).to.eq('3117893')          // 2080815
  })
  */

  it('BidFeswaPair: Basic Checking of Init Bit Price, Bid start Time, name, symbol, ', async () => {
    expect(await FeswaNFT.name()).to.eq('Feswap Pool NFT')
    expect(await FeswaNFT.symbol()).to.eq('FESN')
    expect(await FeswaNFT.PriceLowLimit()).to.eq(initPoolPrice)
    expect(await FeswaNFT.SaleStartTime()).to.eq(BidStartTime)
  })

  it('BidFeswaPair: Basic checking', async () => {
    await mineBlock(provider, BidStartTime - 1 )
    await expect(FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, other0.address))
      .to.be.revertedWith('FESN: BID NOT STARTED')

    await mineBlock(provider, BidStartTime + 1)
    await expect(FeswaNFT.BidFeswaPair(TokenA.address, TokenA.address, other0.address))
      .to.be.revertedWith('FESN: IDENTICAL_ADDRESSES')

    await expect(FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, other0.address,
          { ...overrides, value: initPoolPrice.sub(1) } ))
      .to.be.revertedWith('FESN: PAY LESS')
  })

  it('BidFeswaPair: New NFT creation', async () => {
    await mineBlock(provider, BidStartTime + 1)
    const tokenIDMatch = utils.keccak256( 
                                utils.solidityPack( ['address', 'address', 'address'],
                                                    [FeswaNFT.address, TokenA.address, TokenB.address] ) )
    await expect(FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, other0.address,
                    { ...overrides, value: initPoolPrice } ))
            .to.emit(FeswaNFT,'Transfer')
            .withArgs(constants.AddressZero, other0.address, tokenIDMatch)
            .to.emit(FeswaNFT,'PairCreadted')
            .withArgs(TokenA.address, TokenB.address, tokenIDMatch)
    
    expect(await provider.getBalance(FeswaNFT.address)).to.eq(initPoolPrice)        
  })

  it('BidFeswaPair: New NFT creation with price more than PriceLowLimit', async () => {
    await mineBlock(provider, BidStartTime + 1)
    const tokenIDMatch = utils.keccak256( 
                                utils.solidityPack( ['address', 'address', 'address'],
                                                    [FeswaNFT.address, TokenA.address, TokenB.address] ) )
    await expect(FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, other0.address,
                    { ...overrides, value: initPoolPrice.mul(2) } ))
            .to.emit(FeswaNFT,'Transfer')
            .withArgs(constants.AddressZero, other0.address, tokenIDMatch)
            .to.emit(FeswaNFT,'PairCreadted')
            .withArgs(TokenA.address, TokenB.address, tokenIDMatch)
    
    expect(await provider.getBalance(FeswaNFT.address)).to.eq(initPoolPrice.mul(2))        
  })

  it('BidFeswaPair: NFT list content checking', async () => {
    await mineBlock(provider, BidStartTime + 1)
    const tokenIDMatch = utils.keccak256( 
                                utils.solidityPack( ['address', 'address', 'address'],
                                                    [FeswaNFT.address, TokenA.address, TokenB.address] ) )
    await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, other0.address,
                                { ...overrides, value: initPoolPrice } )
    const NewFeswaPair= await FeswaNFT.ListPools(tokenIDMatch)   
    const lastBlock = await provider.getBlock('latest')
    expect(NewFeswaPair.tokenA).to.deep.equal(TokenA.address)
    expect(NewFeswaPair.tokenB).to.deep.equal(TokenB.address)
    expect(NewFeswaPair.timeCreated).to.deep.equal(lastBlock.timestamp)
    expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.BidPhase)
    expect(NewFeswaPair.currentPrice).to.deep.equal(initPoolPrice)                                
  })

  it('BidFeswaPair: NFT Normal creation, and address are swapped', async () => {
    // Normal creation
    await mineBlock(provider, BidStartTime + 1)
    const tokenIDMatch = utils.keccak256( 
                                utils.solidityPack( ['address', 'address', 'address'],
                                                    [FeswaNFT.address, TokenA.address, TokenB.address] ) )

    await expect(FeswaNFT.BidFeswaPair(TokenB.address, TokenA.address, other0.address,
                    { ...overrides, value: initPoolPrice } ))
            .to.emit(FeswaNFT,'Transfer')
            .withArgs(constants.AddressZero, other0.address, tokenIDMatch)
  })

  it('BidFeswaPair: Checking for minimum 0.1ETH increacement', async () => {         
    // Normal creation
    await mineBlock(provider, BidStartTime + 1)
    await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
                                { ...overrides, value: initPoolPrice } )                       
    // Checking minimum 10% price increase
    const newPoolPrice = initPoolPrice.mul(3).div(2)
    await expect(FeswaNFT.connect(other0).BidFeswaPair(TokenA.address, TokenB.address, other0.address,
                                { ...overrides, value: newPoolPrice.sub(1) } ) )
            .to.be.revertedWith('FESN: PAY LESS')
  })   
  
  it('BidFeswaPair: Checking for minimum 10% increacement', async () => {         
    // Normal creation
    await mineBlock(provider, BidStartTime + 1)
    await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
                                { ...overrides, value: PriceOneETH } )                       
    // Checking minimum 10% price increase
    const newPoolPrice = PriceOneETH.mul(11).div(10)
    await expect(FeswaNFT.connect(other0).BidFeswaPair(TokenA.address, TokenB.address, other0.address,
                                { ...overrides, value: newPoolPrice.sub(1) } ) )
            .to.be.revertedWith('FESN: PAY LESS')
  }) 
  
  it('BidFeswaPair: Checking Bid duration', async () => {         
    // Normal creation
    await mineBlock(provider, BidStartTime + 1)
    await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
                                { ...overrides, value: initPoolPrice } )   

    // Check the 2 week bid duaration/
    const lastBlock = await provider.getBlock('latest')
    const newPoolPrice = initPoolPrice.mul(2)
    await mineBlock(provider, lastBlock.timestamp + OPEN_BID_DURATION + 1)                                
    await expect(FeswaNFT.connect(other0).BidFeswaPair(TokenA.address, TokenB.address, other0.address,
                                { ...overrides, value: newPoolPrice } ) )
            .to.be.revertedWith('FESN: BID TOO LATE')
  }) 
  
  it('BidFeswaPair: Normal minimum 0.1ETH increasement ', async () => {         
    // Normal creation
    await mineBlock(provider, BidStartTime + 1)
    const tokenIDMatch = utils.keccak256( 
                                utils.solidityPack( ['address', 'address', 'address'],
                                                    [FeswaNFT.address, TokenA.address, TokenB.address] ) )
    
    await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
                                { ...overrides, value: initPoolPrice } )                       
    // get the wallet value                             
    const FeswaNFTBalance = await provider.getBalance(FeswaNFT.address)
    const WalletBalance = await provider.getBalance(wallet.address)  
    const newPoolPrice = initPoolPrice.add(expandTo18Decimals(1).div(10))
                                
    // Normal bidding with 'Transfer' event
    await mineBlock(provider, BidStartTime + 10)     
    await expect(FeswaNFT.connect(other0).BidFeswaPair(TokenA.address, TokenB.address, other0.address,
                                { ...overrides, value: newPoolPrice } ) )
            .to.emit(FeswaNFT,'Transfer')
            .withArgs(wallet.address, other0.address, tokenIDMatch)  
    
    // Check the Bit Contract balance         
    expect(await provider.getBalance(FeswaNFT.address)).to.be.eq(FeswaNFTBalance
            .add(newPoolPrice.sub(initPoolPrice).mul(9).div(10)))

    // Check the first Bidder balance increasement        
    expect(await provider.getBalance(wallet.address)).to.be.eq(WalletBalance
            .add(initPoolPrice).add(newPoolPrice.sub(initPoolPrice).div(10)))
  })


  it('BidFeswaPair: Checking 10% price increase ', async () => {         
    // Normal creation
    await mineBlock(provider, BidStartTime + 1)
    const tokenIDMatch = utils.keccak256( 
                                utils.solidityPack( ['address', 'address', 'address'],
                                                    [FeswaNFT.address, TokenA.address, TokenB.address] ) )
    
    await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
                                { ...overrides, value: PriceOneETH } )                       
    // get the wallet value                             
    const FeswaNFTBalance = await provider.getBalance(FeswaNFT.address)
    const WalletBalance = await provider.getBalance(wallet.address)  
    const newPoolPrice = PriceOneETH.mul(11).div(10)
                                
    // Normal bidding with 'Transfer' event
    await mineBlock(provider, BidStartTime + 10)     
    await expect(FeswaNFT.connect(other0).BidFeswaPair(TokenA.address, TokenB.address, other0.address,
                                { ...overrides, value: newPoolPrice } ) )
            .to.emit(FeswaNFT,'Transfer')
            .withArgs(wallet.address, other0.address, tokenIDMatch)  
    
    // Check the Bit Contract balance         
    expect(await provider.getBalance(FeswaNFT.address)).to.be.eq(FeswaNFTBalance
            .add(newPoolPrice.sub(PriceOneETH).mul(9).div(10)))

    // Check the first Bidder balance increasement        
    expect(await provider.getBalance(wallet.address)).to.be.eq(WalletBalance
            .add(PriceOneETH).add(newPoolPrice.sub(PriceOneETH).div(10)))
  })

  it('BidFeswaPair: Checking 50% price increase ', async () => {         
    // Normal creation
    await mineBlock(provider, BidStartTime + 1)
    const tokenIDMatch = utils.keccak256( 
                                utils.solidityPack( ['address', 'address', 'address'],
                                                    [FeswaNFT.address, TokenA.address, TokenB.address] ) )
    
    await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
                                { ...overrides, value: initPoolPrice } )                       
    // get the wallet value                             
    const FeswaNFTBalance = await provider.getBalance(FeswaNFT.address)
    const WalletBalance = await provider.getBalance(wallet.address)  
    const newPoolPrice = initPoolPrice.mul(15).div(10)
                                
    // Normal bidding with 'Transfer' event
    await mineBlock(provider, BidStartTime + 10)     
    await expect(FeswaNFT.connect(other1).BidFeswaPair(TokenA.address, TokenB.address, other1.address,
                                { ...overrides, value: newPoolPrice } ) )
            .to.emit(FeswaNFT,'Transfer')
            .withArgs(wallet.address, other1.address, tokenIDMatch)  
    
    // Check the Bit Contract balance         
    expect(await provider.getBalance(FeswaNFT.address)).to.be.eq(FeswaNFTBalance
            .add(newPoolPrice.sub(initPoolPrice).mul(9).div(10)))

    // Check the first Bidder balance increasement        
    expect(await provider.getBalance(wallet.address)).to.be.eq(WalletBalance
            .add(initPoolPrice).add(newPoolPrice.sub(initPoolPrice).div(10)))
  })

  it('BidFeswaPair: Checking for Bid with more than 10% higher price', async () => {
    // Normal creation
    await mineBlock(provider, BidStartTime + 1)
    const tokenIDMatch = utils.keccak256( 
                                utils.solidityPack( ['address', 'address', 'address'],
                                                    [FeswaNFT.address, TokenA.address, TokenB.address] ) )

    await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
                                { ...overrides, value: PriceOneETH } )
                               
    // Checking minimum 10% price increase
    const newPoolPrice1 = PriceOneETH.mul(15).div(10)
   
    // Normal bidding with 'Transfer' event
    await mineBlock(provider, BidStartTime + 10)     
    await FeswaNFT.connect(other0).BidFeswaPair(TokenA.address, TokenB.address, other0.address,
                                { ...overrides, value: newPoolPrice1 } )

    // get the wallet value                             
    const FeswaNFTBalance = await provider.getBalance(FeswaNFT.address)
    const other0Balance = await provider.getBalance(other0.address)

    // Checking minimum 10% price increase
    const newPoolPrice2 = newPoolPrice1.mul(15).div(10)

    // Normal bidding with 'Transfer' event
    await mineBlock(provider, BidStartTime + 20)     
    await expect(FeswaNFT.connect(other1).BidFeswaPair(TokenB.address, TokenA.address, other1.address,
                                { ...overrides, value: newPoolPrice2 } ) )
            .to.emit(FeswaNFT,'Transfer')
            .withArgs(other0.address, other1.address, tokenIDMatch)  
    
    // Check the Bit Contract balance       
    expect(await provider.getBalance(FeswaNFT.address)).to.be.eq(FeswaNFTBalance
            .add((newPoolPrice2.sub(newPoolPrice1)).mul(9).div(10)))

    // Check the first Bidder balance increasement
    expect(await provider.getBalance(other0.address)).to.be.eq(other0Balance
            .add(newPoolPrice1).add(newPoolPrice2.sub(newPoolPrice1).div(10)))            

  })

})

describe('BidFeswaState: checking state transition and airdrop amount', () => {
  const provider = new MockProvider({
    ganacheOptions: {
      hardfork: 'istanbul',
      mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
      gasLimit: 9999999,
    },
  })
  const [wallet, other0, other1] = provider.getWallets()
  const loadFixture = createFixtureLoader([wallet, other0], provider)

  let TokenA: Contract
  let TokenB: Contract
  let Feswa: Contract
  let FeswaNFT: Contract

  beforeEach('load fixture', async () => {
    const fixture = await loadFixture(FeswaNFTFixture)
    TokenA    = fixture.TokenA
    TokenB    = fixture.TokenB    
    Feswa     = fixture.Feswa
    FeswaNFT  = fixture.FeswaNFT
  })

  it('BidFeswaState: Not enter daley duration 2 hours before end of 2-week duratoin', async () => {
    await mineBlock(provider, BidStartTime + 1)
    const tokenIDMatch = utils.keccak256( 
                                utils.solidityPack( ['address', 'address', 'address'],
                                                    [FeswaNFT.address, TokenA.address, TokenB.address] ) )
    // check first airdrop                                                
    let walletBalance = await Feswa.balanceOf(wallet.address)
    await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
                                { ...overrides, value: initPoolPrice } )
    expect(await Feswa.balanceOf(wallet.address)).to.be.eq(walletBalance.add(AIRDROP_FOR_FIRST))                            
     
    // still in BidPhase at last second, and check airdrop                            
    let lastBlock = await provider.getBlock('latest')
    let creatTime = lastBlock.timestamp
    await mineBlock(provider, lastBlock.timestamp + OPEN_BID_DURATION - CLOSE_BID_DELAY - 2 )    
    await FeswaNFT.connect(other0).BidFeswaPair(TokenA.address, TokenB.address, other0.address,
                                { ...overrides, value: initPoolPrice.mul(2) } )
                                   
    lastBlock = await provider.getBlock('latest')  
    let NewFeswaPair= await FeswaNFT.ListPools(tokenIDMatch)   
    expect(NewFeswaPair.tokenA).to.deep.equal(TokenA.address)
    expect(NewFeswaPair.tokenB).to.deep.equal(TokenB.address)
    expect(NewFeswaPair.timeCreated).to.deep.equal(creatTime)
    expect(NewFeswaPair.lastBidTime).to.deep.equal(lastBlock.timestamp)
    expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.BidPhase)
    expect(NewFeswaPair.currentPrice).to.deep.equal(initPoolPrice.mul(2))    
    expect(await Feswa.balanceOf(other0.address)).to.be.eq(AIRDROP_FOR_NEXT)   

    // enter delaying state from last second
    await mineBlock(provider, creatTime + OPEN_BID_DURATION - CLOSE_BID_DELAY )    
    await FeswaNFT.connect(other1).BidFeswaPair(TokenA.address, TokenB.address, other1.address,
                               { ...overrides, value: initPoolPrice.mul(3) } )
    
    lastBlock = await provider.getBlock('latest')                   
    NewFeswaPair= await FeswaNFT.ListPools(tokenIDMatch) 
    expect(NewFeswaPair.tokenA).to.deep.equal(TokenA.address)
    expect(NewFeswaPair.tokenB).to.deep.equal(TokenB.address)
    expect(NewFeswaPair.timeCreated).to.deep.equal(creatTime)
    expect(NewFeswaPair.lastBidTime).to.deep.equal(lastBlock.timestamp)
    expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.BidDelaying)
    expect(NewFeswaPair.currentPrice).to.deep.equal(initPoolPrice.mul(3))    
    expect(await Feswa.balanceOf(other1.address)).to.be.eq(AIRDROP_FOR_NEXT)    

    // keep in delaying state if no more than CLOSE_BID_DELAY
    lastBlock = await provider.getBlock('latest')
    await mineBlock(provider, lastBlock.timestamp + CLOSE_BID_DELAY - 2 )    
    await FeswaNFT.connect(other0).BidFeswaPair(TokenA.address, TokenB.address, other0.address,
                               { ...overrides, value: initPoolPrice.mul(4) } )
   
    // delaying again at last second
    lastBlock = await provider.getBlock('latest')
    NewFeswaPair= await FeswaNFT.ListPools(tokenIDMatch) 
    expect(NewFeswaPair.tokenA).to.deep.equal(TokenA.address)
    expect(NewFeswaPair.tokenB).to.deep.equal(TokenB.address)
    expect(NewFeswaPair.timeCreated).to.deep.equal(creatTime)
    expect(NewFeswaPair.lastBidTime).to.deep.equal(lastBlock.timestamp)
    expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.BidDelaying)
    expect(NewFeswaPair.currentPrice).to.deep.equal(initPoolPrice.mul(4))    
    expect(await Feswa.balanceOf(other0.address)).to.be.eq(AIRDROP_FOR_NEXT.mul(2))  

    // overflow the maximum delaying
    lastBlock = await provider.getBlock('latest')
    await mineBlock(provider, lastBlock.timestamp + CLOSE_BID_DELAY + 1)    
    await expect(FeswaNFT.connect(other1).BidFeswaPair(TokenA.address, TokenB.address, other1.address,
                               { ...overrides, value: initPoolPrice.mul(5) } ))
                  .to.be.revertedWith('FESN: BID TOO LATE')
  })
})


describe('FeswaPairSettle: checking state and airdrop amount to winner', () => {
  const provider = new MockProvider({
    ganacheOptions: {
      hardfork: 'istanbul',
      mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
      gasLimit: 9999999,
    },
  })
  const [wallet, other0, other1] = provider.getWallets()
  const loadFixture = createFixtureLoader([wallet, other0], provider)

  let TokenA: Contract
  let TokenB: Contract
  let Feswa: Contract
  let FeswaNFT: Contract

  beforeEach('load fixture', async () => {
    const fixture = await loadFixture(FeswaNFTFixture)
    TokenA    = fixture.TokenA
    TokenB    = fixture.TokenB    
    Feswa     = fixture.Feswa
    FeswaNFT  = fixture.FeswaNFT
  })
  
  it('FeswaPairSettle: Check Owner', async () => {
    await mineBlock(provider, BidStartTime + 1)
    const tokenIDMatch = utils.keccak256( 
                                utils.solidityPack( ['address', 'address', 'address'],
                                                    [FeswaNFT.address, TokenA.address, TokenB.address] ) )
    // check first airdrop                                                
    await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
                                { ...overrides, value: initPoolPrice } )
     
    // still in BidPhase at last second, and check airdrop                            
    let lastBlock = await provider.getBlock('latest')
    await mineBlock(provider, lastBlock.timestamp + OPEN_BID_DURATION + 1 )    
    await expect(FeswaNFT.connect(other1).FeswaPairSettle(tokenIDMatch))
                  .to.be.revertedWith('FESN: NOT TOKEN OWNER')
                         
  })

  it('FeswaPairSettle: Bid time out from BidPhase ', async () => {
    await mineBlock(provider, BidStartTime + 1)
    const tokenIDMatch = utils.keccak256( 
                                utils.solidityPack( ['address', 'address', 'address'],
                                                    [FeswaNFT.address, TokenA.address, TokenB.address] ) )
    // check first airdrop                                                
    await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
                                { ...overrides, value: initPoolPrice } )
     
    // still in BidPhase                           
    let lastBlock = await provider.getBlock('latest')
    await mineBlock(provider, lastBlock.timestamp + OPEN_BID_DURATION/2) 
    await FeswaNFT.connect(other0).BidFeswaPair(TokenA.address, TokenB.address, other0.address,
                                { ...overrides, value: initPoolPrice.mul(2) } )  

    let NewFeswaPair= await FeswaNFT.ListPools(tokenIDMatch)  
    expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.BidPhase)
    await expect(FeswaNFT.connect(other0).FeswaPairSettle(tokenIDMatch))
                  .to.be.revertedWith('FESN: BID ON GOING')

    // BidPhase time out
    lastBlock = await provider.getBlock('latest')
    await mineBlock(provider, lastBlock.timestamp + OPEN_BID_DURATION + 1 ) 
    await FeswaNFT.connect(other0).FeswaPairSettle(tokenIDMatch)

    NewFeswaPair= await FeswaNFT.ListPools(tokenIDMatch)  
    expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.BidSettled)    
    expect(await Feswa.balanceOf(other0.address))
      .to.be.eq(AIRDROP_FOR_NEXT.add(initPoolPrice.mul(2).mul(AIRDROP_RATE_FOR_WINNER)))   
  })

  it('FeswaPairSettle: Bid time out from BidDelaying phase ', async () => {
    await mineBlock(provider, BidStartTime + 1)
    const tokenIDMatch = utils.keccak256( 
                                utils.solidityPack( ['address', 'address', 'address'],
                                                    [FeswaNFT.address, TokenA.address, TokenB.address] ) )
    // First Bid                                               
    await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
                                { ...overrides, value: initPoolPrice } )
     
    // Second tender                             
    let lastBlock = await provider.getBlock('latest')
    await mineBlock(provider, lastBlock.timestamp + OPEN_BID_DURATION - 10) 
    await FeswaNFT.connect(other0).BidFeswaPair(TokenA.address, TokenB.address, other0.address,
                                { ...overrides, value: initPoolPrice.mul(2) } )   

    let NewFeswaPair= await FeswaNFT.ListPools(tokenIDMatch)  
    expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.BidDelaying)

    await expect(FeswaNFT.connect(other0).FeswaPairSettle(tokenIDMatch))
                  .to.be.revertedWith('FESN: BID ON GOING')

    // BidDelaying time out
    lastBlock = await provider.getBlock('latest')
    await mineBlock(provider, lastBlock.timestamp + OPEN_BID_DURATION + 1 ) 
    await FeswaNFT.connect(other0).FeswaPairSettle(tokenIDMatch)

    NewFeswaPair= await FeswaNFT.ListPools(tokenIDMatch)  
    expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.BidSettled)    
    expect(await Feswa.balanceOf(other0.address))
      .to.be.eq(AIRDROP_FOR_NEXT.add(initPoolPrice.mul(2).mul(AIRDROP_RATE_FOR_WINNER)))                     

  })

})  

describe('FeswaPairForSale', () => {
  const provider = new MockProvider({
    ganacheOptions: {
      hardfork: 'istanbul',
      mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
      gasLimit: 9999999,
    },
  })
  const [wallet, other0, other1] = provider.getWallets()
  const loadFixture = createFixtureLoader([wallet, other0], provider)

  let TokenA: Contract
  let TokenB: Contract
  let FeswaNFT: Contract
  let tokenIDMatch: string
  const PoolSalePrice = expandTo18Decimals(2)

  beforeEach('load fixture', async () => {
    const fixture = await loadFixture(FeswaNFTFixture)
    TokenA = fixture.TokenA
    TokenB = fixture.TokenB    
    FeswaNFT = fixture.FeswaNFT

    // Normal NFT creation
    await mineBlock(provider, BidStartTime + 1)
    await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
                                { ...overrides, value: initPoolPrice } ) 
    tokenIDMatch = utils.keccak256( utils.solidityPack( ['address', 'address', 'address'],
                                                        [FeswaNFT.address, TokenA.address, TokenB.address] ) )
  })

  it('FeswaPairForSale: TokenID not existing', async () => {
    await expect(FeswaNFT.FeswaPairForSale('0xFFFFFFFFFFFFFF', PoolSalePrice))
          .to.be.revertedWith('ERC721: owner query for nonexistent token')
  })

  it('FeswaPairForSale: Owner Checking', async () => {
    await expect(FeswaNFT.connect(other0).FeswaPairForSale(tokenIDMatch, PoolSalePrice))
          .to.be.revertedWith('FESN: NOT TOKEN OWNER')
  })

  it('FeswaPairForSale: Checking Settled ', async () => {
    await expect(FeswaNFT.FeswaPairForSale(tokenIDMatch, PoolSalePrice))
                  .to.be.revertedWith('FESN: BID NOT SETTLED')

    // Second tender: BidDelaying Phase                             
    let lastBlock = await provider.getBlock('latest')
    await mineBlock(provider, lastBlock.timestamp + OPEN_BID_DURATION - 2 ) 
    await FeswaNFT.connect(other0).BidFeswaPair(TokenA.address, TokenB.address, other0.address,
                               { ...overrides, value: initPoolPrice.mul(2) } )  

    let NewFeswaPair= await FeswaNFT.ListPools(tokenIDMatch)  
    expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.BidDelaying)

    await expect(FeswaNFT.connect(other0).FeswaPairForSale(tokenIDMatch, PoolSalePrice))
            .to.be.revertedWith('FESN: BID NOT SETTLED')  

    // BidDelaying time out
    lastBlock = await provider.getBlock('latest')
    await mineBlock(provider, lastBlock.timestamp + CLOSE_BID_DELAY + 1 ) 
    await FeswaNFT.connect(other0).FeswaPairSettle(tokenIDMatch)

    NewFeswaPair= await FeswaNFT.ListPools(tokenIDMatch)  
    expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.BidSettled)    

    // For Sale 
    await FeswaNFT.connect(other0).FeswaPairForSale(tokenIDMatch, PoolSalePrice)
    NewFeswaPair= await FeswaNFT.ListPools(tokenIDMatch)  
    expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.PoolForSale)  

    // Close Sale
    await FeswaNFT.connect(other0).FeswaPairForSale(tokenIDMatch, 0)
    NewFeswaPair= await FeswaNFT.ListPools(tokenIDMatch)  
    expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.PoolHolding) 

    // For Sale again from PoolHolding phase
    await FeswaNFT.connect(other0).FeswaPairForSale(tokenIDMatch, PoolSalePrice)
    NewFeswaPair= await FeswaNFT.ListPools(tokenIDMatch)  
    expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.PoolForSale) 
  })

  it('FeswaPairForSale: Normal execution and Checking', async () => {
      // Check the 2 week bid duaration/
      const lastBlock = await provider.getBlock('latest')
      await mineBlock(provider, lastBlock.timestamp + OPEN_BID_DURATION + 1)  
      await FeswaNFT.FeswaPairSettle(tokenIDMatch)
      await FeswaNFT.FeswaPairForSale(tokenIDMatch, PoolSalePrice)

      // checking
      let NewFeswaPair= await FeswaNFT.ListPools(tokenIDMatch)   
      expect(NewFeswaPair.tokenA).to.deep.equal(TokenA.address)
      expect(NewFeswaPair.tokenB).to.deep.equal(TokenB.address)
      expect(NewFeswaPair.timeCreated).to.deep.equal(lastBlock.timestamp)
      expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.PoolForSale)
      expect(NewFeswaPair.currentPrice).to.deep.equal(PoolSalePrice)  

      // Set Price again
      await FeswaNFT.FeswaPairForSale(tokenIDMatch, PoolSalePrice.mul(2))

      // checking
      NewFeswaPair= await FeswaNFT.ListPools(tokenIDMatch)   
      expect(NewFeswaPair.tokenA).to.deep.equal(TokenA.address)
      expect(NewFeswaPair.tokenB).to.deep.equal(TokenB.address)
      expect(NewFeswaPair.timeCreated).to.deep.equal(lastBlock.timestamp)
      expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.PoolForSale)
      expect(NewFeswaPair.currentPrice).to.deep.equal(PoolSalePrice.mul(2)) 
  })
})

  describe('FeswaPairBuyIn', () => {
    const provider = new MockProvider({
      ganacheOptions: {
        hardfork: 'istanbul',
        mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
        gasLimit: 9999999,
      },
    })
    const [wallet, other0, other1] = provider.getWallets()
    const loadFixture = createFixtureLoader([wallet, other0], provider)
  
    let TokenA: Contract
    let TokenB: Contract
    let FeswaNFT: Contract
    let tokenIDMatch: string
    let createBlock: Block
    const PoolSalePrice = expandTo18Decimals(2)
  
    beforeEach('load fixture', async () => {
      const fixture = await loadFixture(FeswaNFTFixture)
      TokenA = fixture.TokenA
      TokenB = fixture.TokenB    
      FeswaNFT = fixture.FeswaNFT
  
      // Normal NFT creation
      await mineBlock(provider, BidStartTime + 1)
      await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
                                  { ...overrides, value: initPoolPrice } ) 
      tokenIDMatch = utils.keccak256( utils.solidityPack( ['address', 'address', 'address'],
                                                          [FeswaNFT.address, TokenA.address, TokenB.address] ) )
      // Set for sale 
      createBlock = await provider.getBlock('latest')
      await mineBlock(provider, createBlock.timestamp + OPEN_BID_DURATION + 1)  
      await FeswaNFT.FeswaPairSettle(tokenIDMatch)
    })

    it('FeswaPairBuyIn: Wrong TokenID', async () => {
      await expect(FeswaNFT.FeswaPairBuyIn( '0xFFFFFFFF', PoolSalePrice, other0.address,
                                                            { ...overrides, value: PoolSalePrice } ) )
            .to.be.revertedWith('FESN: TOKEN NOT CREATED')
    })

    it('FeswaPairBuyIn: Owner Checking', async () => {
      await expect(FeswaNFT.connect(other0).FeswaPairBuyIn( tokenIDMatch, PoolSalePrice, other0.address,
                                                            { ...overrides, value: PoolSalePrice } ) )
            .to.be.revertedWith('FESN: NOT FOR SALE')
    })

    it('FeswaPairBuyIn: Buy with lower Price', async () => {
      await FeswaNFT.FeswaPairForSale(tokenIDMatch, PoolSalePrice)
      await expect(FeswaNFT.connect(other0).FeswaPairBuyIn( tokenIDMatch, PoolSalePrice, other0.address,
                                                            { ...overrides, value: PoolSalePrice.sub(1) } ) )
              .to.be.revertedWith('FESN: PAY LESS')
    })

    it('FeswaPairBuyIn: Normal Buying: New Price', async () => {
      await FeswaNFT.FeswaPairForSale(tokenIDMatch, PoolSalePrice)
      // get the wallet value                             
      const FeswaNFTBalance = await provider.getBalance(FeswaNFT.address)
      const WalletBalance = await provider.getBalance(wallet.address)

      const NewPoolSalePrice = expandTo18Decimals(3)
      await expect(FeswaNFT.connect(other0).FeswaPairBuyIn( tokenIDMatch, NewPoolSalePrice, other0.address,
                                                            { ...overrides, value: PoolSalePrice } ) )
            .to.emit(FeswaNFT,'Transfer')
            .withArgs(wallet.address, other0.address, tokenIDMatch)  

      // checking
      const NewFeswaPair= await FeswaNFT.ListPools(tokenIDMatch)   
      expect(NewFeswaPair.tokenA).to.deep.equal(TokenA.address)
      expect(NewFeswaPair.tokenB).to.deep.equal(TokenB.address)
      expect(NewFeswaPair.timeCreated).to.deep.equal(createBlock.timestamp)
      expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.PoolForSale)
      expect(NewFeswaPair.currentPrice).to.deep.equal(NewPoolSalePrice) 
      
      // Check the Bit Contract balance: no change       
      expect(await provider.getBalance(FeswaNFT.address)).to.be.eq(FeswaNFTBalance)

      // Check the first Bidder balance increasement
      expect(await provider.getBalance(wallet.address)).to.be.eq(WalletBalance.add(PoolSalePrice))

    })
   
    it('FeswaPairBuyIn: Normal Buying: Holding Staus', async () => {
      await FeswaNFT.FeswaPairForSale(tokenIDMatch, PoolSalePrice)
      await expect(FeswaNFT.connect(other0).FeswaPairBuyIn( tokenIDMatch, 0, other0.address,
                                                            { ...overrides, value: PoolSalePrice } ) )
            .to.emit(FeswaNFT,'Transfer')
            .withArgs(wallet.address, other0.address, tokenIDMatch)  

      // checking
      const NewFeswaPair= await FeswaNFT.ListPools(tokenIDMatch)   
      expect(NewFeswaPair.tokenA).to.deep.equal(TokenA.address)
      expect(NewFeswaPair.tokenB).to.deep.equal(TokenB.address)
      expect(NewFeswaPair.timeCreated).to.deep.equal(createBlock.timestamp)
      expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.PoolHolding)
      expect(NewFeswaPair.currentPrice).to.deep.equal(PoolSalePrice)    
    })

    it('FeswaPairBuyIn: Normal Buying with more value: Reimbursement', async () => {
      await FeswaNFT.FeswaPairForSale(tokenIDMatch, PoolSalePrice)
      // get the wallet value                             
      const FeswaNFTBalance = await provider.getBalance(FeswaNFT.address)
      const WalletBalance = await provider.getBalance(wallet.address)
      const Other0Balance = await provider.getBalance(other0.address)
      const tx = await FeswaNFT.connect(other0).FeswaPairBuyIn( tokenIDMatch, 0, other0.address,
                                                                { ...overrides, value: PoolSalePrice.mul(2) } )
      const receipt = await tx.wait()

      // checking
      const NewFeswaPair= await FeswaNFT.ListPools(tokenIDMatch)   
      expect(NewFeswaPair.tokenA).to.deep.equal(TokenA.address)
      expect(NewFeswaPair.tokenB).to.deep.equal(TokenB.address)
      expect(NewFeswaPair.timeCreated).to.deep.equal(createBlock.timestamp)
      expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.PoolHolding)
      expect(NewFeswaPair.currentPrice).to.deep.equal(PoolSalePrice)     
      
      // Check the Bit Contract balance: no change       
      expect(await provider.getBalance(FeswaNFT.address)).to.be.eq(FeswaNFTBalance)

      // Check the first Bidder balance increasement
      expect(await provider.getBalance(wallet.address)).to.be.eq(WalletBalance.add(PoolSalePrice))

      // Check reimbursed
      expect(await provider.getBalance(other0.address)).to.be.eq(Other0Balance
                                                       .sub(PoolSalePrice).sub(receipt.gasUsed.mul(overrides.gasPrice)))
    })
  })

  describe('getPoolInfoByTokens & getPoolTokens', () => {
    const provider = new MockProvider({
      ganacheOptions: {
        hardfork: 'istanbul',
        mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
        gasLimit: 9999999,
      },
    })
    const [wallet, other0, other1] = provider.getWallets()
    const loadFixture = createFixtureLoader([wallet, other0], provider)
  
    let TokenA: Contract
    let TokenB: Contract
    let Feswa: Contract
    let FeswaNFT: Contract
    let tokenIDMatch: string
  
    beforeEach('load fixture', async () => {
      const fixture = await loadFixture(FeswaNFTFixture)
      TokenA = fixture.TokenA
      TokenB = fixture.TokenB    
      Feswa = fixture.Feswa
      FeswaNFT = fixture.FeswaNFT
  
      // Normal NFT creation
      await mineBlock(provider, BidStartTime + 1)
      await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
                                  { ...overrides, value: initPoolPrice } ) 
      tokenIDMatch = utils.keccak256( utils.solidityPack( ['address', 'address', 'address'],
                                                          [FeswaNFT.address, TokenA.address, TokenB.address] ) )
    })
  
    it('getPoolInfoByTokens: Pair not created, still return NFT info, but with Null value', async () => {
      const poolInfo = await FeswaNFT.getPoolInfoByTokens(TokenA.address, Feswa.address)
      expect(poolInfo.nftOwner).to.deep.equal(constants.AddressZero)
      expect(poolInfo.pairInfo.tokenA).to.deep.equal(constants.AddressZero)
      expect(poolInfo.pairInfo.tokenB).to.deep.equal(constants.AddressZero)
//       .to.be.revertedWith('FESN: TOKEN NOT CREATED')       // For UX reason , do not revert
    })

    it('getPoolInfoByTokens: Check TokenInfo', async () => {
      const lastBlock = await provider.getBlock('latest')
      const poolInfo = await FeswaNFT.getPoolInfoByTokens(TokenA.address, TokenB.address)   
      expect(poolInfo.tokenID).to.deep.equal(tokenIDMatch)
      expect(poolInfo.pairInfo.tokenA).to.deep.equal(TokenA.address)
      expect(poolInfo.pairInfo.tokenB).to.deep.equal(TokenB.address)
      expect(poolInfo.pairInfo.timeCreated).to.deep.equal(lastBlock.timestamp)
      expect(poolInfo.pairInfo.poolState).to.deep.equal(PoolRunningPhase.BidPhase)
      expect(poolInfo.pairInfo.currentPrice).to.deep.equal(initPoolPrice) 
      
      const poolInfoBA = await FeswaNFT.getPoolInfoByTokens(TokenB.address, TokenA.address)  
      expect(poolInfo).to.deep.equal(poolInfoBA)
    })

    it('getPoolTokens: Token ID not existed', async () => {
//      await expect(FeswaNFT.getPoolTokens('0xFFFFFFFFFFF')).to.be.revertedWith('FESN: NOT TOKEN OWNER')  
      const poolInfo = await FeswaNFT.getPoolTokens('0xFFFFFFFFFFF')
      expect(poolInfo.tokenA).to.deep.equal(constants.AddressZero)
      expect(poolInfo.tokenB).to.deep.equal(constants.AddressZero)
    })

    it('getPoolTokens: Normal', async () => {
      expect(await FeswaNFT.getPoolTokens(tokenIDMatch)).to.deep.eq([TokenA.address, TokenB.address])  
    })
  })

  describe('setPriceLowLimit', () => {
    const provider = new MockProvider({
      ganacheOptions: {
        hardfork: 'istanbul',
        mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
        gasLimit: 9999999,
      },
    })
    const [wallet, other0, other1] = provider.getWallets()
    const loadFixture = createFixtureLoader([wallet,other0], provider)
  
    let TokenA: Contract
    let TokenB: Contract
    let FeswaNFT: Contract
  
    beforeEach('load fixture', async () => {
      const fixture = await loadFixture(FeswaNFTFixture)
      TokenA = fixture.TokenA
      TokenB = fixture.TokenB    
      FeswaNFT = fixture.FeswaNFT
    })
  
    it('setPriceLowLimit: Only Owner', async () => {
      await expect(FeswaNFT.connect(other0).setPriceLowLimit(initPoolPrice.mul(2)))
              .to.be.revertedWith('Ownable: caller is not the owner')    
    })

    it('setPriceLowLimit: Set new bid prices', async () => {
      await FeswaNFT.setPriceLowLimit(initPoolPrice.mul(2)) 
      expect(await FeswaNFT.PriceLowLimit()).to.eq(initPoolPrice.mul(2))

      // Normal NFT creation
      await mineBlock(provider, BidStartTime + 1)
      await expect(FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
                                        { ...overrides, value: initPoolPrice } ))
              .to.be.revertedWith('FESN: PAY LESS')   
              
      await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
                                  { ...overrides, value: initPoolPrice.mul(2) } )
    })
  })

  describe('withdraw', () => {
    const provider = new MockProvider({
      ganacheOptions: {
        hardfork: 'istanbul',
        mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
        gasLimit: 9999999,
      },
    })
    const [wallet, other0, other1] = provider.getWallets()
    const loadFixture = createFixtureLoader([wallet, other0], provider)
  
    let TokenA: Contract
    let TokenB: Contract
    let FeswaNFT: Contract
  
    beforeEach('load fixture', async () => {
      const fixture = await loadFixture(FeswaNFTFixture)
      TokenA = fixture.TokenA
      TokenB = fixture.TokenB    
      FeswaNFT = fixture.FeswaNFT

      // Normal NFT creation
      await mineBlock(provider, BidStartTime + 1)
      await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
                                  { ...overrides, value: initPoolPrice } ) 
    })
  
    it('withdraw: Only Owner', async () => {
      await expect(FeswaNFT.connect(other0).withdraw(other1.address, initPoolPrice))
              .to.be.revertedWith('Ownable: caller is not the owner')    
    })

    it('withdraw: Withdraw too more', async () => {
      await expect(FeswaNFT.withdraw(other1.address, initPoolPrice.add(1)))
              .to.be.revertedWith('FESN: INSUFFICIENT BALANCE')    
    })

    it('withdraw: Withdraw normally', async () => {
      const FeswaNFTBalance = await provider.getBalance(FeswaNFT.address)
      const other1Balance = await provider.getBalance(other1.address)
      await FeswaNFT.withdraw(other1.address, initPoolPrice.div(3))

      // Check the balance
      expect(await provider.getBalance(FeswaNFT.address)).to.be.eq(FeswaNFTBalance.sub(initPoolPrice.div(3)))
      expect(await provider.getBalance(other1.address)).to.be.eq(other1Balance.add(initPoolPrice.div(3)))
    })
  })

  describe('ERC721 Basic Checking', () => {
    const provider = new MockProvider({
      ganacheOptions: {
        hardfork: 'istanbul',
        mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
        gasLimit: 9999999,
      },
    })
    const [wallet, other0, other1] = provider.getWallets()
    const loadFixture = createFixtureLoader([wallet, other0], provider)
  
    let TokenA: Contract
    let TokenB: Contract
    let FeswaNFT: Contract
    let tokenIDMatchAB: string
    let tokenIDMatchAC: string
    let tokenIDMatchBC: string    
    const _INTERFACE_ID_ERC721 = 0x80ac58cd
    const _INTERFACE_ID_ERC721_METADATA = 0x5b5e139f
    const _INTERFACE_ID_ERC721_ENUMERABLE = 0x780e9d63
  
    beforeEach('load fixture', async () => {
      const fixture = await loadFixture(FeswaNFTFixture)
      TokenA = fixture.TokenA
      TokenB = fixture.TokenB    
      FeswaNFT = fixture.FeswaNFT

      const TokenC = await deployContract(wallet, TestERC20, ['Test ERC20 B', 'TKB', expandTo18Decimals(1000_000)])
  
      // Normal NFT creation
      await mineBlock(provider, BidStartTime + 1)
      await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
                                  { ...overrides, value: initPoolPrice } ) 
      tokenIDMatchAB = utils.keccak256( utils.solidityPack( ['address', 'address', 'address'],
                                                          [FeswaNFT.address, TokenA.address, TokenB.address] ) )

      await mineBlock(provider, BidStartTime + 10)
      await FeswaNFT.BidFeswaPair(TokenA.address, TokenC.address, wallet.address,
                                  { ...overrides, value: initPoolPrice } )                                                     
      if(TokenA.address.toLowerCase() <= TokenC.address.toLowerCase() ) {
        tokenIDMatchAC = utils.keccak256( utils.solidityPack( ['address', 'address', 'address'],
                                                              [FeswaNFT.address, TokenA.address, TokenC.address] ) )
      } else {
        tokenIDMatchAC = utils.keccak256( utils.solidityPack( ['address', 'address', 'address'],
                                                              [FeswaNFT.address, TokenC.address, TokenA.address] ) )                                                 
      }

      await mineBlock(provider, BidStartTime + 20)
      await FeswaNFT.connect(other0).BidFeswaPair(TokenB.address, TokenC.address, other0.address,
                                  { ...overrides, value: initPoolPrice } )       
      if(TokenB.address.toLowerCase() <= TokenC.address.toLowerCase() ) {
        tokenIDMatchBC = utils.keccak256( utils.solidityPack( ['address', 'address', 'address'],
                                                              [FeswaNFT.address, TokenB.address, TokenC.address] ) )
      } else {
        tokenIDMatchBC = utils.keccak256( utils.solidityPack( ['address', 'address', 'address'],
                                                              [FeswaNFT.address, TokenC.address, TokenB.address] ) )                                                 
      }
    })

    it('IERC721Enumerable: totalSupply()', async () => {
      expect(await FeswaNFT.totalSupply()).to.be.eq(3)    
    })

    it('IERC721Enumerable: tokenOfOwnerByIndex()', async () => {
      expect(await FeswaNFT.tokenOfOwnerByIndex(wallet.address, 0)).to.be.eq(tokenIDMatchAB) 
      expect(await FeswaNFT.tokenOfOwnerByIndex(wallet.address, 1)).to.be.eq(tokenIDMatchAC) 
      expect(await FeswaNFT.tokenOfOwnerByIndex(other0.address, 0)).to.be.eq(tokenIDMatchBC)           
    })

    it('IERC721Enumerable: tokenByIndex()', async () => {
      expect(await FeswaNFT.tokenByIndex(0)).to.be.eq(tokenIDMatchAB) 
      expect(await FeswaNFT.tokenByIndex(1)).to.be.eq(tokenIDMatchAC) 
      expect(await FeswaNFT.tokenByIndex(2)).to.be.eq(tokenIDMatchBC)             
    })

    it('IERC721Metadata: name()', async () => {
      expect(await FeswaNFT.name()).to.be.eq('Feswap Pool NFT')    
    })

    it('IERC721Metadata: symbol()', async () => {
      expect(await FeswaNFT.symbol()).to.be.eq('FESN')    
    })

    it('IERC721Metadata: tokenURI()', async () => {
      expect(await FeswaNFT.tokenURI(tokenIDMatchAB)).to.be.eq('')    
      expect(await FeswaNFT.tokenURI(tokenIDMatchAC)).to.be.eq('')    
      expect(await FeswaNFT.tokenURI(tokenIDMatchBC)).to.be.eq('')    
    })
    
    it('IERC165: supportsInterface()', async () => {
      expect(await FeswaNFT.supportsInterface(_INTERFACE_ID_ERC721)).to.be.eq(true)    
      expect(await FeswaNFT.supportsInterface(_INTERFACE_ID_ERC721_METADATA)).to.be.eq(true)    
      expect(await FeswaNFT.supportsInterface(_INTERFACE_ID_ERC721_ENUMERABLE)).to.be.eq(true)    
    })
        
    it('IERC721: balanceOf()', async () => {
      expect(await FeswaNFT.balanceOf(wallet.address)).to.be.eq(2)    
      expect(await FeswaNFT.balanceOf(other0.address)).to.be.eq(1)    
    })

    it('IERC721: ownerOf()', async () => {
      expect(await FeswaNFT.ownerOf(tokenIDMatchAB)).to.be.eq(wallet.address)    
      expect(await FeswaNFT.ownerOf(tokenIDMatchAC)).to.be.eq(wallet.address)    
      expect(await FeswaNFT.ownerOf(tokenIDMatchBC)).to.be.eq(other0.address)    
    })

    it('IERC721: safeTransferFrom()', async () => {
      await FeswaNFT['safeTransferFrom(address,address,uint256)'](wallet.address, other0.address, tokenIDMatchAB)
      await FeswaNFT['safeTransferFrom(address,address,uint256)'](wallet.address, other1.address, tokenIDMatchAC)
      await FeswaNFT.connect(other0)['safeTransferFrom(address,address,uint256)'](other0.address, other1.address, tokenIDMatchBC)     
    })

    it('IERC721: safeTransferFrom with data', async () => {
      await FeswaNFT['safeTransferFrom(address,address,uint256,bytes)'](wallet.address, other0.address, tokenIDMatchAB, '0x')
      await FeswaNFT['safeTransferFrom(address,address,uint256,bytes)'](wallet.address, other1.address, tokenIDMatchAC, '0x')
      await FeswaNFT.connect(other0)['safeTransferFrom(address,address,uint256,bytes)'](other0.address, other1.address, tokenIDMatchBC, '0x')     
    })

    it('IERC721: transferFrom()', async () => {
      await FeswaNFT.transferFrom(wallet.address, other1.address, tokenIDMatchAB)
      await FeswaNFT.connect(other0).transferFrom(other0.address, other1.address, tokenIDMatchBC)
      await FeswaNFT.connect(other1).transferFrom(other1.address, other0.address, tokenIDMatchAB)     
    })

    it('IERC721: approve()/getApproved()', async () => {
      await FeswaNFT.approve(other0.address, tokenIDMatchAB)
      expect(await FeswaNFT.getApproved(tokenIDMatchAB)).to.be.eq(other0.address)
      await FeswaNFT.connect(other0).transferFrom(wallet.address, other1.address, tokenIDMatchAB)
    })

    it('IERC721: setApprovalForAll()/isApprovedForAll()', async () => {
      await FeswaNFT.setApprovalForAll(other0.address, true)
      expect(await FeswaNFT.isApprovedForAll(wallet.address, other0.address)).to.eq(true)
      await FeswaNFT.setApprovalForAll(other0.address, false)
      expect(await FeswaNFT.isApprovedForAll(wallet.address, other0.address)).to.eq(false)
    })

  })


  

