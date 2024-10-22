// txDecoder.js
const BigNumber = require('bignumber.js');

const Decode = {
   // Decode Activate TradeLayer Transaction
    decodeActivateTradeLayer(payload) {
        const parts = payload.split(',');
        return {
            txTypeToActivate: parts[0],
            codeHash: parts[1] || '',
            wasmHash: parts[2] || ''
        };
    },

    // Decode Token Issue Transaction
    decodeTokenIssue: (payload) => {
        const parts = payload.split(',');
        return {
            initialAmount: parts[0] ? parseInt(parts[0], 36) : 0,
            ticker: parts[1] || '',
            whitelists: parts[2] ? parts[2].split(';').map(val => parseInt(val, 36)) : [],
            managed: parts[3] === '1',
            backupAddress: parts[4] || '',
            nft: parts[5] === '1'
        };
    },

        // Decode Send Transaction
    decodeSend: (payload) => {
        const parts = payload.split(';');
        const sendAll = parts[0] === '1';
        const address = parts[1] || '';

        if (sendAll) {
            return { sendAll: sendAll, address: address };
        } else if (parts.length === 4) {
            const propertyId = Decode.decodePropertyId(parts[2] || '');
            const amount = parseInt(parts[3] || '0', 36);
            return { sendAll: sendAll, address: address, propertyIds: propertyId, amounts: amount };
        } else {
            const propertyIds = (parts[2] || '').split(',').map(id => Decode.decodePropertyId(id));
            const amounts = (parts[3] || '').split(',').map(amt => parseInt(amt || '0', 36));
            return { sendAll: sendAll, propertyIds: propertyIds.map((id, index) => ({ propertyId: id, amounts: amounts[index] })) };
        }
    },

    // Decode Property ID with error handling
    decodePropertyId(encodedPropertyId) {
        if (encodedPropertyId.startsWith('s')) {
            const trimmedEncodedPropertyId = encodedPropertyId.substring(1);
            let encodedCollateralId, encodedContractId;
            if (trimmedEncodedPropertyId.includes('-')) {
                const parts = trimmedEncodedPropertyId.split('-');
                if (parts.length === 2) {
                    [encodedCollateralId, encodedContractId] = parts;
                } else if (parts.length === 3 && parts[0] === '') {
                    encodedCollateralId = parts[1];
                    encodedContractId = parts[2];
                } else {
                    return `s-NaN-NaN`;
                }
            } else {
                return `s-NaN-NaN`;
            }
            const collateralId = parseInt(encodedCollateralId, 36);
            const contractId = parseInt(encodedContractId, 36);
            if (isNaN(collateralId) || isNaN(contractId)) {
                return `s-NaN-NaN`;
            }
            return `s-${collateralId}-${contractId}`;
        } else {
            const result = parseInt(encodedPropertyId, 36);
            return isNaN(result) ? NaN : result;
        }
    },

    // Decode Trade Token for UTXO Transaction
    decodeTradeTokenForUTXO: (payload) => {
        const parts = payload.split(',');
        return {
            propertyId: Decode.decodePropertyId(parts[0] || ''),
            amount: new BigNumber(parts[1] || '0', 36).div(1e8).decimalPlaces(8, BigNumber.ROUND_DOWN).toNumber(),
            columnA: parts[2] === "1",
            satsExpected: new BigNumber(parts[1] || '0', 36).div(1e8).decimalPlaces(8, BigNumber.ROUND_DOWN).toNumber(),
            tokenOutput: parseInt(parts[4] || '0'),
            payToAddress: parseInt(parts[5] || '0')
        };
    },

    // Decode Commit Token Transaction
    decodeCommitToken: (payload) => {
        const parts = payload.split(',');
        let propertyId = Decode.decodePropertyId(parts[0] || '');
        let amount = new BigNumber(parts[1] || '0', 36).div(1e8).decimalPlaces(8, BigNumber.ROUND_DOWN).toNumber();
        
        // Handle channelAddress or reference
        let channelAddress = '';
        let ref = false;
        if (parts[2].startsWith('ref:')) {
            ref = parts[2].split(':')[1];
        } else {
            channelAddress = parts[2] || '';
        }

        // Decode payEnabled
        let payEnabled = parts[3] === '1';

        // Decode clearLists
        let clearLists = [];
        if (parts[4] && parts[4].startsWith('[') && parts[4].endsWith(']')) {
            clearLists = parts[4].slice(1, -1).split(',').map(num => parseInt(num, 36));
        } else if (parts[4]) {
            clearLists = [parseInt(parts[4], 36)];
        }

        return {
            propertyId,
            amount,
            channelAddress,
            ref,
            payEnabled,
            clearLists
        };
    },


    // Decode On-chain Token for Token Transaction
    decodeOnChainTokenForToken: (payload) => {
        const parts = payload.split(',');
        return {
            propertyIdOffered: Decode.decodePropertyId(parts[0] || ''),
            propertyIdDesired: Decode.decodePropertyId(parts[1] || ''),
            amountOffered: new BigNumber(parts[2] || '0', 36).div(1e8).decimalPlaces(8, BigNumber.ROUND_DOWN).toNumber(),
            amountExpected: new BigNumber(parts[3] || '0', 36).div(1e8).decimalPlaces(8, BigNumber.ROUND_DOWN).toNumber(),
            stop: parts[4] === "1",
            post: parts[5] === "1"
        };
    },
   
    // Decode Cancel Order Transaction with guards
    decodeCancelOrder: (encodedTx) => {
        const elements = encodedTx.split(',');
        let isContract = elements[0];
        const cancelParams = {};
        let offeredPropertyId, desiredPropertyId, cancelAll;

        if (isContract == 1) {
            isContract = true;
            offeredPropertyId = Decode.decodePropertyId(elements[1] || '');
            cancelAll = parseInt(elements[2] || '0', 36);
            if (elements[3] && elements[3].length > 20) {
                cancelParams.txid = elements[3];
            } else {
                cancelParams.price = elements[3] || '0';
                cancelParams.side = elements[4] || '0';
            }
        } else {
            isContract = false;
            offeredPropertyId = Decode.decodePropertyId(elements[1] || '');
            desiredPropertyId = Decode.decodePropertyId(elements[2] || '');
            cancelAll = parseInt(elements[3] || '0', 36);
            if (elements[4] && elements[4].length > 20) {
                cancelParams.txid = elements[4];
            } else {
                const priceDecoded = new BigNumber(elements[3] || '0').dividedBy(8).toNumber();
                cancelParams.price = priceDecoded;
                cancelParams.side = elements[5] || '0';
            }
        }
        return { isContract, offeredPropertyId, desiredPropertyId, cancelAll, cancelParams };
    },

    // Decode Create Whitelist Transaction
    decodeCreateWhitelist: (payload) => {
        const parts = payload.split(',');
        return {
            backupAddress: parts[0] || '',
            name: parts[1] || '',
            url: parts[2] || '',
            description: parts[3] || ''
        };
    },

        // Decode Update Admin Transaction
    decodeUpdateAdmin: (payload) => {
        const parts = payload.split(',');
        return {
            newAddress: parts[0] || '',
            whitelist: parts[1] === '1',
            oracle: parts[2] === '1',
            token: parts[3] === '1',
            id: parseInt(parts[4] || '0', 36),
            updateBackup: parts[5] === '1'
        };
    },

    // Decode Issue Attestation Transaction
    decodeIssueOrRevokeAttestation: (payload) => {
        const parts = payload.split(',');
        return {
            revoke: parts[0] === '1',
            id: parseInt(parts[1] || '0', 36),
            targetAddress: parts[3] || '',
            metaData: parts[4] || ''
        };
    },

    // Decode AMM Pool Transaction
    decodeAMMPool: (payload) => {
        const parts = payload.split(',');
        return {
            isRedeem: parts[0] === '1',
            isContract: parts[1] === '1',
            id: Decode.decodePropertyId(parts[2] || ''),
            amount: parseInt(parts[3] || '0', 36),
            id2: Decode.decodePropertyId(parts[4] || ''),
            amount2: parseInt(parts[5] || '0', 36)
        };
    },

    // Decode Grant Managed Token Transaction
    decodeGrantManagedToken: (payload) => {
        const parts = payload.split(',');
        return {
            propertyId: Decode.decodePropertyId(parts[0] || ''),
            amountGranted: new BigNumber(parts[1] || '0', 36).div(1e8).decimalPlaces(8, BigNumber.ROUND_DOWN).toNumber(),
            addressToGrantTo: parts[2] || ''
        };
    },

    // Decode Redeem Managed Token Transaction
    decodeRedeemManagedToken: (payload) => {
        const parts = payload.split(',');
        return {
            propertyId: Decode.decodePropertyId(parts[0] || ''),
            amountDestroyed: new BigNumber(parts[1] || '0', 36).div(1e8).decimalPlaces(8, BigNumber.ROUND_DOWN).toNumber()
        };
    },

    // Decode Create Oracle Transaction
    decodeCreateOracle: (payload) => {
        const parts = payload.split(',');
        return {
            ticker: parts[0] || '',
            url: parts[1] || '',
            backupAddress: parts[2] || '',
            whitelists: parts[3] ? parts[3].split(';').map(val => parseInt(val, 36)) : [],
            lag: parseInt(parts[4] || '0', 36)
        };
    },

    // Decode Publish Oracle Data Transaction
    decodePublishOracleData: (payload) => {
        const parts = payload.split(',');
        const data = {
            oracleId: parseInt(parts[0] || '0', 36), // Decode oracleId as the first part
            price: parseInt(parts[1] || '0', 36)     // Adjust indices for other parts
        };
        if (parts[2]) {
            data.high = parseInt(parts[2], 36);
        }
        if (parts[3]) {
            data.low = parseInt(parts[3], 36);
        }
        if (parts[4]) {
            data.close = parseInt(parts[4], 36);
        }
        return data;
    },

    // Decode Close Oracle Transaction
    decodeCloseOracle: (payload) => {
        return parseInt(payload || '0', 36); // No parameters
    },

    // Decode Create Future Contract Series Transaction
    decodeCreateFutureContractSeries: (payload) => {
        const parts = payload.split(',');

        // Check if the contract is native or not
        const isNative = parts[0] === '1';

        // Initialize onChainDataParts
        let onChainDataParts = [];

        // Parse onChainData only if the contract is not native
        if (!isNative && parts[2]) {
            onChainDataParts = parts[2].split(';').map(pair => 
                pair.split(':').map(val => val ? parseInt(val, 36) : null)
            );
        }

        console.log('decoding create contract notionalValue '+parts[4])

        return {
            native: isNative,
            underlyingOracleId: parseInt(parts[1] || '0', 36),
            onChainData: onChainDataParts,
            notionalPropertyId: Decode.decodePropertyId(parts[3] || ''),
            notionalValue: parseInt(parts[4] || '0',36), // Assuming notionalValue should be a float
            collateralPropertyId: Decode.decodePropertyId(parts[5] || ''),
            leverage: parseFloat(parts[6] || '0'), // Assuming leverage should be a float
            expiryPeriod: parts[7] ? parseInt(parts[7], 36) : null,
            series: parts[8] ? parseInt(parts[8], 36) : null,
            inverse: parts[9] === '1',
            fee: parts[10] === '1'
        };
    },

    // Decode Exercise Derivative Transaction
    decodeExerciseDerivative: (payload) => {
        const [derivativeContractId, amount] = payload.split(',');
        return {
            derivativeContractId: parseInt(derivativeContractId || '0', 36),
            amount: parseInt(amount || '0', 36)
        };
    },

    // Decode Trade Contract On-chain Transaction
    decodeTradeContractOnchain: (payload) => {
        const parts = payload.split(',');
        return {
            contractId: parseInt(parts[0] || '0', 36),
            price: parseInt(parts[1] || '0', 36),
            amount: parseInt(parts[2] || '0', 36),
            sell: parts[3] === '1',
            insurance: parts[4] === '1',
            reduce: parts[5] === '1',
            post: parts[6] === '1',
            stop: parts[7] === '1'
        };
    },

    // Decode Trade Contract in Channel Transaction
    decodeTradeContractChannel: (payload) => {
        const parts = payload.split(',');
        return {
            contractId: parseInt(parts[0] || '0', 36),
            price: parseInt(parts[1] || '0', 36),
            amount: parseInt(parts[2] || '0', 36),
            columnAIsSeller: parts[3] === '1',
            expiryBlock: parseInt(parts[4] || '0', 36),
            insurance: parts[5] === '1',
        };
    },

    // Decode Trade Tokens in Channel Transaction
    decodeTradeTokensChannel: (payload) => {
        const parts = payload.split(',');
        return {
            propertyIdOffered: Decode.decodePropertyId(parts[0] || ''),
            propertyIdDesired: Decode.decodePropertyId(parts[1] || ''),
            amountOffered: new BigNumber(parts[2] || '0', 36).div(1e8).decimalPlaces(8, BigNumber.ROUND_DOWN).toNumber(),
            amountDesired: new BigNumber(parts[3] || '0', 36).div(1e8).decimalPlaces(8, BigNumber.ROUND_DOWN).toNumber(),
            columnAIsOfferer: parts[4] === '1',
            expiryBlock: parseInt(parts[5] || '0', 36),
        };
    },

    // Decode Withdrawal Transaction
    decodeWithdrawal: (payload) => {
        const parts = payload.split(',');
        return {
            withdrawAll: parts[0] === '1',
            propertyId: Decode.decodePropertyId(parts[1] || ''),
            amount: new BigNumber(parts[2] || '0', 36).div(1e8).decimalPlaces(8, BigNumber.ROUND_DOWN).toNumber(),
            column: parts[3] === '1',
            channelAddress: parts[4] || '',
        };
    },

    // Decode Transfer Transaction
    decodeTransfer: (payload) => {
        const parts = payload.split(',');
        let propertyId = Decode.decodePropertyId(parts[0] || '');
        let amount = new BigNumber(parts[1] || '0', 36).div(1e8).decimalPlaces(8, BigNumber.ROUND_DOWN).toNumber();
        let isColumnA = parts[2] === '1';
        
        // Handle destinationAddr or reference
        let toChannelAddress = '';
        let ref = false;
        if (parts[3].startsWith('ref:')) {
            ref = parts[3].split(':')[1];
        } else {
            toChannelAddress = parts[3] || '';
        }

        // Decode pay and payRef
        let pay = parts[4] === '1';
        let payRef = parts[5] || '';

        return {
            propertyId,
            amount,
            isColumnA,
            toChannelAddress,
            ref,
            pay,
            payRef
        };
    },

    // Decode Settle Channel PNL Transaction
   decodeSettleChannelPNL: (payload) => {
        const parts = payload.split(',');

        return {
            txidNeutralized1: Base256Converter.base256ToHex(parts[0] || ''), // Decode from Base 256 to Hex
            txidNeutralized2: Base256Converter.base256ToHex(parts[1] || ''), // Decode from Base 256 to Hex
            markPrice: parseFloat(Base94Converter.fromBase94(parts[2] || '')), // Decode from Base 94 to decimal

            // Boolean flag for closing trade
            close: parts[3] === '1'
        };
    },

    // Decode Mint Synthetic Transaction
    decodeMintSynthetic: (payload) => {
        const parts = payload.split(',');
        return {
            propertyId: Decode.decodePropertyId(parts[0] || ''),
            contractId: parseInt(parts[1] || '0', 36),
            amount: parseInt(parts[2] || '0', 36),
        };
    },

    // Decode Redeem Synthetic Transaction
    decodeRedeemSynthetic: (payload) => {
        const parts = payload.split(',');
        return {
            propertyId: parseInt(parts[0] || '0', 36),
            contractId: parseInt(parts[1] || '0', 36),
            amount: parseInt(parts[2] || '0', 36),
        };
    },

    // Decode Pay to Tokens Transaction
    decodePayToTokens: (payload) => {
        const parts = payload.split(',');
        return {
            propertyIdTarget: parseInt(parts[0] || '0', 36),
            propertyIdUsed: parseInt(parts[1] || '0', 36),
            amount: new BigNumber(parts[2] || '0', 36).div(1e8).decimalPlaces(8, BigNumber.ROUND_DOWN).toNumber(),
        };
    },


    decodeBatchMoveZkRollup: (payload) =>{
       return { ordinalRevealJSON: payload };
    },

    // Decode Publish New Transaction Type
    decodePublishNewTx: (payload) => {
        return { ordinalRevealJSON: payload };
    },

    // Decode Create Derivative of LRC20 or RGB
    decodeColoredCoin: (payload) => {
        const parts = payload.split(',');
        return {
            propertyId1: parseInt(parts[0], 36),
            lrc20TokenSeriesId2: parseInt(parts[1], 36),
            rgb: parts[2] === '1'
        };
    },

    // Decode Register OP_CTV Covenant
    decodeOPCTVCovenant: (payload) => {
        const parts = payload.split(',');
        return {
            txid: parts[0],
            associatedPropertyId1: parts[1] ? parseInt(parts[1], 36) : null,
            associatedPropertyId2: parts[2] ? parseInt(parts[2], 36) : null,
            covenantType: parseInt(parts[3], 36),
            redeem: parts[4] === '1' // '1' indicates true, anything else is considered false
        };
    },


    // Decode Mint Colored Coin
    decodeCrossLayerBridge: (payload) => {
        const parts = payload.split(',');
        return {
            propertyId: parseInt(parts[0], 36),
            amount: parseInt(parts[1], 36)
        };
    }

}

// ... continue decoding functions for the rest of the transactions ...

module.exports = Decode