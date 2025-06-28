import { EventEmitter } from 'events';

export interface SMSPreference {
    phoneNumber: string;
    optedIn: boolean;
    optInDate?: Date;
    optOutDate?: Date;
    lastModified: Date;
}

export class SMSPreferencesService extends EventEmitter {
    private preferences: Map<string, SMSPreference> = new Map();
    private static instance: SMSPreferencesService;

    private constructor() {
        super();
    }

    static getInstance(): SMSPreferencesService {
        if (!SMSPreferencesService.instance) {
            SMSPreferencesService.instance = new SMSPreferencesService();
        }
        return SMSPreferencesService.instance;
    }

    /**
     * Opt in a phone number for SMS notifications
     */
    optIn(phoneNumber: string): SMSPreference {
        const normalizedNumber = this.normalizePhoneNumber(phoneNumber);
        const existing = this.preferences.get(normalizedNumber);
        
        const preference: SMSPreference = {
            phoneNumber: normalizedNumber,
            optedIn: true,
            optInDate: new Date(),
            optOutDate: existing?.optOutDate,
            lastModified: new Date()
        };

        this.preferences.set(normalizedNumber, preference);
        this.emit('preference:changed', preference);
        
        return preference;
    }

    /**
     * Opt out a phone number from SMS notifications
     */
    optOut(phoneNumber: string): SMSPreference {
        const normalizedNumber = this.normalizePhoneNumber(phoneNumber);
        const existing = this.preferences.get(normalizedNumber);
        
        const preference: SMSPreference = {
            phoneNumber: normalizedNumber,
            optedIn: false,
            optInDate: existing?.optInDate,
            optOutDate: new Date(),
            lastModified: new Date()
        };

        this.preferences.set(normalizedNumber, preference);
        this.emit('preference:changed', preference);
        
        return preference;
    }

    /**
     * Check if a phone number is opted in
     */
    isOptedIn(phoneNumber: string): boolean {
        const normalizedNumber = this.normalizePhoneNumber(phoneNumber);
        const preference = this.preferences.get(normalizedNumber);
        return preference?.optedIn || false;
    }

    /**
     * Get preference for a phone number
     */
    getPreference(phoneNumber: string): SMSPreference | undefined {
        const normalizedNumber = this.normalizePhoneNumber(phoneNumber);
        return this.preferences.get(normalizedNumber);
    }

    /**
     * Get all preferences
     */
    getAllPreferences(): SMSPreference[] {
        return Array.from(this.preferences.values());
    }

    /**
     * Get all opted-in phone numbers
     */
    getOptedInNumbers(): string[] {
        return Array.from(this.preferences.values())
            .filter(pref => pref.optedIn)
            .map(pref => pref.phoneNumber);
    }

    /**
     * Clear all preferences (for testing)
     */
    clearAll(): void {
        this.preferences.clear();
        this.emit('preferences:cleared');
    }

    /**
     * Normalize phone number to E.164 format
     */
    private normalizePhoneNumber(phoneNumber: string): string {
        // Remove all non-digit characters
        let cleaned = phoneNumber.replace(/\D/g, '');
        
        // Add country code if not present (assuming US numbers)
        if (cleaned.length === 10) {
            cleaned = '1' + cleaned;
        }
        
        // Add + prefix
        if (!cleaned.startsWith('+')) {
            cleaned = '+' + cleaned;
        }
        
        return cleaned;
    }

    /**
     * Export preferences to JSON
     */
    exportToJSON(): string {
        const data = Array.from(this.preferences.entries()).map(([key, value]) => ({
            key,
            value
        }));
        return JSON.stringify(data, null, 2);
    }

    /**
     * Import preferences from JSON
     */
    importFromJSON(json: string): void {
        try {
            const data = JSON.parse(json);
            this.preferences.clear();
            
            for (const item of data) {
                if (item.key && item.value) {
                    // Convert date strings back to Date objects
                    if (item.value.optInDate) {
                        item.value.optInDate = new Date(item.value.optInDate);
                    }
                    if (item.value.optOutDate) {
                        item.value.optOutDate = new Date(item.value.optOutDate);
                    }
                    if (item.value.lastModified) {
                        item.value.lastModified = new Date(item.value.lastModified);
                    }
                    
                    this.preferences.set(item.key, item.value);
                }
            }
            
            this.emit('preferences:imported', this.preferences.size);
        } catch (error) {
            console.error('Error importing preferences:', error);
            throw new Error('Invalid preferences JSON format');
        }
    }
}

export const smsPreferences = SMSPreferencesService.getInstance();