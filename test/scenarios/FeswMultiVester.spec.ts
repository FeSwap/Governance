import chai, { expect } from 'chai'
import { Contract, BigNumber } from 'ethers'
import { solidity, MockProvider, createFixtureLoader, deployContract } from 'ethereum-waffle'

import FeswMultiVester from '../../build/FeswMultiVester.json'

import { governanceFixture } from '../shares/fixtures'
import { mineBlock, expandTo18Decimals } from '../shares/utils'

chai.use(solidity)

describe('scenario:FeswMultiVester', () => {
  const provider = new MockProvider({
    ganacheOptions: {
      hardfork: 'istanbul',
      mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
      gasLimit: 9999999,
    },
  })
  const [wallet, recipient, other1, other2] = provider.getWallets()
  const loadFixture = createFixtureLoader([wallet], provider)

  let Feswa: Contract
  let timelock: Contract
  beforeEach(async () => {
    const fixture = await loadFixture(governanceFixture)
    Feswa = fixture.Feswa
    timelock = fixture.timelock
  })

  let FeswVester: Contract
  let vestingAmount: BigNumber
  let vestingBegin: number
  let vestingCliff: number
  let vestingEnd: number
  beforeEach('deploy FESW vesting contract', async () => {
    vestingAmount = expandTo18Decimals(10000)
    FeswVester = await deployContract(wallet, FeswMultiVester, [
      Feswa.address,
      recipient.address
    ])

    const receipt = await provider.getTransactionReceipt(FeswVester.deployTransaction.hash)
    expect(receipt.gasUsed).to.eq('982336')     // 982324     

    // fund the treasury
    await Feswa.transfer(FeswVester.address, vestingAmount)
  })

  it('setOwner', async () => {
    await expect(FeswVester.connect(recipient).setOwner(recipient.address)).to.be.revertedWith(
      'Owner not allowed'
    )
    await FeswVester.setOwner(recipient.address)
    expect(await FeswVester.owner()).to.eq(recipient.address)
  })


  it('setRecipient', async () => {
    await expect(FeswVester.setRecipient(wallet.address)).to.be.revertedWith(
      'Recipient not allowed'
    )
    await FeswVester.connect(recipient).setRecipient(wallet.address)
    expect(await FeswVester.recipient()).to.eq(wallet.address)
  })

  describe('deployVester', () => {
    beforeEach(async () => {
      vestingAmount = expandTo18Decimals(10000)
      const { timestamp: now } = await provider.getBlock('latest')
      vestingBegin = now + 60
      vestingCliff = vestingBegin + 60
      vestingEnd = vestingBegin + 60 * 60 * 24 * 365
    })

    it('deployVester failed: Only Owner', async () => {
      await expect(FeswVester.connect(recipient).deployVester(vestingAmount, vestingBegin, vestingCliff, vestingEnd))
            .to.be.revertedWith('Deploy not allowed')
    })

    it('deployVeste failed: Zero amount', async () => {
      await expect(FeswVester.deployVester(0, vestingBegin, vestingCliff, vestingEnd))
            .to.be.revertedWith('Wrong p0')
    })

    it('deployVeste failed: Wrong begin time', async () => {
      await expect(FeswVester.deployVester(vestingAmount, vestingBegin-61, vestingCliff, vestingEnd))
            .to.be.revertedWith('Wrong p1')
    })
    
    it('deployVeste failed: Wrong cliff time', async () => {
      await expect(FeswVester.deployVester(vestingAmount, vestingBegin, vestingBegin-1, vestingEnd))
            .to.be.revertedWith('Wrong p2')
    })

    it('deployVeste failed: Wrong end time', async () => {
      await expect(FeswVester.deployVester(vestingAmount, vestingBegin, vestingCliff, vestingCliff-1))
            .to.be.revertedWith('Wrong p3')
    })

    it('deployVeste failed: Not claimable', async () => {
      await expect(FeswVester.claim()).to.be.revertedWith('Not claimable')
    })

    it('deployVeste failed: Transfer error', async () => {
      const tx = await FeswVester.deployVester(vestingAmount.mul(2), vestingBegin, vestingCliff, vestingEnd)
      const receipt = await tx.wait()
      expect(receipt.gasUsed).to.eq('51098')      // 51098 51086
      {
        const claimTime = vestingBegin + Math.floor((vestingEnd - vestingBegin) / 3)
        await mineBlock(provider, claimTime)
        await FeswVester.claim()
      }
      {
        const claimTime = vestingBegin + Math.floor((vestingEnd - vestingBegin) *5 / 6)
        const vesterinfo = await FeswVester.allVesters(0)
        await mineBlock(provider, claimTime)
        await expect(FeswVester.claim()).to.be.revertedWith('FESW::_transferTokens: transfer amount exceeds balance')
        expect(await await FeswVester.allVesters(0)).to.eqls(vesterinfo)
      }
    })

    it('deployVeste Normal: one vester', async () => {
      await FeswVester.deployVester(vestingAmount, vestingBegin, vestingCliff, vestingEnd)

      expect(await FeswVester.numTotalVester()).to.eq(1)
      expect(await FeswVester.allVesters(0)).to.eqls([vestingAmount, vestingBegin, vestingCliff, vestingEnd, vestingBegin])

      await mineBlock(provider, vestingBegin -10 )    
      await expect(FeswVester.claim()).to.be.revertedWith('Not time yet')

      await mineBlock(provider, vestingCliff - 2 )    
      await expect(FeswVester.claim()).to.be.revertedWith('Not time yet')

      {
        const claimTime = vestingBegin + Math.floor((vestingEnd - vestingBegin) / 2)
        await mineBlock(provider, claimTime)
        const tx = await FeswVester.claim()
        const receipt = await tx.wait()
        expect(receipt.gasUsed).to.eq('68288')        // 68310 68288 68293      

        const vesterinfo = await FeswVester.allVesters(0)
        expect(vesterinfo['lastClaimTime']).to.gte(claimTime)
        const claimedValue = await Feswa.balanceOf(recipient.address)
        expect(await Feswa.balanceOf(FeswVester.address)).to.eq(vestingAmount.sub(claimedValue))
      }
      {
        const claimTime = vestingBegin + Math.floor((vestingEnd - vestingBegin) *2 / 3)
        await mineBlock(provider, claimTime)
        await FeswVester.claim()
        const claimedValue = await Feswa.balanceOf(recipient.address)
        expect(await Feswa.balanceOf(FeswVester.address)).to.eq(vestingAmount.sub(claimedValue))
      }
      {
        const claimTime = vestingEnd
        await mineBlock(provider, claimTime)
        await FeswVester.claim()
        expect(await Feswa.balanceOf(recipient.address)).to.eq(vestingAmount)
        expect(await Feswa.balanceOf(FeswVester.address)).to.eq(0)
      }
    })
      
    it('deployVeste Normal: Two vester', async () => {
      // fund the treasury
      const vestingAmount2 = vestingAmount.div(2)
      await Feswa.transfer(FeswVester.address, vestingAmount2)
      const totalBalance = await Feswa.balanceOf(FeswVester.address)

      const vestingBegin2 = vestingEnd + 60
      const vestingCliff2 = vestingBegin2 + 60
      const vestingEnd2 = vestingBegin2 + 60 * 60 * 24 * 365
      
      await FeswVester.deployVester(vestingAmount, vestingBegin, vestingCliff, vestingEnd)
      await FeswVester.deployVester(vestingAmount2, vestingBegin2, vestingCliff2, vestingEnd2)

      expect(await FeswVester.numTotalVester()).to.eq(2)
      expect(await FeswVester.allVesters(0)).to.eqls([vestingAmount, vestingBegin, vestingCliff, vestingEnd, vestingBegin])
      expect(await FeswVester.allVesters(1)).to.eqls([vestingAmount2, vestingBegin2, vestingCliff2, vestingEnd2, vestingBegin2])

      {
        const claimTime = vestingBegin + Math.floor((vestingEnd - vestingBegin) / 2)
        await mineBlock(provider, claimTime)
        await FeswVester.claim()
        const vesterinfo = await FeswVester.allVesters(0)
        expect(vesterinfo['lastClaimTime']).to.gte(claimTime)
        const claimedValue = await Feswa.balanceOf(recipient.address)
        expect(await Feswa.balanceOf(FeswVester.address)).to.eq(totalBalance.sub(claimedValue))
      }
      {
        const claimTime = vestingEnd+2
        await mineBlock(provider, claimTime)
        await FeswVester.claim()
        const receivedBalance = await Feswa.balanceOf(recipient.address)
        expect(vestingAmount.sub(receivedBalance)).to.lte(5)
        expect(await Feswa.balanceOf(FeswVester.address)).to.eq(totalBalance.sub(receivedBalance))
        expect(await FeswVester.noVesterClaimable()).to.eq(1)
      }

      await mineBlock(provider, vestingCliff2 - 10 )    
      await expect(FeswVester.claim()).to.be.revertedWith('Not time yet')

      {
        const claimTime = vestingBegin2 + Math.floor((vestingEnd2 - vestingBegin2) *2 / 3)
        await mineBlock(provider, claimTime)
        await FeswVester.claim()
        const vesterinfo = await FeswVester.allVesters(1)
        expect(vesterinfo['lastClaimTime']).to.gte(claimTime)
        const claimedValue = await Feswa.balanceOf(recipient.address)
        expect(await Feswa.balanceOf(FeswVester.address)).to.eq(totalBalance.sub(claimedValue))
      }
      {
        const claimTime = vestingEnd2
        await mineBlock(provider, claimTime)
        await FeswVester.claim()
        const receivedBalance = await Feswa.balanceOf(recipient.address)
        expect(receivedBalance).to.eq(totalBalance)
        expect(await Feswa.balanceOf(FeswVester.address)).to.eq(0)
        expect(await FeswVester.noVesterClaimable()).to.eq(2)
      }
    })

    it('deployVeste Normal: Five vesters', async () => {
        // fund the treasury
        const vestingAmount2 = vestingAmount.div(2)
        await Feswa.transfer(FeswVester.address, vestingAmount2)
        const vestingAmount3 = vestingAmount.div(4)
        await Feswa.transfer(FeswVester.address, vestingAmount3)
        const vestingAmount4 = vestingAmount.div(8)
        await Feswa.transfer(FeswVester.address, vestingAmount4)
        const vestingAmount5 = vestingAmount.div(10)
        await Feswa.transfer(FeswVester.address, vestingAmount5)

        const totalBalance = await Feswa.balanceOf(FeswVester.address)
  
        const vestingBegin2 = vestingEnd + 60
        const vestingCliff2 = vestingBegin2 + 60
        const vestingEnd2 = vestingBegin2 + 60 * 60 * 24 * 365

        const vestingBegin3 = vestingEnd2 + 60
        const vestingCliff3 = vestingBegin3 + 60
        const vestingEnd3 = vestingBegin3 + 60 * 60 * 24 * 365

        const vestingBegin4 = vestingEnd3 + 60
        const vestingCliff4 = vestingBegin4 + 60
        const vestingEnd4 = vestingBegin4 + 60 * 60 * 24 * 365
        
        const vestingBegin5 = vestingEnd4 + 60
        const vestingCliff5 = vestingBegin5 + 60
        const vestingEnd5 = vestingBegin5 + 60 * 60 * 24 * 365
      
        await FeswVester.deployVester(vestingAmount, vestingBegin, vestingCliff, vestingEnd)
        await FeswVester.deployVester(vestingAmount2, vestingBegin2, vestingCliff2, vestingEnd2)
        await FeswVester.deployVester(vestingAmount3, vestingBegin3, vestingCliff3, vestingEnd3)
        await FeswVester.deployVester(vestingAmount4, vestingBegin4, vestingCliff4, vestingEnd4)
        await FeswVester.deployVester(vestingAmount5, vestingBegin5, vestingCliff5, vestingEnd5)

        expect(await FeswVester.numTotalVester()).to.eq(5)
        expect(await FeswVester.allVesters(0)).to.eqls([vestingAmount, vestingBegin, vestingCliff, vestingEnd, vestingBegin])
        expect(await FeswVester.allVesters(1)).to.eqls([vestingAmount2, vestingBegin2, vestingCliff2, vestingEnd2, vestingBegin2])
        expect(await FeswVester.allVesters(2)).to.eqls([vestingAmount3, vestingBegin3, vestingCliff3, vestingEnd3, vestingBegin3])
        expect(await FeswVester.allVesters(3)).to.eqls([vestingAmount4, vestingBegin4, vestingCliff4, vestingEnd4, vestingBegin4])
        expect(await FeswVester.allVesters(4)).to.eqls([vestingAmount5, vestingBegin5, vestingCliff5, vestingEnd5, vestingBegin5])
        
        {
          const claimTime = vestingBegin + Math.floor((vestingEnd - vestingBegin) / 6)
          await mineBlock(provider, claimTime)
          await FeswVester.claim()
          const claimedValue = await Feswa.balanceOf(recipient.address)
          expect(await Feswa.balanceOf(FeswVester.address)).to.eq(totalBalance.sub(claimedValue))
        }
        {
          const claimTime = vestingEnd + 2
          await mineBlock(provider, claimTime)
          await FeswVester.claim()
          const receivedBalance = await Feswa.balanceOf(recipient.address)
          expect(vestingAmount.sub(receivedBalance)).to.lte(10)
          expect(await Feswa.balanceOf(FeswVester.address)).to.eq(totalBalance.sub(receivedBalance))
          expect(await FeswVester.noVesterClaimable()).to.eq(1)
        }

        await mineBlock(provider, vestingCliff2 - 10 )    
        await expect(FeswVester.claim()).to.be.revertedWith('Not time yet')
  
        {
          const claimTime = vestingBegin2 + Math.floor((vestingEnd2 - vestingBegin2) * 2 / 6)
          await mineBlock(provider, claimTime)
          await FeswVester.claim()
          const vesterinfo = await FeswVester.allVesters(1)
          expect(vesterinfo['lastClaimTime']).to.gte(claimTime)
          const claimedValue = await Feswa.balanceOf(recipient.address)
          expect(await Feswa.balanceOf(FeswVester.address)).to.eq(totalBalance.sub(claimedValue))
        }
        {
          const claimTime = vestingEnd2 +2
          await mineBlock(provider, claimTime)
          await FeswVester.claim()
          const claimedValue = await Feswa.balanceOf(recipient.address)
          expect(await Feswa.balanceOf(FeswVester.address)).to.eq(totalBalance.sub(claimedValue))
        }
            
        await mineBlock(provider, vestingCliff3 - 10 )    
        await expect(FeswVester.claim()).to.be.revertedWith('Not time yet')
  
        {
          const claimTime = vestingBegin3 + Math.floor((vestingEnd3 - vestingBegin3) * 3 / 6)
          await mineBlock(provider, claimTime)
          await FeswVester.claim()
          const vesterinfo = await FeswVester.allVesters(2)
          expect(vesterinfo['lastClaimTime']).to.gte(claimTime)
          const claimedValue = await Feswa.balanceOf(recipient.address)
          expect(await Feswa.balanceOf(FeswVester.address)).to.eq(totalBalance.sub(claimedValue))
        }
        {
          const claimTime = vestingEnd3 +2
          await mineBlock(provider, claimTime)
          await FeswVester.claim()
          const claimedValue = await Feswa.balanceOf(recipient.address)
          expect(await Feswa.balanceOf(FeswVester.address)).to.eq(totalBalance.sub(claimedValue))
        }

        await mineBlock(provider, vestingCliff4 - 10 )    
        await expect(FeswVester.claim()).to.be.revertedWith('Not time yet')
  
        {
          const claimTime = vestingBegin4 + Math.floor((vestingEnd4 - vestingBegin4) * 4 / 6)
          await mineBlock(provider, claimTime)
          await FeswVester.claim()
          const vesterinfo = await FeswVester.allVesters(3)
          expect(vesterinfo['lastClaimTime']).to.gte(claimTime)
          const claimedValue = await Feswa.balanceOf(recipient.address)
          expect(await Feswa.balanceOf(FeswVester.address)).to.eq(totalBalance.sub(claimedValue))
        }
        {
          const claimTime = vestingEnd4 +2
          await mineBlock(provider, claimTime)
          await FeswVester.claim()
          const claimedValue = await Feswa.balanceOf(recipient.address)
          expect(await Feswa.balanceOf(FeswVester.address)).to.eq(totalBalance.sub(claimedValue))
        }
        await mineBlock(provider, vestingCliff5 - 10 )    
        await expect(FeswVester.claim()).to.be.revertedWith('Not time yet')
  
        {
          const claimTime = vestingBegin5 + Math.floor((vestingEnd5 - vestingBegin5) * 5 / 6)
          await mineBlock(provider, claimTime)
          await FeswVester.claim()
          const vesterinfo = await FeswVester.allVesters(4)
          expect(vesterinfo['lastClaimTime']).to.gte(claimTime)
          const claimedValue = await Feswa.balanceOf(recipient.address)
          expect(await Feswa.balanceOf(FeswVester.address)).to.eq(totalBalance.sub(claimedValue))
        }
        {
          const claimTime = vestingEnd5
          await mineBlock(provider, claimTime)
          await FeswVester.claim()
          const receivedBalance = await Feswa.balanceOf(recipient.address)
          expect(receivedBalance).to.eq(totalBalance)
          expect(await Feswa.balanceOf(FeswVester.address)).to.eq(0)
          expect(await FeswVester.noVesterClaimable()).to.eq(5)
        }

        const claimTime = vestingEnd5 + 10
        await mineBlock(provider, claimTime)
        await expect(FeswVester.claim()).to.be.revertedWith('Not claimable')

        const vestingAmount6 = vestingAmount.div(16)
        await Feswa.transfer(FeswVester.address, vestingAmount6)

        const vestingBegin6 = vestingEnd5 + 60
        const vestingCliff6 = vestingBegin6 + 60
        const vestingEnd6 = vestingBegin6 + 60 * 60 * 24 * 365

        await FeswVester.deployVester(vestingAmount6, vestingBegin6, vestingCliff6, vestingEnd6)

        expect(await FeswVester.numTotalVester()).to.eq(6)
        expect(await FeswVester.allVesters(5)).to.eqls([vestingAmount6, vestingBegin6, vestingCliff6, vestingEnd6, vestingBegin6])

        {
          const claimTime = vestingBegin6 + Math.floor((vestingEnd6 - vestingBegin6) * 5 / 6)
          await mineBlock(provider, claimTime)
          await FeswVester.claim()
          const vesterinfo = await FeswVester.allVesters(5)
          expect(vesterinfo['lastClaimTime']).to.gte(claimTime)
          const claimedValue = await Feswa.balanceOf(recipient.address)
          expect(await Feswa.balanceOf(FeswVester.address)).to.eq(totalBalance.add(vestingAmount6).sub(claimedValue))
        }

      })
    })
  })
