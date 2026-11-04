/**
 * 주어진 guildId 에 대한 Discord OAuth2 인증 URL 생성.
 * state 파라미터에 guild_id 를 담아 콜백에서 판별.
 */
export declare function generateAuthUrl(guildId: string): string;
/**
 * 디스코드 앱 내부 모달 팝업용 직통 OAuth2 URL 생성
 * (discord.com/oauth2/authorize 링크여야 디스코드 내부에서 즉시 팝업 창이 뜹니다)
 */
export declare function getDirectDiscordAuthUrl(guildId: string): string;
export declare function startServer(): void;
//# sourceMappingURL=server.d.ts.map