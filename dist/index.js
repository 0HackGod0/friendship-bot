"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const server_1 = require("./server");
const bot_1 = require("./bot");
process.on('unhandledRejection', err => {
    console.error('[Process] Unhandled rejection:', err);
});
process.on('uncaughtException', err => {
    console.error('[Process] Uncaught exception:', err);
    process.exit(1);
});
(0, server_1.startServer)();
(0, bot_1.startBot)();
//# sourceMappingURL=index.js.map