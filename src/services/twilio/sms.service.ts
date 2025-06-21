import twilio from 'twilio';
import { callEventEmitter } from '../sse.service.js';

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

    constructor(twilioClient: twilio.Twilio) {
        this.twilioClient = twilioClient;
        this.twilioNumber = process.env.TWILIO_NUMBER || '';
        
        if (!this.twilioNumber) {
            throw new Error('TWILIO_NUMBER environment variable is required');
        }
    }

    async sendSMS(to: string, body: string): Promise<SMSMessage> {
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

            callEventEmitter.emit('sms:sent', smsMessage);

            return smsMessage;
        } catch (error) {
            console.error('Error sending SMS:', error);
            callEventEmitter.emit('sms:error', { error: error.message, to, body });
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
}