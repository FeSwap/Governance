import chai, { expect } from 'chai'
import { BigNumber, Contract, constants, utils } from 'ethers'
import { solidity, MockProvider, createFixtureLoader, deployContract } from 'ethereum-waffle'
import { ecsign } from 'ethereumjs-util'
import { Block } from "@ethersproject/abstract-provider";

import { governanceFixture } from './shares/fixtures'
import { expandTo18Decimals, mineBlock, encodeParameters, DELAY, GRACE_PERIOD } from './shares/utils'
import Timelock from '../build/TimelockHarness.json'

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

describe('Timelock', () => {
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

  const newDelay = DELAY * 2

  const value = "0"
  const revertData = encodeParameters(['uint256'], [60*60]);
  let signature: string
  let callData: string
  let target: string
  let eta: number
  let queuedTxHash: string

  beforeEach(async () => {
    const fixture = await loadFixture(governanceFixture)
    Feswa = fixture.Feswa;
    feswGovernor = fixture.feswGovernor
    timelock = await deployContract(wallet, Timelock, [wallet.address, DELAY])
    lastBlock = await provider.getBlock('latest')

    target = timelock.address
    signature = "setDelay(uint256)"
    callData = encodeParameters(['uint256'], [newDelay])

    await mineBlock(provider, lastBlock.timestamp + 10)
    lastBlock = await provider.getBlock('latest')
    eta = lastBlock.timestamp + DELAY + 1         // for testing, need to check

    queuedTxHash = utils.keccak256(
      encodeParameters(
        ['address', 'uint256', 'string', 'bytes', 'uint256'],
        [target, value, signature, callData, eta]
      )
    );

  })

  describe('constructor', () => {
    it('sets address of admin', async () => {
      let configuredAdmin = await timelock.admin()
      expect(configuredAdmin).to.be.equal(wallet.address);
    });

    it('sets delay', async () => {
      let configuredDelay = await timelock.delay()
      expect(configuredDelay).to.be.equal(DELAY);
    });
  });

    describe('setDelay', () => {
    it('requires msg.sender to be Timelock', async () => {
      await expect(timelock.setDelay(DELAY))
            .to.be.revertedWith('Timelock::setDelay: Call must come from Timelock.');
    });
  });

  describe('setPendingAdmin', () => {
    it('requires msg.sender to be Timelock', async () => {
      await expect(timelock.setPendingAdmin(other1.address))
            .to.be.revertedWith('Timelock::setPendingAdmin: Call must come from Timelock.');
    });
  });

  describe('acceptAdmin', () => {
    afterEach(async () => {
      await timelock.harnessSetAdmin(wallet.address)
    });

    it('requires msg.sender to be pendingAdmin', async () => {
      await expect(timelock.connect(other0).acceptAdmin())
            .to.be.revertedWith('Timelock::acceptAdmin: Call must come from pendingAdmin.');
    });

    it('sets pendingAdmin to address 0 and changes admin', async () => {
      await timelock.harnessSetPendingAdmin(other1.address)
      const pendingAdminBefore = await timelock.pendingAdmin()
      expect(pendingAdminBefore).to.be.equal(other1.address);

      await expect(timelock.connect(other1).acceptAdmin())
            .to.emit(timelock, 'NewAdmin')
            .withArgs(other1.address)

      const pendingAdminAfter = await timelock.pendingAdmin()
      expect(pendingAdminAfter).to.be.eq('0x0000000000000000000000000000000000000000');

      const timelockAdmin = await timelock.admin()
      expect(timelockAdmin).to.be.eq(other1.address);
    });
  });

  describe('queueTransaction', () => {
    it('requires admin to be msg.sender', async () => {

//      console.log( encodeParameters(
//        ['address', 'uint256', 'string', 'bytes', 'uint256'],
//       [target, value, signature, callData, eta] ))

      await expect(timelock.connect(other0).queueTransaction(target, value, signature, callData, eta))
            .to.be.revertedWith('Timelock::queueTransaction: Call must come from admin.');
    });

    it('requires eta to exceed delay', async () => {
      const etaLessThanDelay: number =lastBlock.timestamp + DELAY - 1;

      await expect(timelock.connect(wallet).queueTransaction(target, value, signature, callData, etaLessThanDelay))
            .to.be.revertedWith('Timelock::queueTransaction: Estimated execution block must satisfy delay.');      
    });

    it('sets hash as true in queuedTransactions mapping', async () => {
      const queueTransactionsHashValueBefore = await timelock.queuedTransactions(queuedTxHash);
      expect(queueTransactionsHashValueBefore).to.be.eq(false);

      await timelock.queueTransaction(target, value, signature, callData, eta);

      const queueTransactionsHashValueAfter = await timelock.queuedTransactions(queuedTxHash);
      expect(queueTransactionsHashValueAfter).to.be.eq(true);
    });

    it('should emit QueueTransaction event', async () => {
      await expect(timelock.queueTransaction(target, value, signature, callData, eta))
            .to.emit(timelock, 'QueueTransaction')
            .withArgs(queuedTxHash, timelock.address, 0, signature, callData, eta)
    });

  });

  describe('cancelTransaction', () => {
//    beforeEach(async () => {
//      await mineBlock(provider, lastBlock.timestamp + 9)
//      await timelock.queueTransaction(target, value, signature, callData, eta, overrides);
//    });

    it('requires admin to be msg.sender', async () => {
        await timelock.queueTransaction(target, value, signature, callData, eta, overrides);
        await expect(timelock.connect(other0).cancelTransaction(target, value, signature, callData, eta))
              .to.be.revertedWith('Timelock::cancelTransaction: Call must come from admin.')
    });

    it('sets hash from true to false in queuedTransactions mapping', async () => {
      await timelock.queueTransaction(target, value, signature, callData, eta, overrides);
      const queueTransactionsHashValueBefore = await timelock.queuedTransactions(queuedTxHash);
      expect(queueTransactionsHashValueBefore).to.be.eq(true);

      await timelock.cancelTransaction(target, value, signature, callData, eta);

      const queueTransactionsHashValueAfter = await timelock.queuedTransactions(queuedTxHash);
      expect(queueTransactionsHashValueAfter).to.be.eq(false);
    });

    it('should emit CancelTransaction event', async () => {
      await timelock.queueTransaction(target, value, signature, callData, eta, overrides);
      await expect(timelock.cancelTransaction(target, value, signature, callData, eta))
            .to.emit(timelock, 'CancelTransaction')
            .withArgs(queuedTxHash, timelock.address, 0, signature, callData, eta)
    });
  });

  describe('queue and cancel empty', () => {
    it('can queue and cancel an empty signature and data', async () => {
      const txHash = utils.keccak256(
        encodeParameters(
          ['address', 'uint256', 'string', 'bytes', 'uint256'],
          [target, value, '', '0x', eta]
        )
      );

      expect( await timelock.queuedTransactions(txHash)).to.be.eq(false)
      await timelock.queueTransaction(target, value, '', '0x', eta)
      expect( await timelock.queuedTransactions(txHash)).to.be.eq(true)

      await timelock.cancelTransaction(target, value, '', '0x', eta)
      expect( await timelock.queuedTransactions(txHash)).to.be.eq(false)
    });
  });

  describe('executeTransaction (setDelay)', () => {
    beforeEach(async () => {
      // Queue transaction that will succeed
      await timelock.queueTransaction(target, value, signature, callData, eta)

      // Queue transaction that will revert when executed
      await timelock.queueTransaction(target, value, signature, revertData, eta)
    });

    it('requires admin to be msg.sender', async () => {
      await expect(timelock.connect(other0).executeTransaction(target, value, signature, callData, eta))
        .to.be.revertedWith('Timelock::executeTransaction: Call must come from admin.')
    });

    it('requires transaction to be queued', async () => {
      const differentEta = eta + 1;

      await expect(timelock.executeTransaction(target, value, signature, callData, differentEta))
      .to.be.revertedWith("Timelock::executeTransaction: Transaction hasn't been queued.")
    });

    it('requires timestamp to be greater than or equal to eta', async () => {
      await expect(timelock.executeTransaction(target, value, signature, callData, eta))
      .to.be.revertedWith("Timelock::executeTransaction: Transaction hasn't surpassed time lock.")
    });

    it('requires timestamp to be less than eta plus gracePeriod', async () => {
      let timestamp = lastBlock.timestamp + DELAY + GRACE_PERIOD + 1 + 1
      await mineBlock(provider, timestamp)
 
      await expect(timelock.executeTransaction(target, value, signature, callData, eta))
      .to.be.revertedWith("Timelock::executeTransaction: Transaction is stale.")
    });

    it('requires target.call transaction to succeed', async () => {
      let timestamp = lastBlock.timestamp + DELAY + 1
      await mineBlock(provider, timestamp)
      await timelock.executeTransaction(target, value, signature, callData, eta)

      await expect(timelock.executeTransaction(target, value, signature, revertData, eta))
      .to.be.revertedWith("Timelock::executeTransaction: Transaction execution reverted.")
    });

    it('sets hash from true to false in queuedTransactions mapping, updates delay, and emits ExecuteTransaction event', async () => {
      
      const configuredDelayBefore = await timelock.delay();
      expect(configuredDelayBefore).to.be.equal(DELAY);

      const queueTransactionsHashValueBefore = await timelock.queuedTransactions(queuedTxHash);
      expect(queueTransactionsHashValueBefore).to.be.eq(true);

      let timestamp = lastBlock.timestamp + DELAY + 1 
      await mineBlock(provider, timestamp)

      await expect(timelock.executeTransaction(target, value, signature, callData, eta))
            .to.emit(timelock, 'NewDelay')
            .withArgs(newDelay)
            .to.emit(timelock, 'ExecuteTransaction')
            .withArgs(queuedTxHash, timelock.address, 0, signature, callData, eta)


      const queueTransactionsHashValueAfter = await timelock.queuedTransactions(queuedTxHash);
      expect(queueTransactionsHashValueAfter).to.be.eq(false);

      const configuredDelayAfter = await timelock.delay();
      expect(configuredDelayAfter).to.be.equal(newDelay);
    })

  });

  describe('executeTransaction (setPendingAdmin)', () => {
    beforeEach(async () => {
      signature = 'setPendingAdmin(address)';
      callData = encodeParameters(['address'], [other1.address]);

      queuedTxHash = utils.keccak256(
        encodeParameters(
          ['address', 'uint256', 'string', 'bytes', 'uint256'],
          [target, value, signature, callData, eta]
        )
      );

      await timelock.queueTransaction(target, value, signature, callData, eta)
    });

    it('requires admin to be msg.sender', async () => {
      await expect(timelock.connect(other0).executeTransaction(target, value, signature, callData, eta))
      .to.be.revertedWith('Timelock::executeTransaction: Call must come from admin.')
    });

    it('requires transaction to be queued', async () => {
      const differentEta = eta + 1;

      await expect(timelock.executeTransaction(target, value, signature, callData, differentEta))
      .to.be.revertedWith("Timelock::executeTransaction: Transaction hasn't been queued.")
    });

    it('requires timestamp to be greater than or equal to eta', async () => {
      await expect(timelock.executeTransaction(target, value, signature, callData, eta))
      .to.be.revertedWith("Timelock::executeTransaction: Transaction hasn't surpassed time lock.")
    });

    it('requires timestamp to be less than eta plus gracePeriod', async () => {
      let timestamp = lastBlock.timestamp + DELAY + GRACE_PERIOD + 1 + 1
      await mineBlock(provider, timestamp)
 
      await expect(timelock.executeTransaction(target, value, signature, callData, eta))
      .to.be.revertedWith("Timelock::executeTransaction: Transaction is stale.")
    });

    it('sets hash from true to false in queuedTransactions mapping, updates admin, and emits ExecuteTransaction event', async () => {
      const configuredPendingAdminBefore = await timelock.pendingAdmin();
      expect(configuredPendingAdminBefore).to.be.eq(constants.AddressZero);

      const queueTransactionsHashValueBefore = await timelock.queuedTransactions(queuedTxHash);
      expect(queueTransactionsHashValueBefore).to.be.eq(true);

      let timestamp = lastBlock.timestamp + DELAY + 1 
      await mineBlock(provider, timestamp)

      await expect(timelock.executeTransaction(target, value, signature, callData, eta))
            .to.emit(timelock, 'NewPendingAdmin')
            .withArgs(other1.address)
            .to.emit(timelock, 'ExecuteTransaction')
            .withArgs(queuedTxHash, timelock.address, 0, signature, callData, eta)

      const queueTransactionsHashValueAfter = await timelock.queuedTransactions(queuedTxHash);
      expect(queueTransactionsHashValueAfter).to.be.eq(false);

      const configuredPendingAdminAfter = await timelock.pendingAdmin();
      expect(configuredPendingAdminAfter).to.be.equal(other1.address);
    });
  });
})
