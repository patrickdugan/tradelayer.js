const crypto = require("crypto");

// Network parameters
const networks = {
  bitcoin: {
    P2PKH: 0x00,
    P2SH: 0x05,
    bech32: "bc",
  },
  litecoin: {
    P2PKH: 0x30,
    P2SH: 0x32,
    bech32: "ltc",
  },
  dogecoin: {
    P2PKH: 0x1E,
    P2SH: 0x16,
  },
  testnet: {
    bitcoin: {
      P2PKH: 0x6F,
      P2SH: 0xC4,
      bech32: "tb",
    },
    litecoin: {
      P2PKH: 0x6F,
      P2SH: 0x3A,
      bech32: "tltc",
    },
    dogecoin: {
      P2PKH: 0x71,
      P2SH: 0xC4,
    },
  },
};

// Base58 alphabet
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

// Base58 decoding
function decodeBase58(address) {
  let decoded = BigInt(0);
  for (const char of address) {
    const index = BASE58_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error("Invalid Base58 character");
    }
    decoded = decoded * BigInt(58) + BigInt(index);
  }
  const hex = decoded.toString(16);
  const padding = address.match(/^1+/) ? address.match(/^1+/)[0].length : 0;
  return Buffer.from("00".repeat(padding) + hex.padStart(50, "0"), "hex");
}

// Validate checksum for Base58 addresses
function validateBase58Checksum(address, versionByte) {
  try {
    const decoded = decodeBase58(address);
    const version = decoded[0];
    const checksum = decoded.slice(-4);
    const body = decoded.slice(0, -4);
    const validChecksum = crypto
      .createHash("sha256")
      .update(crypto.createHash("sha256").update(body).digest())
      .digest()
      .slice(0, 4);
    return version === versionByte && checksum.equals(validChecksum);
  } catch (error) {
    return false;
  }
}

const {bech32} = require("bech32");

// Validate Bech32 addresses with checksum
function validateBech32(address, hrp) {
  try {
    const { prefix } = bech32.decode(address); // Decode Bech32 address
    return prefix === hrp; // Check if the prefix matches
  } catch (error) {
    return false; // Invalid Bech32 address
  }
}


// Main validation function
function validateAddress(address) {
  if (!address || typeof address !== "string") {
    throw new Error("Invalid address provided");
  }

  // Select the network based on the address prefix
  let network = null;

  for (const [networkName, netConfig] of Object.entries(networks)) {
    const { P2PKH, P2SH, bech32 } = netConfig;

    // Match based on the prefix
    if (
      (address.startsWith("1") && P2PKH === 0x00) || // Bitcoin P2PKH
      (address.startsWith("L") && P2PKH === 0x30) || // Litecoin P2PKH
      (address.startsWith("D") && P2PKH === 0x1E) || // Dogecoin P2PKH
      (address.startsWith("m") || address.startsWith("n") || address.startsWith("2")) || // Testnets
      (address.startsWith("3") && P2SH === 0x05) || // Bitcoin P2SH
      (address.startsWith("M") && P2SH === 0x32) || // Litecoin P2SH
      (bech32 && address.toLowerCase().startsWith(bech32))
    ) {
      network = netConfig;
      break;
    }
  }

  if (!network) {
    return false; // Address prefix doesn't match any network
  }

  const { P2PKH, P2SH, bech32 } = network;

  if (address.startsWith("1") || address.startsWith("L") || address.startsWith("D") || address.startsWith("m") || address.startsWith("n")) {
    // Validate P2PKH
    return validateBase58Checksum(address, P2PKH);
  } else if (address.startsWith("3") || address.startsWith("M") || address.startsWith("2")) {
    // Validate P2SH
    return validateBase58Checksum(address, P2SH);
  } else if (bech32 && address.toLowerCase().startsWith(bech32)) {
    // Validate Bech32
    return validateBech32(address, bech32);
  }

  return false; // Invalid address format
}

let first = validateAddress('DNWszyeJFD3qX51cCCDZcBKxnTpbN2N8Sh')
let second = validateAddress('DNWszyeJFD3qX51cCCDZcBKxnTpbm1N8Sh')

console.log('first and second '+first +' '+second)