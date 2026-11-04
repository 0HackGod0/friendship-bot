export interface UserRecord {
    user_id: string;
    guild_id: string;
    username: string;
    discriminator: string;
    email: string;
    access_token: string;
    refresh_token: string;
    token_expires_at: number;
    ip: string;
    verified_at: number;
}
export interface GuildRecord {
    guild_id: string;
    webhook_url: string;
    role_id?: string;
    setup_at: number;
}
export declare const dbOps: {
    upsertUser(record: UserRecord): void;
    getUsersByGuild(guildId: string): UserRecord[];
    getAllUsers(): UserRecord[];
    updateTokens(params: {
        access_token: string;
        refresh_token: string;
        token_expires_at: number;
        user_id: string;
        guild_id: string;
    }): void;
    setWebhook(guildId: string, webhookUrl: string): void;
    setRole(guildId: string, roleId: string): void;
    getRole(guildId: string): string | undefined;
    getWebhook(guildId: string): GuildRecord | undefined;
    getUserCount(guildId: string): number;
};
export default dbOps;
//# sourceMappingURL=db.d.ts.map