import { CallState, IVRRule, IVRConfig } from '../types.js';
import { callEventEmitter } from './sse.service.js';

/**
 * Default IVR configuration
 */
export const DEFAULT_IVR_CONFIG: IVRConfig = {
    enabled: true,
    maxMenuDepth: 5,
    humanPhrases: [
        'how can i help',
        'how may i assist',
        'what can i do for you',
        'speaking',
        'this is',
        'hello',
        'good morning',
        'good afternoon',
        'good evening'
    ],
    defaultAction: '0',
    timeout: 30000 // 30 seconds
};

/**
 * Common IVR navigation rules
 */
export const COMMON_IVR_RULES: IVRRule[] = [
    // Operator/Human options
    { pattern: /press\s*0\s*for\s*(operator|representative|agent|customer\s*service)/i, action: '0', confidence: 0.9 },
    { pattern: /press\s*0\s*to\s*speak/i, action: '0', confidence: 0.9 },
    { pattern: /operator.*press\s*0/i, action: '0', confidence: 0.9 },
    
    // Common menu options
    { pattern: /press\s*1\s*for\s*sales/i, action: '1', confidence: 0.8 },
    { pattern: /press\s*2\s*for\s*(support|technical|customer\s*service)/i, action: '2', confidence: 0.8 },
    { pattern: /press\s*3\s*for\s*billing/i, action: '3', confidence: 0.8 },
    { pattern: /press\s*9\s*to\s*repeat/i, action: '9', confidence: 0.7 },
    
    // Skip options
    { pattern: /press\s*\*\s*to\s*skip/i, action: '*', confidence: 0.7 },
    { pattern: /press\s*#\s*to\s*continue/i, action: '#', confidence: 0.7 },
    
    // Language options (usually we want English)
    { pattern: /for\s*english.*press\s*1/i, action: '1', confidence: 0.9 },
    { pattern: /para\s*español.*oprima\s*2/i, action: '1', confidence: 0.9 }, // Choose English
];

/**
 * Service for managing IVR navigation
 */
export class IVRNavigationService {
    private ivrTimeouts = new Map<string, NodeJS.Timeout>();
    
    constructor(
        private config: IVRConfig = DEFAULT_IVR_CONFIG
    ) {}

    /**
     * Process transcribed text for IVR options
     */
    processTranscript(callState: CallState, transcript: string): IVRRule | null {
        // Check if we're in IVR navigation mode
        if (!callState.ivrState.isNavigating) {
            // Check if this might be an IVR system
            if (this.detectIVRSystem(transcript)) {
                this.enterIVRMode(callState);
            } else if (this.detectHuman(transcript)) {
                this.detectHumanAgent(callState);
                return null;
            }
        }

        // If we're navigating, look for menu options
        if (callState.ivrState.isNavigating) {
            const rule = this.findMatchingRule(transcript);
            if (rule) {
                callState.ivrState.optionsHeard.push(transcript.substring(0, 50));
                callState.ivrState.actionsToken.push(rule.action);
                
                // Emit IVR option detected event
                callEventEmitter.emit('ivrOptionDetected', {
                    callSid: callState.callSid,
                    transcript,
                    action: rule.action,
                    confidence: rule.confidence
                });

                return rule;
            }

            // Check if human detected while in IVR mode
            if (this.detectHuman(transcript)) {
                this.detectHumanAgent(callState);
            }
        }

        return null;
    }

    /**
     * Detect if the transcript indicates an IVR system
     */
    private detectIVRSystem(transcript: string): boolean {
        const ivrIndicators = [
            /thank\s*you\s*for\s*calling/i,
            /press\s*\d+\s*(for|to)/i,
            /main\s*menu/i,
            /please\s*listen\s*carefully/i,
            /menu\s*options\s*have\s*changed/i,
            /for\s*.*press\s*\d+/i,
            /to\s*.*press\s*\d+/i
        ];

        return ivrIndicators.some(pattern => pattern.test(transcript));
    }

    /**
     * Detect if the transcript indicates a human agent
     */
    private detectHuman(transcript: string): boolean {
        const lowerTranscript = transcript.toLowerCase();
        
        // Check for human phrases
        const hasHumanPhrase = this.config.humanPhrases.some(phrase => 
            lowerTranscript.includes(phrase.toLowerCase())
        );

        // Additional human detection patterns
        const humanPatterns = [
            /^(hi|hello|hey)\s*,?\s*my\s*name\s*is/i,
            /this\s*is\s*\w+\s*(speaking|here)/i,
            /(yes|no)\s*,?\s*(how\s*can|what\s*can)/i,
            /i\s*can\s*help\s*you\s*with/i
        ];

        const hasHumanPattern = humanPatterns.some(pattern => pattern.test(transcript));

        return hasHumanPhrase || hasHumanPattern;
    }

    /**
     * Find matching IVR rule for the transcript
     */
    private findMatchingRule(transcript: string): IVRRule | null {
        let bestMatch: IVRRule | null = null;
        let highestConfidence = 0;

        for (const rule of COMMON_IVR_RULES) {
            if (rule.pattern.test(transcript)) {
                const confidence = rule.confidence || 0.5;
                if (confidence > highestConfidence) {
                    bestMatch = rule;
                    highestConfidence = confidence;
                }
            }
        }

        return bestMatch;
    }

    /**
     * Enter IVR navigation mode
     */
    private enterIVRMode(callState: CallState): void {
        callState.ivrState.isNavigating = true;
        callState.ivrState.menuLevel++;
        
        // Set timeout for IVR navigation
        this.setIVRTimeout(callState);

        callEventEmitter.emit('ivrModeEntered', {
            callSid: callState.callSid,
            menuLevel: callState.ivrState.menuLevel
        });

        console.log(`Call ${callState.callSid} entered IVR mode at level ${callState.ivrState.menuLevel}`);
    }

    /**
     * Detect human agent and update state
     */
    private detectHumanAgent(callState: CallState): void {
        callState.ivrState.humanDetected = true;
        callState.ivrState.isNavigating = false;
        
        // Clear any IVR timeout
        this.clearIVRTimeout(callState.callSid);

        callEventEmitter.emit('humanDetected', {
            callSid: callState.callSid,
            afterMenuLevels: callState.ivrState.menuLevel,
            actionsToken: callState.ivrState.actionsToken
        });

        console.log(`Human detected on call ${callState.callSid} after ${callState.ivrState.menuLevel} menu levels`);
    }

    /**
     * Set timeout for IVR navigation
     */
    private setIVRTimeout(callState: CallState): void {
        // Clear existing timeout
        this.clearIVRTimeout(callState.callSid);

        // Set new timeout
        const timeout = setTimeout(() => {
            if (callState.ivrState.isNavigating && !callState.ivrState.humanDetected) {
                console.log(`IVR timeout reached for call ${callState.callSid}, trying default action`);
                
                // Emit timeout event with default action
                callEventEmitter.emit('ivrTimeout', {
                    callSid: callState.callSid,
                    defaultAction: this.config.defaultAction
                });
            }
        }, this.config.timeout);

        this.ivrTimeouts.set(callState.callSid, timeout);
    }

    /**
     * Clear IVR timeout
     */
    private clearIVRTimeout(callSid: string): void {
        const timeout = this.ivrTimeouts.get(callSid);
        if (timeout) {
            clearTimeout(timeout);
            this.ivrTimeouts.delete(callSid);
        }
    }

    /**
     * Generate context message for AI about IVR navigation
     */
    generateIVRContext(callState: CallState): string {
        if (!callState.ivrState.isNavigating) {
            return '';
        }

        let context = 'You are currently navigating an automated phone system (IVR). ';
        context += 'Listen carefully for menu options. ';
        context += 'When you hear an option to reach a human (like "press 0 for operator"), ';
        context += 'respond with "I\'ll connect you to an agent now" and the system will press the appropriate key. ';
        
        if (callState.ivrState.menuLevel > 2) {
            context += 'If the menu is getting complex, you can try pressing 0 to reach an operator. ';
        }

        return context;
    }

    /**
     * Clean up resources for a call
     */
    cleanup(callSid: string): void {
        this.clearIVRTimeout(callSid);
    }
}