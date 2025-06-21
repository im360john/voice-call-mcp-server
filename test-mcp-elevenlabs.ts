import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

/**
 * Test script for MCP server with ElevenLabs
 * Assumes the server is already running on localhost:3004
 */
async function testMCPElevenLabs() {
    console.log('🧪 MCP Server ElevenLabs Call Test');
    console.log('===================================\n');

    const baseUrl = 'http://localhost:3004';
    const sessionId = `test-${Date.now()}`;

    try {
        // Test phone number
        const testPhoneNumber = process.env.TEST_PHONE_NUMBER || '+17758306667';
        const fromNumber = process.env.TWILIO_NUMBER || '+14154964773';

        console.log('📞 Sending make_call request to MCP server...');
        console.log(`   Session ID: ${sessionId}`);
        console.log(`   From: ${fromNumber}`);
        console.log(`   To: ${testPhoneNumber}`);
        console.log(`   Provider: ElevenLabs\n`);

        const request = {
            jsonrpc: '2.0',
            method: 'tools/call',
            params: {
                name: 'make_call',
                arguments: {
                    to: testPhoneNumber,
                    from: fromNumber,
                    message: 'Hello! This is a test call from the MCP server using ElevenLabs. I am an AI assistant powered by ElevenLabs conversational AI. How are you doing today?',
                    provider: 'elevenlabs'
                }
            },
            id: 1
        };

        const response = await axios.post(
            `${baseUrl}/mcp/messages?sessionId=${sessionId}`,
            request,
            {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );

        console.log('✅ Response received from MCP server:');
        console.log(JSON.stringify(response.data, null, 2));

        if (response.data.result?.content?.[0]?.text) {
            const result = JSON.parse(response.data.result.content[0].text);
            console.log('\n📊 Call Details:');
            console.log(`   Status: ${result.status}`);
            console.log(`   Call SID: ${result.callSid}`);
            console.log(`   Message: ${result.message}`);
            
            if (result.callSid) {
                console.log(`\n🔗 Call Status URL: ${baseUrl}/events?callSid=${result.callSid}`);
            }
        }

        console.log('\n📞 The phone should ring now. Answer it to test the ElevenLabs integration!');
        console.log('💡 Say "goodbye" to end the call.');

    } catch (error: any) {
        console.error('❌ Error:', error.response?.data || error.message);
        if (error.code === 'ECONNREFUSED') {
            console.error('\n⚠️  Make sure the MCP server is running on port 3004');
            console.error('   Run: npm start');
        }
    }
}

testMCPElevenLabs().catch(console.error);