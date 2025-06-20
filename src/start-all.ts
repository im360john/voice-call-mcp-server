import dotenv from 'dotenv';
import ngrok from '@ngrok/ngrok';
import { isPortInUse } from './utils/execution-utils.js';
import { VoiceCallMcpServer } from './servers/mcp.server.js';
import { TwilioCallService } from './services/twilio/call.service.js';
import { VoiceServer } from './servers/voice.server.js';
import twilio from 'twilio';
import { CallSessionManager } from './handlers/openai.handler.js';

// Load environment variables
dotenv.config();

// Define required environment variables
const REQUIRED_ENV_VARS = [
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'OPENAI_API_KEY',
    'NGROK_AUTHTOKEN',
    'TWILIO_NUMBER'
] as const;

/**
 * Validates that all required environment variables are present
 * @returns true if all variables are present, exits process otherwise
 */
function validateEnvironmentVariables(): boolean {
    for (const envVar of REQUIRED_ENV_VARS) {
        if (!process.env[envVar]) {
            console.error(`Error: ${envVar} environment variable is required`);
            process.exit(1);
        }
    }
    return true;
}

/**
 * Sets up the port for the application
 */
function setupPort(): number {
    const PORT = process.env.PORT || '3004';
    process.env.PORT = PORT;
    return parseInt(PORT);
}

/**
 * Establishes ngrok tunnel for external access
 * @param portNumber - The port number to forward
 * @returns The public URL provided by ngrok
 */
async function setupNgrokTunnel(portNumber: number): Promise<string> {
    const listener = await ngrok.forward({
        addr: portNumber,
        authtoken_from_env: true
    });

    const twilioCallbackUrl = listener.url();
    if (!twilioCallbackUrl) {
        throw new Error('Failed to obtain ngrok URL');
    }

    return twilioCallbackUrl;
}

/**
 * Sets up graceful shutdown handlers
 */
function setupShutdownHandlers(): void {
    process.on('SIGINT', async () => {
        try {
            await ngrok.disconnect();
        } catch (err) {
            console.error('Error killing ngrok:', err);
        }
        process.exit(0);
    });
}

/**
 * Retries starting the server when the port is in use
 * @param portNumber - The port number to check
 */
function scheduleServerRetry(portNumber: number): void {
    console.error(`Port ${portNumber} is already in use. Server may already be running.`);
    console.error('Will retry in 15 seconds...');

    const RETRY_INTERVAL_MS = 15000;

    const retryInterval = setInterval(async () => {
        const stillInUse = await isPortInUse(portNumber);

        if (!stillInUse) {
            clearInterval(retryInterval);
            main();
        } else {
            console.error(`Port ${portNumber} is still in use. Will retry in 15 seconds...`);
        }
    }, RETRY_INTERVAL_MS);
}


async function main(): Promise<void> {
    try {
        validateEnvironmentVariables();
        const portNumber = setupPort();

        const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

        const sessionManager = new CallSessionManager(twilioClient);
        const twilioCallService = new TwilioCallService(twilioClient);

        // Check if port is already in use
        const portInUse = await isPortInUse(portNumber);
        if (portInUse) {
            scheduleServerRetry(portNumber);
            return;
        }

        // Establish ngrok connectivity
        const twilioCallbackUrl = await setupNgrokTunnel(portNumber);

        // Start the main HTTP server with MCP HTTP support
        const server = new VoiceServer(twilioCallbackUrl, sessionManager, twilioCallService);
        server.start();

        const mcpServer = new VoiceCallMcpServer(twilioCallService, twilioCallbackUrl);
        await mcpServer.start();

        // Set up graceful shutdown
        setupShutdownHandlers();
    } catch (error) {
        console.error('Error starting services:', error);
        process.exit(1);
    }
}

// Start the main function
main();
