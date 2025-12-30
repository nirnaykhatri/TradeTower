import { Request, Response, NextFunction } from 'express';
import jwt, { JwtHeader, SigningKeyCallback } from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';
import { config } from '../config/env';
import { logger } from '../services/logger';

// --- Secure Configuration ---
const TENANT_ID = config.get('AZURE_AD_B2C_TENANT_ID');
const CLIENT_ID = config.get('AZURE_AD_B2C_CLIENT_ID');
const ISSUER = `https://login.microsoftonline.com/${TENANT_ID}/v2.0`;

// --- JWKS Client ---
const jwksClient = jwksRsa({
    jwksUri: `https://login.microsoftonline.com/${TENANT_ID}/discovery/v2.0/keys`,
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 2,
});

// --- Promisified Key Retrieval ---
const getSigningKey = (header: JwtHeader): Promise<string> => {
    return new Promise((resolve, reject) => {
        jwksClient.getSigningKey(header.kid, (err, key) => {
            if (err) return reject(err);
            if (!key) return reject(new Error('Signing key not found'));
            const signingKey = key.getPublicKey();
            resolve(signingKey);
        });
    });
};

// --- Helper for verify callback pattern compatibility ---
function getKey(header: JwtHeader, callback: SigningKeyCallback) {
    getSigningKey(header)
        .then(key => callback(null, key))
        .catch(err => callback(err));
}

export const requireUserContext = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    }

    const token = authHeader.split(' ')[1];

    try {
        // Promisified verification wrapper
        const decoded = await new Promise<any>((resolve, reject) => {
            jwt.verify(token, getKey, {
                audience: CLIENT_ID,
                issuer: ISSUER,
                algorithms: ['RS256']
            }, (err, decoded) => {
                if (err) return reject(err);
                resolve(decoded);
            });
        });

        if (!decoded.sub) {
            logger.warn('Token validation succeeded but missing SUB claim', { decoded });
            return res.status(403).json({ error: 'Forbidden: Token missing User ID (sub)' });
        }

        req.user = {
            userId: decoded.sub,
            name: decoded.name,
            email: decoded.preferred_username || decoded.email,
            roles: decoded.roles || []
        };

        next();
    } catch (err: any) {
        logger.error('Token Validation Failed', { message: err.message });
        return res.status(401).json({ error: 'Unauthorized: Invalid token signature' });
    }
};
