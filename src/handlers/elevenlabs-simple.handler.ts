import { WebSocket } from 'ws';
import twilio from 'twilio';
import axios from 'axios';
import { CallState, CallType } from '../types.js';
import { callEventEmitter } from '../services/sse.service.js';
import { transcriptStorage } from '../services/transcript-storage.service.js';
import { BatchOperationService } from '../services/batch-operation.service.js';

/**
 * Simplified ElevenLabs handler based on the working example
 * This implementation closely follows the proven pattern from:
 * https://github.com/elevenlabs/elevenlabs-examples/blob/main/examples/conversational-ai/twilio/javascript/outbound.js
 */
export class SimpleElevenLabsHandler {
    private twilioWs: WebSocket;
    private elevenLabsWs: WebSocket | null = null;
    private streamSid: string | null = null;
    private callSid: string | null = null;
    private customParameters: any = null;
    private callState: CallState;
    private batchService: BatchOperationService;

    constructor(ws: WebSocket, callType: CallType, private twilioClient: twilio.Twilio) {
        console.log('[SimpleElevenLabs] Handler created');
        this.twilioWs = ws;
        this.callState = new CallState(callType);
        this.batchService = BatchOperationService.getInstance();
        
        // Set up handlers immediately
        this.setupTwilioHandlers();
        this.setupElevenLabs();
    }

    private async getSignedUrl(): Promise<string> {
        try {
            const agentId = process.env.ELEVENLABS_AGENT_ID;
            const apiKey = process.env.ELEVENLABS_API_KEY;
            
            console.log('[SimpleElevenLabs] Getting signed URL for agent:', agentId);
            
            const response = await axios.get(
                `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${agentId}`,
                {
                    headers: {
                        'xi-api-key': apiKey
                    }
                }
            );

            if (!response.data.signed_url) {
                throw new Error('No signed URL returned from ElevenLabs API');
            }

            return response.data.signed_url;
        } catch (error) {
            console.error('[SimpleElevenLabs] Error getting signed URL:', error);
            throw error;
        }
    }

