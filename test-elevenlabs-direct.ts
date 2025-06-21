import WebSocket from 'ws';
import axios from 'axios';
import twilio from 'twilio';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_AGENT_ID = process.env.ELEVENLABS_AGENT_ID;

async function getSignedUrl() {
    try {
        const response = await axios.get(
            `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${ELEVENLABS_AGENT_ID}`,
            {
                headers: {
                    'xi-api-key': ELEVENLABS_API_KEY
                }
            }
        );
        return response.data.signed_url;
    } catch (error) {
        console.error('Error getting signed URL:', error);
        throw error;
    }
}

async function testDirectConnection() {
    console.log('Testing direct ElevenLabs connection...');
    
    try {
        const signedUrl = await getSignedUrl();
        console.log('Got signed URL, connecting...');
        
        const ws = new WebSocket(signedUrl);
        
        ws.on('open', () => {
            console.log('Connected to ElevenLabs!');
            
            // Send initial config
            const initialConfig = {
                type: "conversation_initiation_client_data",
                conversation_config_override: {
                    agent: {
                        prompt: {
                            prompt: "You are a helpful AI assistant",
                        },
                        first_message: "Hello! This is a test of the ElevenLabs connection.",
                    },
                },
            };
            
            console.log('Sending initial config...');
            ws.send(JSON.stringify(initialConfig));
        });
        
        ws.on('message', (data) => {
            const message = JSON.parse(data.toString());
            console.log('Received message type:', message.type);
            
            if (message.type === 'conversation_initiation_metadata') {
                console.log('Conversation started:', message.conversation_initiation_metadata_event?.conversation_id);
            } else if (message.type === 'audio') {
                console.log('Received audio, chunk length:', 
                    message.audio?.chunk?.length || 
                    message.audio_event?.audio_base_64?.length || 0);
            } else if (message.type === 'agent_response') {
                console.log('Agent said:', message.agent_response_event?.agent_response);
            }
        });
        
        ws.on('error', (error) => {
            console.error('WebSocket error:', error);
        });
        
        ws.on('close', () => {
            console.log('WebSocket closed');
        });
        
        // Keep running for 30 seconds
        setTimeout(() => {
            console.log('Closing connection...');
            ws.close();
            process.exit(0);
        }, 30000);
        
    } catch (error) {
        console.error('Test failed:', error);
        process.exit(1);
    }
}

testDirectConnection();