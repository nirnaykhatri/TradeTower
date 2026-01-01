import * as crypto from 'crypto';

export class AuthUtils {
    /**
     * Coinbase Advanced Trade Authentication
     * https://docs.cdp.coinbase.com/advanced-trade/docs/auth
     * 
     * Generated signature for the CB-ACCESS-SIGN header.
     */
    public static generateCoinbaseSignature(
        apiSecret: string,
        timestamp: string,
        method: string,
        requestPath: string,
        body: string = ''
    ): string {
        const message = timestamp + method.toUpperCase() + requestPath + body;
        return crypto
            .createHmac('sha256', apiSecret)
            .update(message)
            .digest('hex');
    }

    /**
     * Binance Authentication
     * https://binance-docs.github.io/apidocs/spot/en/#signed-endpoint-security-type
     */
    public static generateBinanceSignature(apiSecret: string, queryString: string): string {
        return crypto
            .createHmac('sha256', apiSecret)
            .update(queryString)
            .digest('hex');
    }
}
