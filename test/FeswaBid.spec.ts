import chai, { expect } from 'chai'
import { Contract, BigNumber, constants, utils } from 'ethers'
import { solidity, MockProvider, createFixtureLoader, deployContract } from 'ethereum-waffle'

import { feswaBidFixture } from './shares/fixtures'
import { expandTo18Decimals, mineBlock } from './shares/utils'
import { Block } from "@ethersproject/abstract-provider";
import TestERC20 from '../build/TestERC20.json'

chai.use(solidity)

const overrides = {
  gasLimit: 9999999,
  gasPrice: 2000000000
}

enum PoolRunningPhase {
  BidPhase, 
  PoolActivated, 
  PoolHolding, 
  PoolForSale
}

const initPoolPrice = expandTo18Decimals(1).div(2)
const BidStartTime: number = 1615338000   // 2021/02/22 03/10 9:00
const OPEN_BID_DURATION: number =  (3600 * 24 * 14)

describe('FeswaBid', () => {
  const provider = new MockProvider({
    ganacheOptions: {
      hardfork: 'istanbul',
      mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
      gasLimit: 9999999,
    },
  })
  const [wallet, other0, other1] = provider.getWallets()
  const loadFixture = createFixtureLoader([wallet], provider)

  let TokenA: Contract
  let TokenB: Contract
  let FeswaBid: Contract

  beforeEach('load fixture', async () => {
    const fixture = await loadFixture(feswaBidFixture)
    TokenA = fixture.TokenA
    TokenB = fixture.TokenB    
    FeswaBid = fixture.FeswaBid
  })

  /* 
  it('deployment gas', async () => {
    const receipt = await provider.getTransactionReceipt(FeswaBid.deployTransaction.hash)
    expect(receipt.gasUsed).to.eq('3117893')          // 2080815
  })
  */

  it('BidFeswaPair: Basic Checking of Init Bit Price, Bid start Time, name, symbol, ', async () => {
    expect(await FeswaBid.name()).to.eq('Feswap Pair Bid NFT')
    expect(await FeswaBid.symbol()).to.eq('FESN')
    expect(await FeswaBid.PriceLowLimit()).to.eq(initPoolPrice)
    expect(await FeswaBid.SaleStartTime()).to.eq(BidStartTime)
  })

  it('BidFeswaPair: Basic checking', async () => {
    await expect(FeswaBid.BidFeswaPair(TokenA.address, TokenB.address, other0.address))
      .to.be.revertedWith('FESN: BID NOT STARTED')
    await mineBlock(provider, BidStartTime + 1)
    await expect(FeswaBid.BidFeswaPair(TokenA.address, TokenA.address, other0.address))
      .to.be.revertedWith('FESN: IDENTICAL_ADDRESSES')
    await expect(FeswaBid.BidFeswaPair(TokenA.address, TokenB.address, other0.address,
          { ...overrides, value: initPoolPrice.sub(1) } ))
      .to.be.revertedWith('FESN: PAY LESS')
  })

  it('BidFeswaPair: New NFT creation', async () => {
    await mineBlock(provider, BidStartTime + 1)
    const tokenIDMatch = utils.keccak256( 
                                utils.solidityPack( ['address', 'address', 'address'],
                                                    [FeswaBid.address, TokenA.address, TokenB.address] ) )
    await expect(FeswaBid.BidFeswaPair(TokenA.address, TokenB.address, other0.address,
                    { ...overrides, value: initPoolPrice } ))
            .to.emit(FeswaBid,'Transfer')
            .withArgs(constants.AddressZero, other0.address, tokenIDMatch)
            .to.emit(FeswaBid,'PairCreadted')
            .withArgs(TokenA.address, TokenB.address, tokenIDMatch)
    
    expect(await provider.getBalance(FeswaBid.address)).to.eq(initPoolPrice)        
  })

  it('BidFeswaPair: NFT list content checking', async () => {
    await mineBlock(provider, BidStartTime + 1)
    const tokenIDMatch = utils.keccak256( 
                                utils.solidityPack( ['address', 'address', 'address'],
                                                    [FeswaBid.address, TokenA.address, TokenB.address] ) )
    await FeswaBid.BidFeswaPair(TokenA.address, TokenB.address, other0.address,
                                { ...overrides, value: initPoolPrice } )
    const NewFeswaPair= await FeswaBid.listPools(tokenIDMatch)   
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
                                                    [FeswaBid.address, TokenA.address, TokenB.address] ) )

    await expect(FeswaBid.BidFeswaPair(TokenB.address, TokenA.address, other0.address,
                    { ...overrides, value: initPoolPrice } ))
            .to.emit(FeswaBid,'Transfer')
            .withArgs(constants.AddressZero, other0.address, tokenIDMatch)
  })

  it('BidFeswaPair: Checking for minimum 10% increacement', async () => {         
    // Normal creation
    await mineBlock(provider, BidStartTime + 1)
    await FeswaBid.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
                                { ...overrides, value: initPoolPrice } )                       
    // Checking minimum 10% price increase
    const newPoolPrice = initPoolPrice.mul(11).div(10)
    await expect(FeswaBid.connect(other0).BidFeswaPair(TokenA.address, TokenB.address, other0.address,
                                { ...overrides, value: newPoolPrice.sub(1) } ) )
            .to.be.revertedWith('FESN: PAY LESS')
  })       
  
  it('BidFeswaPair: Checking Bid duration', async () => {         
    // Normal creation
    await mineBlock(provider, BidStartTime + 1)
    await FeswaBid.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
                                { ...overrides, value: initPoolPrice } )   

    // Check the 2 week bid duaration/
    const lastBlock = await provider.getBlock('latest')
    await mineBlock(provider, lastBlock.timestamp + OPEN_BID_DURATION)                                
                                
    // Checking minimum 10% price increase
    const newPoolPrice = initPoolPrice.mul(11).div(10)
    await expect(FeswaBid.connect(other0).BidFeswaPair(TokenA.address, TokenB.address, other0.address,
                                { ...overrides, value: newPoolPrice } ) )
            .to.be.revertedWith('FESN: BID TOO LATE')
  }) 
  
  it('BidFeswaPair: Checking 10% price increase ', async () => {         
    // Normal creation
    await mineBlock(provider, BidStartTime + 1)
    const tokenIDMatch = utils.keccak256( 
                                utils.solidityPack( ['address', 'address', 'address'],
                                                    [FeswaBid.address, TokenA.address, TokenB.address] ) )
    
    await FeswaBid.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
                                { ...overrides, value: initPoolPrice } )                       
    // get the wallet value                             
    const FeswaBidBalance = await provider.getBalance(FeswaBid.address)
    const WalletBalance = await provider.getBalance(wallet.address)  
    const newPoolPrice = initPoolPrice.mul(11).div(10)
                                
    // Normal bidding with 'Transfer' event
    await mineBlock(provider, BidStartTime + 10)     
    await expect(FeswaBid.connect(other0).BidFeswaPair(TokenA.address, TokenB.address, other0.address,
                                { ...overrides, value: newPoolPrice } ) )
            .to.emit(FeswaBid,'Transfer')
            .withArgs(wallet.address, other0.address, tokenIDMatch)  
    
    // Check the Bit Contract balance         
    expect(await provider.getBalance(FeswaBid.address)).to.be.eq(FeswaBidBalance
            .add(newPoolPrice.sub(initPoolPrice).mul(9).div(10)))

    // Check the first Bidder balance increasement        
    expect(await provider.getBalance(wallet.address)).to.be.eq(WalletBalance
            .add(initPoolPrice).add(newPoolPrice.sub(initPoolPrice).div(10)))
  })

  it('BidFeswaPair: Checking 50% price increase ', async () => {         
    // Normal creation
    await mineBlock(provider, BidStartTime + 1)
    const tokenIDMatch = utils.keccak256( 
                                utils.solidityPack( ['address', 'address', 'address'],
                                                    [FeswaBid.address, TokenA.address, TokenB.address] ) )
    
    await FeswaBid.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
                                { ...overrides, value: initPoolPrice } )                       
    // get the wallet value                             
    const FeswaBidBalance = await provider.getBalance(FeswaBid.address)
    const WalletBalance = await provider.getBalance(wallet.address)  
    const newPoolPrice = initPoolPrice.mul(15).div(10)
                                
    // Normal bidding with 'Transfer' event
    await mineBlock(provider, BidStartTime + 10)     
    await expect(FeswaBid.connect(other1).BidFeswaPair(TokenA.address, TokenB.address, other1.address,
                                { ...overrides, value: newPoolPrice } ) )
            .to.emit(FeswaBid,'Transfer')
            .withArgs(wallet.address, other1.address, tokenIDMatch)  
    
    // Check the Bit Contract balance         
    expect(await provider.getBalance(FeswaBid.address)).to.be.eq(FeswaBidBalance
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
                                                    [FeswaBid.address, TokenA.address, TokenB.address] ) )

    await FeswaBid.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
                                { ...overrides, value: initPoolPrice } )
                               
    // Checking minimum 10% price increase
    const newPoolPrice1 = initPoolPrice.mul(11).div(10)
   
    // Normal bidding with 'Transfer' event
    await mineBlock(provider, BidStartTime + 10)     
    await FeswaBid.connect(other0).BidFeswaPair(TokenA.address, TokenB.address, other0.address,
                                { ...overrides, value: newPoolPrice1 } )

    // get the wallet value                             
    const FeswaBidBalance = await provider.getBalance(FeswaBid.address)
    const other0Balance = await provider.getBalance(other0.address)

    // Checking minimum 10% price increase
    const newPoolPrice2 = newPoolPrice1.mul(15).div(10)

    // Normal bidding with 'Transfer' event
    await mineBlock(provider, BidStartTime + 20)     
    await expect(FeswaBid.connect(other1).BidFeswaPair(TokenB.address, TokenA.address, other1.address,
                                { ...overrides, value: newPoolPrice2 } ) )
            .to.emit(FeswaBid,'Transfer')
            .withArgs(other0.address, other1.address, tokenIDMatch)  
    
    // Check the Bit Contract balance       
    expect(await provider.getBalance(FeswaBid.address)).to.be.eq(FeswaBidBalance
            .add((newPoolPrice2.sub(newPoolPrice1)).mul(9).div(10)))

    // Check the first Bidder balance increasement
    expect(await provider.getBalance(other0.address)).to.be.eq(other0Balance
            .add(newPoolPrice1).add(newPoolPrice2.sub(newPoolPrice1).div(10)))            

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
  const loadFixture = createFixtureLoader([wallet], provider)

  let TokenA: Contract
  let TokenB: Contract
  let FeswaBid: Contract
  let tokenIDMatch: string
  const PoolSalePrice = expandTo18Decimals(2)

  beforeEach('load fixture', async () => {
    const fixture = await loadFixture(feswaBidFixture)
    TokenA = fixture.TokenA
    TokenB = fixture.TokenB    
    FeswaBid = fixture.FeswaBid

    // Normal NFT creation
    await mineBlock(provider, BidStartTime + 1)
    await FeswaBid.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
                                { ...overrides, value: initPoolPrice } ) 
    tokenIDMatch = utils.keccak256( utils.solidityPack( ['address', 'address', 'address'],
                                                        [FeswaBid.address, TokenA.address, TokenB.address] ) )
  })

  it('FeswaPairForSale: Owner Checking', async () => {
    await expect(FeswaBid.connect(other0).FeswaPairForSale(tokenIDMatch, PoolSalePrice))
          .to.be.revertedWith('FESN: Not the token Owner')
  })

  it('FeswaPairForSale: Owner Checking', async () => {
    await expect(FeswaBid.FeswaPairForSale(tokenIDMatch, PoolSalePrice))
          .to.be.revertedWith('FESN: Bid not finished')
  })

  it('FeswaPairForSale: Normal execution and Checking', async () => {
      // Check the 2 week bid duaration/
      const lastBlock = await provider.getBlock('latest')
      await mineBlock(provider, lastBlock.timestamp + OPEN_BID_DURATION)  
      await FeswaBid.FeswaPairForSale(tokenIDMatch, PoolSalePrice)

      // checking
      let NewFeswaPair= await FeswaBid.listPools(tokenIDMatch)   
      expect(NewFeswaPair.tokenA).to.deep.equal(TokenA.address)
      expect(NewFeswaPair.tokenB).to.deep.equal(TokenB.address)
      expect(NewFeswaPair.timeCreated).to.deep.equal(lastBlock.timestamp)
      expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.PoolForSale)
      expect(NewFeswaPair.currentPrice).to.deep.equal(PoolSalePrice)  

      // Set Price again
      await FeswaBid.FeswaPairForSale(tokenIDMatch, PoolSalePrice.mul(2))

      // checking
      NewFeswaPair= await FeswaBid.listPools(tokenIDMatch)   
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
    const loadFixture = createFixtureLoader([wallet], provider)
  
    let TokenA: Contract
    let TokenB: Contract
    let FeswaBid: Contract
    let tokenIDMatch: string
    let createBlock: Block
    const PoolSalePrice = expandTo18Decimals(2)
  
    beforeEach('load fixture', async () => {
      const fixture = await loadFixture(feswaBidFixture)
      TokenA = fixture.TokenA
      TokenB = fixture.TokenB    
      FeswaBid = fixture.FeswaBid
  
      // Normal NFT creation
      await mineBlock(provider, BidStartTime + 1)
      await FeswaBid.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
                                  { ...overrides, value: initPoolPrice } ) 
      tokenIDMatch = utils.keccak256( utils.solidityPack( ['address', 'address', 'address'],
                                                          [FeswaBid.address, TokenA.address, TokenB.address] ) )
      // Set for sale 
      createBlock = await provider.getBlock('latest')
      await mineBlock(provider, createBlock.timestamp + OPEN_BID_DURATION)                                                      
    })
  
    it('FeswaPairBuyIn: Owner Checking', async () => {
      await expect(FeswaBid.connect(other0).FeswaPairBuyIn( tokenIDMatch, PoolSalePrice, other0.address,
                                                            { ...overrides, value: PoolSalePrice } ) )
            .to.be.revertedWith('FESN: Token Pair Not For Sale')
    })

    it('FeswaPairBuyIn: Buy with lower Price', async () => {
      await FeswaBid.FeswaPairForSale(tokenIDMatch, PoolSalePrice)
      await expect(FeswaBid.connect(other0).FeswaPairBuyIn( tokenIDMatch, PoolSalePrice, other0.address,
                                                            { ...overrides, value: PoolSalePrice.sub(1) } ) )
              .to.be.revertedWith('FESN: Pay Less')
    })

    it('FeswaPairBuyIn: Normal Buying: New Price', async () => {
      await FeswaBid.FeswaPairForSale(tokenIDMatch, PoolSalePrice)
      // get the wallet value                             
      const FeswaBidBalance = await provider.getBalance(FeswaBid.address)
      const WalletBalance = await provider.getBalance(wallet.address)

      const NewPoolSalePrice = expandTo18Decimals(3)
      await expect(FeswaBid.connect(other0).FeswaPairBuyIn( tokenIDMatch, NewPoolSalePrice, other0.address,
                                                            { ...overrides, value: PoolSalePrice } ) )
            .to.emit(FeswaBid,'Transfer')
            .withArgs(wallet.address, other0.address, tokenIDMatch)  

      // checking
      const NewFeswaPair= await FeswaBid.listPools(tokenIDMatch)   
      expect(NewFeswaPair.tokenA).to.deep.equal(TokenA.address)
      expect(NewFeswaPair.tokenB).to.deep.equal(TokenB.address)
      expect(NewFeswaPair.timeCreated).to.deep.equal(createBlock.timestamp)
      expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.PoolForSale)
      expect(NewFeswaPair.currentPrice).to.deep.equal(NewPoolSalePrice) 
      
      // Check the Bit Contract balance: no change       
      expect(await provider.getBalance(FeswaBid.address)).to.be.eq(FeswaBidBalance)

      // Check the first Bidder balance increasement
      expect(await provider.getBalance(wallet.address)).to.be.eq(WalletBalance.add(PoolSalePrice))

    })
   
    it('FeswaPairBuyIn: Normal Buying: Holding Staus', async () => {
      await FeswaBid.FeswaPairForSale(tokenIDMatch, PoolSalePrice)
      await expect(FeswaBid.connect(other0).FeswaPairBuyIn( tokenIDMatch, 0, other0.address,
                                                            { ...overrides, value: PoolSalePrice } ) )
            .to.emit(FeswaBid,'Transfer')
            .withArgs(wallet.address, other0.address, tokenIDMatch)  

      // checking
      const NewFeswaPair= await FeswaBid.listPools(tokenIDMatch)   
      expect(NewFeswaPair.tokenA).to.deep.equal(TokenA.address)
      expect(NewFeswaPair.tokenB).to.deep.equal(TokenB.address)
      expect(NewFeswaPair.timeCreated).to.deep.equal(createBlock.timestamp)
      expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.PoolHolding)
      expect(NewFeswaPair.currentPrice).to.deep.equal(constants.MaxUint256)              
    })

    it('FeswaPairBuyIn: Normal Buying with more value: Reimbursement', async () => {
      await FeswaBid.FeswaPairForSale(tokenIDMatch, PoolSalePrice)
      // get the wallet value                             
      const FeswaBidBalance = await provider.getBalance(FeswaBid.address)
      const WalletBalance = await provider.getBalance(wallet.address)
      const Other0Balance = await provider.getBalance(other0.address)
      const tx = await FeswaBid.connect(other0).FeswaPairBuyIn( tokenIDMatch, 0, other0.address,
                                                                { ...overrides, value: PoolSalePrice.mul(2) } )
      const receipt = await tx.wait()

      // checking
      const NewFeswaPair= await FeswaBid.listPools(tokenIDMatch)   
      expect(NewFeswaPair.tokenA).to.deep.equal(TokenA.address)
      expect(NewFeswaPair.tokenB).to.deep.equal(TokenB.address)
      expect(NewFeswaPair.timeCreated).to.deep.equal(createBlock.timestamp)
      expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.PoolHolding)
      expect(NewFeswaPair.currentPrice).to.deep.equal(constants.MaxUint256)     
      
      // Check the Bit Contract balance: no change       
      expect(await provider.getBalance(FeswaBid.address)).to.be.eq(FeswaBidBalance)

      // Check the first Bidder balance increasement
      expect(await provider.getBalance(wallet.address)).to.be.eq(WalletBalance.add(PoolSalePrice))

      // Check reimbursed
      expect(await provider.getBalance(other0.address)).to.be.eq(Other0Balance
                                                       .sub(PoolSalePrice).sub(receipt.gasUsed.mul(overrides.gasPrice)))
    })
  })

  describe('getPoolByTokens', () => {
    const provider = new MockProvider({
      ganacheOptions: {
        hardfork: 'istanbul',
        mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
        gasLimit: 9999999,
      },
    })
    const [wallet, other0, other1] = provider.getWallets()
    const loadFixture = createFixtureLoader([wallet], provider)
  
    let TokenA: Contract
    let TokenB: Contract
    let FeswaBid: Contract
    let tokenIDMatch: string
  
    beforeEach('load fixture', async () => {
      const fixture = await loadFixture(feswaBidFixture)
      TokenA = fixture.TokenA
      TokenB = fixture.TokenB    
      FeswaBid = fixture.FeswaBid
  
      // Normal NFT creation
      await mineBlock(provider, BidStartTime + 1)
      await FeswaBid.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
                                  { ...overrides, value: initPoolPrice } ) 
      tokenIDMatch = utils.keccak256( utils.solidityPack( ['address', 'address', 'address'],
                                                          [FeswaBid.address, TokenA.address, TokenB.address] ) )
    })
  
    it('getPoolByTokens: Address are ordered', async () => {
      const lastBlock = await provider.getBlock('latest')
      const poolInfo = await FeswaBid.getPoolByTokens(TokenA.address, TokenB.address)   
      expect(poolInfo.tokenA).to.deep.equal(TokenA.address)
      expect(poolInfo.tokenB).to.deep.equal(TokenB.address)
      expect(poolInfo.timeCreated).to.deep.equal(lastBlock.timestamp)
      expect(poolInfo.poolState).to.deep.equal(PoolRunningPhase.BidPhase)
      expect(poolInfo.currentPrice).to.deep.equal(initPoolPrice) 
      
      const poolInfoBA = await FeswaBid.getPoolByTokens(TokenB.address, TokenA.address)  
      expect(poolInfo).to.deep.equal(poolInfoBA)
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
    const loadFixture = createFixtureLoader([wallet], provider)
  
    let TokenA: Contract
    let TokenB: Contract
    let FeswaBid: Contract
  
    beforeEach('load fixture', async () => {
      const fixture = await loadFixture(feswaBidFixture)
      TokenA = fixture.TokenA
      TokenB = fixture.TokenB    
      FeswaBid = fixture.FeswaBid
    })
  
    it('setPriceLowLimit: Only Owner', async () => {
      await expect(FeswaBid.connect(other0).setPriceLowLimit(initPoolPrice.mul(2)))
              .to.be.revertedWith('Ownable: caller is not the owner')    
    })

    it('setPriceLowLimit: Set new bid prices', async () => {
      await FeswaBid.setPriceLowLimit(initPoolPrice.mul(2)) 
      expect(await FeswaBid.PriceLowLimit()).to.eq(initPoolPrice.mul(2))

      // Normal NFT creation
      await mineBlock(provider, BidStartTime + 1)
      await expect(FeswaBid.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
                                        { ...overrides, value: initPoolPrice } ))
              .to.be.revertedWith('FESN: PAY LESS')   
              
      await FeswaBid.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
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
    const loadFixture = createFixtureLoader([wallet], provider)
  
    let TokenA: Contract
    let TokenB: Contract
    let FeswaBid: Contract
  
    beforeEach('load fixture', async () => {
      const fixture = await loadFixture(feswaBidFixture)
      TokenA = fixture.TokenA
      TokenB = fixture.TokenB    
      FeswaBid = fixture.FeswaBid

      // Normal NFT creation
      await mineBlock(provider, BidStartTime + 1)
      await FeswaBid.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
                                  { ...overrides, value: initPoolPrice } ) 
    })
  
    it('withdraw: Only Owner', async () => {
      await expect(FeswaBid.connect(other0).withdraw(other1.address, initPoolPrice))
              .to.be.revertedWith('Ownable: caller is not the owner')    
    })

    it('withdraw: Withdraw too more', async () => {
      await expect(FeswaBid.withdraw(other1.address, initPoolPrice.add(1)))
              .to.be.revertedWith('FESN: Insufficient Balance')    
    })

    it('withdraw: Withdraw normally', async () => {
      const FeswaBidBalance = await provider.getBalance(FeswaBid.address)
      const other1Balance = await provider.getBalance(other1.address)
      await FeswaBid.withdraw(other1.address, initPoolPrice.div(3))

      // Check the balance
      expect(await provider.getBalance(FeswaBid.address)).to.be.eq(FeswaBidBalance.sub(initPoolPrice.div(3)))
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
    const loadFixture = createFixtureLoader([wallet], provider)
  
    let TokenA: Contract
    let TokenB: Contract
    let FeswaBid: Contract
    let tokenIDMatchAB: string
    let tokenIDMatchAC: string
    let tokenIDMatchBC: string    
    const _INTERFACE_ID_ERC721 = 0x80ac58cd
    const _INTERFACE_ID_ERC721_METADATA = 0x5b5e139f
    const _INTERFACE_ID_ERC721_ENUMERABLE = 0x780e9d63
  
    beforeEach('load fixture', async () => {
      const fixture = await loadFixture(feswaBidFixture)
      TokenA = fixture.TokenA
      TokenB = fixture.TokenB    
      FeswaBid = fixture.FeswaBid

      const TokenC = await deployContract(wallet, TestERC20, ['Test ERC20 B', 'TKB', expandTo18Decimals(1000_000)])
  
      // Normal NFT creation
      await mineBlock(provider, BidStartTime + 1)
      await FeswaBid.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
                                  { ...overrides, value: initPoolPrice } ) 
      tokenIDMatchAB = utils.keccak256( utils.solidityPack( ['address', 'address', 'address'],
                                                          [FeswaBid.address, TokenA.address, TokenB.address] ) )

      await mineBlock(provider, BidStartTime + 10)
      await FeswaBid.BidFeswaPair(TokenA.address, TokenC.address, wallet.address,
                                  { ...overrides, value: initPoolPrice } )                                                     
      if(TokenA.address.toLowerCase() <= TokenC.address.toLowerCase() ) {
        tokenIDMatchAC = utils.keccak256( utils.solidityPack( ['address', 'address', 'address'],
                                                              [FeswaBid.address, TokenA.address, TokenC.address] ) )
      } else {
        tokenIDMatchAC = utils.keccak256( utils.solidityPack( ['address', 'address', 'address'],
                                                              [FeswaBid.address, TokenC.address, TokenA.address] ) )                                                 
      }

      await mineBlock(provider, BidStartTime + 20)
      await FeswaBid.connect(other0).BidFeswaPair(TokenB.address, TokenC.address, other0.address,
                                  { ...overrides, value: initPoolPrice } )       
      if(TokenB.address.toLowerCase() <= TokenC.address.toLowerCase() ) {
        tokenIDMatchBC = utils.keccak256( utils.solidityPack( ['address', 'address', 'address'],
                                                              [FeswaBid.address, TokenB.address, TokenC.address] ) )
      } else {
        tokenIDMatchBC = utils.keccak256( utils.solidityPack( ['address', 'address', 'address'],
                                                              [FeswaBid.address, TokenC.address, TokenB.address] ) )                                                 
      }
    })

    it('IERC721Enumerable: totalSupply()', async () => {
      expect(await FeswaBid.totalSupply()).to.be.eq(3)    
    })

    it('IERC721Enumerable: tokenOfOwnerByIndex()', async () => {
      expect(await FeswaBid.tokenOfOwnerByIndex(wallet.address, 0)).to.be.eq(tokenIDMatchAB) 
      expect(await FeswaBid.tokenOfOwnerByIndex(wallet.address, 1)).to.be.eq(tokenIDMatchAC) 
      expect(await FeswaBid.tokenOfOwnerByIndex(other0.address, 0)).to.be.eq(tokenIDMatchBC)           
    })

    it('IERC721Enumerable: tokenByIndex()', async () => {
      expect(await FeswaBid.tokenByIndex(0)).to.be.eq(tokenIDMatchAB) 
      expect(await FeswaBid.tokenByIndex(1)).to.be.eq(tokenIDMatchAC) 
      expect(await FeswaBid.tokenByIndex(2)).to.be.eq(tokenIDMatchBC)             
    })

    it('IERC721Metadata: name()', async () => {
      expect(await FeswaBid.name()).to.be.eq('Feswap Pair Bid NFT')    
    })

    it('IERC721Metadata: symbol()', async () => {
      expect(await FeswaBid.symbol()).to.be.eq('FESN')    
    })

    it('IERC721Metadata: tokenURI()', async () => {
      expect(await FeswaBid.tokenURI(tokenIDMatchAB)).to.be.eq('')    
      expect(await FeswaBid.tokenURI(tokenIDMatchAC)).to.be.eq('')    
      expect(await FeswaBid.tokenURI(tokenIDMatchBC)).to.be.eq('')    
    })
    
    it('IERC165: supportsInterface()', async () => {
      expect(await FeswaBid.supportsInterface(_INTERFACE_ID_ERC721)).to.be.eq(true)    
      expect(await FeswaBid.supportsInterface(_INTERFACE_ID_ERC721_METADATA)).to.be.eq(true)    
      expect(await FeswaBid.supportsInterface(_INTERFACE_ID_ERC721_ENUMERABLE)).to.be.eq(true)    
    })
        
    it('IERC721: balanceOf()', async () => {
      expect(await FeswaBid.balanceOf(wallet.address)).to.be.eq(2)    
      expect(await FeswaBid.balanceOf(other0.address)).to.be.eq(1)    
    })

    it('IERC721: ownerOf()', async () => {
      expect(await FeswaBid.ownerOf(tokenIDMatchAB)).to.be.eq(wallet.address)    
      expect(await FeswaBid.ownerOf(tokenIDMatchAC)).to.be.eq(wallet.address)    
      expect(await FeswaBid.ownerOf(tokenIDMatchBC)).to.be.eq(other0.address)    
    })

    it('IERC721: safeTransferFrom()', async () => {
      await FeswaBid['safeTransferFrom(address,address,uint256)'](wallet.address, other0.address, tokenIDMatchAB)
      await FeswaBid['safeTransferFrom(address,address,uint256)'](wallet.address, other1.address, tokenIDMatchAC)
      await FeswaBid.connect(other0)['safeTransferFrom(address,address,uint256)'](other0.address, other1.address, tokenIDMatchBC)     
    })

    it('IERC721: safeTransferFrom with data', async () => {
      await FeswaBid['safeTransferFrom(address,address,uint256,bytes)'](wallet.address, other0.address, tokenIDMatchAB, '0x')
      await FeswaBid['safeTransferFrom(address,address,uint256,bytes)'](wallet.address, other1.address, tokenIDMatchAC, '0x')
      await FeswaBid.connect(other0)['safeTransferFrom(address,address,uint256,bytes)'](other0.address, other1.address, tokenIDMatchBC, '0x')     
    })

    it('IERC721: transferFrom()', async () => {
      await FeswaBid.transferFrom(wallet.address, other1.address, tokenIDMatchAB)
      await FeswaBid.connect(other0).transferFrom(other0.address, other1.address, tokenIDMatchBC)
      await FeswaBid.connect(other1).transferFrom(other1.address, other0.address, tokenIDMatchAB)     
    })

    it('IERC721: approve()/getApproved()', async () => {
      await FeswaBid.approve(other0.address, tokenIDMatchAB)
      expect(await FeswaBid.getApproved(tokenIDMatchAB)).to.be.eq(other0.address)
      await FeswaBid.connect(other0).transferFrom(wallet.address, other1.address, tokenIDMatchAB)
    })

    it('IERC721: setApprovalForAll()/isApprovedForAll()', async () => {
      await FeswaBid.setApprovalForAll(other0.address, true)
      expect(await FeswaBid.isApprovedForAll(wallet.address, other0.address)).to.eq(true)
      await FeswaBid.setApprovalForAll(other0.address, false)
      expect(await FeswaBid.isApprovedForAll(wallet.address, other0.address)).to.eq(false)
    })

  })


  

