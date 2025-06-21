import axios from 'axios';
import dotenv from 'dotenv';
import { EventSource } from 'eventsource';

dotenv.config({ path: '.env.test' });

/**
 * Test script for ElevenLabs integration through MCP endpoints
 * This script tests the full flow: MCP -> Twilio -> ElevenLabs
 */

interface CallOptions {
    to: string;
    from: string;
    message?: string;
    provider?: 'openai' | 'elevenlabs';
}

class ElevenLabsMCPTest {
    private baseUrl: string;
    private sessionId: string;
    private eventSource: EventSource | null = null;

    constructor() {
        // Use localhost for testing, adjust if your server is deployed
        this.baseUrl = process.env.MCP_SERVER_URL || 'http://localhost:3000';
        this.sessionId = this.generateSessionId();
        
        console.log('🔧 Test Configuration:');
        console.log(`   Base URL: ${this.baseUrl}`);
        console.log(`   Session ID: ${this.sessionId}`);
        console.log(`   Provider: ElevenLabs`);
        console.log('');
    }

    private generateSessionId(): string {
        return `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    async testMakeCall(): Promise<void> {
        console.log('📞 Testing MCP make_call endpoint with ElevenLabs...\n');

        // Phone number to call (should be a valid number you can answer)
        const testPhoneNumber = process.env.TEST_PHONE_NUMBER || '+15555551234';
        const fromNumber = process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_NUMBER || '+14154964773';

        if (!process.env.TEST_PHONE_NUMBER) {
            console.error('❌ Please set TEST_PHONE_NUMBER environment variable');
            console.log('   Example: TEST_PHONE_NUMBER="+1234567890"');
            process.exit(1);
        }

        const callOptions: CallOptions = {
            to: testPhoneNumber,
            from: fromNumber,
            message: 'Hello! This is a test call from ElevenLabs integration. How are you today?',
            provider: 'elevenlabs'
        };

        try {
            // Step 1: Set up SSE connection for real-time updates
            await this.setupSSEConnection();

            // Step 2: Make the call through MCP
            console.log('📤 Sending call request to MCP server...');
            console.log(`   To: ${callOptions.to}`);
            console.log(`   From: ${callOptions.from}`);
            console.log(`   Provider: ${callOptions.provider}`);
            console.log('');

            const response = await axios.post(
                `${this.baseUrl}/mcp/messages?sessionId=${this.sessionId}`,
                {
                    method: 'tools/call',
                    params: {
                        name: 'make_call',
                        arguments: callOptions
                    }
                },
                {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );

            console.log('✅ Call initiated successfully!');
            console.log('📊 Response:', JSON.stringify(response.data, null, 2));
            
            if (response.data.content?.[0]?.text) {
                console.log('\n📝 Call Details:');
                console.log(response.data.content[0].text);
            }

            // Keep the test running to receive SSE events
            console.log('\n⏳ Listening for call events for 2 minutes...');
            console.log('💡 Answer the phone when it rings to test the integration!\n');

            // Set timeout to end test after 2 minutes
            setTimeout(() => {
                console.log('\n⏰ Test duration complete.');
                this.cleanup();
            }, 120000);

        } catch (error: any) {
            console.error('❌ Error making call:', error.response?.data || error.message);
            this.cleanup();
            process.exit(1);
        }
    }

    private async setupSSEConnection(): Promise<void> {
        return new Promise((resolve, reject) => {
            console.log('🔌 Setting up SSE connection for real-time updates...');
            
            const sseUrl = `${this.baseUrl}/mcp/sse?sessionId=${this.sessionId}`;
            this.eventSource = new EventSource(sseUrl);

            this.eventSource.onopen = () => {
                console.log('✅ SSE connection established\n');
                resolve();
            };

            this.eventSource.onerror = (error) => {
                console.error('❌ SSE connection error:', error);
                reject(error);
            };

            // Listen for call events
            this.eventSource.addEventListener('call:status', (event) => {
                const data = JSON.parse(event.data);
                console.log(`📞 Call Status: ${data.status}`);
                if (data.callSid) console.log(`   Call SID: ${data.callSid}`);
            });

            this.eventSource.addEventListener('call:transcription', (event) => {
                const data = JSON.parse(event.data);
                console.log(`💬 ${data.speaker}: ${data.transcription}`);
            });

            this.eventSource.addEventListener('call:ended', (event) => {
                const data = JSON.parse(event.data);
                console.log('\n📞 Call Ended');
                console.log(`   Duration: ${data.duration} seconds`);
                console.log(`   Transcript ID: ${data.transcriptId}`);
                
                // End the test when call ends
                setTimeout(() => {
                    console.log('\n✅ Test completed successfully!');
                    this.cleanup();
                }, 2000);
            });

            this.eventSource.addEventListener('error', (event) => {
                const data = JSON.parse(event.data);
                console.error('❌ Error:', data.message);
            });

            // Heartbeat
            this.eventSource.addEventListener('heartbeat', (event) => {
                // Silently handle heartbeats
            });
        });
    }

    private cleanup(): void {
        if (this.eventSource) {
            console.log('\n🧹 Cleaning up...');
            this.eventSource.close();
            this.eventSource = null;
        }
        process.exit(0);
    }
}

// Main execution
async function main() {
    console.log('🧪 ElevenLabs MCP Integration Test');
    console.log('====================================\n');

    // Check required environment variables
    const requiredVars = [
        'TWILIO_ACCOUNT_SID',
        'TWILIO_AUTH_TOKEN',
        'TWILIO_PHONE_NUMBER',
        'ELEVENLABS_API_KEY',
        'ELEVENLABS_AGENT_ID',
        'TEST_PHONE_NUMBER'
    ];

    const missingVars = requiredVars.filter(v => !process.env[v]);
    if (missingVars.length > 0) {
        console.error('❌ Missing required environment variables:');
        missingVars.forEach(v => console.error(`   - ${v}`));
        console.log('\n📝 Please set these in your .env file');
        process.exit(1);
    }

    const test = new ElevenLabsMCPTest();
    
    try {
        await test.testMakeCall();
    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n⚠️  Received SIGINT, shutting down gracefully...');
    process.exit(0);
});

main().catch(console.error);