"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sleep = void 0;
exports.exchangeCode = exchangeCode;
exports.refreshAccessToken = refreshAccessToken;
exports.fetchUser = fetchUser;
exports.addMemberToGuild = addMemberToGuild;
exports.addRoleToMember = addRoleToMember;
exports.sendWebhookEmbed = sendWebhookEmbed;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("./config");
const BASE = 'https://discord.com/api/v10';
// OAuth2 코드 → 토큰 교환
async function exchangeCode(code) {
    const { data } = await axios_1.default.post(`${BASE}/oauth2/token`, new URLSearchParams({
        client_id: config_1.config.CLIENT_ID,
        client_secret: config_1.config.CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: config_1.config.REDIRECT_URI,
    }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    return data;
}
// 만료된 액세스 토큰 갱신
async function refreshAccessToken(refreshToken) {
    const { data } = await axios_1.default.post(`${BASE}/oauth2/token`, new URLSearchParams({
        client_id: config_1.config.CLIENT_ID,
        client_secret: config_1.config.CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
    }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    return data;
}
// 유저 정보 조회 (email 포함)
async function fetchUser(accessToken) {
    const { data } = await axios_1.default.get(`${BASE}/users/@me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    return data;
}
// guilds.join 스코프로 유저를 서버에 추가
// 201 = 추가됨, 204 = 이미 있음, 그 외 = 실패
async function addMemberToGuild(guildId, userId, accessToken) {
    try {
        const res = await axios_1.default.put(`${BASE}/guilds/${guildId}/members/${userId}`, { access_token: accessToken }, {
            headers: {
                Authorization: `Bot ${config_1.config.BOT_TOKEN}`,
                'Content-Type': 'application/json',
            },
            validateStatus: () => true,
        });
        if (res.status === 201)
            return { status: 'added', code: 201 };
        if (res.status === 204)
            return { status: 'already_in', code: 204 };
        // 429 — 레이트 리밋: retry_after 반환 (ms 단위로 변환)
        if (res.status === 429) {
            const retryAfter = (res.data?.retry_after ?? 1) * 1000;
            await (0, exports.sleep)(retryAfter);
            // 한 번 재시도
            return addMemberToGuild(guildId, userId, accessToken);
        }
        return { status: 'failed', code: res.status };
    }
    catch (err) {
        const e = err;
        return { status: 'failed', code: e.response?.status ?? 0 };
    }
}
// 유저에게 서버 역할 지급
async function addRoleToMember(guildId, userId, roleId) {
    try {
        const res = await axios_1.default.put(`${BASE}/guilds/${guildId}/members/${userId}/roles/${roleId}`, {}, {
            headers: {
                Authorization: `Bot ${config_1.config.BOT_TOKEN}`,
            },
            validateStatus: () => true,
        });
        if (res.status === 204)
            return { success: true, status: 204 };
        return { success: false, status: res.status, error: `HTTP ${res.status}` };
    }
    catch (err) {
        const e = err;
        return { success: false, status: e.response?.status ?? 0, error: e.message };
    }
}
// Discord 웹훅으로 임베드 전송
async function sendWebhookEmbed(webhookUrl, embed) {
    await axios_1.default.post(webhookUrl, { embeds: [embed] });
}
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
exports.sleep = sleep;
//# sourceMappingURL=discord-api.js.map