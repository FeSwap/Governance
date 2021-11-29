import chai, { expect } from 'chai'
import { Contract, BigNumber, constants, utils } from 'ethers'
import { solidity, MockProvider, createFixtureLoader, deployContract } from 'ethereum-waffle'

import { FeswaNFTFixturePatch } from './shares/fixtures'
import { expandTo18Decimals, mineBlock } from './shares/utils'
import { Block } from "@ethersproject/abstract-provider";
import TestERC20 from '../build/TestERC20.json'
import FeSwapPair from './Feswap/FeSwapPair.json'
import FeswaNFTCode from '../build/FeswaNFT.json'
import FeswaNFTPatchPureCode from '../build/FeswaNFTPatchPure.json'
import DestroyControllerABI from '../build/DestroyController.json'
import NFTTesterCode from '../build/NFTTester.json'

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

//const coinTimes = 1   // BNB = 1; MATIC = 100;
//const AIRDROP_FOR_FIRST = expandTo18Decimals(1000);   // BNB

const coinTimes = 100   // BNB = 1; MATIC = 100;
const AIRDROP_FOR_FIRST = expandTo18Decimals(3000);   // MATIC

const stepPrice = expandTo18Decimals(2).div(100).mul(coinTimes)
const PriceOneETH = stepPrice.mul(50)
const BidStartTime: number = 1615338000         // 2021/02/22 03/10 9:00
const OPEN_BID_DURATION: number = (3600 * 24 * 3)
const RECLAIM_DURATION: number = (3600 * 24 * 4)
const CLOSE_BID_DELAY: number = (3600 * 2)

