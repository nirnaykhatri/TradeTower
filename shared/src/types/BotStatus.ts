/**
 * Bot Status Enum
 * 
 * Represents the lifecycle states of a trading bot.
 * Use this instead of magic string literals for type safety and consistency.
 */
export enum BotStatus {
    /** Bot is stopped and not executing any trades */
    STOPPED = 'stopped',
    
    /** Bot is actively running and executing trades */
    RUNNING = 'running',
    
    /** Bot is paused temporarily, orders may remain open */
    PAUSED = 'paused',
    
    /** Bot has completed its trading cycle and stopped */
    COMPLETED = 'completed',
    
    /** Bot encountered an error and stopped */
    ERROR = 'error'
}

/**
 * Type guard to check if a string is a valid BotStatus
 */
export function isBotStatus(value: string): value is BotStatus {
    return Object.values(BotStatus).includes(value as BotStatus);
}
