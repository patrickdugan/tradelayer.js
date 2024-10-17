// txEncoder.js
const BigNumber = require('bignumber.js');
const base94 = require('./base94.js')
const base256 = require('./base256.js')


const Encode = {
    // Encode Simple Token Issue Transaction
      encodeActivateTradeLayer(params) {
        // Assuming params has the codeHash and other fields
        const payload =  {
            txTypeToActivate: params.txTypeToActivate,
            codeHash: params.codeHash,
            wasmHash: params.wasmHash
        };
        return payload.join(',')
    },

    // Encode Token Issue Transaction
    encodeTokenIssue(params) {
        const payload = [
            params.initialAmount.toString(36),
            params.ticker,
            params.whitelists.map(val => val.toString(36)).join(','),
            params.managed ? '1' : '0',
            params.backupAddress,
            params.nft ? '1' : '0'
        ];
        return payload.join(',');
    },

    // Encode Send Transaction
    encodeSend(params) {
        if (params.sendAll) {
            return `1;${params.address}`;
        } else if (Array.isArray(params.propertyId) && Array.isArray(params.amount)) {
            const payload = [
                '0', // Not sendAll
                '', // Address is omitted for multi-send
                params.propertyId.map(id => Encode.encodePropertyId(id)).join(','),
                params.amount.map(amt => amt.toString(36)).join(',')
            ];
            return payload.join(';');
        } else {
            const encodedPropertyId = this.encodePropertyId(params.propertyId);

            const payload = [
                '0', // Not sendAll
                params.address,
                encodedPropertyId,
                params.amount.toString(36)
            ];
            return payload.join(';');
        }
    },

    encodePropertyId(propertyId) {
        if (typeof propertyId === 'string' && propertyId.startsWith('s-')) {
            const [_, collateralId, contractId] = propertyId.split('-');
            const encodedCollateralId = parseInt(collateralId).toString(36);
            const encodedContractId = parseInt(contractId).toString(36);
            return `s-${encodedCollateralId}-${encodedContractId}`;
        } else {
            return propertyId.toString(36);
        }
    },


    encodeTradeTokenForUTXO: (params) => {
        const amount = new BigNumber(params.amountOffered).times(1e8).toNumber();
            const payload = [
            params.propertyId.toString(36),
            params.amount.toString(36),
            params.columnA,
            params.satsExpected.toString(36),
            params.tokenOutput,
            params.payToAddress
        ];
        return payload.join(',');
    },

    // Encode Commit Token Transaction
    encodeCommit: (params) => {
        const amount = new BigNumber(params.amount).times(1e8).toString(36);
        const channelAddress = params.channelAddress.length > 42 ? `ref:${params.ref || 0}` : params.channelAddress; // Handle long multisig addresses
        const payEnabled = params.payEnabled ? '1' : '0'; // Encode true as '1' and false as '0'
        let clearLists = '';
        if (params.clearLists) {
            if (Array.isArray(params.clearLists)) {
                clearLists = `[${params.clearLists.map(num => num.toString(36)).join(',')}]`; // Array of integers in base 36
            } else {
                clearLists = params.clearLists.toString(36); // Single integer in base 36
            }
        }

         const payload = [
            params.propertyId.toString(36),
            amount,
            channelAddress,
            payEnabled,
            clearLists
        ];
        return payload.join(',');
    },

    // Encode On-chain Token for Token Transaction
    encodeOnChainTokenForToken: (params) => {
        console.log('encoding token trade ' + JSON.stringify(params));
        const amountOffered = new BigNumber(params.amountOffered).times(1e8).toNumber(); // Multiply by 100 million
        const amountExpected = new BigNumber(params.amountExpected).times(1e8).toNumber(); // Multiply by 100 million
        const payload = [
            params.propertyIdOffered.toString(36),
            params.propertyIdDesired.toString(36),
            amountOffered.toString(36),
            amountExpected.toString(36),
            params.stop ? '1' : '0',
            params.post ? '1' : '0'
        ];
        return payload.join(',');
    },

   
    // Encode function
    encodeCancelOrder: (params) => {
        let encodedTx = params.isContract;

        if (params.isContract) {
            // Encode contract cancellation with a single property ID
            encodedTx += `,${params.contractId.toString(36)},${params.cancelAll ? 1 : 0}`;
        } else {
            // Encode token cancellation with two property IDs
            encodedTx += `,${params.offeredPropertyId.toString(36)},${params.desiredPropertyId.toString(36)},${params.cancelAll ? 1 : 0}`;
        }

        let priceEncoded
        // Encode optional price if provided
        if (params.cancelParams && params.cancelParams.price !== undefined) {
            if(params.isContract==0||params.isContract==false){
                priceEncoded = new BigNumber(params.cancelParams.price).times(8).toString(36); // Encode and multiply by 8
            }else if(params.isContract==1||params.isContract==true){
               priceEncoded = params.cancelParams.price.toString(36);
            }

            encodedTx += `,${priceEncoded}`;
            encodedTx += `,${params.cancelParams.side.toString(36)}`;
        }

        // Encode cancel parameters
        if (params.cancelParams && params.cancelParams.txid) {
            encodedTx += `,${params.cancelParams.txid}`;
        }

        return encodedTx;
    },

    // Encode Create Whitelist Transaction
    encodeCreateWhitelist: (params) => {
        const payload = [
            params.backupAddress,
            params.name,
            params.url,
            params.description
        ];
        return payload.join(',');
    },

    // Encode Update Whitelist Admin Transaction
    encodeUpdateAdmin: (params) => {
        const payload = [
            params.newAddress,
            params.whitelist ? '1' : '0',
            params.oracle ? '1' : '0',
            params.token ? '1' : '0',
            params.id.toString(36),
            params.updateBackup ? '1':'0'
        ];
        return payload.join(',');
    },


    // Encode Issue Attestation Transaction
    encodeIssueOrRevokeAttestation: (params) => {
        const payload = [
            params.revoke,
            params.id,
            params.targetAddress,
            params.metaData
        ];
        return payload.join(',');
    },

    // Encode Revoke Attestation Transaction
    encodeAMMPool: (params) => {
        const payload = [
            params.isRedeem, 
            params.isContract, 
            params.id, 
            params.amount, 
            params.id2, 
            params.amount2,
        ];
        return payload.join(',');
    },

    // ... Continue with the rest of the transaction types ...

    // Example for Encode Create Oracle Transaction
    encodeCreateOracle: (params) => {
        const payload = [
            params.ticker,
            params.url,
            params.backupAddress,
            params.whitelists.map(whitelist => whitelist.toString(36)).join(','),
            params.lag.toString(36),
        ];
        return payload.join(',');
    },

    // Encode Grant Managed Token Transaction
    encodeGrantManagedToken:(params) => {
      const amountGranted = new BigNumber(params.amountGranted).times(1e8).toNumber();
      const payload = [
        params.propertyid.toString(36),
        amountGranted.toString(36),
        params.addressToGrantTo,
      ];
      return payload.join(',');
    },

    // Encode Redeem Managed Token Transaction
    encodeRedeemManagedToken:(params) => {
      const amountGranted = new BigNumber(params.amountGranted).times(1e8).toNumber();
      const payload = [
        params.propertyid.toString(36),
        amountGranted.toString(36),
        params.addressToGrantTo,
      ];
      return payload.join(',');
    },

    // Encode Publish Oracle Data Transaction
    encodePublishOracleData:(params) => {
      const payload = [
        params.oracleid.toString(36),
        params.price.toString(36),
      ];
      if (params.high !== undefined) {
        payload.push(params.high.toString(36));
      }
      if (params.low !== undefined) {
        payload.push(params.low.toString(36));
      }
      if (params.close !== undefined) {
        payload.push(params.close.toString(36));
      }
      return payload.join(',');
    },

    // Encode Update Oracle Admin Transaction
    encodeUpdateOracleAdmin:(params) => {
      return params.newAddress;
    },

    // Encode Close Oracle Transaction
    encodeCloseOracle(id) {
      return id.toString(36); // No parameters
    },

     // Encode Create Future Contract Series Transaction
    encodeCreateFutureContractSeries: (params) => {
    
        const onChainData = params.onChainData && params.onChainData.length > 0 ? 
            params.onChainData.map(data => `${data[0][0].toString(36)}:${data[0][1].toString(36)}`).join(';')
            : ''

        console.log('params.notionalValue '+params.notionalValue)
        const payload = [
            params.native ? '1' : '0',
            params.underlyingOracleId.toString(36),
            onChainData, // Use '' if empty or falsy; adjust as needed
            params.notionalPropertyId.toString(36), 
            params.notionalValue.toString(36),
            params.collateralPropertyId.toString(36),
            params.leverage,
            params.expiryPeriod !== undefined ? params.expiryPeriod.toString(36) : '0',
            params.series.toString(36),
            params.inverse ? '1' : '0',
            params.fee !== undefined ? params.fee ? '1' : '0' : '0'
        ];
        return payload.join(',');
    },

    // Encode Exercise Derivative Transaction
    encodeExerciseDerivative:(params) => {
      const payload = [
        params.derivativeContractId.toString(36),
        params.amount.toString(36),
      ];
      return payload.join(',');
    },

    // Encode Trade Contract On-chain Transaction
    encodeTradeContractOnchain: (params) => {
        const payload = [
            params.contractId.toString(36),
            params.price.toString(36),
            params.amount.toString(36),
            params.sell ? '1' : '0',
            params.insurance ? '1' : '0',
            params.reduce ? '1':'0',
            params.post ? '1':'0',
            params.stop ? '1':'0'
        ];
        return payload.join(',');
    },

    // Encode Trade Contract in Channel Transaction
    encodeTradeContractChannel: (params) => {
        const payload = [
            params.contractId.toString(36),
            params.price.toString(36),
            params.amount.toString(36),
            params.columnAIsSeller ? '1' : '0',
            params.expiryBlock.toString(36),
            params.insurance ? '1' : '0',
        ];
        return payload.join(',');
    },

    // Encode Trade Tokens in Channel Transaction
    encodeTradeTokensChannel: (params) => {
        const amountOffered = new BigNumber(params.amountOffered1).times(1e8).toNumber();
        const amountDesired = new BigNumber(params.amountDesired2).times(1e8).toNumber();
        const payload = [
            params.propertyId1.toString(36),
            params.propertyId2.toString(36),
            amountOffered.toString(36),
            amountDesired.toString(36),
            params.columnAIsOfferer ? '1':'0',
            params.expiryBlock.toString(36),
        ];
        return payload.join(',');
    },

    // Encode Withdrawal Transaction
    encodeWithdrawal: (params) => {
        const amounts = new BigNumber(params.amountOffered).times(1e8).toNumber().toString();
        const withdrawAll = params.withdrawAll
        const propertyIds = params.propertyId.toString(36)/*.map(id => id.toString(36)).join(';')*/;
        const column = params.column //0 is A, 1 is B
        return [withdrawAll, propertyIds, amounts, column, params.channelAddress].join(',');
    },

    // Encode Transfer Transaction 
    encodeTransfer: (params) => {
        const propertyId = params.propertyId.toString(36);
        const amounts = new BigNumber(params.amount).times(1e8).toString(36);
        const isColumnA = params.isColumnA ? 1 : 0;
        const pay = params.pay ? 1 : 0
        const payRef = params.payRef || ''
        const destinationAddr = params.destinationAddr.length > 42 ? `ref:${params.ref || 0}` : params.destinationAddr; // Handle long multisig addresses
        return [propertyId, amounts, isColumnA, destinationAddr, pay, payRef,].join(',');
    },

    // Encode Settle Channel PNL Transaction
    encodeSettleChannelPNL: (params) => {
        const base256Encoded1 = Base256Converter.hexToBase256(params.tradeid)
        const base256Encoded2 = Base256Converter.hexToBase256(params.settleid);
        const base94Encoded = Base94Converter.decimalToBase94(params.markPrice)
        const payload = [
            base256Encoded1,
            base256Encoded2,
            base94Encoded,
            params.close ? '1' : '0'
        ];
        return payload.join(',');
    },

    // Encode Mint Synthetic Transaction
    encodeMintSynthetic: (params) => {
        const payload = [
            params.propertyIdUsed.toString(36),
            params.contractIdUsed.toString(36),
            params.amount.toString(36),
        ];
        return payload.join(',');
    },

    // Encode Redeem Synthetic Transaction
    encodeRedeemSynthetic: (params) => {
        const payload = [
            params.propertyIdUsed.toString(36),
            params.contractIdUsed.toString(36),
            params.amount.toString(36),
        ];
        return payload.join(',');
    },

    // Encode Pay to Tokens Transaction
    encodePayToTokens: (params) => {
        const payload = [
            params.propertyIdTarget.toString(36),
            params.propertyIdUsed.toString(36),
            params.amount.toString(36),
        ];
        return payload.join(',');
    },

    // Encode Create Option Chain Transaction
    encodeCreateOptionChain: (params) => {
        const payload = [
            params.contractSeriesId.toString(36),
            params.strikePercentInterval.toString(36),
            params.europeanStyle ? '1' : '0',
        ];
        return payload.join(',');
    },

    // Encode Trade Bai Urbun Transaction
    encodeTradeBaiUrbun: (params) => {
        const payload = [
            params.propertyIdDownPayment.toString(36),
            params.propertyIdToBeSold.toString(36),
            params.price.toString(36),
            params.amount.toString(36),
            params.expiryBlock.toString(36),
            params.tradeExpiryBlock.toString(36),
        ];
        return payload.join(',');
    },

    // Encode Trade Murabaha Transaction
    encodeTradeMurabaha: (params) => {
        const payload = [
            params.propertyIdDownPayment.toString(36),
            params.downPaymentPercent.toString(36),
            params.propertyIdToBeSold.toString(36),
            params.price.toString(36),
            params.amount.toString(36),
            params.expiryBlock.toString(36),
            params.installmentInterval.toString(36),
            params.tradeExpiryBlock.toString(36),
        ];
        return payload.join(',');
    },

    // Encode Issue Invoice Transaction
    encodeIssueInvoice: (params) => {
        const payload = [
            params.propertyIdToReceivePayment.toString(36),
            params.amount.toString(36),
            params.dueDateBlock.toString(36),
            params.optionalPropertyIdCollateral ? params.optionalPropertyIdCollateral.toString(36) : '0',
            params.receivesPayToToken ? '1' : '0',
        ];
        return payload.join(',');
    },

    // Encode Batch Move Zk Rollup Transaction
    encodeBatchMoveZkRollup: (params) => {
        // Assuming params.payments is an array of payment objects
        const paymentsPayload = params.payments.map(payment => {
            const paymentDetails = [
                payment.fromAddress,
                payment.propertyIds.map(id => id.toString(36)).join(':'),
                payment.amounts.map(amt => amt.toString(36)).join(':'),
                payment.toAddress,
                payment.sentPropertyIds.map(id => id.toString(36)).join(':'),
                payment.sentAmounts.map(amt => amt.toString(36)).join(':'),
            ];
            return paymentDetails.join(',');
        }).join(';');
        const payload = [
            params.proof,
            paymentsPayload,
            JSON.stringify(params.miscLogic),
            JSON.stringify(params.miscData),
        ];
        return payload.join('|');
    },

    // Encode Publish New Transaction Type
    encodePublishNewTx: (params) => {
        return params.ordinalRevealJSON; // Assuming this is a JSON string
    },

    // Encode Create Derivative of LRC20 or RGB
    encodeColoredCoin: (params) => {
        const payload = [
            params.lrc20TokenSeriesId1.toString(36),
            params.lrc20TokenSeriesId2.toString(36),
            params.rgb ? '1' : '0',
        ];
        return payload.join(',');
    },

    // Encode Register OP_CTV Covenant
    encodeRegisterOPCTVCovenant: (params) => {
        const payload = [
            params.redeem,
            params.txid,
            params.associatedPropertyId1 ? params.associatedPropertyId1.toString(36) : '0',
            params.associatedPropertyId2 ? params.associatedPropertyId2.toString(36) : '0',
            params.covenantType.toString(36),
        ];
        return payload.join(',');
    },

    // Encode cross TL chain bridging tx
    encodeCrossLayerBridge: (params) => {
        const payload = [
            params.propertyId.toString(36),
            params.amount.toString(36),
            params.destinationAddr
        ];
        return payload.join(',');
    }

}

module.exports = Encode;