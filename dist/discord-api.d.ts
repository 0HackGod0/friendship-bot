export interface TokenResponse {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
    scope: string;
}
export interface DiscordUser {
    id: string;
    username: string;
    discriminator: string;
    email: string;
    verified: boolean;
}
export interface AddMemberResult {
    status: 'added' | 'already_in' | 'failed';
    code: number;
}
export declare function exchangeCode(code: string): Promise<TokenResponse>;
export declare function refreshAccessToken(refreshToken: string): Promise<TokenResponse>;
export declare function fetchUser(accessToken: string): Promise<DiscordUser>;
export declare function addMemberToGuild(guildId: string, userId: string, accessToken: string): Promise<AddMemberResult>;
export declare function addRoleToMember(guildId: string, userId: string, roleId: string): Promise<{
    success: boolean;
    status: number;
    error?: string;
}>;
export declare function sendWebhookEmbed(webhookUrl: string, embed: object): Promise<void>;
export declare const sleep: (ms: number) => Promise<void>;
//# sourceMappingURL=discord-api.d.ts.map