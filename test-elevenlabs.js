#!/usr/bin/env node

/**
 * Test script for ElevenLabs voice functionality
 * 
 * Usage: node test-elevenlabs.js <phone-number> <context>
 * Example: node test-elevenlabs.js +1234567890 "Ask about store hours"
 */

const args = process.argv.slice(2);

if (args.length < 2) {
    console.error('Usage: node test-elevenlabs.js <phone-number> <context>');
    console.error('Example: node test-elevenlabs.js +1234567890 "Ask about store hours"');
    process.exit(1);
}

const phoneNumber = args[0];
const context = args.slice(1).join(' ');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3004';

// Validate phone number format
if (!phoneNumber.match(/^\+[1-9]\d{1,14}$/)) {
    console.error('Error: Phone number must be in E.164 format (e.g., +1234567890)');
    process.exit(1);
}

// Check for ElevenLabs configuration
if (!process.env.ELEVENLABS_API_KEY || !process.env.ELEVENLABS_AGENT_ID) {
    console.error('Error: ElevenLabs configuration missing!');
    console.error('Please set ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID environment variables');
    process.exit(1);
}

console.log(`🎭 Testing ElevenLabs voice call functionality...`);
console.log(`Server URL: ${SERVER_URL}`);
console.log(`Provider: ElevenLabs`);
console.log(`To: ${phoneNumber}`);
console.log(`Context: ${context}`);
console.log('---');

// Trigger call via MCP endpoint
async function triggerCall() {
    try {
        const response = await fetch(`${SERVER_URL}/mcp/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'tools/call',
                params: {
                    name: 'trigger-call',
                    arguments: {
                        toNumber: phoneNumber,
                        callContext: context,
                        provider: 'elevenlabs'
                    }
                },
                id: 1
            })
        });

        const data = await response.json();
        
        if (data.result && !data.error) {
            const result = JSON.parse(data.result.content[0].text);
            
            if (result.status === 'success') {
                console.log('✅ Call triggered successfully!');
                console.log(`Call SID: ${result.callSid}`);
                console.log(`Transcript ID: ${result.transcriptId}`);
                console.log(`Provider: ${result.provider}`);
                console.log('\n📡 Connecting to SSE for real-time updates...');
                
                // Connect to SSE
                connectSSE(result.callSid, result.sseUrl);
            } else {
                console.error('❌ Failed to trigger call:', result.message);
                process.exit(1);
            }
        } else {
            console.error('❌ MCP error:', data.error || 'Unknown error');
            process.exit(1);
        }
    } catch (error) {
        console.error('❌ Error triggering call:', error.message);
        process.exit(1);
    }
}

// Connect to SSE for real-time updates
function connectSSE(callSid, sseUrl) {
    const EventSource = require('eventsource');
    
    if (!sseUrl) {
        sseUrl = `${SERVER_URL}/events?callSid=${callSid}`;
    }
    
    console.log(`SSE URL: ${sseUrl}`);
    
    const eventSource = new EventSource(sseUrl);
    
    eventSource.addEventListener('connected', (event) => {
        console.log('✅ Connected to SSE');
    });
    
    eventSource.addEventListener('call-status', (event) => {
        const data = JSON.parse(event.data);
        console.log(`\n📞 Call Status: ${data.status}`);
        if (data.status === 'ended') {
            console.log('Call ended. Closing connection...');
            eventSource.close();
            process.exit(0);
        }
    });
    
    eventSource.addEventListener('transcription', (event) => {
        const data = JSON.parse(event.data);
        const speaker = data.speaker === 'assistant' ? '🎭 Agent' : '👤 User';
        console.log(`\n${speaker}: ${data.transcription}`);
    });
    
    eventSource.addEventListener('error', (event) => {
        const data = JSON.parse(event.data);
        console.error(`\n❌ Error: ${data.error}`);
    });
    
    eventSource.addEventListener('heartbeat', () => {
        process.stdout.write('💓');
    });
    
    eventSource.onerror = (error) => {
        console.error('\n❌ SSE Error:', error);
        eventSource.close();
        process.exit(1);
    };
    
    // Handle Ctrl+C
    process.on('SIGINT', () => {
        console.log('\n\n👋 Closing connection...');
        eventSource.close();
        process.exit(0);
    });
}

// Check if eventsource module is installed
try {
    require('eventsource');
} catch (e) {
    console.error('❌ Please install the eventsource module first:');
    console.error('   npm install eventsource');
    process.exit(1);
}

// Run the test
triggerCall();