import { WebSocket } from 'ws';
import axios from 'axios';
import { ElevenLabsConfig, ElevenLabsMessage } from '../../types.js';

export class ElevenLabsWsService {
    private webSocket: WebSocket | null = null;
    private readonly config: ElevenLabsConfig;
    private keepAliveInterval: NodeJS.Timeout | null = null;

    constructor(config: ElevenLabsConfig) {
        this.config = config;
    }

    /**
     * Get a signed URL for establishing WebSocket connection
     */
    private async getSignedUrl(): Promise<string> {
        try {
            const response = await axios.get(
                `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${this.config.agentId}`,
                {
                    headers: {
                        'xi-api-key': this.config.apiKey
                    }
                }
            );

            if (!response.data.signed_url) {
                throw new Error('No signed URL returned from ElevenLabs API');
            }

            return response.data.signed_url;
        } catch (error) {
            console.error('Error getting signed URL from ElevenLabs:', error);
            throw error;
        }
    }

    /**
     * Initialize WebSocket connection to ElevenLabs
     */
    async initialize(
        onMessage: (data: ElevenLabsMessage) => void,
        onOpen: () => void,
        onClose: () => void,
        onError: (error: Error) => void
    ): Promise<void> {
        try {
            const signedUrl = await this.getSignedUrl();
            
            this.webSocket = new WebSocket(signedUrl);

            this.webSocket.on('open', () => {
                console.log('Connected to ElevenLabs WebSocket');
                this.startKeepAlive();
                onOpen();
            });

            this.webSocket.on('message', (data: WebSocket.Data) => {
                try {
                    const message = JSON.parse(data.toString()) as ElevenLabsMessage;
                    
                    // Handle pong messages internally
                    if (message.type === 'pong') {
                        return;
                    }
                    
                    onMessage(message);
                } catch (error) {
                    console.error('Error parsing ElevenLabs message:', error);
                }
            });

            this.webSocket.on('close', () => {
                console.log('ElevenLabs WebSocket closed');
                this.stopKeepAlive();
                onClose();
            });

            this.webSocket.on('error', (error) => {
                console.error('ElevenLabs WebSocket error:', error);
                onError(error);
            });

        } catch (error) {
            console.error('Error initializing ElevenLabs WebSocket:', error);
            throw error;
        }
    }

    /**
     * Send audio data to ElevenLabs
     */
    sendAudio(audioBase64: string): void {
        if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) {
            console.error('Cannot send audio: WebSocket is not open');
            return;
        }

        const message = {
            user_audio_chunk: audioBase64
        };

        this.webSocket.send(JSON.stringify(message));
    }

    /**
     * Send an interruption signal
     */
    sendInterruption(): void {
        if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) {
            console.error('Cannot send interruption: WebSocket is not open');
            return;
        }

        const message = {
            type: 'interruption'
        };

        this.webSocket.send(JSON.stringify(message));
    }

    /**
     * Start keep-alive ping/pong mechanism
     */
    private startKeepAlive(): void {
        this.keepAliveInterval = setInterval(() => {
            if (this.webSocket && this.webSocket.readyState === WebSocket.OPEN) {
                this.webSocket.send(JSON.stringify({ type: 'ping' }));
            }
        }, 20000); // Send ping every 20 seconds
    }

    /**
     * Stop keep-alive mechanism
     */
    private stopKeepAlive(): void {
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
        }
    }

    /**
     * Close the WebSocket connection
     */
    close(): void {
        this.stopKeepAlive();
        
        if (this.webSocket) {
            if (this.webSocket.readyState === WebSocket.OPEN) {
                this.webSocket.close();
            }
            this.webSocket = null;
        }
    }

    /**
     * Check if WebSocket is connected
     */
    isConnected(): boolean {
        return this.webSocket !== null && this.webSocket.readyState === WebSocket.OPEN;
    }
}