    private async setupElevenLabs(): Promise<void> {
        try {
            const signedUrl = await this.getSignedUrl();
            console.log('[SimpleElevenLabs] Got signed URL, creating WebSocket');
            
            this.elevenLabsWs = new WebSocket(signedUrl);

            this.elevenLabsWs.on('open', () => {
                console.log('[SimpleElevenLabs] Connected to Conversational AI');

                // Send initial configuration
                const initialConfig: any = {
                    type: "conversation_initiation_client_data"
                };

                // Only send overrides if explicitly provided via custom parameters or env variables
                // Check for batch custom prompt first, then fall back to other sources
                const customPrompt = this.customParameters?.customPrompt 
                    ? decodeURIComponent(this.customParameters.customPrompt)
                    : (this.customParameters?.prompt || process.env.ELEVENLABS_PROMPT);
                    
                const customFirstMessage = this.customParameters?.first_message || process.env.ELEVENLABS_FIRST_MESSAGE;
                
                // Use custom context if provided
                const customContext = this.customParameters?.customContext 
                    ? decodeURIComponent(this.customParameters.customContext)
                    : this.customParameters?.callContext 
                    ? decodeURIComponent(this.customParameters.callContext)
                    : null;
                
                // For ElevenLabs, if we have context but no prompt, use the context as the prompt
                // This handles cases where the user says "ask if they want pizza"
                const effectivePrompt = customPrompt || customContext;
                
                if (effectivePrompt || customFirstMessage) {
                    initialConfig.conversation_config_override = {
                        agent: {}
                    };
                    
                    if (effectivePrompt) {
                        initialConfig.conversation_config_override.agent.prompt = {
                            prompt: effectivePrompt
                        };
                    }
                    
                    if (customFirstMessage) {
                        initialConfig.conversation_config_override.agent.first_message = customFirstMessage;
                    }
                    
                    console.log('[SimpleElevenLabs] Sending initial config WITH OVERRIDES:', initialConfig);
                } else {
                    console.log('[SimpleElevenLabs] Sending initial config WITHOUT overrides - using agent defaults');
                }
                
                this.elevenLabsWs!.send(JSON.stringify(initialConfig));
            });

            this.elevenLabsWs.on('message', (data: Buffer) => {
                try {
                    const message = JSON.parse(data.toString());
                    
                    switch (message.type) {
                        case 'conversation_initiation_metadata':
                            console.log('[SimpleElevenLabs] Received initiation metadata');
                            if (message.conversation_initiation_metadata_event?.conversation_id) {
                                console.log('[SimpleElevenLabs] Conversation ID:', 
                                    message.conversation_initiation_metadata_event.conversation_id);
                            }
                            break;

                        case 'audio':
                            if (this.streamSid) {
                                // Handle both audio formats exactly like the working example
                                if (message.audio?.chunk) {
                                    console.log('[SimpleElevenLabs] Sending audio chunk to Twilio, length:', message.audio.chunk.length);
                                    const audioData = {
                                        event: "media",
                                        streamSid: this.streamSid,
                                        media: {
                                            payload: message.audio.chunk,
                                        },
                                    };
                                    this.twilioWs.send(JSON.stringify(audioData));
                                } else if (message.audio_event?.audio_base_64) {
                                    console.log('[SimpleElevenLabs] Sending audio_event to Twilio, length:', message.audio_event.audio_base_64.length);
                                    const audioData = {
                                        event: "media",
                                        streamSid: this.streamSid,
                                        media: {
                                            payload: message.audio_event.audio_base_64,
                                        },
                                    };
                                    this.twilioWs.send(JSON.stringify(audioData));
                                } else {
                                    console.log('[SimpleElevenLabs] Audio message without chunk:', JSON.stringify(message).substring(0, 200));
                                }
                            } else {
                                console.log('[SimpleElevenLabs] Received audio but no StreamSid yet');
                            }
                            break;

                        case 'interruption':
                            if (this.streamSid) {
                                this.twilioWs.send(JSON.stringify({
                                    event: "clear",
                                    streamSid: this.streamSid,
                                }));
                            }
                            break;

                        case 'ping':
                            if (message.ping_event?.event_id) {
                                this.elevenLabsWs!.send(JSON.stringify({
                                    type: "pong",
                                    event_id: message.ping_event.event_id,
                                }));
                            }
                            break;

                        case 'agent_response':
                            const agentResponse = message.agent_response_event?.agent_response;
                            console.log(`[SimpleElevenLabs] Agent: ${agentResponse}`);
                            
                            if (!this.callSid) {
                                console.log('[SimpleElevenLabs] WARNING: No callSid available for agent response');
                            }
                            
                            if (this.callSid && agentResponse) {
                                transcriptStorage.addEntry(this.callSid, 'assistant', agentResponse);
                                console.log(`[SimpleElevenLabs] Stored agent transcript for callSid: ${this.callSid}`);
                                
                                // Emit SSE event for real-time updates
                                callEventEmitter.emit('call:transcription', {
                                    callSid: this.callSid,
                                    speaker: 'ai',
                                    transcription: agentResponse,
                                    timestamp: new Date()
                                });
                            }
                            break;

                        case 'user_transcript':
                            const userTranscript = message.user_transcription_event?.user_transcript;
                            console.log(`[SimpleElevenLabs] User: ${userTranscript}`);
                            
                            if (!this.callSid) {
                                console.log('[SimpleElevenLabs] WARNING: No callSid available for user transcript');
                            }
                            
                            if (this.callSid && userTranscript) {
                                transcriptStorage.addEntry(this.callSid, 'user', userTranscript);
                                console.log(`[SimpleElevenLabs] Stored user transcript for callSid: ${this.callSid}`);
                                
                                // Emit SSE event for real-time updates
                                callEventEmitter.emit('call:transcription', {
                                    callSid: this.callSid,
                                    speaker: 'human',
                                    transcription: userTranscript,
                                    timestamp: new Date()
                                });
                            }
                            break;

                        default:
                            console.log(`[SimpleElevenLabs] Unhandled message type: ${message.type}`);
                    }
                } catch (error) {
                    console.error('[SimpleElevenLabs] Error processing message:', error);
                }
            });

            this.elevenLabsWs.on('error', (error) => {
                console.error('[SimpleElevenLabs] WebSocket error:', error);
            });

            this.elevenLabsWs.on('close', () => {
                console.log('[SimpleElevenLabs] Disconnected');
            });

        } catch (error) {
            console.error('[SimpleElevenLabs] Setup error:', error);
        }
    }

