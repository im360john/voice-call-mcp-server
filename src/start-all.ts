import dotenv from 'dotenv';
import ngrok from '@ngrok/ngrok';
import { isPortInUse } from './utils/execution-utils.js';
import { VoiceCallMcpServer } from './servers/mcp.server.js';
import { TwilioCallService } from './services/twilio/call.service.js';
import { TwilioSMSService } from './services/twilio/sms.service.js';
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
    const ngrokConfig: any = {
        addr: portNumber,
        authtoken_from_env: true,
        // Enable pooling to allow multiple endpoints on the same domain
        pooling_enabled: true
    };

    // Use domain if provided in environment variables
    if (process.env.NGROK_DOMAIN) {
        ngrokConfig.domain = process.env.NGROK_DOMAIN;
    }

    try {
        const listener = await ngrok.forward(ngrokConfig);

        const twilioCallbackUrl = listener.url();
        if (!twilioCallbackUrl) {
            throw new Error('Failed to obtain ngrok URL');
        }

        return twilioCallbackUrl;
    } catch (error: any) {
        // If the endpoint is already online, try to disconnect and reconnect
        if (error.errorCode === 'ERR_NGROK_334') {
            console.log('Ngrok endpoint already online. Attempting to disconnect and reconnect...');
            
            try {
                // Try to disconnect existing connections
                await ngrok.disconnect();
                await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
                
                // Try again
                const listener = await ngrok.forward(ngrokConfig);
                const twilioCallbackUrl = listener.url();
                
                if (!twilioCallbackUrl) {
                    throw new Error('Failed to obtain ngrok URL after retry');
                }
                
                return twilioCallbackUrl;
            } catch (retryError) {
                console.error('Failed to reconnect after disconnect:', retryError);
                throw new Error('Ngrok endpoint is already in use. Please check https://dashboard.ngrok.com/endpoints/status and stop the existing endpoint.');
            }
        }
        
        throw error;
    }
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
        
        // Disconnect any existing ngrok connections at startup
        try {
            await ngrok.disconnect();
            console.log('Disconnected any existing ngrok connections');
        } catch (e) {
            // Ignore errors if nothing to disconnect
        }

        const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

        const sessionManager = new CallSessionManager(twilioClient);
        const twilioCallService = new TwilioCallService(twilioClient);
        const twilioSMSService = new TwilioSMSService(twilioClient);

        // Check if port is already in use
        const portInUse = await isPortInUse(portNumber);
        if (portInUse) {
            scheduleServerRetry(portNumber);
            return;
        }

        // Establish ngrok connectivity
        const twilioCallbackUrl = await setupNgrokTunnel(portNumber);

        // Start the main HTTP server with MCP HTTP support
        const server = new VoiceServer(twilioCallbackUrl, sessionManager, twilioCallService, twilioSMSService);
        server.start();

        const mcpServer = new VoiceCallMcpServer(twilioCallService, twilioSMSService, twilioCallbackUrl);
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
