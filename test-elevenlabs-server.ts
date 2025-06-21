import dotenv from 'dotenv';
import express from 'express';
import ngrok from '@ngrok/ngrok';
import twilio from 'twilio';
import { VoiceServer } from './src/servers/voice.server.js';
import { CallSessionManager } from './src/handlers/openai.handler.js';
import { TwilioCallService } from './src/services/twilio/call.service.js';

dotenv.config({ path: '.env.test' });

/**
 * Standalone server for testing ElevenLabs calls
 */
async function startTestServer() {
    console.log('🚀 Starting ElevenLabs Test Server');
    console.log('==================================\n');

    const PORT = 3004;

    try {
        // Initialize Twilio client
        const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        const sessionManager = new CallSessionManager(twilioClient);
        const twilioCallService = new TwilioCallService(twilioClient);

        // Setup ngrok
        console.log('🌐 Setting up ngrok tunnel...');
        const listener = await ngrok.forward({
            addr: PORT,
            authtoken_from_env: true
        });
        const twilioCallbackUrl = listener.url();
        console.log(`✅ Ngrok URL: ${twilioCallbackUrl}`);

        // Start Voice Server
        console.log(`\n🎤 Starting Voice Server on port ${PORT}...`);
        const voiceServer = new VoiceServer(twilioCallbackUrl, sessionManager, twilioCallService);
        voiceServer.start();
        
        console.log(`✅ Voice Server is running on port ${PORT}`);
        console.log(`   WebSocket endpoints:`);
        console.log(`   - OpenAI: wss://${twilioCallbackUrl.replace('https://', '')}/call/connection-outgoing/:secret`);
        console.log(`   - ElevenLabs: wss://${twilioCallbackUrl.replace('https://', '')}/call/connection-elevenlabs/:secret`);

        // Now make a test call
        console.log('\n📞 Making test call with ElevenLabs...');
        const testPhoneNumber = process.env.TEST_PHONE_NUMBER || '+17758306667';
        const fromNumber = process.env.TWILIO_NUMBER || '+14154964773';

        console.log(`   From: ${fromNumber}`);
        console.log(`   To: ${testPhoneNumber}`);
        console.log(`   Provider: ElevenLabs\n`);

        const callOptions = {
            toNumber: testPhoneNumber,
            message: 'Hello! This is a test call from ElevenLabs integration. I am an AI assistant powered by ElevenLabs. How can I help you today?',
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
        console.log(`   Webhook URL: ${twilioCallbackUrl}/call/outgoing/elevenlabs`);
        console.log(`   Status URL: ${twilioCallbackUrl}/events?callSid=${callSid}\n`);

        console.log('📞 The phone should ring now. Answer it to test the ElevenLabs integration!');
        console.log('💡 Say "goodbye" to end the call.');
        console.log('\n⏳ Server will run for 5 minutes. Press Ctrl+C to stop earlier.');

        // Keep server running
        setTimeout(async () => {
            console.log('\n⏰ Test complete. Shutting down...');
            await ngrok.disconnect();
            process.exit(0);
        }, 300000); // 5 minutes

    } catch (error) {
        console.error('❌ Error:', error);
        await ngrok.disconnect();
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n\n⚠️  Received SIGINT, shutting down gracefully...');
    await ngrok.disconnect();
    process.exit(0);
});

startTestServer().catch(console.error);