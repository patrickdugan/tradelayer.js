// encodeDecode.js

// Function to encode "Simple Token Issue" transaction (Type 1)
function encodeSimpleTokenIssue(type, params) {
    const payload = [type, params.initialAmount, params.ticker, params.whitelists || 0];
    return payload.join(',');
}

// Function to decode "Simple Token Issue" transaction (Type 1)
function decodeSimpleTokenIssue(encodedPayload) {
    const parts = encodedPayload.split(',');
    const type = parseInt(parts[0], 10);
    const params = {
        initialAmount: parseInt(parts[1], 10),
        ticker: parts[2],
        whitelists: parseInt(parts[3], 10),
    };
    return { type, params };
}

// Function to encode "Simple Send" transaction (Type 2)
function encodeSimpleSend(type, params) {
    const payload = [type, params.propertyId, params.amount];
    return payload.join(',');
}

// Function to decode "Simple Send" transaction (Type 2)
function decodeSimpleSend(encodedPayload) {
    const parts = encodedPayload.split(',');
    const type = parseInt(parts[0], 10);
    const params = {
        propertyId: parseInt(parts[1], 10),
        amount: parseInt(parts[2], 10),
    };
    return { type, params };
}

// Encode and decode functions for remaining transaction types (3 to 16).

// Function to encode "Trade Token for UTXO" transaction (Type 3)
function encodeTradeTokenForUTXO(type, params) {
    const payload = [type, params.propertyId, params.amount, params.satsExpected];
    return payload.join(',');
}

// Function to decode "Trade Token for UTXO" transaction (Type 3)
function decodeTradeTokenForUTXO(encodedPayload) {
    const parts = encodedPayload.split(',');
    const type = parseInt(parts[0], 10);
    const params = {
        propertyId: parseInt(parts[1], 10),
        amount: parseInt(parts[2], 10),
        satsExpected: parseInt(parts[3], 10),
    };
    return { type, params };
}

// Function to encode "Commit Token" transaction (Type 4)
function encodeCommitToken(type, params) {
    const payload = [type, params.propertyId, params.amount];
    return payload.join(',');
}

// Function to decode "Commit Token" transaction (Type 4)
function decodeCommitToken(encodedPayload) {
    const parts = encodedPayload.split(',');
    const type = parseInt(parts[0], 10);
    const params = {
        propertyId: parseInt(parts[1], 10),
        amount: parseInt(parts[2], 10),
    };
    return { type, params };
}

// Function to encode "On-chain Token for Token" transaction (Type 5)
function encodeOnChainTokenForToken(type, params) {
    const payload = [type, params.propertyId, params.propertyIdDesired, params.amountOffered, params.amountExpected];
    return payload.join(',');
}

// Function to decode "On-chain Token for Token" transaction (Type 5)
function decodeOnChainTokenForToken(encodedPayload) {
    const parts = encodedPayload.split(',');
    const type = parseInt(parts[0], 10);
    const params = {
        propertyId: parseInt(parts[1], 10),
        propertyIdDesired: parseInt(parts[2], 10),
        amountOffered: parseInt(parts[3], 10),
        amountExpected: parseInt(parts[4], 10),
    };
    return { type, params };
}

// Continue by adding functions for transaction types 6 to 16.

// Function to encode "Create Whitelist" transaction (Type 6)
function encodeCreateWhitelist(type, params) {
    const payload = [type, params.backupAddress];
    return payload.join(',');
}

// Function to decode "Create Whitelist" transaction (Type 6)
function decodeCreateWhitelist(encodedPayload) {
    const parts = encodedPayload.split(',');
    const type = parseInt(parts[0], 10);
    const params = {
        backupAddress: parts[1],
    };
    return { type, params };
}

// Function to encode "Update Whitelist Admin" transaction (Type 7)
function encodeUpdateWhitelistAdmin(type, params) {
    const payload = [type, params.newAddress];
    return payload.join(',');
}

// Function to decode "Update Whitelist Admin" transaction (Type 7)
function decodeUpdateWhitelistAdmin(encodedPayload) {
    const parts = encodedPayload.split(',');
    const type = parseInt(parts[0], 10);
    const params = {
        newAddress: parts[1],
    };
    return { type, params };
}

// Function to encode "Issue Attestation" transaction (Type 8)
function encodeIssueAttestation(type, params) {
    const payload = [type, params.targetAddress];
    return payload.join(',');
}

// Function to decode "Issue Attestation" transaction (Type 8)
function decodeIssueAttestation(encodedPayload) {
    const parts = encodedPayload.split(',');
    const type = parseInt(parts[0], 10);
    const params = {
        targetAddress: parts[1],
    };
    return { type, params };
}

// Function to encode "Revoke Attestation" transaction (Type 9)
function encodeRevokeAttestation(type, params) {
    const payload = [type, params.targetAddress];
    return payload.join(',');
}

// Function to decode "Revoke Attestation" transaction (Type 9)
function decodeRevokeAttestation(encodedPayload) {
    const parts = encodedPayload.split(',');
    const type = parseInt(parts[0], 10);
    const params = {
        targetAddress: parts[1],
    };
    return { type, params };
}

// Function to encode "Create Managed Token" transaction (Type 10)
function encodeCreateManagedToken(type, params) {
    const payload = [
        type,
        params.initialAmount,
        params.ticker,
        params.url,
        params.whitelists.join(','),
        params.backupAddress,
    ];
    return payload.join(',');
}

