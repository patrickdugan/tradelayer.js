const litecoin = require('litecoin');

const client = new litecoin.Client({
    host: '127.0.0.1',
    port: 8332, // Litecoin RPC port (default is 9332)
    user: 'user',
    pass: 'pass',
    timeout: 10000
});

var hasOPReturn= true;
var payload =""
var payload2= ""
var senderVout =0

const tx = "70d0cc07326bd1c55dbada54217d211933f1eef59fefd869aa12dfeb9fd6347d";

console.log("Fetching raw transaction...");

/*client.cmd('createwallet',function(err,wallet){
	console.log(wallet)
})*/

client.getRawTransaction(tx, true, function (err, rawtx) {
    if (err) {
        console.error("Error:", err);
    } else {
    	console.log(rawtx)
    	var confirmations=confirmations
         for (let v = 0; v < rawtx.vout.length; v++) {
          console.log(v)
          var vout = rawtx.vout[v];
          var ASMstring = vout.scriptPubKey.asm.slice(0,9);
          payload2=JSON.stringify(rawtx.vout[2].scriptPubKey.asm)
          console.log(ASMstring)
          if (ASMstring === "OP_RETURN" && confirmations >= 1) {
          	hasOPReturn=true
            var payload = vout.scriptPubKey.asm.slice(11,vout.scriptPubKey.asm.length);
            console.log(payload)           
            var marker =decode(payload.slice(0,1))

            var txObj = { tx: tx, payload: payload, marker: marker };
            console.log(decodedPayload,marker,txObj)
            if (marker === "om") {
              marker = payload.slice(0,3)
              txObj.marker=marker
              payload=payload.slice(4,payload.length)
              txObj.payload=payload
              omniTxCount+=1
              console.log("Omni tx "+omniTxCount)
              thisBlockOm.push(txObj);
            }
            if (marker === "tl") {
              payload=payload.slice(2,payload.length)
              txObj.payload=payload
              thisBlockTl.push(txObj);
            }
          } else if (ASMstring === "OP_RETURN" && confirmations === 0) {
          	hasOPReturn=true
            var payload = vout.scriptPubKey.asm.split(' ');
            var decodedPayload = decodeOPReturnPayload(payload);
            var marker = decodedPayload.slice(0, 1);
            var txObj = { tx: tx, payload: payload, decode: decode, marker: marker };
            if (marker === "om" || marker === "tl") {
              memPool.push(tx);
            }
          }
        }
        // Parse the sender (first input)
        const sender = rawtx.vin[0].txid
        const senderVout = rawtx.vin[0].vout

        // Parse the reference address (second output)
        const referenceAddress = rawtx.vout[1].scriptPubKey.addresses[0]
        const referenceValue = rawtx.vout[1].value;

        const changeAddress=rawtx.vout[0].scriptPubKey.addresses[0]
        const changeValue = rawtx.vout[0].value;


        console.log('Sender:', sender);
        console.log('Reference Address:', referenceAddress);
        console.log('Reference Value (Satoshi):', referenceValue);
        console.log('Change Address:', changeAddress);
        console.log('Change Value (Satoshi):', changeValue);

        if (hasOPReturn) {
            console.log('OP_Return Output Data:', payload2.slice(10,payload2.length-1) );
            const stringBuffer = Buffer.from(payload2.slice(10,payload2.length-1), 'hex');
            console.log(stringBuffer)
			const text = stringBuffer.toString('utf8');
			console.log("decoded hex: "+text);
        } else {
            console.log('No OP_Return Output found in the transaction.');
        }

        client.getRawTransaction(sender, true, function(err,rawtx){
        	var senderAddress=rawtx.vout[senderVout].scriptPubKey.addresses[0]
        	console.log("Sender Address "+senderAddress)
        })
    }
});
