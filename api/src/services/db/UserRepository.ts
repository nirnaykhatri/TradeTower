import { UserProfile } from '@trading-tower/shared';
import { BaseRepository } from './BaseRepository';

export class UserRepository extends BaseRepository<UserProfile> {
    constructor() {
        super('Users');
    }

    /**
     * Specialized sync logic
     */
    public async syncUser(profile: Partial<UserProfile> & { userId: string, email: string }): Promise<UserProfile> {
        const existing = await this.getById(profile.userId, profile.userId);

        const now = new Date().toISOString();

        const updatedProfile: UserProfile = {
            id: profile.userId,
            userId: profile.userId,
            email: profile.email,
            name: profile.name || existing?.name || '',
            createdAt: existing?.createdAt || now,
            updatedAt: now,
            preferences: existing?.preferences || {
                theme: 'dark',
                notifications: true,
                defaultCurrency: 'USDT'
            }
        };

        return this.upsert(updatedProfile);
    }
}

export const userRepository = new UserRepository();
