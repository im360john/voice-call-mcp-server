import { v4 as uuidv4 } from 'uuid';
import { SMSMessage } from './twilio/sms.service.js';

export interface SMSConversation {
    id: string;
    phoneNumber: string;
    messages: SMSMessage[];
    createdAt: Date;
    updatedAt: Date;
}

export interface ConversationSummary {
    id: string;
    phoneNumber: string;
    messageCount: number;
    lastMessage: string;
    lastMessageTime: Date;
}

class SMSStorageService {
    private conversations: Map<string, SMSConversation> = new Map();
    private phoneToConversationId: Map<string, string> = new Map();

    addMessage(message: SMSMessage): string {
        const phoneNumber = message.direction === 'inbound' ? message.from : message.to;
        
        let conversationId = this.phoneToConversationId.get(phoneNumber);
        let conversation: SMSConversation;

        if (!conversationId) {
            conversationId = uuidv4();
            conversation = {
                id: conversationId,
                phoneNumber,
                messages: [],
                createdAt: new Date(),
                updatedAt: new Date()
            };
            this.conversations.set(conversationId, conversation);
            this.phoneToConversationId.set(phoneNumber, conversationId);
        } else {
            conversation = this.conversations.get(conversationId)!;
            conversation.updatedAt = new Date();
        }

        conversation.messages.push(message);
        
        return conversationId;
    }

    getConversation(conversationId: string): SMSConversation | null {
        return this.conversations.get(conversationId) || null;
    }

    getConversationByPhone(phoneNumber: string): SMSConversation | null {
        const conversationId = this.phoneToConversationId.get(phoneNumber);
        if (!conversationId) return null;
        return this.getConversation(conversationId);
    }

    getAllConversations(): ConversationSummary[] {
        const summaries: ConversationSummary[] = [];
        
        this.conversations.forEach((conversation) => {
            const lastMessage = conversation.messages[conversation.messages.length - 1];
            if (lastMessage) {
                summaries.push({
                    id: conversation.id,
                    phoneNumber: conversation.phoneNumber,
                    messageCount: conversation.messages.length,
                    lastMessage: lastMessage.body.substring(0, 50) + (lastMessage.body.length > 50 ? '...' : ''),
                    lastMessageTime: lastMessage.timestamp
                });
            }
        });

        return summaries.sort((a, b) => b.lastMessageTime.getTime() - a.lastMessageTime.getTime());
    }

    getConversationSummary(conversationId: string): string {
        const conversation = this.getConversation(conversationId);
        if (!conversation) return 'Conversation not found';

        const messageCount = conversation.messages.length;
        const inboundCount = conversation.messages.filter(m => m.direction === 'inbound').length;
        const outboundCount = conversation.messages.filter(m => m.direction === 'outbound').length;

        let summary = `SMS Conversation with ${conversation.phoneNumber}\n`;
        summary += `Total messages: ${messageCount} (${inboundCount} received, ${outboundCount} sent)\n`;
        summary += `Started: ${conversation.createdAt.toLocaleString()}\n`;
        summary += `Last activity: ${conversation.updatedAt.toLocaleString()}\n\n`;
        summary += `Recent messages:\n`;

        const recentMessages = conversation.messages.slice(-10);
        recentMessages.forEach(msg => {
            const direction = msg.direction === 'inbound' ? 'From' : 'To';
            const phone = msg.direction === 'inbound' ? msg.from : msg.to;
            summary += `[${msg.timestamp.toLocaleTimeString()}] ${direction} ${phone}: ${msg.body}\n`;
        });

        return summary;
    }

    clearConversation(conversationId: string): boolean {
        const conversation = this.conversations.get(conversationId);
        if (!conversation) return false;

        this.phoneToConversationId.delete(conversation.phoneNumber);
        this.conversations.delete(conversationId);
        return true;
    }

    clearAllConversations(): void {
        this.conversations.clear();
        this.phoneToConversationId.clear();
    }
}

export const smsStorage = new SMSStorageService();