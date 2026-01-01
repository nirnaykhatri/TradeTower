import { IExchangeConnector } from '../interfaces/IExchangeConnector';
import { BinanceConnector } from '../exchanges/BinanceConnector';
import { CoinbaseConnector } from '../exchanges/CoinbaseConnector';
import { CoinbaseFuturesConnector } from '../exchanges/CoinbaseFuturesConnector';
import { AlpacaConnector } from '../exchanges/AlpacaConnector';
import { IBKRConnector } from '../exchanges/IBKRConnector';

export type ExchangeType = 'binance' | 'coinbase' | 'coinbase-futures' | 'alpaca' | 'ibkr';

export interface ConnectorConfig {
    apiKey: string;
    apiSecret: string;
    isPaper?: boolean;
    host?: string;
    port?: number;
    extra?: Record<string, any>;
}

export class ExchangeFactory {
    public static createConnector(
        type: ExchangeType,
        config: ConnectorConfig
    ): IExchangeConnector {
        const { apiKey, apiSecret, isPaper, host, port } = config;

        switch (type) {
            case 'binance':
                return new BinanceConnector(apiKey, apiSecret);
            case 'coinbase':
                return new CoinbaseConnector(apiKey, apiSecret);
            case 'coinbase-futures':
                return new CoinbaseFuturesConnector(apiKey, apiSecret);
            case 'alpaca':
                return new AlpacaConnector(apiKey, apiSecret, isPaper);
            case 'ibkr':
                return new IBKRConnector(host || apiKey, port || parseInt(apiSecret) || 4001);
            default:
                const exhaustiveCheck: never = type;
                throw new Error(`Unsupported exchange type: ${exhaustiveCheck}`);
        }
    }
}
