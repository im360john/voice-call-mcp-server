import { WebSocket } from 'ws';
import { CallState } from '../../types.js';
import { SHOW_TIMING_MATH } from '../../config/constants.js';

/**
 * Service for handling Twilio WebSocket streams
 */
export class TwilioWsService {
    private readonly webSocket: WebSocket;
    private readonly callState: CallState;

    /**
     * Create a new Twilio stream service
     * @param webSocket The Twilio WebSocket connection
     * @param callState The state of the call
     */
    constructor(webSocket: WebSocket, callState: CallState) {
        this.webSocket = webSocket;
        this.callState = callState;
    }

    /**
     * Close the WebSocket connection
     */
    public close(): void {
        if (this.webSocket.readyState === WebSocket.OPEN) {
            this.webSocket.close();
        }
    }

    /**
     * Send a mark event to Twilio
     */
    public sendMark(): void {
        if (!this.callState.streamSid) {
            return;
        }

        const markEvent = {
            event: 'mark',
            streamSid: this.callState.streamSid,
            mark: { name: 'responsePart' }
        };
        this.webSocket.send(JSON.stringify(markEvent));
        this.callState.markQueue.push('responsePart');
    }

    /**
     * Send audio data to Twilio
     * @param payload The audio payload to send
     */
    public sendAudio(payload: string): void {
        if (!this.callState.streamSid) {
            console.log('[DEBUG] ERROR: Cannot send audio - no streamSid available');
            return;
        }

        const audioDelta = {
            event: 'media',
            streamSid: this.callState.streamSid,
            media: { payload }
        };
        
        console.log('[DEBUG] Sending audio to Twilio:', {
            streamSid: this.callState.streamSid,
            payloadLength: payload.length,
            webSocketState: this.webSocket.readyState === WebSocket.OPEN ? 'OPEN' : 'NOT_OPEN'
        });
        
        this.webSocket.send(JSON.stringify(audioDelta));
    }

    /**
     * Send base64 audio data to Twilio (for ElevenLabs compatibility)
     * @param audioBase64 The base64 encoded audio data
     */
    public sendAudioBase64(audioBase64: string): void {
        console.log('[DEBUG] TwilioWsService.sendAudioBase64 called, length:', audioBase64?.length);
        console.log('[DEBUG] StreamSid available:', !!this.callState.streamSid);
        this.sendAudio(audioBase64);
    }

    /**
     * Clear the Twilio stream
     */
    public clearStream(): void {
        if (!this.callState.streamSid) {
            return;
        }

        this.webSocket.send(JSON.stringify({
            event: 'clear',
            streamSid: this.callState.streamSid
        }));
    }

    /**
     * Send DTMF tones to navigate IVR systems
     * @param digits The DTMF digits to send (0-9, *, #)
     */
    public sendDTMF(digits: string): void {
        if (!this.callState.streamSid) {
            console.error('[DTMF] Cannot send DTMF - no streamSid available');
            return;
        }

        const dtmfEvent = {
            event: 'dtmf',
            streamSid: this.callState.streamSid,
            dtmf: { digits }
        };

        console.log(`[DTMF] Sending DTMF digits "${digits}" for call ${this.callState.callSid}`);
        this.webSocket.send(JSON.stringify(dtmfEvent));
    }

    /**
     * Set up event handlers for the Twilio WebSocket
     * @param onMessage Callback for handling messages from Twilio
     * @param onClose Callback for when the connection is closed
     */
    public setupEventHandlers(
        onMessage: (message: Buffer | string) => void,
        onClose: () => void
    ): void {
        this.webSocket.on('message', onMessage);
        this.webSocket.on('close', onClose);
    }

    /**
     * Process a Twilio start event
     * @param data The start event data
     */
    public processStartEvent(data: any): void {
        this.callState.streamSid = data.start.streamSid;
        this.callState.responseStartTimestampTwilio = null;
        this.callState.latestMediaTimestamp = 0;
        this.callState.callSid = data.start.callSid;
    }

    /**
     * Process a Twilio mark event
     */
    public processMarkEvent(): void {
        if (this.callState.markQueue.length > 0) {
            this.callState.markQueue.shift();
        }
    }

    /**
     * Process a Twilio media event
     * @param data The media event data
     */
    public processMediaEvent(data: any): void {
        this.callState.latestMediaTimestamp = data.media.timestamp;
        if (SHOW_TIMING_MATH) {
            // console.log(`Received media message with timestamp: ${this.callState.latestMediaTimestamp}ms`);
        }
    }
}
