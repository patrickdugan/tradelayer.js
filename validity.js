const TxUtils = require('./txUtils.js')
const db = require('./db')
const Activation = require('./activation.js')
const activationInstance = Activation.getInstance();
const PropertyList = require('./property.js')
const OracleList = require('./oracle.js')
const ContractRegistry = require('./contractRegistry.js')
const TallyMap = require('./tally.js')
const BigNumber = require('bignumber.js')
//const whiteLists = require('./whitelists.js')

const Validity = {

        // 0: Activate TradeLayer
        validateActivateTradeLayer: async (txId, params, sender) => {
            params.valid = true;
            console.log('inside validating activation '+JSON.stringify(params))

             //console.log('trying to debug this strings passing thing '+parseInt(params.txTypeToActivate)+params.txTypeToActivate +parseInt(params.txTypeToActivate)==NaN)
            if(isNaN(parseInt(params.txTypeToActivate))==true){
                params.valid = false;
                params.reason = 'Tx Type is not an integer';
            }

            // Check if the sender is the admin address
            if (sender != "tltc1qa0kd2d39nmeph3hvcx8ytv65ztcywg5sazhtw8") {
                params.valid=false
                params.reason = 'Not sent from admin address';
            }

            // Check if the txTypeToActivate is already activated
             
            const isAlreadyActivated = await activationInstance.isTxTypeActive(params.txTypeToActivate);
            //console.log('isAlreadyActivated '+isAlreadyActivated, params.txTypeToActivate)
            const activationBlock = await activationInstance.checkActivationBlock(params.txTypeToActivate)

            const rawTxData = await TxUtils.getRawTransaction(txId)
            const confirmedBlock = await TxUtils.getBlockHeight(rawTxData.blockhash)
            //console.log('comparing heights' +activationBlock + ' ' + confirmedBlock) 
            if (isAlreadyActivated&&confirmedBlock>activationBlock&&activationBlock!=null) {
                params.valid = false;
                params.reason = 'Transaction type already activated';
            }



            if(params.txTypeToActivate>35){
                params.valid = false;
                params.reason = 'Tx Type out of bounds';
            }

            return params;
        },
  
         // 1: Token Issue
        validateTokenIssue: async (params) => {
            params.valid=true
            console.log('inside issuance validation '+JSON.stringify(params))
            const isAlreadyActivated = await activationInstance.isTxTypeActive(1);
            if(isAlreadyActivated==false){
                params.valid=false
                params.reason += 'Tx type not yet activated '
            }
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

            return params
        },

        // 2: Send
        validateSend: async (sender, params, txId) => {
            params.reason = '';
            params.valid= true

            const isAlreadyActivated = await activationInstance.isTxTypeActive(2);
            if(isAlreadyActivated==false){
                params.valid=false
                params.reason += 'Tx type not yet activated '
            }

            const activationBlock = await activationInstance.checkActivationBlock(2)

            const rawTxData = await TxUtils.getRawTransaction(txId)
            const confirmedBlock = await TxUtils.getBlockHeight(rawTxData.blockhash)
            console.log('send comparing heights' +activationBlock + ' ' + confirmedBlock)
            if (isAlreadyActivated&&confirmedBlock>activationBlock&&activationBlock!=null) { //come back and tighten this up when checkAct block returns null
                params.valid = false;
                params.reason = 'Transaction type activated in the future';
            }

            const TallyMap = require('./tally.js')
            const senderTally = await TallyMap.getTally(sender, params.propertyIds);
            console.log('checking senderTally '+ params.senderAddress, params.propertyIds, JSON.stringify(senderTally))
            if (senderTally==0) {
                var balances = await TallyMap.getAddressBalances(sender)
                if(balances ==[]){
                    TallyMap.diagonistic(sender, params.propertyIds)
                }
                
            }
            console.log('checking we have enough tokens '+senderTally.available+ ' '+ params.amounts)
            if(senderTally.available < params.amounts){
                params.valid=false
                params.reason += 'Insufficient available balance'
            }

            /*const isSenderWhitelisted = await whitelistRegistry.isAddressWhitelisted(params.senderAddress, params.propertyId);
            if (!isSenderWhitelisted) {
                params.valid=false
                params.reason += 'Sender address not whitelisted; ';
            }

            const isRecipientWhistelisted = await whitelistRegistry.isAddressWhitelisted(params.recipientAddress);
            if (!senderKYCCleared) {
                params.valid=false
                params.reason += 'Sender address KYC not cleared; ';
            }*/

            return params
        },

        // 3: Trade Token for UTXO
        validateTradeTokenForUTXO: async (params) => {
            params.reason = '';
            params.valid = true;

            const isAlreadyActivated = await activationInstance.isTxTypeActive(3);
            if(isAlreadyActivated==false){
                params.valid=false
                params.reason += 'Tx type not yet activated '
            }

            if (!Number.isInteger(params.propertyIdNumber)) {
                params.valid = false;
                params.reason += 'Invalid property ID; ';
            }
            if (!(Number.isInteger(params.amount) && params.amount > 0)) {
                params.valid = false
                params.reason += 'Invalid amount; ';
            }
            if (!(Number.isInteger(params.satsExpected) && params.satsExpected >= 0)) {
                params.valid = true; //if we invalidate for things being off we will lose people's UTXO spends but we log the reason
                params.reason += 'Invalid sats expected; ';
            }

            return params;
        },

        // 4: Commit Token
        validateCommitToken: async (params, block, txid) => {
            params.reason = '';
            params.valid = true;

            if (!TallyMap.isAddressValid(params.sender)) {
                params.valid = false
                params.reason += 'Invalid sender address';
            }

            // Check if the sender has sufficient balance
            if (!TallyMap.hasSufficientBalance(params.sender, params.propertyId, params.amount)) {
                params.valid = false
                params.reason += 'Insufficient token balance for commitment';
            }

            const isAlreadyActivated = await activationInstance.isTxTypeActive(4);
            if(isAlreadyActivated==false){
                params.valid=false
                params.reason += 'Tx type not yet activated '
            }

            /*const isSenderWhitelisted = await whitelistRegistry.isAddressWhitelisted(params.senderAddress, params.propertyId);
            if (!isSenderWhitelisted) {
                params.valid = false;
                params.reason += 'Sender address not whitelisted; ';
            }*/

            return params;
        },

        // 5: On-chain Token for Token
        validateOnChainTokenForToken: async (sender, params, txId) => {
            params.reason = '';
            params.valid = true;

            if (!params.propertyIdOffered || !params.propertyIdDesired || !params.amountOffered || !params.amountExpected) {
                params.valid= false 
                params.reason += 'Missing required parameters for tradeTokens '
            }

            const isAlreadyActivated = await activationInstance.isTxTypeActive(5);
            if(isAlreadyActivated==false){
                params.valid=false
                params.reason += 'Tx type not yet activated '
            }

            const isVEST= (parseInt(params.propertyId1)==2&&parseInt(params.propertyId2)==2)
            if(isVEST){
                params.valid =false
                params.reason += "Vesting tokens cannot be traded"
            }

            const TallyMap = require('./tally.js')
            const hasSufficientBalance = await TallyMap.hasSufficientBalance(sender, params.propertyIdOffered, params.amountOffered);
            if (!hasSufficientBalance) {
                params.valid = false;
                params.reason += 'Insufficient balance for offered token; ';
            }

            /*const isSenderWhitelisted = await whitelistRegistry.isAddressWhitelisted(params.senderAddress, params.offeredPropertyId);
            if (!isSenderWhitelisted) {
                params.valid = false;
                params.reason += 'Sender not whitelisted for offered property; ';
            }

            const isRecipientWhitelisted = await whitelistRegistry.isAddressWhitelisted(params.recipientAddress, params.desiredPropertyId);
            if (!isRecipientWhitelisted) {
                params.valid = false;
                params.reason += 'Recipient not whitelisted for desired property; ';
            }*/

            return params;
        },

        // 6: Cancel Order
        validateCancelOrder: async (sender, params, txid) => {
            params.reason = '';
            params.valid = true;

            const isAlreadyActivated = await activationInstance.isTxTypeActive(6);
            if(isAlreadyActivated==false){
                params.valid=false
                params.reason += 'Tx type not yet activated '
            }

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
        validateCreateWhitelist: async (sender, params, txid) => {
            params.reason = '';
            params.valid = true;

            const isAlreadyActivated = await activationInstance.isTxTypeActive(7);
            if(isAlreadyActivated==false){
                params.valid=false
                params.reason += 'Tx type not yet activated '
            }

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
        validateUpdateAdmin: async (sender, params, txid) => {
            params.reason = '';
            params.valid = true;

            const isAlreadyActivated = await activationInstance.isTxTypeActive(8);
            if(isAlreadyActivated==false){
                params.valid=false
                params.reason += 'Tx type not yet activated '
            }

            if (!(typeof params.newAddress === 'string')) {
                params.valid = false;
                params.reason += 'Invalid new address; ';
            }

            // Additional logic can be added here if needed

            return params;
        },

        // 9: Issue Attestation
        validateIssueAttestation: async (sender, params, txid) => {
            params.reason = '';
            params.valid = true;

            const isAlreadyActivated = await activationInstance.isTxTypeActive(9);
            if(isAlreadyActivated==false){
                params.valid=false
                params.reason += 'Tx type not yet activated '
            }

            if (!(typeof params.targetAddress === 'string')) {
                params.valid = false;
                params.reason += 'Invalid target address; ';
            }

            // Additional logic can be added here if needed

            return params;
        },

        // 10: Revoke Attestation
        validateRevokeAttestation: async (sender, params, txid) => {
            params.reason = '';
            params.valid = true;

            const isAlreadyActivated = await activationInstance.isTxTypeActive(10);
            if(isAlreadyActivated==false){
                params.valid=false
                params.reason += 'Tx type not yet activated '
            }

            if (!(typeof params.targetAddress === 'string')) {
                params.valid = false;
                params.reason += 'Invalid target address; ';
            }

               return params;
        },

        // 11: Grant Managed Token
        validateGrantManagedToken: async (sender, params, txid) => {
            params.reason = '';
            params.valid = true;

            const isAlreadyActivated = await activationInstance.isTxTypeActive(11);
            if(isAlreadyActivated==false){
                params.valid=false
                params.reason += 'Tx type not yet activated '
            }

            const isPropertyAdmin = PropertyRegistry.isAdmin(params.senderAddress, params.propertyId);
            if (!isPropertyAdmin) {
                params.valid = false;
                params.reason += 'Sender is not admin of the property; ';
            }

            const isManagedProperty = PropertyRegistry.isManagedProperty(params.propertyId);
            if (!isManagedProperty) {
                params.valid = false;
                params.reason += 'Property is not of managed type; ';
            }

            const hasSufficientBalance = TallyMap.hasSufficientBalance(params.senderAddress, params.propertyId, params.amount);
            if (!hasSufficientBalance) {
                params.valid = false;
                params.reason += 'Insufficient balance to grant tokens; ';
            }

            return params;
        },

        // 12: Redeem Managed Token
        validateRedeemManagedToken: async (sender, params, txid) => {
            params.reason = '';
            params.valid = true;

            const isAlreadyActivated = await activationInstance.isTxTypeActive(12);
            if(isAlreadyActivated==false){
                params.valid=false
                params.reason += 'Tx type not yet activated '
            }

            const isPropertyAdmin = PropertyRegistry.isAdmin(params.senderAddress, params.propertyId);
            if (!isPropertyAdmin) {
                params.valid = false;
                params.reason += 'Sender is not admin of the property; ';
            }

            const isManagedProperty = PropertyRegistry.isManagedProperty(params.propertyId);
            if (!isManagedProperty) {
                params.valid = false;
                params.reason += 'Property is not of managed type; ';
            }

            const canRedeemTokens = TallyMap.canRedeemTokens(params.senderAddress, params.propertyId, params.amount);
            if (!canRedeemTokens) {
                params.valid = false;
                params.reason += 'Cannot redeem tokens; insufficient balance or other criteria not met; ';
            }

            return params;
        },

        // 13: Create Oracle
        validateCreateOracle: async (sender, params, txid) => {
            params.reason = '';
            params.valid = true

            const isAlreadyActivated = await activationInstance.isTxTypeActive(13);
            if(isAlreadyActivated==false){
                params.valid=false
                params.reason += 'Tx type not yet activated '
            }

            return params;
        },

        // 14: Publish Oracle Data
        validatePublishOracleData: async (sender, params, txid) => {
            params.reason = '';
            params.valid = OracleRegistry.isAdmin(params.senderAddress, params.oracleId);
            if (!params.valid) {
                params.reason = 'Sender is not admin of the specified oracle; ';
            }

            const isAlreadyActivated = await activationInstance.isTxTypeActive(14);
            if(isAlreadyActivated==false){
                params.valid=false
                params.reason += 'Tx type not yet activated '
            } else {
                // Retrieve the oracle instance using its ID
                const oracle = await OracleRegistry.getOracleData(params.oracleId);
                if (!oracle) {
                    params.reason += 'Oracle not found; ';
                } else {
                    // Check if the sender is the admin of the oracle
                    const isAdmin = sender === oracle.adminAddress;
                    if (!isAdmin) {
                        params.reason += 'Sender is not admin of the specified oracle; ';
                    } else {
                        // Validation passes if the sender is the admin and the tx type is activated
                        params.valid = true;
                    }
                }
    }

            return params;
        },

        // 15: Close Oracle
        validateCloseOracle: async (sender, params, txid) => {
            params.reason = '';
            params.valid = OracleRegistry.isAdmin(params.senderAddress, params.oracleId);
            if (!params.valid) {
                params.reason = 'Sender is not admin of the specified oracle; ';
            }
            const isAlreadyActivated = await activationInstance.isTxTypeActive(15);
            if(isAlreadyActivated==false){
                params.valid=false
                params.reason += 'Tx type not yet activated '
            }

            return params;
        },

        //16: Create Contracts
        validateCreateContractSeries: async (sender, params, txid) => {
            params.valid = true;
            params.reason = '';

            // Check if the underlyingOracleId exists or is null
            if (params.native === false) {
                const validOracle = await OracleList.getOracleData(params.underlyingOracleId) !== null;
                if (!validOracle) {
                    params.valid = false;
                    params.reason += "Invalid or missing underlying oracle ID. ";
                }
            }

            // On-Chain Data Validation
            if (params.native === true && params.onChainData) {
                let validNatives = true;
                for (const pid of params.onChainData) {
                    if (pid !== null && !(await PropertyList.getPropertyData(pid))) {
                        validNatives = false;
                        break;
                    }
                }
                if (!validNatives) {
                    params.valid = false;
                    params.reason += "Invalid on-chain data format or property IDs. ";
                }
            }

            const isVEST= (parseInt(params.collateralPropertyId)==2&&parseInt(params.notionalPropertyId)==2)
            if(isVEST){
                params.valid =false
                params.reason += "Vesting tokens cannot be used as collateral or hedged"
            }

            // Check if notionalPropertyId exists or is null (for oracle contracts)
            if (params.notionalPropertyId !== null&&params.native==true) {
                const validNotionalProperty = await PropertyList.getPropertyData(params.notionalPropertyId) !== null;
                if (!validNotionalProperty) {
                    params.valid = false;
                    params.reason += "Invalid notional property ID. ";
                }
            }

            // Check if collateralPropertyId is a valid existing propertyId
            const validCollateralProperty = await PropertyList.getPropertyData(params.collateralPropertyId) !== null;
            if (!validCollateralProperty) {
                params.valid = false;
                params.reason += "Invalid collateral property ID. ";
            }

            // Check if notionalValue is a number
            if (typeof params.notionalValue !== 'number'||params.notionalValue ==0) {
                params.valid = false;
                params.reason += "Notional value must be a non-zero number. ";
            }

            // Check if expiryPeriod is an integer
            if (!Number.isInteger(params.expiryPeriod)) {
                params.valid = false;
                params.reason += "Expiry period must be an integer. ";
            }

            // Check if series is a valid integer
            if (!Number.isInteger(params.series)) {
                params.valid = false;
                params.reason += "Series must be an integer. ";
            }

            // Validate inverse and fee as booleans
            if (typeof params.inverse !== 'boolean') {
                params.valid = false;
                params.reason += "Inverse must be a boolean. ";
            }

            if (typeof params.fee !== 'boolean') {
                params.valid = false;
                params.reason += "Fee must be a boolean. ";
            }

            // Check if the transaction type is activated
            const isAlreadyActivated = await activationInstance.isTxTypeActive(16);
            if (!isAlreadyActivated) {
                params.valid = false;
                params.reason += 'Tx type not yet activated. ';
            }

            if (!params.valid) {
                console.log(`Contract series validation failed: ${params.reason}`);
            }

            return params;
        },


        // 17: Exercise Derivative
        validateExerciseDerivative: async (params, derivativeRegistry, marginMap) => {
            params.reason = '';
            params.valid = true;

            const isAlreadyActivated = await activationInstance.isTxTypeActive(17);
            if(isAlreadyActivated==false){
                params.valid=false
                params.reason += 'Tx type not yet activated '
            }

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

        // 18: Trade Contract On-chain
        validateTradeContractOnchain: async (params, sender, block) => {
            params.reason = '';
            params.valid = true;

            const isAlreadyActivated = await activationInstance.isTxTypeActive(18);
            if(isAlreadyActivated==false){
                params.valid=false
                params.reason += 'Tx type not yet activated '
            }

            const contractDetails = await ContractRegistry.getContractInfo(params.contractId);
            console.log('checking contract details validity ' + JSON.stringify(contractDetails))
            if(contractDetails==null||contractDetails=={}){
                params.valid=false
                params.reason+= "contractId not found"
                return params
            }

            const initialMarginPerContract = await ContractRegistry.getInitialMargin(params.contractId, contractDetails);
            const totalInitialMargin = BigNumber(initialMarginPerContract).times(params.amount).toNumber();

            // Check if the sender has enough balance for the initial margin
            const hasSufficientBalance = await TallyMap.hasSufficientBalance(params.senderAddress, params.collateralPropertyId, params.totalInitialMargin);
            if (!hasSufficientBalance) {
                throw new Error('Insufficient balance for initial margin');
            }

            if(params.leverage>50){
                params.valid=false
                params.reason+= "Stop encouraging gambling!"
            }
            /*const isSenderWhitelisted = contractDetails.type === 'oracle' ? await whitelistRegistry.isAddressWhitelisted(params.senderAddress, contractDetails.oracleId) : true;
            if (!isSenderWhitelisted) {
                params.valid = false;
                params.reason += 'Sender address not whitelisted for the contract\'s oracle; ';
            }*/

            return params;
        },

        // 19: Trade Contract Channel
        validateTradeContractChannel: async (params, channelRegistry, whitelistRegistry, contractRegistry) => {
            params.reason = '';
            params.valid = true;

            const isAlreadyActivated = await activationInstance.isTxTypeActive(19);
            if(isAlreadyActivated==false){
                params.valid=false
                params.reason += 'Tx type not yet activated '
            }

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

        // 20: Trade Tokens Channel
        validateTradeTokensChannel: async (params, channelRegistry, whitelistRegistry) => {
            params.reason = '';
            params.valid = true;

            const isAlreadyActivated = await activationInstance.isTxTypeActive(20);
            if(isAlreadyActivated==false){
                params.valid=false
                params.reason += 'Tx type not yet activated '
            }

            const isVEST= (parseInt(params.propertyId1)==2&&parseInt(params.propertyId2)==2)
            if(isVEST){
                params.valid =false
                params.reason += "Vesting tokens cannot be traded"
            }

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

        // 21: Withdrawal
        validateWithdrawal: async (params, sender, block) => {
            params.reason = '';
            params.valid = true;

            const isAlreadyActivated = await activationInstance.isTxTypeActive(21);
            if(isAlreadyActivated==false){
                params.valid=false
                params.reason += 'Tx type not yet activated '
            }

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

        // 22: Transfer
        validateTransfer: async (params, channelRegistry, tallyMap) => {
            params.reason = '';
            params.valid = true;

            const isAlreadyActivated = await activationInstance.isTxTypeActive(22);
            if(isAlreadyActivated==false){
                params.valid=false
                params.reason += 'Tx type not yet activated '
            }

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

        // 23: Settle Channel PNL
        validateSettleChannelPNL: async (params, channelRegistry, marginMap) => {
            params.reason = '';
            params.valid = true;

            const isAlreadyActivated = await activationInstance.isTxTypeActive(23);
            if(isAlreadyActivated==false){
                params.valid=false
                params.reason += 'Tx type not yet activated '
            }

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


    // 24: Mint Synthetic
    validateMintSynthetic: (params) => {
        params.reason = '';
        params.valid = true;
        // Check if the synthetic token can be minted (valid property IDs, sufficient balance, etc.)
        const contractInfo = ContractRegistry.getContractInfo(params.contractId);
        const collateralPropertyId = contractInfo.collateralPropertyId
        const notional = contractInfo.notionalValue
        if(contractInfo.inverse==false){
                params.valid=false
                params.reason += 'Cannot mint synthetics with linear contracts'
        }
        if(contractInfo.native==false){
                params.valid=false
                params.reason += 'Cannot mint synthetics with oracle contracts... no one man should have all that power'
        }
        const contractsBalance = WalletCache.getContractPositionForAddressAndContractId(param.sender,params.contractId)
        if(contractsBalance*notional>=params.amount){
                params.valid=false
                params.reason += 'insufficient contracts to hedge the amount requested'
        }
        // Ensure the sender has sufficient balance of the underlying property
        const hasSufficientBalance = TallyMap.hasSufficientBalance(params.sender, collateralPropertyId, params.amount*notional);
        if(hasSufficientBalance==false){
                params.valid=false
                params.reason += 'insufficient collateral to create a 1x hedge position'
        }

        return params
    },

    // 25: Redeem Synthetic
    validateRedeemSynthetic: (params) => {
        params.reason = '';
        params.valid = true;
        // Check if the synthetic token can be redeemed (existence, sufficient amount, etc.)
        const canRedeem = TallyMap.isSynthetic(params.propertyId);
        if(canRedeem==false){
                params.valid=false
                params.reason += 'Token is not of a synthetic nature'
        }
        // Ensure the sender has sufficient balance of the synthetic property
        const hasSufficientBalance = TallyMap.hasSufficientBalance(params.senderAddress, params.propertyId, params.amount);
        if(hasSufficientBalance==false){
                params.valid=false
                params.reason += 'insufficient tokens to redeem in this amount'
        }
        return canRedeem && hasSufficientBalance;
    },

    // 26: Pay to Tokens
    validatePayToTokens: (params, tallyMap) => {
        // Ensure the sender has sufficient balance of the property used for payment
        const hasSufficientBalance = tallyMap.hasSufficientBalance(params.senderAddress, params.propertyIdUsed, params.amount);
        // Additional checks can be implemented based on the specific rules of Pay to Tokens transactions

        return hasSufficientBalance;
    },

        // 27: Create Option Chain
    validateCreateOptionChain: (params, contractRegistry) => {
        // Check if the series ID is valid
        const isValidSeriesId = contractRegistry.isValidSeriesId(params.contractSeriesId);
        // Check if the strike interval and other parameters are valid
        const isValidParams = contractRegistry.isValidOptionChainParams(params.strikeInterval, params.europeanStyle);

        return isValidSeriesId && isValidParams;
    },

    // 28: Trade Bai Urbun
    validateTradeBaiUrbun: (params, channelRegistry, baiUrbunRegistry) => {
        // Verify that the trade channel exists and is valid
        const isValidChannel = channelRegistry.isValidChannel(params.channelAddress);
        // Check if Bai Urbun contract terms are valid (price, amount, expiryBlock, etc.)
        const isValidContractTerms = baiUrbunRegistry.isValidBaiUrbunTerms(params.propertyIdDownPayment, params.propertyIdToBeSold, params.price, params.amount, params.expiryBlock);

        return isValidChannel && isValidContractTerms;
    },

    // 29: Trade Murabaha
    validateTradeMurabaha: (params, channelRegistry, murabahaRegistry) => {
        // Verify that the trade channel exists and is valid
        const isValidChannel = channelRegistry.isValidChannel(params.channelAddress);
        // Check if Murabaha contract terms are valid (down payment, price, amount, expiryBlock, etc.)
        const isValidContractTerms = murabahaRegistry.isValidMurabahaTerms(params.propertyIdDownPayment, params.downPaymentPercent, params.propertyIdToBeSold, params.price, params.amount, params.expiryBlock, params.installmentInterval);

        return isValidChannel && isValidContractTerms;
    },

    // 30: Issue Invoice
    validateIssueInvoice: (params, invoiceRegistry, tallyMap) => {
        // Check if the issuer has sufficient balance of the property to receive payment
        const hasSufficientBalance = tallyMap.hasSufficientBalance(params.issuerAddress, params.propertyIdToReceivePayment, params.amount);
        // Validate invoice terms (due date, collateral, etc.)
        const isValidInvoiceTerms = invoiceRegistry.isValidInvoiceTerms(params.dueDateBlock, params.propertyIdCollateral);

        return hasSufficientBalance && isValidInvoiceTerms;
    },

    // 31: Batch Move Zk Rollup
    validateBatchMoveZkRollup: (params, zkVerifier, tallyMap) => {
        // Verify the zk proof with the zkVerifier
        const isZkProofValid = zkVerifier.verifyProof(params.zkProof);
        // Check the validity of the payment and data logistics within the ordinals
        const arePaymentsValid = tallyMap.arePaymentsValid(params.payments);

        return isZkProofValid && arePaymentsValid;
    }
};

module.exports = Validity;
