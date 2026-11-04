"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dbOps = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const config_1 = require("./config");
const dbFilePath = path_1.default.resolve(config_1.config.DB_PATH.endsWith('.json') ? config_1.config.DB_PATH : config_1.config.DB_PATH.replace(/\.[^/.]+$/, '') + '.json');
function loadData() {
    try {
        if (fs_1.default.existsSync(dbFilePath)) {
            const raw = fs_1.default.readFileSync(dbFilePath, 'utf-8');
            return JSON.parse(raw);
        }
    }
    catch (e) {
        console.error('[DB] 로드 실패, 초기화합니다:', e);
    }
    return { guilds: {}, users: {} };
}
let dbData = loadData();
function saveData() {
    try {
        const tempPath = `${dbFilePath}.tmp`;
        fs_1.default.writeFileSync(tempPath, JSON.stringify(dbData, null, 2), 'utf-8');
        fs_1.default.renameSync(tempPath, dbFilePath);
    }
    catch (e) {
        console.error('[DB] 저장 실패:', e);
    }
}
exports.dbOps = {
    upsertUser(record) {
        const key = `${record.user_id}:${record.guild_id}`;
        dbData.users[key] = { ...record };
        saveData();
    },
    getUsersByGuild(guildId) {
        return Object.values(dbData.users).filter(u => u.guild_id === guildId);
    },
    updateTokens(params) {
        const key = `${params.user_id}:${params.guild_id}`;
        if (dbData.users[key]) {
            dbData.users[key].access_token = params.access_token;
            dbData.users[key].refresh_token = params.refresh_token;
            dbData.users[key].token_expires_at = params.token_expires_at;
            saveData();
        }
    },
    setWebhook(guildId, webhookUrl) {
        const existing = dbData.guilds[guildId];
        dbData.guilds[guildId] = {
            guild_id: guildId,
            webhook_url: webhookUrl,
            role_id: existing?.role_id,
            setup_at: Date.now(),
        };
        saveData();
    },
    setRole(guildId, roleId) {
        const existing = dbData.guilds[guildId];
        if (existing) {
            existing.role_id = roleId;
        }
        else {
            dbData.guilds[guildId] = {
                guild_id: guildId,
                webhook_url: '',
                role_id: roleId,
                setup_at: Date.now(),
            };
        }
        saveData();
    },
    getRole(guildId) {
        return dbData.guilds[guildId]?.role_id;
    },
    getWebhook(guildId) {
        return dbData.guilds[guildId];
    },
    getUserCount(guildId) {
        return Object.values(dbData.users).filter(u => u.guild_id === guildId).length;
    },
};
exports.default = exports.dbOps;
//# sourceMappingURL=db.js.map