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
// Token that returns no data, like some pre-standard ERC-20s.
contract SilentTokenFixture {
    mapping(address=>uint256) public balanceOf;
    mapping(address=>mapping(address=>uint256)) public allowance;
    function mint(address a,uint256 n) external {balanceOf[a]+=n;}
    function approve(address spender,uint256 n) external {allowance[msg.sender][spender]=n;}
    function transfer(address to,uint256 n) external {balanceOf[msg.sender]-=n;balanceOf[to]+=n;}
    function transferFrom(address from,address to,uint256 n) external {allowance[from][msg.sender]-=n;balanceOf[from]-=n;balanceOf[to]+=n;}
}
// Token that reports failure by returning false instead of reverting.
contract FalseTokenFixture {
    function transfer(address,uint256) external pure returns(bool){return false;}
    function transferFrom(address,address,uint256) external pure returns(bool){return false;}
}
// Token whose transfer tries to re-enter the escrow before finishing.
contract ReentrantTokenFixture {
    mapping(address=>uint256) public balanceOf;
    mapping(address=>mapping(address=>uint256)) public allowance;
    address public target; bytes public payload;
    function arm(address t, bytes calldata p) external {target=t;payload=p;}
    function mint(address a,uint256 n) external {balanceOf[a]+=n;}
    function approve(address spender,uint256 n) external returns(bool){allowance[msg.sender][spender]=n;return true;}
    function transfer(address to,uint256 n) external returns(bool){
        if (target != address(0)) { (bool ok,) = target.call(payload); require(ok, "reentry blocked"); }
        balanceOf[msg.sender]-=n;balanceOf[to]+=n;return true;
    }
    function transferFrom(address from,address to,uint256 n) external returns(bool){allowance[from][msg.sender]-=n;balanceOf[from]-=n;balanceOf[to]+=n;return true;}
}
// Registry whose answer for each wallet is set by the test: active, algorithm, proven.
contract StatusFixture {
    struct S { bool active; uint8 algorithm; bool proven; }
    mapping(address=>S) internal s;
    function set(address a, bool active, uint8 algorithm, bool proven) external { s[a] = S(active, algorithm, proven); }
    function pqcKeyStatus(address a) external view returns(bool,uint8,bytes memory,bool){ S memory x = s[a]; return (x.active,x.algorithm,"",x.proven); }
}
// Token whose transfer or transferFrom tries to re-enter the escrow before finishing.
contract ReentrantAnyFixture {
    mapping(address=>uint256) public balanceOf;
    mapping(address=>mapping(address=>uint256)) public allowance;
    address public target; bytes public payload; bool public onPull;
    function arm(address t, bytes calldata p, bool pull) external {target=t;payload=p;onPull=pull;}
    function mint(address a,uint256 n) external {balanceOf[a]+=n;}
    function approve(address spender,uint256 n) external returns(bool){allowance[msg.sender][spender]=n;return true;}
    function hook(bool pull) internal { if (target != address(0) && pull == onPull) { (bool ok,) = target.call(payload); require(ok, "reentry blocked"); } }
    function transfer(address to,uint256 n) external returns(bool){ hook(false); balanceOf[msg.sender]-=n;balanceOf[to]+=n;return true; }
    function transferFrom(address from,address to,uint256 n) external returns(bool){ hook(true); allowance[from][msg.sender]-=n;balanceOf[from]-=n;balanceOf[to]+=n;return true; }
}
// Token that re-enters once during a payout, records the escrow's answer and carries on.
contract ReentrantProbeFixture {
    mapping(address=>uint256) public balanceOf;
    mapping(address=>mapping(address=>uint256)) public allowance;
    address public target; bytes public payload; bool public tried; bytes public lastError;
    function arm(address t, bytes calldata p) external {target=t;payload=p;}
    function mint(address a,uint256 n) external {balanceOf[a]+=n;}
    function approve(address spender,uint256 n) external returns(bool){allowance[msg.sender][spender]=n;return true;}
    function transfer(address to,uint256 n) external returns(bool){
        if (target != address(0) && !tried) { tried = true; (bool ok, bytes memory ret) = target.call(payload); if (!ok) lastError = ret; }
        balanceOf[msg.sender]-=n;balanceOf[to]+=n;return true;
    }
    function transferFrom(address from,address to,uint256 n) external returns(bool){allowance[from][msg.sender]-=n;balanceOf[from]-=n;balanceOf[to]+=n;return true;}
}
// Token that silently moves less than asked: a fee-on-transfer token.
contract ShortTokenFixture {
    mapping(address=>uint256) public balanceOf;
    mapping(address=>mapping(address=>uint256)) public allowance;
    function mint(address a,uint256 n) external {balanceOf[a]+=n;}
    function approve(address spender,uint256 n) external returns(bool){allowance[msg.sender][spender]=n;return true;}
    function transfer(address to,uint256 n) external returns(bool){balanceOf[msg.sender]-=n;balanceOf[to]+=n;return true;}
    function transferFrom(address from,address to,uint256 n) external returns(bool){allowance[from][msg.sender]-=n;balanceOf[from]-=n;balanceOf[to]+=n-n/10;return true;}
}
contract TokenFixture {
    mapping(address=>uint256) public balanceOf;
    mapping(address=>mapping(address=>uint256)) public allowance;
    function mint(address a,uint256 n) external {balanceOf[a]+=n;}
    function approve(address spender,uint256 n) external returns(bool){allowance[msg.sender][spender]=n;return true;}
    function transfer(address to,uint256 n) external returns(bool){balanceOf[msg.sender]-=n;balanceOf[to]+=n;return true;}
    function transferFrom(address from,address to,uint256 n) external returns(bool){allowance[from][msg.sender]-=n;balanceOf[from]-=n;balanceOf[to]+=n;return true;}
}
