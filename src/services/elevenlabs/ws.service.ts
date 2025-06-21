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
            console.log('Requesting signed URL with agent_id:', this.config.agentId);
            const response = await axios.get(
                `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${this.config.agentId}`,
                {
                    headers: {
                        'xi-api-key': this.config.apiKey
                    }
                }
            );

            console.log('ElevenLabs API response status:', response.status);
            
            if (!response.data.signed_url) {
                console.error('API response:', response.data);
                throw new Error('No signed URL returned from ElevenLabs API');
            }

            return response.data.signed_url;
        } catch (error: any) {
            console.error('Error getting signed URL from ElevenLabs:', error.message);
            if (error.response) {
                console.error('Response status:', error.response.status);
                console.error('Response data:', error.response.data);
            }
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
        console.log('ElevenLabs WebSocket initialize called');
        try {
            console.log('Getting signed URL from ElevenLabs API...');
            const signedUrl = await this.getSignedUrl();
            console.log('Got signed URL:', signedUrl.substring(0, 50) + '...');
            
            this.webSocket = new WebSocket(signedUrl);
            
            // Set a timeout for connection
            const connectionTimeout = setTimeout(() => {
                console.error('ElevenLabs WebSocket connection timeout after 10s');
                if (this.webSocket && this.webSocket.readyState === WebSocket.CONNECTING) {
                    this.webSocket.close();
                    onError(new Error('WebSocket connection timeout'));
                }
            }, 10000);

            this.webSocket.on('open', () => {
                clearTimeout(connectionTimeout);
                console.log('Connected to ElevenLabs WebSocket');
                
                // Send initial configuration message
                const initialConfig: any = {
                    type: "conversation_initiation_client_data"
                };
                
                // Only send overrides if explicitly provided
                if (this.config.prompt || this.config.firstMessage) {
                    initialConfig.conversation_config_override = {
                        agent: {}
                    };
                    
                    if (this.config.prompt) {
                        initialConfig.conversation_config_override.agent.prompt = {
                            prompt: this.config.prompt
                        };
                    }
                    
                    if (this.config.firstMessage) {
                        initialConfig.conversation_config_override.agent.first_message = this.config.firstMessage;
                    }
                    
                    console.log('Sending initial configuration with overrides to ElevenLabs:', initialConfig);
                } else {
                    console.log('Sending initial configuration without overrides - using agent defaults');
                }
                
                this.webSocket.send(JSON.stringify(initialConfig));
                
                this.startKeepAlive();
                onOpen();
            });

            this.webSocket.on('message', (data: WebSocket.Data) => {
                try {
                    const message = JSON.parse(data.toString()) as ElevenLabsMessage;
                    
                    console.log('[DEBUG] ElevenLabs message received, type:', message.type);
                    
                    // Handle ping messages by sending pong with event_id
                    if (message.type === 'ping' && message.ping_event?.event_id) {
                        this.webSocket!.send(JSON.stringify({
                            type: 'pong',
                            event_id: message.ping_event.event_id
                        }));
                        return;
                    }
                    
                    // Handle pong messages internally
                    if (message.type === 'pong') {
                        return;
                    }
                    
                    // Log audio messages specifically
                    if (message.type === 'audio') {
                        console.log('[DEBUG] Audio message structure:', {
                            hasAudio: !!message.audio,
                            audioType: typeof message.audio,
                            hasChunk: !!(message.audio && typeof message.audio === 'object' && 'chunk' in message.audio),
                            chunkLength: message.audio?.chunk?.length || 0
                        });
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
            onError(error as Error);
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

        // Normalize audio encoding by converting through Buffer
        const message = {
            user_audio_chunk: Buffer.from(audioBase64, 'base64').toString('base64')
        };

        console.log('[DEBUG] Sending audio to ElevenLabs, chunk length:', message.user_audio_chunk.length);
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

    /**
     * Send initial message to start the conversation
     * @deprecated The initial configuration is now sent automatically on connection
     */
    sendInitialMessage(message: string): void {
        if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) {
            console.error('Cannot send initial message: WebSocket is not open');
            return;
        }

        // This method is deprecated - initial config is sent on connection
        console.log('sendInitialMessage called but initial config already sent on connection');
    }
}