// Airdrop for the next tender: 500 FEST
const AIRDROP_RATE_FOR_NEXT = 10000 / coinTimes;
const AIRDROP_RATE_FOR_WINNER = 50000 / coinTimes;

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
  let Factory: Contract
  let FeswaNFT: Contract
  let MetamorphicFactory: Contract

  beforeEach('load fixture', async () => {
    const fixture = await loadFixture(FeswaNFTFixturePatch)
    TokenA = fixture.TokenA
    TokenB = fixture.TokenB
    Feswa = fixture.Feswa
    Factory = fixture.Factory
    MetamorphicFactory = fixture.MetamorphicFactory

    FeswaNFT =  new Contract(fixture.FeswaNFT.address, JSON.stringify(FeswaNFTCode.abi), wallet) 

    // deploy FeSwap NFT Patch implementation 
    const NFTPatchImplementation = await deployContract(wallet, FeswaNFTPatchPureCode)
    const salt = "0x291AD4D300CBA1259F2807167DE059F45F0EA7EDC76A99BE5290E88E498EC62B"
    const metaMorphicContractAddress = await MetamorphicFactory.findMetamorphicContractAddress(salt)
    const metaMorphicContract = new Contract(metaMorphicContractAddress, JSON.stringify(DestroyControllerABI.abi), wallet) 
    await metaMorphicContract.connect(other0).destroy(wallet.address)
    await MetamorphicFactory.deployMetamorphicContract(salt, NFTPatchImplementation.address, "0x", { ...overrides, value: 0 })

  })

  /*
  it('deployment gas', async () => {
    const receipt = await provider.getTransactionReceipt(FeswaNFT.deployTransaction.hash)
    expect(receipt.gasUsed).to.eq('4614521')          // 4469228 3117893 2080815
  })
*/

  it('Beacon destroyable and re-deploy', async () => {
    const salt = "0x291AD4D300CBA1259F2807167DE059F45F0EA7EDC76A99BE5290E88E498EC62B"
    const metaMorphicContractAddress = await MetamorphicFactory.findMetamorphicContractAddress(salt)
    console.log( "MetamorphicFactory: ", MetamorphicFactory.address)
    console.log( "metaMorphicAddress: ", metaMorphicContractAddress)
    console.log( "FeswaNFT: ", FeswaNFT.address)
    
    let metaMorphicContract 
    metaMorphicContract = new Contract(FeswaNFT.address, JSON.stringify(DestroyControllerABI.abi), wallet) 
    await expect(metaMorphicContract.connect(other0).destroy(wallet.address))
            .to.be.revertedWith('Root not destroyable!')

    metaMorphicContract = new Contract(metaMorphicContractAddress, JSON.stringify(DestroyControllerABI.abi), wallet) 
    await expect(metaMorphicContract.destroy(wallet.address))
            .to.be.revertedWith('Destroy not permitted!')
    
    await metaMorphicContract.connect(other0).destroy(wallet.address)
  })

  it('BidFeswaPair: Basic Checking of Init Bit Price, Bid start Time, name, symbol, ', async () => {
    expect(await FeswaNFT.name()).to.eq('FeSwap Pool NFT')
    expect(await FeswaNFT.symbol()).to.eq('FESN')
    expect(await FeswaNFT.OPEN_BID_DURATION()).to.eq(3600 * 24 * 3)
    expect(await FeswaNFT.RECLAIM_DURATION()).to.eq(3600 * 24 * 4)
    expect(await FeswaNFT.CLOSE_BID_DELAY()).to.eq(3600 * 2)
    expect(await FeswaNFT.AIRDROP_FOR_FIRST()).to.eq(AIRDROP_FOR_FIRST)
    expect(await FeswaNFT.AIRDROP_RATE_FOR_NEXT_BIDDER()).to.eq(AIRDROP_RATE_FOR_NEXT)
    expect(await FeswaNFT.AIRDROP_RATE_FOR_WINNER()).to.eq(AIRDROP_RATE_FOR_WINNER)
    expect(await FeswaNFT.MINIMUM_PRICE_INCREACE()).to.eq(stepPrice)
    expect(await FeswaNFT.FeswapToken()).to.eq(Feswa.address)
    expect(await FeswaNFT.PairFactory()).to.eq(Factory.address)
    expect(await FeswaNFT.SaleStartTime()).to.eq(BidStartTime)
  })

  it('BidFeswaPair: Basic checking', async () => {
    await mineBlock(provider, BidStartTime - 1)
    await expect(FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, other0.address))
      .to.be.revertedWith('FESN: BID NOT STARTED')

    await mineBlock(provider, BidStartTime + 1)
    await expect(FeswaNFT.BidFeswaPair(TokenA.address, TokenA.address, other0.address))
      .to.be.revertedWith('FESN: IDENTICAL_ADDRESSES')

    await expect(FeswaNFT.BidFeswaPair(TokenA.address, other0.address, other0.address,
              { ...overrides, value: stepPrice } ))
          .to.be.revertedWith('FESN: Must be token')
    await expect(FeswaNFT.BidFeswaPair(other1.address, TokenB.address, other0.address,
            { ...overrides, value: stepPrice } ))
        .to.be.revertedWith('FESN: Must be token')
  })

  it('BidFeswaPair: EOA checking', async () => {
    await mineBlock(provider, BidStartTime + 1)

    // deploy NFTTester
    const NFTTester = await deployContract(wallet, NFTTesterCode )
    await NFTTester.setTestAddress(FeswaNFT.address, TokenA.address, TokenB.address)
    await wallet.sendTransaction({to: NFTTester.address, value: expandTo18Decimals(1)})

//    console.log("NFTTester.address, TokenA.address, TokenB.address", NFTTester.address, TokenA.address, TokenB.address)
//    const tokenIDMatch = utils.keccak256(utils.solidityPack(['address', 'address', 'address'],
//                            [FeswaNFT.address, TokenA.address, TokenB.address]))    
//    await expect(NFTTester.callNFTBidding()).to.emit(NFTTester, 'NFTTokenID').withArgs(tokenIDMatch)

    await expect(NFTTester.callNFTBidding()).to.be.revertedWith('Contract Not Allowed')
  })

  it('BidFeswaPair: New NFT creation with Zero value', async () => {
    await mineBlock(provider, BidStartTime + 1)
    const tokenIDMatch = utils.keccak256(
      utils.solidityPack(['address', 'address', 'address'],
        [FeswaNFT.address, TokenA.address, TokenB.address]))
    await expect(FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, other0.address,
      { ...overrides, value: 0 }))
      .to.emit(FeswaNFT, 'Transfer')
      .withArgs(constants.AddressZero, other0.address, tokenIDMatch)
      .to.emit(FeswaNFT, 'PairCreadted')
      .withArgs(TokenA.address, TokenB.address, tokenIDMatch)

    const NewFeswaPair = await FeswaNFT.ListPools(tokenIDMatch)
    const lastBlock = await provider.getBlock('latest')
    expect(NewFeswaPair.tokenA).to.deep.equal(TokenA.address)
    expect(NewFeswaPair.tokenB).to.deep.equal(TokenB.address)
    expect(NewFeswaPair.timeCreated).to.deep.equal(lastBlock.timestamp)
    expect(NewFeswaPair.lastBidTime).to.deep.equal(lastBlock.timestamp)
    expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.BidPhase)
    expect(NewFeswaPair.currentPrice).to.deep.equal(0)
    expect(await provider.getBalance(FeswaNFT.address)).to.eq(0)
  })

  it('BidFeswaPair: New NFT creation with none-Zero', async () => {
    await mineBlock(provider, BidStartTime + 1)
    const tokenIDMatch = utils.keccak256(
      utils.solidityPack(['address', 'address', 'address'],
        [FeswaNFT.address, TokenA.address, TokenB.address]))
    await expect(FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, other0.address,
      { ...overrides, value: stepPrice }))
      .to.emit(FeswaNFT, 'Transfer')
      .withArgs(constants.AddressZero, other0.address, tokenIDMatch)
      .to.emit(FeswaNFT, 'PairCreadted')
      .withArgs(TokenA.address, TokenB.address, tokenIDMatch)

    expect(await provider.getBalance(FeswaNFT.address)).to.eq(stepPrice)
  })

  it('BidFeswaPair: New NFT creation with price more than PriceLowLimit', async () => {
    await mineBlock(provider, BidStartTime + 1)
    const tokenIDMatch = utils.keccak256(
      utils.solidityPack(['address', 'address', 'address'],
        [FeswaNFT.address, TokenA.address, TokenB.address]))
    await expect(FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, other0.address,
      { ...overrides, value: stepPrice.mul(2) }))
      .to.emit(FeswaNFT, 'Transfer')
      .withArgs(constants.AddressZero, other0.address, tokenIDMatch)
      .to.emit(FeswaNFT, 'PairCreadted')
      .withArgs(TokenA.address, TokenB.address, tokenIDMatch)

    expect(await provider.getBalance(FeswaNFT.address)).to.eq(stepPrice.mul(2))
  })

  it('BidFeswaPair: NFT list content checking', async () => {
    await mineBlock(provider, BidStartTime + 1)
    const tokenIDMatch = utils.keccak256(
      utils.solidityPack(['address', 'address', 'address'],
        [FeswaNFT.address, TokenA.address, TokenB.address]))
    let bidtx
    let receipt
    bidtx = await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, other0.address,
                                          { ...overrides, value: stepPrice })
    
    receipt = await bidtx.wait()
    expect(receipt.gasUsed).to.eq('320444')       //320400 319620 319655 318898 296401 296358 294851 295514

    const NewFeswaPair = await FeswaNFT.ListPools(tokenIDMatch)
    const lastBlock = await provider.getBlock('latest')
    expect(NewFeswaPair.tokenA).to.deep.equal(TokenA.address)
    expect(NewFeswaPair.tokenB).to.deep.equal(TokenB.address)
    expect(NewFeswaPair.timeCreated).to.deep.equal(lastBlock.timestamp)
    expect(NewFeswaPair.lastBidTime).to.deep.equal(lastBlock.timestamp)
    expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.BidPhase)
    expect(NewFeswaPair.currentPrice).to.deep.equal(stepPrice)

    await mineBlock(provider, BidStartTime + 10)
    bidtx = await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, other0.address,
      { ...overrides, value: stepPrice.mul(2) })

    receipt = await bidtx.wait()
    expect(receipt.gasUsed).to.eq('111856')     // 111813 111033 111063 110632 103063 103020  101513 103122 98922

  })

  it('BidFeswaPair: NFT Normal creation, and address are swapped', async () => {
    // Normal creation
    await mineBlock(provider, BidStartTime + 1)
    const tokenIDMatch = utils.keccak256(
      utils.solidityPack(['address', 'address', 'address'],
        [FeswaNFT.address, TokenA.address, TokenB.address]))

    await expect(FeswaNFT.BidFeswaPair(TokenB.address, TokenA.address, other0.address,
      { ...overrides, value: stepPrice }))
      .to.emit(FeswaNFT, 'Transfer')
      .withArgs(constants.AddressZero, other0.address, tokenIDMatch)
  })

  it('BidFeswaPair: Checking for minimum 0.02 BNB increacement', async () => {
    // Normal creation
    await mineBlock(provider, BidStartTime + 1)
    await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
      { ...overrides, value: 0 })
    // Checking minimum 10% price increase
    await FeswaNFT.BidFeswaPair(TokenB.address, TokenA.address, other0.address,
      { ...overrides, value: stepPrice })
    const newPoolPrice = stepPrice.mul(2)
    await expect(FeswaNFT.connect(other0).BidFeswaPair(TokenA.address, TokenB.address, other0.address,
      { ...overrides, value: newPoolPrice.sub(1) }))
      .to.be.revertedWith('FESN: PAY LESS 2')
  })

  it('BidFeswaPair: Checking for minimum 2% increacement', async () => {
    // Normal creation
    await mineBlock(provider, BidStartTime + 1)
    await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
      { ...overrides, value: PriceOneETH })
    // Checking minimum 10% price increase
    const newPoolPrice = PriceOneETH.mul(102).div(100)
    await expect(FeswaNFT.connect(other0).BidFeswaPair(TokenA.address, TokenB.address, other0.address,
      { ...overrides, value: newPoolPrice.sub(1) }))
      .to.be.revertedWith('FESN: PAY LESS 1')
  })

  it('BidFeswaPair: Checking Bid duration', async () => {
    // Normal creation
    await mineBlock(provider, BidStartTime + 1)
    await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
      { ...overrides, value: stepPrice })

    // Check the 2 week bid duaration/
    const lastBlock = await provider.getBlock('latest')
    const newPoolPrice = stepPrice.mul(2)
    await mineBlock(provider, lastBlock.timestamp + OPEN_BID_DURATION + 1)
    await expect(FeswaNFT.connect(other0).BidFeswaPair(TokenA.address, TokenB.address, other0.address,
      { ...overrides, value: newPoolPrice }))
      .to.be.revertedWith('FESN: BID TOO LATE 1')
  })

  it('BidFeswaPair: Normal minimum 0.02 BNB increasement ', async () => {
    // Normal creation
    await mineBlock(provider, BidStartTime + 1)
    const tokenIDMatch = utils.keccak256(
      utils.solidityPack(['address', 'address', 'address'],
        [FeswaNFT.address, TokenA.address, TokenB.address]))

    const initPoolPrice1 = stepPrice.mul(2)
    await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
      { ...overrides, value: initPoolPrice1 })
    // get the wallet value                             
    const FeswaNFTBalance = await provider.getBalance(FeswaNFT.address)
    const WalletBalance = await provider.getBalance(wallet.address)
    const newPoolPrice = initPoolPrice1.add(stepPrice)

    // Normal bidding with 'Transfer' event
    await mineBlock(provider, BidStartTime + 10)
    await expect(FeswaNFT.connect(other0).BidFeswaPair(TokenA.address, TokenB.address, other0.address,
      { ...overrides, value: newPoolPrice }))
      .to.emit(FeswaNFT, 'Transfer')
      .withArgs(wallet.address, other0.address, tokenIDMatch)

    // Check the Bit Contract balance         
    expect(await provider.getBalance(FeswaNFT.address)).to.be.eq(FeswaNFTBalance.add(newPoolPrice.sub(initPoolPrice1)))

    // Check the first Bidder balance increasement        
    expect(await provider.getBalance(wallet.address)).to.be.eq(WalletBalance.add(initPoolPrice1))

  })


  it('BidFeswaPair: Checking 2% price increase ', async () => {
    // Normal creation
    await mineBlock(provider, BidStartTime + 1)
    const tokenIDMatch = utils.keccak256(
      utils.solidityPack(['address', 'address', 'address'],
        [FeswaNFT.address, TokenA.address, TokenB.address]))

    await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
      { ...overrides, value: PriceOneETH })
    // get the wallet value                             
    const FeswaNFTBalance = await provider.getBalance(FeswaNFT.address)
    const WalletBalance = await provider.getBalance(wallet.address)
    const newPoolPrice = PriceOneETH.mul(102).div(100)

    // Normal bidding with 'Transfer' event
    await mineBlock(provider, BidStartTime + 10)
    await expect(FeswaNFT.connect(other0).BidFeswaPair(TokenA.address, TokenB.address, other0.address,
      { ...overrides, value: newPoolPrice }))
      .to.emit(FeswaNFT, 'Transfer')
      .withArgs(wallet.address, other0.address, tokenIDMatch)

    // Check the Bit Contract balance         
    expect(await provider.getBalance(FeswaNFT.address)).to.be.eq(FeswaNFTBalance.add(newPoolPrice.sub(PriceOneETH)))

    // Check the first Bidder balance increasement        
    expect(await provider.getBalance(wallet.address)).to.be.eq(WalletBalance.add(PriceOneETH)) 
  })

  it('BidFeswaPair: Checking 10% price increase ', async () => {
    // Normal creation
    await mineBlock(provider, BidStartTime + 1)
    const tokenIDMatch = utils.keccak256(
      utils.solidityPack(['address', 'address', 'address'],
        [FeswaNFT.address, TokenA.address, TokenB.address]))

    await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
      { ...overrides, value: PriceOneETH })
    // get the wallet value                             
    const FeswaNFTBalance = await provider.getBalance(FeswaNFT.address)
    const WalletBalance = await provider.getBalance(wallet.address)
    const newPoolPrice = PriceOneETH.mul(110).div(100)

    // Normal bidding with 'Transfer' event
    await mineBlock(provider, BidStartTime + 10)
    await expect(FeswaNFT.connect(other1).BidFeswaPair(TokenA.address, TokenB.address, other1.address,
      { ...overrides, value: newPoolPrice }))
      .to.emit(FeswaNFT, 'Transfer')
      .withArgs(wallet.address, other1.address, tokenIDMatch)

    // Check the Bit Contract balance         
    expect(await provider.getBalance(FeswaNFT.address)).to.be.eq(FeswaNFTBalance.add(newPoolPrice.sub(PriceOneETH)))

    // Check the first Bidder balance increasement        
    expect(await provider.getBalance(wallet.address)).to.be.eq(WalletBalance.add(PriceOneETH))
  })

  it('BidFeswaPair: Checking for Bid with more than 10% higher price', async () => {
    // Normal creation
    await mineBlock(provider, BidStartTime + 1)
    const tokenIDMatch = utils.keccak256(
      utils.solidityPack(['address', 'address', 'address'],
        [FeswaNFT.address, TokenA.address, TokenB.address]))

    await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
      { ...overrides, value: PriceOneETH })

    // Checking minimum 10% price increase
    const newPoolPrice1 = PriceOneETH.mul(15).div(10)

    // Normal bidding with 'Transfer' event
    await mineBlock(provider, BidStartTime + 10)
    await FeswaNFT.connect(other0).BidFeswaPair(TokenA.address, TokenB.address, other0.address,
      { ...overrides, value: newPoolPrice1 })

    // get the wallet value                             
    const FeswaNFTBalance = await provider.getBalance(FeswaNFT.address)
    const other0Balance = await provider.getBalance(other0.address)

    // Checking minimum 10% price increase
    const newPoolPrice2 = newPoolPrice1.mul(15).div(10)

    // Normal bidding with 'Transfer' event
    await mineBlock(provider, BidStartTime + 20)
    await expect(FeswaNFT.connect(other1).BidFeswaPair(TokenB.address, TokenA.address, other1.address,
      { ...overrides, value: newPoolPrice2 }))
      .to.emit(FeswaNFT, 'Transfer')
      .withArgs(other0.address, other1.address, tokenIDMatch)

    // Check the Bit Contract balance       
    expect(await provider.getBalance(FeswaNFT.address)).to.be.eq(FeswaNFTBalance.add(newPoolPrice2.sub(newPoolPrice1)))

    // Check the first Bidder balance increasement
    expect(await provider.getBalance(other0.address)).to.be.eq(other0Balance.add(newPoolPrice1))
  })

})

