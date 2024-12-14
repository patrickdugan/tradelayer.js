
const TradeChannels = require('./channels.js')
const Activation = require('./activation.js')
const activation = Activation.getInstance();
// Custom modules for TradeLayer
//const Clearing =require('./clearing.js')
//const Persistence = require('./Persistence.js'); // Handles data persistence
const Orderbook = require('./orderbook.js'); // Manages the order book
//const InsuranceFund = require('./insurance.js'); // Manages the insurance fund
//const VolumeIndex = require('./VolumeIndex.js'); // Tracks and indexes trading volumes
const TradeLayerManager = require('./vesting.js'); // Handles vesting logic
//const ReOrgChecker = require('./reOrg.js');
const OracleList = require('./oracle.js')
// Additional modules
const fs = require('fs'); // File system module

const Validity = require('./validity.js'); // Module for checking transaction validity
const TxUtils = require('./txUtils.js'); // Utility functions for transactions
const TxIndex = require('./txIndex.js') // Indexes TradeLayer transactions
const TallyMap = require('./tally.js'); // Manages Tally Mapping
const MarginMap = require('./marginMap.js'); // Manages Margin Mapping
const PropertyManager = require('./property.js'); // Manages properties
const ContractRegistry = require('./contractRegistry.js'); // Registry for contracts
const ClearList = require('./clearlist.js')
const Scaling = require('./scaling.js')
//const Consensus = require('./consensus.js'); // Functions for handling consensus
const Channels = require('./channels.js')
const Encode = require('./txEncoder.js'); // Encodes transactions
const Types = require('./types.js'); // Defines different types used in the system
const Decode = require('./txDecoder.js'); // Decodes transactionsconst db = require('./db.js'); // Adjust the path if necessary
const db = require('./db.js'); // Adjust the path if necessary
const BigNumber = require('bignumber.js')
const VolumeIndex = require('./volumeIndex.js')
const SynthRegistry = require('./vaults.js')
const TradeHistory = require('./tradeHistoryManager.js')


