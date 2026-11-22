// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// Test-only substitutes for Diana precompiles. They live only in Hardhat's in-memory EVM.
contract VerificationFixture {
    mapping(bytes32 => bool) internal known;
    function allow(bytes calldata key, bytes calldata sig, bytes calldata data) external { known[keccak256(abi.encode(key,sig,data))] = true; }
    function pqcVerify(bytes calldata key,bytes calldata sig,bytes calldata data) external view returns(bool){ return known[keccak256(abi.encode(key,sig,data))]; }
}
contract RegistryFixture {
    mapping(address=>bool) internal active;
    function register(address wallet) external {active[wallet]=true;}
    function pqcKeyStatus(address a) external view returns(bool,uint8,bytes memory,bool){ return (true,1,"",active[a]); }
}
contract TokenFixture {
    mapping(address=>uint256) public balanceOf;
    mapping(address=>mapping(address=>uint256)) public allowance;
    function mint(address a,uint256 n) external {balanceOf[a]+=n;}
    function approve(address spender,uint256 n) external returns(bool){allowance[msg.sender][spender]=n;return true;}
    function transfer(address to,uint256 n) external returns(bool){balanceOf[msg.sender]-=n;balanceOf[to]+=n;return true;}
    function transferFrom(address from,address to,uint256 n) external returns(bool){allowance[from][msg.sender]-=n;balanceOf[from]-=n;balanceOf[to]+=n;return true;}
}
