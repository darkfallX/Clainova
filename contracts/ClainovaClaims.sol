// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IFestUSD {
    function transfer(address recipient, uint256 amount) external returns (bool);
    function transferFrom(address owner, address recipient, uint256 amount) external returns (bool);
}
interface IVerify {
    function pqcVerify(bytes calldata key, bytes calldata signature, bytes calldata message) external view returns (bool);
}
interface IKeyStatus {
    function pqcKeyStatus(address account) external view returns (bool, uint8, bytes memory, bool);
}

/// @notice Single-token escrow on QoreChain Diana. Each invitation has its own opaque ID.
contract ClainovaClaims {
    enum State { Missing, Funded, Collected, Refunded }
    struct Payment { address sender; uint64 expiry; State state; uint128 amount; address recipient; }
    mapping(bytes32 => Payment) public payments;
    IFestUSD public immutable token;
    bytes public verifierKey;
    bytes32 public constant DOMAIN = keccak256("Clainova/collect/v1");
    IVerify private constant PQ = IVerify(address(0x0a01));
    IKeyStatus private constant REGISTRY = IKeyStatus(address(0x0a02));
    event Funded(bytes32 indexed id, address indexed sender, uint128 amount, uint64 expiry);
    event Collected(bytes32 indexed id, address indexed recipient);
    event Refunded(bytes32 indexed id, address indexed sender);

    constructor(IFestUSD asset, bytes memory key) {
        require(address(asset).code.length > 0 && key.length == 2592, "Invalid configuration");
        token = asset;
        verifierKey = key;
    }
    function fund(bytes32 salt, uint128 amount, uint64 expiry) external returns (bytes32 id) {
        require(amount > 0 && expiry > block.timestamp && expiry <= block.timestamp + 30 days, "Invalid payment");
        id = keccak256(abi.encode(msg.sender, salt));
        require(payments[id].state == State.Missing, "Duplicate payment");
        payments[id] = Payment(msg.sender, expiry, State.Funded, amount, address(0));
        require(token.transferFrom(msg.sender, address(this), amount), "Deposit failed");
        emit Funded(id, msg.sender, amount, expiry);
    }
    function message(bytes32 id, address destination, uint64 deadline) public view returns (bytes memory) {
        return abi.encode(DOMAIN, block.chainid, address(this), id, destination, deadline);
    }
    function claim(bytes32 id, uint64 deadline, bytes calldata signature) external {
        Payment storage payment = payments[id];
        require(payment.state == State.Funded, "Payment closed");
        require(block.timestamp < deadline && deadline <= payment.expiry, "Signature expired");
        (bool active, uint8 algorithm,, bool proven) = REGISTRY.pqcKeyStatus(msg.sender);
        require(active && algorithm == 1 && proven, "Register a possession-proven ML-DSA key");
        require(signature.length == 4627 && PQ.pqcVerify(verifierKey, signature, message(id, msg.sender, deadline)), "Invalid attestation");
        payment.state = State.Collected;
        payment.recipient = msg.sender;
        require(token.transfer(msg.sender, payment.amount), "Payout failed");
        emit Collected(id, msg.sender);
    }
    function refund(bytes32 id) external {
        Payment storage payment = payments[id];
        require(payment.state == State.Funded && block.timestamp >= payment.expiry, "Refund unavailable");
        payment.state = State.Refunded;
        require(token.transfer(payment.sender, payment.amount), "Refund failed");
        emit Refunded(id, payment.sender);
    }
}
