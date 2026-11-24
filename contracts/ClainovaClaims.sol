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

/// @title ClainovaClaims
/// @notice Single-token escrow on QoreChain Diana. An organiser funds a payment for a phone
///         number; the recipient later collects it into a wallet the verifier attests to.
///         Each invitation has its own opaque ID, and no phone data is stored on-chain.
/// @dev Security notes (QCAI round 1 responses):
///      - Every external function follows checks-effects-interactions and also carries a
///        reentrancy guard, so a token callback cannot re-enter fund, claim or refund.
///      - Token calls use `_call`, which accepts both `true` and empty return data and
///        reverts on `false`, a revert or a non-contract token.
///      - The verifier key is written once in the constructor (length-checked, non-empty)
///        and has no setter, so no account can change it after deployment.
///      - A claim signature is bound to msg.sender. Copying it from the mempool fails for
///        any other sender, so front-running cannot redirect funds.
///      - Solidity 0.8 checks arithmetic; `expiry` is bounded to 30 days ahead.
contract ClainovaClaims {
    enum State { Missing, Funded, Collected, Refunded }
    struct Payment { address sender; uint64 expiry; State state; uint128 amount; address recipient; }

    /// @notice Payment records keyed by keccak256(sender, salt). Settled entries keep
    ///         their final state so an ID can never be funded twice.
    mapping(bytes32 => Payment) public payments;
    IFestUSD public immutable token;
    /// @notice ML-DSA-87 public key of the off-chain verifier. Immutable after deployment.
    bytes public verifierKey;
    bytes32 public constant DOMAIN = keccak256("Clainova/collect/v1");
    uint256 public constant MAX_PERIOD = 30 days;
    IVerify private constant PQ = IVerify(address(0x0a01));
    IKeyStatus private constant REGISTRY = IKeyStatus(address(0x0a02));
    uint256 private unlocked = 1;

    event Funded(bytes32 indexed id, address indexed sender, uint128 amount, uint64 expiry);
    event Collected(bytes32 indexed id, address indexed recipient);
    event Refunded(bytes32 indexed id, address indexed sender);

    modifier nonReentrant() {
        require(unlocked == 1, "Reentrant call");
        unlocked = 2;
        _;
        unlocked = 1;
    }

    constructor(IFestUSD asset, bytes memory key) {
        require(address(asset).code.length > 0 && key.length == 2592 && keccak256(key) != keccak256(new bytes(2592)), "Invalid configuration");
        token = asset;
        verifierKey = key;
    }

    /// @notice Deposit `amount` for a new invitation that can be collected until `expiry`.
    function fund(bytes32 salt, uint128 amount, uint64 expiry) external nonReentrant returns (bytes32 id) {
        require(amount > 0 && expiry > block.timestamp && expiry <= block.timestamp + MAX_PERIOD, "Invalid payment");
        id = keccak256(abi.encode(msg.sender, salt));
        require(payments[id].state == State.Missing, "Duplicate payment");
        payments[id] = Payment(msg.sender, expiry, State.Funded, amount, address(0));
        _call(abi.encodeCall(IFestUSD.transferFrom, (msg.sender, address(this), amount)), "Deposit failed");
        emit Funded(id, msg.sender, amount, expiry);
    }

    /// @notice The exact bytes the verifier signs for `destination`.
    function message(bytes32 id, address destination, uint64 deadline) public view returns (bytes memory) {
        return abi.encode(DOMAIN, block.chainid, address(this), id, destination, deadline);
    }

    /// @notice Collect a funded payment. The caller must be the attested destination and
    ///         hold a possession-proven ML-DSA key in the QoreChain registry.
    function claim(bytes32 id, uint64 deadline, bytes calldata signature) external nonReentrant {
        Payment storage payment = payments[id];
        require(payment.state == State.Funded, "Payment closed");
        require(block.timestamp < deadline && deadline <= payment.expiry, "Signature expired");
        (bool active, uint8 algorithm,, bool proven) = REGISTRY.pqcKeyStatus(msg.sender);
        require(active && algorithm == 1 && proven, "Register a possession-proven ML-DSA key");
        require(signature.length == 4627 && PQ.pqcVerify(verifierKey, signature, message(id, msg.sender, deadline)), "Invalid attestation");
        payment.state = State.Collected;
        payment.recipient = msg.sender;
        _call(abi.encodeCall(IFestUSD.transfer, (msg.sender, payment.amount)), "Payout failed");
        emit Collected(id, msg.sender);
    }

    /// @notice After expiry, anyone may return an uncollected payment to its sender.
    function refund(bytes32 id) external nonReentrant {
        Payment storage payment = payments[id];
        require(payment.state == State.Funded && block.timestamp >= payment.expiry, "Refund unavailable");
        payment.state = State.Refunded;
        _call(abi.encodeCall(IFestUSD.transfer, (payment.sender, payment.amount)), "Refund failed");
        emit Refunded(id, payment.sender);
    }

    /// @dev Token call that checks success and the return value. Empty return data is
    ///      accepted for tokens that do not return a bool.
    function _call(bytes memory data, string memory reason) private {
        (bool ok, bytes memory result) = address(token).call(data);
        require(ok && (result.length == 0 || (result.length == 32 && abi.decode(result, (bool)))), reason);
    }
}
