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

    constructor(ws: WebSocket, callType: CallType, twilioClient: twilio.Twilio) {
        this.callState = new CallState(callType);

        // Initialize Twilio services
        this.twilioStream = new TwilioWsService(ws, this.callState);
        this.twilioCallService = new TwilioCallService(twilioClient);

        // Initialize ElevenLabs service
        const elevenLabsConfig: ElevenLabsConfig = {
            apiKey: process.env.ELEVENLABS_API_KEY || '',
            agentId: process.env.ELEVENLABS_AGENT_ID || ''
        };
        this.elevenLabsService = new ElevenLabsWsService(elevenLabsConfig);

        // Initialize event processors
        this.elevenLabsEventProcessor = new ElevenLabsEventService(
            this.callState,
            () => this.endCall(),
            (audioBase64) => this.twilioStream.sendAudioBase64(audioBase64),
            () => this.handleInterruption()
        );

        // Create a simplified Twilio event processor for ElevenLabs
        // We don't need OpenAI context service for ElevenLabs
        this.twilioEventProcessor = new TwilioEventService(
            this.callState,
            this.twilioCallService,
            null, // No context service needed for ElevenLabs
            (audioBase64) => this.elevenLabsService.sendAudio(audioBase64),
        );

        this.setupEventHandlers();
        // Delay ElevenLabs initialization to ensure Twilio connection is ready
        setTimeout(() => this.initializeElevenLabs(), 100);
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

    private initializeElevenLabs(): void {
        this.elevenLabsService.initialize(
            (data) => this.elevenLabsEventProcessor.processMessage(data),
            () => {
                console.log('ElevenLabs WebSocket opened');
                // ElevenLabs doesn't need explicit session initialization
                // The agent configuration is handled by the agent_id
            },
            () => {
                console.log('ElevenLabs WebSocket closed');
                this.twilioStream.close();
            },
            (error) => console.error('Error in the ElevenLabs WebSocket:', error)
        );
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
                    
                    // For ElevenLabs, we need to handle Twilio events differently
                    // since we don't have the complex OpenAI context
                    if (message.event === 'media') {
                        // Forward audio directly to ElevenLabs
                        if (message.media?.payload) {
                            this.elevenLabsService.sendAudio(message.media.payload);
                        }
                    } else if (message.event === 'start') {
                        // Let the regular processor handle start event
                        // It now handles null context service properly
                        await this.twilioEventProcessor.processMessage(rawMessage);
                    } else {
                        // Let the regular processor handle other events
                        await this.twilioEventProcessor.processMessage(rawMessage);
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