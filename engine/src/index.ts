import dotenv from 'dotenv';
import { botEngine } from './services/BotEngine';

dotenv.config();

async function main() {
    console.log('--- Trading Tower Bot Engine Started ---');

    // Example of how the engine would be used
    console.log('Engine is ready to process trading strategies.');

    // Graceful shutdown
    process.on('SIGINT', async () => {
        console.log('Shutting down engine...');
        process.exit(0);
    });
}

main().catch(err => {
    console.error('Fatal Engine Error:', err);
    process.exit(1);
});

export * from './strategies/BaseStrategy';
export * from './strategies/GridStrategy';
export * from './strategies/DCAStrategy';
export * from './strategies/BaseDCAStrategy';
export * from './strategies/BTDStrategy';
export * from './strategies/ComboStrategy';
export * from './strategies/LoopStrategy';
export * from './strategies/DCAFuturesStrategy';
export * from './strategies/FuturesGridStrategy';
export * from './strategies/TWAPStrategy';
export * from './services/BotManager';
export * from './services/BotEngine';
export * from './types/strategyConfig';
