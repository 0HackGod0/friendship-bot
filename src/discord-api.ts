import axios, { AxiosError } from 'axios';
import { config } from './config';

const BASE = 'https://discord.com/api/v10';

export interface TokenResponse {
	access_token:  string;
	refresh_token: string;
	expires_in:    number;
	token_type:    string;
	scope:         string;
}

export interface DiscordUser {
	id:            string;
	username:      string;
	discriminator: string;
	email:         string;
	verified:      boolean;
	avatar:        string | null;
}

export interface AddMemberResult {
	status: 'added' | 'already_in' | 'failed';
	code:   number;
}

// OAuth2 코드 → 토큰 교환
export async function exchangeCode(code: string): Promise<TokenResponse> {
	const { data } = await axios.post<TokenResponse>(
		`${BASE}/oauth2/token`,
		new URLSearchParams({
			client_id:     config.CLIENT_ID,
			client_secret: config.CLIENT_SECRET,
			grant_type:    'authorization_code',
			code,
			redirect_uri:  config.REDIRECT_URI,
		}),
		{ headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
	);
	return data;
}

// 만료된 액세스 토큰 갱신
export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
	const { data } = await axios.post<TokenResponse>(
		`${BASE}/oauth2/token`,
		new URLSearchParams({
			client_id:     config.CLIENT_ID,
			client_secret: config.CLIENT_SECRET,
			grant_type:    'refresh_token',
			refresh_token: refreshToken,
		}),
		{ headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
	);
	return data;
}

// 유저 정보 조회 (email 포함)
export async function fetchUser(accessToken: string): Promise<DiscordUser> {
	const { data } = await axios.get<DiscordUser>(`${BASE}/users/@me`, {
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	return data;
}

// guilds.join 스코프로 유저를 서버에 추가
// 201 = 추가됨, 204 = 이미 있음, 그 외 = 실패
export async function addMemberToGuild(
	guildId:     string,
	userId:      string,
	accessToken: string
): Promise<AddMemberResult> {
	try {
		const res = await axios.put(
			`${BASE}/guilds/${guildId}/members/${userId}`,
			{ access_token: accessToken },
			{
				headers: {
					Authorization:  `Bot ${config.BOT_TOKEN}`,
					'Content-Type': 'application/json',
				},
				validateStatus: () => true,
			}
		);

		if (res.status === 201) return { status: 'added',      code: 201 };
		if (res.status === 204) return { status: 'already_in', code: 204 };

		// 429 — 레이트 리밋: retry_after 반환 (ms 단위로 변환)
		if (res.status === 429) {
			const retryAfter: number = (res.data?.retry_after ?? 1) * 1000;
			await sleep(retryAfter);
			// 한 번 재시도
			return addMemberToGuild(guildId, userId, accessToken);
		}

		return { status: 'failed', code: res.status };
	} catch (err) {
		const e = err as AxiosError;
		return { status: 'failed', code: e.response?.status ?? 0 };
	}
}

// 유저에게 서버 역할 지급
export async function addRoleToMember(
	guildId: string,
	userId:  string,
	roleId:  string
): Promise<{ success: boolean; status: number; error?: string }> {
	try {
		const res = await axios.put(
			`${BASE}/guilds/${guildId}/members/${userId}/roles/${roleId}`,
			{},
			{
				headers: {
					Authorization: `Bot ${config.BOT_TOKEN}`,
				},
				validateStatus: () => true,
			}
		);
		if (res.status === 204) return { success: true, status: 204 };
		return { success: false, status: res.status, error: `HTTP ${res.status}` };
	} catch (err) {
		const e = err as AxiosError;
		return { success: false, status: e.response?.status ?? 0, error: e.message };
	}
}

// Discord 웹훅으로 임베드 전송
export async function sendWebhookEmbed(webhookUrl: string, embed: object): Promise<void> {
	await axios.post(webhookUrl, { embeds: [embed] });
}

export const sleep = (ms: number): Promise<void> =>
	new Promise(resolve => setTimeout(resolve, ms));