describe('FeswaNFT: Hard airdrop cap test', () => {
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
  let TokenC: Contract
  let TokenD: Contract

  let FeswaNFT: Contract
  let Feswa: Contract
  let tokenIDMatchAB: string
  let tokenIDMatchAC: string
  let tokenIDMatchAD: string

  beforeEach('load fixture', async () => {
    const fixture = await loadFixture(FeswaNFTFixturePatch)
    TokenA = fixture.TokenA
    TokenB = fixture.TokenB
    FeswaNFT = fixture.FeswaNFT
    Feswa = fixture.Feswa
    let token0, token1: string

    await Feswa.transfer(FeswaNFT.address, expandTo18Decimals(200_000_000))
    TokenC = await deployContract(wallet, TestERC20, ['Test ERC20 C', 'TKC', 18, expandTo18Decimals(1000_000)])
    TokenD = await deployContract(wallet, TestERC20, ['Test ERC20 D', 'TKD', 18, expandTo18Decimals(1000_000)])

    tokenIDMatchAB =  utils.keccak256(utils.solidityPack( ['address', 'address', 'address'],
                                                          [FeswaNFT.address, TokenA.address, TokenB.address]))
    { [ token0, token1 ]  = TokenA.address.toLowerCase() <= TokenC.address.toLowerCase() 
                                  ? [TokenA.address, TokenC.address] : [TokenC.address, TokenA.address] 

      tokenIDMatchAC = utils.keccak256(utils.solidityPack(['address', 'address', 'address'], [FeswaNFT.address, token0, token1]))
    }
    { [token0, token1]  = TokenA.address.toLowerCase() <= TokenD.address.toLowerCase() 
                                  ? [TokenA.address, TokenD.address] : [TokenD.address, TokenA.address] 

      tokenIDMatchAD = utils.keccak256(utils.solidityPack(['address', 'address', 'address'], [FeswaNFT.address, token0, token1]))
    }
  })

  it('FeswaNFT Bidding: Hard airdrop cap test', async () => {
    // Normal creation
    const PriceOfETH300 = expandTo18Decimals(300)
    const PriceOfETH500 = expandTo18Decimals(500)
    const PriceOfETH1000 = expandTo18Decimals(1000)
    const Wallet_Init: BigNumber = await Feswa.balanceOf(wallet.address)

    await mineBlock(provider, BidStartTime + 1)
    await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, wallet.address, { ...overrides, value: PriceOfETH1000 }) // Wallet: 1000

    await mineBlock(provider, BidStartTime + 10)
    await FeswaNFT.connect(other0).BidFeswaPair(TokenA.address, TokenC.address, other0.address, { ...overrides, value: PriceOfETH500 }) //othter0: 500

    await mineBlock(provider, BidStartTime + 15)
    await FeswaNFT.BidFeswaPair(TokenA.address, TokenC.address, wallet.address, { ...overrides, value: PriceOfETH1000 })   //Wallet: 1000+500

    await mineBlock(provider, BidStartTime + 20)
    await FeswaNFT.connect(other0).BidFeswaPair(TokenA.address, TokenB.address, other0.address,                           //other0: 500+300
            { ...overrides, value: PriceOfETH1000.add(PriceOfETH300) })

    // Hard cap reached here: only airdrop of 200ETH is distributed    
    await mineBlock(provider, BidStartTime + 25)     
    await FeswaNFT.connect(other0).BidFeswaPair(TokenA.address, TokenC.address, other0.address,                           //other0: 500+300+300(200)
            { ...overrides, value: PriceOfETH1000.add(PriceOfETH300) })
    const lastBlock = await provider.getBlock('latest')

    await mineBlock(provider, BidStartTime + 30)  
    await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, wallet.address, 
          { ...overrides, value: PriceOfETH1000.add(PriceOfETH300).add(PriceOfETH500) })                                  // Wallet: 1000+500+500(0)

    await mineBlock(provider, BidStartTime + 35)  
    await FeswaNFT.connect(other1).BidFeswaPair(TokenA.address, TokenD.address, other1.address, 
          { ...overrides, value: PriceOfETH500 })                                                                         // other1: only initial airdrop

    // Check the Bid Contract balance       
    expect(await provider.getBalance(FeswaNFT.address)).to.be.eq(expandTo18Decimals(3600))
    expect(await Feswa.balanceOf(other0.address)).to.be.eq(expandTo18Decimals(1000).mul(AIRDROP_RATE_FOR_NEXT).add(AIRDROP_FOR_FIRST))
    expect(await Feswa.balanceOf(wallet.address))
            .to.be.eq(expandTo18Decimals(1500).mul(AIRDROP_RATE_FOR_NEXT).add(AIRDROP_FOR_FIRST).add(Wallet_Init))
    expect(await Feswa.balanceOf(other1.address)).to.be.eq(AIRDROP_FOR_FIRST)

    // Only First initial creation airdrop        
    expect(await FeswaNFT.TotalBidValue()).to.eq(expandTo18Decimals(3600))
    expect(await FeswaNFT.AirdropDepletionTime()).to.eq(lastBlock.timestamp)   

    const FeswBalanaceWallet = await Feswa.balanceOf(wallet.address)
    const FeswBalanaceOther0 = await Feswa.balanceOf(other0.address)
    const FeswBalanaceOther1 = await Feswa.balanceOf(other1.address)
    
    await mineBlock(provider, BidStartTime + 40 + OPEN_BID_DURATION) 
    await FeswaNFT.ManageFeswaPair(tokenIDMatchAB, wallet.address, 10, 0 )
    await FeswaNFT.connect(other0).ManageFeswaPair(tokenIDMatchAC, other0.address, 10, 0 )
    await FeswaNFT.connect(other1).ManageFeswaPair(tokenIDMatchAD, other1.address, 10, 0 )

    expect(await Feswa.balanceOf(wallet.address)).to.be.eq(FeswBalanaceWallet.add(expandTo18Decimals(1800).mul(AIRDROP_RATE_FOR_WINNER)))
    expect(await Feswa.balanceOf(other0.address)).to.be.eq(FeswBalanaceOther0.add(expandTo18Decimals(1300).mul(AIRDROP_RATE_FOR_WINNER)))
    expect(await Feswa.balanceOf(other1.address)).to.be.eq(FeswBalanaceOther1)
  })
})

