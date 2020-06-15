/*
 * SPDX-License-Identifier:    MIT
 */

pragma solidity ^0.5.8;


// subscription fees oracle rely on address(0) to denote native ETH
contract EtherTokenConstant {
    address internal constant ETH = address(0);
}
