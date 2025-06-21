import { WebSocket } from 'ws';
import twilio from 'twilio';
import dotenv from 'dotenv';
import { CallState, CallType, ElevenLabsConfig } from '../types.js';
import { ElevenLabsWsService } from '../services/elevenlabs/ws.service.js';
import { TwilioWsService } from '../services/twilio/ws.service.js';
import { ElevenLabsEventService } from '../services/elevenlabs/event.service.js';
import { TwilioEventService } from '../services/twilio/event.service.js';
import { TwilioCallService } from '../services/twilio/call.service.js';
import { transcriptStorage } from '../services/transcript-storage.service.js';
import { callEventEmitter } from '../services/sse.service.js';

dotenv.config();

/**
 * Handles the communication between Twilio and ElevenLabs for voice calls
 */
export class ElevenLabsCallHandler {
    private readonly twilioStream: TwilioWsService;
    private readonly elevenLabsService: ElevenLabsWsService;
    private readonly elevenLabsEventProcessor: ElevenLabsEventService;
    private readonly twilioEventProcessor: TwilioEventService;
    private readonly twilioCallService: TwilioCallService;
    private readonly callState: CallState;
    private streamSid: string | null = null;

    constructor(ws: WebSocket, callType: CallType, twilioClient: twilio.Twilio) {
        console.log('ElevenLabsCallHandler constructor called');
        this.callState = new CallState(callType);

        // Initialize Twilio services
        this.twilioStream = new TwilioWsService(ws, this.callState);
        this.twilioCallService = new TwilioCallService(twilioClient);

        // Initialize ElevenLabs service
        const elevenLabsConfig: ElevenLabsConfig = {
            apiKey: process.env.ELEVENLABS_API_KEY || '',
            agentId: process.env.ELEVENLABS_AGENT_ID || '',
            prompt: process.env.ELEVENLABS_PROMPT,
            firstMessage: process.env.ELEVENLABS_FIRST_MESSAGE
        };
        console.log('ElevenLabs config:', { 
            hasApiKey: !!elevenLabsConfig.apiKey, 
            agentId: elevenLabsConfig.agentId,
            hasPrompt: !!elevenLabsConfig.prompt,
            hasFirstMessage: !!elevenLabsConfig.firstMessage
        });
        this.elevenLabsService = new ElevenLabsWsService(elevenLabsConfig);

        // Initialize event processors
        this.elevenLabsEventProcessor = new ElevenLabsEventService(
            this.callState,
            () => this.endCall(),
            (audioBase64) => {
                console.log('[DEBUG] Sending audio from ElevenLabs to Twilio, length:', audioBase64?.length);
                console.log('[DEBUG] StreamSid for audio send:', this.callState.streamSid);
                if (this.callState.streamSid) {
                    this.twilioStream.sendAudioBase64(audioBase64);
                } else {
                    console.log('[DEBUG] WARNING: No streamSid available, cannot send audio to Twilio');
                }
            },
            () => this.handleInterruption()
        );

        // Create a simplified Twilio event processor for ElevenLabs
        // We don't need OpenAI context service for ElevenLabs
        this.twilioEventProcessor = new TwilioEventService(
            this.callState,
            this.twilioCallService,
            null, // No context service needed for ElevenLabs
            (audioBase64) => {
                // Send audio directly if connected, like the working example
                console.log('[DEBUG] Received audio from Twilio, length:', audioBase64?.length);
                console.log('[DEBUG] StreamSid:', this.callState.streamSid);
                console.log('[DEBUG] ElevenLabs connected:', this.elevenLabsService.isConnected());
                
                if (this.elevenLabsService.isConnected() && this.callState.streamSid) {
                    this.elevenLabsService.sendAudio(audioBase64);
                } else {
                    console.log('[DEBUG] Cannot send audio - ElevenLabs connected:', this.elevenLabsService.isConnected(), 'StreamSid:', this.callState.streamSid);
                }
            },
        );

        this.setupEventHandlers();
        // Initialize ElevenLabs immediately like the working example
        console.log('[DEBUG] Starting ElevenLabs initialization...');
        this.initializeElevenLabs().catch(error => {
            console.error('Error during ElevenLabs initialization:', error);
        });
    }

    private endCall(): void {
        if (this.callState.callSid) {
            // Finalize the transcript
            transcriptStorage.finalizeTranscript(this.callState.callSid);
            
            // Emit call ended event with transcript ID
            callEventEmitter.emit('call:ended', {
                callSid: this.callState.callSid,
                duration: 0, // Duration would need to be tracked separately
                timestamp: new Date(),
                transcriptId: this.callState.transcriptId
            });
            
            this.twilioCallService.endCall(this.callState.callSid);
        }

        setTimeout(() => {
            this.closeWebSockets();
        }, 5000);
    }

    private closeWebSockets(): void {
        this.twilioStream.close();
        this.elevenLabsService.close();
    }

    private async initializeElevenLabs(): Promise<void> {
        console.log('Initializing ElevenLabs WebSocket connection...');
        try {
            await this.elevenLabsService.initialize(
                (data) => this.elevenLabsEventProcessor.processMessage(data),
                () => {
                    console.log('[DEBUG] ElevenLabs WebSocket opened and ready');
                    console.log('[DEBUG] Current streamSid:', this.callState.streamSid);
                    console.log('[DEBUG] Current callSid:', this.callState.callSid);
                },
                () => {
                    console.log('ElevenLabs WebSocket closed');
                    this.twilioStream.close();
                },
                (error) => console.error('Error in the ElevenLabs WebSocket:', error)
            );
        } catch (error) {
            console.error('Failed to initialize ElevenLabs:', error);
        }
    }

    private handleInterruption(): void {
        console.log('Handling interruption from ElevenLabs');
        this.twilioStream.clearStream();
    }

    private setupEventHandlers(): void {
        this.twilioStream.setupEventHandlers(
            async (rawMessage) => {
                try {
                    // Parse the message if it's a Buffer or string
                    const message = typeof rawMessage === 'string' || Buffer.isBuffer(rawMessage) 
                        ? JSON.parse(rawMessage.toString()) 
                        : rawMessage;
                    
                    // Process all Twilio events through the event processor
                    await this.twilioEventProcessor.processMessage(rawMessage);
                    
                    // Store streamSid when we get the start event
                    if (message.event === 'start' && message.start?.streamSid) {
                        this.streamSid = message.start.streamSid;
                        this.callState.streamSid = this.streamSid;
                        console.log('[DEBUG] Twilio stream started - StreamSid:', this.streamSid);
                        console.log('[DEBUG] CallSid:', message.start.callSid);
                    }
                } catch (error) {
                    console.error('Error handling Twilio message in ElevenLabs handler:', error);
                }
            },
            async () => {
                this.elevenLabsService.close();
            }
        );
    }
}

/**
 * Extension to CallSessionManager to support ElevenLabs
 */
export class ElevenLabsSessionManager {
    private readonly twilioClient: twilio.Twilio;

    constructor(twilioClient: twilio.Twilio) {
        this.twilioClient = twilioClient;
    }

    /**
     * Creates a new ElevenLabs call session
     * @param ws The WebSocket connection
     * @param callType The type of call
     */
    public createSession(ws: WebSocket, callType: CallType): void {
        new ElevenLabsCallHandler(ws, callType, this.twilioClient);
    }
}