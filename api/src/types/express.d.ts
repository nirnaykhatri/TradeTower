export interface UserContext {
    userId: string;
    tenantId?: string;
    roles?: string[];
    name?: string;
    email?: string;
}

declare global {
    namespace Express {
        interface Request {
            user: UserContext; // The authenticated user context
        }
    }
}
