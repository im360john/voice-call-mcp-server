import { WebSocket } from 'ws';
import { CallState } from '../../types.js';
import { LOG_EVENT_TYPES, SHOW_TIMING_MATH } from '../../config/constants.js';
import { checkForGoodbye } from '../../utils/call-utils.js';
import { callEventEmitter } from '../sse.service.js';
import { transcriptStorage } from '../transcript-storage.service.js';
import { IVRNavigationService } from '../ivr-navigation.service.js';
import { TwilioWsService } from '../twilio/ws.service.js';

/**
 * Service for processing OpenAI events
 */
export class OpenAIEventService {
    private readonly callState: CallState;
    private readonly onEndCall: () => void;
    private readonly onSendAudioToTwilio: (payload: string) => void;
    private readonly onTruncateResponse: () => void;
    private ivrNavigationService?: IVRNavigationService;
    private twilioWsService?: TwilioWsService;

    /**
     * Create a new OpenAI event processor
     * @param callState The state of the call
     * @param onEndCall Callback for ending the call
     * @param onSendAudioToTwilio Callback for sending audio to Twilio
     * @param onTruncateResponse Callback for truncating the response
     */
    constructor(
        callState: CallState,
        onEndCall: () => void,
        onSendAudioToTwilio: (payload: string) => void,
        onTruncateResponse: () => void
    ) {
        this.callState = callState;
        this.onEndCall = onEndCall;
        this.onSendAudioToTwilio = onSendAudioToTwilio;
        this.onTruncateResponse = onTruncateResponse;
    }

    /**
     * Set the IVR navigation service
     */
    public setIVRNavigationService(service: IVRNavigationService): void {
        this.ivrNavigationService = service;
    }

    /**
     * Set the Twilio WebSocket service for DTMF
     */
    public setTwilioWsService(service: TwilioWsService): void {
        this.twilioWsService = service;
    }

    /**
     * Process an OpenAI message
     * @param data The message data
     */
    public processMessage(data: WebSocket.Data): void {
        try {
            const response = JSON.parse(data.toString());

            if (LOG_EVENT_TYPES.includes(response.type)) {
                // console.log(`Received event: ${response.type}`, response);
            }

            this.processEvent(response);
        } catch (error) {
            console.error('Error processing OpenAI message:', error, 'Raw message:', data);
        }
    }

    /**
     * Process an OpenAI event
     * @param response The event data
     */
    private processEvent(response: any): void {
        switch (response.type) {
        case 'conversation.item.input_audio_transcription.completed':
            this.handleTranscriptionCompleted(response.transcript);
            break;
        case 'response.audio_transcript.done':
            this.handleAudioTranscriptDone(response.transcript);
            break;
        case 'response.audio.delta':
            if (response.delta) {
                this.handleAudioDelta(response);
            }
            break;
        case 'input_audio_buffer.speech_started':
            this.onTruncateResponse();
            break;
        }
    }

    /**
     * Handle a transcription completed event
     * @param transcription The transcription text
     */
    private handleTranscriptionCompleted(transcription: string): void {
        if (!transcription) {
            return;
        }

        console.log(`[Transcript] Human: ${transcription}`);

        this.callState.conversationHistory.push({
            role: 'user',
            content: transcription
        });

        // Store transcription in storage service
        transcriptStorage.addEntry(this.callState.callSid, 'user', transcription);

        // Emit transcription event for human speech
        callEventEmitter.emit('call:transcription', {
            callSid: this.callState.callSid,
            transcription: transcription,
            speaker: 'human',
            timestamp: new Date()
        });

        if (checkForGoodbye(transcription)) {
            this.onEndCall();
        }
    }

    /**
     * Handle an audio transcript done event
     * @param transcript The transcript text
     */
    private handleAudioTranscriptDone(transcript: string): void {
        if (!transcript) {
            return;
        }

        console.log(`[Transcript] AI: ${transcript}`);

        this.callState.conversationHistory.push({
            role: 'assistant',
            content: transcript
        });

        // Store transcription in storage service
        transcriptStorage.addEntry(this.callState.callSid, 'assistant', transcript);

        // Check for IVR navigation if service is available
        if (this.ivrNavigationService && this.twilioWsService) {
            const ivrRule = this.ivrNavigationService.processTranscript(this.callState, transcript);
            
            if (ivrRule) {
                console.log(`[IVR] Detected menu option: "${transcript}" -> Action: ${ivrRule.action}`);
                
                // If AI says it will press a key, schedule DTMF after a delay
                if (transcript.toLowerCase().includes('connect') || 
                    transcript.toLowerCase().includes('press') ||
                    transcript.toLowerCase().includes('transfer')) {
                    
                    setTimeout(() => {
                        this.twilioWsService!.sendDTMF(ivrRule.action);
                    }, ivrRule.delay || 1000);
                }
            }
        }

        // Emit transcription event for AI speech
        callEventEmitter.emit('call:transcription', {
            callSid: this.callState.callSid,
            transcription: transcript,
            speaker: 'ai',
            timestamp: new Date()
        });
    }

    /**
     * Handle an audio delta event
     * @param response The event data
     */
    private handleAudioDelta(response: any): void {
        this.onSendAudioToTwilio(response.delta);

        if (!this.callState.responseStartTimestampTwilio) {
            this.callState.responseStartTimestampTwilio = this.callState.latestMediaTimestamp;
            if (SHOW_TIMING_MATH) {
                // console.log(`Setting start timestamp for new response: ${this.callState.responseStartTimestampTwilio}ms`);
            }
        }

        if (response.item_id) {
            this.callState.lastAssistantItemId = response.item_id;
        }
    }
}
