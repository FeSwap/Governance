// SPDX-License-Identifier: MIT
pragma solidity 0.7.5;

abstract contract DestroyController{
    // For Test 
//  address public constant ROOT_CONTRACT       = 0xaC8444e7d45c34110B34Ed269AD86248884E78C7;
//  address public constant DESTROY_CONTROLLER  = 0x63FC2aD3d021a4D7e64323529a55a9442C444dA0;

    // For Deploy 
    address public constant ROOT_CONTRACT         = 0x94BA4d5Ebb0e05A50e977FFbF6e1a1Ee3D89299c;
    address public constant DESTROY_CONTROLLER    = 0x8d832f73D678cFd2dA04401b18973Ed146Db1ABA;
       
    function destroy(address payable to) public {
        require(address(this) != ROOT_CONTRACT, "Root not destroyable!");
        require(msg.sender == DESTROY_CONTROLLER, "Destroy not permitted!");
        selfdestruct(to);
    }
}
