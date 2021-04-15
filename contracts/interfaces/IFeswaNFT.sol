// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.7.0;

interface IFeswaNFT {
    // Views
    function ownerOf(uint256 tokenId) external view returns (address owner);
    function getPoolTokens(uint256 tokenId) external view returns (address tokenA, address tokenB);
}