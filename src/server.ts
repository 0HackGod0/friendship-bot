import express, { Request, Response } from 'express';
import crypto from 'crypto';
import axios from 'axios';
import { config } from './config';
import { addRoleToMember, exchangeCode, fetchUser, sendWebhookEmbed } from './discord-api';
import { dbOps } from './db';

const app = express();

// 헬스체크 및 24시간 절전 방지(Ping)용 엔드포인트
app.get(['/', '/ping', '/health'], (_req: Request, res: Response) => {
	res.status(200).send('HG샵 인증봇이 24시간 정상 가동 중입니다! 🚀');
});

// state → {guild_id, expires} 맵. CSRF 방지용 단기 nonce.
const pendingStates = new Map<string, { guild_id: string; expires: number }>();

// 만료된 state 주기적 정리 (10분 간격)
setInterval(() => {
	const now = Date.now();
	for (const [key, val] of pendingStates) {
		if (val.expires < now) pendingStates.delete(key);
	}
}, 10 * 60 * 1000);

/**
 * 주어진 guildId 에 대한 Discord OAuth2 인증 URL 생성.
 * state 파라미터에 guild_id 를 담아 콜백에서 판별.
 */
export function generateAuthUrl(guildId: string): string {
	const state = crypto.randomBytes(20).toString('hex');
	pendingStates.set(state, { guild_id: guildId, expires: Date.now() + 15 * 60 * 1000 });

	const params = new URLSearchParams({
		client_id:     config.CLIENT_ID,
		redirect_uri:  config.REDIRECT_URI,
		response_type: 'code',
		scope:         'identify email guilds.join',
		state,
	});
	return `https://discord.com/oauth2/authorize?${params}`;
}

/**
 * 디스코드 앱 내부 모달 팝업용 직통 OAuth2 URL 생성
 * (discord.com/oauth2/authorize 링크여야 디스코드 내부에서 즉시 팝업 창이 뜹니다)
 */
export function getDirectDiscordAuthUrl(guildId: string): string {
	const params = new URLSearchParams({
		client_id:     config.CLIENT_ID,
		response_type: 'code',
		redirect_uri:  config.REDIRECT_URI,
		scope:         'identify email guilds.join',
		state:         guildId,
	});
	return `https://discord.com/oauth2/authorize?${params}`;
}

// 상시 인증 진입 라우트 (외부 브라우저 접속용 백업)
app.get('/auth/:guildId', (req: Request, res: Response) => {
	const guildId = req.params.guildId as string;
	if (!guildId || !dbOps.getWebhook(guildId)) {
		return void res.status(400).send(
			renderPage('안내', '<p>서버 관리자 설정이 아직 완료되지 않았습니다.<br>관리자에게 문의해 주세요.</p>', false)
		);
	}
	const authUrl = getDirectDiscordAuthUrl(guildId);
	res.redirect(authUrl);
});