    private setupTwilioHandlers(): void {
        this.twilioWs.on('message', (message: Buffer) => {
            try {
                const msg = JSON.parse(message.toString());
                
                if (msg.event !== 'media') {
                    console.log(`[SimpleElevenLabs] Twilio event: ${msg.event}`);
                }

                switch (msg.event) {
                    case 'start':
                        this.streamSid = msg.start.streamSid;
                        this.callSid = msg.start.callSid;
                        this.customParameters = msg.start.customParameters;
                        
                        // Update call state
                        this.callState.streamSid = this.streamSid || '';
                        this.callState.callSid = this.callSid || '';
                        this.callState.fromNumber = msg.start.customParameters?.fromNumber || '';
                        this.callState.toNumber = msg.start.customParameters?.toNumber || '';
                        
                        // Set batch parameters if present
                        const batchId = msg.start.customParameters?.batchId;
                        if (batchId) {
                            this.callState.batchId = batchId;
                        }
                        
                        // Check if transcript already exists (created by makeCall)
                        let transcriptId = transcriptStorage.getTranscriptIdByCallSid(this.callSid || '');
                        
                        if (!transcriptId) {
                            // Only create if it doesn't exist (e.g., for inbound calls)
                            transcriptId = transcriptStorage.createTranscript(this.callState, batchId);
                            console.log(`[SimpleElevenLabs] Created new transcript with ID: ${transcriptId}`);
                        } else {
                            console.log(`[SimpleElevenLabs] Using existing transcript ID: ${transcriptId}`);
                        }
                        
                        this.callState.transcriptId = transcriptId;
                        
                        console.log(`[SimpleElevenLabs] Stream started - StreamSid: ${this.streamSid}, CallSid: ${this.callSid}`);
                        
                        // Emit call started event
                        callEventEmitter.emit('call:status', {
                            callSid: this.callSid,
                            status: 'connected',
                            from: this.callState.fromNumber,
                            to: this.callState.toNumber,
                            timestamp: new Date(),
                            transcriptId: transcriptId,
                            batchId: batchId
                        });
                        break;

                    case 'media':
                        if (this.elevenLabsWs?.readyState === WebSocket.OPEN) {
                            // Convert audio exactly like the working example
                            const audioMessage = {
                                user_audio_chunk: Buffer.from(msg.media.payload, "base64").toString("base64"),
                            };
                            this.elevenLabsWs.send(JSON.stringify(audioMessage));
                        } else {
                            console.log('[SimpleElevenLabs] Cannot send audio to ElevenLabs - WebSocket state:', 
                                this.elevenLabsWs?.readyState, 'OPEN=', WebSocket.OPEN);
                        }
                        break;

                    case 'stop':
                        console.log(`[SimpleElevenLabs] Stream ${this.streamSid} ended`);
                        if (this.elevenLabsWs?.readyState === WebSocket.OPEN) {
                            this.elevenLabsWs.close();
                        }
                        
                        // Finalize transcript
                        if (this.callSid) {
                            transcriptStorage.finalizeTranscript(this.callSid);
                            
                            // Update batch operation if part of batch
                            if (this.callState.batchId && this.callState.toNumber) {
                                this.batchService.completeBatchTarget(
                                    this.callState.batchId,
                                    this.callState.toNumber,
                                    this.callState.transcriptId
                                );
                            }
                            
                            // Emit call ended event
                            callEventEmitter.emit('call:ended', {
                                callSid: this.callSid,
                                duration: 0,
                                timestamp: new Date(),
                                transcriptId: this.callState.transcriptId,
                                batchId: this.callState.batchId
                            });
                        }
                        break;

                    default:
                        console.log(`[SimpleElevenLabs] Unhandled Twilio event: ${msg.event}`);
                }
            } catch (error) {
                console.error('[SimpleElevenLabs] Error processing Twilio message:', error);
            }
        });

        this.twilioWs.on('close', () => {
            console.log('[SimpleElevenLabs] Twilio disconnected');
            if (this.elevenLabsWs?.readyState === WebSocket.OPEN) {
                this.elevenLabsWs.close();
            }
        });

        this.twilioWs.on('error', (error) => {
            console.error('[SimpleElevenLabs] Twilio WebSocket error:', error);
        });
    }
}