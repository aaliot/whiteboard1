import { getArgs } from "./utils.js";

const SERVER_MODES = {
    PRODUCTION: 1,
    DEVELOPMENT: 2,
};

const args = getArgs();

if (typeof args.mode === "undefined") {
    // default to production mode
    args.mode = "production";
}

if (args.mode !== "production" && args.mode !== "development") {
    throw new Error("--mode can only be 'development' or 'production'");
}

const server_mode = args.mode === "production" ? SERVER_MODES.PRODUCTION : SERVER_MODES.DEVELOPMENT;

// Check if Redis/distributed mode is enabled
const useRedis = process.env.USE_REDIS === "true";

// Import the appropriate backend based on configuration
let startBackendServer;
if (useRedis) {
    console.info("Redis distributed mode enabled.");
    startBackendServer = (await import("./server-backend-distributed.js")).default;
} else {
    startBackendServer = (await import("./server-backend.js")).default;
}

if (server_mode === SERVER_MODES.DEVELOPMENT) {
    let startFrontendDevServer = (await import("./server-frontend-dev.js")).startFrontendDevServer;
    console.info("Starting server in development mode.");
    startFrontendDevServer(8080, function () {
        // this time, it's the frontend server that is on port 8080
        // requests for the backend will be proxied to prevent cross origins errors
        startBackendServer(3000);
    });
} else {
    console.info("Starting server in production mode.");
    startBackendServer(process.env.PORT || 8080);
}
