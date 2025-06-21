import axios from 'axios';
import dotenv from 'dotenv';
import ngrok from '@ngrok/ngrok';
import twilio from 'twilio';
import { VoiceServer } from './src/servers/voice.server.js';
import { CallSessionManager } from './src/handlers/openai.handler.js';
import { TwilioCallService } from './src/services/twilio/call.service.js';
import { TwilioSMSService } from './src/services/twilio/sms.service.js';

dotenv.config({ path: '.env.test' });

/**
 * Direct test script for ElevenLabs call through the server
 */
async function testElevenLabsCall() {
    console.log('🧪 ElevenLabs Direct Call Test');
    console.log('==============================\n');

    try {
        // Initialize Twilio client
        const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        const twilioCallService = new TwilioCallService(twilioClient);

        // Setup ngrok
        console.log('🌐 Setting up ngrok tunnel...');
        const listener = await ngrok.forward({
            addr: 3004,
            authtoken_from_env: true
        });
        const twilioCallbackUrl = listener.url();
        console.log(`✅ Ngrok URL: ${twilioCallbackUrl}\n`);

        // Get test phone number
        const testPhoneNumber = process.env.TEST_PHONE_NUMBER || '+17758306667';
        const fromNumber = process.env.TWILIO_NUMBER || '+14154964773';

        console.log('📞 Making call with ElevenLabs...');
        console.log(`   From: ${fromNumber}`);
        console.log(`   To: ${testPhoneNumber}`);
        console.log(`   Provider: ElevenLabs\n`);

        // Make the call directly using TwilioCallService
        const callOptions = {
            toNumber: testPhoneNumber,
            message: 'Hello! This is a test call from ElevenLabs integration. I am an AI assistant. How can I help you today?',
            provider: 'elevenlabs' as const
        };

        const callSid = await twilioCallService.makeCall(
            twilioCallbackUrl,
            callOptions.toNumber,
            callOptions.message,
            callOptions.provider
        );

        console.log(`✅ Call initiated successfully!`);
        console.log(`   Call SID: ${callSid}`);
        console.log(`   Status URL: ${twilioCallbackUrl}/events?callSid=${callSid}\n`);

        console.log('📞 The phone should ring now. Answer it to test the ElevenLabs integration!');
        console.log('💡 Say "goodbye" to end the call.\n');

        // Keep the script running for 2 minutes
        console.log('⏳ Keeping connection open for 2 minutes...');
        setTimeout(async () => {
            console.log('\n⏰ Test complete. Disconnecting...');
            await ngrok.disconnect();
            process.exit(0);
        }, 120000);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n\n⚠️  Received SIGINT, shutting down gracefully...');
    await ngrok.disconnect();
    process.exit(0);
});

testElevenLabsCall().catch(console.error);