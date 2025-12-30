import { config } from '../config/env';

export class LoggerService {
    private static instance: LoggerService;

    private constructor() { }

    public static getInstance(): LoggerService {
        if (!LoggerService.instance) {
            LoggerService.instance = new LoggerService();
        }
        return LoggerService.instance;
    }

    // In a real app, integrate winston or app insights client here
    public info(message: string, meta?: any) {
        if (this.shouldLog('info')) {
            console.log(`[INFO] ${new Date().toISOString()}: ${message}`, meta || '');
        }
    }

    public error(message: string, error?: any) {
        if (this.shouldLog('error')) {
            console.error(`[ERROR] ${new Date().toISOString()}: ${message}`, error || '');
        }
    }

    public warn(message: string, meta?: any) {
        if (this.shouldLog('warn')) {
            console.warn(`[WARN] ${new Date().toISOString()}: ${message}`, meta || '');
        }
    }

    public debug(message: string, meta?: any) {
        if (this.shouldLog('debug')) {
            console.debug(`[DEBUG] ${new Date().toISOString()}: ${message}`, meta || '');
        }
    }

    private shouldLog(level: string): boolean {
        const levels = ['error', 'warn', 'info', 'debug'];
        const currentLevel = config.get('LOG_LEVEL');
        return levels.indexOf(level) <= levels.indexOf(currentLevel);
    }
}

export const logger = LoggerService.getInstance();