// Function to decode "Create Managed Token" transaction (Type 10)
function decodeCreateManagedToken(encodedPayload) {
    const parts = encodedPayload.split(',');
    const type = parseInt(parts[0], 10);
    const params = {
        initialAmount: parseInt(parts[1], 10),
        ticker: parts[2],
        url: parts[3],
        whitelists: parts[4].split(',').map(value => parseInt(value, 10)),
        backupAddress: parts[5],
    };
    return { type, params };
}

// Continue by adding functions for transaction types 11 to 16.

// ... Functions for transaction types 11 to 16

// Function to encode "Grant Managed Token" transaction (Type 11)
function encodeGrantManagedToken(type, params) {
    const payload = [type, params.amountGranted, params.addressToGrant];
    return payload.join(',');
}

// Function to decode "Grant Managed Token" transaction (Type 11)
function decodeGrantManagedToken(encodedPayload) {
    const parts = encodedPayload.split(',');
    const type = parseInt(parts[0], 10);
    const params = {
        amountGranted: parseInt(parts[1], 10),
        addressToGrant: parts[2],
    };
    return { type, params };
}

// Function to encode "Redeem Managed Token" transaction (Type 12)
function encodeRedeemManagedToken(type, params) {
    const payload = [type, params.amountDestroyed];
    return payload.join(',');
}

// Function to decode "Redeem Managed Token" transaction (Type 12)
function decodeRedeemManagedToken(encodedPayload) {
    const parts = encodedPayload.split(',');
    const type = parseInt(parts[0], 10);
    const params = {
        amountDestroyed: parseInt(parts[1], 10),
    };
    return { type, params };
}

// Function to encode "Update Managed Token Admin" transaction (Type 13)
function encodeUpdateManagedTokenAdmin(type, params) {
    const payload = [type, params.newAddress];
    return payload.join(',');
}

// Function to decode "Update Managed Token Admin" transaction (Type 13)
function decodeUpdateManagedTokenAdmin(encodedPayload) {
    const parts = encodedPayload.split(',');
    const type = parseInt(parts[0], 10);
    const params = {
        newAddress: parts[1],
    };
    return { type, params };
}

// Function to encode "Create Oracle" transaction (Type 14)
function encodeCreateOracle(type, params) {
    const payload = [
        type,
        params.ticker,
        params.url,
        params.backupAddress,
        params.whitelists.join(','),
        params.lag,
    ];
    return payload.join(',');
}

// Function to decode "Create Oracle" transaction (Type 14)
function decodeCreateOracle(encodedPayload) {
    const parts = encodedPayload.split(',');
    const type = parseInt(parts[0], 10);
    const params = {
        ticker: parts[1],
        url: parts[2],
        backupAddress: parts[3],
        whitelists: parts[4].split(',').map(value => parseInt(value, 10)),
        lag: parseInt(parts[5], 10),
    };
    return { type, params };
}

// Function to encode "Publish Oracle Data" transaction (Type 15)
function encodePublishOracleData(type, params) {
    const payload = [type, params.price];
    if (params.high) payload.push(params.high);
    if (params.low) payload.push(params.low);
    if (params.close) payload.push(params.close);
    return payload.join(',');
}

// Function to decode "Publish Oracle Data" transaction (Type 15)
function decodePublishOracleData(encodedPayload) {
    const parts = encodedPayload.split(',');
    const type = parseInt(parts[0], 10);
    const params = {
        price: parseInt(parts[1], 10),
    };
    if (parts[2]) params.high = parseInt(parts[2], 10);
    if (parts[3]) params.low = parseInt(parts[3], 10);
    if (parts[4]) params.close = parseInt(parts[4], 10);
    return { type, params };
}

// Function to encode "Update Oracle Admin" transaction (Type 16)
function encodeUpdateOracleAdmin(type, params) {
    const payload = [type, params.newAddress];
    return payload.join(',');
}

// Function to decode "Update Oracle Admin" transaction (Type 16)
function decodeUpdateOracleAdmin(encodedPayload) {
    const parts = encodedPayload.split(',');
    const type = parseInt(parts[0], 10);
    const params = {
        newAddress: parts[1],
    };
    return { type, params };
}

module.exports = {
    // Previous functions for transaction types 1 to 5
    encodeSimpleTokenIssue,
    decodeSimpleTokenIssue,
    encodeSimpleSend,
    decodeSimpleSend,
    encodeTradeTokenForUTXO,
    decodeTradeTokenForUTXO,
    encodeCommitToken,
    decodeCommitToken,
    encodeOnChainTokenForToken,
    decodeOnChainTokenForToken,
    encodeCreateWhitelist,
    decodeCreateWhitelist,
    encodeUpdateWhitelistAdmin,
    decodeUpdateWhitelistAdmin,
    encodeIssueAttestation,
    decodeIssueAttestation,
    encodeRevokeAttestation,
    decodeRevokeAttestation,
    encodeCreateManagedToken,
    decodeCreateManagedToken,
    encodeGrantManagedToken,
    decodeGrantManagedToken,
    encodeRedeemManagedToken,
    decodeRedeemManagedToken,
    encodeUpdateManagedTokenAdmin,
    decodeUpdateManagedTokenAdmin,
    encodeCreateOracle,
    decodeCreateOracle,
    encodePublishOracleData,
    decodePublishOracleData,
    encodeUpdateOracleAdmin,
    decodeUpdateOracleAdmin,
    // Continue adding functions for other transaction types (11 to 16).
};