import dotenv from 'dotenv';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { HttpServerTransport } from '@modelcontextprotocol/sdk/server/http.js';
import { z } from 'zod';
import ngrok from '@ngrok/ngrok';
import twilio from 'twilio';
import { TwilioCallService } from './services/twilio/call.service.js';
import { VoiceServer } from './servers/voice.server.js';
import { CallSessionManager } from './handlers/openai.handler.js';

dotenv.config();

// HTTP MCP Server for LibreChat compatibility
export class HttpMcpServer {
    private server: McpServer;
    private twilioCallService: TwilioCallService;
    private twilioCallbackUrl: string;
    private httpTransport: HttpServerTransport;

    constructor(twilioCallService: TwilioCallService, twilioCallbackUrl: string) {
        this.twilioCallbackUrl = twilioCallbackUrl;
        this.twilioCallService = twilioCallService;

        this.server = new McpServer({
            name: 'Voice Call MCP Server',
            version: '1.0.0',
            description: 'MCP server that provides tools for initiating phone calls via Twilio'
        });

        // Create HTTP transport without authentication
        this.httpTransport = new HttpServerTransport({
            endpoint: '/mcp',
            cors: {
                origin: '*',
                credentials: true
            }
        });

        this.registerTools();
    }

    private registerTools(): void {
        this.server.tool(
            'trigger-call',
            'Trigger an outbound phone call via Twilio',
            {
                toNumber: z.string().describe('The phone number to call'),
                callContext: z.string().describe('Context for the call')
            },
            async ({ toNumber, callContext }) => {
                try {
                    const callSid = await this.twilioCallService.makeCall(this.twilioCallbackUrl, toNumber, callContext);
                    const sseUrl = `${this.twilioCallbackUrl}/events?callSid=${callSid}`;

                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'success',
                                message: 'Call triggered successfully',
                                callSid: callSid,
                                sseUrl: sseUrl,
                                info: 'Connect to the SSE URL to receive real-time call updates and transcriptions'
                            })
                        }]
                    };
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'error',
                                message: `Failed to trigger call: ${errorMessage}`
                            })
                        }],
                        isError: true
                    };
                }
            }
        );
    }

    public getExpressMiddleware() {
        return this.httpTransport.getMiddleware();
    }

    public async start(): Promise<void> {
        await this.server.connect(this.httpTransport);
    }
}

async function main() {
    const PORT = process.env.MCP_PORT || '3005';
    const app = express();
    
    // Setup middleware
    app.use(express.json());
    
    // Basic health check
    app.get('/health', (req, res) => {
        res.json({ status: 'ok', service: 'voice-call-mcp-server' });
    });

    // Initialize services
    const portNumber = parseInt(process.env.PORT || '3004');
    const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const sessionManager = new CallSessionManager(twilioClient);
    const twilioCallService = new TwilioCallService(twilioClient);

    // Setup ngrok
    const listener = await ngrok.forward({
        addr: portNumber,
        authtoken_from_env: true
    });
    const twilioCallbackUrl = listener.url();

    // Start Voice Server
    const voiceServer = new VoiceServer(twilioCallbackUrl, sessionManager);
    voiceServer.start();

    // Start HTTP MCP Server
    const mcpServer = new HttpMcpServer(twilioCallService, twilioCallbackUrl);
    
    // Add MCP middleware to Express
    app.use(mcpServer.getExpressMiddleware());
    
    await mcpServer.start();

    // Start Express server
    app.listen(parseInt(PORT), () => {
        console.log(`HTTP MCP Server listening on port ${PORT}`);
        console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
        console.log(`Voice server running on port ${portNumber}`);
        console.log(`Ngrok URL: ${twilioCallbackUrl}`);
    });
}

main().catch(console.error);