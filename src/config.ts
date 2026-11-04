import dotenv from 'dotenv';
dotenv.config();

function requireEnv(key: string): string {
	const val = process.env[key];
	if (!val) throw new Error(`[Config] 환경변수 누락: ${key}`);
	return val;
}

export const config = {
	BOT_TOKEN:     requireEnv('BOT_TOKEN'),
	CLIENT_ID:     requireEnv('CLIENT_ID'),
	CLIENT_SECRET: requireEnv('CLIENT_SECRET'),
	REDIRECT_URI:  requireEnv('REDIRECT_URI'),
	PORT:          parseInt(process.env['PORT'] ?? '3000', 10),
	DB_PATH:       process.env['DB_PATH'] ?? 'recovery.db',
} as const;
