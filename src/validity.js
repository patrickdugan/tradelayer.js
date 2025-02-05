const TxUtils = require('./txUtils.js')
const db = require('./db')
const Activation = require('./activation.js')
const activationInstance = Activation.getInstance();
const PropertyList = require('./property.js')
const OracleList = require('./oracle.js')
const ContractRegistry = require('./contractRegistry.js')
const TallyMap = require('./tally.js')
const BigNumber = require('bignumber.js')
const Orderbook = require('./orderbook.js')
const Channels = require('./channels.js')
const MarginMap = require('./marginMap.js')
const ClearList = require('./clearlist.js')
const VolumeIndex = require('./volumeIndex.js')
const SyntheticRegistry = require('./vaults.js')
const Scaling = require('./scaling.js')
//const whiteLists = require('./whitelists.js')
const bannedCountries = ["US", "KP", "SY", "RU", "IR", "CU"];

const Validity = {

        isActivated: async (block,txid,txType) => {
            /*let is = false
            const activationBlock = await activationInstance.checkActivationBlock(txType) 
            const tx = await TxUtils.getRawTransaction(txid,true)
            console.log('inside isActivated '+JSON.stringify(tx) + ' '+ activationBlock+ ' '+txType)
            //if(!tx){return true}
            if(block>activationBlock&&activationBlock!=null){
                is = true
            }
            return is*/
            return true
        },

        //Type 0: Activation
        validateActivateTradeLayer: async (sender, params, txid) => {
            params.valid = true;
            console.log('Raw txTypeToActivate:', JSON.stringify(params.txTypesToActivate));

            let txTypes = [];

            // Sanitize txTypeToActivate into an array of valid numbers
            if (Array.isArray(params.txTypesToActivate)) {
                txTypes = params.txTypesToActivate
                    .map(tx => Number(tx)) // Convert all elements to numbers
                    .filter(tx => !isNaN(tx)); // Remove any invalid numbers (NaN)
            } else if (params.txTypeToActivate !== undefined && params.txTypesToActivate !== null) {
                const num = Number(params.txTypesToActivate);
                if (!isNaN(num)) {
                    txTypes = [num];
                }
            }

            console.log('Sanitized txTypes:', txTypes);

            // Check if txTypes array is empty (invalid input)
            if (txTypes.length === 0) {
                params.valid = false;
                params.reason = 'Tx Type contains non-integer or invalid values';
                return params;
            }

            // Check if sender is the admin address
            const admin = activationInstance.getAdmin();
            console.log('Sender vs Admin:', sender, admin);
            if (sender !== admin) {
                params.valid = false;
                params.reason = 'Not sent from admin address';
                return params;
            }

            // Check if txTypes are within valid bounds
            if (txTypes.some(txType => txType > 35 || txType < 0)) {
                params.valid = false;
                params.reason = 'Tx Type out of bounds';
                return params;
            }

            // All checks passed
            params.txTypesToActivate = txTypes;
            console.log('Validated txTypesToActivate:', txTypes);
            return params;
        },


         // 1: Token Issue
        validateTokenIssue: async (sender, params,txid) => {
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
            // Add check for existing ticker using the isTickerExist method

            const tickerExists = await PropertyList.doesTickerExist(params.ticker);
            if (tickerExists) {
                params.valid = false;
                params.reason += 'Ticker already exists; ';
            }

             // Invalidate if the ticker starts with "s"
            if (params.ticker.startsWith('s')) {
                params.valid = false;
                params.reason += 'Ticker cannot start with "s"; ';
            }

            if (params.type === 'native' && (params.propertyId !== 1||params.propertyId !==4)) {
                params.valid=false
                params.reason += 'Invalid property ID for native type; ';
            }

            if (params.type === 'vesting' && (params.propertyId !== 2||params.propertyId !==3)){
                params.valid=false
                params.reason += 'Invalid property ID for vesting type; ';
            }

            const is = await Validity.isActivated(params.block,txid,1)
            console.log(is)
            if (!is) {
                params.valid = false;
                params.reason = 'Transaction type activated after tx';
            }

            return params
        },

        // 2: Send
        validateSend: async (sender, params, txid) => {
            params.reason = '';
            params.valid= true
            //console.log('send params ' +JSON.stringify(params))

            const isAlreadyActivated = await activationInstance.isTxTypeActive(2);
            if(isAlreadyActivated==false){
                params.valid=false
                params.reason += 'Tx type not yet activated '
            }

            const is = await Validity.isActivated(params.block,txid,2)
            console.log(is)
            if (!is) {
                params.valid = false;
                params.reason = 'Transaction type activated after tx';
            }

            if(!validateAddress(params.address)){
                const valid = await TxUtils.validateAddressWrapper(params.address)
                console.log('double checking validity with rpc '+JSON.stringify(valid))
                console.log('valid? '+valid.isvalid)
                if(!valid.isvalid){
                    params.valid= false
                    params.reason = 'Destination address is not validly formed.'
                }
            }

            const propertyData = await PropertyList.getPropertyData(params.propertyIds)
            console.log(JSON.stringify(propertyData))
            if(propertyData==null||propertyData==undefined){
                params.valid = false
                params.reason = 'propertyId not found in Property List'
                return params
            }

            const admin = activationInstance.getAdmin()
            console.log('admin in send '+admin)
            if(sender!=admin&&(params.propertyIds == 1||params.propertyIds == 4)){
                      let bans = await ClearList.getBanlist()
                      console.log('banlist '+JSON.stringify(bans))
                    if(bans==null){bans = bannedCountries}
                        console.log('bans again '+bans)
                    const senderCountryInfo = await ClearList.getCountryCodeByAddress(sender);
                    const isAcc = await ClearList.isAddressInClearlist(3,sender)
                    console.log('sender country info '+JSON.stringify(senderCountryInfo))
                    if ((!senderCountryInfo || bans.includes(senderCountryInfo.countryCode))&&!isAcc){
                        if(activationInstance.areActivationsAboveThreshold()){
                        params.valid = false;
                        params.reason += 'Sender cannot handle TL or TLI from a banned country or lacking country code attestation';
          
                        }
                    }
            }
          

            const TallyMap = require('./tally.js')
            const senderTally = await TallyMap.getTally(sender, params.propertyIds);
            console.log('checking senderTally '+ JSON.stringify(params) + ' '+ params.senderAddress, params.propertyIds, JSON.stringify(senderTally))
            if (senderTally==0) {
                var balances = await TallyMap.getAddressBalances(sender)
                if(balances ==[]){
                    TallyMap.diagonistic(sender, params.propertyIds)
                } 
            }

            console.log('checking we have enough tokens '+senderTally.available+ ' '+ params.amounts)
            if(senderTally.available<params.amounts||senderTally.available==undefined){
                params.valid=false
                params.reason += 'Insufficient available balance'
                //console.log(params.valid, params.reason)
            }
            /*const hasSufficientBalance = await TallyMap.hasSufficientBalance(params.senderAddress, params.propertyId, params.amounts)
            console.log('validating send '+JSON.stringify(hasSufficientBalance))
            if(hasSufficientBalance.hasSufficient==false){
                params.valid=false
                params.reason += 'Insufficient available balance'
                console.log(params.valid, params.reason)
            }*/

                    // Whitelist validation logic
             let propertyIds = [];

                if (Array.isArray(params.propertyIds)) {
                    propertyIds = params.propertyIds;
                } else if (Number.isInteger(params.propertyIds)) {
                    propertyIds = [params.propertyIds];
                }

            const senderWhitelists = Array.isArray(propertyData.whitelistId) ? propertyData.whitelistId : [propertyData.whitelistId];

            // Get recipient whitelist IDs from the attestation map
            const recipientAttestations = await ClearList.getAttestations(params.recipientAddress);
            const recipientWhitelists = recipientAttestations.map(att => att.data.clearlistId);
            var passesSend = false

            for (const whitelistId of senderWhitelists) {
                
                const senderWhitelisted = await ClearList.isAddressInClearlist(whitelistId, sender);
                if (senderWhitelisted) {
                    passesSend=true
                }
            }
            if(!passesSend&&propertyData.whitelistId!=0){
                params.valid=false
                params.reason += `Sender address not whitelisted in clearlist`;
            }

            var passesReceive = false

            for (const whitelistId of recipientWhitelists) {
                const recipientWhitelisted = await ClearList.isAddressInClearlist(whitelistId, params.recipientAddress);
                if (recipientWhitelisted) {
                    passesReceive=true
                
                    break; // No need to check further if one fails
                }
            }
            if(!passesReceive&&propertyData.whitelistId!=0){
                    params.valid = false;
                    params.reason += `Recipient address not whitelisted in clearlist; `;
            }

            return params
        },

        // 3: Trade Token for UTXO
        validateTradeTokenForUTXO: async (sender, params, txid,outputs) => {
            params.reason = '';
            params.valid = true;
            console.log('inside validate UTXO outputs '+JSON.stringify(outputs))
            const isAlreadyActivated = await activationInstance.isTxTypeActive(3);
            if (!isAlreadyActivated) {
                params.valid = false;
                params.reason += 'Tx type not yet activated ';
            }

            const is = await Validity.isActivated(params.block,txid,3)
            console.log(is)
            if (!is) {
                params.valid = false;
                params.reason = 'Transaction type activated after tx';
            }
            

            const property = PropertyList.getPropertyData(params.propertyId)

            if (property==null) {
                params.valid = false;
                params.reason += 'Invalid property ID; ';
            }

            let has = await TallyMap.hasSufficientChannel(sender, params.propertyId, params.amount);
            console.log(JSON.stringify(has))
            if (!has.hasSufficient) {
                params.valid = true; // Adjust according to logic
                params.reason += ' Insufficient Tokens ';
                console.log('reducing tokens to available '+params.amount+' '+has.shortfall)
                params.amount -= has.shortfall;
            }

            if(!params.amount||params.amount==0||isNaN(params.amount)){
                params.valid = false;
                params.reason += 'Invalid amount'
            }

            if (!(Number.isInteger(params.satsExpected) && params.satsExpected >= 0)) {
                params.valid = true; // Maintain the transaction but log the issue
                params.reason += 'Invalid sats expected; ';
            }

            if (outputs.length == 0) {
                params.valid = false
                params.reason += 'No outputs; ';
                return
            }

            // Validate the payToAddress corresponds to the correct vOut
                const satsExpectedFloat = new BigNumber(params.satsExpected).dividedBy(100000000).decimalPlaces(8).toNumber()
                params.price = new BigNumber(satsExpectedFloat).dividedBy(params.amount).decimalPlaces(8).toNumber()
                if (params.satsDelivered < satsExpectedFloat) { // convert satsExpected to LTC
                    params.valid = true;
                    params.reason += `Received LTC (${params.satsDelivered}) is less than expected; `;
                    params.paymentPercent = new BigNumber(params.satsDelivered).dividedBy(params.satsExpected).dividedBy(100000000).decimalPlaces(8).toNumber()
                }else{
                    params.paymentPercent=100
                }
         
            if (!Number.isInteger(params.tokenOutput)) {
                params.valid = true;
                params.reason += 'tokenOutput not an integer';
                if(params.payToAddress == 0){params.tokenOutput = 1
                }else if(reference.length<3){params.tokenOutput=0
                }else{params.tokenOutput=3}

                params.tokenDeliveryAddress = reference.find(ref => ref.vout === params.tokenOutput);
            }

            console.log('Inside validate UTXO trade', JSON.stringify(params));
            return params;
        },

        // 4: Commit Token
        validateCommit: async (sender, params, txid) => {
            params.reason = '';
            params.valid = true;
            //console.log('inside validate commit '+JSON.stringify(params))
            if(params.ref){
                //console.log(params.ref)
                const outputs = await TxUtils.getTransactionOutputs(txid)

                let matchingOutput = null;
                //console.log(JSON.stringify(outputs)) 
                // Loop through the outputs array to find the one with the matching vout
                for (let i = 0; i < outputs.length; i++) {
                    //console.log('in the for '+i+' '+outputs[i].vout+' '+params.ref)
                    if (outputs[i].vout === Number(params.ref)) {
                        matchingOutput = outputs[i];
                        //console.log('match output '+matchingOutput)
                        break; // Exit loop once the matching output is found
                    }
                }
                
                if (matchingOutput) {
                    // Access the matching output's address and satoshis
                    params.channelAddress = matchingOutput.address;
                    console.log('params.channelAddress '+params.channelAddress)
                }else{
                    params.valid = false
                    params.reason += "No channel address detectable in payload or ref: output"
                }
            }

            if(params.channelAddress!=''){
                if(!validateAddress(params.channelAddress)){
                    const valid = TxUtils.validateAddressWrapper(params.channelAddress)
                    if(!valid.isvalid){
                        params.valid= false
                        params.reason = 'Destination address is not validly formed.'
                    }
                }
            }
            console.log('about to check tally for commit '+params.senderAddress+' '+params.propertyId+' '+params.amount)
            let hasSufficientBalance = await TallyMap.hasSufficientBalance(params.senderAddress, params.propertyId, params.amount)
            console.log('checking balance in commit '+JSON.stringify(hasSufficientBalance)+params.amount)
            // Check if the sender has sufficient balance
            if (hasSufficientBalance.hasSufficient==false){
                params.valid = false
                params.reason += 'Insufficient token balance for commitment';
            }

            const isAlreadyActivated = await activationInstance.isTxTypeActive(4);
            if(isAlreadyActivated==false){
                params.valid=false
                params.reason += 'Tx type not yet activated '
            }

            if(params.propertyId==2||params.propertyId==3){
                params.valid=false
                params.reason="Cannot trade vesting tokens"
            }

            const propertyData = await PropertyList.getPropertyData(params.propertyId)
            //console.log('getting propertyId in validate commit '+JSON.stringify(propertyData))
            if(propertyData==null){
                console.log('offending propertyId value '+params.propertyId)
                params.valid=false
                params.reason="Null returning for propertyData"
                return params
            }
                    // Whitelist validation logic
  
            const senderWhitelists = Array.isArray(propertyData.whitelistId) ? propertyData.whitelistId : [propertyData.whitelistId];
            var passes = false
            for (const whitelistId of senderWhitelists) {
                const senderWhitelisted = await ClearList.isAddressInClearlist(whitelistId, sender);
                if (senderWhitelisted) {
                    passes=true
                    break
                }
            }
           const admin = activationInstance.getAdmin()
           if(sender!=admin){
               let bans = await ClearList.getBanlist()
                if(bans==null){bans = bannedCountries}
                const senderCountryInfo = await ClearList.getCountryCodeByAddress(sender);
                if(params.propertyId == 1||params.propertyId == 2||params.propertyId == 3||params.propertyId == 4){
                      const isAcc = await ClearList.isAddressInClearlist(3,sender)
                    console.log('sender country info '+JSON.stringify(senderCountryInfo))
                    if ((!senderCountryInfo || bans.includes(senderCountryInfo.countryCode))&&!isAcc){
                    if(activationInstance.areActivationsAboveThreshold()){
                        params.valid = false;
                        params.reason += 'Sender cannot handle TL or TLI from a banned country or lacking country code attestation';
                        }
                    }
                }
            }

            const channelData =await Channels.getChannel(params.channelAddress)
            if (channelData) {
                console.log(JSON.stringify(channelData))
              const participants = channelData.participants;
              const commits = channelData.commits;

              // Check if both participants (A and B) are full
              const participantAFilled = participants.A && Object.keys(channelData.A).length > 0;
              const participantBFilled = participants.B && Object.keys(channelData.B).length > 0;

              // Check if sender is neither A nor B
              const senderIsParticipantA = participants.A === sender;
              const senderIsParticipantB = participants.B === sender;

              // Invalidate if both participants are full and sender is neither A nor B
            if (participantAFilled && participantBFilled && !senderIsParticipantA && !senderIsParticipantB) {
                isValid = false;
                reason = 'Both participants are full and the sender is not a participant, try making a new multisig.';
              }
            }

            if(!passes&&propertyData.whitelistId!=0){
             params.valid = false;
                    params.reason += `Sender address not listed in clearlist for the token`;
            }

             if (typeof params.payEnabled !== 'boolean') {
                params.valid = false;
                params.reason += 'payEnabled is not a boolean. ';
            }

            // Validate clearLists
            if (params.clearLists) {
                const invalidClearListItems = params.clearLists.filter(num => !Number.isInteger(num));
                if (invalidClearListItems.length > 0) {
                    params.valid = false;
                    params.reason += 'clearLists contains non-integer values. ';
                }
            }

            return params;
        },

        // 5: On-chain Token for Token
        validateOnChainTokenForToken: async (sender, params, txid) => {
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

            const is = await Validity.isActivated(params.block,txid,5)
            console.log(is)
            if (!is) {
                params.valid = false;
                params.reason = 'Transaction type activated after tx';
            }

            const isVEST= (parseInt(params.propertyIdDesired)==2||parseInt(params.propertyIdOffered)==2||parseInt(params.propertyIdDesired)==3||parseInt(params.propertyIdOffered)==3)
            if(isVEST){
                params.valid =false
                params.reason += "Vesting tokens cannot be traded"
            }

            if(params.propertyIdOffered==params.propertyIdDesired){
                params.valid =false
                params.reason += "Cannot trade token against its own type"
            }
            const admin = activationInstance.getAdmin()
            console.log('admin '+admin)
            if(sender!=admin){
                let bans = await ClearList.getBanlist()
                if(bans==null){bans = bannedCountries}
                const senderCountryInfo = await ClearList.getCountryCodeByAddress(sender);
                if(params.propertyIdOffered == 1||params.propertyIdOffered == 4||params.propertyIdDesired == 1||params.propertyIdDesired == 4){
                    const isAcc = await ClearList.isAddressInClearlist(3,sender)
                    console.log('sender country info '+JSON.stringify(senderCountryInfo))
                    if ((!senderCountryInfo || bans.includes(senderCountryInfo.countryCode))&&!isAcc){
                    params.valid = false;
                    params.reason += 'Sender cannot handle TL or TLI from a banned country or lacking country code attestation';
                    }
                }
            }

            const TallyMap = require('./tally.js')
            const hasSufficientBalance = await TallyMap.hasSufficientBalance(sender, params.propertyIdOffered, params.amountOffered);
            if (!hasSufficientBalance.hasSufficient) {
                params.valid = false;
                params.reason += 'Insufficient balance for offered token; ';
            }
            console.log('inside validate commit '+params.propertyIdDesired+' '+params.propertyIdOffered)
            const propertyData1 = await PropertyList.getPropertyData(params.propertyIdDesired)
            const propertyData2 = await PropertyList.getPropertyData(params.propertyIdOffered)

                    // Whitelist validation logic
            if(propertyData1==null||propertyData2==null){
                 console.log('offending propertyId value '+params.propertyIdDesired,params.propertyIdOffered)
                params.valid = false
                params.reason += 'Null returning for propertyData'
                return params
            }

            const senderWhitelists = Array.isArray(propertyData1.whitelistId) ? propertyData1.whitelistId : [propertyData1.whitelistId];
            const desiredLists = Array.isArray(propertyData2.whitelistId) ? propertyData2.whitelistId : [propertyData2.whitelistId];

            var passes1 = false
            for (const whitelistId of senderWhitelists) {
                const senderWhitelisted = await ClearList.isAddressInClearlist(whitelistId, sender);
                if (senderWhitelisted) {
                    passes1 = true
                    break
                }
            }
            if(!passes1&&propertyData1.whitelistId!=0&&propertyData2.whitelistId!=0){
                    params.valid = false;
                    params.reason += `Sender address not listed in clearlist for offered token `;
            }
             
            var passes2 = false

            for (const whitelistId of desiredLists) {
                const recipientWhitelisted = await ClearList.isAddressInClearlist(whitelistId, sender);
                if (recipientWhitelisted) {
                    passes2 = true
                    break
                }
            }
            if(!passes2&&propertyData1.whitelistId!=0&&propertyData2.whitelistId!=0){
                    params.valid = false;
                    params.reason += `Trader address not listed in clearlist `;
            }

            return params;
        },

        
        // 6: Cancel Order
        validateCancelOrder: async (sender, params, txid) => {
            params.reason = '';
            params.valid = true;
            let key
            //console.log('validating cancel order '+JSON.stringify(params), sender, txid)
            const isAlreadyActivated = await activationInstance.isTxTypeActive(6);
            if (!isAlreadyActivated) {
                params.valid = false;
                params.reason += 'Tx type not yet activated ';
            }

            const is = await Validity.isActivated(params.block,txid,6)
            console.log(is)
            if (!is) {
                params.valid = false;
                params.reason = 'Transaction type activated after tx';
            }

            if (!(typeof sender === 'string')) {
                params.valid = false;
                params.reason += 'Invalid from address; ';
            }

            if(params.offeredPropertyId==2||params.offeredPropertyId==3||params.desiredPropertyId==2||params.desiredPropertyId==3){
                params.valid = false
                params.reason += "Cannot have orderbooks for untradeable vesting tokens"
            }

            if(params.isContract==false){
                key = params.offeredPropertyId+'-'+params.desiredPropertyId
                // Validate offered property ID
                if (params.offeredPropertyId && Number.isInteger(params.offeredPropertyId)) {
                    const propertyExists = await PropertyList.getPropertyData(params.offeredPropertyId);
                    if (!propertyExists) {
                        params.valid = false;
                        params.reason += 'Invalid offered property ID; ';
                    }
                } else {
                    params.valid = false;
                    params.reason += 'Invalid offered property ID; ';
                }

                // Validate desired property ID
                if (params.desiredPropertyId && Number.isInteger(params.desiredPropertyId)) {
                    const propertyExists = await PropertyList.getPropertyData(params.desiredPropertyId);
                    if (!propertyExists) {
                        params.valid = false;
                        params.reason += 'Invalid desired property ID; ';
                    }
                } else {
                    params.valid = false;
                    params.reason += 'Invalid desired property ID; ';
                }
            }

            if (params.isContract) {
                key= params.offeredPropertyId
                //console.log('cancelling contract order '+JSON.stringify(params) + '')
                // Check the validity of the contract ID
                if (params.offeredPropertyId && Number.isInteger(params.offeredPropertyId)) {
                    console.log('calling get contract Info in validate cancel'+params.block)
                    const contractExists = await ContractRegistry.getContractInfo(params.offeredPropertyId);
                    console.log('checking contract data for isContract cancel '+params.offeredPropertyId+' '+JSON.stringify(contractExists))
                    if (!contractExists) {
                        params.valid = false;
                        params.reason += 'Invalid contract ID; ';
                    }
                } else {
                    params.valid = false;
                    params.reason += 'Invalid contract ID; ';
                }
            }

            // Check if the sender has orders in the relevant orderbook
            const orderbook = await Orderbook.getOrderbookInstance(key)
            let senderOrders

            if(params.isContract){
                senderOrders = orderbook.getOrdersForAddress(params.fromAddress, params.contractId);
            }else{
                senderOrders = orderbook.getOrdersForAddress(params.fromAddress, null, params.offeredPropertyId, params.desiredPropertyId)
            }

            if (senderOrders.length === 0) {
                params.valid = false;
                params.reason += 'No orders found for the sender in the relevant orderbook; ';
            }

            if (!(typeof params.cancelParams === 'object')) {
                params.valid = false;
                params.reason += 'Invalid cancel parameters; ';
            } else {
                if (params.cancelParams.price && typeof params.cancelParams.price !== 'number') {
                    params.valid = false;
                    params.reason += 'Invalid price parameter; ';
                }

                if (params.cancelParams.side && !['buy', 'sell'].includes(params.cancelParams.side)) {
                    params.valid = false;
                    params.reason += 'Invalid side parameter; ';
                }

                if (params.cancelParams.txid) {
                    params.valid = false;
                    params.reason += 'TxId parameter deprecated for now. ; ';
                }
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

            const is = await Validity.isActivated(params.block,txid,7)
            console.log(is)
            if (!is) {
                params.valid = false;
                params.reason = 'Transaction type activated after tx';
            }

            if (!(params.backupAddress && typeof params.backupAddress === 'string')) {
                params.valid = false;
                params.reason += 'Invalid backup address; ';
            }

            if(!validateAddress(params.backupAddress)){
                const valid = await TxUtils.validateAddressWrapper(params.backupAddress)
                if(!valid.isValid){
                    params.valid= false
                    params.reason = 'Destination address is not validly formed.'
                }
            }

            if (!(typeof params.name === 'string')) {
                params.valid = false;
                params.reason += 'Invalid name; ';
            }

            return params;
        },

        validateUpdateAdmin: async (sender, params, txid) => {
                params.reason = '';
                params.valid = true;

                const isAlreadyActivated = await activationInstance.isTxTypeActive(8);
                if (!isAlreadyActivated) {
                    params.valid = false;
                    params.reason += 'Tx type not yet activated; ';
                }

                const is = await Validity.isActivated(params.block,txid,8)
                console.log(is)
                if (!is) {
                    params.valid = false;
                    params.reason = 'Transaction type activated after tx';
                }

                if (!(typeof params.newAddress === 'string')) {
                    params.valid = false;
                    params.reason += 'Invalid new address; ';
                }

                // Validate admin based on the type
                if (params.whitelist) {
                    const whitelistInfo = await ClearList.getList(params.id);
                    if (whitelistInfo.adminAddress !== sender||whitelistInfo.backupAddress!==sender) {
                        params.valid = false;
                        params.reason += 'Sender is not the admin of the whitelist; ';
                    }
                }

                if(params.oracle) {
                    const admin = await OracleList.isAdmin(sender, params.id);
                    if (!oracleInfo || oracleInfo.adminAddress !== sender||oracleInfo.backupAddress!==sender) {
                        params.valid = false;
                        params.reason += 'Sender is not the admin of the oracle; ';
                    }
                }

                if(params.token) {
                    const tokenInfo = await PropertyList.getPropertyData(params.id)
                    if (tokenInfo.issuer !== sender||tokenInfo.backupAddress!==sender){
                        params.valid = false;
                        params.reason += 'Sender is not the admin of the token;' 
                    }

                    if(tokenInfo.type!==2){
                        params.valid = false
                        params.reason += "Not a managed token with a usable admin address"
                    }
                }

                if(!validateAddress(params.newAddress)){
                const valid = await TxUtils.validateAddressWrapper(params.newAddress)
                if(!valid.isvalid){
                    params.valid= false
                    params.reason = 'Destination address is not validly formed.'
                }
            }

                return params;
            },

        // 9: Issue Attestation
       validateIssueOrRevokeAttestation: async (sender, params, txid) => {
            params.reason = '';
            params.valid = true;

            const isAlreadyActivated = await activationInstance.isTxTypeActive(9);
            if (!isAlreadyActivated) {
                params.valid = false;
                params.reason += 'Tx type not yet activated; ';
            }

            const is = await Validity.isActivated(params.block,txid,9)
            console.log(is)
            if (!is) {
                params.valid = false;
                params.reason = 'Transaction type activated after tx';
            }

            if (typeof params.targetAddress !== 'string') {
                params.valid = false;
                params.reason += 'Invalid target address; ';
            }

            // Fetch the clearlistId from params or wherever it's stored
            const clearlistId = params.id;

            // Assuming ClearList or an equivalent instance is available
            console.log('this clearlist id' +clearlistId)
            const clearlist = await ClearList.getClearlistById(clearlistId); // Implement this method as per your clearlist management logic
            console.log('testing logic in attest validity '+Boolean(!clearlist)+Boolean(clearlistId!=0))
            if (!clearlist&&clearlistId!=0) {
                params.valid = false;
                params.reason += `Clearlist with ID ${clearlistId} not found; `;
            } else if(clearlistId!=0){
                // Check if the sender matches the admin address of the clearlist
                if (sender !== clearlist.adminAddress) {
                    params.valid = false;
                    params.reason += `Sender ${sender} is not authorized to issue or revoke attestations for clearlist ${clearlistId}; `;
                }
            }
            console.log('params in validate attestation '+sender+' '+params.targetAddress)
            if(sender!=params.targetAddress&&clearlistId==0){
                    params.valid = false;
                    params.reason += `Sender and target address must be the same for self-cert (clearlist id 0) `;
            }

            if(params.revoke==true&&!ClearList.isAddressInClearlist(params.targetAddress)){
                    params.valid = false;
                    params.reason += `Target Address has no attestation to revoke `;
            }

            // Additional validation logic can be added here

            return params;
        },


        // 10: AMM Pool Attestation
        validateAMMPool: async (sender, params, txid) => {
            params.reason = '';
            params.valid = true;

            const isAlreadyActivated = await activationInstance.isTxTypeActive(10);
            if(isAlreadyActivated==false){
                params.valid=false
                params.reason += 'Tx type not yet activated '
            }
            const admin = activationInstance.getAdmin()
            console.log('admin '+admin)
            if(sender!=admin){
                let bans = await ClearList.getBanlist()
                if(bans==null){bans = bannedCountries}
                const senderCountryInfo = await ClearList.getCountryCodeByAddress(sender);
                if(params.Id1 == 1||params.Id1 == 2||params.Id1 == 3||params.propertyIdDesired == 4||params.Id2 == 1||params.Id2 == 2||params.Id2 == 3||params.Id2 == 4){
                     if (!senderCountryInfo || bans.includes(senderCountryInfo.countryCode)) {
                    params.valid = false;
                    params.reason += 'Sender cannot handle TL or TLI from a banned country or lacking country code attestation';
                     }
                }
            }

            const is = await Validity.isActivated(params.block,txid,10)
            console.log(is)
            if (!is) {
                params.valid = false;
                params.reason = 'Transaction type activated after tx';
            }

            if (!(typeof params.targetAddress === 'string')) {
                params.valid = false;
                params.reason += 'Invalid target address; ';
            }

             const propertyData1 = await PropertyList.getPropertyData(params.id)
            const propertyData2 = await PropertyList.getPropertyData(params.id2)

             if(propertyData1==2||propertyData1==3||propertyData2==2||propertyData2==3){
                params.valid=false
                params.reason="Cannot trade vesting tokens"
            }
                    // Whitelist validation logic
            const senderWhitelists = Array.isArray(propertyData1.whitelistId) ? propertyData1.whitelistId : [propertyData1.whitelistId];
            const desiredLists = Array.isArray(propertyData2.whitelistId) ? propertyData2.whitelistId : [propertyData2.whitelistId];

            var passes1 = false
            for (const whitelistId of senderWhitelists) {
                const senderWhitelisted = await ClearList.isAddressInClearlist(whitelistId, sender);
                if (senderWhitelisted) {
                    passes1 = true
                }
            }
            if(passes1){
                    params.valid = false;
                    params.reason += `Sender address not listed in clearlist for offered token ${whitelistId}; `;
            }
             
            var passes2 = false

            for (const whitelistId of desiredLists) {
                const recipientWhitelisted = await ClearList.isAddressInClearlist(whitelistId, sender);
                if (recipientWhitelisted) {
                    passes2 = true
                }
            }
            if(passes2){
                    params.valid = false;
                    params.reason += `Trader address not listed in clearlist ${whitelistId}; `;
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

            if(!validateAddress(params.addressToGrantTo)){
                const valid = await TxUtils.validateAddressWrapper(params.addressToGrantTo)
                if(!valid.isvalid){
                    params.valid= false
                    params.reason = 'Destination address is not validly formed.'
                }
            }

            const is = await Validity.isActivated(params.block,txid,11)
            console.log(is)
            if (!is) {
                params.valid = false;
                params.reason = 'Transaction type activated after tx';
            }

            const isManagedProperty = PropertyList.isManagedAndAdmin(params.propertyId);
            if (!isManagedProperty) {
                params.valid = false;
                params.reason += 'Property is not of managed type or admin does not match';
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

            const is = await Validity.isActivated(params.block,txid,12)
            console.log(is)
            if (!is) {
                params.valid = false;
                params.reason = 'Transaction type activated after tx';
            }

            const isPropertyAdmin = PropertyList.isAdmin(params.senderAddress, params.propertyId);
            if (!isPropertyAdmin) {
                params.valid = false;
                params.reason += 'Sender is not admin of the property; ';
            }

            const isManagedProperty = PropertyList.isManagedProperty(params.propertyId);
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

            const is = await Validity.isActivated(params.block,txid,13)
            console.log(is)
            if (!is) {
                params.valid = false;
                params.reason = 'Transaction type activated after tx';
            }

            return params;
        },

        // 14: Publish Oracle Data
        validatePublishOracleData: async (sender, params, txid) => {
            params.reason = '';
            params.valid = await OracleList.isAdmin(sender, params.oracleId);
            console.log('is oracle admin '+params.valid + ' ' + params.oracleId)
            if (params.valid==false) {
                params.reason = 'Sender is not admin of the specified oracle; ';
            }

            const isAlreadyActivated = await activationInstance.isTxTypeActive(14);
            if(isAlreadyActivated==false){
                params.valid=false
                params.reason += 'Tx type not yet activated '
            }

            const is = await Validity.isActivated(params.block,txid,14)
            console.log(is)
            if (!is) {
                params.valid = false;
                params.reason = 'Transaction type activated after tx';
            }
                // Retrieve the oracle instance using its ID
                const oracle = await OracleList.getOracleInfo(params.oracleId);
                if (!oracle) {
                    params.valid = false
                    params.reason += 'Oracle not found; ';
                }

            return params;
        },

        // 15: Close Oracle
        validateCloseOracle: async (sender, params, txid) => {
            params.reason = '';
            params.valid = OracleList.isAdmin(sender, params.oracleId);
            if (!params.valid) {
                params.reason = 'Sender is not admin of the specified oracle; ';
            }
            const isAlreadyActivated = await activationInstance.isTxTypeActive(15);
            if(isAlreadyActivated==false){
                params.valid=false
                params.reason += 'Tx type not yet activated '
            }

            const is = await Validity.isActivated(params.block,txid,14)
            console.log(is)
            if (!is) {
                params.valid = false;
                params.reason = 'Transaction type activated after tx';
            }

            return params;
        },

        //16: Create Contracts
        validateCreateContractSeries: async (sender, params, txid) => {
            params.valid = true;
            params.reason = '';

            // Check if the underlyingOracleId exists or is null
            if (params.native === false) {
                const validOracle = await OracleList.getOracleInfo(params.underlyingOracleId) !== null;
                if (!validOracle) {
                    params.valid = false;
                    params.reason += "Invalid or missing underlying oracle ID. ";
                }
            }

            const isAlreadyActivated = await activationInstance.isTxTypeActive(16);
            if(isAlreadyActivated==false){
                params.valid=false
                params.reason += 'Tx type not yet activated '
            }

            const is = await Validity.isActivated(params.block,txid,16)
            console.log(is)
            if (!is) {
                params.valid = false;
                params.reason = 'Transaction type activated after tx';
            }

             // Check if collateralPropertyId is a valid existing propertyId
            const validCollateralProperty = await PropertyList.getPropertyData(params.collateralPropertyId) !== null;
            if (!validCollateralProperty) {
                params.valid = false;
                params.reason += "Invalid collateral property ID. ";
            }

            // On-Chain Data Validation
            if (params.native === true && params.onChainData) {
                let validNatives = true;

                let isDuplicate = await ContractRegistry.isDuplicateNativeContract(params.collateralPropertyId,params.onChainData, params.notionalPropertyId)
                console.log('is dupe ' +isDuplicate)
                if(isDuplicate){
                    params.valid = false;
                    params.reason += "Collateral or on-chain pair is redundant.";
                }

                for (const pid of params.onChainData) {
                    let propertyData1 = PropertyList.getPropertyData(pid[0])
                    let propertyData2 = PropertyList.getPropertyData(pid[1])
                    console.log('validating propertyids '+pid)
                    if (pid[0] !== null && propertyData1==null) {
                        validNatives = false;
                        break;
                    }
                    if (pid[1] !== null && propertyData2==null) {
                        validNatives = false;
                        break;
                    }
                }
                if (!validNatives) {
                    params.valid = false;
                    params.reason += "Invalid on-chain data format or property IDs. ";
                }
                if(params.onChainData.length==0){
                    params.valid = false;
                    params.reason += "Array of on-chain pairs for native settlement data is empty.";
                }
            }

            const isVEST= (parseInt(params.collateralPropertyId)==2&&parseInt(params.notionalPropertyId)==2||parseInt(params.collateralPropertyId)==3)
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

            if (!params.valid) {
                console.log(`Contract series validation failed: ${params.reason}`);
            }

            return params;
        },


        // 17: Exercise Derivative
        validateExerciseDerivative: async (sender, params, txid) => {
            params.reason = '';
            params.valid = true;

            const isAlreadyActivated = await activationInstance.isTxTypeActive(17);
            if(isAlreadyActivated==false){
                params.valid=false
                params.reason += 'Tx type not yet activated '
            }

            const is = await Validity.isActivated(params.block,txid,17)
            console.log(is)
            if (!is) {
                params.valid = false;
                params.reason = 'Transaction type activated after tx';
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
        validateTradeContractOnchain: async (sender, params, txid) => {
            params.reason = '';
            params.valid = true;
            console.log('validating contract trade '+JSON.stringify(params))
            const isAlreadyActivated = await activationInstance.isTxTypeActive(18);
            if(isAlreadyActivated==false){
                params.valid=false
                params.reason += 'Tx type not yet activated '
            }

            const is = await Validity.isActivated(params.block,txid,18)
            console.log(is)
            if (!is) {
                params.valid = false;
                params.reason = 'Transaction type activated after tx';
            }

            console.log('calling get contract Info in validate trade'+params.contractId)
            const contractDetails = await ContractRegistry.getContractInfo(params.contractId);
            console.log('checking contract details validity ' + JSON.stringify(contractDetails))
            if(contractDetails==null||contractDetails=={}){
                params.valid=false
                params.reason+= "contractId not found"
                return params
            }
            const admin = activationInstance.getAdmin()
            console.log('admin '+admin)
            if(sender!=admin){
                let bans = await ClearList.getBanlist()
                if(bans==null){bans = bannedCountries}
                const senderCountryInfo = await ClearList.getCountryCodeByAddress(sender);
                if (!senderCountryInfo || bans.includes(senderCountryInfo.countryCode)) {
                    params.valid = false;
                    params.reason += 'Sender cannot trade contracts from a banned country or lacking country code attestation'; 
                }
            }

            const MarginMap = require('./marginMap.js')
            const marginMap = await MarginMap.loadMarginMap(params.contractId);
            console.log(params.contractId, params.price)
            const initialMarginPerContract = await ContractRegistry.getInitialMargin(params.contractId, params.price);
            console.log('init margin '+initialMarginPerContract)
            const amountBN = new BigNumber(params.amount);
            let totalInitialMargin = BigNumber(initialMarginPerContract).times(amountBN).toNumber();

            const existingPosition = await marginMap.getPositionForAddress(sender, params.contractId);
            // Determine if the trade reduces the position size for buyer or seller
            const isBuyerReducingPosition = Boolean(existingPosition.contracts > 0 &&params.side==false);
            const isSellerReducingPosition = Boolean(existingPosition.contracts < 0 && params.side==true);

            if(isBuyerReducingPosition==false&&isSellerReducingPosition==false){

                // Check if the sender has enough balance for the initial margin
                console.log('about to call hasSufficientBalance in validateTradeContractOnchain '+sender, contractDetails.collateralPropertyId, totalInitialMargin)
                const hasSufficientBalance = await TallyMap.hasSufficientBalance(sender, contractDetails.collateralPropertyId, totalInitialMargin);
                if (hasSufficientBalance.hasSufficient==false) {
                    console.log('Insufficient balance for initial margin');
                    params.valid=false
                    params.reason+= "Insufficient balance for initial margin"
                }
            }

             const isBuyerFlippingPosition =  Boolean(params.amount>Math.abs(existingPosition.contracts)&&existingPosition.contracts<0&&params.side==true)
             const isSellerFlippingPosition = Boolean(params.amount>existingPosition.contracts&&existingPosition.contracts>0&&params.side==false)           

             let flipLong = 0 
             let flipShort = 0

             if(isBuyerFlippingPosition){
                flipLong=params.amount-Math.abs(existingPosition.contracts)
                totalInitialMargin = BigNumber(initialMarginPerContract).times(flipLong).toNumber();
             }else if(isSellerFlippingPosition){
                flipShort=params.amount-existingPosition.contracts
                totalInitialMargin = BigNumber(initialMarginPerContract).times(flipShort).toNumber();
             }
             hasSufficientBalance = await TallyMap.hasSufficientBalance(params.senderAddress, contractDetails.collateralPropertyId, totalInitialMargin)
             if(hasSufficientBalance.hasSufficient==false){
                 let contractUndo = BigNumber(hasSufficientBalance.shortfall)
                                    .dividedBy(initialMarginPerContract)
                                    .decimalPlaces(0, BigNumber.ROUND_CEIL)
                                    .toNumber();

                params.amount -= contractUndo;
             }

            const collateralPropertyId = contractDetails.collateralPropertyId;
            console.log('clearlist id '+contractDetails.whitelist)
            if(collateralPropertyId!=1&&contractDetails.whitelist!=undefined&&contractDetails.whitelist!=0&&contractDetails.whitelist!=null){
                console.log(collateralPropertyId)
                       // Get property data for the collateralPropertyId
                const collateralPropertyData = await PropertyList.getPropertyData(collateralPropertyId);
                if (collateralPropertyData == null || collateralPropertyData == undefined) {
                    params.valid = false;
                    params.reason += 'Collateral propertyId not found in Property List; ';
                }
                
                // Extract whitelist IDs from the collateral property data
                const senderWhitelists = Array.isArray(collateralPropertyData.whitelistId) ? collateralPropertyData.whitelistId : [collateralPropertyData.whitelistId];
                 // Check if the sender address is in the whitelists
                var listed = false
                for (const whitelistId of senderWhitelists) {
                    const senderWhitelisted = await ClearList.isAddressInClearlist(whitelistId, sender);
                    if (senderWhitelisted) {
                        listed=true
                        break; // No need to check further if one fails
                    }
                }
                if(!listed){
                    params.valid = false;
                    params.reason += `Sender address not in clearlist; `;
                }
            }
            console.log('finished contract trade params '+params.valid+' '+params.reason)
            return params;
        },

        // 19: Trade Contract Channel
        validateTradeContractChannel: async (sender, params,txid) => {
            params.reason = '';
            params.valid = true;

            const isAlreadyActivated = await activationInstance.isTxTypeActive(19);
            if(isAlreadyActivated==false){
                params.valid=false
                params.reason += 'Tx type not yet activated '
            }

            const is = await Validity.isActivated(params.block,txid,19)
            console.log(is)
            if (!is) {
                params.valid = false;
                params.reason = 'Transaction type activated after tx';
            }

            if(params.expiryBlock<params.block||params.expiryBlock==undefined){
                params.valid=false
                params.reason = "Tx confirmed in block later than expiration block"
                return params
            }

            const channel = await Channels.getChannel(sender)
            console.log('checking inside validate validateTradeContractChannel '+JSON.stringify(params))
            const { commitAddressA, commitAddressB } = await Channels.getCommitAddresses(sender);
            if(commitAddressA==null&&commitAddressB==null){
                params.valid=false
                params.reason = "Tx sender is not found to be a channel address"
                console.log('exiting contract channel validity for lack of commit addr '+JSON.stringify(params))
                return params
            }
            const admin = activationInstance.getAdmin()
            if(sender!=admin){
                let bans = await ClearList.getBanlist()
                if(bans==null){bans = bannedCountries}
                const senderCountryInfo = await ClearList.getCountryCodeByAddress(commitAddressA);
                if (!senderCountryInfo || bans.includes(senderCountryInfo.countryCode)) {
                    params.valid = false;
                    params.reason += 'Commiter A cannot handle TL or TLI from a banned country or lacking country code attestation';
                }
                const BCountryInfo = await ClearList.getCountryCodeByAddress(commitAddressB);
                if (!BCountryInfo || bans.includes(BCountryInfo.countryCode)) {
                    params.valid = false;
                    params.reason += 'Commiter B cannot handle TL or TLI from a banned country or lacking country code attestation';
                }
            }
            
            
            console.log('calling get contract Info in validate channel trade'+params.block)
            const contractDetails = await ContractRegistry.getContractInfo(params.contractId);
            const collateralPropertyId = contractDetails.collateralPropertyId
            if(!contractDetails){
                params.valid=false
                params.reason = "ContractId not found"
                console.log('exiting contract channel validity for lack of contractId '+JSON.stringify(params))
                return params
            }
            console.log(JSON.stringify(contractDetails))
            const collateralIdString = contractDetails.collateralPropertyId.toString()
            const balanceA = channel.A[collateralIdString]
            const balanceB = channel.B[collateralIdString]
            console.log('checking our channel info is correct: A'+balanceA+' B '+balanceB+' commitAddrA '+commitAddressA+' commitAddrB '+commitAddressB)
            const initialMarginPerContract = await ContractRegistry.getInitialMargin(params.contractId, params.price);
            
            let totalInitialMargin = BigNumber(initialMarginPerContract).times(params.amount).toNumber();
            
            const marginMap = await MarginMap.getInstance(params.contractId)
            const existingPositionA = await marginMap.getPositionForAddress(commitAddressA, params.contractId);
            const existingPositionB = await marginMap.getPositionForAddress(commitAddressB, params.contractId);
            // Determine if the trade reduces the position size for buyer or seller
            let AIsSeller
            let isBuyerReducingPosition 
            let isSellerReducingPosition 
            if(params.columnAIsSeller==true||params.columnAIsSeller==1||params.columnAIsSeller=="1"){
                AIsSeller==true
                isBuyerReducingPosition= Boolean(existingPositionB.contracts > 0);
                isSellerReducingPosition = Boolean(existingPositionA.contracts<0)
            }else{
                AIsSeller==false
                isBuyerReducingPosition= Boolean(existingPositionA.contracts > 0);
                isSellerReducingPosition = Boolean(existingPositionB.contracts<0)
            }

                        let enoughMargin
            if (isBuyerReducingPosition == false && isSellerReducingPosition == false) {
                // Check if the sender has enough balance for the initial margin
                enoughMargin = balanceA >= totalInitialMargin && balanceB >= totalInitialMargin;
                if (enoughMargin == false) {
                    console.log('Insufficient balance for initial margin');
                    params.valid = false;
                    params.reason += "Insufficient balance for initial margin on both sides";
                }
            } else if (isBuyerReducingPosition == true && isSellerReducingPosition == false) {
                if (AIsSeller == true) {
                    enoughMargin = balanceA >= totalInitialMargin;
                } else {
                    enoughMargin = balanceB >= totalInitialMargin;
                }
                if (enoughMargin == false) {
                    console.log('Insufficient balance for initial margin');
                    params.valid = false;
                    params.reason += "Insufficient balance for initial margin on sellSide";
                }
            } else if (isBuyerReducingPosition == false && isSellerReducingPosition == true) {
                if (AIsSeller == true) {
                    enoughMargin = balanceB >= totalInitialMargin;
                } else {
                    enoughMargin = balanceA >= totalInitialMargin;
                }
                if (enoughMargin == false) {
                    console.log('Insufficient balance for initial margin');
                    params.valid = false;
                    params.reason += "Insufficient balance for initial margin on buySide";
                }
            }

             let isBuyerFlippingPosition              
             let isSellerFlippingPosition 
           
             if(AIsSeller==true){
                isBuyerFlippingPosition =  Boolean(params.amount>Math.abs(existingPositionB.contracts)&&existingPositionB.contracts<0)
                isSellerFlippingPosition = Boolean(params.amount>existingPositionA.contracts&&existingPositionA.contracts>0)           
             }else{
                isBuyerFlippingPosition =  Boolean(params.amount>Math.abs(existingPositionA.contracts)&&existingPositionA.contracts<0)
                isSellerFlippingPosition = Boolean(params.amount>existingPositionB.contracts&&existingPositionB.contracts>0)           
             }

             let flipLong = 0 
             let flipShort = 0
             let AFlipLong
             let BFlipLong
             let AFlipShort
             let BFlipShort
             let totalInitialMarginFlip = 0 
             if(isBuyerFlippingPosition&&AIsSeller){
                flipLong=params.amount-Math.abs(existingPositionB.contracts)
                totalInitialMarginFlip = BigNumber(initialMarginPerContract).times(flipLong).toNumber();
                BFlipLong = true
             }else if(isSellerFlippingPosition&&AIsSeller){
                flipShort=params.amount-existingPositionA.contracts
                totalInitialMarginFlip = BigNumber(initialMarginPerContract).times(flipShort).toNumber();
                AFlipShort = true
             }else if(isBuyerFlippingPosition&&!AIsSeller){
                flipLong=params.amount-Math.abs(existingPositionA.contracts)
                totalInitialMargin = BigNumber(initialMarginPerContract).times(flipLong).toNumber();
                AFlipLong= true
             }else if(isSellerFlippingPosition&&!AIsSeller){
                flipShort=params.amount-existingPositionB.contracts
                totalInitialMargin = BigNumber(initialMarginPerContract).times(flipShort).toNumber();
                BFlipShort=true
             }

             let tallyA = await TallyMap.getTally(commitAddressA,collateralPropertyId)
             let tallyB = await TallyMap.getTally(commitAddressB,collateralPropertyId)

             if((balanceA<(flipLong*initialMarginPerContract)&&AFlipLong==true)
                ||(balanceA<(flipShort*initialMarginPerContract)&&AFlipShort==true)
                ||(balanceB<(flipLong*initialMarginPerContract)&&BFlipLong==true)
                ||(balanceB<(flipShort*initialMarginPerContract)&&BFlipShort==true)){
                    let shortfall
                    let doubleFlip = Boolean((AFlipLong&&BFlipShort)||(BFlipLong&&AFlipShort))
                    let shortfall2
                    if(AFlipLong){
                        shortfall==flipLong*initialMarginPerContract-(balanceA+tallyA.available)
                    }
                    if(AFlipShort){
                        shortfall==flipShort*initialMarginPerContract-(balanceA+tallyA.available)
                    }
                    if(BFlipShort){
                        if(doubleFlip){
                            shortfall2=flipLong*initialMarginPerContract-(balanceA+tallyA.available)
                        }
                        shortfall==flipShort*initialMarginPerContract-(balanceB+tallyB.available)
                    }
                    if(BFlipLong){
                        if(doubleFlip){
                            shortfall2=flipShort*initialMarginPerContract-(balanceA+tallyA.available)
                        }
                        shortfall==flipLong
                    }
                    if(doubleFlip){
                        shortfall=Math.max(shortfall,shortfall2)
                    }
                 let contractUndo = BigNumber(shortfall)
                                    .dividedBy(initialMarginPerContract)
                                    .decimalPlaces(0, BigNumber.ROUND_CEIL)
                                    .toNumber();

                params.amount -= contractUndo;
             }

            /*const isAddressAWhitelisted = contractDetails.type === 'oracle' ? await whitelistRegistry.isAddressWhitelisted(commitAddressA, contractDetails.oracleId) : true;
            if (!isAddressAWhitelisted) {
                params.valid = false;
                params.reason += 'Commit address A not whitelisted; ';
            }

            const isAddressBWhitelisted = contractDetails.type === 'oracle' ? await whitelistRegistry.isAddressWhitelisted(commitAddressB, contractDetails.oracleId) : true;
            if (!isAddressBWhitelisted) {
                params.valid = false;
                params.reason += 'Commit address B not whitelisted; ';
            }*/
            console.log('finishing validated channel contract '+JSON.stringify(params))

            return params;
        },

        // 20: Trade Tokens Channel
        validateTradeTokensChannel: async (sender, params, txid) => {
            params.reason = '';
            params.valid = true;
            console.log('inside validateTradeTokensChannel '+JSON.stringify(params))
            const isAlreadyActivated = await activationInstance.isTxTypeActive(20);
            if(isAlreadyActivated==false){
                params.valid=false
                params.reason += 'Tx type not yet activated '
                return params
            }

            const is = await Validity.isActivated(params.block,txid,20)
            console.log(is)
            if (!is) {
                params.valid = false;
                params.reason = 'Transaction type activated after tx';
            }

            console.log(params.expiryBlock,params.block)
            if(params.expiryBlock<params.block||params.expiryBlock==undefined){
                params.valid=false
                params.reason = "Tx confirmed in block later than expiration block"
                return params
            }

            const isVEST= (parseInt(params.propertyIdDesired)==2&&parseInt(params.propertyIdOffered)==2||parseInt(params.propertyIdDesired)==3&&parseInt(params.propertyIdOffered)==4)
            if(isVEST){
                params.valid =false
                params.reason += "Vesting tokens cannot be traded"
            }

            if(params.propertyIdOffered==params.propertyIdDesired&&(!params.Id1ColoredOutput&&!params.Id2ColoredOutput)){
                params.valid =false
                params.reason += "Cannot trade token against its own type"
            }

            const { commitAddressA, commitAddressB } = await Channels.getCommitAddresses(params.senderAddress);
            if(commitAddressA==null&&commitAddressB==null){
                params.valid=false
                params.reason += "Tx sender is not found to be a channel address"
                return params
            }
            const admin = activationInstance.getAdmin()
            console.log('admin in channel token '+admin)
            if(sender!=admin){
                let bans = await ClearList.getBanlist()
                if(bans==null){bans = bannedCountries}
                const senderCountryInfo = await ClearList.getCountryCodeByAddress(commitAddressA);
                if(params.propertyIdDesired == 1||params.propertyIdDesired == 2||params.propertyIdDesired == 3||params.propertyIdDesired == 4||params.propertyIdOffered == 1||params.propertyIdOffered == 2||params.propertyIdOffered == 3||params.propertyIdOffered == 4){
                    if(!activationInstance.areActivationsAboveThreshold()){
                          const isAcc = await ClearList.isAddressInClearlist(3,sender)
                    console.log('sender country info '+JSON.stringify(senderCountryInfo))
                    if ((!senderCountryInfo || bans.includes(senderCountryInfo.countryCode))&&!isAcc){
                            params.valid = false;
                            params.reason += 'Commiter A cannot handle TL or TLI from a banned country or lacking country code attestation';
                        }
                    }
                }
                 const BCountryInfo = await ClearList.getCountryCodeByAddress(commitAddressB);
                if(params.propertyIdDesired == 1||params.propertyIdDesired == 2||params.propertyIdDesired == 3||params.propertyIdDesired == 4||params.propertyIdOffered == 1||params.propertyIdOffered == 2||params.propertyIdOffered == 3||params.propertyIdOffered == 4){
                    if(!activationInstance.areActivationsAboveThreshold()){
                          const isAcc = await ClearList.isAddressInClearlist(3,sender)
                    console.log('sender country info '+JSON.stringify(senderCountryInfo))
                    if ((!BCountryInfo || bans.includes(BCountryInfo.countryCode))&&!isAcc){
                            params.valid = false;
                            params.reason += 'Commiter B cannot handle TL or TLI from a banned country or lacking country code attestation';
                        }
                    }
                }
            }


            const channel = await Channels.getChannel(sender)
            console.log('channel returned ' +JSON.stringify(channel))
            let balanceA
            let balanceB
            let propertyIdOfferedString = params.propertyIdOffered.toString()
            let propertyIdDesiredString = params.propertyIdDesired.toString()
            let sufficientOffered 
            let sufficientDesired
            if(params.columnAIsOfferer==true){
                balanceA = channel.A[propertyIdOfferedString]
                balanceB = channel.B[propertyIdDesiredString]
                const hasSufficientA = TallyMap.hasSufficientChannel(sender,params.propertyIdOffered,params.amountOffered)
                const hasSufficientB = TallyMap.hasSufficientChannel(sender,params.propertyIdDesired,params.amountDesired)

                console.log('validating token channel trade columnA is offerer'+balanceA+' '+balanceB+' '+channel.A+' '+channel.B)
                console.log('sufficient channel? '+JSON.stringify(hasSufficientA)+' '+JSON.stringify(hasSufficientB))
                if(balanceA<params.amountOffered||!hasSufficientA.hasSufficient){
                    params.valid=false
                    params.reason += "Column A has insufficient balance for amountOffered"
                }
                if(balanceB<params.amountDesired||!hasSufficientB.hasSufficient){
                    params.valid=false
                    params.reason += "Column B has insufficient balance for amountDesired"
                }
            }else if(params.columnAIsOfferer==false){
                balanceA = channel.A[propertyIdOfferedString]
                balanceB = channel.B[propertyIdDesiredString]

                const hasSufficientA = TallyMap.hasSufficientChannel(sender,params.propertyIdDesired,params.amountDesired)
                const hasSufficientB = TallyMap.hasSufficientChannel(sender,params.propertyIdOffered,params.amountOffered)

                console.log('validating token channel trade columnB is offerer'+balanceA+' '+balanceB+' '+channel.A+' '+channel.B)
                console.log('sufficient channel? '+JSON.stringify(hasSufficientA)+' '+JSON.stringify(hasSufficientB))
               
                if(balanceA<params.amountDesired||!hasSufficientA.hasSufficient){
                    params.valid=false
                    params.reason += "Column A has insufficient balance for amountDesired"
                }
                if(balanceB<params.amountOffered||!hasSufficientB.hasSufficient){
                    params.valid=false
                    params.reason += "Column B has insufficient balance for amountOffered"
                }
            }

        // Get property data for both propertyIdOffered and propertyIdDesired
        const propertyDataOffered = await PropertyList.getPropertyData(params.propertyIdOffered);
        const propertyDataDesired = await PropertyList.getPropertyData(params.propertyIdDesired);

        if (propertyDataOffered == null || propertyDataDesired == null) {
            params.valid = false;
            params.reason += 'Property data not found; ';
            return params;
        }

        const whitelistsOffered = Array.isArray(propertyDataOffered.whitelistId) ? propertyDataOffered.whitelistId : [propertyDataOffered.whitelistId];
        const whitelistsDesired = Array.isArray(propertyDataDesired.whitelistId) ? propertyDataDesired.whitelistId : [propertyDataDesired.whitelistId];

        // Skip whitelist checks if both properties have whitelistId of 0
        if (whitelistsOffered.includes(0) && whitelistsDesired.includes(0)) {
            console.log('Both properties have whitelistId 0, skipping whitelist checks.');
        } else {
            // Check whitelist for commitAddressA and commitAddressB
            let listed1 = true, listed2 = true, listed3 = true, listed4 = true;

            // Skip whitelist checks for offered if whitelistId is 0
            if (!whitelistsOffered.includes(0)) {
                listed1 = await isListed(whitelistsOffered, commitAddressA);
                listed3 = await isListed(whitelistsOffered, commitAddressB);
            }

            // Skip whitelist checks for desired if whitelistId is 0
            if (!whitelistsDesired.includes(0)) {
                listed2 = await isListed(whitelistsDesired, commitAddressA);
                listed4 = await isListed(whitelistsDesired, commitAddressB);
            }

            // If any of the checks fail, invalidate the params
            if (!listed1 || !listed2 || !listed3 || !listed4) {
                params.valid = false;
                if (!listed1) params.reason += 'Commit address A not whitelisted in clearlist for property offered; ';
                if (!listed2) params.reason += 'Commit address A not whitelisted in clearlist for property desired; ';
                if (!listed3) params.reason += 'Commit address B not whitelisted in clearlist for property offered; ';
                if (!listed4) params.reason += 'Commit address B not whitelisted in clearlist for property desired; ';
            }
        }
        return params;
    },

        // Helper function to check if an address is in the whitelist
    async isListed(whitelistIds, commitAddress) {
            for (const whitelistId of whitelistIds) {
                const isWhitelisted = await ClearList.isAddressInClearlist(whitelistId, commitAddress);
                if (isWhitelisted) return true;
            }
            return false;
        },

        // Function to perform whitelist checks
        async checkWhitelist(whitelists, commitAddress, propertyRole, params) {
            const listed = await isListed(whitelists, commitAddress);
            if (!listed) {
                params.valid = false;
                params.reason += `Commit address ${propertyRole} not whitelisted in clearlist; `;
            }
        },

        // 21: Withdrawal
        validateWithdrawal: async (sender, params, txid) => {
            params.reason = '';
            params.valid = true;

            const isAlreadyActivated = await activationInstance.isTxTypeActive(21);
            if(isAlreadyActivated==false){
                params.valid=false
                params.reason += 'Tx type not yet activated '
            }

            const is = await Validity.isActivated(params.block,txid,21)
            console.log(is)
            if (!is) {
                params.valid = false;
                params.reason = 'Transaction type activated after tx';
            }

            if(params.withdrawAll!=true&&(params.propertyId==null||params.amount==null)){
                params.valid=false
                params.reason += 'propertyId or amount not specified while withdrawAll is false'
       
            }

            const { commitAddressA, commitAddressB } = await Channels.getCommitAddresses(params.channelAddress);
          
            if (!commitAddressA&&!commitAddressB) {
                params.valid = false;
                params.reason += 'Channel not instantiated; ';
                return params
            }

            const channel = await Channels.getChannel(params.channelAddress)
            let isColumnA = params.column
            let balance 
            console.log('inside validate withdrawal '+sender+' '+Boolean(sender==channel.participants.A)+Boolean(sender==channel.participants.B))
            if (sender!=channel.participants.A&&sender!=channel.participants.B) {
                params.valid = false;
                params.reason += 'Sender not authorized for the channel';
            }else{
                if(sender==channel.participants.A){
                    isColumnA=true
                    balance=channel.A[params.propertyId]
                    console.log('column ' +params.column)
                    if(params.column==false){
                        params.valid = false;
                        params.reason += 'Sender does not match with column';
                    }
                }else if(sender==channel.participants.B){
                    console.log('checking this column disqualification logic works '+params.column)
                    isColumnA=false
                    balance=channel.B[params.propertyId]
                    if(params.column==true){
                        params.valid = false;
                        params.reason += 'Sender does not match with column';
                    }
                }
            }
            //if column is true then it's column B because 0 comes before 1 and A before B
            console.log('inside validate withdrawal '+params.column +'isColumnA '+isColumnA+' balance '+balance+' withdraw amount '+params.amount)
             if(params.column==undefined){
                params.valid = false
                params.reason+='column parameter not specified'
            }
            
            if (balance < params.amount) {
                 params.valid = false;
                params.reason += 'Insufficient balance for withdrawal; ';
            }

            return params;
        },

        // 22: Transfer
        validateTransfer: async (sender, params, txid) => {
            params.reason = '';
            params.valid = true;


            if(params.ref){
                const outputs = await TxUtils.getTransactionOutputs(txid)

                let matchingOutput = null;
                
                // Loop through the outputs array to find the one with the matching vout
                for (let i = 0; i < outputs.length; i++) {
                    if (outputs[i].vout === params.ref) {
                        matchingOutput = outputs[i];
                        break; // Exit loop once the matching output is found
                    }
                }
                
                if (matchingOutput) {
                    // Access the matching output's address and satoshis
                    params.toChannelAddress = matchingOutput.address;
                }else{
                    params.valid = false
                    params.reason += "No channel address detectable in payload or ref: output"
                }
            }

            const isAlreadyActivated = await activationInstance.isTxTypeActive(22);
            if(isAlreadyActivated==false){
                params.valid=false
                params.reason += 'Tx type not yet activated '
            }

            if(!validateAddress(params.toChannelAddress)){
                const valid = await TxUtils.validateAddressWrapper(params.toChannelAddress)
                if(!valid.isvalid){
                    params.valid= false
                    params.reason = 'Destination address is not validly formed.'
                }
            }

            const is = await Validity.isActivated(params.block,txid,22)
            console.log(is)
            if (!is) {
                params.valid = false;
                params.reason = 'Transaction type activated after tx';
            }

            const isValidSourceChannel = Channels.isValidChannel(sender);
            if (!isValidSourceChannel) {
                params.valid = false;
                params.reason += 'Invalid source channel; ';
            }

            //const { commitAddressA, commitAddressB } = await Channels.getCommitAddresses(sender)
            console.log('calling channel in validity for '+sender)
            const channel = await Channels.getChannel(sender)
            console.log(JSON.stringify(channel) +' '+Boolean(!channel))
            let balance =0 
            if(!channel){
                params.valid = false;
                params.reason += 'Sender is not a channel.';
            }else{
              const balanceA = channel.A[params.propertyId] || 0;
              const balanceB = channel.B[params.propertyId] || 0;

                let commiter = ''
               
                if(params.isColumnA){
                    balance= balanceA
                    commiter = channel.participants.A
                }else if(!params.isColumnA){
                    balance= balanceB
                    commiter = channel.participants.B
                }
                console.log(JSON.stringify(channel))
                console.log(balanceA,balanceB, params.amount, params.isColumnA, balance)
            }
           
            
            const hasSufficientBalance = Boolean(balance>=params.amount);
            console.log('suf balance in transfer val ' +JSON.stringify(hasSufficientBalance))
            if (!hasSufficientBalance) {
                params.valid = false;
                params.reason += 'Insufficient balance for transfer; ';
            }



            const otherChannel = await Channels.getChannel(params.toChannelAddress)
            if(otherChannel!=undefined||otherChannel!=null){
                let commitedA = otherChannel.participants.A
                let commitedB = otherChannel.participants.B
                if(commitedA!=''&&commitedA!=sender&&commitedB!=''&&commitedB!=sender){
                    params.valid = false
                    params.reason += 'Both columns of the desired transferee channel are occupied by commiters other than the commiter owning the transfered tokens.'
                }
            }

               // Ensure pay is a boolean; default to false if not provided
            if (typeof params.pay === 'undefined' || params.pay === '') {
                params.pay = false;
            } else if (typeof params.pay !== 'boolean') {
                params.valid = false;
                params.reason += 'pay is not a boolean; ';
            }

            // Validate payRef if pay is enabled
            if (params.pay && params.payRef) {
                if (!Number.isInteger(Number(params.payRef)) || Number(params.payRef) < 0) {
                    params.valid = false;
                    params.reason += 'payRef is not a valid integer; ';
                } else {
                    // Retrieve channel information

                    if (channel) {
                        // Determine the relevant column (A or B) based on params.isColumnA
                        const column = params.isColumnA ? 'A' : 'B';

                        // Check if pay is enabled for the column
                        if (!channel.payEnabled || !channel.payEnabled[column]) {
                            params.valid = false;
                            params.reason += `Pay not enabled for column ${column}; `;
                        }

                        // Check clearLists for the column
                        const clearLists = channel.clearLists ? channel.clearLists[column] : undefined;
                        if (clearLists) {
                            // Retrieve the payRef address details from transaction outputs
                            const outputs = await TxUtils.getTransactionOutputs(txid);
                            const payRefOutput = outputs.find(output => output.vout === Number(params.payRef));

                            if (!payRefOutput) {
                                params.valid = false;
                                params.reason += 'Invalid payRef output; ';
                            } else {
                                const payRefAddress = payRefOutput.scriptPubKey.addresses[0]; // Assuming single address per output                                // Check if payRefAddress matches any entry in the clearLists array
                                params.payRefAddress = payRefAddress
                                const isValidAttestation = await Promise.all(
                                    clearLists.map(async (listId) => {
                                        return await ClearList.isAddressInClearlist(listId, payRefAddress);
                                    })
                                );

                                // If none of the clearLists contain a match, invalidate
                                if (!isValidAttestation.includes(true)) {
                                    params.valid = false;
                                    params.reason += `No valid attestation for payRef address ${payRefAddress}; `;
                                }
                            }
                        }
                    } else {
                        params.valid = false;
                        params.reason += 'Sender channel not found; ';
                    }
                }
            }


            return params;
        },

        // 23: Settle Channel PNL
        validateSettleChannelPNL: async (sender, params, txid) => {
            params.reason = '';
            params.valid = true;

            const isAlreadyActivated = await activationInstance.isTxTypeActive(23);
            if(isAlreadyActivated==false){
                params.valid=false
                params.reason += 'Tx type not yet activated '
            }

            const is = await Validity.isActivated(params.block,txid,23)
            console.log(is)
            if (!is) {
                params.valid = false;
                params.reason = 'Transaction type activated after tx';
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

            const isNuetralized = await Scaling.isThisSettlementAlreadyNuetralized(sender, txid)
            if(isNuetralized){
                params.valid = false
                params.reason += "Settlement already invalidated by later settlement that updates it. "
            }
            return params;
        },


    // 24: Mint Synthetic
    validateMintSynthetic: async (sender, params, txid) => {
        params.reason = '';
        params.valid = true;
        console.log(JSON.stringify(params))

         const roundedAmount = Math.floor(params.amount);

        const isAlreadyActivated = await activationInstance.isTxTypeActive(24);
            if(isAlreadyActivated==false){
                params.valid=false
                params.reason += 'Tx type not yet activated '
            }

            const is = await Validity.isActivated(params.block,txid,24)
            console.log(is)
            if (!is) {
                params.valid = false;
                params.reason = 'Transaction type activated after tx';
            }

    // Check if the rounded amount is still >= 1
        if (roundedAmount < 1) {
            params.valid=false
            params.reason += 'Amount less than one'
        }

        params.amount = roundedAmount
        // Check if the synthetic token can be minted (valid property IDs, sufficient balance, etc.)
        const contractInfo = await ContractRegistry.getContractInfo(params.contractId);
        if(!contractInfo||contractInfo==null){
            params.valid=false
            params.reason += "hedge contract not found"
            return params
        }
        const tokenPair = contractInfo.onChainData[0][0]+'-'+contractInfo.onChainData[0][1]
        const collateralPropertyId = contractInfo.collateralPropertyId
        const notionalValue = contractInfo.notionalValue
        if(contractInfo.inverse==false){
                params.valid=false
                params.reason += 'Cannot mint synthetics with linear contracts'
        }
        if(contractInfo.issuer.native==false){
                params.valid=false
                params.reason += 'Cannot mint synthetics with oracle contracts... no one man should have all that power'
        }
        const marginMap = await MarginMap.getInstance(params.contractId)
        const position = await marginMap.getPositionForAddress(sender, params.contractId)
        if(position.contracts==null||!position.contracts){
            params.valid=false
            params.reason += 'Null contracts cannot hedge a mint'
        }
        let grossNotional = BigNumber(position.contracts).times(notionalValue).decimalPlaces(8).toNumber()
        console.log('validating mint '+grossNotional+' '+params.amount+' '+position.contracts+' '+notionalValue)
               
        if(params.amount>grossNotional){
                if(grossNotional<=-1){
                    params.amount = BigNumber(grossNotional).decimalPlaces(0).toNumber()
                    params.reason += 'insufficient contracts to hedge total, minting based on available contracts'        
                }else{
                    params.valid=false
                    params.reason += 'insufficient contracts to hedge the amount requested'
                }        
        }
        // Ensure the sender has sufficient balance of the underlying property
        const markPrice = await VolumeIndex.getLastPrice(tokenPair, params.block)
        const initMargin = await ContractRegistry.getInitialMargin(params.contractId, markPrice)
        let totalMargin = BigNumber(initMargin).times(params.amount).decimalPlaces(8).toNumber()
        let grossRequired = BigNumber(params.amount).times(notionalValue).dividedBy(markPrice).minus(totalMargin).decimalPlaces(8).abs().toNumber()
        const hasSufficientBalance = await TallyMap.hasSufficientBalance(sender, collateralPropertyId, grossRequired);
        console.log(hasSufficientBalance.hasSufficient+' '+grossRequired)
        if(hasSufficientBalance.hasSufficient==false){
            if(hasSufficientBalance.available>=initMargin){
                let newAmount = BigNumber(hasSufficientBalance.available).dividedBy(initMargin).decimalPlaces(0).toNumber()
                if(newAmount<=params.amount){
                    params.amount = newAmount
                    totalMargin = BigNumber(initMargin).times(params.amount).decimalPlaces(8).toNumber()
                    grossRequired= BigNumber(params.amount).times(notionalValue).dividedBy(markPrice).minus(totalMargin).decimalPlaces(8).toNumber()
                    params.reason += 'insufficient collateral to mint total, minting based on available collateral' 
                }else{
                    params.reason += 'insufficient collateral to mint total, minting based on available collateral capped at contracts'
                }
            }
                params.valid=false
                params.reason += 'insufficient collateral to create a 1x hedge position'
        }
        params.grossRequired = grossRequired
        params.margin = totalMargin
        console.log('about to calculate contracts ' +params.amount+' '+notionalValue + ' '+BigNumber(params.amount).dividedBy(notionalValue).decimalPlaces(0).toNumber())
        params.contracts = BigNumber(params.amount).dividedBy(notionalValue).decimalPlaces(0).toNumber()

        return params
    },

    // 25: Redeem Synthetic
    validateRedeemSynthetic: async (sender, params,txid) => {
        params.reason = '';
        params.valid = true;
        console.log('validating redeem '+JSON.stringify(params))
         const roundedAmount = Math.floor(params.amount);
         params.propertyId='s-'+params.propertyId+'-'+params.contractId
        // Check if the rounded amount is still >= 1

         const isAlreadyActivated = await activationInstance.isTxTypeActive(25);
            if(isAlreadyActivated==false){
                params.valid=false
                params.reason += 'Tx type not yet activated '
            }

            const is = await Validity.isActivated(params.block,txid,25)
            console.log(is)
            if (!is) {
                params.valid = false;
                params.reason = 'Transaction type activated after tx';
            }

        if (roundedAmount < 1) {
            params.valid=false
            params.reason += 'Amount less than one'
        }

        params.amount = roundedAmount
        // Check if the synthetic token can be redeemed (existence, sufficient amount, etc.)

        let marginMap= await MarginMap.getInstance(params.contractId)
        let position = await marginMap.getPositionForAddress(sender, params.contractId)
        if(position.contracts>0){
                params.valid=false
                params.reason += 'Redemption will close existing longs, move synths to a new address to redeem'
        }

        const canRedeem = await SyntheticRegistry.exists(params.propertyId);
        if(canRedeem==false){
                params.valid=false
                params.reason += 'Token is not of a synthetic nature'
        }
        // Ensure the sender has sufficient balance of the synthetic property
        const hasSufficientBalance = await TallyMap.hasSufficientBalance(params.senderAddress, params.propertyId, params.amount);
        if(hasSufficientBalance.hasSufficient==false){
                if(hasSufficientBalance.available>=1){
                    params.amount = Math.floor(hasSufficientBalance.available)
                }else{
                    params.valid=false
                    params.reason += 'insufficient tokens to redeem in this amount'    
                }        
        }
        return params;
    },

    // 26: Pay to Tokens
    validatePayToTokens: (params, tallyMap) => {
        // Ensure the sender has sufficient balance of the property used for payment
        const hasSufficientBalance = tallyMap.hasSufficientBalance(params.senderAddress, params.propertyIdUsed, params.amount);
        // Additional checks can be implemented based on the specific rules of Pay to Tokens transactions

        return hasSufficientBalance.hasSufficient;
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
        // Check if Bai Urbun contract terms are valid (price, amount, expiry block, etc.)
        const isValidContractTerms = baiUrbunRegistry.isValidBaiUrbunTerms(params.propertyIdDownPayment, params.propertyIdToBeSold, params.price, params.amount, params.expiryBlock);

        return isValidChannel && isValidContractTerms;
    },

    // 29: Trade Murabaha
    validateTradeMurabaha: (params, channelRegistry, murabahaRegistry) => {
        // Verify that the trade channel exists and is valid
        const isValidChannel = channelRegistry.isValidChannel(params.channelAddress);
        // Check if Murabaha contract terms are valid (down payment, price, amount, expiryparams.block, etc.)
        const isValidContractTerms = murabahaRegistry.isValidMurabahaTerms(params.propertyIdDownPayment, params.downPaymentPercent, params.propertyIdToBeSold, params.price, params.amount, params.expiryBlock, params.installmentInterval);

        return isValidChannel && isValidContractTerms;
    },

    // 30: Issue Invoice
    validateIssueInvoice: (params, invoiceRegistry, tallyMap) => {
        // Check if the issuer has sufficient balance of the property to receive payment
        const hasSufficientBalance = tallyMap.hasSufficientBalance(params.issuerAddress, params.propertyIdToReceivePayment, params.amount);
        // Validate invoice terms (due date, collateral, etc.)
        const isValidInvoiceTerms = invoiceRegistry.isValidInvoiceTerms(params.dueDateBlock, params.propertyIdCollateral);

        return hasSufficientBalance.hasSufficient && isValidInvoiceTerms;
    },

    //31: BatchSettlement
    validateBatchSettlement: (sender, params, txid, block) =>{

    },

    // 32: Batch Move Zk Rollup
    validateBatchMoveZkRollup: (params, zkVerifier, tallyMap) => {
        // Verify the zk proof with the zkVerifier
        const isZkProofValid = zkVerifier.verifyProof(params.zkProof);
        // Check the validity of the payment and data logistics within the ordinals
        const arePaymentsValid = tallyMap.arePaymentsValid(params.payments);

        return isZkProofValid && arePaymentsValid;
    }
};

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

function validateAddress(address) {
  if (!address || typeof address !== "string") {
    console.log("Invalid address provided "+address);
  }

  // Select the network based on the address prefix
  let network = null;

  for (const [networkName, netConfig] of Object.entries(networks)) {
    const { P2PKH, P2SH, bech32 } = netConfig;
    //console.log('validating address form '+JSON.stringify(netConfig))
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
    // Validate bech32
    console.log('validating bech32 '+bech32 +' '+address)
    return validateBech32(address, bech32);
  }

  return false; // Invalid address format
}

module.exports = Validity;