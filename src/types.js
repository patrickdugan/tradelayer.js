// Import the encoding functions from txEncoder.js
const Encode = require('./txEncoder'); // Update the path to your txEncoder.js file

// Import the decoding functions from txDecoder.js
const Decode = require('./txDecoder'); // Update the path to your txDecoder.js file
const Validity = require('./validity');
const TxUtils = require('./txUtils')
const TxIndex = require('./txIndex.js')
const BigNumber = require('bignumber.js')

const Types = {
  // Function to encode a payload based on the transaction ID and parameters
  encodePayload: (transactionId, params) => {
    let payload = "tl"
    payload+=transactionId.toString(36);
    console.log(transactionId)
    switch (transactionId) {
            case 0:
                payload += Encode.encodeActivateTradeLayer(params);
                break;
            case 1:
                payload += Encode.encodeTokenIssue(params);
                break;
            case 2:
                payload += Encode.encodeSend(params);
                break;
            case 3:
                payload += Encode.encodeTradeTokenForUTXO(params);
                break;
            case 4:
                payload += Encode.encodeCommitToken(params);
                break;
            case 5:
                payload += Encode.encodeOnChainTokenForToken(params);
                break;
            case 6:
                payload += Encode.encodeCancelOrder(params)
                break;
            case 7:
                payload += Encode.encodeCreateWhitelist(params);
                break;
            case 8:
                payload += Encode.encodeUpdateAdmin(params);
                break;
            case 9:
                payload += Encode.encodeIssueOrRevokeAttestation(params);
                break;
            case 10:
                payload += Encode.encodeAMMPool(params);
                break;
            case 11:
                payload += Encode.encodeGrantManagedToken(params);
                break;
            case 12:
                payload += Encode.encodeRedeemManagedToken(params);
                break;
            case 13:
                payload += Encode.encodeCreateOracle(params);
                break;
            case 14:
                payload += Encode.encodePublishOracleData(params);
                break;
            case 15:
                payload += Encode.encodeCloseOracle();
                break;
            case 16:
                payload += Encode.encodeCreateFutureContractSeries(params);
                break;
            case 17:
                payload += Encode.encodeExerciseDerivative(params);
                break;
            case 18:
                payload += Encode.encodeTradeContractOnchain(params);
                break;
            case 19:
                payload += Encode.encodeTradeContractChannel(params);
                break;
            case 20:
                payload += Encode.encodeTradeTokensChannel(params);
                break;
            case 21:
                payload += Encode.encodeWithdrawal(params);
                break;
            case 22:
                payload += Encode.encodeTransfer(params);
                break;
            case 23:
                payload += Encode.encodeSettleChannelPNL(params);
                break;
            case 24:
                payload += Encode.encodeMintSynthetic(params);
                break;
            case 25:
                payload += Encode.encodeRedeemSynthetic(params);
                break;
            case 26:
                payload += Encode.encodePayToTokens(params);
                break;
           
      default:
        throw new Error('Unknown transaction type');
    }

    return payload;
  },

  // Function to decode a payload based on the transaction ID and encoded payload
   decodePayload: async (txId, type, marker, encodedPayload,sender,reference, senderAmount,referenceAmount, block) => {
    let index = 0;
    let params = {};

    if (marker !='tl'){
      return Error('Invalid payload');
    }
    console.log('checking that type is here '+type+' '+block)
    switch (type) {
       case 0:
                console.log('decoding activate '+encodedPayload)
                params = Decode.decodeActivateTradeLayer(encodedPayload.substr(index));
                console.log('validating activate '+JSON.stringify(params))
                params.block=block
                params = await Validity.validateActivateTradeLayer(sender, params,txId)     
                //console.log('back from validity function'+JSON.stringify(params)+' validated '+params.valid + ' reason '+params.reason)
                break;
            case 1:
                //console.log('decoding issuance '+params)
                params = Decode.decodeTokenIssue(encodedPayload.substr(index));
                params.senderAddress = sender
                //console.log('validating issuance '+JSON.stringify(params))
                params.block=block
                params = await Validity.validateTokenIssue(sender, params,txId)               
                //console.log(JSON.stringify(params)+' validated '+params.valid + ' reason '+params.reason)
                break;
            case 2:
                //console.log('decoding send '+params)
                params = Decode.decodeSend(encodedPayload.substr(index));
                console.log('validating send '+JSON.stringify(params))
                params.senderAddress= sender
                params.txid = txId
                params.block=block
                params = await Validity.validateSend(sender, params, txId)
                console.log(JSON.stringify(params)+' validated '+params.valid + ' reason '+params.reason)
                break;
            case 3:
                    // This one is a bit different because we're also looking at TxUtil deconstruction of the UTXOs
                    // If we're working in API mode, we may need a flag to check, like if(params.API){outcall}else{TxUtils.decode}
                    console.log('inside case for type 3 '+encodedPayload)
                    params = Decode.decodeTradeTokenForUTXO(encodedPayload.substr(index));
                    console.log(JSON.stringify(params))
                    params.senderAddress = sender;
                    params.txid = txId;
                    params.block=block
                  // Find the payment address and delivery address from the reference data
                    console.log('inside type for utxo trade '+reference)
                    const paymentReference = reference.find(ref => ref.vout === params.payToAddress);
                    const tokenDeliveryReference = reference.find(ref => ref.vout === params.tokenOutput);
                    console.log('inside types for UTXO '+JSON.stringify(paymentReference)+' '+JSON.stringify(tokenDeliveryReference))
                    if(params.tagWithdraw!=null&&Number.isInteger(params.tagWithdraw)){
                        const coldWithdrawObject = reference.find(ref => ref.vout === params.tagWithdraw);

                        if (coldWithdrawObject) {
                            // Assign the address of the matching object
                            const params.tagWithdraw = coldWithdrawObject.address;
                            console.log(`Cold withdraw address: ${coldWithdrawAddress}`);
                        } else {
                            console.log(`No matching vout found for tagWithdraw: ${params.tagWithdraw}`);
                        }
                    }
                    
                if (paymentReference && tokenDeliveryReference) {
                    params.satsPaymentAddress = paymentReference.address;
                    params.satsDelivered = new BigNumber(paymentReference.satoshis).dividedBy(1e8).toNumber();  // Convert satoshis to LTC or token equivalent
                    params.tokenDeliveryAddress = tokenDeliveryReference.address;
                    console.log('params '+params.satsPaymentAddress+ ' '+params.satsDelivered+' '+params.tokenDeliveryAddress)
                    // Call the validate function with the updated params
                    params = await Validity.validateTradeTokenForUTXO(sender, params, txId, reference);
                } else {
                    params.valid = false
                    params.reason = "Missing outputs"
                }           
                      
                break;

            case 4:
                params = Decode.decodeCommitToken(encodedPayload.substr(index));
                params.senderAddress= sender
                params.txid = txId
                params.block=block
                params = await Validity.validateCommit(sender, params, txId)
                break;
            case 5:
                params = Decode.decodeOnChainTokenForToken(encodedPayload.substr(index));
                console.log('validating token trade '+JSON.stringify(params))
                params.senderAddress= sender
                params.txid=txId
                params.block=block
                params = await Validity.validateOnChainTokenForToken(sender, params, txId)
                console.log(JSON.stringify(params)+' validated '+params.valid + ' reason '+params.reason)
                break;
            case 6:
                params = Decode.decodeCancelOrder(encodedPayload.substr(index))
                params.senderAddress= sender
                params.txid=txId
                params.block=block
                params = await Validity.validateCancelOrder(sender, params, txId)
                console.log(JSON.stringify(params)+' validated '+params.valid + ' reason '+params.reason)
                break;
            case 7:
                params.block=block
                params = Decode.decodeCreateWhitelist(encodedPayload.substr(index));
                params = await Validity.validateCreateWhitelist(sender, params, txId)
                break;
            case 8:
                params.block=block
                params = Decode.decodeUpdateAdmin(encodedPayload.substr(index));
                params = await Validity.validateUpdateAdmin(sender, params, txId)
                break;
            case 9:
                params.block=block
                params = Decode.decodeIssueOrRevokeAttestation(encodedPayload.substr(index));
                params = await Validity.validateIssueOrRevokeAttestation(sender, params, txId)
                break;
            case 10:
                params = Decode.decodeAMMPool(encodedPayload.substr(index));
                params.senderAddress= sender
                params.txid=txId
                params.block=block
                params = await Validity.validateAMMPool(sender, params, txId)
                break;
            case 11:
                params = Decode.decodeGrantManagedToken(encodedPayload.substr(index));
                params.senderAddress= sender
                params.txid=txId
                params.block=block
                params = await Validity.validateGrantManagedToken(sender, params, txId)
                console.log(JSON.stringify(params)+' validated '+params.valid + ' reason '+params.reason)
                break;
            case 12:
                params = Decode.decodeRedeemManagedToken(encodedPayload.substr(index));
                params.senderAddress= sender
                params.txid=txId
                params.block=block
                params = await Validity.validateRedeemManagedToken(sender, params, txId)
                console.log(JSON.stringify(params)+' validated '+params.valid + ' reason '+params.reason)
                break;
            case 13:
                params = Decode.decodeCreateOracle(encodedPayload.substr(index));
                params.senderAddress= sender
                params.txid=txId
                params.block=block
                console.log('validating create Oracle '+JSON.stringify(params))
                params = await Validity.validateCreateOracle(sender, params, txId)
                console.log('validated oracle params '+JSON.stringify(params))
                break;
            case 14:
                params = Decode.decodePublishOracleData(encodedPayload.substr(index));
                console.log('publish oracle params '+ JSON.stringify(params))
                params.senderAddress= sender
                console.log('publish oracle sender '+sender)
                params.txid=txId
                params.block=block
                params = await Validity.validatePublishOracleData(sender, params, txId)
                break;
            case 15:
                params.block=block
                params = Decode.decodeCloseOracle(encodedPayload.substr(index));
                params = await Validity.validatePublishOracleData(sender, params, txId)
                break;
            case 16:
                params = Decode.decodeCreateFutureContractSeries(encodedPayload.substr(index));
                console.log('validating contract creation '+JSON.stringify(params))
                params.senderAddress= sender
                params.txid=txId
                params.block=block
                params = await Validity.validateCreateContractSeries(sender, params, txId)
                console.log(JSON.stringify(params)+' validated '+params.valid + ' reason '+params.reason)
                break;
            case 17:
                params = Decode.decodeExerciseDerivative(encodedPayload.substr(index));
                params.senderAddress= sender
                params.txid=txId
                params.block=block
                params = await Validity.validateExerciseDerivative(sender, params, txId)
                break;
            case 18:
                params = Decode.decodeTradeContractOnchain(encodedPayload.substr(index));
                console.log('initially decoded contract trade params '+JSON.stringify(params))
                params.block=block
                params.senderAddress= sender
                params.txid=txId
                params = await Validity.validateTradeContractOnchain(sender,params, txId)
                break;
            case 19:
                params = Decode.decodeTradeContractChannel(encodedPayload.substr(index));
                params.block=block
                //console.log('inside case 19 type decode '+params.block+' '+JSON.stringify(params))
                params.senderAddress= sender
                params.txid=txId
                params = await Validity.validateTradeContractChannel(sender, params, txId)
                //console.log('finishing types 19 '+JSON.stringify(params))
                break;
            case 20:
                params = Decode.decodeTradeTokensChannel(encodedPayload.substr(index));
                params.block=block
                params.senderAddress= sender
                params.txid=txId
                params = await Validity.validateTradeTokensChannel(sender, params,txId)
                break;
            case 21:
                params = Decode.decodeWithdrawal(encodedPayload.substr(index));
                params.block=block
                params.senderAddress= sender
                params.txid=txId
                params = await Validity.validateWithdrawal(sender, params, txId)
                break;
            case 22:
                params = Decode.decodeTransfer(encodedPayload.substr(index));
                params.block=block
                params.senderAddress= sender
                params.txid=txId
                params = await Validity.validateTransfer(sender, params, txId)
                break;
            case 23:
                params = Decode.decodeSettleChannelPNL(encodedPayload.substr(index));
                params.block=block
                params.senderAddress= sender
                params.txid=txId
                params = await Validity.validateSettleChannelPNL(sender, params, txId)
                break;
            case 24:
                params = Decode.decodeMintSynthetic(encodedPayload.substr(index));
                params.block=block
                params.senderAddress= sender
                params.txid=txId
                params = await Validity.validateMintSynthetic(sender, params, txId)
                break;
            case 25:
                params = Decode.decodeRedeemSynthetic(encodedPayload.substr(index));
                params.block=block
                params.senderAddress= sender
                params.txid=txId
                params = await Validity.validateRedeemSynthetic(sender, params, txId)
                break;
            case 26:
                params = Decode.decodePayToTokens(encodedPayload.substr(index));
                params.block=block
                params.senderAddress= sender
                params.txid=txId
                params = await Validity.validatePayToTokens(sender, params, txId)
                break;
            case 27:
                params = Decode.decodeCreateOptionChain(encodedPayload.substr(index));
                params.block=block 
                params.senderAddress= sender
                params.txid=txId
                params = await Validity.validateCreateOptionChain(sender, params, txId)
                break;
            case 28:
                params = Decode.decodeTradeBaiUrbun(encodedPayload.substr(index));
                params.block=block
                params.senderAddress= sender
                params.txid=txId
                params = await Validity.validateTradeBaiUrbun(sender, params, txId)
                break;
            case 29:
                params = Decode.decodeTradeMurabaha(encodedPayload.substr(index));
                params.block=block
                params.senderAddress= sender
                params.txid=txId
                params = await Validity.validateTradeMurabaha(sender, params, txId)
                break;
            case 30:
                params = Decode.decodeIssueInvoice(encodedPayload.substr(index));
                params.block=block
                params.senderAddress= sender
                params.txid=txId
                params = await Validity.validateIssueInvoice(sender, params, txId)
                break;    
            case 31:
                params = Decode.decodeBatchSettlement(encodedPayload.substr(index));
                params.block=block
                params.senderAddress= sender
                params.txid=txId
                //params = await Validity.validatePublishNewTx(sender, params, block)
                break;
            case 32:
                params = Decode.decodeBatchMoveZkRollup(encodedPayload.substr(index));
                params.block=block
                params.senderAddress= sender
                params.txid=txId
                //params = await Validity.validateBatchMoveZkRollup(sender, params, block)
                break;
            case 33:
                params = Decode.decodeColoredCoin(encodedPayload.substr(index));
                params.block=block
                params.senderAddress= sender
                params.txid=txId
                //params = await Validity.validateColoredCoin(sender, params, block)
                break;
            case 34:
                params = Decode.decodeCrossLayerBridge(encodedPayload.substr(index));
                params.block=block
                params.senderAddress= sender
                params.txid=txId
                //params = await Validity.validateCriossLayerBridge(sender, params, block)
                break;
            case 35:
                params = Decode.decodeSmartContractBind(encodedPayload.substr(index));
                params.block=block
                params.senderAddress= sender
                params.txid=txId
                //params = await Validity.validateSmartContractBind(sender, params, block)
                break;
          default:
            throw new Error('Unknown transaction type');
        }
            return params 
    }
};

module.exports = Types;