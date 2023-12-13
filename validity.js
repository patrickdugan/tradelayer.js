const TxUtils = require('./txUtils.js')
const db = require('./db')
const Activation = require('./activation.js')

const Validity = {
    // 0: Activate TradeLayer
    validateActivateTradeLayer: async (txId, params, sender) => {
        // Initialize with no reason and valid as false
        params.reason = '';
        params.valid = false;

        // Check if the sender is the admin address
        if (sender !== "tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8") {
            params.reason = 'Not sent from admin address';
            return params;
        }

        // Check if the txTypeToActivate is already activated
        const activationInstance = Activation.getInstance();
        const isAlreadyActivated = await activationInstance.checkIfActivated(params.txTypeToActivate);
        if (isAlreadyActivated) {
            params.valid = false;
            params.reason = 'Transaction type already activated';
            return params;
        }

        // If all checks pass, set the transaction as valid
        params.valid = true;
        return params;
    },
  
     // 1: Token Issue
    validateTokenIssue: (params) => {
        params.reason = '';
        params.valid=true

        if (!(Number.isInteger(params.initialAmount) && params.initialAmount > 0)) {
            params.valid=false
            params.reason += 'Invalid initial amount; ';
        }

        if (!(typeof params.ticker === 'string' && params.ticker.length <= 6)) {
            params.valid=false
            params.reason += 'Invalid ticker; ';
        }

        if (params.type === 'native' && params.propertyId !== 1) {
            params.valid=false
            params.reason += 'Invalid property ID for native type; ';
        }

        if (params.type === 'vesting' && params.propertyId !== 2) {
            params.valid=false
            params.reason += 'Invalid property ID for vesting type; ';
        }

        return params.valid
    },
    // 2: Send
    validateSend: async (params, tallyMap, whitelistRegistry, kycRegistry) => {
        params.reason = '';
        params.valid= true
        const senderTally = await tallyMap.getTally(params.senderAddress, params.propertyId);
        if (!senderTally || senderTally.available < params.amount) {
            params.valid=false
            params.reason += 'Insufficient available balance; ';
        }

        const isSenderWhitelisted = await whitelistRegistry.isAddressWhitelisted(params.senderAddress, params.propertyId);
        if (!isSenderWhitelisted) {
            params.valid=false
            params.reason += 'Sender address not whitelisted; ';
        }

        const isRecipientWhistelisted = await whitelistRegistry.isAddressWhitelisted(params.recipientAddress);
        if (!senderKYCCleared) {
            params.valid=false
            params.reason += 'Sender address KYC not cleared; ';
        }

        params.valid = senderTally && senderTally.available >= params.amount && isSenderWhitelisted && senderKYCCleared;
    },

        // 3: Trade Token for UTXO
    validateTradeTokenForUTXO: (params, tallyMap) => {
        params.reason = '';
        params.valid = true;

        if (!Number.isInteger(params.propertyIdNumber)) {
            params.valid = false;
            params.reason += 'Invalid property ID; ';
        }
        if (!(Number.isInteger(params.amount) && params.amount > 0)) {
            params.valid = false;
            params.reason += 'Invalid amount; ';
        }
        if (!(Number.isInteger(params.satsExpected) && params.satsExpected >= 0)) {
            params.valid = false;
            params.reason += 'Invalid sats expected; ';
        }

        return params;
    },

    // 4: Commit Token
    validateCommitToken: async (params, tallyMap, whitelistRegistry, kycRegistry) => {
        params.reason = '';
        params.valid = true;

        const hasSufficientTokens = await tallyMap.hasSufficientBalance(params.senderAddress, params.propertyId, params.amount);
        if (!hasSufficientTokens) {
            params.valid = false;
            params.reason += 'Insufficient tokens to commit; ';
        }

        const isSenderWhitelisted = await whitelistRegistry.isAddressWhitelisted(params.senderAddress, params.propertyId);
        if (!isSenderWhitelisted) {
            params.valid = false;
            params.reason += 'Sender address not whitelisted; ';
        }

        const senderKYCCleared = await kycRegistry.isAddressKYCCleared(params.senderAddress);
        if (!senderKYCCleared) {
            params.valid = false;
            params.reason += 'Sender KYC not cleared; ';
        }

        return params;
    },

    // 5: On-chain Token for Token
    validateOnChainTokenForToken: async (params, tallyMap, whitelistRegistry) => {
        params.reason = '';
        params.valid = true;

        const hasSufficientBalance = await tallyMap.hasSufficientBalance(params.senderAddress, params.offeredPropertyId, params.amountOffered);
        if (!hasSufficientBalance) {
            params.valid = false;
            params.reason += 'Insufficient balance for offered token; ';
        }

        const isSenderWhitelisted = await whitelistRegistry.isAddressWhitelisted(params.senderAddress, params.offeredPropertyId);
        if (!isSenderWhitelisted) {
            params.valid = false;
            params.reason += 'Sender not whitelisted for offered property; ';
        }

        const isRecipientWhitelisted = await whitelistRegistry.isAddressWhitelisted(params.recipientAddress, params.desiredPropertyId);
        if (!isRecipientWhitelisted) {
            params.valid = false;
            params.reason += 'Recipient not whitelisted for desired property; ';
        }

        return params;
    },

    // 6: Cancel Order
    validateCancelOrder: (params, orderBook) => {
        params.reason = '';
        params.valid = true;

        if (!(typeof params.fromAddress === 'string')) {
            params.valid = false;
            params.reason += 'Invalid from address; ';
        }
        if (params.offeredPropertyId && !Number.isInteger(params.offeredPropertyId)) {
            params.valid = false;
            params.reason += 'Invalid offered property ID; ';
        }
        if (params.desiredPropertyId && !Number.isInteger(params.desiredPropertyId)) {
            params.valid = false;
            params.reason += 'Invalid desired property ID; ';
        }
        if (!(typeof params.cancelParams === 'object')) {
            params.valid = false;
            params.reason += 'Invalid cancel parameters; ';
        }

        return params;
    },

    // 7: Create Whitelist
    validateCreateWhitelist: (params) => {
        params.reason = '';
        params.valid = true;

        if (!(params.backupAddress && typeof params.backupAddress === 'string')) {
            params.valid = false;
            params.reason += 'Invalid backup address; ';
        }
        if (!(typeof params.name === 'string')) {
            params.valid = false;
            params.reason += 'Invalid name; ';
        }

        return params;
    },

    // 8: Update Admin
    validateUpdateAdmin: (params, registry) => {
        params.reason = '';
        params.valid = true;

        if (!(typeof params.newAddress === 'string')) {
            params.valid = false;
            params.reason += 'Invalid new address; ';
        }

        // Additional logic can be added here if needed

        return params;
    },

    // 9: Issue Attestation
    validateIssueAttestation: (params, whitelistRegistry) => {
        params.reason = '';
        params.valid = true;

        if (!(typeof params.targetAddress === 'string')) {
            params.valid = false;
            params.reason += 'Invalid target address; ';
        }

        // Additional logic can be added here if needed

        return params;
    },

    // 10: Revoke Attestation
    validateRevokeAttestation: (params, whitelistRegistry) => {
        params.reason = '';
        params.valid = true;

        if (!(typeof params.targetAddress === 'string')) {
            params.valid = false;
            params.reason += 'Invalid target address; ';
        }

        // Additional logic can be added here if needed

        return params;
            },
        // 11: Grant Managed Token
        validateGrantManagedToken: (params, propertyRegistry, tallyMap) => {
            params.reason = '';
            params.valid = true;

            const isPropertyAdmin = propertyRegistry.isAdmin(params.senderAddress, params.propertyId);
            if (!isPropertyAdmin) {
                params.valid = false;
                params.reason += 'Sender is not admin of the property; ';
            }

            const isManagedProperty = propertyRegistry.isManagedProperty(params.propertyId);
            if (!isManagedProperty) {
                params.valid = false;
                params.reason += 'Property is not of managed type; ';
            }

            const hasSufficientBalance = tallyMap.hasSufficientBalance(params.senderAddress, params.propertyId, params.amount);
            if (!hasSufficientBalance) {
                params.valid = false;
                params.reason += 'Insufficient balance to grant tokens; ';
            }

            return params;
        },

        // 12: Redeem Managed Token
        validateRedeemManagedToken: (params, propertyRegistry, tallyMap) => {
            params.reason = '';
            params.valid = true;

            const isPropertyAdmin = propertyRegistry.isAdmin(params.senderAddress, params.propertyId);
            if (!isPropertyAdmin) {
                params.valid = false;
                params.reason += 'Sender is not admin of the property; ';
            }

            const isManagedProperty = propertyRegistry.isManagedProperty(params.propertyId);
            if (!isManagedProperty) {
                params.valid = false;
                params.reason += 'Property is not of managed type; ';
            }

            const canRedeemTokens = tallyMap.canRedeemTokens(params.senderAddress, params.propertyId, params.amount);
            if (!canRedeemTokens) {
                params.valid = false;
                params.reason += 'Cannot redeem tokens; insufficient balance or other criteria not met; ';
            }

            return params;
        },

        // 13: Create Oracle
        validateCreateOracle: (params, oracleRegistry) => {
            params.reason = '';
            params.valid = oracleRegistry.canCreateOracle(params.senderAddress);
            if (!params.valid) {
                params.reason = 'Sender address not authorized to create an oracle; ';
            }

            return params;
        },

        // 14: Publish Oracle Data
        validatePublishOracleData: (params, oracleRegistry) => {
            params.reason = '';
            params.valid = oracleRegistry.isAdmin(params.senderAddress, params.oracleId);
            if (!params.valid) {
                params.reason = 'Sender is not admin of the specified oracle; ';
            }

            return params;
        },

        // 15: Close Oracle
        validateCloseOracle: (params, oracleRegistry) => {
            params.reason = '';
            params.valid = oracleRegistry.isAdmin(params.senderAddress, params.oracleId);
            if (!params.valid) {
                params.reason = 'Sender is not admin of the specified oracle; ';
            }

            return params;
        },

        // 16: Exercise Derivative
        validateExerciseDerivative: (params, derivativeRegistry, marginMap) => {
            params.reason = '';
            params.valid = true;

            const isValidDerivative = derivativeRegistry.isValidDerivative(params.contractId);
            if (!isValidDerivative) {
                params.valid = false;
                params.reason += 'Invalid derivative contract; ';
            }

            const canExercise = marginMap.canExercise(params.senderAddress, params.contractId, params.amount);
            if (!canExercise) {
                params.valid = false;
                params.reason += 'Cannot exercise derivative; insufficient contracts or margin; ';
            }

            return params;
        },

        // 17: Trade Contract On-chain
        validateTradeContractOnchain: async (params, marginMap, whitelistRegistry, contractRegistry) => {
            params.reason = '';
            params.valid = true;

            const hasSufficientMargin = marginMap.hasSufficientMargin(params.senderAddress, params.contractId, params.amount);
            if (!hasSufficientMargin) {
                params.valid = false;
                params.reason += 'Insufficient margin or contract balance; ';
            }

            const contractDetails = await contractRegistry.getContractDetails(params.contractId);
            const isSenderWhitelisted = contractDetails.type === 'oracle' ? await whitelistRegistry.isAddressWhitelisted(params.senderAddress, contractDetails.oracleId) : true;
            if (!isSenderWhitelisted) {
                params.valid = false;
                params.reason += 'Sender address not whitelisted for the contract\'s oracle; ';
            }

            return params;
        },

        // 18: Trade Contract Channel
        validateTradeContractChannel: async (params, channelRegistry, whitelistRegistry, contractRegistry) => {
            params.reason = '';
            params.valid = true;

            const { commitAddressA, commitAddressB } = channelRegistry.getCommitAddresses(params.channelAddress);
            const contractDetails = await contractRegistry.getContractDetails(params.contractId);

            const isAddressAWhitelisted = contractDetails.type === 'oracle' ? await whitelistRegistry.isAddressWhitelisted(commitAddressA, contractDetails.oracleId) : true;
            if (!isAddressAWhitelisted) {
                params.valid = false;
                params.reason += 'Commit address A not whitelisted; ';
            }

            const isAddressBWhitelisted = contractDetails.type === 'oracle' ? await whitelistRegistry.isAddressWhitelisted(commitAddressB, contractDetails.oracleId) : true;
            if (!isAddressBWhitelisted) {
                params.valid = false;
                params.reason += 'Commit address B not whitelisted; ';
            }

            return params;
        },

        // 19: Trade Tokens Channel
        validateTradeTokensChannel: async (params, channelRegistry, whitelistRegistry) => {
            params.reason = '';
            params.valid = true;

            const { commitAddressA, commitAddressB } = channelRegistry.getCommitAddresses(params.channelAddress);
            const isAddressAWhitelisted = await whitelistRegistry.isAddressWhitelisted(commitAddressA, params.propertyId1);
            if (!isAddressAWhitelisted) {
                params.valid = false;
                params.reason += 'Commit address A not whitelisted for property ID 1; ';
            }

            const isAddressBWhitelisted = await whitelistRegistry.isAddressWhitelisted(commitAddressB, params.propertyId2);
            if (!isAddressBWhitelisted) {
                params.valid = false;
                params.reason += 'Commit address B not whitelisted for property ID 2; ';
            }

            return params;
        },

        // 20: Withdrawal
        validateWithdrawal: (params, channelRegistry, tallyMap) => {
            params.reason = '';
            params.valid = true;

            const isValidChannel = channelRegistry.isValidChannel(params.channelAddress);
            if (!isValidChannel) {
                params.valid = false;
                params.reason += 'Invalid channel; ';
            }

            const isAuthorizedSender = channelRegistry.isAuthorizedSender(params.channelAddress, params.senderAddress);
            if (!isAuthorizedSender) {
                params.valid = false;
                params.reason += 'Sender not authorized for the channel; ';
            }

            const hasSufficientFunds = tallyMap.hasSufficientBalance(params.channelAddress, params.propertyId, params.amount);
            if (!hasSufficientFunds) {
                params.valid = false;
                params.reason += 'Insufficient funds for withdrawal; ';
            }

            return params;
        },

        // 21: Transfer
        validateTransfer: (params, channelRegistry, tallyMap) => {
            params.reason = '';
            params.valid = true;

            const isValidSourceChannel = channelRegistry.isValidChannel(params.fromChannelAddress);
            if (!isValidSourceChannel) {
                params.valid = false;
                params.reason += 'Invalid source channel; ';
            }

            const isValidDestinationChannel = channelRegistry.isValidChannel(params.toChannelAddress);
            if (!isValidDestinationChannel) {
                params.valid = false;
                params.reason += 'Invalid destination channel; ';
            }

            const hasSufficientBalance = tallyMap.hasSufficientBalance(params.fromChannelAddress, params.propertyId, params.amount);
            if (!hasSufficientBalance) {
                params.valid = false;
                params.reason += 'Insufficient balance for transfer; ';
            }

            return params;
        },

        // 22: Settle Channel PNL
        validateSettleChannelPNL: (params, channelRegistry, marginMap) => {
            params.reason = '';
            params.valid = true;

            const isValidChannel = channelRegistry.isValidChannel(params.channelAddress);
            if (!isValidChannel) {
                params.valid = false;
                params.reason += 'Invalid channel; ';
            }

            const isValidContract = marginMap.isValidContract(params.contractId);
            if (!isValidContract) {
                params.valid = false;
                params.reason += 'Invalid contract for settlement; ';
            }

            const canSettle = marginMap.canSettlePNL(params.channelAddress, params.contractId, params.amountSettled);
            if (!canSettle) {
                params.valid = false;
                params.reason += 'Cannot settle PNL; terms not met; ';
            }

            return params;
        },


    // 23: Mint Synthetic
    validateMintSynthetic: (params, synthRegistry, tallyMap) => {
        // Check if the synthetic token can be minted (valid property IDs, sufficient balance, etc.)
        const canMint = synthRegistry.canMintSynthetic(params.propertyIdUsed, params.contractIdUsed, params.amount);
        // Ensure the sender has sufficient balance of the underlying property
        const hasSufficientBalance = tallyMap.hasSufficientBalance(params.senderAddress, params.propertyIdUsed, params.amount);

        return canMint && hasSufficientBalance;
    },

    // 24: Redeem Synthetic
    validateRedeemSynthetic: (params, synthRegistry, tallyMap) => {
        // Check if the synthetic token can be redeemed (existence, sufficient amount, etc.)
        const canRedeem = synthRegistry.canRedeemSynthetic(params.propertyIdUsed, params.contractIdUsed, params.amount);
        // Ensure the sender has sufficient balance of the synthetic property
        const hasSufficientBalance = tallyMap.hasSufficientBalance(params.senderAddress, params.syntheticPropertyId, params.amount);

        return canRedeem && hasSufficientBalance;
    },

    // 25: Pay to Tokens
    validatePayToTokens: (params, tallyMap) => {
        // Ensure the sender has sufficient balance of the property used for payment
        const hasSufficientBalance = tallyMap.hasSufficientBalance(params.senderAddress, params.propertyIdUsed, params.amount);
        // Additional checks can be implemented based on the specific rules of Pay to Tokens transactions

        return hasSufficientBalance;
    },

        // 26: Create Option Chain
    validateCreateOptionChain: (params, contractRegistry) => {
        // Check if the series ID is valid
        const isValidSeriesId = contractRegistry.isValidSeriesId(params.contractSeriesId);
        // Check if the strike interval and other parameters are valid
        const isValidParams = contractRegistry.isValidOptionChainParams(params.strikeInterval, params.europeanStyle);

        return isValidSeriesId && isValidParams;
    },

    // 27: Trade Bai Urbun
    validateTradeBaiUrbun: (params, channelRegistry, baiUrbunRegistry) => {
        // Verify that the trade channel exists and is valid
        const isValidChannel = channelRegistry.isValidChannel(params.channelAddress);
        // Check if Bai Urbun contract terms are valid (price, amount, expiryBlock, etc.)
        const isValidContractTerms = baiUrbunRegistry.isValidBaiUrbunTerms(params.propertyIdDownPayment, params.propertyIdToBeSold, params.price, params.amount, params.expiryBlock);

        return isValidChannel && isValidContractTerms;
    },

    // 28: Trade Murabaha
    validateTradeMurabaha: (params, channelRegistry, murabahaRegistry) => {
        // Verify that the trade channel exists and is valid
        const isValidChannel = channelRegistry.isValidChannel(params.channelAddress);
        // Check if Murabaha contract terms are valid (down payment, price, amount, expiryBlock, etc.)
        const isValidContractTerms = murabahaRegistry.isValidMurabahaTerms(params.propertyIdDownPayment, params.downPaymentPercent, params.propertyIdToBeSold, params.price, params.amount, params.expiryBlock, params.installmentInterval);

        return isValidChannel && isValidContractTerms;
    },

    // 29: Issue Invoice
    validateIssueInvoice: (params, invoiceRegistry, tallyMap) => {
        // Check if the issuer has sufficient balance of the property to receive payment
        const hasSufficientBalance = tallyMap.hasSufficientBalance(params.issuerAddress, params.propertyIdToReceivePayment, params.amount);
        // Validate invoice terms (due date, collateral, etc.)
        const isValidInvoiceTerms = invoiceRegistry.isValidInvoiceTerms(params.dueDateBlock, params.propertyIdCollateral);

        return hasSufficientBalance && isValidInvoiceTerms;
    },

    // 30: Batch Move Zk Rollup
    validateBatchMoveZkRollup: (params, zkVerifier, tallyMap) => {
        // Verify the zk proof with the zkVerifier
        const isZkProofValid = zkVerifier.verifyProof(params.zkProof);
        // Check the validity of the payment and data logistics within the ordinals
        const arePaymentsValid = tallyMap.arePaymentsValid(params.payments);

        return isZkProofValid && arePaymentsValid;
    }
};

module.exports = Validity;
