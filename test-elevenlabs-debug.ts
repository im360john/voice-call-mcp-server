import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 8000;
const TEST_PHONE_NUMBER = process.env.TEST_PHONE_NUMBER;

if (!TEST_PHONE_NUMBER) {
    console.error('TEST_PHONE_NUMBER not set in environment variables');
    process.exit(1);
}

async function makeTestCall() {
    try {
        console.log('[TEST] Making outbound call to:', TEST_PHONE_NUMBER);
        console.log('[TEST] Using server at port:', PORT);
        
        const response = await axios.post(`http://localhost:${PORT}/call`, {
            number: TEST_PHONE_NUMBER,
            agentId: process.env.ELEVENLABS_AGENT_ID,
            prompt: "You are a helpful AI assistant testing the audio quality. Please speak clearly and ask if the user can hear you well.",
            firstMessage: "Hello! This is a test call to check audio quality. Can you hear me clearly? Please respond with yes or no."
        });
        
        console.log('[TEST] Call initiated:', response.data);
        console.log('[TEST] Call SID:', response.data.callSid);
        
        // Keep the script running to see debug logs
        console.log('[TEST] Monitoring call... Press Ctrl+C to exit');
        
    } catch (error: any) {
        console.error('[TEST] Error making test call:', error.response?.data || error.message);
    }
}

// Run the test
makeTestCall();

// Keep the process alive to see logs
process.on('SIGINT', () => {
    console.log('\n[TEST] Test terminated by user');
    process.exit(0);
});