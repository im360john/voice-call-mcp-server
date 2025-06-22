import { WebSocket } from 'ws';
import twilio from 'twilio';
import { CallType, AIProvider, CallState } from '../types.js';
import { OpenAIContextService } from './openai/context.service.js';
import { OpenAICallHandler } from '../handlers/openai.handler.js';
import { SimpleElevenLabsHandler } from '../handlers/elevenlabs-simple.handler.js';
import { ProviderSwitchService } from './provider-switch.service.js';
import { TwilioCallService } from './twilio/call.service.js';

/**
 * Manages multiple concurrent call sessions
 */
export class SessionManagerService {
    private readonly activeSessions: Map<string, OpenAICallHandler | SimpleElevenLabsHandler>;
    private readonly callStates: Map<string, CallState>;
    private readonly twilioClient: twilio.Twilio;
    private readonly contextService: OpenAIContextService;
    private readonly providerSwitchService: ProviderSwitchService;

    /**
     * Create a new session manager
     * @param twilioConfig Configuration for the Twilio client
     */
    constructor(twilioClient: twilio.Twilio) {
        this.activeSessions = new Map();
        this.callStates = new Map();
        this.twilioClient = twilioClient;
        this.contextService = new OpenAIContextService();
        this.providerSwitchService = new ProviderSwitchService(new TwilioCallService(twilioClient));
    }

    /**
     * Creates a new call session and adds it to the active sessions
     * @param ws The WebSocket connection
     * @param callType The type of call
     * @param provider The AI provider to use (optional, defaults to OpenAI)
     */
    public createSession(ws: WebSocket, callType: CallType, provider: AIProvider = AIProvider.OPENAI): void {
        let handler: OpenAICallHandler | SimpleElevenLabsHandler;
        
        // Check if we need to use OpenAI for IVR navigation even if ElevenLabs was requested
        const shouldUseOpenAIForIVR = provider === AIProvider.ELEVENLABS && this.shouldStartWithOpenAI(ws);
        const actualProvider = shouldUseOpenAIForIVR ? AIProvider.OPENAI : provider;
        
        if (actualProvider === AIProvider.OPENAI) {
            handler = new OpenAICallHandler(ws, callType, this.twilioClient, this.contextService, this.providerSwitchService);
        } else {
            handler = new SimpleElevenLabsHandler(ws, callType, this.twilioClient);
        }
        
        this.registerSessionCleanup(ws);
        this.addSession(ws, handler);
        
        // Store call state for later retrieval
        if ('callState' in handler) {
            const callState = (handler as any).callState;
            if (callState && callState.callSid) {
                this.callStates.set(callState.callSid, callState);
            }
        }
    }
    
    /**
     * Check if we should start with OpenAI for IVR navigation
     */
    private shouldStartWithOpenAI(ws: WebSocket): boolean {
        // This would be determined by AMD status or configuration
        // For now, we'll check if AMD detected a machine
        return false; // Will be updated based on AMD webhook
    }

    /**
     * Register cleanup for a session
     * @param ws The WebSocket connection
     */
    private registerSessionCleanup(ws: WebSocket): void {
        ws.on('close', () => {
            this.removeSession(ws);
        });
    }

    /**
     * Add a session to active sessions
     * @param ws The WebSocket connection
     * @param handler The OpenAI call handler
     */
    private addSession(ws: WebSocket, handler: OpenAICallHandler): void {
        this.activeSessions.set(this.getSessionKey(ws), handler);
    }

    /**
     * Removes a session from active sessions
     * @param ws The WebSocket connection
     */
    private removeSession(ws: WebSocket): void {
        const sessionKey = this.getSessionKey(ws);
        if (this.activeSessions.has(sessionKey)) {
            this.activeSessions.delete(sessionKey);
        }
    }

    /**
     * Generates a unique key for a session based on the WebSocket object
     * @param ws The WebSocket connection
     * @returns A unique key for the session
     */
    private getSessionKey(ws: WebSocket): string {
        return ws.url || ws.toString();
    }

    /**
     * Get the Twilio client
     * @returns The Twilio client
     */
    public getTwilioClient(): twilio.Twilio {
        return this.twilioClient;
    }

    /**
     * Get the context service
     * @returns The context service
     */
    public getContextService(): OpenAIContextService {
        return this.contextService;
    }
    
    /**
     * Get call state by call SID
     * @param callSid The call SID
     * @returns The call state if found
     */
    public getCallState(callSid: string): CallState | undefined {
        return this.callStates.get(callSid);
    }
    
    /**
     * Get the provider switch service
     * @returns The provider switch service
     */
    public getProviderSwitchService(): ProviderSwitchService {
        return this.providerSwitchService;
    }
}
