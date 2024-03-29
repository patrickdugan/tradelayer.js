const Encode = require('./txEncoder.js')
const Decode = require('./txDecoder.js')
const Validity = require('./validity.js')

const Types = {
    // Function to encode a payload based on the transaction ID and parameters
    encodePayload: (transactionId, params) => {
        let payload = "tl"
        payload += transactionId.toString(36)
        console.log(transactionId)
        switch (transactionId) {
            case 0:
                payload += Encode.encodeActivateTradeLayer(params)
                break;
            case 1:
                payload += Encode.encodeTokenIssue(params)
                break;
            case 2:
                payload += Encode.encodeSend(params)
                break;
            case 3:
                payload += Encode.encodeTradeTokenForUTXO(params)
                break;
            case 4:
                payload += Encode.encodeCommitToken(params)
                break;
            case 5:
                payload += Encode.encodeOnChainTokenForToken(params)
                break;
            case 6:
                payload += Encode.encodeCancelOrder(params)
                break;
            case 7:
                payload += Encode.encodeCreateWhitelist(params)
                break;
            case 8:
                payload += Encode.encodeUpdateAdmin(params)
                break;
            case 9:
                payload += Encode.encodeIssueAttestation(params)
                break;
            case 10:
                payload += Encode.encodeRevokeAttestation(params)
                break;
            case 11:
                payload += Encode.encodeGrantManagedToken(params)
                break;
            case 12:
                payload += Encode.encodeRedeemManagedToken(params)
                break;
            case 13:
                payload += Encode.encodeCreateOracle(params)
                break;
            case 14:
                payload += Encode.encodePublishOracleData(params)
                break;
            case 15:
                payload += Encode.encodeCloseOracle()
                break;
            case 16:
                payload += Encode.encodeCreateFutureContractSeries(params)
                break;
            case 17:
                payload += Encode.encodeUpdateOracleAdmin(params)
                break;
            case 18:
                payload += Encode.encodeCloseOracle()
                break;
            case 19:
                payload += Encode.encodeCreateOracleFutureContract(params)
                break;
            case 20:
                payload += Encode.encodeExerciseDerivative(params)
                break;
            case 21:
                payload += Encode.encodeNativeContractWithOnChainData(params)
                break;
            case 22:
                payload += Encode.encodeTradeContractOnchain(params)
                break;
            case 23:
                payload += Encode.encodeTradeContractChannel(params)
                break;
            case 24:
                payload += Encode.encodeTradeTokensChannel(params)
                break;
            case 25:
                payload += Encode.encodeWithdrawal(params)
                break;
            case 26:
                payload += Encode.encodeTransfer(params)
                break;
            case 27:
                payload += Encode.encodeSettleChannelPNL(params)
                break;
            case 28:
                payload += Encode.encodeMintSynthetic(params)
                break;
            case 29:
                payload += Encode.encodeRedeemSynthetic(params)
                break;
            case 30:
                payload += Encode.encodePayToTokens(params)
                break;
            case 31:
                payload += Encode.encodePublishNewTx(params)
                break;
            case 32:
                payload += Encode.encodeCreateDerivativeOfLRC20OrRGB(params)
                break;
            case 33:
                payload += Encode.encodeRegisterOPCTVCovenant(params)
                break;
            case 34:
                payload += Encode.encodeMintColoredCoin(params)
                break;
            default:
                throw new Error('Unknown transaction type')
        }

        return payload;
    },

    // Function to decode a payload based on the transaction ID and encoded payload
    decodePayload: async (txId, type, marker, encodedPayload, sender, reference, senderAmount, referenceAmount, block) => {
        let index = 0;
        let params = {};

        if (marker != 'tl') {
            return Error('Invalid payload')
        }
        console.log('checking that type is here ' + type)
        switch (type) {
            case 0:
                //console.log('decoding activate '+params)
                params = Decode.decodeActivateTradeLayer(encodedPayload.substr(index))
                //console.log('validating activate '+JSON.stringify(params))
                params = await Validity.validateActivateTradeLayer(txId, params, sender)
                //console.log('back from validity function'+JSON.stringify(params)+' validated '+params.valid + ' reason '+params.reason)
                break;
            case 1:
                //console.log('decoding issuance '+params)
                params = Decode.decodeTokenIssue(encodedPayload.substr(index))
                params.senderAddress = sender
                //console.log('validating issuance '+JSON.stringify(params))
                params = await Validity.validateTokenIssue(params)
                //console.log(JSON.stringify(params)+' validated '+params.valid + ' reason '+params.reason)
                break;
            case 2:
                //console.log('decoding send '+params)
                params = Decode.decodeSend(encodedPayload.substr(index))
                console.log('validating send ' + JSON.stringify(params))
                params.senderAddress = sender
                params.txid = txId
                params = await Validity.validateSend(sender, params, txId)
                console.log(JSON.stringify(params) + ' validated ' + params.valid + ' reason ' + params.reason)
                break;
            case 3:
                params = Decode.decodeTradeTokenForUTXO(encodedPayload.substr(index))
                break;
            case 4:
                params = Decode.decodeCommitToken(encodedPayload.substr(index))
                break;
            case 5:
                params = Decode.decodeOnChainTokenForToken(encodedPayload.substr(index))
                console.log('validating token trade ' + JSON.stringify(params))
                params.senderAddress = sender
                params.txid = txId
                params = await Validity.validateOnChainTokenForToken(sender, params, txId)
                console.log(JSON.stringify(params) + ' validated ' + params.valid + ' reason ' + params.reason)
                break;
            case 6:
                params = Decode.decodeCancelOrder(encodedPayload.substr(index))
                break;
            case 7:
                params = Decode.decodeCreateWhitelist(encodedPayload.substr(index))
                break;
            case 8:
                params = Decode.decodeUpdateAdmin(encodedPayload.substr(index))
                break;
            case 9:
                params = Decode.decodeIssueAttestation(encodedPayload.substr(index))
                break;
            case 10:
                params = Decode.decodeRevokeAttestation(encodedPayload.substr(index))
                break;
            case 11:
                params = Decode.decodeGrantManagedToken(encodedPayload.substr(index))
                break;
            case 12:
                params = Decode.decodeRedeemManagedToken(encodedPayload.substr(index))
                break;
            case 13:
                params = Decode.decodeCreateOracle(encodedPayload.substr(index))
                params.senderAddress = sender
                params.txid = txId
                console.log('validating create Oracle ' + JSON.stringify(params))
                params = await Validity.validateCreateOracle(sender, params, txId)
                console.log('validated oracle params ' + JSON.stringify(params))
                break;
            case 14:
                params = Decode.decodePublishOracleData(encodedPayload.substr(index))
                params.senderAddress = sender
                params.txid = txId
                params = await Validity.validatePublishOracleData(sender, params, txId)
                break;
            case 15:
                params = Decode.decodeCloseOracle(encodedPayload.substr(index))
                break;
            case 16:
                params = Decode.decodeCreateFutureContractSeries(encodedPayload.substr(index))
                console.log('validating contract creation ' + JSON.stringify(params))
                params.senderAddress = sender
                params.txid = txId
                params = await Validity.validateCreateContractSeries(sender, params, txId)
                console.log(JSON.stringify(params) + ' validated ' + params.valid + ' reason ' + params.reason)
                break;
            case 17:
                params = Decode.decodeExerciseDerivative(encodedPayload.substr(index))
                break;
            case 18:
                params = Decode.decodeTradeContractOnchain(encodedPayload.substr(index))
                console.log('initially decoded contract trade params ' + JSON.stringify(params))
                params.senderAddress = sender
                params.txid = txId
                params = await Validity.validateTradeContractOnchain(params, sender, block)
                break;
            case 19:
                params = Decode.decodeTradeContractChannel(encodedPayload.substr(index))
                break;
            case 20:
                params = Decode.decodeTradeTokensChannel(encodedPayload.substr(index))
                break;
            case 21:
                params = Decode.decodeWithdrawal(encodedPayload.substr(index))
                params.senderAddress = sender
                params.txid = txId
                params = await Validity.validateWithdrawal(params, sender, block)
                break;
            case 22:
                params = Decode.decodeTransfer(encodedPayload.substr(index))
                break;
            case 23:
                params = Decode.decodeSettleChannelPNL(encodedPayload.substr(index))
                break;
            case 24:
                params = Decode.decodeMintSynthetic(encodedPayload.substr(index))
                break;
            case 25:
                params = Decode.decodeRedeemSynthetic(encodedPayload.substr(index))
                break;
            case 26:
                params = Decode.decodePayToTokens(encodedPayload.substr(index))
                break;
            case 27:
                params = Decode.decodeCreateOptionChain(encodedPayload.substr(index))
                break;
            case 28:
                params = Decode.decodeTradeBaiUrbun(encodedPayload.substr(index))
                break;
            case 29:
                params = Decode.decodeTradeMurabaha(encodedPayload.substr(index))
                break;
            case 30:
                params = Decode.decodeIssueInvoice(encodedPayload.substr(index))
                break;
            case 31:
                params = Decode.decodeBatchMoveZkRollup(encodedPayload.substr(index))
                break;
            case 32:
                params = Decode.decodePublishNewTx(encodedPayload.substr(index))
                break;
            case 33:
                params = Decode.decodeCreateDerivativeOfLRC20OrRGB(encodedPayload.substr(index))
                break;
            case 34:
                params = Decode.decodeRegisterOPCTVCovenant(encodedPayload.substr(index))
                break;
            case 35:
                params = Decode.decodeMintColoredCoin(encodedPayload.substr(index))
                break;
            default:
                throw new Error('Unknown transaction type')
        }
        return params
    }
}

module.exports = Types
