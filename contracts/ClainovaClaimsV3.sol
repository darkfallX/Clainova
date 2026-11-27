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

/// @title ClainovaClaimsV3
/// @notice ClainovaClaims v2 plus a post-quantum guardian for the verifier key.
///         Payments, claims and refunds behave exactly as in v2. What changes: one
///         offline ML-DSA-87 guardian key, fixed at deployment, can replace the
///         verifier key or freeze claims, by a signature checked with pqcVerify.
/// @dev Security notes:
///      - The guardian can never move funds. No guardian path touches the token, and
///        a refund after expiry always pays the original sender, frozen or not.
///      - Guardian messages bind a domain, the chain, this contract and a nonce that
///        must equal `guardianNonce` and then increments, so a signature works once,
///        here only. Anyone may submit one: the signature is the authority, not the sender.
///      - Rotation takes effect at once: attestations by the old key stop working.
///      - Freezing stops claims until the next rotation. Funding and refunds continue.
///      - The guardian key must differ from the verifier key, so one leaked seed can't
///        both forge attestations and keep the old key in place.
contract ClainovaClaimsV3 {
    enum State { Missing, Funded, Collected, Refunded }
    struct Payment { address sender; uint64 expiry; State state; uint128 amount; address recipient; }

    mapping(bytes32 => Payment) public payments;
    IFestUSD public immutable token;
    /// @notice ML-DSA-87 public key of the off-chain verifier. Replaceable only by the guardian.
    bytes public verifierKey;
    /// @notice ML-DSA-87 public key of the offline guardian. Written once in the constructor.
    bytes public guardianKey;
    /// @notice The nonce the next guardian message must carry.
    uint64 public guardianNonce;
    /// @notice True after a guardian freeze, until the next rotation.
    bool public frozen;
    bytes32 public constant DOMAIN = keccak256("Clainova/collect/v1");
    bytes32 public constant ROTATE = keccak256("Clainova/rotate-verifier/v3");
    bytes32 public constant FREEZE = keccak256("Clainova/freeze-claims/v3");
    uint256 public constant MAX_PERIOD = 30 days;
    uint256 private constant KEY = 2592;
    uint256 private constant SIGNATURE = 4627;
    IVerify private constant PQ = IVerify(address(0x0a01));
    IKeyStatus private constant REGISTRY = IKeyStatus(address(0x0a02));
    uint256 private unlocked = 1;

    event Funded(bytes32 indexed id, address indexed sender, uint128 amount, uint64 expiry);
    event Collected(bytes32 indexed id, address indexed recipient);
    event Refunded(bytes32 indexed id, address indexed sender);
    event VerifierRotated(uint64 indexed nonce, bytes32 keyHash);
    event ClaimsFrozen(uint64 indexed nonce);

    modifier nonReentrant() {
        require(unlocked == 1, "Reentrant call");
        unlocked = 2;
        _;
        unlocked = 1;
    }

    constructor(IFestUSD asset, bytes memory key, bytes memory guardian) {
        require(
            address(asset).code.length > 0 && _validKey(key) && _validKey(guardian) && keccak256(key) != keccak256(guardian),
            "Invalid configuration"
        );
        token = asset;
        verifierKey = key;
        guardianKey = guardian;
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
        require(!frozen, "Claims frozen");
        Payment storage payment = payments[id];
        require(payment.state == State.Funded, "Payment closed");
        require(block.timestamp < deadline && deadline <= payment.expiry, "Signature expired");
        (bool active, uint8 algorithm,, bool proven) = REGISTRY.pqcKeyStatus(msg.sender);
        require(active && algorithm == 1 && proven, "Register a possession-proven ML-DSA key");
        require(signature.length == SIGNATURE && PQ.pqcVerify(verifierKey, signature, message(id, msg.sender, deadline)), "Invalid attestation");
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

    /// @notice The exact bytes the guardian signs to make `newKey` the verifier key.
    function rotateMessage(bytes calldata newKey, uint64 nonce) public view returns (bytes memory) {
        return abi.encode(ROTATE, block.chainid, address(this), nonce, keccak256(newKey));
    }

    /// @notice The exact bytes the guardian signs to freeze claims.
    function freezeMessage(uint64 nonce) public view returns (bytes memory) {
        return abi.encode(FREEZE, block.chainid, address(this), nonce);
    }

    /// @notice Replace the verifier key with a guardian signature. Also lifts a freeze.
    function rotateVerifier(bytes calldata newKey, uint64 nonce, bytes calldata signature) external nonReentrant {
        require(_validKey(newKey) && keccak256(newKey) != keccak256(guardianKey), "Invalid key");
        _guardian(signature, rotateMessage(newKey, nonce), nonce);
        verifierKey = newKey;
        frozen = false;
        emit VerifierRotated(nonce, keccak256(newKey));
    }

    /// @notice Stop all claims with a guardian signature, until the next rotation.
    function freeze(uint64 nonce, bytes calldata signature) external nonReentrant {
        _guardian(signature, freezeMessage(nonce), nonce);
        frozen = true;
        emit ClaimsFrozen(nonce);
    }

    function _guardian(bytes calldata signature, bytes memory signed, uint64 nonce) private {
        require(nonce == guardianNonce, "Stale nonce");
        require(signature.length == SIGNATURE && PQ.pqcVerify(guardianKey, signature, signed), "Invalid guardian signature");
        guardianNonce = nonce + 1;
    }

    function _validKey(bytes memory key) private pure returns (bool) {
        return key.length == KEY && keccak256(key) != keccak256(new bytes(KEY));
    }

    /// @dev Token call that checks success and the return value. Empty return data is
    ///      accepted for tokens that do not return a bool.
    function _call(bytes memory data, string memory reason) private {
        (bool ok, bytes memory result) = address(token).call(data);
        require(ok && (result.length == 0 || (result.length == 32 && abi.decode(result, (bool)))), reason);
    }
}
