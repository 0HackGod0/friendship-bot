import { startServer } from './server';
import { startBot } from './bot';

process.on('unhandledRejection', err => {
	console.error('[Process] Unhandled rejection:', err);
});

process.on('uncaughtException', err => {
	console.error('[Process] Uncaught exception:', err);
	process.exit(1);
});

startServer();
startBot();
