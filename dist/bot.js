"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCommands = registerCommands;
exports.startBot = startBot;
const discord_js_1 = require("discord.js");
const config_1 = require("./config");
const db_1 = require("./db");
const discord_api_1 = require("./discord-api");
const server_1 = require("./server");
// 진행 중인 복구 작업 중복 실행 방지
const activeRestores = new Set();
// ─── 슬래시 커맨드 정의 ───────────────────────────────────────────────────────
const commandDefs = [
    new discord_js_1.SlashCommandBuilder()
        .setName('후원')
        .setDescription('후원 계좌를 확인합니다.'),
    new discord_js_1.SlashCommandBuilder()
        .setName('설정')
        .setDescription('인증 로그가 전송될 웹훅 주소를 등록합니다.')
        .addStringOption(opt => opt.setName('webhook_url')
        .setDescription('Discord 웹훅 URL (https://discord.com/api/webhooks/...)')
        .setRequired(true))
        .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.Administrator),
    new discord_js_1.SlashCommandBuilder()
        .setName('역할')
        .setDescription('인증 완료 시 지급할 역할을 관리합니다.')
        .addSubcommand(sub => sub.setName('설정')
        .setDescription('인증 완료 시 지급할 역할을 지정합니다.')
        .addRoleOption(opt => opt.setName('role')
        .setDescription('지급할 역할을 선택합니다.')
        .setRequired(true)))
        .addSubcommand(sub => sub.setName('해제')
        .setDescription('설정된 지급 역할을 제거(없음으로 변경)합니다.'))
        .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.Administrator),
    new discord_js_1.SlashCommandBuilder()
        .setName('인증')
        .setDescription('인증 관련 명령어입니다.')
        .addSubcommand(sub => sub.setName('메시지')
        .setDescription('인증 안내 임베드와 버튼을 현재 채널에 전송합니다.'))
        .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.Administrator),
    new discord_js_1.SlashCommandBuilder()
        .setName('인원')
        .setDescription('인원 관련 명령어입니다.')
        .addSubcommand(sub => sub.setName('수')
        .setDescription('현재까지 인증된 인원 수를 확인합니다.'))
        .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.Administrator),
    new discord_js_1.SlashCommandBuilder()
        .setName('불러오기')
        .setDescription('저장된 멤버들을 현재 서버로 일괄 복구합니다.')
        .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.Administrator),
].map(cmd => cmd.toJSON());
// ─── 커맨드 등록 ─────────────────────────────────────────────────────────────
async function registerCommands() {
    const rest = new discord_js_1.REST().setToken(config_1.config.BOT_TOKEN);
    await rest.put(discord_js_1.Routes.applicationCommands(config_1.config.CLIENT_ID), { body: commandDefs });
    console.log('[Bot] 글로벌 슬래시 커맨드 등록 완료');
}
// ─── 클라이언트 초기화 ───────────────────────────────────────────────────────
function startBot() {
    const client = new discord_js_1.Client({ intents: [discord_js_1.GatewayIntentBits.Guilds] });
    client.once(discord_js_1.Events.ClientReady, async (c) => {
        console.log(`[Bot] ${c.user.tag} 로그인 완료`);
        await registerCommands();
        startTokenAutoRefresher();
    });
    client.on(discord_js_1.Events.InteractionCreate, (interaction) => {
        if (interaction.isChatInputCommand()) {
            handleSlashCommand(interaction).catch(err => console.error('[Bot] 커맨드 처리 오류:', err));
        }
        else if (interaction.isButton()) {
            handleButton(interaction).catch(err => console.error('[Bot] 버튼 처리 오류:', err));
        }
    });
    client.login(config_1.config.BOT_TOKEN);
}
// ─── 슬래시 커맨드 핸들러 ───────────────────────────────────────────────────
async function handleSlashCommand(interaction) {
    if (!interaction.guildId) {
        await interaction.reply({ content: '서버 안에서만 사용할 수 있는 명령어입니다.', flags: discord_js_1.MessageFlags.Ephemeral });
        return;
    }
    // 일반 명령어(후원) 외에는 관리자 권한 확인
    if (interaction.commandName !== '후원') {
        if (!interaction.memberPermissions?.has(discord_js_1.PermissionFlagsBits.Administrator)) {
            await interaction.reply({
                content: '서버 관리자만 사용할 수 있는 명령어입니다.',
                flags: discord_js_1.MessageFlags.Ephemeral,
            });
            return;
        }
    }
    switch (interaction.commandName) {
        // /후원 — 누구나 조회 가능 (본인에게만 표시)
        case '후원': {
            await interaction.reply({
                content: [
                    '후원 부탁드립니다 :)',
                    '',
                    '• **USDT bep-20 주소:**',
                    '`0xbcDdc01070102c20175c1B75DD0b1773D6675f46`',
                    '',
                    '• **LTC 주소:**',
                    '`LTQYk36hBf9xwba2Zpk2wQSoNPmbktFuYv`',
                ].join('\n'),
                flags: discord_js_1.MessageFlags.Ephemeral,
            });
            break;
        }
        // /설정 — 웹훅 URL 등록
        case '설정': {
            const url = interaction.options.getString('webhook_url', true);
            if (!url.startsWith('https://discord.com/api/webhooks/') &&
                !url.startsWith('https://discordapp.com/api/webhooks/')) {
                await interaction.reply({
                    content: '올바른 디스코드 웹훅 주소가 아닙니다.\n(https://discord.com/api/webhooks/... 형식이어야 합니다)',
                    flags: discord_js_1.MessageFlags.Ephemeral,
                });
                return;
            }
            db_1.dbOps.setWebhook(interaction.guildId, url);
            await interaction.reply({ content: '웹훅 등록이 완료되었습니다.', flags: discord_js_1.MessageFlags.Ephemeral });
            break;
        }
        // /역할 설정 or /역할 해제 or /역할설정
        case '역할':
        case '역할설정': {
            const subcommand = interaction.options.getSubcommand(false);
            if (subcommand === '해제') {
                db_1.dbOps.setRole(interaction.guildId, '');
                await interaction.reply({
                    content: '지급 역할 설정을 해제했습니다. (지급 역할: 없음)',
                    flags: discord_js_1.MessageFlags.Ephemeral,
                });
                break;
            }
            const role = interaction.options.getRole('role', true);
            db_1.dbOps.setRole(interaction.guildId, role.id);
            // 봇 역할과의 서열 비교
            const botMember = interaction.guild?.members.me;
            let warning = '';
            if (botMember && role.position >= botMember.roles.highest.position) {
                warning = '\n\n⚠️ **주의:** 서버 설정(역할)에서 봇의 역할이 이 역할보다 위에 있어야 정상 지급됩니다.';
            }
            await interaction.reply({
                content: `인증 완료 시 <@&${role.id}> 역할을 지급하도록 설정했습니다.${warning}`,
                flags: discord_js_1.MessageFlags.Ephemeral,
            });
            break;
        }
        // /인증 메시지 or /인증메시지
        case '인증':
        case '인증메시지': {
            const guild = db_1.dbOps.getWebhook(interaction.guildId);
            if (!guild || !guild.webhook_url) {
                await interaction.reply({
                    content: '웹훅이 설정되지 않았습니다. 먼저 `/설정` 명령어로 웹훅 URL을 등록해 주세요.',
                    flags: discord_js_1.MessageFlags.Ephemeral,
                });
                return;
            }
            const buttonUrl = (0, server_1.getDirectDiscordAuthUrl)(interaction.guildId);
            const embed = new discord_js_1.EmbedBuilder()
                .setTitle('❤️‍🔥 우정샵 인증봇 ❤️‍🔥')
                .setDescription('아래 버튼을 눌러 인증을 진행해주세요.')
                .setColor(0x2B2D31);
            const row = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder()
                .setStyle(discord_js_1.ButtonStyle.Link)
                .setLabel('인증하기')
                .setURL(buttonUrl));
            // 채널에 공개 전송
            if (interaction.channel && 'send' in interaction.channel) {
                await interaction.channel.send({
                    embeds: [embed],
                    components: [row],
                });
                const roleText = guild.role_id ? `<@&${guild.role_id}>` : '없음';
                await interaction.reply({
                    content: `인증 메시지를 현재 채널에 보냈습니다. (지급 역할: ${roleText})`,
                    flags: discord_js_1.MessageFlags.Ephemeral,
                });
            }
            else {
                await interaction.reply({
                    content: '메시지를 보낼 수 없는 채널입니다.',
                    flags: discord_js_1.MessageFlags.Ephemeral,
                });
            }
            break;
        }
        // /인원 수 or /인원수
        case '인원':
        case '인원수': {
            const count = db_1.dbOps.getUserCount(interaction.guildId);
            await interaction.reply({
                content: `현재까지 총 **${count}명**이 인증되었습니다.`,
                flags: discord_js_1.MessageFlags.Ephemeral,
            });
            break;
        }
        // /불러오기 — 확인 프롬프트 표시
        case '불러오기': {
            if (activeRestores.has(interaction.guildId)) {
                await interaction.reply({
                    content: '이미 복구 작업이 진행 중입니다.',
                    flags: discord_js_1.MessageFlags.Ephemeral,
                });
                return;
            }
            const count = db_1.dbOps.getUserCount(interaction.guildId);
            if (count === 0) {
                await interaction.reply({
                    content: '저장된 인증 인원이 없습니다.',
                    flags: discord_js_1.MessageFlags.Ephemeral,
                });
                return;
            }
            const estimatedSec = count;
            const estimatedStr = estimatedSec >= 60
                ? `약 ${Math.ceil(estimatedSec / 60)}분`
                : `약 ${estimatedSec}초`;
            const confirmBtn = new discord_js_1.ButtonBuilder()
                .setCustomId(`restore:confirm:${interaction.guildId}`)
                .setLabel('복구 시작')
                .setStyle(discord_js_1.ButtonStyle.Danger);
            const cancelBtn = new discord_js_1.ButtonBuilder()
                .setCustomId('restore:cancel')
                .setLabel('취소')
                .setStyle(discord_js_1.ButtonStyle.Secondary);
            const row = new discord_js_1.ActionRowBuilder().addComponents(confirmBtn, cancelBtn);
            await interaction.reply({
                content: [
                    `⚠️ **멤버 복구를 진행하시겠습니까?**`,
                    ``,
                    `• 복구 대상: **${count}명**`,
                    `• 예상 소요 시간: **${estimatedStr}**`,
                    `• 이미 서버에 있는 유저는 자동으로 건너뜁니다.`,
                ].join('\n'),
                components: [row],
                flags: discord_js_1.MessageFlags.Ephemeral,
            });
            break;
        }
    }
}
// ─── 버튼 핸들러 ─────────────────────────────────────────────────────────────
async function handleButton(interaction) {
    // 취소
    if (interaction.customId === 'restore:cancel') {
        await interaction.update({ content: '복구 작업이 취소되었습니다.', components: [] });
        return;
    }
    // 확인
    if (interaction.customId.startsWith('restore:confirm:')) {
        const guildId = interaction.customId.split(':')[2];
        if (!guildId)
            return;
        if (activeRestores.has(guildId)) {
            await interaction.update({ content: '이미 복구 작업이 진행 중입니다.', components: [] });
            return;
        }
        activeRestores.add(guildId);
        // deferUpdate → 15분 창 확보 후 editReply 로 진행상황 갱신
        await interaction.deferUpdate();
        await interaction.editReply({ content: '복구 작업을 시작합니다...', components: [] });
        const users = db_1.dbOps.getUsersByGuild(guildId);
        let added = 0;
        let alreadyIn = 0;
        let failed = 0;
        let processed = 0;
        const statusMsg = () => [
            `⏳ **멤버 복구 진행 중...**`,
            ``,
            `• 진행도: ${processed} / ${users.length}명`,
            `• 추가 성공: ${added}명`,
            `• 이미 서버에 있음: ${alreadyIn}명`,
            `• 실패: ${failed}명`,
        ].join('\n');
        for (const user of users) {
            try {
                const accessToken = await resolveToken(user);
                if (!accessToken) {
                    failed++;
                    processed++;
                    continue;
                }
                const result = await (0, discord_api_1.addMemberToGuild)(guildId, user.user_id, accessToken);
                if (result.status === 'added')
                    added++;
                else if (result.status === 'already_in')
                    alreadyIn++;
                else
                    failed++;
                processed++;
                // 10명마다 진행상황 업데이트
                if (processed % 10 === 0) {
                    await interaction.editReply({ content: statusMsg() }).catch(() => void 0);
                }
                // Discord guild member add 레이트 리밋: 초당 1명
                await (0, discord_api_1.sleep)(1050);
            }
            catch (err) {
                console.error(`[Restore] 유저 ${user.user_id} 처리 오류:`, err);
                failed++;
                processed++;
            }
        }
        activeRestores.delete(guildId);
        await interaction.editReply({
            content: [
                `✅ **멤버 복구 완료**`,
                ``,
                `• 전체 대상: **${users.length}명**`,
                `• 추가 성공: **${added}명**`,
                `• 이미 서버에 있음: **${alreadyIn}명**`,
                `• 실패: **${failed}명**`,
            ].join('\n'),
        });
    }
}
// ─── 토큰 유효성 확인 및 갱신 ───────────────────────────────────────────────
/**
 * 액세스 토큰이 5분 이내에 만료되면 refresh 토큰으로 갱신.
 * 갱신 실패 시 null 반환.
 */
