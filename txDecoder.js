// txDecoder.js
const Decode = {
   // Decode Activate TradeLayer Transaction
    decodeActivateTradeLayer: (payload) => {
    
    const txTypePart = Number(payload.slice(1, 2)); // Extracts the second character
    const txType = parseInt(txTypePart, 36);
    if (isNaN(txType)) {
        throw new Error("Invalid txType: not a valid number");
    }

    return { txTypeToActivate: txType };
    },

    // Decode Token Issue Transaction
    decodeTokenIssue: (payload) => {
        const parts = payload.split(',');
        return {
            initialAmount: parseInt(parts[0], 36),
            ticker: parts[1],
            url: parts[2],
            whitelists: parts[3].split(';').map(val => parseInt(val, 36)),
            managed: parts[4] === '1',
            backupAddress: parts[5],
            nft: parts[6] === '1'
        };
    },

    // Decode Send Transaction
    decodeSend: (payload) => {
      //console.log('send payload to decode '+ payload)
        const parts = payload.split(';');
        const sendAll = parts[0] === '1';
        const address = parts[1];

        if (sendAll) {
            return { sendAll, address };
        } else if (parts.length === 4) {
            // Single send
            const propertyId = parseInt(parts[2], 36); // Decode propertyId from base36
            const amount = parseInt(parts[3], 36); // Decode amount from base36
            console.log('decoding single send amount ' +amount + ' '+ parts[3])
            return { sendAll, address, propertyId, amount };
        } else {
            // Multi-send
            const propertyIds = parts[2].split(',').map(id => parseInt(id, 36));
            const amounts = parts[3].split(',').map(amt => parseInt(amt, 36));
            return { sendAll, multiSend: propertyIds.map((id, index) => ({ propertyId: id, amount: amounts[index] })) };
        }
    },


    // Decode Trade Token for UTXO Transaction
    decodeTradeTokenForUTXO: (payload) => {
        const parts = payload.split(',');
        return {
            propertyIdNumber: parseInt(parts[0], 36),
            amount: parseInt(parts[1], 36),
            satsExpected: parseInt(parts[2], 36)
        };
    },

    // Decode Commit Token Transaction
    decodeCommitToken: (payload) => {
        const parts = payload.split(',');
        return {
            propertyIdNumber: parseInt(parts[0], 36),
            amount: parseInt(parts[1], 36),
            committedAddress: parts[2]
        };
    },

    // Decode On-chain Token for Token Transaction
    decodeOnChainTokenForToken: (payload) => {
        const parts = payload.split(',');
        return {
            propertyIdNumber: parseInt(parts[0], 36),
            propertyIdNumberDesired: parseInt(parts[1], 36),
            amountOffered: parseInt(parts[2], 36),
            amountExpected: parseInt(parts[3], 36)
        };
    },

    decodeCancelOrder(encodedTx) {
        const elements = encodedTx.split(',');

        // Decode the elements
        const fromAddress = elements[0];
        const offeredPropertyId = parseInt(elements[1], 36);
        const desiredPropertyId = parseInt(elements[2], 36);
        const cancelAll = elements[3] === '1';
        const price = elements[4] ? parseInt(elements[4], 36) : undefined;
        const cancelParams = {};

        if (elements.length > 5) {
            cancelParams.txid = elements[5];
        }

        return {
            fromAddress,
            offeredPropertyId,
            desiredPropertyId,
            cancelAll,
            price,
            cancelParams
        };
    },

    // Decode Create Whitelist Transaction
    decodeCreateWhitelist: (payload) => {
        const parts = payload.split(',');
        return {
            backupAddress: parts[0],
            whitelistId: parseInt(parts[1], 36)
        };
    },

    // Decode Update Admin Transaction
    decodeUpdateAdmin: (payload) => {
        const parts = payload.split(',');
        return {
            newAddress: parts[0],
            whitelist: parts[1] === '1',
            oracle: parts[2] === '1',
            token: parts[3] === '1',
            id: parseInt(parts[4], 36)
        };
    },

    // Decode Issue Attestation Transaction
    decodeIssueAttestation: (payload) => {
        const parts = payload.split(',');
        return {
            targetAddress: parts[0]
        };
    },

    // Decode Revoke Attestation Transaction
    decodeRevokeAttestation: (payload) => {
        const parts = payload.split(',');
        return {
            targetAddress: parts[0]
        };
    },

    // Decode Grant Managed Token Transaction
    decodeGrantManagedToken: (payload) => {
        const parts = payload.split(',');
        return {
            amountGranted: parseInt(parts[0], 36),
            addressToGrantTo: parts[1]
        };
    },

    // Decode Redeem Managed Token Transaction
    decodeRedeemManagedToken: (payload) => {
        return {
            amountDestroyed: parseInt(payload, 36)
        };
    },

    // Decode Create Oracle Transaction
    decodeCreateOracle: (payload) => {
        const parts = payload.split(',');
        return {
            ticker: parts[0],
            url: parts[1],
            backupAddress: parts[2],
            whitelists: parts[3].split(';').map(val => parseInt(val, 36)),
            lag: parseInt(parts[4], 36)
        };
    },

    // Decode Publish Oracle Data Transaction
    decodePublishOracleData: (payload) => {
        const parts = payload.split(',');
        const data = {
            price: parseInt(parts[0], 36)
        };
        if (parts[1]) {
            data.high = parseInt(parts[1], 36);
        }
        if (parts[2]) {
            data.low = parseInt(parts[2], 36);
        }
        if (parts[3]) {
            data.close = parseInt(parts[3], 36);
        }
        return data;
    },


  // Decode Close Oracle Transaction
  decodeCloseOracle() {
    return {}; // No parameters
  },
  // Decode Create Future Contract Series Transaction
  decodeCreateFutureContractSeries: (payload) => {
        const parts = payload.split(',');
        const onChainDataParts = parts[2].split(';').map(data => data.split(':').map(val => parseInt(val, 36)));
        return {
            native: parts[0] === '1',
            underlyingOracleId: parseInt(parts[1], 36),
            dataIndex: parseInt(parts[1], 36), // Assuming the same part is used for either oracle ID or data index
            onChainData: onChainDataParts,
            notionalPropertyId: parseInt(parts[3], 36),
            notionalValue: parseInt(parts[4], 36),
            collateralPropertyId: parseInt(parts[5], 36),
            expiryPeriod: parts[6] ? parseInt(parts[6], 36) : null,
            series: parts[7] ? parseInt(parts[7], 36) : null,
            inverse: parts[8] === '1',
            fee: parts[9] === '1'
        };
    },

  // Decode Exercise Derivative Transaction
  decodeExerciseDerivative(payload) {
    const [derivativeContractId, amount] = payload.split(',');
    return {
      derivativeContractId: parseInt(derivativeContractId, 36),
      amount: parseInt(amount, 36),
    };
  },

   // Decode Trade Contract On-chain Transaction
  decodeTradeContractOnchain: (payload) => {
    const parts = payload.split(',');
    return {
      contractId: parseInt(parts[0], 36),
      price: parseInt(parts[1], 36),
      amount: parseInt(parts[2], 36),
      side: parts[3] === '1',
      insurance: parts[4] === '1',
    };
  },

  // Decode Trade Contract in Channel Transaction
  decodeTradeContractChannel: (payload) => {
    const parts = payload.split(',');
    return {
      contractId: parseInt(parts[0], 36),
      price: parseInt(parts[1], 36),
      amount: parseInt(parts[2], 36),
      columnAIsSeller: parts[3] === '1',
      expiryBlock: parseInt(parts[4], 36),
      insurance: parts[5] === '1',
    };
  },

  // Decode Trade Tokens in Channel Transaction
  decodeTradeTokensChannel: (payload) => {
    const parts = payload.split(',');
    return {
      propertyid1: parseInt(parts[0], 36),
      propertyid2: parseInt(parts[1], 36),
      amountOffered1: parseInt(parts[2], 36),
      amountDesired2: parseInt(parts[3], 36),
      expiryBlock: parseInt(parts[4], 36),
    };
  },

  // Decode Withdrawal Transaction
  decodeWithdrawal: (payload) => {
    const parts = payload.split(',');
    return {
      propertyIds: parts[0].split(';').map(id => parseInt(id, 36)),
      amounts: parts[1].split(';').map(amount => parseInt(amount, 36)),
      channelAddress: parts[2],
    };
  },

  // Decode Transfer Transaction
  decodeTransfer: (payload) => {
    const parts = payload.split(',');
    return {
      propertyIds: parts[0].split(';').map(id => parseInt(id, 36)),
      amounts: parts[1].split(';').map(amount => parseInt(amount, 36)),
      channelAddress: parts[2],
    };
  },

  // Decode Settle Channel PNL Transaction
  decodeSettleChannelPNL: (payload) => {
    const parts = payload.split(',');
    return {
      txidNeutralized: parts[0],
      contractId: parseInt(parts[1], 36),
      amountCancelled: parseInt(parts[2], 36),
      propertyId: parseInt(parts[3], 36),
      amountSettled: parseInt(parts[4], 36),
      close: parts[5] === '1',
      propertyId2: parts[6] ? parseInt(parts[6], 36) : null,
      amountDelivered: parts[7] ? parseInt(parts[7], 36) : null,
    };
  },

  // Decode Mint Synthetic Transaction
  decodeMintSynthetic: (payload) => {
    const parts = payload.split(',');
    return {
      propertyIdUsed: parseInt(parts[0], 36),
      contractIdUsed: parseInt(parts[1], 36),
      amount: parseInt(parts[2], 36),
    };
  },

  // Decode Redeem Synthetic Transaction
  decodeRedeemSynthetic: (payload) => {
    const parts = payload.split(',');
    return {
      propertyIdUsed: parseInt(parts[0], 36),
      contractIdUsed: parseInt(parts[1], 36),
      amount: parseInt(parts[2], 36),
    };
  },

  // Decode Pay to Tokens Transaction
  decodePayToTokens: (payload) => {
    const parts = payload.split(',');
    return {
      propertyIdTarget: parseInt(parts[0], 36),
      propertyIdUsed: parseInt(parts[1], 36),
      amount: parseInt(parts[2], 36),
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
    decodeCreateDerivativeOfLRC20OrRGB: (payload) => {
        const parts = payload.split(',');
        return {
            lrc20TokenSeriesId1: parseInt(parts[0], 36),
            lrc20TokenSeriesId2: parseInt(parts[1], 36),
            rgb: parts[2] === '1'
        };
    },

    // Decode Register OP_CTV Covenant
    decodeRegisterOPCTVCovenant: (payload) => {
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
    decodeMintColoredCoin: (payload) => {
        const parts = payload.split(',');
        return {
            propertyId: parseInt(parts[0], 36),
            amount: parseInt(parts[1], 36)
        };
    }

}

// ... continue decoding functions for the rest of the transactions ...

module.exports = Decode