// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "./utils/TransferHelper.sol";

    enum PoolRunningPhase {
        BidPhase, 
        BidDelaying,
        BidSettled,
        PoolHolding, 
        PoolForSale
    }

    struct FeswaPair {
        address tokenA;
        address tokenB;
        uint256 currentPrice;
        uint64  timeCreated;
        uint64  lastBidTime; 
        PoolRunningPhase  poolState;
    }

/**
 * @title FeswaNFT contract
 * @dev Extends ERC721 Non-Fungible Token Standard basic implementation
 */

contract FeswaNFT is ERC721, Ownable { 

    using SafeMath for uint256;
    using Address for address;

    // Public variables
    string public constant NAME = 'Feswap Pool NFT';
    string public constant SYMBOL = 'FESN';

    // Price offering duration: two weeks 
    uint256 public constant OPEN_BID_DURATION = (3600 * 24 * 14);

    // Price offering waiting duration: 2 Hours
    uint256 public constant CLOSE_BID_DELAY = (3600 * 2);           

    // Airdrop for the first tender: 1000 FEST
    uint256 public constant AIRDROP_FOR_FIRST = 1000e18;  

    // Airdrop for the next tender: 500 FEST
    uint256 public constant AIRDROP_FOR_NEXT = 500e18;  

    // Airdrop rate for Bid winner: 20000 FEST/ETH
    uint256 public constant AIRDROP_RATE_FOR_WINNER = 20000;    

    // Minimum price increase for tender: 0.1ETH
    uint256 public constant MINIMUM_PRICE_INCREACE = 1e17;    

    // contract of Feswap Token
    address public FeswapToken;       

    // Price Low Limit for pool creation:  0.2ETH
    uint256 public PriceLowLimit;       

    // Sale start timestamp
    uint256 public SaleStartTime;       // 1614556800  //2021/03/01 00:00

    // Mapping from token ID to token pair infomation
    mapping (uint256 => FeswaPair) public ListPools;
 
    // Events
    event PairCreadted(address indexed tokenA, address indexed tokenB, uint256 tokenID);
  
    /**
     * @dev Initializes the contract by setting a `name` and a `symbol` to the token collection.
     */
    constructor (address feswaToken, uint256 priceLowLimit, uint256 saleStartTime ) 
        ERC721(NAME, SYMBOL)
    {
        FeswapToken = feswaToken;
        PriceLowLimit = priceLowLimit;
        SaleStartTime = saleStartTime;
    }

    /**
     * @dev Bid for the token-pair swap pool with higher price. 
     * Create the new token for the fisrt-time calling with minumum initial price 
     */
    function BidFeswaPair(address tokenA, address tokenB, address to) external payable returns (uint256 tokenID) {
        require(block.timestamp > SaleStartTime, 'FESN: BID NOT STARTED');
        require(tokenA != tokenB, 'FESN: IDENTICAL_ADDRESSES');
        require(msg.value >= PriceLowLimit, 'FESN: PAY LESS');

        (address token0, address token1) = (tokenA <= tokenB) ? (tokenA, tokenB) : (tokenB, tokenA);
        tokenID  = uint256(keccak256(abi.encodePacked(address(this), token0, token1)));

        if(_exists(tokenID )){
            FeswaPair storage pairInfo = ListPools[tokenID]; 
            require(msg.value >= pairInfo.currentPrice.mul(11).div(10), 'FESN: PAY LESS');  // minimum 10% increase
            require(msg.value >= pairInfo.currentPrice.add(MINIMUM_PRICE_INCREACE), 'FESN: PAY LESS');  // minimum 10% increase

            if(pairInfo.poolState == PoolRunningPhase.BidPhase){
                require(block.timestamp <= pairInfo.timeCreated + OPEN_BID_DURATION, 'FESN: BID TOO LATE');  // Bid keep open for two weeks
                if(block.timestamp >= (pairInfo.timeCreated + OPEN_BID_DURATION - CLOSE_BID_DELAY)) {
                    pairInfo.poolState = PoolRunningPhase.BidDelaying;
                }
            } else {
                require(pairInfo.poolState == PoolRunningPhase.BidDelaying, 'FESN: BID COMPLETED'); 
                require(block.timestamp <= pairInfo.lastBidTime + CLOSE_BID_DELAY, 'FESN: BID TOO LATE');
            }

            // update last tender timestamp
            pairInfo.lastBidTime = uint64(block.timestamp);

            // calculte repay amount
            uint256 repayAmount = msg.value.add(pairInfo.currentPrice.mul(9)).div(10);      // B + (A-B)/10
            address preOwner = ownerOf(tokenID);
            
            // Change the token owner
            _transfer(preOwner, to, tokenID);
            pairInfo.currentPrice = msg.value;

            // Repay the previous owner with 10% of the price increasement              
            TransferHelper.safeTransferETH(preOwner, repayAmount);

            // Airdrop to the next coming tenders
            TransferHelper.safeTransfer(FeswapToken, to, AIRDROP_FOR_NEXT);

        } else {
            // _mint will check 'to' not be Zero, and tokenID not repeated.
            _mint(to, tokenID);

            // Prepare swap token-pair infomation
            FeswaPair memory pairInfo;
            pairInfo.tokenA = token0;
            pairInfo.tokenB = token1;
            pairInfo.currentPrice = msg.value;              //could be more than PriceLowLimit
            pairInfo.timeCreated = uint64(block.timestamp);
            pairInfo.poolState = PoolRunningPhase.BidPhase;

            ListPools[tokenID] = pairInfo;
            emit PairCreadted(tokenA, tokenB, tokenID);

            // Airdrop to the first tender
            TransferHelper.safeTransfer(FeswapToken, to, AIRDROP_FOR_FIRST);
        }
    }

    /**
     * @dev Settle the bid for the swap pair. 
     */
    function FeswaPairSettle(uint256 tokenID) external {
        require(msg.sender == ownerOf(tokenID), 'FESN: NOT TOKEN OWNER');
        
        FeswaPair storage pairInfo = ListPools[tokenID]; 
        if(pairInfo.poolState == PoolRunningPhase.BidPhase){
            require(block.timestamp > pairInfo.timeCreated + OPEN_BID_DURATION, 'FESN: BID ON GOING');  
        } else {
            require(pairInfo.poolState == PoolRunningPhase.BidDelaying, 'FESN: BID COMPLETED'); 
            require(block.timestamp > pairInfo.lastBidTime + CLOSE_BID_DELAY, 'FESN: BID ON GOING');
        }

        pairInfo.poolState = PoolRunningPhase.BidSettled;

        // Airdrop to the first tender
        TransferHelper.safeTransfer(FeswapToken, msg.sender, pairInfo.currentPrice.mul(AIRDROP_RATE_FOR_WINNER));
    }    

    /**
     * @dev Sell the Pair with the specified Price. 
     */
    function FeswaPairForSale(uint256 tokenID, uint256 pairPrice) external returns (uint256 newPrice) {
        require(msg.sender == ownerOf(tokenID), 'FESN: NOT TOKEN OWNER');
        
        FeswaPair storage pairInfo = ListPools[tokenID]; 
        require(pairInfo.poolState >= PoolRunningPhase.BidSettled, 'FESN: BID NOT SETTLED'); 

        if(pairPrice != 0){
            pairInfo.poolState = PoolRunningPhase.PoolForSale;
            pairInfo.currentPrice = pairPrice;
        } else{
            pairInfo.poolState = PoolRunningPhase.PoolHolding;
            pairInfo.currentPrice = uint256(-1);
        }
        
        return pairPrice;
    }    

    /**
     * @dev Sell the Pair with the specified Price. 
     */
    function FeswaPairBuyIn(uint256 tokenID, uint256 newPrice, address to) external payable returns (uint256 getPrice) {
        require(_exists(tokenID), 'FESN: TOKEN NOT CREATED');
        FeswaPair storage pairInfo = ListPools[tokenID]; 
        require( pairInfo.poolState == PoolRunningPhase.PoolForSale, 'FESN: NOT FOR SALE');

        uint256  currentPrice = pairInfo.currentPrice;
        require(msg.value >= currentPrice, 'FESN: PAY LESS');  

        // Change the token owner
         address preOwner = ownerOf(tokenID);
        _transfer(preOwner, to, tokenID);

        if(newPrice != 0){
            pairInfo.currentPrice = newPrice;

        } else{
            pairInfo.poolState = PoolRunningPhase.PoolHolding;
            pairInfo.currentPrice = uint256(-1);
        }

        // Send ETH to the owner                    
        TransferHelper.safeTransferETH(preOwner, currentPrice);
        if( msg.value > currentPrice) 
            TransferHelper.safeTransferETH(msg.sender, msg.value - currentPrice);

        return currentPrice;    
    }    

    /**
     * @dev Return the token-pair information 
     */
    function getPoolInfoByTokens(address tokenA, address tokenB) external view returns (uint256 tokenID, FeswaPair memory pairInfo) {
        (address token0, address token1) = (tokenA < tokenB) ? (tokenA, tokenB) : (tokenB, tokenA);
        tokenID = uint256(keccak256(abi.encodePacked(address(this), token0, token1)));
        require(_exists(tokenID), 'FESN: TOKEN NOT CREATED');
        pairInfo = ListPools[tokenID];
    }

    /**
     * @dev Return the token pair addresses by TokenID 
     */
    function getPoolTokens(uint256 tokenID) external view returns (address tokenA, address tokenB) {
        FeswaPair storage pairInfo = ListPools[tokenID];
        require(pairInfo.tokenA != address(0), 'FESN: NOT TOKEN OWNER');
        return  (pairInfo.tokenA, pairInfo.tokenB);
    }

    /**
     * @dev Set the initial pool price
     */
    function setPriceLowLimit(uint256 priceLowLimit) onlyOwner public {
        PriceLowLimit = priceLowLimit;
    }

    /**
     * @dev Withdraw
     */
    function withdraw(address to, uint256 value) onlyOwner public {
        require(address(this).balance >= value, 'FESN: INSUFFICIENT BALANCE');
        TransferHelper.safeTransferETH(to, value);
    }
}