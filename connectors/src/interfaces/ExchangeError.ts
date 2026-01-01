export class ExchangeError extends Error {
    constructor(
        public exchange: string,
        public message: string,
        public statusCode?: number,
        public rawError?: any
    ) {
        super(`[${exchange}] ${message}`);
        this.name = 'ExchangeError';
    }
}
