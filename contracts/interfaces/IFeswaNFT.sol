// SPDX-License-Identifier: MIT
pragma solidity 0.7.5;

interface IFeswaNFT {
    // Views
    function ownerOf(uint256 tokenId) external view returns (address owner);
    function getPoolTokens(uint256 tokenId) external view returns (address tokenA, address tokenB);
}