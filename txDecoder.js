// txDecoder.js
const Decode = {
   // Decode Activate TradeLayer Transaction
    decodeActivateTradeLayer: (payload) => {
    return { txTypeToActivate: payload };
    },

    // Decode Token Issue Transaction
    decodeTokenIssue: (payload) => {
        const parts = payload.split(',');
        return {
            initialAmount: parseInt(parts[0], 36),
            ticker: parts[1],
            whitelists: parts[2].split(';').map(val => parseInt(val, 36)),
            managed: parts[3] === '1',
            backupAddress: parts[4],
            nft: parts[5] === '1'
        };
    },

    // Decode Send Transaction
    decodeSend: (payload) => {
      //console.log('send payload to decode '+ payload)
        const parts = payload.split(';');
        const sendAll = parts[0] === '1';
        const address = parts[1];

        if (sendAll) {
            return { sendAll:sendAll, address:address };
        } else if (parts.length === 4) {
            // Single send
            const propertyId = parseInt(parts[2], 36); // Decode propertyId from base36
            const amount = parseInt(parts[3], 36); // Decode amount from base36
            console.log('decoding single send amount ' +amount + ' '+ parts[3])
            return { sendAll: sendAll, address:address, propertyIds:propertyId, amounts:amount };
        } else {
            // Multi-send
            const propertyIds = parts[2].split(',').map(id => parseInt(id, 36));
            const amounts = parts[3].split(',').map(amt => parseInt(amt, 36));
            return { sendAll:sendAll, propertyIds: propertyIds.map((id, index) => ({ propertyId: id, amounts: amounts[index] })) };
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
            propertyIdOffered: parseInt(parts[0], 36),
            propertyIdDesired: parseInt(parts[1], 36),
            amountOffered: parseInt(parts[2], 36),
            amountExpected: parseInt(parts[3], 36)
        };
    },

    decodeCancelOrder(encodedTx) {
      const elements = encodedTx.split(',');

      // Decode the elements
      const fromAddress = elements[0];
      const isContract = elements.length === 4; // If there are 4 elements, it's a contract cancellation
      const offeredPropertyId = parseInt(elements[1], 36);
      const desiredPropertyId = isContract ? null : parseInt(elements[2], 36);
      const cancelAll = elements[elements.length - 1] === '1';
      const price = elements[3] ? parseInt(elements[3], 36) : undefined;
      const cancelParams = {};

      if (elements.length > 4) {
          cancelParams.txid = elements[4];
      }

      return {
          fromAddress,
          isContract,
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
            oracleId: parseInt(parts[0], 36), // Decode oracleId as the first part
            price: parseInt(parts[1], 36)     // Adjust indices for other parts
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
    decodeCloseOracle() {
      return {}; // No parameters
    },

    decodeCreateFutureContractSeries: (payload) => {
        const parts = payload.split(',');

        // Check if the contract is native or not
        const isNative = parts[0] === '1';

        // Initialize onChainDataParts
        let onChainDataParts = [];

        // Parse onChainData only if the contract is not native
        if (!isNative) {
            onChainDataParts = parts[2].split(';').map(pair => 
                pair.split(':').map(val => val ? parseInt(val, 36) : null)
            );
        }

        return {
            native: isNative,
            underlyingOracleId: parseInt(parts[1], 36),
            onChainData: onChainDataParts,
            notionalPropertyId: parseInt(parts[3], 36),
            notionalValue: parseFloat(parts[4]), // Assuming notionalValue should be a float
            collateralPropertyId: parseInt(parts[5], 36),
            leverage: parseFloat(parts[6]), // Assuming leverage should be a float
            expiryPeriod: parts[7] ? parseInt(parts[7], 36) : null,
            series: parts[8] ? parseInt(parts[8], 36) : null,
            inverse: parts[9] === '1',
            fee: parts[10] === '1'
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