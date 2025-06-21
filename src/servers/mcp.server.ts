import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { z } from 'zod';
import { TwilioCallService } from '../services/twilio/call.service.js';
import { TwilioSMSService } from '../services/twilio/sms.service.js';
import { transcriptStorage } from '../services/transcript-storage.service.js';
import { smsStorage } from '../services/sms-storage.service.js';

export class VoiceCallMcpServer {
    private server: McpServer;
    private twilioCallService: TwilioCallService;
    private twilioSMSService: TwilioSMSService;
    private twilioCallbackUrl: string;

    constructor(twilioCallService: TwilioCallService, twilioSMSService: TwilioSMSService, twilioCallbackUrl: string) {
        this.twilioCallbackUrl = twilioCallbackUrl;
        this.twilioCallService = twilioCallService;
        this.twilioSMSService = twilioSMSService;

        this.server = new McpServer({
            name: 'Voice Call & SMS MCP Server',
            version: '1.1.0',
            description: 'MCP server that provides tools for initiating phone calls and sending SMS messages via Twilio'
        });

        this.registerTools();
        this.registerResources();
        this.registerPrompts();
    }

    private registerTools(): void {
        this.server.tool(
            'trigger-call',
            'Trigger an outbound phone call via Twilio',
            {
                toNumber: z.string().describe('The phone number to call'),
                callContext: z.string().describe('Context for the call')
            },
            async ({ toNumber, callContext }) => {
                try {
                    const callSid = await this.twilioCallService.makeCall(this.twilioCallbackUrl, toNumber, callContext);

                    // Get transcript ID for this call
                    const transcriptId = transcriptStorage.getTranscriptIdByCallSid(callSid);

                    // Construct SSE URL
                    const sseUrl = `${this.twilioCallbackUrl}/events?callSid=${callSid}`;

                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'success',
                                message: 'Call triggered successfully',
                                callSid: callSid,
                                transcriptId: transcriptId,
                                sseUrl: sseUrl,
                                info: 'Connect to the SSE URL to receive real-time call updates and transcriptions. Use the transcriptId to retrieve the transcript later.'
                            })
                        }]
                    };
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);

                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'error',
                                message: `Failed to trigger call: ${errorMessage}`
                            })
                        }],
                        isError: true
                    };
                }
            }
        );

        this.server.tool(
            'get-transcript',
            'Retrieve a call transcript by its ID',
            {
                transcriptId: z.string().describe('The ID of the transcript to retrieve')
            },
            async ({ transcriptId }) => {
                try {
                    const transcript = transcriptStorage.getTranscript(transcriptId);
                    
                    if (!transcript) {
                        return {
                            content: [{
                                type: 'text',
                                text: JSON.stringify({
                                    status: 'error',
                                    message: 'Transcript not found'
                                })
                            }],
                            isError: true
                        };
                    }

                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'success',
                                transcript: transcript
                            })
                        }]
                    };
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);

                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'error',
                                message: `Failed to retrieve transcript: ${errorMessage}`
                            })
                        }],
                        isError: true
                    };
                }
            }
        );

        this.server.tool(
            'get-transcript-summary',
            'Generate a summary of a call transcript',
            {
                transcriptId: z.string().describe('The ID of the transcript to summarize')
            },
            async ({ transcriptId }) => {
                try {
                    const summary = transcriptStorage.generateSummary(transcriptId);
                    
                    if (!summary) {
                        return {
                            content: [{
                                type: 'text',
                                text: JSON.stringify({
                                    status: 'error',
                                    message: 'Transcript not found'
                                })
                            }],
                            isError: true
                        };
                    }

                    return {
                        content: [{
                            type: 'text',
                            text: summary
                        }]
                    };
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);

                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'error',
                                message: `Failed to generate summary: ${errorMessage}`
                            })
                        }],
                        isError: true
                    };
                }
            }
        );

        this.server.tool(
            'send-sms',
            'Send an SMS message via Twilio',
            {
                toNumber: z.string().describe('The phone number to send the SMS to'),
                message: z.string().describe('The text message to send')
            },
            async ({ toNumber, message }) => {
                try {
                    const smsMessage = await this.twilioSMSService.sendSMS(toNumber, message);
                    const conversationId = smsStorage.addMessage(smsMessage);
                    
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'success',
                                message: 'SMS sent successfully',
                                messageSid: smsMessage.messageSid,
                                conversationId: conversationId,
                                sseUrl: `${this.twilioCallbackUrl}/sms/events?conversationId=${conversationId}`,
                                info: 'Use the conversationId to retrieve the conversation history'
                            })
                        }]
                    };
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'error',
                                message: `Failed to send SMS: ${errorMessage}`
                            })
                        }],
                        isError: true
                    };
                }
            }
        );

        this.server.tool(
            'get-sms-conversation',
            'Retrieve an SMS conversation by ID',
            {
                conversationId: z.string().describe('The ID of the conversation to retrieve')
            },
            async ({ conversationId }) => {
                try {
                    const conversation = smsStorage.getConversation(conversationId);
                    
                    if (!conversation) {
                        return {
                            content: [{
                                type: 'text',
                                text: JSON.stringify({
                                    status: 'error',
                                    message: 'Conversation not found'
                                })
                            }],
                            isError: true
                        };
                    }
                    
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'success',
                                conversation: conversation
                            })
                        }]
                    };
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'error',
                                message: `Failed to retrieve conversation: ${errorMessage}`
                            })
                        }],
                        isError: true
                    };
                }
            }
        );

        this.server.tool(
            'list-sms-conversations',
            'List all SMS conversations',
            {},
            async () => {
                try {
                    const conversations = smsStorage.getAllConversations();
                    
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'success',
                                conversations: conversations
                            })
                        }]
                    };
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'error',
                                message: `Failed to list conversations: ${errorMessage}`
                            })
                        }],
                        isError: true
                    };
                }
            }
        );
    }

    private registerResources(): void {
        this.server.resource(
            'get-latest-call',
            new ResourceTemplate('call://transcriptions', { list: undefined }),
            async () => {
                // TODO: get call transcription
                return {
                    contents: [{
                        text: JSON.stringify({
                            transcription: '{}',
                            status: 'completed',
                        }),
                        uri: 'call://transcriptions/latest',
                        mimeType: 'application/json'
                    }]
                };
            }
        );
    }

    private registerPrompts(): void {
        this.server.prompt(
            'make-restaurant-reservation',
            'Create a prompt for making a restaurant reservation by phone',
            {
                restaurantNumber: z.string().describe('The phone number of the restaurant'),
                peopleNumber: z.string().describe('The number of people in the party'),
                date: z.string().describe('Date of the reservation'),
                time: z.string().describe('Preferred time for the reservation')
            },
            ({ restaurantNumber, peopleNumber, date, time }) => {
                return {
                    messages: [{
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `You are calling a restaurant to book a table for ${peopleNumber} people on ${date} at ${time}. Call the restaurant at ${restaurantNumber} from ${process.env.TWILIO_NUMBER}.`
                        }
                    }]
                };
            }
        );
    }

    public async start(): Promise<void> {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
    }

    public async connectTransport(transport: Transport): Promise<void> {
        await this.server.connect(transport);
    }
}
