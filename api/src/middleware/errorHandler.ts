import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/error';
import { logger } from '../services/logger';

export const errorHandler = (err: Error, req: Request, res: Response, next: NextFunction) => {
    logger.error(err.message, { stack: err.stack, path: req.path, method: req.method });

    if (err instanceof AppError) {
        return res.status(err.statusCode).json({
            status: 'error',
            message: err.message,
        });
    }

    // Fallback for unhandled errors
    return res.status(500).json({
        status: 'error',
        message: 'Internal Server Error',
    });
};
