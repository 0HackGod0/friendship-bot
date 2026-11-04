"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCommands = registerCommands;
exports.startBot = startBot;
const discord_js_1 = require("discord.js");
const config_1 = require("./config");
const db_1 = require("./db");
const discord_api_1 = require("./discord-api");
const server_1 = require("./server");
const crypto_1 = __importDefault(require("crypto"));
// 진행 중인 복구 작업 중복 실행 방지
const activeRestores = new Set();
const pendingChanges = new Map();
// 만료된 확인 토큰 자동 청소 (10분 주기)
setInterval(() => {
    const now = Date.now();
    for (const [key, val] of pendingChanges) {
        if (val.expires < now)
            pendingChanges.delete(key);
    }
}, 10 * 60 * 1000);
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
/**
 * ephemeral 응답을 전송하고 5.5초 후 자동으로 닫히도록(삭제) 설정
 */
async function replyAutoDelete(interaction, options, delayMs = 5500) {
    const replyOptions = typeof options === 'string'
        ? { content: options, flags: discord_js_1.MessageFlags.Ephemeral }
        : { flags: discord_js_1.MessageFlags.Ephemeral, ...options };
    if (interaction.replied || interaction.deferred) {
        await interaction.editReply(replyOptions);
    }
    else {
        await interaction.reply(replyOptions);
    }
    setTimeout(() => {
        interaction.deleteReply().catch(() => { });
    }, delayMs);
}
/**
 * 버튼 상호작용 업데이트 후 5.5초 후 자동으로 닫히도록(삭제) 설정
 */
