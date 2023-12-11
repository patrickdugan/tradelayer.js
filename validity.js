const TxUtils = require('./txUtils.js')
const db = require('./db')

const Validity = {
    // 0: Activate TradeLayer
    validateActivateTradeLayer: (txid, params, sender) => {
            return sender === "tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8";
        //}
    },

    // 1: Token Issue
    validateTokenIssue: (params) => {
        // Validate initial amount, ticker, and optional parameters
        const isValidAmount = Number.isInteger(params.initialAmount) && params.initialAmount > 0;
        const isValidTicker = typeof params.ticker === 'string' && params.ticker.length <= 6;
        // Add further validations as needed
        return isValidAmount && isValidTicker;
    },

    // 2: Send
    validateSend: async (params, tallyMap, whitelistRegistry, kycRegistry) => {
        // Ensure the sender has sufficient balance
        const hasSufficientBalance = tallyMap.hasSufficientBalance(params.senderAddress, params.propertyId, params.amount);

        // Check if the sender address is whitelisted
        const isSenderWhitelisted = await whitelistRegistry.isAddressWhitelisted(params.senderAddress, params.propertyId);

        return hasSufficientBalance && isSenderWhitelisted && senderKYCCleared;
    },

    // 3: Trade Token for UTXO
    validateTradeTokenForUTXO: (params, tallyMap) => {
        // Validate parameters specific to Trade Token for UTXO transaction
        const isValidPropertyId = Number.isInteger(params.propertyIdNumber);
        const isValidAmount = Number.isInteger(params.amount) && params.amount > 0;
        const isValidSatsExpected = Number.isInteger(params.satsExpected) && params.satsExpected >= 0;
        // Add further validations as needed
        return isValidPropertyId && isValidAmount && isValidSatsExpected;
    },

    // 4: Commit Token
    validateCommitToken: async (params, tallyMap, whitelistRegistry, kycRegistry) => {
        // Ensure the sender has enough tokens available to commit
        const hasSufficientTokens = tallyMap.hasSufficientBalance(params.senderAddress, params.propertyId, params.amount);

        // Check if the sender address is whitelisted
        const isSenderWhitelisted = await whitelistRegistry.isAddressWhitelisted(params.senderAddress, params.propertyId);

        // Check if the sender address has KYC clearance
        const senderKYCCleared = await kycRegistry.isAddressKYCCleared(params.senderAddress);

        return hasSufficientTokens && isSenderWhitelisted && senderKYCCleared;
    },

    // 5: On-chain Token for Token
    validateOnChainTokenForToken: async (params, tallyMap, whitelistRegistry) => {
        // Ensure the sender has sufficient balance of the offered token
        const hasSufficientBalance = tallyMap.hasSufficientBalance(params.senderAddress, params.offeredPropertyId, params.amountOffered);

        // Check if the sender address is whitelisted for the offered property
        const isSenderWhitelisted = await whitelistRegistry.isAddressWhitelisted(params.senderAddress, params.offeredPropertyId);

        // Check if the recipient address is whitelisted for the desired property
        const isRecipientWhitelisted = await whitelistRegistry.isAddressWhitelisted(params.recipientAddress, params.desiredPropertyId);

        return hasSufficientBalance && isSenderWhitelisted && isRecipientWhitelisted;
    },

    // 6: Cancel Order
    validateCancelOrder: (params, orderBook) => {
        // Validate parameters specific to Cancel Order transaction
        const isValidFromAddress = typeof params.fromAddress === 'string'; // Further validation based on address format
        const isValidOfferedPropertyId = params.offeredPropertyId ? Number.isInteger(params.offeredPropertyId) : true;
        const isValidDesiredPropertyId = params.desiredPropertyId ? Number.isInteger(params.desiredPropertyId) : true;
        const isValidCancelParams = typeof params.cancelParams === 'object';
        // Add further validations as needed
        return isValidFromAddress && isValidOfferedPropertyId && isValidDesiredPropertyId && isValidCancelParams;
    },

    // 7: Create Whitelist
    validateCreateWhitelist: (params) => {
        // Validate parameters specific to Create Whitelist transaction
        const isValidBackupAddress = params.backupAddress ? typeof params.backupAddress === 'string' : true; // Further validation based on address format
        const isValidName = typeof params.name === 'string'; // Further name validation may be required
        // Add further validations as needed
        return isValidBackupAddress && isValidName;
    },

    // 8: Update Admin
    validateUpdateAdmin: (params, registry) => {
        // Validate parameters specific to Update Admin transaction
        const isValidNewAddress = typeof params.newAddress === 'string'; // Further validation based on address format
        // Additional logic to check if sender is current admin or backup admin
        // Example: registry.isAdminOrBackup(params.currentAddress, params.newAddress);
        return isValidNewAddress;
    },

    // 9: Issue Attestation
    validateIssueAttestation: (params, whitelistRegistry) => {
        // Validate parameters specific to Issue Attestation transaction
        const isValidTargetAddress = typeof params.targetAddress === 'string'; // Further validation based on address format
        // Additional logic to check if sender is an admin of a whitelist
        // Example: whitelistRegistry.isAdmin(params.senderAddress);
        return isValidTargetAddress;
    },

    // 10: Revoke Attestation
    validateRevokeAttestation: (params, whitelistRegistry) => {
        // Validate parameters specific to Revoke Attestation transaction
        const isValidTargetAddress = typeof params.targetAddress === 'string'; // Further validation based on address format
        // Additional logic to check if sender is an admin of a whitelist and target address has an attestation
        // Example: whitelistRegistry.canRevoke(params.senderAddress, params.targetAddress);
        return isValidTargetAddress;
    },
        // 11: Grant Managed Token
    validateGrantManagedToken: (params, propertyRegistry, tallyMap) => {
        // Check if the sender is an admin of the specified property
        const isPropertyAdmin = propertyRegistry.isAdmin(params.senderAddress, params.propertyId);
        // Ensure the property is of a managed type
        const isManagedProperty = propertyRegistry.isManagedProperty(params.propertyId);
        // Ensure the sender has sufficient balance
        const hasSufficientBalance = tallyMap.hasSufficientBalance(params.senderAddress, params.propertyId, params.amount);

        return isPropertyAdmin && isManagedProperty && hasSufficientBalance;
    },

    // 12: Redeem Managed Token
    validateRedeemManagedToken: (params, propertyRegistry, tallyMap) => {
        // Check if the sender is an admin of the specified property
        const isPropertyAdmin = propertyRegistry.isAdmin(params.senderAddress, params.propertyId);
        // Ensure the property is of a managed type
        const isManagedProperty = propertyRegistry.isManagedProperty(params.propertyId);
        // Check if the sender has enough tokens to redeem
        const canRedeemTokens = tallyMap.canRedeemTokens(params.senderAddress, params.propertyId, params.amount);

        return isPropertyAdmin && isManagedProperty && canRedeemTokens;
    },

    // 13: Create Oracle
    validateCreateOracle: (params, oracleRegistry) => {
        // Check if the sender address is authorized to create an oracle
        return oracleRegistry.canCreateOracle(params.senderAddress);
    },

    // 14: Publish Oracle Data
    validatePublishOracleData: (params, oracleRegistry) => {
        // Check if the sender is the admin of the specified oracle
        return oracleRegistry.isAdmin(params.senderAddress, params.oracleId);
    },

    // 15: Close Oracle
    validateCloseOracle: (params, oracleRegistry) => {
        // Check if the sender is the admin of the specified oracle
        return oracleRegistry.isAdmin(params.senderAddress, params.oracleId);
    },

        // 16: Exercise Derivative
    validateExerciseDerivative: (params, derivativeRegistry, marginMap) => {
        // Check if the derivative contract exists and is valid for exercise
        const isValidDerivative = derivativeRegistry.isValidDerivative(params.contractId);
        // Check if the sender has sufficient contracts and margin to exercise
        const canExercise = marginMap.canExercise(params.senderAddress, params.contractId, params.amount);

        return isValidDerivative && canExercise;
    },

    // 17: Trade Contract On-chain
    validateTradeContractOnchain: async (params, marginMap, whitelistRegistry, contractRegistry) => {
        // Ensure the sender has enough margin or contract balance
        const hasSufficientMargin = marginMap.hasSufficientMargin(params.senderAddress, params.contractId, params.amount);

        // Retrieve contract details from the contract registry
        const contractDetails = await contractRegistry.getContractDetails(params.contractId);

        let isSenderWhitelisted = true;
        if (contractDetails.type === 'oracle') {
            // Check if the sender address is whitelisted for the contract's oracle
            isSenderWhitelisted = await whitelistRegistry.isAddressWhitelisted(params.senderAddress, contractDetails.oracleId);
        }

        return hasSufficientMargin && isSenderWhitelisted;
    },

    // 18: Trade Contract Channel
    validateTradeContractChannel: async (params, channelRegistry, whitelistRegistry, contractRegistry) => {
        // Retrieve the commit addresses from the channel registry
        const { commitAddressA, commitAddressB } = channelRegistry.getCommitAddresses(params.channelAddress);

        // Retrieve contract details from the contract registry
        const contractDetails = await contractRegistry.getContractDetails(params.contractId);

        let isAddressAWhitelisted = true;
        let isAddressBWhitelisted = true;
        if (contractDetails.type === 'oracle') {
            // Check if the commit addresses are whitelisted for the contract's oracle
            isAddressAWhitelisted = await whitelistRegistry.isAddressWhitelisted(commitAddressA, contractDetails.oracleId);
            isAddressBWhitelisted = await whitelistRegistry.isAddressWhitelisted(commitAddressB, contractDetails.oracleId);
        }

        return isAddressAWhitelisted && isAddressBWhitelisted;
    },

    // 19: Trade Tokens Channel
    validateTradeTokensChannel: async (params, channelRegistry, whitelistRegistry) => {
        // Retrieve the commit addresses from the channel registry
        const { commitAddressA, commitAddressB } = channelRegistry.getCommitAddresses(params.channelAddress);

        // Check if the commit addresses are whitelisted for the respective properties
        const isAddressAWhitelisted = await whitelistRegistry.isAddressWhitelisted(commitAddressA, params.propertyId1);
        const isAddressBWhitelisted = await whitelistRegistry.isAddressWhitelisted(commitAddressB, params.propertyId2);

        return isAddressAWhitelisted && isAddressBWhitelisted;
    },


    // 20: Withdrawal
    validateWithdrawal: (params, channelRegistry, tallyMap) => {
        // Check if the channel exists and the sender is authorized
        const isValidChannel = channelRegistry.isValidChannel(params.channelAddress);
        const isAuthorizedSender = channelRegistry.isAuthorizedSender(params.channelAddress, params.senderAddress);
        // Verify that there are sufficient funds for the withdrawal
        const hasSufficientFunds = tallyMap.hasSufficientBalance(params.channelAddress, params.propertyId, params.amount);

        return isValidChannel && isAuthorizedSender && hasSufficientFunds;
    },

        // 21: Transfer
    validateTransfer: (params, channelRegistry, tallyMap) => {
        // Check if both source and destination channels are valid
        const isValidSourceChannel = channelRegistry.isValidChannel(params.fromChannelAddress);
        const isValidDestinationChannel = channelRegistry.isValidChannel(params.toChannelAddress);
        // Check if the sender has sufficient token balance for the transfer
        const hasSufficientBalance = tallyMap.hasSufficientBalance(params.fromChannelAddress, params.propertyId, params.amount);

        return isValidSourceChannel && isValidDestinationChannel && hasSufficientBalance;
    },

    // 22: Settle Channel PNL
    validateSettleChannelPNL: (params, channelRegistry, marginMap) => {
        // Check if the channel exists and is valid
        const isValidChannel = channelRegistry.isValidChannel(params.channelAddress);
        // Verify the existence and validity of the contract to be settled
        const isValidContract = marginMap.isValidContract(params.contractId);
        // Check if the settlement terms are appropriate (amounts, contract validity, etc.)
        const canSettle = marginMap.canSettlePNL(params.channelAddress, params.contractId, params.amountSettled);

        return isValidChannel && isValidContract && canSettle;
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
