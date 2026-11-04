"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
function requireEnv(key) {
    const val = process.env[key];
    if (!val)
        throw new Error(`[Config] 환경변수 누락: ${key}`);
    return val;
}
exports.config = {
    BOT_TOKEN: requireEnv('BOT_TOKEN'),
    CLIENT_ID: requireEnv('CLIENT_ID'),
    CLIENT_SECRET: requireEnv('CLIENT_SECRET'),
    REDIRECT_URI: requireEnv('REDIRECT_URI'),
    PORT: parseInt(process.env['PORT'] ?? '3000', 10),
    DB_PATH: process.env['DB_PATH'] ?? 'recovery.db',
};
//# sourceMappingURL=config.js.map