import { CallState, AIProvider } from '../types.js';
import { callEventEmitter } from './sse.service.js';
import { ProviderSwitchService } from './provider-switch.service.js';
import { WebSocket } from 'ws';

/**
 * Service for monitoring human detection and triggering provider switches
 */
export class HumanDetectionService {
    constructor(
        private providerSwitchService: ProviderSwitchService
    ) {
        this.setupEventListeners();
    }

    /**
     * Set up event listeners for human detection
     */
    private setupEventListeners(): void {
        // Listen for human detection events from IVR navigation
        callEventEmitter.on('humanDetected', async (event: any) => {
            await this.handleHumanDetection(event);
        });

        // Listen for AMD status updates
        callEventEmitter.on('amdStatus', async (event: any) => {
            await this.handleAMDStatus(event);
        });
    }

    /**
     * Handle human detection event
     */
    private async handleHumanDetection(event: {
        callSid: string;
        afterMenuLevels: number;
        actionsToken: string[];
    }): Promise<void> {
        console.log(`[HumanDetection] Human detected for call ${event.callSid}`);
        
        // Get call state and check if we need to switch providers
        const callState = await this.getCallState(event.callSid);
        if (!callState) {
            console.error(`[HumanDetection] No call state found for ${event.callSid}`);
            return;
        }

        // If original provider was ElevenLabs and we're currently on OpenAI, switch back
        if (callState.ivrState.originalProvider === AIProvider.ELEVENLABS &&
            callState.ivrState.currentProvider === AIProvider.OPENAI) {
            
            console.log(`[HumanDetection] Switching from OpenAI to ElevenLabs for call ${event.callSid}`);
            
            // Get the Twilio WebSocket for this call
            const twilioWs = await this.getTwilioWebSocket(event.callSid);
            if (twilioWs) {
                const success = await this.providerSwitchService.switchToElevenLabs(
                    callState,
                    twilioWs
                );
                
                if (success) {
                    console.log(`[HumanDetection] Successfully switched to ElevenLabs for call ${event.callSid}`);
                } else {
                    console.error(`[HumanDetection] Failed to switch to ElevenLabs for call ${event.callSid}`);
                }
            }
        }
    }

    /**
     * Handle AMD status update
     */
    private async handleAMDStatus(event: {
        callSid: string;
        answeredBy: string;
        callStatus: string;
    }): Promise<void> {
        console.log(`[HumanDetection] AMD status for call ${event.callSid}: ${event.answeredBy}`);
        
        // If human detected via AMD, trigger human detection flow
        if (event.answeredBy.toLowerCase() === 'human') {
            await this.handleHumanDetection({
                callSid: event.callSid,
                afterMenuLevels: 0,
                actionsToken: []
            });
        }
    }

    /**
     * Get call state from storage or session manager
     * This is a placeholder - would need to be integrated with actual storage
     */
    private async getCallState(callSid: string): Promise<CallState | null> {
        // This would be retrieved from the session manager or storage
        // For now, emit an event to request the call state
        return new Promise((resolve) => {
            callEventEmitter.emit('requestCallState', { callSid }, (callState: CallState | null) => {
                resolve(callState);
            });
        });
    }

    /**
     * Get Twilio WebSocket for a call
     * This is a placeholder - would need to be integrated with session manager
     */
    private async getTwilioWebSocket(callSid: string): Promise<WebSocket | null> {
        // This would be retrieved from the session manager
        return new Promise((resolve) => {
            callEventEmitter.emit('requestTwilioWebSocket', { callSid }, (ws: WebSocket | null) => {
                resolve(ws);
            });
        });
    }
}