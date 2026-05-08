'use strict';

const { buildFixture } = require('./buildZkSignedChannelTransferDemo.js');

function main() {
    const fixture = buildFixture({
        propertyId: 1,
        amountUnits: process.env.TL_ZK_CHANNEL_AMOUNT_UNITS || '125000000',
        initialUnits: process.env.TL_ZK_CHANNEL_INITIAL_UNITS || '500000000',
        userPrivkeyHex: process.env.TL_ZK_CHANNEL_USER_PRIVKEY_HEX || '',
        operatorPrivkeyHex: process.env.TL_ZK_CHANNEL_OPERATOR_PRIVKEY_HEX || ''
    });

    console.log(JSON.stringify({
        ok: true,
        channelPathIntentHash: fixture.channelPathIntentHash,
        channelPathSigningTranscriptHash: fixture.channelPathSigningTranscriptHash,
        signedChannelTransferBatchHash: fixture.signedChannelTransferBatchHash,
        route: fixture.channelPathIntent.route,
        hops: fixture.channelPathIntent.hops,
        signedMessages: fixture.signingTranscript.signedMessages.map((message) => ({
            stepIndex: message.stepIndex,
            transferId: message.transferId,
            messageHash: message.messageHash,
            signerRoles: message.signatures.map((signature) => signature.role)
        }))
    }, null, 2));
}

main();
