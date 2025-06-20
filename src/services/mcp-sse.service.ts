import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { TwilioCallService } from './twilio/call.service.js';

export class McpSSEService {
    private twilioCallService: TwilioCallService;
    private twilioCallbackUrl: string;
    private clients: Map<string, Response> = new Map();

    constructor(twilioCallService: TwilioCallService, twilioCallbackUrl: string) {
        this.twilioCallService = twilioCallService;
        this.twilioCallbackUrl = twilioCallbackUrl;
    }

    public async handleMcpSSE(req: Request, res: Response): Promise<void> {
        // Set SSE headers
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'X-Accel-Buffering': 'no',
        });

        const sessionId = uuidv4();
        this.clients.set(sessionId, res);

        // Send initial connection event
        this.sendMessage(res, {
            jsonrpc: '2.0',
            method: 'connection.established',
            params: {
                sessionId,
                protocolVersion: '1.0'
            }
        });

        // Handle disconnection
        req.on('close', () => {
            this.clients.delete(sessionId);
        });

        // Keep connection alive
        const heartbeat = setInterval(() => {
            if (this.clients.has(sessionId)) {
                res.write(':heartbeat\n\n');
            } else {
                clearInterval(heartbeat);
            }
        }, 30000);
    }

    // Handle JSON-RPC requests sent via POST to /mcp
    public async handleMcpRequest(req: Request, res: Response): Promise<void> {
        const { method, params, id } = req.body;

        try {
            let result: any;

            switch (method) {
                case 'initialize':
                    result = {
                        protocolVersion: '1.0',
                        capabilities: {
                            tools: { listChanged: false }
                        },
                        serverInfo: {
                            name: 'Voice Call MCP Server',
                            version: '1.0.0'
                        }
                    };
                    break;

                case 'tools/list':
                    result = {
                        tools: [{
                            name: 'trigger-call',
                            description: 'Trigger an outbound phone call via Twilio',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    toNumber: {
                                        type: 'string',
                                        description: 'The phone number to call'
                                    },
                                    callContext: {
                                        type: 'string',
                                        description: 'Context for the call'
                                    }
                                },
                                required: ['toNumber', 'callContext']
                            }
                        }]
                    };
                    break;

                case 'tools/call':
                    if (params?.name === 'trigger-call') {
                        const { toNumber, callContext } = params.arguments;
                        const callSid = await this.twilioCallService.makeCall(
                            this.twilioCallbackUrl,
                            toNumber,
                            callContext
                        );
                        const sseUrl = `${this.twilioCallbackUrl}/events?callSid=${callSid}`;

                        result = {
                            content: [{
                                type: 'text',
                                text: JSON.stringify({
                                    status: 'success',
                                    message: 'Call triggered successfully',
                                    callSid: callSid,
                                    sseUrl: sseUrl
                                })
                            }]
                        };
                    }
                    break;

                default:
                    res.json({
                        jsonrpc: '2.0',
                        error: {
                            code: -32601,
                            message: 'Method not found'
                        },
                        id
                    });
                    return;
            }

            res.json({
                jsonrpc: '2.0',
                result,
                id
            });

        } catch (error) {
            res.json({
                jsonrpc: '2.0',
                error: {
                    code: -32603,
                    message: 'Internal error',
                    data: error.message
                },
                id
            });
        }
    }

    private sendMessage(res: Response, message: any): void {
        res.write(`data: ${JSON.stringify(message)}\n\n`);
    }
}