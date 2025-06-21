import { CallState } from '../../types.js';
import { OpenAIContextService } from '../openai/context.service.js';
import { RECORD_CALLS, SHOW_TIMING_MATH } from '../../config/constants.js';
import { TwilioCallService } from './call.service.js';
import { callEventEmitter } from '../sse.service.js';
import { transcriptStorage } from '../transcript-storage.service.js';

/**
 * Service for processing Twilio events
 */
export class TwilioEventService {
    private readonly callState: CallState;
    private readonly twilioCallService: TwilioCallService;
    private readonly contextService: OpenAIContextService | null;
    private readonly onForwardAudioToOpenAI: (payload: string) => void;

    /**
     * Create a new Twilio event processor
     * @param callState The state of the call
     * @param twilioCallService The Twilio call service
     * @param contextService The context service (null for non-OpenAI providers)
     * @param onForwardAudioToOpenAI Callback for forwarding audio to OpenAI
     */
    constructor(
        callState: CallState,
        twilioCallService: TwilioCallService,
        contextService: OpenAIContextService | null,
        onForwardAudioToOpenAI: (payload: string) => void,
    ) {
        this.callState = callState;
        this.twilioCallService = twilioCallService;
        this.contextService = contextService;
        this.onForwardAudioToOpenAI = onForwardAudioToOpenAI;
    }

    /**
     * Process a Twilio message
     * @param message The message data
     */
    public async processMessage(message: Buffer | string): Promise<void> {
        try {
            const data = JSON.parse(message.toString());
            await this.processEvent(data);
        } catch (error) {
            console.error('Error parsing message:', error, 'Message:', message);
        }
    }

    /**
     * Process a Twilio event
     * @param data The event data
     */
    private async processEvent(data: any): Promise<void> {
        switch (data.event) {
        case 'media':
            await this.handleMediaEvent(data);
            break;
        case 'start':
            await this.handleStartEvent(data);
            break;
        case 'mark':
            this.handleMarkEvent();
            break;
        default:
            console.error('Received non-media event:', data.event);
            break;
        }
    }

    /**
     * Handle a Twilio media event
     * @param data The event data
     */
    private async handleMediaEvent(data: any): Promise<void> {
        this.callState.latestMediaTimestamp = data.media.timestamp;
        if (SHOW_TIMING_MATH) {
            // console.log(`Received media message with timestamp: ${this.callState.latestMediaTimestamp}ms`);
        }

        await this.handleFirstMediaEventIfNeeded();
        this.onForwardAudioToOpenAI(data.media.payload);
    }

    /**
     * Handle the first media event if it hasn't been handled yet
     */
    private async handleFirstMediaEventIfNeeded(): Promise<void> {
        if (this.callState.hasSeenMedia) {
            return;
        }

        this.callState.hasSeenMedia = true;

        if (RECORD_CALLS && this.callState.callSid) {
            await this.startCallRecording();
        }
    }

    /**
     * Start recording the call
     */
    private async startCallRecording(): Promise<void> {
        await this.twilioCallService.startRecording(this.callState.callSid);
    }

    /**
     * Handle a Twilio start event
     * @param data The event data
     */
    private async handleStartEvent(data: any): Promise<void> {
        this.callState.streamSid = data.start.streamSid;
        this.callState.responseStartTimestampTwilio = null;
        this.callState.latestMediaTimestamp = 0;
        this.callState.callSid = data.start.callSid;

        // Set call parameters
        const fromNumber = data.start.customParameters.fromNumber;
        const toNumber = data.start.customParameters.toNumber;
        const callContext = data.start.customParameters.callContext || '';

        // For OpenAI, use context service. For others, set directly
        if (this.contextService) {
            this.contextService.initializeCallState(this.callState, fromNumber, toNumber);
            this.contextService.setupConversationContext(this.callState, callContext);
        } else {
            // For non-OpenAI providers (like ElevenLabs), set values directly
            this.callState.fromNumber = fromNumber;
            this.callState.toNumber = toNumber;
            this.callState.callContext = callContext;
        }

        // Check if transcript already exists, otherwise create one
        let transcriptId = transcriptStorage.getTranscriptIdByCallSid(this.callState.callSid);
        if (!transcriptId) {
            transcriptId = transcriptStorage.createTranscript(this.callState);
        }
        this.callState.transcriptId = transcriptId;

        // Emit call started event
        callEventEmitter.emit('call:status', {
            callSid: this.callState.callSid,
            status: 'connected',
            from: fromNumber,
            to: toNumber,
            timestamp: new Date(),
            transcriptId: transcriptId
        });
    }

    /**
     * Handle a Twilio mark event
     */
    private handleMarkEvent(): void {
        if (this.callState.markQueue.length > 0) {
            this.callState.markQueue.shift();
        }
    }
}
