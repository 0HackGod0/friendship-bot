import fs from 'fs';
import path from 'path';
import { config } from './config';

export interface UserRecord {
	user_id:          string;
	guild_id:         string;
	username:         string;
	discriminator:    string;
	email:            string;
	access_token:     string;
	refresh_token:    string;
	token_expires_at: number;
	ip:               string;
	verified_at:      number;
}

export interface GuildRecord {
	guild_id:    string;
	webhook_url: string;
	role_id?:    string;
	setup_at:    number;
}

interface DatabaseSchema {
	guilds: Record<string, GuildRecord>;
	users:  Record<string, UserRecord>; // key: `${user_id}:${guild_id}`
}

const dbFilePath = path.resolve(
	config.DB_PATH.endsWith('.json') ? config.DB_PATH : config.DB_PATH.replace(/\.[^/.]+$/, '') + '.json'
);

function loadData(): DatabaseSchema {
	try {
		if (fs.existsSync(dbFilePath)) {
			const raw = fs.readFileSync(dbFilePath, 'utf-8');
			return JSON.parse(raw);
		}
	} catch (e) {
		console.error('[DB] 로드 실패, 초기화합니다:', e);
	}
	return { guilds: {}, users: {} };
}

let dbData: DatabaseSchema = loadData();

function saveData(): void {
	try {
		const tempPath = `${dbFilePath}.tmp`;
		fs.writeFileSync(tempPath, JSON.stringify(dbData, null, 2), 'utf-8');
		fs.renameSync(tempPath, dbFilePath);
	} catch (e) {
		console.error('[DB] 저장 실패:', e);
	}
}

export const dbOps = {
	upsertUser(record: UserRecord): void {
		const key = `${record.user_id}:${record.guild_id}`;
		dbData.users[key] = { ...record };
		saveData();
	},

	getUsersByGuild(guildId: string): UserRecord[] {
		return Object.values(dbData.users).filter(u => u.guild_id === guildId);
	},

	getAllUsers(): UserRecord[] {
		return Object.values(dbData.users);
	},

	updateTokens(params: {
		access_token: string;
		refresh_token: string;
		token_expires_at: number;
		user_id: string;
		guild_id: string;
	}): void {
		const key = `${params.user_id}:${params.guild_id}`;
		if (dbData.users[key]) {
			dbData.users[key].access_token = params.access_token;
			dbData.users[key].refresh_token = params.refresh_token;
			dbData.users[key].token_expires_at = params.token_expires_at;
			saveData();
		}
	},

	setWebhook(guildId: string, webhookUrl: string): void {
		const existing = dbData.guilds[guildId];
		dbData.guilds[guildId] = {
			guild_id:    guildId,
			webhook_url: webhookUrl,
			role_id:     existing?.role_id,
			setup_at:    Date.now(),
		};
		saveData();
	},

	setRole(guildId: string, roleId: string): void {
		const existing = dbData.guilds[guildId];
		const targetRole = roleId && roleId.trim().length > 0 ? roleId : undefined;
		if (existing) {
			existing.role_id = targetRole;
		} else {
			dbData.guilds[guildId] = {
				guild_id:    guildId,
				webhook_url: '',
				role_id:     targetRole,
				setup_at:    Date.now(),
			};
		}
		saveData();
	},

	getRole(guildId: string): string | undefined {
		return dbData.guilds[guildId]?.role_id;
	},

	getWebhook(guildId: string): GuildRecord | undefined {
		return dbData.guilds[guildId];
	},

	getUserCount(guildId: string): number {
		return Object.values(dbData.users).filter(u => u.guild_id === guildId).length;
	},
};

export default dbOps;