describe('BidFeswaReclaim: reclaim after the maxim delaying', () => {
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
    const fixture = await loadFixture(FeswaNFTFixturePatch)
    TokenA = fixture.TokenA
    TokenB = fixture.TokenB
    Feswa = fixture.Feswa
    FeswaNFT =  new Contract(fixture.FeswaNFT.address, JSON.stringify(FeswaNFTCode.abi), wallet) 
  })

  it('BidFeswaState: reclaim for normal ending biding', async () => {
    await mineBlock(provider, BidStartTime + 1)
    const tokenIDMatch = utils.keccak256(
      utils.solidityPack(['address', 'address', 'address'],
        [FeswaNFT.address, TokenA.address, TokenB.address]))
    // check first airdrop                                                
    let walletBalance = await Feswa.balanceOf(wallet.address)
    await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
      { ...overrides, value: 0 })
    expect(await Feswa.balanceOf(wallet.address)).to.be.eq(walletBalance.add(AIRDROP_FOR_FIRST))

    // 2nd bid                       
    let lastBlock = await provider.getBlock('latest')
    let creatTime = lastBlock.timestamp
    await mineBlock(provider, creatTime + OPEN_BID_DURATION - CLOSE_BID_DELAY - 10)
    await FeswaNFT.connect(other0).BidFeswaPair(TokenA.address, TokenB.address, other0.address,
      { ...overrides, value: stepPrice.mul(2) })

    // 3rd bid                       
    await mineBlock(provider, creatTime + OPEN_BID_DURATION - CLOSE_BID_DELAY - 3)
    await FeswaNFT.connect(other0).BidFeswaPair(TokenA.address, TokenB.address, other0.address,
      { ...overrides, value: stepPrice.mul(10) })

    expect(await FeswaNFT.ownerOf(tokenIDMatch)).to.be.eq(other0.address)

    await mineBlock(provider, creatTime + OPEN_BID_DURATION + RECLAIM_DURATION - 1)  

    await expect(FeswaNFT.connect(other1).BidFeswaPair(TokenA.address, TokenB.address, other1.address,
      { ...overrides, value: stepPrice.mul(10) }))
      .to.be.revertedWith('FESN: BID TOO LATE 1')

    const other0ETHBalance = await provider.getBalance(other0.address)
    const other0FESWBalance = await Feswa.balanceOf(other0.address)

    await mineBlock(provider, creatTime + OPEN_BID_DURATION + RECLAIM_DURATION + 1)  

    await FeswaNFT.connect(other1).BidFeswaPair(TokenA.address, TokenB.address, other1.address,
      { ...overrides, value: stepPrice.mul(3) })

    lastBlock = await provider.getBlock('latest')
    let NewFeswaPair = await FeswaNFT.ListPools(tokenIDMatch)

    expect(NewFeswaPair.tokenA).to.deep.equal(TokenA.address)
    expect(NewFeswaPair.tokenB).to.deep.equal(TokenB.address)
    expect(NewFeswaPair.timeCreated).to.deep.equal(lastBlock.timestamp)
    expect(NewFeswaPair.lastBidTime).to.deep.equal(lastBlock.timestamp)
    expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.BidPhase)
    expect(NewFeswaPair.currentPrice).to.deep.equal(stepPrice.mul(3))

    expect(await provider.getBalance(other0.address)).to.be.eq(other0ETHBalance.add(stepPrice.mul(10).div(2)))
    expect(await Feswa.balanceOf(other0.address)).to.be.eq(other0FESWBalance.add(stepPrice.mul(10).div(2).mul(AIRDROP_RATE_FOR_WINNER)))

    expect(await Feswa.balanceOf(other1.address)).to.be.eq(stepPrice.mul(3).mul(AIRDROP_RATE_FOR_NEXT))
    expect(await FeswaNFT.ownerOf(tokenIDMatch)).to.be.eq(other1.address)
  })

  it('BidFeswaState: reclaim for delaying ending biding', async () => {
    await mineBlock(provider, BidStartTime + 1)
    const tokenIDMatch = utils.keccak256(
      utils.solidityPack(['address', 'address', 'address'],
        [FeswaNFT.address, TokenA.address, TokenB.address]))
    // check first airdrop                                                
    let walletBalance = await Feswa.balanceOf(wallet.address)
    await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
      { ...overrides, value: stepPrice })
    expect(await Feswa.balanceOf(wallet.address)).to.be.eq(walletBalance.add(AIRDROP_FOR_FIRST).add(stepPrice.mul(AIRDROP_RATE_FOR_NEXT)))

    // 2nd bid          
    let lastBlock = await provider.getBlock('latest')
    let creatTime = lastBlock.timestamp
    await mineBlock(provider, creatTime + OPEN_BID_DURATION - CLOSE_BID_DELAY - 10)
    await FeswaNFT.connect(other0).BidFeswaPair(TokenA.address, TokenB.address, other0.address,
      { ...overrides, value: stepPrice.mul(7) })

    // 3rd bid: enter delaying phase   
    await mineBlock(provider, creatTime + OPEN_BID_DURATION - CLOSE_BID_DELAY + 10)
    await FeswaNFT.connect(other0).BidFeswaPair(TokenA.address, TokenB.address, other0.address,
      { ...overrides, value: stepPrice.mul(16) })

    expect(await FeswaNFT.ownerOf(tokenIDMatch)).to.be.eq(other0.address)

    lastBlock = await provider.getBlock('latest')
    let NewFeswaPair = await FeswaNFT.ListPools(tokenIDMatch)

    expect(NewFeswaPair.tokenA).to.deep.equal(TokenA.address)
    expect(NewFeswaPair.tokenB).to.deep.equal(TokenB.address)
    expect(NewFeswaPair.timeCreated).to.deep.equal(creatTime)
    expect(NewFeswaPair.lastBidTime).to.deep.equal(lastBlock.timestamp)
    expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.BidDelaying)
    expect(NewFeswaPair.currentPrice).to.deep.equal(stepPrice.mul(16))
                   
    await mineBlock(provider, lastBlock.timestamp + RECLAIM_DURATION - 1)  
    await expect(FeswaNFT.connect(other1).BidFeswaPair(TokenA.address, TokenB.address, other1.address,
      { ...overrides, value: stepPrice.mul(5) }))
      .to.be.revertedWith('FESN: BID TOO LATE 2')

    const other0ETHBalance = await provider.getBalance(other0.address)
    const other0FESWBalance = await Feswa.balanceOf(other0.address)

    await mineBlock(provider, lastBlock.timestamp + OPEN_BID_DURATION + RECLAIM_DURATION + 1)  
    await FeswaNFT.connect(other1).BidFeswaPair(TokenA.address, TokenB.address, other1.address,
      { ...overrides, value: stepPrice.mul(5) })

    lastBlock = await provider.getBlock('latest')
    NewFeswaPair = await FeswaNFT.ListPools(tokenIDMatch)

    expect(NewFeswaPair.tokenA).to.deep.equal(TokenA.address)
    expect(NewFeswaPair.tokenB).to.deep.equal(TokenB.address)
    expect(NewFeswaPair.timeCreated).to.deep.equal(lastBlock.timestamp)
    expect(NewFeswaPair.lastBidTime).to.deep.equal(lastBlock.timestamp)
    expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.BidPhase)
    expect(NewFeswaPair.currentPrice).to.deep.equal(stepPrice.mul(5))

    expect(await provider.getBalance(other0.address)).to.be.eq(other0ETHBalance.add(stepPrice.mul(16).div(2)))
    expect(await Feswa.balanceOf(other0.address)).to.be.eq(other0FESWBalance.add(stepPrice.mul(16).div(2).mul(AIRDROP_RATE_FOR_WINNER)))
    expect(await Feswa.balanceOf(other1.address)).to.be.eq(stepPrice.mul(5).mul(AIRDROP_RATE_FOR_NEXT))
    expect(await FeswaNFT.ownerOf(tokenIDMatch)).to.be.eq(other1.address)
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
    const fixture = await loadFixture(FeswaNFTFixturePatch)
    TokenA = fixture.TokenA
    TokenB = fixture.TokenB
    Feswa = fixture.Feswa
    FeswaNFT =  new Contract(fixture.FeswaNFT.address, JSON.stringify(FeswaNFTCode.abi), wallet) 
  })

  it('BidFeswaState: Not enter daley duration 2 hours before end of 3-day duratoin', async () => {
    await mineBlock(provider, BidStartTime + 1)
    const tokenIDMatch = utils.keccak256(
      utils.solidityPack(['address', 'address', 'address'],
        [FeswaNFT.address, TokenA.address, TokenB.address]))
    // check first airdrop                                                
    let walletBalance = await Feswa.balanceOf(wallet.address)
    await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
      { ...overrides, value: 0 })
    expect(await Feswa.balanceOf(wallet.address)).to.be.eq(walletBalance.add(AIRDROP_FOR_FIRST))

    // still in BidPhase at last second, and check airdrop                            
    let lastBlock = await provider.getBlock('latest')
    let creatTime = lastBlock.timestamp
    await mineBlock(provider, lastBlock.timestamp + OPEN_BID_DURATION - CLOSE_BID_DELAY - 2)
    await FeswaNFT.connect(other0).BidFeswaPair(TokenA.address, TokenB.address, other0.address,
      { ...overrides, value: stepPrice })

    lastBlock = await provider.getBlock('latest')
    let NewFeswaPair = await FeswaNFT.ListPools(tokenIDMatch)
    expect(NewFeswaPair.tokenA).to.deep.equal(TokenA.address)
    expect(NewFeswaPair.tokenB).to.deep.equal(TokenB.address)
    expect(NewFeswaPair.timeCreated).to.deep.equal(creatTime)
    expect(NewFeswaPair.lastBidTime).to.deep.equal(lastBlock.timestamp)
    expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.BidPhase)
    expect(NewFeswaPair.currentPrice).to.deep.equal(stepPrice)
    expect(await Feswa.balanceOf(other0.address)).to.be.eq(stepPrice.mul(AIRDROP_RATE_FOR_NEXT))

    // enter delaying state from last second
    await mineBlock(provider, creatTime + OPEN_BID_DURATION - CLOSE_BID_DELAY)
    await FeswaNFT.connect(other1).BidFeswaPair(TokenA.address, TokenB.address, other1.address,
      { ...overrides, value: stepPrice.mul(3) })

    lastBlock = await provider.getBlock('latest')
    NewFeswaPair = await FeswaNFT.ListPools(tokenIDMatch)
    expect(NewFeswaPair.tokenA).to.deep.equal(TokenA.address)
    expect(NewFeswaPair.tokenB).to.deep.equal(TokenB.address)
    expect(NewFeswaPair.timeCreated).to.deep.equal(creatTime)
    expect(NewFeswaPair.lastBidTime).to.deep.equal(lastBlock.timestamp)
    expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.BidDelaying)
    expect(NewFeswaPair.currentPrice).to.deep.equal(stepPrice.mul(3))
    expect(await Feswa.balanceOf(other1.address)).to.be.eq(stepPrice.mul(3-1).mul(AIRDROP_RATE_FOR_NEXT))

    // keep in delaying state if no more than CLOSE_BID_DELAY
    lastBlock = await provider.getBlock('latest')
    await mineBlock(provider, lastBlock.timestamp + CLOSE_BID_DELAY - 2)
    await FeswaNFT.connect(other0).BidFeswaPair(TokenA.address, TokenB.address, other0.address,
      { ...overrides, value: stepPrice.mul(4) })

    // delaying again at last second
    lastBlock = await provider.getBlock('latest')
    NewFeswaPair = await FeswaNFT.ListPools(tokenIDMatch)
    expect(NewFeswaPair.tokenA).to.deep.equal(TokenA.address)
    expect(NewFeswaPair.tokenB).to.deep.equal(TokenB.address)
    expect(NewFeswaPair.timeCreated).to.deep.equal(creatTime)
    expect(NewFeswaPair.lastBidTime).to.deep.equal(lastBlock.timestamp)
    expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.BidDelaying)
    expect(NewFeswaPair.currentPrice).to.deep.equal(stepPrice.mul(4))
    expect(await Feswa.balanceOf(other0.address)).to.be.eq(stepPrice.mul(AIRDROP_RATE_FOR_NEXT*2))

    // overflow the maximum delaying
    lastBlock = await provider.getBlock('latest')
    await mineBlock(provider, lastBlock.timestamp + CLOSE_BID_DELAY + 1)
    await expect(FeswaNFT.connect(other1).BidFeswaPair(TokenA.address, TokenB.address, other1.address,
      { ...overrides, value: stepPrice.mul(5) }))
      .to.be.revertedWith('FESN: BID TOO LATE 2')
  })
})