async function updateAutoDelete(interaction, options, delayMs = 5500) {
    const updateOptions = typeof options === 'string'
        ? { content: options, components: [] }
        : options;
    if (interaction.deferred) {
        await interaction.editReply(updateOptions);
    }
    else {
        await interaction.update(updateOptions);
    }
    setTimeout(() => {
        interaction.deleteReply().catch(() => { });
    }, delayMs);
}
async function handleSlashCommand(interaction) {
    if (!interaction.guildId) {
        await replyAutoDelete(interaction, '서버 안에서만 사용할 수 있는 명령어입니다.');
        return;
    }
    // 일반 명령어(후원) 외에는 관리자 권한 확인
    if (interaction.commandName !== '후원') {
        if (!interaction.memberPermissions?.has(discord_js_1.PermissionFlagsBits.Administrator)) {
            await replyAutoDelete(interaction, '서버 관리자만 사용할 수 있는 명령어입니다.');
            return;
        }
    }
    switch (interaction.commandName) {
        // /후원 — 누구나 조회 가능 (본인에게만 표시, 자동 닫힘 제외)
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
        // /설정 — 웹훅 URL 등록 (이미 등록된 경우 재확인)
        case '설정': {
            const url = interaction.options.getString('webhook_url', true);
            if (!url.startsWith('https://discord.com/api/webhooks/') &&
                !url.startsWith('https://discordapp.com/api/webhooks/')) {
                await replyAutoDelete(interaction, '올바른 디스코드 웹훅 주소가 아닙니다.\n(https://discord.com/api/webhooks/... 형식이어야 합니다)');
                return;
            }
            const existing = db_1.dbOps.getWebhook(interaction.guildId);
            if (existing?.webhook_url) {
                if (existing.webhook_url === url) {
                    await replyAutoDelete(interaction, '이미 동일한 웹훅 주소로 설정되어 있습니다.');
                    return;
                }
                const token = crypto_1.default.randomBytes(6).toString('hex');
                pendingChanges.set(token, {
                    type: 'webhook',
                    guildId: interaction.guildId,
                    value: url,
                    expires: Date.now() + 5 * 60 * 1000,
                });
                const row = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder()
                    .setCustomId(`change:confirm:${token}`)
                    .setLabel('변경하기')
                    .setStyle(discord_js_1.ButtonStyle.Danger), new discord_js_1.ButtonBuilder()
                    .setCustomId(`change:cancel:${token}`)
                    .setLabel('취소')
                    .setStyle(discord_js_1.ButtonStyle.Secondary));
                await interaction.reply({
                    content: [
                        '⚠️ **웹훅 주소 변경 확인**',
                        '이미 등록된 웹훅 주소가 존재합니다. 새 웹훅 주소로 변경하시겠습니까?',
                        '',
                        `• **새 웹훅 주소:** \`${url}\``,
                    ].join('\n'),
                    components: [row],
                    flags: discord_js_1.MessageFlags.Ephemeral,
                });
                return;
            }
            db_1.dbOps.setWebhook(interaction.guildId, url);
            await replyAutoDelete(interaction, '웹훅 등록이 완료되었습니다.');
            break;
        }
        // /역할 설정 or /역할 해제 or /역할설정 (이미 등록된 경우 재확인)
        case '역할':
        case '역할설정': {
            const subcommand = interaction.options.getSubcommand(false);
            const existing = db_1.dbOps.getWebhook(interaction.guildId);
            if (subcommand === '해제') {
                if (!existing?.role_id) {
                    await replyAutoDelete(interaction, '현재 설정된 지급 역할이 없습니다. (지급 역할: 없음)');
                    return;
                }
                const token = crypto_1.default.randomBytes(6).toString('hex');
                pendingChanges.set(token, {
                    type: 'clear_role',
                    guildId: interaction.guildId,
                    expires: Date.now() + 5 * 60 * 1000,
                });
                const row = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder()
                    .setCustomId(`change:confirm:${token}`)
                    .setLabel('해제하기')
                    .setStyle(discord_js_1.ButtonStyle.Danger), new discord_js_1.ButtonBuilder()
                    .setCustomId(`change:cancel:${token}`)
                    .setLabel('취소')
                    .setStyle(discord_js_1.ButtonStyle.Secondary));
                await interaction.reply({
                    content: [
                        '⚠️ **지급 역할 해제 확인**',
                        `현재 설정된 지급 역할(<@&${existing.role_id}>)을 해제(없음으로 변경)하시겠습니까?`,
                    ].join('\n'),
                    components: [row],
                    flags: discord_js_1.MessageFlags.Ephemeral,
                });
                return;
            }
            const role = interaction.options.getRole('role', true);
            if (existing?.role_id) {
                if (existing.role_id === role.id) {
                    await replyAutoDelete(interaction, `이미 <@&${role.id}> 역할로 설정되어 있습니다.`);
                    return;
                }
                const token = crypto_1.default.randomBytes(6).toString('hex');
                pendingChanges.set(token, {
                    type: 'role',
                    guildId: interaction.guildId,
                    value: role.id,
                    expires: Date.now() + 5 * 60 * 1000,
                });
                const row = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder()
                    .setCustomId(`change:confirm:${token}`)
                    .setLabel('변경하기')
                    .setStyle(discord_js_1.ButtonStyle.Primary), new discord_js_1.ButtonBuilder()
                    .setCustomId(`change:cancel:${token}`)
                    .setLabel('취소')
                    .setStyle(discord_js_1.ButtonStyle.Secondary));
                await interaction.reply({
                    content: [
                        '⚠️ **지급 역할 변경 확인**',
                        '이미 등록된 지급 역할이 존재합니다. 새 역할로 변경하시겠습니까?',
                        '',
                        `• **기존 역할:** <@&${existing.role_id}>`,
                        `• **새 역할:** <@&${role.id}>`,
                    ].join('\n'),
                    components: [row],
                    flags: discord_js_1.MessageFlags.Ephemeral,
                });
                return;
            }
            db_1.dbOps.setRole(interaction.guildId, role.id);
            // 봇 역할과의 서열 비교
            const botMember = interaction.guild?.members.me;
            let warning = '';
            if (botMember && role.position >= botMember.roles.highest.position) {
                warning = '\n\n⚠️ **주의:** 서버 설정(역할)에서 봇의 역할이 이 역할보다 위에 있어야 정상 지급됩니다.';
            }
            await replyAutoDelete(interaction, `인증 완료 시 <@&${role.id}> 역할을 지급하도록 설정했습니다.${warning}`);
            break;
        }
        // /인증 메시지 or /인증메시지 (한 채널당 최대 1개 제한)
        case '인증':
        case '인증메시지': {
            const guild = db_1.dbOps.getWebhook(interaction.guildId);
            if (!guild || !guild.webhook_url) {
                await replyAutoDelete(interaction, '웹훅이 설정되지 않았습니다. 먼저 `/설정` 명령어로 웹훅 URL을 등록해 주세요.');
                return;
            }
            if (!interaction.channel || !('send' in interaction.channel)) {
                await replyAutoDelete(interaction, '메시지를 보낼 수 없는 채널입니다.');
                return;
            }
            // 한 채널당 최대 1개의 인증 메시지만 허용
            const existingMsgId = db_1.dbOps.getChannelMessage(interaction.channelId);
            if (existingMsgId && 'messages' in interaction.channel) {
                const existingMsg = await interaction.channel.messages.fetch(existingMsgId).catch(() => null);
                if (existingMsg) {
                    // 기존 메시지가 아직 채널에 살아있는 경우 -> 교체 확인 버튼 제공
                    const row = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder()
                        .setCustomId(`replace_msg:${interaction.channelId}:${existingMsgId}`)
                        .setLabel('기존 메시지 삭제 후 새로 올리기')
                        .setStyle(discord_js_1.ButtonStyle.Danger), new discord_js_1.ButtonBuilder()
                        .setCustomId('replace_msg:cancel')
                        .setLabel('취소')
                        .setStyle(discord_js_1.ButtonStyle.Secondary));
                    await interaction.reply({
                        content: [
                            '⚠️ **이미 이 채널에 인증 메시지가 게시되어 있습니다.**',
                            '한 채널당 최대 1개의 인증 메시지만 올릴 수 있습니다.',
                            '',
                            '기존 메시지를 삭제하고 이 위치에 새로 올리시겠습니까?',
                        ].join('\n'),
                        components: [row],
                        flags: discord_js_1.MessageFlags.Ephemeral,
                    });
                    return;
                }
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
            const sentMsg = await interaction.channel.send({
                embeds: [embed],
                components: [row],
            });
            db_1.dbOps.setChannelMessage(interaction.channelId, sentMsg.id);
            const roleText = guild.role_id ? `<@&${guild.role_id}>` : '없음';
            await replyAutoDelete(interaction, `인증 메시지를 현재 채널에 보냈습니다. (지급 역할: ${roleText})`);
            break;
        }
        // /인원 수 or /인원수
        case '인원':
        case '인원수': {
            const count = db_1.dbOps.getUserCount(interaction.guildId);
            await replyAutoDelete(interaction, `현재까지 총 **${count}명**이 인증되었습니다.`);
            break;
        }
        // /불러오기 — 확인 프롬프트 표시
        case '불러오기': {
            if (activeRestores.has(interaction.guildId)) {
                await replyAutoDelete(interaction, '이미 복구 작업이 진행 중입니다.');
                return;
            }
            const count = db_1.dbOps.getUserCount(interaction.guildId);
            if (count === 0) {
                await replyAutoDelete(interaction, '저장된 인증 인원이 없습니다.');
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
    // 설정 변경 취소
    if (interaction.customId.startsWith('change:cancel:')) {
        const token = interaction.customId.split(':')[2];
        if (token)
            pendingChanges.delete(token);
        await updateAutoDelete(interaction, '변경 작업이 취소되었습니다.');
        return;
    }
    // 설정 변경 확인
    if (interaction.customId.startsWith('change:confirm:')) {
        const token = interaction.customId.split(':')[2];
        if (!token)
            return;
        const item = pendingChanges.get(token);
        if (!item || item.expires < Date.now()) {
            if (token)
                pendingChanges.delete(token);
            await updateAutoDelete(interaction, '확인 유효 시간이 만료되었습니다. 다시 시도해 주세요.');
            return;
        }
        pendingChanges.delete(token);
        if (item.type === 'webhook' && item.value) {
            db_1.dbOps.setWebhook(item.guildId, item.value);
            await updateAutoDelete(interaction, '✅ 웹훅 주소가 성공적으로 변경되었습니다.');
            return;
        }
        if (item.type === 'role' && item.value) {
            db_1.dbOps.setRole(item.guildId, item.value);
            const botMember = interaction.guild?.members.me;
            const targetRole = interaction.guild?.roles.cache.get(item.value);
            let warning = '';
            if (botMember && targetRole && targetRole.position >= botMember.roles.highest.position) {
                warning = '\n\n⚠️ **주의:** 서버 설정(역할)에서 봇의 역할이 이 역할보다 위에 있어야 정상 지급됩니다.';
            }
            await updateAutoDelete(interaction, `✅ 지급 역할이 <@&${item.value}> 역할로 변경되었습니다.${warning}`);
            return;
        }
        if (item.type === 'clear_role') {
            db_1.dbOps.setRole(item.guildId, '');
            await updateAutoDelete(interaction, '✅ 지급 역할 설정을 해제했습니다. (지급 역할: 없음)');
            return;
        }
    }
    // 기존 인증 메시지 교체 취소
    if (interaction.customId === 'replace_msg:cancel') {
        await updateAutoDelete(interaction, '인증 메시지 게시가 취소되었습니다.');
        return;
    }
    // 기존 인증 메시지 교체 확인
    if (interaction.customId.startsWith('replace_msg:')) {
        const parts = interaction.customId.split(':');
        const channelId = parts[1];
        const oldMsgId = parts[2];
        if (!channelId || !oldMsgId || !interaction.guildId)
            return;
        const channel = interaction.channel;
        if (channel && 'messages' in channel && 'send' in channel) {
            // 기존 메시지 삭제
            const oldMsg = await channel.messages.fetch(oldMsgId).catch(() => null);
            if (oldMsg) {
                await oldMsg.delete().catch(() => { });
            }
            // 새 인증 메시지 전송
            const buttonUrl = (0, server_1.getDirectDiscordAuthUrl)(interaction.guildId);
            const embed = new discord_js_1.EmbedBuilder()
                .setTitle('❤️‍🔥 우정샵 인증봇 ❤️‍🔥')
                .setDescription('아래 버튼을 눌러 인증을 진행해주세요.')
                .setColor(0x2B2D31);
            const row = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder()
                .setStyle(discord_js_1.ButtonStyle.Link)
                .setLabel('인증하기')
                .setURL(buttonUrl));
            const sentMsg = await channel.send({
                embeds: [embed],
                components: [row],
            });
            db_1.dbOps.setChannelMessage(channelId, sentMsg.id);
            const guild = db_1.dbOps.getWebhook(interaction.guildId);
            const roleText = guild?.role_id ? `<@&${guild.role_id}>` : '없음';
            await updateAutoDelete(interaction, `기존 인증 메시지를 삭제하고 새로 게시했습니다. (지급 역할: ${roleText})`);
        }
        return;
    }
    // 복구 취소
    if (interaction.customId === 'restore:cancel') {
        await updateAutoDelete(interaction, '복구 작업이 취소되었습니다.');
        return;
    }
    // 확인
    if (interaction.customId.startsWith('restore:confirm:')) {
        const guildId = interaction.customId.split(':')[2];
        if (!guildId)
            return;
        if (activeRestores.has(guildId)) {
            await updateAutoDelete(interaction, '이미 복구 작업이 진행 중입니다.');
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
        setTimeout(() => {
            interaction.deleteReply().catch(() => { });
        }, 5500);
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