async function resolveToken(user) {
    const BUFFER_MS = 5 * 60 * 1000;
    if (user.token_expires_at - Date.now() > BUFFER_MS) {
        return user.access_token;
    }
    try {
        const tokens = await (0, discord_api_1.refreshAccessToken)(user.refresh_token);
        db_1.dbOps.updateTokens({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            token_expires_at: Date.now() + tokens.expires_in * 1000,
            user_id: user.user_id,
            guild_id: user.guild_id,
        });
        return tokens.access_token;
    }
    catch {
        // refresh 토큰도 만료됨 — 유저 재인증 필요
        return null;
    }
}
/**
 * 12시간마다 백그라운드에서 만료 임박(3일 이내) 토큰을 자동 갱신하여 30일 제한 없이 영구 연장
 */
function startTokenAutoRefresher() {
    const runCheck = async () => {
        const users = db_1.dbOps.getAllUsers();
        const EXPIRY_THRESHOLD = 3 * 24 * 60 * 60 * 1000; // 3일 이내 만료 시점
        let refreshedCount = 0;
        for (const user of users) {
            if (user.token_expires_at - Date.now() < EXPIRY_THRESHOLD) {
                try {
                    const tokens = await (0, discord_api_1.refreshAccessToken)(user.refresh_token);
                    db_1.dbOps.updateTokens({
                        access_token: tokens.access_token,
                        refresh_token: tokens.refresh_token,
                        token_expires_at: Date.now() + tokens.expires_in * 1000,
                        user_id: user.user_id,
                        guild_id: user.guild_id,
                    });
                    refreshedCount++;
                    await (0, discord_api_1.sleep)(1050); // 디스코드 레이트 리밋 방지
                }
                catch {
                    // 유저가 디스코드 계정 연동을 직접 해제한 경우 무시
                }
            }
        }
        if (refreshedCount > 0) {
            console.log(`[TokenManager] ${refreshedCount}명의 토큰 자동 갱신 완료 (유효기간 영구 연장)`);
        }
    };
    // 12시간마다 주기적 검사 및 갱신
    setInterval(runCheck, 12 * 60 * 60 * 1000);
    // 봇 켜지고 1분 뒤 1차 검사
    setTimeout(runCheck, 60 * 1000);
}
//# sourceMappingURL=bot.js.map