describe('ManageFeswaPair: checking state and airdrop amount to winner', () => {
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
  let FeswaFactory: Contract

  beforeEach('load fixture', async () => {
    const fixture = await loadFixture(FeswaNFTFixturePatch)
    TokenA = fixture.TokenA
    TokenB = fixture.TokenB
    Feswa = fixture.Feswa
    FeswaNFT =  new Contract(fixture.FeswaNFT.address, JSON.stringify(FeswaNFTCode.abi), wallet) 
    FeswaFactory = fixture.Factory
  })

  it('ManageFeswaPair: Check Owner', async () => {
    await mineBlock(provider, BidStartTime + 1)
    const tokenIDMatch = utils.keccak256(
      utils.solidityPack(['address', 'address', 'address'],
        [FeswaNFT.address, TokenA.address, TokenB.address]))
    // check first airdrop                                                
    await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
      { ...overrides, value: stepPrice })

    // still in BidPhase at last second, and check airdrop                            
    let lastBlock = await provider.getBlock('latest')
    await mineBlock(provider, lastBlock.timestamp + OPEN_BID_DURATION + 1)
    await expect(FeswaNFT.connect(other1).ManageFeswaPair(tokenIDMatch, other1.address, 10, 0))
      .to.be.revertedWith('FESN: NOT TOKEN OWNER')
  })

  it('ManageFeswaPair: Bid time out from BidPhase ', async () => {
    await mineBlock(provider, BidStartTime + 1)
    const tokenIDMatch = utils.keccak256(
      utils.solidityPack(['address', 'address', 'address'],
        [FeswaNFT.address, TokenA.address, TokenB.address]))
    // check first airdrop                                                
    await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
      { ...overrides, value: stepPrice })

    // still in BidPhase                           
    let lastBlock = await provider.getBlock('latest')
    await mineBlock(provider, lastBlock.timestamp + OPEN_BID_DURATION / 2)
    await FeswaNFT.connect(other0).BidFeswaPair(TokenA.address, TokenB.address, other0.address,
      { ...overrides, value: stepPrice.mul(2) })

    let NewFeswaPair = await FeswaNFT.ListPools(tokenIDMatch)
    expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.BidPhase)
    await expect(FeswaNFT.connect(other0).ManageFeswaPair(tokenIDMatch, other0.address, 10, 0))
      .to.be.revertedWith('FESN: BID ON GOING 1')

    // BidPhase time out
    lastBlock = await provider.getBlock('latest')
    await mineBlock(provider, lastBlock.timestamp + OPEN_BID_DURATION + 1)
    await FeswaNFT.connect(other0).ManageFeswaPair(tokenIDMatch, other0.address, 10, 0)

    NewFeswaPair = await FeswaNFT.ListPools(tokenIDMatch)
    expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.BidSettled)
    expect(await Feswa.balanceOf(other0.address))
      .to.be.eq(stepPrice.mul(AIRDROP_RATE_FOR_NEXT).add(stepPrice.mul(2).mul(AIRDROP_RATE_FOR_WINNER)))

    const [pairAddressAAB, pairAddressABB] = await FeswaFactory.getPair(TokenA.address, TokenB.address)
    const pairAAB = new Contract(pairAddressAAB, JSON.stringify(FeSwapPair.abi), provider)
    const pairABB = new Contract(pairAddressABB, JSON.stringify(FeSwapPair.abi), provider)

    expect(await pairAAB.pairOwner()).to.be.eq(other0.address)
    expect(await pairABB.pairOwner()).to.be.eq(other0.address)
    expect(await pairAAB.getTriggerRate()).to.be.eq(10000 + 10*4 + 10*6)
    expect(await pairABB.getTriggerRate()).to.be.eq(10000 + 10*4 + 10*6)
      
  })

  it('ManageFeswaPair: Bid time out from BidDelaying phase ', async () => {
    await mineBlock(provider, BidStartTime + 1)
    const tokenIDMatch = utils.keccak256(
      utils.solidityPack(['address', 'address', 'address'],
        [FeswaNFT.address, TokenA.address, TokenB.address]))
    // First Bid                                               
    await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
      { ...overrides, value: stepPrice })

    // Second tender                             
    let lastBlock = await provider.getBlock('latest')
    await mineBlock(provider, lastBlock.timestamp + OPEN_BID_DURATION - 10)
    await FeswaNFT.connect(other0).BidFeswaPair(TokenA.address, TokenB.address, other0.address,
      { ...overrides, value: stepPrice.mul(2) })

    let NewFeswaPair = await FeswaNFT.ListPools(tokenIDMatch)
    expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.BidDelaying)

    await expect(FeswaNFT.connect(other0).ManageFeswaPair(tokenIDMatch, other0.address, 15, 0))
      .to.be.revertedWith('FESN: BID ON GOING 2')

    // BidDelaying time out
    lastBlock = await provider.getBlock('latest')
    await mineBlock(provider, lastBlock.timestamp + CLOSE_BID_DELAY + 1)
    await FeswaNFT.connect(other0).ManageFeswaPair(tokenIDMatch, other1.address, 15, 0)

    NewFeswaPair = await FeswaNFT.ListPools(tokenIDMatch)
    expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.BidSettled)
    expect(await Feswa.balanceOf(other0.address))
      .to.be.eq(stepPrice.mul(AIRDROP_RATE_FOR_NEXT).add(stepPrice.mul(2).mul(AIRDROP_RATE_FOR_WINNER)))

    const [pairAddressAAB, pairAddressABB] = await FeswaFactory.getPair(TokenA.address, TokenB.address)
    const pairAAB = new Contract(pairAddressAAB, JSON.stringify(FeSwapPair.abi), provider)
    const pairABB = new Contract(pairAddressABB, JSON.stringify(FeSwapPair.abi), provider)

    expect(await pairAAB.pairOwner()).to.be.eq(other1.address)
    expect(await pairABB.pairOwner()).to.be.eq(other1.address)
    expect(await pairAAB.getTriggerRate()).to.be.eq(10000 + 10*4 + 15*6)
    expect(await pairABB.getTriggerRate()).to.be.eq(10000 + 10*4 + 15*6)

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
    const fixture = await loadFixture(FeswaNFTFixturePatch)
    TokenA = fixture.TokenA
    TokenB = fixture.TokenB
    FeswaNFT =  new Contract(fixture.FeswaNFT.address, JSON.stringify(FeswaNFTCode.abi), wallet) 

    // Normal NFT creation
    await mineBlock(provider, BidStartTime + 1)
    await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
      { ...overrides, value: stepPrice })
    tokenIDMatch = utils.keccak256(utils.solidityPack(['address', 'address', 'address'],
      [FeswaNFT.address, TokenA.address, TokenB.address]))
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
    await mineBlock(provider, lastBlock.timestamp + OPEN_BID_DURATION - 2)
    await FeswaNFT.connect(other0).BidFeswaPair(TokenA.address, TokenB.address, other0.address,
      { ...overrides, value: stepPrice.mul(2) })

    let NewFeswaPair = await FeswaNFT.ListPools(tokenIDMatch)
    expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.BidDelaying)

    await expect(FeswaNFT.connect(other0).FeswaPairForSale(tokenIDMatch, PoolSalePrice))
      .to.be.revertedWith('FESN: BID NOT SETTLED')

    // BidDelaying time out
    lastBlock = await provider.getBlock('latest')
    await mineBlock(provider, lastBlock.timestamp + CLOSE_BID_DELAY + 1)
    await FeswaNFT.connect(other0).ManageFeswaPair(tokenIDMatch, other0.address, 10, 0)

    NewFeswaPair = await FeswaNFT.ListPools(tokenIDMatch)
    expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.BidSettled)

    // For Sale 
    await FeswaNFT.connect(other0).FeswaPairForSale(tokenIDMatch, PoolSalePrice)
    NewFeswaPair = await FeswaNFT.ListPools(tokenIDMatch)
    expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.PoolForSale)

    // Close Sale
    await FeswaNFT.connect(other0).FeswaPairForSale(tokenIDMatch, 0)
    NewFeswaPair = await FeswaNFT.ListPools(tokenIDMatch)
    expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.PoolHolding)

    // For Sale again from PoolHolding phase
    await FeswaNFT.connect(other0).FeswaPairForSale(tokenIDMatch, PoolSalePrice)
    NewFeswaPair = await FeswaNFT.ListPools(tokenIDMatch)
    expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.PoolForSale)
  })

  it('FeswaPairForSale: Normal execution and Checking', async () => {
    // Check the 2 week bid duaration/
    const lastBlock = await provider.getBlock('latest')
    await mineBlock(provider, lastBlock.timestamp + OPEN_BID_DURATION + 1)
    await FeswaNFT.ManageFeswaPair(tokenIDMatch, wallet.address, 10, 0)
    await FeswaNFT.FeswaPairForSale(tokenIDMatch, PoolSalePrice)

    // checking
    let NewFeswaPair = await FeswaNFT.ListPools(tokenIDMatch)
    expect(NewFeswaPair.tokenA).to.deep.equal(TokenA.address)
    expect(NewFeswaPair.tokenB).to.deep.equal(TokenB.address)
    expect(NewFeswaPair.timeCreated).to.deep.equal(lastBlock.timestamp)
    expect(NewFeswaPair.poolState).to.deep.equal(PoolRunningPhase.PoolForSale)
    expect(NewFeswaPair.currentPrice).to.deep.equal(PoolSalePrice)

    // Set Price again
    await FeswaNFT.FeswaPairForSale(tokenIDMatch, PoolSalePrice.mul(2))

    // checking
    NewFeswaPair = await FeswaNFT.ListPools(tokenIDMatch)
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
  let FeswaNFTPatch: Contract
  let tokenIDMatch: string
  let createBlock: Block
  const PoolSalePrice = expandTo18Decimals(2)

  beforeEach('load fixture', async () => {
    const fixture = await loadFixture(FeswaNFTFixturePatch)
    TokenA = fixture.TokenA
    TokenB = fixture.TokenB
    FeswaNFT =  new Contract(fixture.FeswaNFT.address, JSON.stringify(FeswaNFTCode.abi), wallet) 
    FeswaNFTPatch =  new Contract(fixture.FeswaNFT.address, JSON.stringify(FeswaNFTPatchPureCode.abi), wallet)


    // Normal NFT creation
    await mineBlock(provider, BidStartTime + 1)
    await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
      { ...overrides, value: stepPrice })
    tokenIDMatch = utils.keccak256(utils.solidityPack(['address', 'address', 'address'],
      [FeswaNFT.address, TokenA.address, TokenB.address]))
    // Set for sale 
    createBlock = await provider.getBlock('latest')
    await mineBlock(provider, createBlock.timestamp + OPEN_BID_DURATION + 1)
    await FeswaNFT.ManageFeswaPair(tokenIDMatch, wallet.address, 10, 0)
  })

  it('FeswaPairBuyIn: Wrong TokenID', async () => {
    await expect(FeswaNFTPatch.FeswaPairBuyInPatch('0xFFFFFFFF', PoolSalePrice, other0.address,
      { ...overrides, value: PoolSalePrice }))
      .to.be.revertedWith('FESN: TOKEN NOT CREATED')
  })

  it('FeswaPairBuyIn: Owner Checking', async () => {
    await expect(FeswaNFTPatch.connect(other0).FeswaPairBuyInPatch(tokenIDMatch, PoolSalePrice, other0.address,
      { ...overrides, value: PoolSalePrice }))
      .to.be.revertedWith('FESN: NOT FOR SALE')
  })

  it('FeswaPairBuyIn: Buy with lower Price', async () => {
    await FeswaNFT.FeswaPairForSale(tokenIDMatch, PoolSalePrice)
    await expect(FeswaNFTPatch.connect(other0).FeswaPairBuyInPatch(tokenIDMatch, PoolSalePrice, other0.address,
      { ...overrides, value: PoolSalePrice.sub(1) }))
      .to.be.revertedWith('FESN: PAY LESS')
  })

  it('FeswaPairBuyIn: Normal Buying: New Price', async () => {
    await FeswaNFT.FeswaPairForSale(tokenIDMatch, PoolSalePrice)
    // get the wallet value                             
    const FeswaNFTBalance = await provider.getBalance(FeswaNFT.address)
    const WalletBalance = await provider.getBalance(wallet.address)

    const NewPoolSalePrice = expandTo18Decimals(3)
    await expect(FeswaNFTPatch.connect(other0).FeswaPairBuyInPatch(tokenIDMatch, NewPoolSalePrice, other0.address,
      { ...overrides, value: PoolSalePrice }))
      .to.emit(FeswaNFT, 'Transfer')
      .withArgs(wallet.address, other0.address, tokenIDMatch)

    // checking
    const NewFeswaPair = await FeswaNFT.ListPools(tokenIDMatch)
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
    await expect(FeswaNFTPatch.connect(other0).FeswaPairBuyInPatch(tokenIDMatch, 0, other0.address,
      { ...overrides, value: PoolSalePrice }))
      .to.emit(FeswaNFT, 'Transfer')
      .withArgs(wallet.address, other0.address, tokenIDMatch)

    // checking
    const NewFeswaPair = await FeswaNFT.ListPools(tokenIDMatch)
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
    const tx = await FeswaNFTPatch.connect(other0).FeswaPairBuyInPatch(tokenIDMatch, 0, other0.address,
      { ...overrides, value: PoolSalePrice.mul(2) })
    const receipt = await tx.wait()
    expect(receipt.gasUsed).to.eq('133341')     // 133657 134472 139354 140334

    // checking
    const NewFeswaPair = await FeswaNFT.ListPools(tokenIDMatch)
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
    const fixture = await loadFixture(FeswaNFTFixturePatch)
    TokenA = fixture.TokenA
    TokenB = fixture.TokenB
    Feswa = fixture.Feswa
    FeswaNFT =  new Contract(fixture.FeswaNFT.address, JSON.stringify(FeswaNFTCode.abi), wallet) 

    // Normal NFT creation
    await mineBlock(provider, BidStartTime + 1)
    await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
      { ...overrides, value: stepPrice })
    tokenIDMatch = utils.keccak256(utils.solidityPack(['address', 'address', 'address'],
      [FeswaNFT.address, TokenA.address, TokenB.address]))
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
    expect(poolInfo.pairInfo.currentPrice).to.deep.equal(stepPrice)

    const poolInfoBA = await FeswaNFT.getPoolInfoByTokens(TokenB.address, TokenA.address)
    expect(poolInfo).to.deep.equal(poolInfoBA)
  })

  it('getPoolTokens: Token ID not existed', async () => {
    //      await expect(FeswaNFT.getPoolTokens('0xFFFFFFFFFFF')).to.be.revertedWith('FESN: NOT TOKEN OWNER')  
    const poolInfo = await FeswaNFT.getPoolInfo('0xFFFFFFFFFFF')
    expect(poolInfo.nftOwner).to.deep.equal(constants.AddressZero)
    expect(poolInfo.pairInfo.tokenA).to.deep.equal(constants.AddressZero)
    expect(poolInfo.pairInfo.tokenB).to.deep.equal(constants.AddressZero)
  })

  it('getPoolTokens: Normal', async () => {
    //      expect(await FeswaNFT.getPoolInfo(tokenIDMatch)).to.deep.eq([TokenA.address, TokenB.address])  
    const poolInfo = await FeswaNFT.getPoolInfo(tokenIDMatch)
    expect(poolInfo.nftOwner).to.deep.equal(wallet.address)
    expect(poolInfo.pairInfo.tokenA).to.deep.equal(TokenA.address)
    expect(poolInfo.pairInfo.tokenB).to.deep.equal(TokenB.address)
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
    const fixture = await loadFixture(FeswaNFTFixturePatch)
    TokenA = fixture.TokenA
    TokenB = fixture.TokenB
    FeswaNFT =  new Contract(fixture.FeswaNFT.address, JSON.stringify(FeswaNFTCode.abi), wallet) 

    // Normal NFT creation
    await mineBlock(provider, BidStartTime + 1)
    await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
      { ...overrides, value: stepPrice })
  })

  it('withdraw: Only Owner', async () => {
    await expect(FeswaNFT.connect(other0).withdraw(other1.address, stepPrice))
      .to.be.revertedWith('Ownable: caller is not the owner')
  })

  it('withdraw: Withdraw too more', async () => {
    await expect(FeswaNFT.withdraw(other1.address, stepPrice.add(1)))
      .to.be.revertedWith('FESN: INSUFFICIENT BALANCE')
  })

  it('withdraw: Withdraw normally', async () => {
    const FeswaNFTBalance = await provider.getBalance(FeswaNFT.address)
    const other1Balance = await provider.getBalance(other1.address)
    await FeswaNFT.withdraw(other1.address, stepPrice.div(3))

    // Check the balance
    expect(await provider.getBalance(FeswaNFT.address)).to.be.eq(FeswaNFTBalance.sub(stepPrice.div(3)))
    expect(await provider.getBalance(other1.address)).to.be.eq(other1Balance.add(stepPrice.div(3)))
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
    const fixture = await loadFixture(FeswaNFTFixturePatch)
    TokenA = fixture.TokenA
    TokenB = fixture.TokenB
    FeswaNFT =  new Contract(fixture.FeswaNFT.address, JSON.stringify(FeswaNFTCode.abi), wallet) 

    const TokenC = await deployContract(wallet, TestERC20, ['Test ERC20 B', 'TKB', 18, expandTo18Decimals(1000_000)])

    // Normal NFT creation
    await mineBlock(provider, BidStartTime + 1)
    await FeswaNFT.BidFeswaPair(TokenA.address, TokenB.address, wallet.address,
      { ...overrides, value: stepPrice })
    tokenIDMatchAB = utils.keccak256(utils.solidityPack(['address', 'address', 'address'],
      [FeswaNFT.address, TokenA.address, TokenB.address]))

    await mineBlock(provider, BidStartTime + 10)
    await FeswaNFT.BidFeswaPair(TokenA.address, TokenC.address, wallet.address,
      { ...overrides, value: stepPrice })
    if (TokenA.address.toLowerCase() <= TokenC.address.toLowerCase()) {
      tokenIDMatchAC = utils.keccak256(utils.solidityPack(['address', 'address', 'address'],
        [FeswaNFT.address, TokenA.address, TokenC.address]))
    } else {
      tokenIDMatchAC = utils.keccak256(utils.solidityPack(['address', 'address', 'address'],
        [FeswaNFT.address, TokenC.address, TokenA.address]))
    }

    await mineBlock(provider, BidStartTime + 20)
    await FeswaNFT.connect(other0).BidFeswaPair(TokenB.address, TokenC.address, other0.address,
      { ...overrides, value: stepPrice })
    if (TokenB.address.toLowerCase() <= TokenC.address.toLowerCase()) {
      tokenIDMatchBC = utils.keccak256(utils.solidityPack(['address', 'address', 'address'],
        [FeswaNFT.address, TokenB.address, TokenC.address]))
    } else {
      tokenIDMatchBC = utils.keccak256(utils.solidityPack(['address', 'address', 'address'],
        [FeswaNFT.address, TokenC.address, TokenB.address]))
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
    expect(await FeswaNFT.name()).to.be.eq('FeSwap Pool NFT')
  })

  it('IERC721Metadata: symbol()', async () => {
    expect(await FeswaNFT.symbol()).to.be.eq('FESN')
  })

  it('IERC721Metadata: tokenURI()', async () => {
    expect(await FeswaNFT.tokenURI(tokenIDMatchAB)).to.be.eq('')
    expect(await FeswaNFT.tokenURI(tokenIDMatchAC)).to.be.eq('')
    expect(await FeswaNFT.tokenURI(tokenIDMatchBC)).to.be.eq('')

    await FeswaNFT.setTokenURIPrefix('https://www.feswap.io')
    expect(await FeswaNFT.tokenURI(tokenIDMatchAB)).to.be.eq('https://www.feswap.io' + BigNumber.from(tokenIDMatchAB).toString())
    await FeswaNFT.setTokenURI(tokenIDMatchAB, 'Test NFT AB')
    expect(await FeswaNFT.tokenURI(tokenIDMatchAB)).to.be.eq('https://www.feswap.io' + 'Test NFT AB')
  })

  it('IERC721Metadata: tokenURI(): No Base', async () => {
    expect(await FeswaNFT.tokenURI(tokenIDMatchAB)).to.be.eq('')
    await FeswaNFT.setTokenURI(tokenIDMatchAB, 'Test NFT AB')
    expect(await FeswaNFT.tokenURI(tokenIDMatchAB)).to.be.eq('Test NFT AB')
    await FeswaNFT.setTokenURIPrefix('https://www.feswap.io')
    expect(await FeswaNFT.tokenURI(tokenIDMatchAB)).to.be.eq('https://www.feswap.io' + 'Test NFT AB')
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