// logic.js
const Logic = {
    //here we have a kinda stupid structure where instead of passing the params obj. I break it down into its sub-properties
    //and have to map the subsequent function's parameter sequence to how I have it here
    //I've wasted a lot of time fixing small bugs relating to getting this right for each functiom, would do it differently
    //Anyway, here we branch into each logic function.
    async typeSwitch(txNumber, params){
        if(params.valid == false){return null}
        console.log('tx number and params ' +txNumber, params)
        switch (txNumber) {
           case 0:
                await Logic.activateTradeLayer(params.txTypeToActivate, params.block, params.codeHash);
                break;
            case 1:
                await Logic.tokenIssue(params.senderAddress, params.initialAmount, params.ticker, params.url, params.whitelistId, params.isManaged, params.backupAddress, params.isNFT, params.block);
                break;
            case 2:
                await Logic.sendToken(params.sendAll, params.senderAddress, params.address, params.propertyIds, params.amounts,params.block);
                break;
            case 3:
                console.log('about to call utxo trade logic '+JSON.stringify(params))
                await Logic.tradeTokenForUTXO(params.senderAddress, params.satsPaymentAddress, params.propertyId, params.amount, params.columnA, params.satsExpected, params.tokenDeliveryAddress, params.satsReceived, params.price, params.paymentPercent, params.tagWithdraw, params.block, params.txid);
                break;
            case 4:
                await Logic.commitToken(params.senderAddress, params.channelAddress, params.propertyId, params.amount, params.payEnabled, params.clearLists, params.block);
                break;
            case 5:
                await Logic.onChainTokenToToken(params.senderAddress, params.propertyIdOffered, params.propertyIdDesired, params.amountOffered, params.amountExpected, params.txid, params.block, params.stop, params.post);
                break;
            case 6:
                await Logic.cancelOrder(params.senderAddress, params.isContract, params.offeredPropertyId, params.desiredPropertyId, params.cancelAll, params.cancelParams, params.block);
                break;
           case 7:
                await Logic.createClearList(sender, params.name, params.url, params.description, params.backupAddress, params.block);
                break;
            case 8:
                await Logic.updateAdmin(params.whitelist, params.token, params.oracle, params.id, params.newAddress, params.updateBackup, params.block);
                break;
            case 9:
                await Logic.issueOrRevokeAttestation(params.sender, params.clearlistId, params.targetAddress, params.metadata, params.block);
                break;
            case 10:
                await Logic.AMMPool(params.senderAddress, params.block, params.isRedeem, params.isContract, params.id1, params.amount, params.id2, params.amount2);
                break;
            case 11:
                await Logic.grantManagedToken(params.propertyId, params.amount, params.recipientAddress, params.propertyManager, params.senderAddress, params.block);
                break;
            case 12:
                await Logic.redeemManagedToken(params.propertyId, params.amount, params.propertyManager, params.senderAddress, params.block);
                break;
            case 13:
                await Logic.createOracle(params.senderAddress, params.ticker, params.url, params.backupAddress, params.clearlists, params.lag, params.oracleRegistry, params.block);
                break;
            case 14:
                await Logic.publishOracleData(params.oracleId, params.price, params.high, params.low, params.close, params.block);
                break;
            case 15:
                await Logic.closeOracle(params.oracleId, params.oracleRegistry, params.block);
                break;
            case 16:
                await Logic.createContractSeries(params.senderAddress, params.native, params.underlyingOracleId, params.onChainData, params.notionalPropertyId, params.notionalValue, params.collateralPropertyId, params.leverage, params.expiryPeriod, params.series, params.inverse, params.fee, params.block, params.whitelist);
                break;
            case 17:
                await Logic.exerciseDerivative(params.contractId, params.amount, params.contractsRegistry,params.senderAddress, params.block);
                break;
            case 18:
                await Logic.tradeContractOnchain(params.contractId, params.price, params.amount, params.sell, params.insurance, params.block, params.txid, params.senderAddress, params.reduce, params.post, params.stop);
                break;
            case 19:
                await Logic.tradeContractChannel(params.contractId, params.price, params.amount, params.columnAIsSeller, params.expiryBlock, params.insurance, params.senderAddress, params.block,params.txid);
                break;
            case 20:
                await Logic.tradeTokensChannel(params.propertyIdOffered, params.propertyIdDesired, params.amountOffered, params.amountDesired, params.expiryBlock, params.columnAIsOfferer, params.senderAddress, params.block,params.txid);
                break;
            case 21:
                await Logic.withdrawal(params.withdrawAll, params.channelAddress, params.propertyId, params.amount, params.senderAddress, params.block, params.columnIsB);
                break;        
            case 22:
                await Logic.transfer(params.senderAddress, params.toChannelAddress, params.propertyId, params.amount, params.isColumnA, params.pay, params.payRefAddress, params.block);
                break;
            case 23:
                await Logic.settleChannelPNL(params.channelAddress, params.txParams, params.block,params.txid);
                break;
            case 24:
                await Logic.mintSynthetic(params.senderAddress, params.propertyId, params.contractId, params.amount, params.block, params.grossRequired, params.contracts, params.margin);
                break;
            case 25:
                await Logic.redeemSynthetic(params.senderAddress, params.propertyId, params.contractId, params.amount, params.block);
                break;
            case 26:
                await Logic.payToTokens(params.tallyMap, params.propertyIdTarget, params.propertyIdUsed, params.amount, params.block);
                break;
            case 27:
                await Logic.createOptionChain(params.seriesId, params.strikePercentInterval, params.isEuropeanStyle, params.block);
                break;
            case 28:
                await Logic.tradeBaiUrbun(params.channelAddress, params.propertyIdDownPayment, params.propertyIdToBeSold, params.downPaymentPercent, params.amount, params.expiryBlock, params.tradeExpiryBlock, params.block);
                break;
            case 29:
                await Logic.tradeMurabaha(params.channelAddress, params.buyerAddress, params.sellerAddress, params.propertyId, params.costPrice, params.profitMargin, params.paymentBlockHeight, params.block);
                break;
            case 30:
                await Logic.issueInvoice(params.propertyManager, params.invoiceRegistry, params.propertyIdToReceivePayment, params.amount, params.dueDateBlock, params.propertyIdCollateral, params.receivesPayToToken, params.issuerNonce, params.block);
                break;
            case 31:
                Logic.batchSettlement(params);
                break;
            case 32:
                await Logic.batchMoveZkRollup(params.zkVerifier, params.rollupData, params.zkProof, params.block);
                break;
            case 33:
                Logic.coloredCoin(params);
                break;
            case 34:
                Logic.crossLayerBridge(params);
                break;
            case 35:
                Logic.smartContractBind(params);
                break;
            default:
                console.log(`Unhandled transaction type: ${txNumber}`);
        }
        return 
    },

    async activateTradeLayer(txType, block, codeHash) { 
    		 // Assuming the transaction object has properties like 'txId' and 'senderAddress'
        // Call the activateSystem method from the Activation class instance
        //console.log('in activate TradeLayer logic function '+ txType+ ' block ' +block)
        const activationResult = await activation.activate(txType, block, codeHash);

        // Log or handle the result of activation
        console.log('activation result ' +activationResult);

        return activationResult; // You might want to return this for further processing
 
    },

    async tokenIssue(sender, initialAmount, ticker, url = '', clearlistId = 0, isManaged = false, backupAddress = '', isNFT = false, block) {
        const propertyManager = PropertyManager.getInstance();

        // Determine the type of the token based on whether it's managed or an NFT
        let tokenType = isNFT ? 'Non-Fungible' : isManaged ? 'Managed' : 'Fixed';

        // Define the token data
        const tokenData = {
            ticker: ticker,
            totalInCirculation: initialAmount,
            type: tokenType,
            clearlistId: clearlistId,
            issuer: sender,
            backupAddress: backupAddress
        };

        // Create the token in the property manager
        try {
            var newPropertyId = await propertyManager.createToken(ticker, initialAmount, tokenType, clearlistId, sender, backupAddress);
            //console.log('created token, now creating the units at '+sender+ ' in amount '+initialAmount)
            await TallyMap.updateBalance(sender, newPropertyId, initialAmount, 0, 0, 0,'issuance',block);
            return `Token ${ticker} (ID: ${newPropertyId}) created. Type: ${tokenType}`;
        } catch (error) {
            console.error('Error creating token:', error);
            return error.message;
        }
    },


    async sendToken(sendAll, senderAddress, recipientAddresses, propertyIdNumbers, amounts,block) {
        console.log('send logic parameters '+sendAll + ' '+ senderAddress + ' '+ recipientAddresses + ' ' + propertyIdNumbers + ' '+ amounts)
        if (sendAll) {
            // Handle sending all available balances
            //console.log('sendingAll')
            await sendAll(senderAddress,recipientAddresses)
        } else {
            // Check if handling a multi-send or single send
            const isMultiSend = Array.isArray(propertyIdNumbers) && Array.isArray(amounts);
            if (isMultiSend) {
                //console.log('multisend '+ isMultiSend + ' is this an array? '+propertyIdNumbers+ ' what about amounts '+amounts)
                // Ensure arrays are of the same length
                if (propertyIdNumbers.length !== amounts.length || propertyIdNumbers.length !== recipientAddresses.length) {
                    throw new Error('Property IDs, amounts, and recipient addresses arrays must have the same length.');
                }

                // Process each send in the multi-send transaction
                for (let i = 0; i < propertyIdNumbers.length; i++) {
                    const propertyId = propertyIdNumbers[i];
                    const amount = amounts[i];
                    const recipientAddress = recipientAddresses[i];
                    console.log('checking block before process send' +block)
                    await processSend(senderAddress, recipientAddress, propertyId, amount,block);
                }
            } else {
                // Special handling for TLVEST (Property ID 2)
                //console.log('propertyIdnumbers ' +propertyIdNumbers)
                    if (propertyIdNumbers == 2||propertyIdNumbers==3) {
                        console.log('vesting single send '+senderAddress)
                        await this.vestingSend(senderAddress,recipientAddresses,propertyIdNumbers,amounts,block)
                    }else if(propertyIdNumbers!=undefined){
                        console.log('vanilla single send, block '+block)
                        await this.sendSingle(senderAddress, recipientAddresses, propertyIdNumbers, amounts,block);
                    }
            }
        }

        // Save the updated tally map to the database
        //await TallyMap.recordTallyMapDelta(blockHeight, txId, address, propertyId, amountChange)
        return console.log('sent')
    },

    async vestingSend(senderAddress, recipientAddresses, propertyIdNumbers, amounts,block){
        // Get TLVEST and TL balances for the sender
        
        const BigNumber = require('bignumber.js');

            // Ensuring amount is a whole number
            const roundedAmount = new BigNumber(amounts).integerValue(BigNumber.ROUND_DOWN);

            if (roundedAmount.isLessThanOrEqualTo(0)) {
                throw new Error("Amount must be greater than zero");
            }

        const tlVestTally = await TallyMap.getTally(senderAddress, propertyIdNumbers);

        // Calculate the amount of TL to move from vesting to available
        const tlVestingMovement = this.calculateVestingMovement(amounts, tlVestTally)

        await TallyMap.updateBalance(senderAddress, propertyIdNumbers, -amounts, 0, 0, 0,'vestingSend',block);
        await TallyMap.updateBalance(recipientAddresses, propertyIdNumbers, amounts, 0, 0, 0,'vestingSend',block);

        await TallyMap.updateBalance(senderAddress, propertyIdNumbers, 0, 0, 0, -tlVestingMovement,'vestingDrag',block);
        await TallyMap.updateBalance(recipientAddresses, propertyIdNumbers, 0, 0, 0, tlVestingMovement,'vestingFollow',block);
        return
    },

    calculateVestingMovement(amount, tlVestTally) {
    // Convert all values to BigNumber for accurate calculation
        const amountBN = new BigNumber(amount);
        const tlVestAvailableBN = new BigNumber(tlVestTally.available);
        const tlVestingBN = new BigNumber(tlVestTally.vesting);

        // Calculate the proportion of TLVEST being moved
        // Using BigNumber's division method for precision
        const proportionBN = amountBN.dividedBy(tlVestAvailableBN);

        // Calculate the amount of TL to move from vesting to available
        // Ensure result is rounded down to avoid fractional vesting movement
        const tlVestingMovementBN = tlVestingBN.multipliedBy(proportionBN).integerValue(BigNumber.ROUND_DOWN);
        console.log('inside calc vesting mov '+tlVestingMovementBN+' '+tlVestingBN+' '+proportionBN+' '+amountBN+' '+tlVestAvailableBN+' '+amount+' '+tlVestTally.available+' '+tlVestTally.vesting)
        return tlVestingMovementBN.toString(); // Convert back to string for further processing
    },


    roundToEightDecimals(number) {
        return Math.floor(number * 1e8) / 1e8;
    },


    async sendSingle(senderAddress, receiverAddress, propertyId, amount,block) {
        const tallyMapInstance = await TallyMap.getInstance();

        // Check if sender has enough balance
        const senderBalance = TallyMap.getTally(senderAddress, propertyId);
        console.log('checking balance before sending ' +JSON.stringify(senderBalance))
        if (senderBalance < amount) {
            /*throw new Error*/console.log("Insufficient balance");
        }

        // Perform the send operation
        await TallyMap.updateBalance(senderAddress, propertyId, -amount, 0, 0, 0,'send', block);
        await TallyMap.updateBalance(receiverAddress, propertyId, amount, 0, 0, 0,'receive', block);

        // Handle special case for TLVEST
        if (propertyId === 2) {
            // Update the vesting column of TL accordingly
            // Logic for updating TL vesting...
        }

        return "Send operation successful";
    },

    async sendAll(senderAddress, receiverAddress) {
        const tallyMapInstance = await TallyMap.getInstance();

        // Get all balances for the sender
        const senderBalances = tallyMapInstance.getAddressBalances(senderAddress);

        if (senderBalances.length === 0) {
            throw new Error("No balances to send");
        }

        // Iterate through each token balance and send it to the receiver
        for (const balance of senderBalances) {
            const { propertyId, amount } = balance;
            if (amount > 0) {
                await TallyMap.updateBalance(senderAddress, propertyId, -amount, 0, 0, 0, 'sendAll');
                await TallyMap.updateBalance(receiverAddress, propertyId, amount, 0, 0, 0,'receiveAll');

                // Handle special case for TLVEST
                if (propertyId === 'TLVEST') {
                    // Update the vesting column of TL accordingly
                    // Logic for updating TL vesting...
                }
            }
        }

        return "All balances sent successfully";
    },

    // Helper function to process a single send operation
	async processSend(senderAddress, recipientAddress, propertyId, amount,block) {

	    const availableBalance = tallyMap.getAvailableBalance(senderAddress, propertyId);
	    if (availableBalance < amount) {
	        throw new Error('Insufficient available balance for transaction.');
	    }

	    await TallyMap.updateBalance(senderAddress, propertyId, -amount,0,0,0,'multi-send',block);
	    await TallyMap.updateBalance(recipientAddress, propertyId, amount,0,0,0,'multi-send',block);
	    console.log(`Transferred ${amount} of property ${propertyId} from ${senderAddress} to ${recipientAddress}`);
        return
	},


	async tradeTokenForUTXO(senderAddress, receiverAddress, propertyId, tokenAmount, columnA, satsExpected, tokenDeliveryAddress, satsReceived, price, paymentPercent, tagWithdraw, block, txid) {
	   
        // Calculate the number of tokens to deliver based on the LTC received
        const receiverLTCReceivedBigNumber = new BigNumber(satsReceived);
        const satsExpectedBigNumber = new BigNumber(satsExpected);
        const decodedTokenAmountBigNumber = new BigNumber(tokenAmount);
        const tradeHistoryManager = new TradeHistory()

        const tokensToDeliver = tokenAmount
            //console.log('values in utxo logic '+tokenAmount+' '+decodedTokenAmountBigNumber+' '+satsExpected+' '+satsExpectedBigNumber+' '+satsReceived+' '+receiverLTCReceivedBigNumber)
               //look at the channel balance where the commited tokens we're selling for LTC exist
        
        console.log('inside logic for UTXO trade '+tokensToDeliver+' '+price, columnA)
            let channel = await Channels.getChannel(senderAddress)
            let channelBalance 
            if(columnA==true){
                channelBalance = channel["A"][propertyId]
                
            }else if(columnA==false){
                channelBalance = channel["B"][propertyId]
            }
            //We need this function to be valid and flexible since the LTC UTXO is a fact in the Litecoin protocol
            //So we make sure that you get as many tokens as are available and if the parameters fall short thats
            //something you have to monitor before you co-sign.
            if(tokensToDeliver>channelBalance){
                tokensToDeliver=channelBalance
            }
            console.log(tokensToDeliver+' '+channelBalance)

            //Debits the tokens from the correct column of the channel
            if(columnA==true){
                channel["A"][propertyId]-=tokensToDeliver
            }else if(columnA==false){
                channel["B"][propertyId]-=tokensToDeliver
            }
            Channels.setChannel(senderAddress,channel)
            console.log('channel adjusted for token sale '+JSON.stringify(channel["A"])+' '+JSON.stringify(channel["B"]))
            //the tokens exist both as channel object balances and reserve balance on the channel address, which is the sender
            //So we debit there and then credit them to the token delivery address, which we took in the parsing
            //From the token delivery vOut and analyzing the actual transaction, usually the change address of the LTC spender
            await TallyMap.updateChannelBalance(senderAddress,propertyId,-tokensToDeliver,'UTXOTokenTradeDebit',block)
            if(tagWithdraw!=null&&typeof tagWithdraw==string ){
                 await TallyMap.updateChannelBalance(tokenDeliveryAddress,propertyId,tokensToDeliver,'UTXOTokenTradeCredit',block)
                 await Channels.recordCommitToChannel(tokenDeliveryAddress, tagWithdraw, propertyId, tokenAmount, false, null, block) {

            }else{
                  await TallyMap.updateBalance(tokenDeliveryAddress,propertyId,tokensToDeliver,0,0,0,'UTXOTokenTradeCredit',block)
         
            }
             const key = '0-'+propertyId
            console.log('saving volume in volume Index '+key+' '+satsReceived)
            const coinAdj = new BigNumber(satsReceived).div(1e8).decimalPlaces(8, BigNumber.ROUND_DOWN)
            console.log(' price in UTXO '+price)
            if(isNaN(price)){
                price = coinAdj.div(tokenAmount).decimalPlaces(8).toNumber()
                console.log('price 2nd hit '+price+' '+coinAdj+' '+tokenAmount)
            }
            await VolumeIndex.saveVolumeDataById(key,coinAdj.toNumber(),price,block,'UTXO')

             const trade = {
                    offeredPropertyId: propertyId,
                    desiredPropertyId: 0,
                    amountOffered: tokensToDeliver, // or appropriate amount
                    amountExpected: satsReceived, // or appropriate amount
                    // other relevant trade details...
                };
            const orderbook = await Orderbook.getOrderbookInstance(key)
            await orderbook.recordTokenTrade(trade,block,txid)

            const isListedA = await ClearList.isAddressInClearlist(2, senderAddress);
            const isListedB = await ClearList.isAddressInClearlist(2, receiverAddress)
            let isTokenListed = false
            if (String(propertyId).startsWith('s-')) {
                isTokenListed = true //need to add logic to look up the contractId inline to the synth id and then look up its pairs
                                    // and then look up if those tokens are listed
            }else{
                let propertyInfo = PropertyManager.getPropertyData(propertyId)
                if(propertyInfo.issuer){
                    isTokenListed = await ClearList.isAddressInClearlist(1, propertyInfo.issuer);
                }
            }
            console.log('is token/address listed for liquidity reward '+isListedA+' '+isListedB+' '+isTokenListed)    
                if(isTokenListed){
                        const liqRewardBaseline1= await VolumeIndex.baselineLiquidityReward(satsReceived,0.000025,0)
                        const liqRewardBaseline2= await VolumeIndex.baselineLiquidityReward(tokenAmount,0.000025,propertyId)
                        TallyMap.updateBalance(senderAddress,3,liqRewardBaseline1,0,0,0,'baselineLiquidityReward')
                        TallyMap.updateBalance(receiverAddress,3,liqRewardBaseline2,0,0,0,'baselineLiquidityReward')
                }
                if(isListedA){
                    const liqReward1= await VolumeIndex.calculateLiquidityReward(satsReceived,0)    
                    TallyMap.updateBalance(senderAddress,3,liqReward1,0,0,0,'enhancedLiquidityReward')
                }
                if(isListedB){
                    const liqReward2= await VolumeIndex.calculateLiquidityReward(tokenAmount,propertyId)
                    TallyMap.updateBalance(receiverAddress,3,liqReward2,0,0,0,'enhancedLiquidityReward')

                }
                return
	},
	// commitToken: Commits tokens for a specific purpose
	async commitToken(senderAddress, channelAddress, propertyId, tokenAmount, payEnabled, clearLists, block) {
       console.log('commiting tokens '+tokenAmount+' '+block)
        // Deduct tokens from sender's available balance
        await TallyMap.updateBalance(senderAddress, propertyId, -tokenAmount, 0, 0, 0,'commit',block);

        // Add tokens to the channel's balance
        await TallyMap.updateChannelBalance(channelAddress, propertyId, tokenAmount,'channelReceive',block);

        // Determine which column (A or B) to assign the tokens in the channel registry
        await Channels.recordCommitToChannel(channelAddress, senderAddress, propertyId, tokenAmount, payEnabled, clearLists, block);

        console.log(`Committed ${tokenAmount} tokens of propertyId ${propertyId} from ${senderAddress} to channel ${channelAddress}`);
        return;
    },

    async onChainTokenToToken(fromAddress, offeredPropertyId, desiredPropertyId, amountOffered, amountExpected, txid, blockHeight, stop,post) {
        // Construct the pair key for the Orderbook instance
        const pairKey = `${offeredPropertyId}-${desiredPropertyId}`;
        // Retrieve or create the Orderbook instance for this pair
        //console.log('loading orderbook for pair key '+pairKey)
        const orderbook = await Orderbook.getOrderbookInstance(pairKey);
        //console.log('load orderbook for pair key '+JSON.stringify(orderbook))

        const txInfo = await TxUtils.getRawTransaction(txid)
       
        const confirmedBlock = await TxUtils.getBlockHeight(txInfo.blockhash)

        if(stop==true&&post==true){
            post=false
        }
        // Construct the order object
        const order = {
            offeredPropertyId:offeredPropertyId,
            desiredPropertyId:desiredPropertyId,
            amountOffered:amountOffered,
            amountExpected:amountExpected,
            blockTime: confirmedBlock,
            sender: fromAddress, 
            stop: stop,
            post: post
        };

        console.log('entering order into book '+JSON.stringify(order), 'txid')

        // Add the order to the order book
        await orderbook.addTokenOrder(order, blockHeight, txid);

        // Log the order placement for record-keeping
        console.log(`Order placed: ${JSON.stringify(order)}`);

        // Optionally, you might want to update the tally map here
        // Update Tally Map logic

        // Return the details of the placed order
        return order;
    },

	async cancelOrder(fromAddress, isContract, offeredPropertyId, desiredPropertyId, cancelAll, cancelParams,block) {
        let cancelledOrders = [];
        let key
        if(isContract==true){
            key = offeredPropertyId
        }else if(isContract==false){
            key = offeredPropertyId+'-'+desiredPropertyId
        }
        let orderbook = new Orderbook(key)
        // Handle contract cancellation if only one property ID is provided
        console.log('in logic function for cancelOrder '+fromAddress + ' '+isContract +' '+offeredPropertyId+' '+desiredPropertyId +' '+cancelAll+ ' '+JSON.stringify(cancelParams))
            if(isContract==true){
                // Contract cancellation logic here
                if(cancelAll){
                    cancelledOrders = await orderbook.cancelAllContractOrders(fromAddress,offeredPropertyId,block)
                    //console.log('contract cancel all'+JSON.stringify(cancelledOrders))
                }
                if(cancelParams.txid){
                    cancelledOrders = await orderbook.cancelContractOrderByTxid(fromAddress,offeredPropertyId,cancelParams.txid,block)
                }
                if(cancelParams.price){
                    if(cancelParams.buy){
                       cancelledOrders = await orderbook.cancelContractBuyOrdersByPrice(fromAddress,offeredPropertyId,cancelParams.price,cancelParams.buy,block)
                    }
                    if(cancelParams.sell){
                       cancelledOrders = await orderbook.cancelContractSellOrdersByPrice(fromAddress,offeredPropertyId,cancelParams.price,cancelParams.sell,block)
                    }
                }
                await orderbook.saveOrderBook(`${offeredPropertyId}`);
            }

            if(isContract==false){
                //normalize the order of propertyIds

                if (cancelAll && offeredPropertyId && desiredPropertyId) {
                    console.log('canceling all orders for '+fromAddress + offeredPropertyId+ desiredPropertyId)
                            cancelledOrders = await orderbook.cancelAllTokenOrders(fromAddress, offeredPropertyId, desiredPropertyId,block);
                }
                 // Cancel a specific order by txid
                if (cancelParams.txid) {
                    cancelledOrders = await orderbook.cancelTokenOrdersByTxid(fromAddress,offeredPropertyId,desiredPropertyId, cancelParams.txid,block);
                } 

                // Cancel orders by price or order type
                if (cancelParams.price || cancelParams.orderType) {
                    if (cancelParams.price) {
                        // Cancel sell orders greater than or equal to the price
                        cancelledOrders = await orderbook.cancelTokenSellOrdersByPrice(fromAddress, offeredPropertyId, desiredPropertyId, cancelParams.price,block);
                        
                        // Cancel buy orders less than or equal to the price
                        cancelledOrders = await orderbook.cancelTokenBuyOrdersByPrice(fromAddress, offeredPropertyId, desiredPropertyId, cancelParams.price,block);
                    }
                    // Add more conditions based on your cancel params if needed
                }  

                // Save the updated order book to the database
                await orderbook.saveOrderBook(`${offeredPropertyId}-${desiredPropertyId}`);
            }

        // Log the cancellation for record-keeping
        //console.log(`Cancelled orders: ${JSON.stringify(cancelledOrders)}`);

        // Return the details of the cancelled orders
        return cancelledOrders;
    },
		    /**
		     * Creates a new clearlist.
		     * 
		     * @param {Object} params - Parameters for creating the clearlist
		     * @param {string} params.adminAddress - The address of the admin for this clearlist
		     * @param {string} [params.name] - Optional name for the clearlist
		     * @param {Array} [params.criteria] - Optional criteria for inclusion in the clearlist
		     * @param {string} [params.backupAddress] - Optional backup address for admin operations
		     * @returns {Object} - The result of the clearlist creation
		     */
	async createClearList(adminAddress, name, url, description, backupAddress, block){

		        // Validate input parameters
		        if (!adminAddress) {
		            return console.log('Admin address is required to create a clearlist');
		        }

		        // Create the clearlist
		        const clearlistId = await ClearList.createclearlist({
		            adminAddress,
		            name,
		            url,
                    description,
		            backupAddress
		        });

		        // Return a message with the new clearlist ID
		        return {
		            message: `clearlist created successfully with ID: ${clearlistId}`,
		            clearlistId
		        };
		},

    async updateAdmin(whitelist,token,oracle, newAddress, id, updateBackup, block) {

	    if(whitelist){
                await ClearList.updateAdmin(id, newAddress,updateBackup);
        }else if(token){
                await PropertyList.updateAdmin(id, newAddress,updateBackup);
        }else if(oracle){
                await OracleList.updateAdmin(entityId, newAddress, updateBackup);
        }

	    console.log(`Admin updated for ${entityType} ${entityId}`);
        return
	},


    async issueOrRevokeAttestation(sender, clearlistId, targetAddress, metaData, revoke, block) {
        const admin = activation.getAdmin()
        if(sender==admin&&clearlistId==0){
            await updateBannedCountries(metaData,block)
            return
        }
        if(!revoke){
             await ClearList.addAttestion(clearlistId, targetAddress,metaData, block);
            console.log(`Address ${targetAddress} added to clearlist ${clearlistId}`);
        }else if(revoke==true){
            await ClearList.revokeAttestation(clearlistId,targetAddress,metaData, block)
        }
        return
	},

    async updateBannedCountries(bannedCountriesGlobal, block) {
            // Validate input: Must be an array of two-character strings
            if (!Array.isArray(bannedCountriesGlobal) || !bannedCountriesGlobal.every(code => typeof code === 'string' && code.length === 2)) {
                return console.log('Invalid input: bannedCountriesGlobal must be an array of two-character strings.');
            }

            console.log('Using default global Banlist:', bannedCountriesGlobal);
            await Clearlist.setBanList(bannedCountriesGlobal,block); // Update Clearlist object with default
    }


   async AMMPool(sender, block, isRedeem, isContract, id, amount, id2, amount2) {
        let ammInstance;

        if (isContract) {
            ammInstance = await ContractRegistry.getAMM(id);
        } else {
            ammInstance = await PropertyRegistry.getAMM(id, id2);
        }

        if (!ammInstance) {
            throw new Error('AMM instance not found');
        }

        if (isRedeem&&isContract) {
            await ammInstance.redeemCapital(sender, id, amount, isContract, block);
        }else if(isRedeem&&!isContract){
            await ammInstance.redeemCapital(sender, id, amount, isContract, id2, amount2, block)
        }else if(!isRedeem&&isContract){ 
            await ammInstance.addCapital(sender, id, amount, isContract, block);
        }else if(!isRedeem&&!isContract){
            await ammInstance.addCapital(sender, id, amount,isContract, id2, amount2,block)
        }
    },

    async grantManagedToken(propertyId, amount, recipientAddress, propertyManager,block) {

	    // Verify if the property is a managed type
	    const isManaged = await propertyManager.verifyIfManaged(propertyId);
	    if (!isManaged) {
	        throw new Error('Property is not a managed type');
	    }

	    // Logic to grant tokens to the recipient
	    await PropertyManager.grantTokens(propertyId, recipientAddress, amount,block);
	    console.log(`Granted ${amount} tokens of property ${propertyId} to ${recipientAddress}`);
        return
	},

	async redeemManagedToken(propertyId, amount, address,block) {

	    // Verify if the property is a managed type
	    const isManaged = await propertyManager.verifyIfManaged(propertyId);
	    if (!isManaged) {
	        throw new Error('Property is not a managed type');
	    }

	    // Logic to redeem tokens from the admin's balance
	    await PropertyManager.redeemTokens(address, propertyId, amount,block);
	    console.log(`Redeemed ${amount} tokens of property ${propertyId}`);
        return
	},

    async createOracle(adminAddress, ticker, url, backupAddress, clearlists, lag, oracleRegistry,block) {

	    // Create a new oracle
	    const oracleId = await OracleList.createOracle({adminAddress, ticker, url, backupAddress, clearlists, lag});
	    console.log(`Oracle created with ID: ${oracleId}`);
	    return oracleId;
	},

    async publishOracleData(oracleId, price, high, low, close, block) {
        console.log('publishing Oracle Data '+oracleId + ' '+ price)
	    // Publish data to the oracle
	    await OracleList.publishData(oracleId, price, high, low, close, block);
	    console.log(`Data published to oracle ${oracleId}`);
        return
	},

	async closeOracle(oracleId, block) {

	    // Close the specified oracle
	    await OracleList.closeOracle(oracleId);
	    console.log(`Oracle ${oracleId} has been closed`);
        return
	},

    async createContractSeries(sender, native, underlyingOracleId, onChainData, notionalPropertyId, notionalValue, collateralPropertyId, leverage, expiryPeriod, series, inverse, fee, block, whitelist) {
	    // Create a new future contract series

        const params = {
            sender: sender,
            native:native,
            underlyingOracleId: underlyingOracleId,
            onChainData: onChainData,
            notionalPropertyId: notionalPropertyId,
            notionalValue: notionalValue,
            collateralProperty: collateralPropertyId,
            leverage:leverage, 
            expiryPeriod: expiryPeriod, 
            series:series, 
            inverse: inverse, 
            fee: fee, 
            block: block, 
            whitelist:whitelist
        }

	    const futureContractSeriesId = await ContractRegistry.createContractSeries(
	        sender, params, block
	    );
	    console.log(`Future contract series created with ID: ${futureContractSeriesId}`);
	    return futureContractSeriesId;
	},

    async exerciseDerivative(contractId, amount, contractsRegistry,block) {
	    if (!contractId || !amount || !contractsRegistry) {
	        throw new Error('Missing required parameters');
	    }

	    // Exercise the derivative contract
	    await ContractRegistry.exerciseDerivative(contractId, amount);
	    console.log(`Derivative contract ${contractId} exercised for amount ${amount}`);
	},

    async tradeContractOnchain(contractId, price, amount, sell, insurance, blockTime, txid,sender, isLiq, reduce, post,stop) {
        // Trade the contract on-chain
        const orderbook = await Orderbook.getOrderbookInstance(contractId);
        console.log('checking contract orderbook ' +JSON.stringify(orderbook))
	    await orderbook.addContractOrder(contractId, price, amount, sell, insurance, blockTime, txid, sender, false,reduce,post,stop);
	    console.log(`Added contract order ${contractId} on-chain with price ${price} and amount ${amount}`);
        return
	},

    async tradeContractChannel(contractId, price, amount, columnAIsSeller, expiryBlock, insurance, channelAddress, block, txid) {
        const { commitAddressA, commitAddressB } = await Channels.getCommitAddresses(channelAddress);
        const orderbook = await Orderbook.getOrderbookInstance(contractId)
        const initMarginPerContract = await ContractRegistry.getInitialMargin(contractId,price)
        const initMarginBN= new BigNumber(initMarginPerContract)
        const amountBN = new BigNumber(amount)
        const initMargin = amountBN.times(initMarginBN).toNumber()
        let buyerAddress
        let sellerAddress
        if(columnAIsSeller){
            sellerAddress=commitAddressA
            buyerAddress=commitAddressB
        }else{
            sellerAddress=commitAddressB
            buyerAddress=commitAddressA
        }
        let sellSide = false
        let buySide = true
        const isInverse = ContractRegistry.isInverse(contractId)
        const sellOrder = { contractId, amount, price, block, sellSide, initMargin, sellerAddress, txid };
        const buyOrder = { contractId, amount, price, block, buySide, initMargin, buyerAddress, txid };

        let match = { 
                        sellOrder,
                        buyOrder,
                        price,
                        address: channelAddress,
                        tradePrice: price 
                    }
        let matches = []
        matches.push(match)
	    // Trade the contract within a channel
        await orderbook.processContractMatches(matches,block,true)
        await VolumeIndex.saveVolumeDataById(contractId,amount,price,block,'contract')

	    console.log(`Traded contract ${contractId} in channel with price ${price} and amount ${amount}`);
        return
	},

	async tradeTokensChannel(offeredPropertyId, desiredPropertyId, amountOffered, amountDesired, expiryBlock, columnAIsOfferer, channelAddress, block, txid){

        const { commitAddressA, commitAddressB } = await Channels.getCommitAddresses(channelAddress);
        console.log('inside tokens channel '+commitAddressA+' '+commitAddressB+' channel addr '+channelAddress)
        const key = `${offeredPropertyId}-${desiredPropertyId}`
        const orderbook = await Orderbook.getOrderbookInstance(key)
        let buyerAddress
        let sellerAddress
        if(columnAIsOfferer){
            sellerAddres=commitAddressB
            buyerAddress=commitAddressA
        }else{
            sellerAddres=commitAddressA
            buyerAddress=commitAddressB
        }

        const sellOrder = {
            offeredPropertyId:offeredPropertyId,
            desiredPropertyId:desiredPropertyId,
            amountOffered:amountOffered,
            amountExpected:amountDesired,
            blockTime: block,
            sender: sellerAddress
        };

        const buyOrder = {
            offeredPropertyId:offeredPropertyId,
            desiredPropertyId:desiredPropertyId,
            amountOffered:amountOffered,
            amountExpected:amountDesired,
            blockTime: block,
            sender: buyerAddress
        };

        const amountOfferedBN = new BigNumber(amountOffered);
        const amountDesiredBN = new BigNumber(amountDesired);

        // Calculate tradePrice
        const tradePrice = amountOfferedBN.dividedBy(amountDesiredBN);

        let match = {sellOrder: sellOrder, buyOrder: buyOrder, 
                    amountOfTokenA: amountOfferedBN.toNumber(), 
                    amountOfTokenB: amountDesiredBN.toNumber(),
                    tradePrice: tradePrice.toNumber(),
                    channel: channelAddress 
                    }
        let matches = []
        matches.push(match)

		    // Update balances in the channel columns and commitment addresses
        console.log('about to process token match in channel '+JSON.stringify(matches),block)
		await orderbook.processTokenMatches(matches, block, txid,true)
        await VolumeIndex.saveVolumeDataById(key,{amountOffered,amountDesired},tradePrice,block,'token')

		    return `Trade executed in channel ${channelAddress}`;
	},

	withdrawal(withdrawAll, channelAddress, propertyId, amount, sender, block, columnIsB) {
		    const channel = Channels.getChannel(channelAddress);
		    // Assuming channel object has a map of property balances		  
            Channels.addToWithdrawalQueue(block, sender, amount, channelAddress,propertyId, withdrawAll, columnIsB)
            return
	},


	async transfer(fromChannelAddress, toChannelAddress, propertyId, amount, isColumnA, pay, payRefAddress, block) {
        let fromChannel = await Channels.getChannel(fromChannelAddress);
       
        console.log(`To channel ${toChannelAddress} not found. Adding to registry.`);
        await Channels.recordCommitToChannel(toChannelAddress, fromChannelAddress, propertyId, amount, false, '', block);
        let toChannel = await Channels.getChannel(toChannelAddress);   

        // Determine the correct column to deduct from in the fromChannel
        const fromColumn = isColumnA ? 'A' : 'B';
        console.log(JSON.stringify(fromChannel),fromColumn, isColumnA, amount, fromChannel[fromColumn][propertyId] )
        const channelColumn = Channels.assignColumnBasedOnAddress(toChannelAddress, fromChannelAddress);
        // Check if the fromChannel has enough balance

        // Assign columns in the toChannel based on the address
        //await Channels.assignColumnBasedOnAddress(toChannelAddress, toChannelAddress);

        // Update balances in from channel
        fromChannel[fromColumn][propertyId] -= amount;
         // Assign the commit address based on pay status
        if (pay && payRefAddress) {

                // If pay is true and payRefAddress is provided, set it as the commit address
                toChannel.participants[channelColumn] = payRefAddress;
                console.log(`Setting commit address in toChannel ${channelColumn} as payRefAddress: ${payRefAddress}`);
            } else {
                // Otherwise, use the fromChannel's participant address
                const senderCommitAddress = fromChannel.participants[fromColumn];
                toChannel.participants[channelColumn] = senderCommitAddress;
                console.log(`Setting commit address in toChannel ${channelColumn} as fromChannel participant address: ${senderCommitAddress}`);
        }

        TallyMap.updateChannelBalance(fromChannelAddress, propertyId, -amount,'transferDebit', block)
        TallyMap.updateChannelBalance(toChannelAddress, propertyId, amount, 'transferCredit', block)

        // Save updated channel states back to the registry
        Channels.channelsRegistry.set(fromChannelAddress, fromChannel);   
        
        await Channels.saveChannelsRegistry();
        return
    },

	async settleChannelPNL(channelAddress, txParams, block,txid) {
        const {
            txidNeutralized1,
            txidNeutralized2,
            markPrice,
            close
        } = txParams;

        if(txidNeutralized2){
            const settlement = await Scaling.nuetralizeSettlement(channel,txidNeutralized2)
        }

        const trade = await Scaling.isTradePublished(txidNeutralized1)
        let offset
        if(trade.status=="unpublished"){
            await Scaling.settlementLimbo(txid) //Must check settlement limbo for references in logic of channel trades
        }else if(trade.status=="expiredContract"){
            await Logic.typeSwitch(19,trade.params)
        }else if(trade.status=="expiredToken"){
            await Logic.typeSwitch(20,trade.params)
        }else if((trade.status=="liveContract"||trade.status=="expiredContract")&&close==true){
            offset = Scaling.generateOffset(trade.params,markPrice)
            await Logic.typeSwitch(19,offset.params)
        }else if((trade.status=="liveContract"||trade.status=="expiredContract")&&close==true){
            offset = Scaling.generateOffset(trade.params,markPrice)
            await Logic.typeSwitch(20,offset.params)
        }else if(trade.status=="live"&&!close){
            const last = await Scaling.queryPriorSettlements(txidNuetralized1, txidNeutralized2, channelAddress)
            const settlement = await Scaling.settlePNL(last,mark,txidNuetralized1)
        }
      
        console.log(`PNL settled for channel ${channelAddress}, contract ${contractId}`);
        return
    },

		exerciseDerivative(sender, txParams,block) {
		    const { contractId, amount } = txParams;

            // Check if the contractId has more hyphens and contains 'P' or 'C'
            const hyphenCount = (contractId.match(/-/g) || []).length;
            const hasPOrC = /[PC]/.test(contractId);
            const isOption = Boolean(hyphenCount >= 2 && hasPOrC);
            const marginMap = MarginMap.getInstance(contractId)
		    if(!isOption){
		          this.deliverContract(sender, contractId, amount,block);
		        }else if(isOption){
                  this.handleOptionExercise(sender,contractId, amount,block);
            }
		},


        deliverContract(contractId, amount,block) {
            // Logic for contract delivery
            // This would involve transferring tokens from the contract to the exercising party
            // Eliminate the contract positions

            // Retrieve contract details and involved parties' balances
            // Assume existence of functions getContractDetails and getAddressBalance
            const contractDetails = ContractRegistry.getContractDetails(contractId);
            const senderBalance = this.getAddressBalance(contractDetails.senderAddress, propertyId);
            const receiverBalance = this.getAddressBalance(contractDetails.receiverAddress, propertyId);

            // Transfer tokens based on contract terms
            if (senderBalance >= amount) {
                this.updateBalance(contractDetails.senderAddress, propertyId, -amount, 0 ,0,0,'deliver');
                this.updateBalance(contractDetails.receiverAddress, propertyId, amount,0,0,0,'receiveExercise');
            } else {
                throw new Error('Insufficient balance for contract delivery');
            }

            // Eliminate the contract
            this.removeContract(contractId);
        },

        handleOptionExercise(contractId, propertyId1, propertyId2, numberOfContracts, block) {
            // Logic for handling option exercise
            // Notional value of the contract is based on the strike price
            // Eliminate the contract positions

            // Retrieve contract details
            const contractDetails = this.getContractDetails(contractId);
            const strikePrice = contractDetails.strikePrice; // The strike price of the option

            // Calculate the notional value based on the strike price
            const notionalValue = numberOfContracts * strikePrice;

            // Retrieve balances of involved parties
            const balanceProperty1 = this.getAddressBalance(contractDetails.holderAddress, propertyId1);
            const balanceProperty2 = this.getAddressBalance(contractDetails.writerAddress, propertyId2);

            // Execute the exchange if balances are sufficient
            if (balanceProperty1 >= notionalValue && balanceProperty2 >= numberOfContracts) {
                // Holder of the option (buyer) exercises the option
                this.updateBalance(contractDetails.holderAddress, propertyId1, -notionalValue);
                this.updateBalance(contractDetails.holderAddress, propertyId2, numberOfContracts);

                // Writer of the option (seller) fulfills the option
                this.updateBalance(contractDetails.writerAddress, propertyId1, notionalValue);
                this.updateBalance(contractDetails.writerAddress, propertyId2, -numberOfContracts);
            } else {
                throw new Error('Insufficient balance for option exercise');
            }

            // Eliminate the contract
            this.removeContract(contractId);
        },

		async mintSynthetic(address, propertyId, contractId, amount, block, grossRequired, contracts, margin,) {
		    // Check if it's the first instance of this synthetic token
		    const syntheticTokenId = `s-${propertyId}-${contractId}`;
            const propertyManager = PropertyManager.getInstance()
            if(amount<0){
                amount = Math.abs(amount)
            }
            if(margin<0){
                margin = Math.abs(margin)
            }

            const marginMap = await MarginMap.getInstance(contractId)
            let propertyInfo = await PropertyManager.getPropertyData(propertyId)
            let ticker = propertyInfo.ticker
            let synthTicker = 's'+ticker+'-'+contractId
            //console.log('fetched collateral ticker in mint synthetic '+ticker)
            const contractInfo = await ContractRegistry.getContractInfo(contractId)
		    // Issue the synthetic token
		    await propertyManager.addProperty(syntheticTokenId, synthTicker, amount, 'Synthetic',contractInfo.whitelist,syntheticTokenId,null);
            let contractsAndMargin = await marginMap.moveMarginAndContractsForMint(address, propertyId, contractId, contracts, margin)

            //console.log('calculating adjustment to grossRequired '+grossRequired+' '+contractsAndMargin.excess+' '+contractsAndMargin.margin)
            grossRequired = BigNumber(grossRequired).plus(contractsAndMargin.excess).decimalPlaces(8).toNumber()
            //console.log('about to issue amount '+amount)
            await TallyMap.updateBalance(address, syntheticTokenId,amount,0,0,0,'issueSynth',block)
            await TallyMap.updateBalance(address, propertyId,-grossRequired,0,-contractsAndMargin.margin,0,'issueSynth',block)
            
            let exists = await SynthRegistry.exists(syntheticTokenId)

            if (!exists) {
                console.log('creating new synth '+syntheticTokenId)
                await SynthRegistry.createVault(propertyId, contractId);
                await SynthRegistry.registerSyntheticToken(syntheticTokenId, contractId, propertyId);
                console.log('about to update new vault'+syntheticTokenId+' '+contractsAndMargin+' '+amount)
                await SynthRegistry.updateVault(syntheticTokenId,contractsAndMargin,amount, grossRequired)
            } else {
                console.log('about to update existing vault'+syntheticTokenId+' '+contractsAndMargin+' '+amount)
                await SynthRegistry.updateVault(syntheticTokenId, contractsAndMargin,amount, grossRequired);
            }
            
		    // Log the minting of the synthetic token
		    console.log(`Minted ${amount} of synthetic token ${syntheticTokenId}`);

            return
		},

		async redeemSynthetic(address, propertyId, contractId, amount,block) {
		    
            // Split the string by hyphens
            const parts = propertyId.split('-');

            // The middle part (index 1) is the collateral property
            const collateralProperty = parseInt(parts[1], 10);

            // Redeem the synthetic token
		    const vault = await SynthRegistry.getVault(propertyId);
            console.log('inside redeem synthetic logic '+vault.outstanding+' '+JSON.stringify(vault))
            if (!vault) {
                console.log('no vault found')
                return Error('Synthetic token vault not found');
            }

		    if (vault.outstanding < amount) {
                console.log('vault shortfall')
		        throw new Error('Insufficient synthetic token balance for redemption');
		    }

            const marginMap = await MarginMap.getInstance(contractId)
            const contractInfo = await ContractRegistry.getContractInfo(contractId)
            let mark = 0
            if(contractInfo.native){
                let pair = contractInfo.onChainData[0][0]+"-"+contractInfo.onChainData[0][1]
                mark = await VolumeIndex.getLastPrice(pair,block)
            }else{
                mark = OracleList.getOraclePrice(contractInfo.underlyingOracleId)   
            }
            const initMarginPerContract= await ContractRegistry.getInitialMargin(contractId, mark)

            const notionalValue = contractInfo.notionalValue
            let contractsAndMargin = await marginMap.moveMarginAndContractsForRedeem(address, propertyId, contractId, amount,vault,notionalValue,initMarginPerContract,mark)

            // Update synthetic token property
            await PropertyManager.updateTotalInCirculation(propertyId, -amount);
            await TallyMap.updateBalance(address, propertyId,-amount,0,0,0,'redeemSynth',block)
            await TallyMap.updateBalance(address, collateralProperty,contractsAndMargin.available,0,contractsAndMargin.margin,0,'redeemSynth',block)
            
            if(contractsAndMargin.rPNL!=0){
                 await TallyMap.updateBalance(address, collateralProperty, contractsAndMargin.rPNL, 0, 0, 0, 'closingLongsWithRedemption',block)
            }
            
            if(contractsAndMargin.reduction!=0){
                 await TallyMap.updateBalance(address, collateralProperty, contractsAndMargin.reduction, 0, -contractsAndMargin.reduction, 0, 'contractRedeemMarginReturn',block)              
            }
            console.log('contracts and Margin before update Vault '+JSON.stringify(contractsAndMargin))
		    await SynthRegistry.updateVaultRedeem(propertyId, contractsAndMargin,-amount);


		    // Log the redemption of the synthetic token
		    console.log(`Redeemed ${amount} of synthetic token ${propertyId}`);
            return
		},

	// payToTokens: Distributes propertyIdUsed tokens to holders of propertyIdTarget tokens
	async payToTokens(propertyIdTarget, propertyIdUsed, amount,address,block) {
	    // Check if enough tokens of propertyIdUsed are available for distribution
	    const totalAvailable = tallyMap.totalTokens(propertyIdUsed);
	    if (totalAvailable < amount) {
	        throw new Error('Insufficient tokens for distribution');
	    }

	    // Calculate total holdings of propertyIdTarget
	    const totalHoldingTarget = tallyMap.totalTokens(propertyIdTarget);
	    if (totalHoldingTarget <= 0) {
	        throw new Error('No holders for target token');
	    }

	    // Calculate and distribute tokens to each holder
	    let remainingAmount = new BigNumber(amount);
	    for (const [address, balances] of tallyMap.addresses.entries()) {
	        const targetBalance = balances[propertyIdTarget];
	        if (targetBalance && targetBalance.available > 0) {
	            // Calculate the holder's share
	            const share = new BigNumber(targetBalance.available).dividedBy(totalHoldingTarget);
	            const payout = share.multipliedBy(amount);

	            // Distribute if the payout is significant (>= 0.00000001)
	            if (payout.isGreaterThanOrEqualTo(new BigNumber('0.00000001'))) {
	                // Update balances
	                TallyMap.updateBalance(address, propertyIdUsed, -payout.toNumber(),0,0,0, 'payToTokens',block);
	                remainingAmount = remainingAmount.minus(payout);

	                console.log(`Distributed ${payout.toFixed()} of token ${propertyIdUsed} to holder ${address}`);
	            }
	        }
	    }

	    // Handle any remaining amount, possibly due to rounding
	    if (!remainingAmount.isZero()) {
	        // Choose a strategy to distribute the remaining amount
	        // For example, add to a general pool, burn it, or send to a specific address
	        // Example: send to a designated address
	        const designatedAddress = 'some_designated_address';
	        TallyMap.updateBalance(address, propertyIdUsed, remainingAmount.toNumber(),0,0,0,'payToTokensRounding',block);
	        console.log(`Remaining ${remainingAmount.toFixed()} of token ${propertyIdUsed} sent to ${designatedAddress}`);
	    }

	    // Save the updated state of the TallyMap
	    await tallyMap.save(currentBlockHeight); // Replace currentBlockHeight with actual block height
	},


     createOptionChain(seriesId, strikePercentInterval, isEuropeanStyle) {
        if (!this.isValidSeriesId(seriesId)) {
            throw new Error('Invalid series ID');
        }

        // Assuming you have a method to get the expiry intervals and other necessary data for a series
        const seriesData = this.getSeriesData(seriesId);
        const optionChain = [];

        seriesData.expiryIntervals.forEach(expiryInterval => {
            // Calculate strike prices based on the strikePercentInterval and underlying asset price
            const strikePrices = this.calculateStrikePrices(seriesData.underlyingAssetPrice, strikePercentInterval);

            strikePrices.forEach(strikePrice => {
                // Generate contract IDs for both Put and Call options
                const putContractId = `${seriesId}-${expiryInterval}-P-${strikePrice}`;
                const callContractId = `${seriesId}-${expiryInterval}-C-${strikePrice}`;

                optionChain.push({
                    contractId: putContractId,
                    type: 'Put',
                    strikePrice: strikePrice,
                    expiryBlockHeight: expiryInterval,
                    isEuropeanStyle: isEuropeanStyle
                });

                optionChain.push({
                    contractId: callContractId,
                    type: 'Call',
                    strikePrice: strikePrice,
                    expiryBlockHeight: expiryInterval,
                    isEuropeanStyle: isEuropeanStyle
                });
            });
        });

        // Optionally, register these contracts in your system's registry
        // this.registerOptionContracts(optionChain);

        return optionChain;
    },

    // Helper function to calculate strike prices
    calculateStrikePrices(assetPrice, percentInterval) {
        // Logic to calculate an array of strike prices based on the asset price and percentage interval
        // For simplicity, let's say we generate a fixed number of strike prices above and below the asset price
        const strikePrices = [];
        const numStrikes = 5; // Number of strike prices above and below the current price

        for (let i = -numStrikes; i <= numStrikes; i++) {
            const strikePrice = assetPrice * (1 + (i * percentInterval / 100));
            strikePrices.push(strikePrice);
        }

        return strikePrices;
    },

	async tradeBaiUrbun(tallyMap, marginMap, channelRegistry, channelAddress, propertyIdDownPayment, propertyIdToBeSold, downPaymentPercentage, price, amount, expiryBlock, tradeExpiryBlock) {
	    // Validate inputs and check balances
	    if (!channelRegistry.hasChannel(channelAddress)) {
	        throw new Error('Invalid channel address');
	    }

	    const channel = channelRegistry.getChannel(channelAddress);
	    const { committerA, committerB } = channel; // Assuming the channel has committerA and committerB

	    // Calculate down payment amount
	    const downPaymentAmount = (downPaymentPercentage / 10000) * amount; // Convert basis points to actual amount

	    // Check if committers have enough balance for the trade
	    if (!tallyMap.hasSufficientBalance(committerA, propertyIdToBeSold, amount)) {
	        throw new Error('Seller (Committer A) has insufficient token balance for the property to be sold');
	    }
	    if (!tallyMap.hasSufficientBalance(committerB, propertyIdDownPayment, downPaymentAmount)) {
	        throw new Error('Buyer (Committer B) has insufficient token balance for down payment');
	    }

		    const baiUrbunContract = {
	        type: 'BaiUrbun',
	        propertyIdDownPayment,
	        propertyIdToBeSold,
	        downPaymentPercent,
	        downPaymentAmount,
	        totalAmount: amount,
	        expiryBlock,
	        tradeExpiryBlock,
	        contractId: `B-${propertyIdToBeSold}-${propertyIdDownPayment}-${expiryBlock}`
    	};

	    // Add the contract to the Bai Urbun registry
	    await contractsRegistry.baiUrbun.addContract(baiUrbunContract);

	    // Generate contract ID for Bai Urbun
	    const contractId = `B-${propertyIdToBeSold}-${propertyIdDownPayment}-${expiryBlock}`;

	    // Reserve the property and down payment in the tallyMap
	    tallyMap.updateBalance(committerA, propertyIdToBeSold, -amount, 'available');
	    tallyMap.updateBalance(committerA, propertyIdToBeSold, amount, 'reserved');
	    tallyMap.updateBalance(committerB, propertyIdDownPayment, -downPaymentAmount, 'available');
	    tallyMap.updateBalance(committerB, propertyIdDownPayment, downPaymentAmount, 'reserved');

	    // Update marginMap for Bai Urbun contract
	    marginMap.updateContractBalance(committerA, contractId, amount, 'positive');
	    marginMap.updateContractBalance(committerB, contractId, amount, 'negative');

	    console.log(`Created Bai Urbun contract with ID ${contractId} in channel ${channelAddress}`);

	    // Record the contract creation in the BaiUrbun registry
	    // Additional logic to add the contract to the BaiUrbun registry
	    // ...

	    return contractId;
	},


	tradeMurabaha(channelAddress, buyerAddress, sellerAddress, propertyId, costPrice, profitMargin, paymentBlockHeight) {
	    // Check if the channel exists
	    const channel = this.channelsRegistry.get(channelAddress);
	    if (!channel) {
	        throw new Error('Channel not found');
	    }

	    // Validate addresses and amounts
	    TxUtils.validateAddresses(buyerAddress, sellerAddress);
	    TxUtils.validateAmounts(costPrice, profitMargin);
	     // Example: Update margin at the time of agreement
	    marginMap.updateMargin(buyerAddress, propertyId, -(costPrice + profitMargin)); // Buyer's margin decreases by total payment amount
    	marginMap.updateMargin(sellerAddress, propertyId, costPrice); // Seller's margin increases by the cost price


	    // Logic for Murabaha contract
	    // Record the cost and profit margin
	    channel.contracts.push({
	        type: 'Murabaha',
	        buyerAddress,
	        sellerAddress,
	        propertyId,
	        costPrice,
	        profitMargin,
	        paymentBlockHeight
	    });

	    console.log(`Murabaha contract created in channel ${channelAddress}`);
	},

    issueInvoice(propertyManager, invoiceRegistry, propertyIdToReceivePayment, amount, dueDateBlock, propertyIdCollateral = null, receivesPayToToken = false, issuerNonce) {
	    // Validate input parameters
	    if (!propertyManager.isPropertyIdValid(propertyIdToReceivePayment)) {
	        throw new Error('Invalid property ID to receive payment');
	    }
	    if (propertyIdCollateral && !propertyManager.isPropertyIdValid(propertyIdCollateral)) {
	        throw new Error('Invalid property ID for collateral');
	    }

	    // Generate an invoice ID
	    const invoiceId = `${propertyIdToReceivePayment}-${dueDateBlock}-${issuerNonce}`;

	    // Create the invoice object
	    const invoice = {
	        invoiceId,
	        propertyIdToReceivePayment,
	        amount,
	        dueDateBlock,
	        collateral: propertyIdCollateral ? {
	            propertyId: propertyIdCollateral,
	            locked: receivesPayToToken,
	        } : null,
	    };

	    // Register the invoice in the invoice registry
	    invoiceRegistry.registerInvoice(invoice);

	    console.log(`Invoice issued with ID: ${invoiceId}`);

	    // Optionally, if collateral is involved and receives payToToken, lock the collateral
	    if (invoice.collateral && receivesPayToToken) {
	        // Logic to lock collateral in association with this invoice
	        // This might involve updating a collateral registry or similar system
	    }

	    // Return the invoice ID for reference
	    return invoiceId;
	},

	batchMoveZkRollup(zkVerifier, rollupData, zkProof) {
	    // Parse the Zero-Knowledge rollup data
	    let transactions;
	    try {
	        transactions = JSON.parse(rollupData); // Assuming rollupData is a JSON string
	    } catch (error) {
	        throw new Error('Invalid rollup data format');
	    }

	    // Validate the structure of the parsed data
	    if (!isValidRollupDataStructure(transactions)) {
	        throw new Error('Invalid rollup data structure');
	    }

	    // Verify the Zero-Knowledge proof
	    if (!zkVerifier.verify(zkProof, transactions)) {
	        throw new Error('Invalid Zero-Knowledge proof');
	    }

	    // Process each transaction in the batch
	    transactions.forEach(transaction => {
	        const { fromAddress, toAddress, propertyId, amount } = transaction;

	        // Perform necessary checks and balances updates for each transaction
	        // For example, debiting from one address and crediting to another
	        // This will involve interaction with a ledger or database
	    });

	    console.log('Batched transactions processed successfully');

	    // Placeholder for additional proof logics to be parsed later
	    // Implement as per the specific requirements of the rollup data and proofs

	    // Return success or a summary of the processed transactions
	    return { status: 'success', transactionsProcessed: transactions.length };
	},

		// Helper function to validate the structure of the rollup data
    isValidRollupDataStructure(transactions) {
		    // Implement validation logic based on expected format
		    // For example, checking for required fields in each transaction object
		    return transactions.every(transaction => 
		        transaction.hasOwnProperty('fromAddress') &&
		        transaction.hasOwnProperty('toAddress') &&
		        transaction.hasOwnProperty('propertyId') &&
		        transaction.hasOwnProperty('amount')
		    );
	},

    batchSettlement(sender, params, txid, block){

    },

    publishNewTx(ordinalRevealJSON, jsCode) {
    // Validate the input JSON and JavaScript code
    if (!isValidJSON(ordinalRevealJSON)) {
        throw new Error('Invalid Ordinal Reveal JSON');
    }
    if (!isValidJavaScript(jsCode)) {
        throw new Error('Invalid JavaScript code');
    }

    // Minify the JavaScript code (assuming a minification function exists)
    const minifiedJsCode = minifyJavaScript(jsCode);

    // Assign a new transaction type ID
    const newTxTypeId = getNextTxTypeId();

    // Construct the new transaction with the ordinal reveal JSON and minified JS code
    const newTx = {
        txTypeId: newTxTypeId,
        ordinalRevealJSON: ordinalRevealJSON,
        smartContractCode: minifiedJsCode
    };

        // Save the new transaction to the system's registry
        // Assuming a function to save the transaction exists
        saveNewTransaction(newTx);

        console.log(`Published new transaction type ID ${newTxTypeId}`);

        // Return the new transaction type ID and details
        return { newTxTypeId, newTx };
    },

    bindSmartContract(){},

    mintColoredCoin(/* parameters */) { /* ... */ }
};

module.exports = Logic;

// Example function to create and register a new token