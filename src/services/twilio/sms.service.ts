import twilio from 'twilio';
import { callEventEmitter } from '../sse.service.js';
import { BatchSMSRequest } from '../../types/batch.types.js';
import { BatchOperationService } from '../batch-operation.service.js';

export interface SMSMessage {
    messageSid: string;
    from: string;
    to: string;
    body: string;
    timestamp: Date;
    direction: 'inbound' | 'outbound';
    status?: string;
}

export class TwilioSMSService {
    private twilioClient: twilio.Twilio;
    private twilioNumber: string;
    private batchService: BatchOperationService;
    private batchSMSQueue: Map<string, BatchSMSRequest> = new Map();
    private isProcessingBatch = false;

    constructor(twilioClient: twilio.Twilio) {
        this.twilioClient = twilioClient;
        this.twilioNumber = process.env.TWILIO_NUMBER || '';
        this.batchService = BatchOperationService.getInstance();
        
        if (!this.twilioNumber) {
            throw new Error('TWILIO_NUMBER environment variable is required');
        }
    }

    async sendSMS(to: string, body: string, batchId?: string): Promise<SMSMessage> {
        try {
            const message = await this.twilioClient.messages.create({
                body,
                from: this.twilioNumber,
                to
            });

            const smsMessage: SMSMessage = {
                messageSid: message.sid,
                from: this.twilioNumber,
                to,
                body,
                timestamp: new Date(),
                direction: 'outbound',
                status: message.status
            };

            callEventEmitter.emit('sms:sent', { ...smsMessage, batchId });

            // Update batch operation if part of batch
            if (batchId) {
                this.batchService.completeBatchTarget(batchId, to, undefined, message.sid);
            }

            return smsMessage;
        } catch (error) {
            console.error('Error sending SMS:', error);
            callEventEmitter.emit('sms:error', { error: error.message, to, body, batchId });
            
            // Update batch operation if part of batch
            if (batchId) {
                this.batchService.failBatchTarget(batchId, to, error.message || 'Failed to send SMS');
            }
            
            throw error;
        }
    }

    processIncomingSMS(twilioData: any): SMSMessage {
        const smsMessage: SMSMessage = {
            messageSid: twilioData.MessageSid,
            from: twilioData.From,
            to: twilioData.To,
            body: twilioData.Body,
            timestamp: new Date(),
            direction: 'inbound',
            status: twilioData.SmsStatus
        };

        callEventEmitter.emit('sms:received', smsMessage);

        return smsMessage;
    }

    async getMessageStatus(messageSid: string): Promise<string> {
        try {
            const message = await this.twilioClient.messages(messageSid).fetch();
            return message.status;
        } catch (error) {
            console.error('Error fetching message status:', error);
            throw error;
        }
    }

    /**
     * Send batch SMS messages
     */
    async sendBatchSMS(request: BatchSMSRequest): Promise<string> {
        const { targets, maxConcurrent = 1 } = request;
        
        // Create batch operation
        const batchId = this.batchService.createBatchOperation('sms', targets.length, {
            maxConcurrent
        });

        // Queue all targets
        for (const target of targets) {
            this.batchService.queueBatchTarget(batchId, target.phoneNumber, target.metadata);
        }

        // Store batch configuration
        this.batchSMSQueue.set(batchId, request);

        // Start processing if not already processing
        if (!this.isProcessingBatch) {
            this.processBatchQueue();
        }

        return batchId;
    }

    /**
     * Process batch SMS queue with rate limiting
     */
    private async processBatchQueue(): Promise<void> {
        if (this.isProcessingBatch) return;
        
        this.isProcessingBatch = true;

        try {
            for (const [batchId, request] of this.batchSMSQueue) {
                const { targets, maxConcurrent = 1 } = request;
                
                // Update batch status
                this.batchService.updateBatchStatus(batchId, 'in_progress');

                // Process targets in chunks based on maxConcurrent
                for (let i = 0; i < targets.length; i += maxConcurrent) {
                    const chunk = targets.slice(i, i + maxConcurrent);
                    
                    // Process chunk in parallel
                    const promises = chunk.map(async (target) => {
                        try {
                            this.batchService.startBatchTarget(batchId, target.phoneNumber);
                            await this.sendSMS(target.phoneNumber, target.message, batchId);
                        } catch (error) {
                            console.error(`Failed to send SMS to ${target.phoneNumber}:`, error);
                        }
                    });

                    await Promise.all(promises);

                    // Rate limit: wait 1 second between chunks
                    if (i + maxConcurrent < targets.length) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }

                // Remove from queue
                this.batchSMSQueue.delete(batchId);
            }
        } finally {
            this.isProcessingBatch = false;
        }
    }
}