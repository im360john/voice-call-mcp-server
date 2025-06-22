import WebSocket from 'ws';
import { CallState, AIProvider } from '../types.js';
import { callEventEmitter } from './sse.service.js';
import { OpenAIService } from './openai/openai.service.js';
import { ElevenLabsService } from './elevenlabs/elevenlabs.service.js';
import { TwilioCallService } from './twilio/call.service.js';

/**
 * Service for managing provider switches during active calls
 */
export class ProviderSwitchService {
    private activeConnections = new Map<string, {
        openaiWs?: WebSocket;
        elevenLabsWs?: WebSocket;
        openaiService?: OpenAIService;
        elevenLabsService?: ElevenLabsService;
    }>();

    constructor(
        private twilioCallService: TwilioCallService
    ) {}

    /**
     * Register a connection for a call
     */
    registerConnection(
        callSid: string,
        provider: AIProvider,
        ws: WebSocket,
        service: OpenAIService | ElevenLabsService
    ): void {
        const existing = this.activeConnections.get(callSid) || {};
        
        if (provider === AIProvider.OPENAI) {
            existing.openaiWs = ws;
            existing.openaiService = service as OpenAIService;
        } else {
            existing.elevenLabsWs = ws;
            existing.elevenLabsService = service as ElevenLabsService;
        }
        
        this.activeConnections.set(callSid, existing);
    }

    /**
     * Switch from OpenAI to ElevenLabs during an active call
     */
    async switchToElevenLabs(
        callState: CallState,
        twilioWs: WebSocket
    ): Promise<boolean> {
        try {
            const connections = this.activeConnections.get(callState.callSid);
            if (!connections) {
                console.error('No active connections found for call:', callState.callSid);
                return false;
            }

            // Update call state
            callState.ivrState.currentProvider = AIProvider.ELEVENLABS;
            callState.ivrState.humanDetected = true;
            callState.ivrState.isNavigating = false;

            // Emit provider switch event
            callEventEmitter.emit('providerSwitch', {
                callSid: callState.callSid,
                fromProvider: AIProvider.OPENAI,
                toProvider: AIProvider.ELEVENLABS,
                reason: 'human_detected',
                timestamp: new Date().toISOString()
            });

            // Prepare conversation context for handoff
            const conversationSummary = this.summarizeIVRNavigation(callState);
            
            // Close OpenAI connection gracefully
            if (connections.openaiWs && connections.openaiWs.readyState === WebSocket.OPEN) {
                // Send final message to OpenAI
                connections.openaiWs.send(JSON.stringify({
                    type: 'conversation.item.create',
                    item: {
                        type: 'message',
                        role: 'system',
                        content: [{
                            type: 'text',
                            text: 'Human detected. Transferring call to specialized agent. Please end the conversation gracefully.'
                        }]
                    }
                }));

                // Wait briefly for OpenAI to process
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // Close the connection
                connections.openaiWs.close();
            }

            // Initialize ElevenLabs connection if not already connected
            if (!connections.elevenLabsWs || connections.elevenLabsWs.readyState !== WebSocket.OPEN) {
                // Create new ElevenLabs service instance
                const elevenLabsService = new ElevenLabsService(
                    callState,
                    this.twilioCallService,
                    twilioWs
                );

                // Start ElevenLabs connection
                await elevenLabsService.start();
                
                // Register the new connection
                this.registerConnection(
                    callState.callSid,
                    AIProvider.ELEVENLABS,
                    elevenLabsService.getWebSocket()!,
                    elevenLabsService
                );
            }

            // Send conversation context to ElevenLabs
            if (connections.elevenLabsWs && connections.elevenLabsWs.readyState === WebSocket.OPEN) {
                connections.elevenLabsWs.send(JSON.stringify({
                    type: 'conversation_context',
                    context: conversationSummary
                }));
            }

            console.log(`Successfully switched from OpenAI to ElevenLabs for call ${callState.callSid}`);
            return true;

        } catch (error) {
            console.error('Error switching providers:', error);
            callEventEmitter.emit('error', {
                callSid: callState.callSid,
                error: 'Provider switch failed',
                details: error
            });
            return false;
        }
    }

    /**
     * Summarize IVR navigation for context transfer
     */
    private summarizeIVRNavigation(callState: CallState): string {
        const { ivrState, conversationHistory } = callState;
        
        let summary = 'Call transferred after IVR navigation. ';
        
        if (ivrState.optionsHeard.length > 0) {
            summary += `Menu options navigated: ${ivrState.optionsHeard.join(' -> ')}. `;
        }
        
        if (ivrState.actionsToken.length > 0) {
            summary += `Actions taken: pressed ${ivrState.actionsToken.join(', ')}. `;
        }

        // Add any relevant context from the conversation
        const lastUserMessage = conversationHistory
            .filter(msg => msg.role === 'user')
            .slice(-1)[0];
            
        if (lastUserMessage) {
            summary += `Caller context: ${lastUserMessage.content}`;
        }

        return summary;
    }

    /**
     * Clean up connections for a call
     */
    cleanup(callSid: string): void {
        const connections = this.activeConnections.get(callSid);
        if (connections) {
            if (connections.openaiWs && connections.openaiWs.readyState === WebSocket.OPEN) {
                connections.openaiWs.close();
            }
            if (connections.elevenLabsWs && connections.elevenLabsWs.readyState === WebSocket.OPEN) {
                connections.elevenLabsWs.close();
            }
            this.activeConnections.delete(callSid);
        }
    }

    /**
     * Check if a provider switch is needed based on AMD status
     */
    shouldSwitchProvider(callState: CallState): boolean {
        const { ivrState } = callState;
        
        // Already on the target provider
        if (ivrState.currentProvider === ivrState.originalProvider && ivrState.humanDetected) {
            return false;
        }

        // Need to switch to OpenAI for IVR navigation
        if (!ivrState.humanDetected && ivrState.currentProvider !== AIProvider.OPENAI) {
            return true;
        }

        // Need to switch to original provider after human detection
        if (ivrState.humanDetected && ivrState.currentProvider !== ivrState.originalProvider) {
            return true;
        }

        return false;
    }

    /**
     * Get the active WebSocket for a call and provider
     */
    getActiveWebSocket(callSid: string, provider: AIProvider): WebSocket | undefined {
        const connections = this.activeConnections.get(callSid);
        if (!connections) return undefined;

        return provider === AIProvider.OPENAI 
            ? connections.openaiWs 
            : connections.elevenLabsWs;
    }
}