import twilio from 'twilio';
import { DYNAMIC_API_SECRET, RECORD_CALLS } from '../../config/constants.js';
import { callEventEmitter } from '../sse.service.js';
import { transcriptStorage } from '../transcript-storage.service.js';
import { CallState, AIProvider } from '../../types.js';

/**
 * Service for handling Twilio call operations
 */
export class TwilioCallService {
    private readonly twilioClient: twilio.Twilio;

    /**
     * Create a new Twilio call service
     * @param twilioClient The Twilio client
     */
    constructor(twilioClient: twilio.Twilio) {
        this.twilioClient = twilioClient;
    }

    /**
     * Start recording a call
     * @param callSid The SID of the call to record
     */
    public async startRecording(callSid: string): Promise<void> {
        if (!RECORD_CALLS || !callSid) {
            return;
        }

        try {
            await this.twilioClient.calls(callSid)
                .recordings
                .create();
        } catch (error) {
            console.error(`Failed to start recording for call ${callSid}:`, error);
        }
    }

    /**
     * End a call
     * @param callSid The SID of the call to end
     */
    public async endCall(callSid: string): Promise<void> {
        if (!callSid) {
            return;
        }

        try {
            await this.twilioClient.calls(callSid)
                .update({ status: 'completed' });
            
            // Emit call ended event
            callEventEmitter.emit('call:ended', {
                callSid,
                duration: 0, // Duration would need to be tracked separately
                timestamp: new Date()
            });
        } catch (error) {
            console.error(`Failed to end call ${callSid}:`, error);
            
            // Emit error event
            callEventEmitter.emit('call:error', {
                callSid,
                error: error.message || 'Failed to end call',
                code: 'CALL_END_ERROR',
                timestamp: new Date()
            });
        }
    }


    public async makeCall(twilioCallbackUrl: string, toNumber: string, callContext = '', provider: AIProvider = AIProvider.OPENAI): Promise<string> {
        try {
            const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

            const callContextEncoded =  encodeURIComponent(callContext);
            
            // Determine the endpoint based on provider
            const endpoint = provider === AIProvider.ELEVENLABS ? '/call/outgoing/elevenlabs' : '/call/outgoing';

            const call = await twilioClient.calls.create({
                to: toNumber,
                from: process.env.TWILIO_NUMBER || '',
                url: `${twilioCallbackUrl}${endpoint}?apiSecret=${DYNAMIC_API_SECRET}&callType=outgoing&callContext=${callContextEncoded}`,
            });

            // Pre-create transcript for this call
            const callState = new CallState();
            callState.callSid = call.sid;
            callState.fromNumber = process.env.TWILIO_NUMBER || '';
            callState.toNumber = toNumber;
            callState.callContext = callContext;
            
            const transcriptId = transcriptStorage.createTranscript(callState);

            // Emit call initiated event with transcript ID
            callEventEmitter.emit('call:status', {
                callSid: call.sid,
                status: 'initiated',
                from: process.env.TWILIO_NUMBER || '',
                to: toNumber,
                timestamp: new Date(),
                transcriptId: transcriptId
            });

            return call.sid;
        } catch (error) {
            console.error(`Error making call: ${error}`);
            
            // Emit error event
            callEventEmitter.emit('call:error', {
                callSid: '',
                error: error.message || 'Failed to initiate call',
                code: 'CALL_INIT_ERROR',
                timestamp: new Date()
            });
            
            throw error;
        }
    }
}
