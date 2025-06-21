import dotenv from 'dotenv';
import express, { Response, Request } from 'express';
import VoiceResponse from 'twilio/lib/twiml/VoiceResponse.js';
import ExpressWs from 'express-ws';
import { WebSocket } from 'ws';
import cors from 'cors';
import { CallType, AIProvider } from '../types.js';
import { DYNAMIC_API_SECRET } from '../config/constants.js';
import { CallSessionManager } from '../handlers/openai.handler.js';
import { handleSSE, callEventEmitter } from '../services/sse.service.js';
import { VoiceCallMcpServer } from './mcp.server.js';
import { TwilioCallService } from '../services/twilio/call.service.js';
import { TwilioSMSService } from '../services/twilio/sms.service.js';
import { McpSSEServer } from './mcp-sse-server.js';
import { smsStorage } from '../services/sms-storage.service.js';
dotenv.config();

export class VoiceServer {
    private app: express.Application & { ws: any };
    private port: number;
    private sessionManager: CallSessionManager;
    private callbackUrl: string;
    private twilioCallService?: TwilioCallService;
    private twilioSMSService?: TwilioSMSService;

    constructor(callbackUrl: string, sessionManager: CallSessionManager, twilioCallService?: TwilioCallService, twilioSMSService?: TwilioSMSService) {
        this.callbackUrl = callbackUrl;
        this.port = parseInt(process.env.PORT || '3004');
        this.app = ExpressWs(express()).app;
        this.sessionManager = sessionManager;
        this.twilioCallService = twilioCallService;
        this.twilioSMSService = twilioSMSService;
        this.configureMiddleware();
        this.setupRoutes();
    }