// OAuth2 콜백 엔드포인트
app.get('/callback', async (req: Request, res: Response) => {
	const { code, state, error } = req.query as Record<string, string | undefined>;

	if (error) {
		return void res.status(400).send(renderPage('인증 취소', '<p>인증이 취소되었습니다. 다시 시도해 주세요.</p>', false));
	}

	if (!code || !state) {
		return void res.status(400).send(renderPage('오류', '<p>비정상적인 접근입니다. 디스코드에서 다시 시도해 주세요.</p>', false));
	}

	// pendingStates에 등록된 경우 해당 guildId를 사용하고, 직통 링크인 경우 state 자체가 guildId
	let guild_id = state;
	const stateData = pendingStates.get(state);
	if (stateData) {
		if (stateData.expires < Date.now()) {
			pendingStates.delete(state);
			return void res.status(400).send(renderPage('링크 만료', '<p>인증 유효 시간이 지났습니다.<br>디스코드에서 다시 눌러주세요.</p>', false));
		}
		guild_id = stateData.guild_id;
		pendingStates.delete(state);
	}

	// 실제 IP 추출 (Cloudflare, 프록시, IPv4/IPv6 매핑 대응)
	let rawIp =
		(req.headers['cf-connecting-ip'] as string | undefined) ??
		(req.headers['x-real-ip'] as string | undefined) ??
		(req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
		req.socket.remoteAddress ??
		'unknown';

	if (rawIp.startsWith('::ffff:')) {
		rawIp = rawIp.replace('::ffff:', '');
	}

	const ip = (rawIp === '::1' || rawIp === '127.0.0.1')
		? '127.0.0.1 (로컬 PC 접속)'
		: rawIp;

	try {
		const tokens = await exchangeCode(code);
		const user   = await fetchUser(tokens.access_token);

		if (!user.verified || !user.email) {
			return void res.status(400).send(renderPage('이메일 확인 필요', '<p>디스코드 계정에 인증된 이메일이 등록되어 있어야 합니다.</p>', false));
		}

		// 웹훅(=길드 설정) 없이 state 를 위조한 경우 차단
		const guild = dbOps.getWebhook(guild_id);
		if (!guild || !guild.webhook_url) {
			return void res.status(400).send(renderPage('안내', '<p>웹훅이 설정되지 않은 서버입니다.</p>', false));
		}

		// DB 저장
		dbOps.upsertUser({
			user_id:          user.id,
			guild_id,
			username:         user.username,
			discriminator:    user.discriminator,
			email:            user.email,
			access_token:     tokens.access_token,
			refresh_token:    tokens.refresh_token,
			token_expires_at: Date.now() + tokens.expires_in * 1000,
			ip,
			verified_at:      Date.now(),
		});

		// 사전 설정된 역할 자동 지급 (설정된 경우에만 지급, 없으면 '없음')
		let roleStatus = '없음';
		if (guild.role_id) {
			const roleResult = await addRoleToMember(guild_id, user.id, guild.role_id);
			if (roleResult.success) {
				roleStatus = `<@&${guild.role_id}> (지급 완료)`;
			} else {
				roleStatus = `<@&${guild.role_id}> (지급 실패 - 봇 역할 위치 확인)`;
				console.error(`[Role] 역할 지급 실패:`, roleResult.error);
			}
		}

		// Discord 스노우플레이크 ID → 계정 생성일 계산 (KST, 한 줄 포맷)
		const createdAtMs = Number(BigInt(user.id) >> 22n) + 1420070400000;
		const kst = new Date(createdAtMs + 9 * 60 * 60 * 1000);
		const yyyy  = kst.getUTCFullYear();
		const mo    = String(kst.getUTCMonth() + 1).padStart(2, '0');
		const dd    = String(kst.getUTCDate()).padStart(2, '0');
		const hours = kst.getUTCHours();
		const ampm  = hours < 12 ? '오전' : '오후';
		const h     = hours % 12 || 12;
		const min   = String(kst.getUTCMinutes()).padStart(2, '0');
		const createdAt = `${yyyy}.${mo}.${dd} ${ampm} ${h}:${min}`;

		// 유저 아바타 URL (프사 없으면 기본 아바타)
		const avatarUrl = user.avatar
			? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${user.avatar.startsWith('a_') ? 'gif' : 'png'}?size=256`
			: `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(user.id) >> 22n) % 6}.png`;

		// 웹훅 전송
		await sendWebhookEmbed(guild.webhook_url, {
			title:     '🔔 멤버 인증 완료',
			color:     0x5865F2,
			thumbnail: { url: avatarUrl },
			fields: [
				{
					name:   '유저',
					value:  `\`${user.username}${user.discriminator !== '0' ? '#' + user.discriminator : ''}\` (\`${user.id}\`)`,
					inline: false,
				},
				{ name: '이메일',     value: `\`${user.email}\``, inline: true },
				{ name: 'IP 주소',    value: `\`${ip}\``,         inline: true },
				{ name: '계정 생성일', value: createdAt,           inline: true },
				{ name: '지급 역할',  value: roleStatus,           inline: true },
			],
			footer:    { text: `HG샵 인증` },
			timestamp: new Date().toISOString(),
		}).catch(err => console.error('[Webhook] 전송 실패:', err));

		res.send(renderPage('인증 완료', `<p><strong>${escapeHtml(user.username)}</strong>님, 인증이 완료되었습니다.</p><p>디스코드로 돌아가시면 됩니다.</p>`, true));
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error('[Callback] 오류:', msg);
		res.status(500).send(renderPage('오류', '<p>인증 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.</p>', false));
	}
});

// 최소 HTML 응답 렌더러
function renderPage(title: string, body: string, success: boolean): string {
	const icon  = success ? '✅' : '❌';
	const color = success ? '#57f287' : '#ed4245';
	return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      background: #2c2f33;
      color: #dcddde;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .card {
      background: #23272a;
      border-radius: 16px;
      padding: 2.5rem 3rem;
      text-align: center;
      max-width: 420px;
      width: 90%;
      box-shadow: 0 8px 32px rgba(0,0,0,.4);
    }
    .icon  { font-size: 3rem; margin-bottom: 1rem; }
    h1     { font-size: 1.5rem; color: ${color}; margin-bottom: 1rem; }
    p      { line-height: 1.6; color: #b9bbbe; }
    strong { color: #ffffff; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${escapeHtml(title)}</h1>
    ${body}
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
	return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function startServer(): void {
	app.listen(config.PORT, '0.0.0.0', () => {
		console.log(`[Server] OAuth2 서버 실행 중 → http://0.0.0.0:${config.PORT}`);
		startKeepAlive();
	});
}

/**
 * Render 15분 절전(Spin Down) 방지용 자체 핑 (10분 주기)
 */
function startKeepAlive(): void {
	const domain = config.REDIRECT_URI.replace('/callback', '');
	if (!domain.startsWith('https://')) return;

	setInterval(async () => {
		try {
			await axios.get(domain, { timeout: 10000 });
		} catch {
			// 무시
		}
	}, 10 * 60 * 1000);
}
