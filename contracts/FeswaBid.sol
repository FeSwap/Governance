// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "./utils/TransferHelper.sol";


/**
 * @title FeswaBid contract
 * @dev Extends ERC721 Non-Fungible Token Standard basic implementation
 */

contract FeswaBid is ERC721, Ownable { 

    using SafeMath for uint256;
    using Address for address;

    struct FeswaPair {
        address tokenA;
        address tokenB;
        uint256  timeCreated; 
        PoolRunningPhase  poolState;
        uint256 currentPrice;
    }

    // Public variables
    // Price offering duration: two weeks 
    uint256 public constant OPEN_BID_DURATION = (86400 * 14);

    // Price offering duration: two weeks 
    uint256 public PriceLowLimit;

    // Sale start timestamp
    uint256 public SaleStartTime;   // 1614556800  //2021/03/01 00:00

    // Mapping from token ID to token pair infomation
    mapping (uint256 => FeswaPair) public listPools;
 
    // Events
    event PairCreadted(address indexed tokenA, address indexed tokenB, uint256 tokenID);

    enum PoolRunningPhase {
        BidPhase, 
        PoolActivated, 
        PoolHolding, 
        PoolForSale
    }
    
    /**
     * @dev Initializes the contract by setting a `name` and a `symbol` to the token collection.
     */
    constructor (uint256 priceLowLimit_, uint256 saleStartTime_, string memory name_, string memory symbol_ ) 
        ERC721(name_, symbol_)
    {
        PriceLowLimit = priceLowLimit_;
        SaleStartTime = saleStartTime_;
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
            FeswaPair storage pairInfo = listPools[tokenID]; 
            require(block.timestamp < pairInfo.timeCreated + OPEN_BID_DURATION, 'FESN: BID TOO LATE');  // Bid keep open for two weeks
            require(msg.value >= pairInfo.currentPrice.mul(11).div(10), 'FESN: PAY LESS');  // minimum 10% increase

            uint256 repayAmount = msg.value.add(pairInfo.currentPrice.mul(9)).div(10);      // B + (A-B)/10
            address preOwner = ownerOf(tokenID);
            
            // Change the token owner
            _transfer(preOwner, to, tokenID);
            pairInfo.currentPrice = msg.value;

            // Repay the previous owner with 10% of the price increasement              
            TransferHelper.safeTransferETH(preOwner, repayAmount);

        } else {
            // _mint will check 'to' not be Zero, and tokenID not repeated.
            _mint(to, tokenID);

            // Prepare swap token-pair infomation
            FeswaPair memory _feswaPair;
            _feswaPair.tokenA = token0;
            _feswaPair.tokenB = token1;
            _feswaPair.currentPrice = msg.value;            
            _feswaPair.timeCreated = block.timestamp;
            _feswaPair.poolState = PoolRunningPhase.BidPhase;

            listPools[tokenID] = _feswaPair;
            emit PairCreadted(tokenA, tokenB, tokenID);
        }
    }

    /**
     * @dev Sell the Pair with the specified Price. 
     */
    function FeswaPairForSale(uint256 tokenID, uint256 pairPrice) external returns (uint256 newPrice) {
        require(msg.sender == ownerOf(tokenID), 'FESN: Not the token Owner');
        
        FeswaPair storage pairInfo = listPools[tokenID]; 
        require(block.timestamp >= pairInfo.timeCreated + OPEN_BID_DURATION, 'FESN: Bid not finished'); 

        pairInfo.poolState = PoolRunningPhase.PoolForSale;
        pairInfo.currentPrice = pairPrice;
        
        return pairPrice;
    }    

    /**
     * @dev Sell the Pair with the specified Price. 
     */
    function FeswaPairBuyIn(uint256 tokenID, uint256 newPrice, address to) external payable returns (uint256 getPrice) {
        FeswaPair storage pairInfo = listPools[tokenID]; 
        require( pairInfo.poolState == PoolRunningPhase.PoolForSale, 'FESN: Token Pair Not For Sale');

        uint256  currentPrice = pairInfo.currentPrice;
        require(msg.value >= currentPrice, 'FESN: Pay Less');  

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
    function getPoolByTokens(address tokenA, address tokenB) external view returns (FeswaPair memory pairInfo) {
        (address token0, address token1) = (tokenA < tokenB) ? (tokenA, tokenB) : (tokenB, tokenA);
        uint256 tokenID  = uint256(keccak256(abi.encodePacked(address(this), token0, token1)));
        return listPools[tokenID];
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
        require(address(this).balance >= value, 'FESN: Insufficient Balance');
        TransferHelper.safeTransferETH(to, value);
    }
}