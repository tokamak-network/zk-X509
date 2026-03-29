/// ABI and deployment info for the IdentityRegistry contract.

export const IDENTITY_REGISTRY_ABI = [
  // ============ User Functions ============
  {
    inputs: [
      { name: "proof", type: "bytes" },
      { name: "publicValues", type: "bytes" },
    ],
    name: "register",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "proof", type: "bytes" },
      { name: "publicValues", type: "bytes" },
    ],
    name: "reRegister",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },

  // ============ View Functions ============
  {
    inputs: [{ name: "user", type: "address" }],
    name: "isVerified",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "", type: "address" }],
    name: "verifiedUntil",
    outputs: [{ name: "", type: "uint64" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "", type: "bytes32" }],
    name: "nullifierOwner",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "", type: "bytes32" }],
    name: "revokedNullifiers",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "owner",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "pendingOwner",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "paused",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "caMerkleRoot",
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "previousCaMerkleRoot",
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "caMerkleRootUpdatedAt",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "caRootGracePeriod",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "crlMerkleRoot",
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "maxProofAge",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "MAX_WALLETS_PER_CERT",
    outputs: [{ name: "", type: "uint32" }],
    stateMutability: "view",
    type: "function",
  },

  // ============ CA List Management ============
  {
    inputs: [{ name: "caHash", type: "bytes32" }],
    name: "addCA",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "caHashes", type: "bytes32[]" }],
    name: "addCAs",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "index", type: "uint256" }],
    name: "removeCA",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "indices", type: "uint256[]" }],
    name: "removeCAs",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "getCaCount",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getCaLeaves",
    outputs: [{ name: "", type: "bytes32[]" }],
    stateMutability: "view",
    type: "function",
  },

  // ============ Admin Functions ============
  {
    inputs: [{ name: "newRoot", type: "bytes32" }],
    name: "updateCaMerkleRoot",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "newRoot", type: "bytes32" }],
    name: "updateCrlMerkleRoot",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "newAge", type: "uint256" }],
    name: "setMaxProofAge",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "newPeriod", type: "uint256" }],
    name: "setCaRootGracePeriod",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "nullifier", type: "bytes32" },
      { name: "reason", type: "bytes32" },
    ],
    name: "revokeIdentity",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "pause",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "unpause",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "newOwner", type: "address" }],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "acceptOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },

  // ============ Events ============
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "user", type: "address" },
      { indexed: false, name: "nullifier", type: "bytes32" },
    ],
    name: "UserRegistered",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "oldUser", type: "address" },
      { indexed: true, name: "newUser", type: "address" },
      { indexed: false, name: "nullifier", type: "bytes32" },
    ],
    name: "UserReRegistered",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [{ indexed: true, name: "newRoot", type: "bytes32" }],
    name: "CaMerkleRootUpdated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "caHash", type: "bytes32" },
      { indexed: false, name: "index", type: "uint256" },
    ],
    name: "CaAdded",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "caHash", type: "bytes32" },
      { indexed: false, name: "index", type: "uint256" },
    ],
    name: "CaRemoved",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "user", type: "address" },
      { indexed: true, name: "nullifier", type: "bytes32" },
      { indexed: false, name: "reason", type: "bytes32" },
    ],
    name: "IdentityRevoked",
    type: "event",
  },

  // ============ Errors ============
  {
    inputs: [
      { name: "proofRoot", type: "bytes32" },
      { name: "expectedRoot", type: "bytes32" },
    ],
    name: "InvalidCaMerkleRoot",
    type: "error",
  },
  {
    inputs: [{ name: "nullifier", type: "bytes32" }],
    name: "AlreadyRegistered",
    type: "error",
  },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "UserAlreadyVerified",
    type: "error",
  },
  {
    inputs: [
      { name: "proofRegistrant", type: "address" },
      { name: "actualSender", type: "address" },
    ],
    name: "RegistrantMismatch",
    type: "error",
  },
  {
    inputs: [{ name: "nullifier", type: "bytes32" }],
    name: "NullifierRevoked",
    type: "error",
  },
  {
    inputs: [
      { name: "proofTimestamp", type: "uint64" },
      { name: "blockTimestamp", type: "uint256" },
    ],
    name: "ProofTooOld",
    type: "error",
  },
  {
    inputs: [
      { name: "notAfter", type: "uint64" },
      { name: "blockTimestamp", type: "uint256" },
    ],
    name: "CertAlreadyExpired",
    type: "error",
  },
  { inputs: [], name: "OnlyOwner", type: "error" },
  { inputs: [], name: "ContractPaused", type: "error" },

  // ============ MIN_DISCLOSURE_MASK ============
  {
    inputs: [],
    name: "MIN_DISCLOSURE_MASK",
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

/// Registry address from environment variable (NEXT_PUBLIC_REGISTRY_ADDRESS).
export function getRegistryAddress(_chainId: string): string {
  return process.env.NEXT_PUBLIC_REGISTRY_ADDRESS || "";
}

// ============================================================
// RegistryFactory ABI
// ============================================================

export const REGISTRY_FACTORY_ABI = [
  // ============ Write Functions ============
  {
    inputs: [
      { name: "name", type: "string" },
      { name: "maxWallets", type: "uint32" },
      { name: "minDisclosureMask", type: "uint8" },
      { name: "maxProofAge", type: "uint256" },
    ],
    name: "createRegistry",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "payable",
    type: "function",
  },

  // ============ View Functions ============
  {
    inputs: [],
    name: "feeToken",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "registryCreationFee",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getRegistries",
    outputs: [{ name: "", type: "address[]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getRegistryCount",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "offset", type: "uint256" },
      { name: "limit", type: "uint256" },
    ],
    name: "getRegistriesPaginated",
    outputs: [{ name: "", type: "address[]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "", type: "address" }],
    name: "registryInfo",
    outputs: [
      { name: "creator", type: "address" },
      { name: "name", type: "string" },
      { name: "maxWallets", type: "uint32" },
      { name: "minDisclosureMask", type: "uint8" },
      { name: "maxProofAge", type: "uint256" },
      { name: "createdAt", type: "uint256" },
      { name: "vKeyVersion", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "", type: "address" }],
    name: "isRegistry",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "owner",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "SP1_VERIFIER",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "currentProgramVKey",
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "vKeyVersionCount",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "", type: "uint256" }],
    name: "vKeyVersions",
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "newVKey", type: "bytes32" }],
    name: "updateProgramVKey",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },

  // ============ Events ============
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "registry", type: "address" },
      { indexed: true, name: "owner", type: "address" },
      { indexed: false, name: "name", type: "string" },
      { indexed: false, name: "maxWallets", type: "uint32" },
      { indexed: false, name: "minDisclosureMask", type: "uint8" },
      { indexed: false, name: "vKeyVersion", type: "uint256" },
    ],
    name: "RegistryCreated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "newVKey", type: "bytes32" },
      { indexed: false, name: "version", type: "uint256" },
    ],
    name: "ProgramVKeyUpdated",
    type: "event",
  },
] as const;

/// Factory address from environment variable (NEXT_PUBLIC_FACTORY_ADDRESS).
export function getFactoryAddress(_chainId: string): string {
  return process.env.NEXT_PUBLIC_FACTORY_ADDRESS || "";
}

/// RPC URL from environment variable, or fallback.
export function getRpcUrl(): string {
  return process.env.NEXT_PUBLIC_RPC_URL || "http://localhost:8545";
}
