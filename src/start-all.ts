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
    // Parse comma-separated domains from environment variable
    const domains = process.env.NGROK_DOMAIN 
        ? process.env.NGROK_DOMAIN.split(',').map(d => d.trim()).filter(d => d)
        : [];

    const ngrokConfig: any = {
        addr: portNumber,
        authtoken_from_env: true,
        // Enable pooling to allow multiple endpoints on the same domain
        pooling_enabled: true
    };

    // Try each domain in order until one succeeds
    const errors: Array<{ domain: string; error: any }> = [];

    for (const domain of domains) {
        console.log(`Attempting to establish ngrok tunnel with domain: ${domain}`);
        ngrokConfig.domain = domain;

        try {
            const listener = await ngrok.forward(ngrokConfig);

            const twilioCallbackUrl = listener.url();
            if (!twilioCallbackUrl) {
                throw new Error('Failed to obtain ngrok URL');
            }

            console.log(`Successfully established ngrok tunnel at: ${twilioCallbackUrl}`);
            return twilioCallbackUrl;
        } catch (error: any) {
            // If the endpoint is already online, try to disconnect and reconnect
            if (error.errorCode === 'ERR_NGROK_334') {
                console.log(`Ngrok endpoint ${domain} already online. Attempting to disconnect and reconnect...`);
                
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
                    
                    console.log(`Successfully established ngrok tunnel at: ${twilioCallbackUrl} (after retry)`);
                    return twilioCallbackUrl;
                } catch (retryError) {
                    console.error(`Failed to reconnect ${domain} after disconnect:`, retryError);
                    errors.push({ domain, error: retryError });
                }
            } else {
                console.error(`Failed to establish tunnel with domain ${domain}:`, error.message || error);
                errors.push({ domain, error });
            }
        }
    }

    // If no domains were provided or all failed, try without a specific domain
    if (domains.length === 0 || errors.length === domains.length) {
        console.log('Attempting to establish ngrok tunnel without specific domain...');
        delete ngrokConfig.domain;

        try {
            const listener = await ngrok.forward(ngrokConfig);

            const twilioCallbackUrl = listener.url();
            if (!twilioCallbackUrl) {
                throw new Error('Failed to obtain ngrok URL');
            }

            console.log(`Successfully established ngrok tunnel at: ${twilioCallbackUrl} (random domain)`);
            return twilioCallbackUrl;
        } catch (error: any) {
            console.error('Failed to establish ngrok tunnel without domain:', error);
            
            // Provide comprehensive error message
            if (errors.length > 0) {
                console.error('\nDomain-specific errors:');
                errors.forEach(({ domain, error }) => {
                    console.error(`  - ${domain}: ${error.message || error}`);
                });
            }
            
            throw new Error('Failed to establish ngrok tunnel with any of the provided domains or with a random domain. Please check https://dashboard.ngrok.com/endpoints/status');
        }
    }

    throw new Error('Failed to establish ngrok tunnel');
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
