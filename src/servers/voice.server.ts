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
import { BatchOperationService } from '../services/batch-operation.service.js';
import { transcriptStorage } from '../services/transcript-storage.service.js';
import { BatchCallRequest, BatchSMSRequest } from '../types/batch.types.js';
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

        // Batch operation routes
        if (this.twilioCallService) {
            this.app.post('/batch/calls', this.handleBatchCalls.bind(this));
            this.app.get('/batch/calls/:batchId', this.handleGetBatchStatus.bind(this));
            this.app.get('/batch/calls/:batchId/transcripts', this.handleGetBatchTranscripts.bind(this));
            this.app.get('/batch/calls/:batchId/events', this.handleBatchSSE.bind(this));
        }

        if (this.twilioSMSService) {
            this.app.post('/batch/sms', this.handleBatchSMS.bind(this));
            this.app.get('/batch/sms/:batchId', this.handleGetBatchStatus.bind(this));
            this.app.get('/batch/sms/:batchId/conversations', this.handleGetBatchConversations.bind(this));
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
        const batchId = req.query.batchId?.toString();
        const customPrompt = req.query.customPrompt?.toString();
        const customContext = req.query.customContext?.toString();

        const twiml = new VoiceResponse();
        const connect = twiml.connect();

        const stream = connect.stream({
            url: `${this.callbackUrl.replace('https://', 'wss://')}/call/connection-outgoing/${apiSecret}`,
        });

        stream.parameter({ name: 'fromNumber', value: fromNumber });
        stream.parameter({ name: 'toNumber', value: toNumber });
        stream.parameter({ name: 'callContext', value: callContext });
        if (batchId) stream.parameter({ name: 'batchId', value: batchId });
        if (customPrompt) stream.parameter({ name: 'customPrompt', value: customPrompt });
        if (customContext) stream.parameter({ name: 'customContext', value: customContext });

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
        
        const batchId = req.query.batchId?.toString();
        const customPrompt = req.query.customPrompt?.toString();
        const customContext = req.query.customContext?.toString();

        const twiml = new VoiceResponse();
        const connect = twiml.connect();

        const stream = connect.stream({
            url: `${this.callbackUrl.replace('https://', 'wss://')}/call/connection-elevenlabs/${apiSecret}`,
        });

        stream.parameter({ name: 'fromNumber', value: fromNumber });
        stream.parameter({ name: 'toNumber', value: toNumber });
        stream.parameter({ name: 'callContext', value: callContext });
        if (batchId) stream.parameter({ name: 'batchId', value: batchId });
        if (customPrompt) stream.parameter({ name: 'customPrompt', value: customPrompt });
        if (customContext) stream.parameter({ name: 'customContext', value: customContext });

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

    // Batch operation handlers
    private async handleBatchCalls(req: Request, res: Response): Promise<void> {
        try {
            if (!this.twilioCallService) {
                res.status(500).json({ error: 'Call service not configured' });
                return;
            }

            const request: BatchCallRequest = req.body;
            
            // Validate request
            if (!request.targets || request.targets.length === 0) {
                res.status(400).json({ error: 'No targets provided' });
                return;
            }

            if (!request.provider) {
                res.status(400).json({ error: 'Provider is required' });
                return;
            }

            const batchId = await this.twilioCallService.makeBatchCalls(this.callbackUrl, request);
            
            res.json({
                success: true,
                batchId,
                totalTargets: request.targets.length
            });
        } catch (error) {
            console.error('Error initiating batch calls:', error);
            res.status(500).json({ error: 'Failed to initiate batch calls' });
        }
    }

    private async handleBatchSMS(req: Request, res: Response): Promise<void> {
        try {
            if (!this.twilioSMSService) {
                res.status(500).json({ error: 'SMS service not configured' });
                return;
            }

            const request: BatchSMSRequest = req.body;
            
            // Validate request
            if (!request.targets || request.targets.length === 0) {
                res.status(400).json({ error: 'No targets provided' });
                return;
            }

            const batchId = await this.twilioSMSService.sendBatchSMS(request);
            
            res.json({
                success: true,
                batchId,
                totalTargets: request.targets.length
            });
        } catch (error) {
            console.error('Error sending batch SMS:', error);
            res.status(500).json({ error: 'Failed to send batch SMS' });
        }
    }

    private handleGetBatchStatus(req: Request, res: Response): void {
        const { batchId } = req.params;
        const batchService = BatchOperationService.getInstance();
        
        const operation = batchService.getBatchOperation(batchId);
        if (!operation) {
            res.status(404).json({ error: 'Batch operation not found' });
            return;
        }

        res.json({
            batchId: operation.batchId,
            type: operation.type,
            status: operation.status,
            totalTargets: operation.totalTargets,
            completedTargets: operation.completedTargets,
            failedTargets: operation.failedTargets,
            createdAt: operation.createdAt,
            updatedAt: operation.updatedAt,
            results: operation.results
        });
    }

    private handleGetBatchTranscripts(req: Request, res: Response): void {
        const { batchId } = req.params;
        
        const transcripts = transcriptStorage.getTranscriptsByBatchId(batchId);
        const summary = transcriptStorage.getBatchTranscriptSummary(batchId);
        
        res.json({
            batchId,
            summary,
            transcripts: transcripts.map(t => ({
                transcriptId: t.transcriptId,
                callSid: t.callSid,
                from: t.from,
                to: t.to,
                startTime: t.startTime,
                endTime: t.endTime,
                duration: t.duration,
                entryCount: t.entries.length,
                entries: t.entries
            }))
        });
    }

    private handleGetBatchConversations(req: Request, res: Response): void {
        const { batchId } = req.params;
        const batchService = BatchOperationService.getInstance();
        
        const operation = batchService.getBatchOperation(batchId);
        if (!operation || operation.type !== 'sms') {
            res.status(404).json({ error: 'Batch SMS operation not found' });
            return;
        }

        // Get all conversations for the batch
        const conversations = operation.results
            .filter(r => r.conversationId)
            .map(r => {
                const conversation = smsStorage.getConversation(r.conversationId!);
                return conversation;
            })
            .filter(c => c !== undefined);

        res.json({
            batchId,
            totalConversations: conversations.length,
            conversations
        });
    }

    private handleBatchSSE(req: Request, res: Response): void {
        const { batchId } = req.params;

        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': process.env.SSE_CORS_ORIGIN || '*',
            'Access-Control-Allow-Credentials': 'true',
        });

        const batchService = BatchOperationService.getInstance();

        const handleBatchUpdate = (data: any) => {
            if (data.batchId === batchId) {
                res.write(`event: batch-update\ndata: ${JSON.stringify(data)}\n\n`);
            }
        };

        batchService.on(`batch:${batchId}:update`, handleBatchUpdate);

        // Send initial status
        const operation = batchService.getBatchOperation(batchId);
        if (operation) {
            res.write(`event: batch-status\ndata: ${JSON.stringify({
                batchId,
                status: operation.status,
                progress: operation.completedTargets + operation.failedTargets,
                total: operation.totalTargets
            })}\n\n`);
        }

        // Send heartbeat
        const heartbeat = setInterval(() => {
            res.write('event: heartbeat\ndata: {}\n\n');
        }, 30000);

        req.on('close', () => {
            clearInterval(heartbeat);
            batchService.off(`batch:${batchId}:update`, handleBatchUpdate);
        });
    }
}
