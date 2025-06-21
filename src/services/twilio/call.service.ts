import twilio from 'twilio';
import { DYNAMIC_API_SECRET, RECORD_CALLS } from '../../config/constants.js';
import { callEventEmitter } from '../sse.service.js';
import { transcriptStorage } from '../transcript-storage.service.js';
import { CallState, AIProvider } from '../../types.js';
import { BatchTarget, BatchCallRequest } from '../../types/batch.types.js';
import { BatchOperationService } from '../batch-operation.service.js';

/**
 * Service for handling Twilio call operations
 */
export class TwilioCallService {
    private readonly twilioClient: twilio.Twilio;
    private readonly batchService: BatchOperationService;
    private batchCallQueue: Map<string, { targets: BatchTarget[], config: BatchCallRequest }> = new Map();
    private isProcessingBatch = false;

    /**
     * Create a new Twilio call service
     * @param twilioClient The Twilio client
     */
    constructor(twilioClient: twilio.Twilio) {
        this.twilioClient = twilioClient;
        this.batchService = BatchOperationService.getInstance();
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


    public async makeCall(
        twilioCallbackUrl: string, 
        toNumber: string, 
        callContext = '', 
        provider: AIProvider = AIProvider.OPENAI,
        batchId?: string,
        customPrompt?: string,
        customContext?: string
    ): Promise<string> {
        try {
            const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

            const callContextEncoded =  encodeURIComponent(callContext);
            
            // Determine the endpoint based on provider
            const endpoint = provider === AIProvider.ELEVENLABS ? '/call/outgoing/elevenlabs' : '/call/outgoing';

            // Build query parameters
            const queryParams = new URLSearchParams({
                apiSecret: DYNAMIC_API_SECRET,
                callType: 'outgoing',
                callContext: callContextEncoded
            });

            if (batchId) queryParams.append('batchId', batchId);
            if (customPrompt) queryParams.append('customPrompt', encodeURIComponent(customPrompt));
            if (customContext) queryParams.append('customContext', encodeURIComponent(customContext));

            const call = await twilioClient.calls.create({
                to: toNumber,
                from: process.env.TWILIO_NUMBER || '',
                url: `${twilioCallbackUrl}${endpoint}?${queryParams.toString()}`,
            });

            // Pre-create transcript for this call
            const callState = new CallState();
            callState.callSid = call.sid;
            callState.fromNumber = process.env.TWILIO_NUMBER || '';
            callState.toNumber = toNumber;
            callState.callContext = callContext;
            callState.batchId = batchId;
            callState.customPrompt = customPrompt;
            callState.customContext = customContext;
            
            const transcriptId = transcriptStorage.createTranscript(callState, batchId);

            // Update batch operation if part of batch
            if (batchId) {
                this.batchService.startBatchTarget(batchId, toNumber, call.sid);
            }

            // Emit call initiated event with transcript ID
            callEventEmitter.emit('call:status', {
                callSid: call.sid,
                status: 'initiated',
                from: process.env.TWILIO_NUMBER || '',
                to: toNumber,
                timestamp: new Date(),
                transcriptId: transcriptId,
                batchId: batchId
            });

            return call.sid;
        } catch (error) {
            console.error(`Error making call: ${error}`);
            
            // Update batch operation if part of batch
            if (batchId) {
                this.batchService.failBatchTarget(batchId, toNumber, error.message || 'Failed to initiate call');
            }
            
            // Emit error event
            callEventEmitter.emit('call:error', {
                callSid: '',
                error: error.message || 'Failed to initiate call',
                code: 'CALL_INIT_ERROR',
                timestamp: new Date(),
                batchId: batchId
            });
            
            throw error;
        }
    }

    /**
     * Make batch calls
     */
    public async makeBatchCalls(
        twilioCallbackUrl: string,
        request: BatchCallRequest
    ): Promise<string> {
        const { provider, targets, defaultPrompt, defaultContext, agentId, maxConcurrent = 1 } = request;
        
        // Create batch operation
        const batchId = this.batchService.createBatchOperation('call', targets.length, {
            provider,
            defaultPrompt,
            defaultContext,
            agentId,
            maxConcurrent
        });

        // Queue all targets
        for (const target of targets) {
            this.batchService.queueBatchTarget(batchId, target.phoneNumber, target.metadata);
        }

        // Store batch configuration
        this.batchCallQueue.set(batchId, { targets, config: request });

        // Start processing if not already processing
        if (!this.isProcessingBatch) {
            this.processBatchQueue(twilioCallbackUrl);
        }

        return batchId;
    }

    /**
     * Process batch call queue with rate limiting
     */
    private async processBatchQueue(twilioCallbackUrl: string): Promise<void> {
        if (this.isProcessingBatch) return;
        
        this.isProcessingBatch = true;

        try {
            for (const [batchId, batch] of this.batchCallQueue) {
                const { targets, config } = batch;
                const maxConcurrent = config.maxConcurrent || 1;
                
                // Update batch status
                this.batchService.updateBatchStatus(batchId, 'in_progress');

                // Process targets in chunks based on maxConcurrent
                for (let i = 0; i < targets.length; i += maxConcurrent) {
                    const chunk = targets.slice(i, i + maxConcurrent);
                    
                    // Process chunk in parallel
                    const promises = chunk.map(async (target) => {
                        try {
                            const prompt = target.prompt || config.defaultPrompt;
                            const context = target.context || config.defaultContext;
                            
                            await this.makeCall(
                                twilioCallbackUrl,
                                target.phoneNumber,
                                context || '',
                                config.provider,
                                batchId,
                                prompt,
                                context
                            );
                        } catch (error) {
                            console.error(`Failed to call ${target.phoneNumber}:`, error);
                        }
                    });

                    await Promise.all(promises);

                    // Rate limit: wait 1 second between chunks
                    if (i + maxConcurrent < targets.length) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }

                // Remove from queue
                this.batchCallQueue.delete(batchId);
            }
        } finally {
            this.isProcessingBatch = false;
        }
    }
}