    private configureMiddleware(): void {
        this.app.use(cors({
            origin: process.env.SSE_CORS_ORIGIN || '*',
            credentials: true,
        }));
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: false }));
    }

    private setupRoutes(): void {
        // OpenAI routes
        this.app.post('/call/outgoing', this.handleOutgoingCall.bind(this));
        this.app.ws('/call/connection-outgoing/:secret', this.handleOutgoingConnection.bind(this));
        
        // ElevenLabs routes
        this.app.post('/call/outgoing/elevenlabs', this.handleElevenLabsOutgoingCall.bind(this));
        this.app.ws('/call/connection-elevenlabs/:secret', this.handleElevenLabsConnection.bind(this));
        
        // SSE endpoint
        this.app.get('/events', handleSSE);

        // Add SMS routes if SMS service is provided
        if (this.twilioSMSService) {
            this.app.post('/sms/webhook', this.handleIncomingSMS.bind(this));
            this.app.post('/sms/send', this.handleSendSMS.bind(this));
            this.app.get('/sms/events', this.handleSMSSSE.bind(this));
        }

        // Add MCP SSE endpoint if twilioCallService is provided
        if (this.twilioCallService && this.twilioSMSService) {
            const mcpSSEServer = new McpSSEServer(this.twilioCallService, this.twilioSMSService, this.callbackUrl);
            
            // SSE endpoint
            this.app.get('/mcp', mcpSSEServer.handleSSE.bind(mcpSSEServer));
            
            // Messages endpoint for POST requests
            this.app.post('/mcp/messages', mcpSSEServer.handleMessage.bind(mcpSSEServer));
        }
    }

    private async handleOutgoingCall(req: express.Request, res: Response): Promise<void> {
        const apiSecret = req.query.apiSecret?.toString();

        if (req.query.apiSecret?.toString() !== DYNAMIC_API_SECRET) {
            res.status(401).json({ error: 'Unauthorized: Invalid or missing API secret' });
            return;
        }

        const fromNumber = req.body.From;
        const toNumber = req.body.To;
        const callContext = req.query.callContext?.toString();

        const twiml = new VoiceResponse();
        const connect = twiml.connect();

        const stream = connect.stream({
            url: `${this.callbackUrl.replace('https://', 'wss://')}/call/connection-outgoing/${apiSecret}`,
        });

        stream.parameter({ name: 'fromNumber', value: fromNumber });
        stream.parameter({ name: 'toNumber', value: toNumber });
        stream.parameter({ name: 'callContext', value: callContext });

        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(twiml.toString());
    }

    private handleOutgoingConnection(ws: WebSocket, req: express.Request): void {
        if (req.params.secret !== DYNAMIC_API_SECRET) {
            ws.close(1008, 'Unauthorized: Invalid or missing API secret');
            return;
        }

        this.sessionManager.createSession(ws, CallType.OUTBOUND);
    }

    private handleElevenLabsOutgoingCall(req: express.Request, res: Response): void {
        const apiSecret = DYNAMIC_API_SECRET;
        const {
            fromNumber = req.body.From,
            toNumber = req.body.To,
            callContext = req.body.callContext || '',
        } = req.body;

        const twiml = new VoiceResponse();
        const connect = twiml.connect();

        const stream = connect.stream({
            url: `${this.callbackUrl.replace('https://', 'wss://')}/call/connection-elevenlabs/${apiSecret}`,
        });

        stream.parameter({ name: 'fromNumber', value: fromNumber });
        stream.parameter({ name: 'toNumber', value: toNumber });
        stream.parameter({ name: 'callContext', value: callContext });

        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(twiml.toString());
    }

    private handleElevenLabsConnection(ws: WebSocket, req: express.Request): void {
        if (req.params.secret !== DYNAMIC_API_SECRET) {
            ws.close(1008, 'Unauthorized: Invalid or missing API secret');
            return;
        }

        this.sessionManager.createSession(ws, CallType.OUTBOUND, AIProvider.ELEVENLABS);
    }

    private async handleIncomingSMS(req: Request, res: Response): Promise<void> {
        try {
            if (!this.twilioSMSService) {
                res.status(500).send('SMS service not configured');
                return;
            }

            const smsMessage = this.twilioSMSService.processIncomingSMS(req.body);
            const conversationId = smsStorage.addMessage(smsMessage);

            // Emit event for SSE
            callEventEmitter.emit('sms:conversation:updated', {
                conversationId,
                message: smsMessage
            });

            // Send empty response to Twilio
            res.writeHead(200, { 'Content-Type': 'text/xml' });
            res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
        } catch (error) {
            console.error('Error handling incoming SMS:', error);
            res.status(500).send('Error processing SMS');
        }
    }

    private async handleSendSMS(req: Request, res: Response): Promise<void> {
        try {
            if (!this.twilioSMSService) {
                res.status(500).json({ error: 'SMS service not configured' });
                return;
            }

            const { to, body } = req.body;

            if (!to || !body) {
                res.status(400).json({ error: 'Missing required fields: to, body' });
                return;
            }

            const smsMessage = await this.twilioSMSService.sendSMS(to, body);
            const conversationId = smsStorage.addMessage(smsMessage);

            res.json({
                success: true,
                messageSid: smsMessage.messageSid,
                conversationId,
                message: smsMessage
            });
        } catch (error) {
            console.error('Error sending SMS:', error);
            res.status(500).json({ error: 'Failed to send SMS' });
        }
    }

    private handleSMSSSE(req: Request, res: Response): void {
        const conversationId = req.query.conversationId as string;

        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': process.env.SSE_CORS_ORIGIN || '*',
            'Access-Control-Allow-Credentials': 'true',
        });

        const handleSMSUpdate = (data: any) => {
            if (!conversationId || data.conversationId === conversationId) {
                res.write(`event: sms-update\ndata: ${JSON.stringify(data)}\n\n`);
            }
        };

        const handleSMSSent = (data: any) => {
            const message = data;
            const msgConversationId = smsStorage.getConversationByPhone(message.to)?.id;
            if (!conversationId || msgConversationId === conversationId) {
                res.write(`event: sms-sent\ndata: ${JSON.stringify(data)}\n\n`);
            }
        };

        const handleSMSReceived = (data: any) => {
            const message = data;
            const msgConversationId = smsStorage.getConversationByPhone(message.from)?.id;
            if (!conversationId || msgConversationId === conversationId) {
                res.write(`event: sms-received\ndata: ${JSON.stringify(data)}\n\n`);
            }
        };

        callEventEmitter.on('sms:conversation:updated', handleSMSUpdate);
        callEventEmitter.on('sms:sent', handleSMSSent);
        callEventEmitter.on('sms:received', handleSMSReceived);

        // Send heartbeat
        const heartbeat = setInterval(() => {
            res.write('event: heartbeat\ndata: {}\n\n');
        }, 30000);

        req.on('close', () => {
            clearInterval(heartbeat);
            callEventEmitter.off('sms:conversation:updated', handleSMSUpdate);
            callEventEmitter.off('sms:sent', handleSMSSent);
            callEventEmitter.off('sms:received', handleSMSReceived);
        });
    }

    public start(): void {
        this.app.listen(this.port);
    }
}
