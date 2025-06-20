import dotenv from 'dotenv';
import express, { Response } from 'express';
import VoiceResponse from 'twilio/lib/twiml/VoiceResponse.js';
import ExpressWs from 'express-ws';
import { WebSocket } from 'ws';
import cors from 'cors';
import { CallType } from '../types.js';
import { DYNAMIC_API_SECRET } from '../config/constants.js';
import { CallSessionManager } from '../handlers/openai.handler.js';
import { handleSSE } from '../services/sse.service.js';
import { VoiceCallMcpServer } from './mcp.server.js';
import { TwilioCallService } from '../services/twilio/call.service.js';
import { McpHttpServer } from './mcp-http.server.js';
dotenv.config();

export class VoiceServer {
    private app: express.Application & { ws: any };
    private port: number;
    private sessionManager: CallSessionManager;
    private callbackUrl: string;
    private twilioCallService?: TwilioCallService;

    constructor(callbackUrl: string, sessionManager: CallSessionManager, twilioCallService?: TwilioCallService) {
        this.callbackUrl = callbackUrl;
        this.port = parseInt(process.env.PORT || '3004');
        this.app = ExpressWs(express()).app;
        this.sessionManager = sessionManager;
        this.twilioCallService = twilioCallService;
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
        this.app.post('/call/outgoing', this.handleOutgoingCall.bind(this));
        this.app.ws('/call/connection-outgoing/:secret', this.handleOutgoingConnection.bind(this));
        this.app.get('/events', handleSSE);

        // Add MCP HTTP endpoints if twilioCallService is provided
        if (this.twilioCallService) {
            const mcpHttpServer = new McpHttpServer(this.twilioCallService, this.callbackUrl);
            mcpHttpServer.setupRoutes(this.app);
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

    public start(): void {
        this.app.listen(this.port);
    }
}
