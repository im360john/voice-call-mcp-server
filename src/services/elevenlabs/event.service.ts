import { CallState, ElevenLabsMessage } from '../../types.js';
import { transcriptStorage } from '../transcript-storage.service.js';
import { callEventEmitter } from '../sse.service.js';

export class ElevenLabsEventService {
    private readonly callState: CallState;
    private readonly onCallEnd: () => void;
    private readonly sendAudioToTwilio: (audioBase64: string) => void;
    private readonly handleInterruption: () => void;

    constructor(
        callState: CallState,
        onCallEnd: () => void,
        sendAudioToTwilio: (audioBase64: string) => void,
        handleInterruption: () => void
    ) {
        this.callState = callState;
        this.onCallEnd = onCallEnd;
        this.sendAudioToTwilio = sendAudioToTwilio;
        this.handleInterruption = handleInterruption;
    }

    /**
     * Process incoming ElevenLabs WebSocket messages
     */
    processMessage(message: ElevenLabsMessage): void {
        const { type } = message;

        switch (type) {
            case 'conversation_initiation_metadata':
                this.handleConversationInitiation(message);
                break;
            
            case 'audio':
                this.handleAudio(message);
                break;
            
            case 'interruption':
                this.handleInterruptionEvent();
                break;
            
            case 'user_transcript':
                this.handleUserTranscript(message);
                break;
            
            case 'agent_response':
                this.handleAgentResponse(message);
                break;
            
            case 'internal_tentative_agent_response':
                // Ignore tentative responses
                break;
            
            default:
                console.log(`Unhandled ElevenLabs message type: ${type}`);
        }
    }

    /**
     * Handle conversation initialization
     */
    private handleConversationInitiation(message: ElevenLabsMessage): void {
        console.log('ElevenLabs conversation initiated:', message.conversation_id);
        
        // Store conversation ID if needed
        if (message.conversation_id && this.callState.callSid) {
            // You might want to store this for reference
            console.log(`Call ${this.callState.callSid} linked to ElevenLabs conversation ${message.conversation_id}`);
        }
    }

    /**
     * Handle audio data from ElevenLabs
     */
    private handleAudio(message: ElevenLabsMessage): void {
        let audioBase64: string | null = null;

        // ElevenLabs sends audio in two possible formats
        if (message.audio) {
            // Simple audio format
            if (typeof message.audio === 'string') {
                audioBase64 = message.audio;
            } else if (message.audio.chunk) {
                audioBase64 = message.audio.chunk;
            }
        } else if (message.audio_event?.audio_base_64) {
            // Audio event format
            audioBase64 = message.audio_event.audio_base_64;
        }

        if (audioBase64) {
            // Forward audio to Twilio
            this.sendAudioToTwilio(audioBase64);
        }
    }

    /**
     * Handle interruption event
     */
    private handleInterruptionEvent(): void {
        console.log('ElevenLabs interruption detected');
        this.handleInterruption();
    }

    /**
     * Handle user transcript
     */
    private handleUserTranscript(message: ElevenLabsMessage): void {
        const transcript = message.user_transcript;
        
        if (transcript && this.callState.callSid) {
            console.log(`User: ${transcript}`);
            
            // Store transcript
            transcriptStorage.addMessage(
                this.callState.callSid,
                this.callState.transcriptId,
                'user',
                transcript
            );

            // Emit transcription event
            callEventEmitter.emit('call:transcription', {
                callSid: this.callState.callSid,
                transcriptId: this.callState.transcriptId,
                speaker: 'user',
                transcription: transcript,
                timestamp: new Date()
            });

            // Check for goodbye phrases
            const lowerTranscript = transcript.toLowerCase();
            const goodbyePhrases = ['goodbye', 'bye', 'talk to you later', 'see you', 'take care'];
            
            if (goodbyePhrases.some(phrase => lowerTranscript.includes(phrase))) {
                console.log('Detected goodbye phrase, ending call...');
                setTimeout(() => this.onCallEnd(), 1000);
            }
        }
    }

    /**
     * Handle agent response
     */
    private handleAgentResponse(message: ElevenLabsMessage): void {
        const response = message.agent_response;
        
        if (response && this.callState.callSid) {
            console.log(`Agent: ${response}`);
            
            // Store transcript
            transcriptStorage.addMessage(
                this.callState.callSid,
                this.callState.transcriptId,
                'assistant',
                response
            );

            // Emit transcription event
            callEventEmitter.emit('call:transcription', {
                callSid: this.callState.callSid,
                transcriptId: this.callState.transcriptId,
                speaker: 'assistant',
                transcription: response,
                timestamp: new Date()
            });
        }
    }
}