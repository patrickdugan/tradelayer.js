const litecoin = require('litecoin');

class LitecoinClient {
    static instance;

    constructor() {
        if (LitecoinClient.instance) {
            return LitecoinClient.instance;
        }

        this.client = new litecoin.Client({
            host: '127.0.0.1',
            port: 18332, //for testnet
            user: 'user',
            pass: 'pass',
            timeout: 10000
        });

        LitecoinClient.instance = this;
    }

    static getInstance() {
        if (!LitecoinClient.instance) {
            new LitecoinClient();
        }
        return LitecoinClient.instance.client;
    }
}

module.exports = LitecoinClient;
