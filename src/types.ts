// state.ts - Shared state variables
export enum CallType {
    OUTBOUND = 'OUTBOUND',
}

export interface ConversationMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
    name?: string;
}

export class CallState {
    // Call identification
    streamSid = '';
    callSid = '';
    transcriptId = '';

    // Call type and direction
    callType: CallType = CallType.OUTBOUND;

    // Phone numbers
    fromNumber = '';
    toNumber = '';

    // Call context and conversation
    callContext = '';
    initialMessage = '';
    conversationHistory: ConversationMessage[] = [];

    // Speech state
    speaking = false;

    // Timing and processing state
    llmStart = 0;
    firstByte = true;
    sendFirstSentenceInputTime: number | null = null;

    // Media processing state
    latestMediaTimestamp = 0;
    responseStartTimestampTwilio: number | null = null;
    lastAssistantItemId: string | null = null;
    markQueue: string[] = [];
    hasSeenMedia = false;

    constructor(callType: CallType = CallType.OUTBOUND) {
        this.callType = callType;
    }
}

/**
 * Configuration for the OpenAI WebSocket connection
 */
export interface OpenAIConfig {
    apiKey: string;
    websocketUrl: string;
    voice: string;
    temperature: number;
}

/**
 * Configuration for Twilio client
 */
export interface TwilioConfig {
    accountSid: string;
    authToken: string;
    recordCalls: boolean;
}

/**
 * AI Provider types
 */
export enum AIProvider {
    OPENAI = 'openai',
    ELEVENLABS = 'elevenlabs'
}

/**
 * Configuration for ElevenLabs
 */
export interface ElevenLabsConfig {
    apiKey: string;
    agentId: string;
    prompt?: string;
    firstMessage?: string;
}

/**
 * ElevenLabs WebSocket message types
 */
export interface ElevenLabsMessage {
    type: string;
    ping_event?: {
        event_id: string;
    };
    audio?: {
        chunk?: string;
    } | string;
    audio_event?: {
        audio_base_64: string;
        track_id?: string;
        sample_rate?: number;
        channels?: number;
    };
    [key: string]: any;
}

export interface ElevenLabsAudioEvent {
    audio_event: {
        audio_base_64: string;
        track_id: string;
        sample_rate: number;
        channels: number;
    };
}

export interface ElevenLabsTranscript {
    transcript: string;
    timestamp: Date;
}

export interface ElevenLabsAgentResponse {
    agent_response: string;
    timestamp: Date;
}

export interface ElevenLabsUserTranscript {
    user_transcript: string;
    timestamp: Date;
}
