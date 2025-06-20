import { Request, Response } from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { VoiceCallMcpServer } from './mcp.server.js';
import { TwilioCallService } from '../services/twilio/call.service.js';

// Store active SSE transports
const activeTransports = new Map<string, SSEServerTransport>();

export class McpSSEServer {
    private mcpServer: VoiceCallMcpServer;

    constructor(twilioCallService: TwilioCallService, twilioCallbackUrl: string) {
        this.mcpServer = new VoiceCallMcpServer(twilioCallService, twilioCallbackUrl);
    }

    /**
     * Handle SSE connection (GET /mcp)
     */
    public async handleSSE(req: Request, res: Response): Promise<void> {
        console.log('[MCP SSE] New SSE connection request');
        
        try {
            // Create SSE transport with the messages endpoint
            const transport = new SSEServerTransport('/mcp/messages', res);
            
            // Store transport by session ID
            activeTransports.set(transport.sessionId, transport);
            console.log(`[MCP SSE] Created transport with session ID: ${transport.sessionId}`);
            
            // Connect the MCP server to this transport
            await this.mcpServer.connectTransport(transport);
            
            // Start the SSE connection
            await transport.start();
            
            // Clean up on close
            transport.onclose = () => {
                console.log(`[MCP SSE] Transport closed: ${transport.sessionId}`);
                activeTransports.delete(transport.sessionId);
            };
            
        } catch (error) {
            console.error('[MCP SSE] Error handling SSE:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Failed to establish SSE connection' });
            }
        }
    }

    /**
     * Handle POST messages (POST /mcp/messages)
     */
    public async handleMessage(req: Request, res: Response): Promise<void> {
        console.log('[MCP SSE] Received POST message');
        
        try {
            // Extract session ID from the request
            const sessionId = req.query.sessionId as string || req.headers['x-session-id'] as string;
            
            if (!sessionId) {
                console.error('[MCP SSE] No session ID provided');
                res.status(400).json({ error: 'Session ID required' });
                return;
            }
            
            // Find the transport for this session
            const transport = activeTransports.get(sessionId);
            if (!transport) {
                console.error(`[MCP SSE] No transport found for session: ${sessionId}`);
                res.status(404).json({ error: 'Session not found' });
                return;
            }
            
            // Let the transport handle the message
            await transport.handlePostMessage(req, res, req.body);
            
        } catch (error) {
            console.error('[MCP SSE] Error handling message:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Failed to process message' });
            }
        }
    }
}