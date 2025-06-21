import axios from 'axios';
import dotenv from 'dotenv';
import { WebSocket } from 'ws';

dotenv.config({ path: '.env.test' });

/**
 * Test script for ElevenLabs integration
 * This script tests the ElevenLabs WebSocket connection and basic functionality
 */

class ElevenLabsTest {
    private ws: WebSocket | null = null;
    private apiKey: string;
    private agentId: string;

    constructor() {
        this.apiKey = process.env.ELEVENLABS_API_KEY || '';
        this.agentId = process.env.ELEVENLABS_AGENT_ID || '';

        if (!this.apiKey || !this.agentId) {
            console.error('Missing ELEVENLABS_API_KEY or ELEVENLABS_AGENT_ID in environment variables');
            process.exit(1);
        }
    }

    async getSignedUrl(): Promise<string> {
        console.log('🔑 Getting signed URL from ElevenLabs...');
        try {
            const response = await axios.get(
                `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${this.agentId}`,
                {
                    headers: {
                        'xi-api-key': this.apiKey
                    }
                }
            );

            if (!response.data.signed_url) {
                throw new Error('No signed URL returned from ElevenLabs API');
            }

            console.log('✅ Successfully obtained signed URL');
            return response.data.signed_url;
        } catch (error: any) {
            console.error('❌ Error getting signed URL:', error.response?.data || error.message);
            throw error;
        }
    }

    async testWebSocketConnection(): Promise<void> {
        console.log('\n🚀 Testing ElevenLabs WebSocket connection...\n');

        try {
            // Step 1: Get signed URL
            const signedUrl = await this.getSignedUrl();

            // Step 2: Connect to WebSocket
            console.log('🔌 Connecting to ElevenLabs WebSocket...');
            this.ws = new WebSocket(signedUrl);

            // Set up event handlers
            this.ws.on('open', () => {
                console.log('✅ WebSocket connection opened successfully');
                console.log('📤 Sending test ping...');
                this.ws?.send(JSON.stringify({ type: 'ping' }));
            });

            this.ws.on('message', (data: WebSocket.Data) => {
                try {
                    const message = JSON.parse(data.toString());
                    console.log('📥 Received message:', JSON.stringify(message, null, 2));

                    // Handle different message types
                    switch (message.type) {
                        case 'conversation_initiation_metadata':
                            console.log('✅ Conversation initialized with ID:', message.conversation_id);
                            break;
                        case 'pong':
                            console.log('✅ Received pong response');
                            // Send a test audio chunk (silence)
                            this.testAudioSending();
                            break;
                        case 'ping':
                            console.log('📤 Responding to ping with pong...');
                            this.ws?.send(JSON.stringify({ type: 'pong' }));
                            break;
                        case 'audio':
                            console.log('🔊 Received audio chunk');
                            break;
                        case 'agent_response':
                            console.log('🤖 Agent response:', message.agent_response);
                            break;
                        case 'user_transcript':
                            console.log('👤 User transcript:', message.user_transcript);
                            break;
                        default:
                            console.log('❓ Unknown message type:', message.type);
                    }
                } catch (error) {
                    console.error('❌ Error parsing message:', error);
                }
            });

            this.ws.on('close', (code, reason) => {
                console.log(`\n🔌 WebSocket closed. Code: ${code}, Reason: ${reason}`);
            });

            this.ws.on('error', (error) => {
                console.error('❌ WebSocket error:', error);
            });

            // Keep the connection alive for testing
            console.log('\n⏳ Keeping connection open for 30 seconds...\n');
            setTimeout(() => {
                console.log('⏰ Test duration complete. Closing connection...');
                this.close();
            }, 30000);

        } catch (error) {
            console.error('❌ Test failed:', error);
            process.exit(1);
        }
    }

    testAudioSending(): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.error('❌ Cannot send audio: WebSocket is not open');
            return;
        }

        console.log('🎤 Sending test audio chunk (silence)...');
        
        // Create a small silent audio chunk (base64 encoded)
        // This is 160 samples of silence at 8kHz (20ms of audio)
        const silentAudioBase64 = Buffer.alloc(160).toString('base64');
        
        const audioMessage = {
            user_audio_chunk: silentAudioBase64
        };

        this.ws.send(JSON.stringify(audioMessage));
        console.log('✅ Test audio sent');
    }

    close(): void {
        if (this.ws) {
            console.log('🔌 Closing WebSocket connection...');
            this.ws.close();
            this.ws = null;
        }
        console.log('\n✅ Test completed');
        process.exit(0);
    }
}

// Run the test
async function main() {
    console.log('🧪 ElevenLabs Integration Test');
    console.log('================================\n');

    const test = new ElevenLabsTest();
    
    try {
        await test.testWebSocketConnection();
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