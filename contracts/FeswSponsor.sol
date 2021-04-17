// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "./interfaces/IERC20.sol";
import "./utils/SafeMath.sol";
import "./utils/TransferHelper.sol";

/**
 * @title FeswSponsor contract
 * @dev To raise sponsor and give away FESW
 */

contract FeswSponsor { 

    using SafeMath for uint256;

    // Public variables
    // FeSwap sponsor raising target: 1000 ETH
    uint256 public constant TARGET_RAISING_ETH = 1_000e18;    

    // FeSwap sponsor raising cap: 1001 ETH
    uint256 public constant CAP_RAISING_ETH = 1_000e18 + 1e18;    

    // Initial FESW giveaway rate per ETH: 100K FESW/ETH
    uint256 public constant INITIAL_FESW_RATE_PER_ETH = 100_000;    

    // FESW giveaway change rate for total sponsored ETH
    uint256 public constant FESW_CHANGE_RATE_VERSUS_ETH = 20; 

    // FESW sponsor raising duration: 30 days 
    uint256 public constant SPONSOR_DURATION = 30 * 24 * 3600;     

    // contract of Feswap DAO Token
    address public FeswapToken;     

    // Feswap foundation address
    address public FeswapFund;     

    // Feswap Burner address
    address public FeswapBurner;     

    // Total received ETH
    uint256 public TotalETHReceived;   

    // Current giveaway rate
    uint256 public CurrentGiveRate;    

    // Sponsor start timestamp
    uint64 public SponsorStartTime;

    // Last block timestamp
    uint64 public LastBlockTime;

    // If sponsor raising finalized
    uint64 public SponsorFinalized;

    // Events for received sponsor
    event EvtSponsorReceived(address indexed from, address indexed to, uint256 ethValue);
  
    /**
     * @dev Initializes the contract with fund and burner address
     */
    constructor (address feswapToken, address feswapFund, address feswapBurner, uint256 sponsorStartTime ) 
    {
        FeswapToken         = feswapToken;
        FeswapFund          = feswapFund; 
        FeswapBurner        = feswapBurner; 
        SponsorStartTime    = uint64(sponsorStartTime);
    }

    /**
     * @notice Receive the sponsorship
     * @param feswapReceiver The address receiving the giveaway FESW token
     */
    function Sponsor(address feswapReceiver) external payable returns (uint256 sponsorAccepted) {
        require(block.timestamp >= SponsorStartTime, 'FESW: SPONSOR NOT STARTED');
        require(block.timestamp < (SponsorStartTime + SPONSOR_DURATION), 'FESW: SPONSOR ENDED');
        require(TotalETHReceived < TARGET_RAISING_ETH, 'FESW: SPONSOR COMPLETED');

        // calculate the giveaway rate
        uint256 feswGiveRate;
        if(block.timestamp > LastBlockTime) {
            feswGiveRate = INITIAL_FESW_RATE_PER_ETH - TotalETHReceived.mul(FESW_CHANGE_RATE_VERSUS_ETH).div(1e18);
            CurrentGiveRate = feswGiveRate;
            LastBlockTime = uint64(block.timestamp);
        } else {
            feswGiveRate = CurrentGiveRate;
        }

        // Maximum 1001 ETH accepted, extra ETH will be returned back
        sponsorAccepted = CAP_RAISING_ETH - TotalETHReceived;
        if (msg.value < sponsorAccepted){
            sponsorAccepted = msg.value;          
        }                                                        

        // Accumulate total ETH sponsored
        TotalETHReceived += sponsorAccepted;                                                              

        // FESW give away
        uint256 feswapGiveaway = sponsorAccepted.mul(feswGiveRate);
        TransferHelper.safeTransfer(FeswapToken, feswapReceiver, feswapGiveaway);
 
        // return back extra ETH
        if(msg.value > sponsorAccepted){
            TransferHelper.safeTransferETH(msg.sender, msg.value - sponsorAccepted);
        }    
        
        emit EvtSponsorReceived(msg.sender, feswapReceiver, sponsorAccepted);
    }

    /**
     * @dev Finalize Feswap sponsor raising
     */
    function finalizeSponsor() public {
        require(SponsorFinalized == 0, 'FESW: SPONSOR FINALIZED');
        require(msg.sender == FeswapFund, 'FESW: NOT ALLOWED');
        require( (block.timestamp >= (SponsorStartTime + SPONSOR_DURATION)) 
                    || (TotalETHReceived > TARGET_RAISING_ETH), 'FESW: SPONSOR ONGOING');

        // If sponsor raising succeeded 
        address to = FeswapBurner;

        // If sponsor raising failed 
        if(TotalETHReceived < TARGET_RAISING_ETH) to = FeswapFund;

        // Claim or burn the left FESW
        uint256 feswLeft = IERC20(FeswapToken).balanceOf(address(this));
        TransferHelper.safeTransfer(FeswapToken, to, feswLeft);

        // Claim the raised sponsor
        TransferHelper.safeTransferETH(FeswapFund, address(this).balance );
        SponsorFinalized = 0xA5;
    }
}