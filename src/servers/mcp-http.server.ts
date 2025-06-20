import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { TwilioCallService } from '../services/twilio/call.service.js';

interface JsonRpcRequest {
    jsonrpc: string;
    method: string;
    params?: any;
    id: string | number;
}

interface JsonRpcResponse {
    jsonrpc: string;
    result?: any;
    error?: {
        code: number;
        message: string;
        data?: any;
    };
    id: string | number;
}

export class McpHttpServer {
    private twilioCallService: TwilioCallService;
    private twilioCallbackUrl: string;

    constructor(twilioCallService: TwilioCallService, twilioCallbackUrl: string) {
        this.twilioCallService = twilioCallService;
        this.twilioCallbackUrl = twilioCallbackUrl;
    }

    public setupRoutes(app: express.Application): void {
        // MCP endpoint for LibreChat
        app.post('/mcp', this.handleMcpRequest.bind(this));
        app.get('/mcp', this.handleMcpSSE.bind(this));
    }

    private async handleMcpRequest(req: Request, res: Response): Promise<void> {
        const request = req.body as JsonRpcRequest;

        if (!request.jsonrpc || request.jsonrpc !== '2.0') {
            res.status(400).json({
                jsonrpc: '2.0',
                error: {
                    code: -32600,
                    message: 'Invalid Request'
                },
                id: null
            });
            return;
        }

        try {
            const response = await this.processRequest(request);
            res.json(response);
        } catch (error) {
            res.json({
                jsonrpc: '2.0',
                error: {
                    code: -32603,
                    message: 'Internal error',
                    data: error.message
                },
                id: request.id
            });
        }
    }

    private async processRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
        switch (request.method) {
            case 'initialize':
                return {
                    jsonrpc: '2.0',
                    result: {
                        protocolVersion: '1.0',
                        capabilities: {
                            tools: { listChanged: false },
                            resources: { listChanged: false },
                            prompts: { listChanged: false }
                        },
                        serverInfo: {
                            name: 'Voice Call MCP Server',
                            version: '1.0.0'
                        }
                    },
                    id: request.id
                };

            case 'tools/list':
                return {
                    jsonrpc: '2.0',
                    result: {
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
                    },
                    id: request.id
                };

            case 'tools/call':
                if (request.params?.name === 'trigger-call') {
                    try {
                        const { toNumber, callContext } = request.params.arguments;
                        const callSid = await this.twilioCallService.makeCall(
                            this.twilioCallbackUrl,
                            toNumber,
                            callContext
                        );
                        const sseUrl = `${this.twilioCallbackUrl}/events?callSid=${callSid}`;

                        return {
                            jsonrpc: '2.0',
                            result: {
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
                            },
                            id: request.id
                        };
                    } catch (error) {
                        return {
                            jsonrpc: '2.0',
                            result: {
                                content: [{
                                    type: 'text',
                                    text: JSON.stringify({
                                        status: 'error',
                                        message: `Failed to trigger call: ${error.message}`
                                    })
                                }],
                                isError: true
                            },
                            id: request.id
                        };
                    }
                }
                break;

            default:
                return {
                    jsonrpc: '2.0',
                    error: {
                        code: -32601,
                        message: 'Method not found'
                    },
                    id: request.id
                };
        }
    }

    private handleMcpSSE(req: Request, res: Response): void {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
        });

        // Send initial connection event
        const connectionEvent = `event: open\ndata: ${JSON.stringify({
            jsonrpc: '2.0',
            method: 'connection.open',
            params: { protocolVersion: '1.0' }
        })}\n\n`;
        res.write(connectionEvent);

        // Keep connection alive
        const keepAlive = setInterval(() => {
            res.write(':keepalive\n\n');
        }, 30000);

        req.on('close', () => {
            clearInterval(keepAlive);
        });
    }
}