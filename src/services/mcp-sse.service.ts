import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { TwilioCallService } from './twilio/call.service.js';

export class McpSSEService {
    private twilioCallService: TwilioCallService;
    private twilioCallbackUrl: string;

    constructor(twilioCallService: TwilioCallService, twilioCallbackUrl: string) {
        this.twilioCallService = twilioCallService;
        this.twilioCallbackUrl = twilioCallbackUrl;
    }

    public async handleMcpSSE(req: Request, res: Response): Promise<void> {
        console.log('[MCP SSE] New connection established');
        
        // Set SSE headers
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'X-Accel-Buffering': 'no',
        });

        // Send initial greeting
        res.write('event: message\n');
        res.write(`data: {"jsonrpc":"2.0","method":"greeting","params":{"message":"MCP SSE connection established"}}\n\n`);

        // LibreChat will POST JSON-RPC messages to this same endpoint
        // We need to handle them differently based on the request method
        if (req.method === 'POST') {
            // This is a message from LibreChat
            await this.handleMcpMessage(req, res);
            return;
        }

        // For GET requests, set up the SSE stream
        // Send capabilities immediately
        setTimeout(() => {
            res.write('event: message\n');
            res.write(`data: ${JSON.stringify({
                jsonrpc: '2.0',
                method: 'server.initialized',
                params: {
                    serverInfo: {
                        name: 'Voice Call MCP Server',
                        version: '1.0.0'
                    },
                    capabilities: {
                        tools: {}
                    }
                }
            })}\n\n`);
        }, 100);

        // Keep the connection alive
        const heartbeat = setInterval(() => {
            res.write(':\n\n'); // SSE comment for keepalive
        }, 30000);

        // Clean up on disconnect
        req.on('close', () => {
            console.log('[MCP SSE] Connection closed');
            clearInterval(heartbeat);
        });
    }

    public async handleMcpMessage(req: Request, res: Response): Promise<void> {
        const { method, params, id } = req.body;
        console.log('[MCP SSE] Received message:', method, id);

        try {
            let result: any;
            let isNotification = !id; // Notifications don't have IDs

            switch (method) {
                case 'notifications/initialized':
                    // This is a notification, no response needed
                    console.log('[MCP SSE] Client initialized');
                    res.status(200).send('OK');
                    return;

                case 'ping':
                    result = { pong: true };
                    break;

                case 'initialize':
                    result = {
                        protocolVersion: '1.0',
                        capabilities: {
                            tools: {}
                        },
                        serverInfo: {
                            name: 'Voice Call MCP Server',
                            version: '1.0.0'
                        }
                    };
                    break;

                case 'tools/list':
                    console.log('[MCP SSE] Listing tools');
                    result = {
                        tools: [{
                            name: 'trigger-call',
                            description: 'Trigger an outbound phone call via Twilio',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    toNumber: {
                                        type: 'string',
                                        description: 'The phone number to call (E.164 format)'
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
                    console.log('[MCP SSE] Calling tool:', params?.name);
                    if (params?.name === 'trigger-call') {
                        const { toNumber, callContext } = params.arguments || {};
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
                    } else {
                        throw new Error('Unknown tool: ' + params?.name);
                    }
                    break;

                default:
                    console.log('[MCP SSE] Unknown method:', method);
                    if (!isNotification) {
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
                    res.status(200).send('OK');
                    return;
            }

            // Send response
            if (!isNotification) {
                const response = {
                    jsonrpc: '2.0',
                    result,
                    id
                };
                console.log('[MCP SSE] Sending response:', response);
                res.json(response);
            } else {
                res.status(200).send('OK');
            }

        } catch (error) {
            console.error('[MCP SSE] Error:', error);
            if (id) {
                res.json({
                    jsonrpc: '2.0',
                    error: {
                        code: -32603,
                        message: 'Internal error',
                        data: error.message
                    },
                    id
                });
            } else {
                res.status(500).send('Internal error');
            }
        }
    }
}