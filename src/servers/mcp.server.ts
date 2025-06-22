import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { z } from 'zod';
import { TwilioCallService } from '../services/twilio/call.service.js';
import { TwilioSMSService } from '../services/twilio/sms.service.js';
import { transcriptStorage } from '../services/transcript-storage.service.js';
import { smsStorage } from '../services/sms-storage.service.js';
import { AIProvider } from '../types.js';
import { BatchOperationService } from '../services/batch-operation.service.js';
import { BatchCallRequest, BatchSMSRequest, BatchTarget } from '../types/batch.types.js';

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
                callContext: z.string().describe('Context for the call'),
                provider: z.enum(['openai', 'elevenlabs']).optional().describe('AI provider to use for the call (defaults to openai)'),
                ivrConfig: z.object({
                    enabled: z.boolean().optional().describe('Enable IVR navigation (defaults to true)'),
                    defaultAction: z.string().optional().describe('Default DTMF digit to press if no menu match found (defaults to "0")'),
                    timeout: z.number().optional().describe('IVR navigation timeout in milliseconds (defaults to 30000)')
                }).optional().describe('IVR navigation configuration')
            },
            async ({ toNumber, callContext, provider, ivrConfig }) => {
                try {
                    // Map string provider to enum
                    const aiProvider = provider === 'elevenlabs' ? AIProvider.ELEVENLABS : AIProvider.OPENAI;
                    
                    const callSid = await this.twilioCallService.makeCall(this.twilioCallbackUrl, toNumber, callContext, aiProvider);

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
                                provider: provider || 'openai',
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

        // Batch call tool
        this.server.tool(
            'trigger-batch-calls',
            'Trigger multiple outbound phone calls via Twilio',
            {
                provider: z.enum(['openai', 'elevenlabs']).describe('AI provider to use for the calls'),
                targets: z.array(z.object({
                    phoneNumber: z.string().describe('Phone number to call'),
                    prompt: z.string().optional().describe('Custom prompt for this specific call'),
                    context: z.string().optional().describe('Custom context for this specific call'),
                    metadata: z.record(z.any()).optional().describe('Additional metadata')
                })).describe('List of targets to call'),
                defaultPrompt: z.string().optional().describe('Default prompt to use if target has no specific prompt'),
                defaultContext: z.string().optional().describe('Default context to use if target has no specific context'),
                maxConcurrent: z.number().optional().describe('Maximum concurrent calls (default: 1)'),
                ivrConfig: z.object({
                    enabled: z.boolean().optional().describe('Enable IVR navigation (defaults to true)'),
                    defaultAction: z.string().optional().describe('Default DTMF digit to press if no menu match found (defaults to "0")'),
                    timeout: z.number().optional().describe('IVR navigation timeout in milliseconds (defaults to 30000)')
                }).optional().describe('IVR navigation configuration')
            },
            async ({ provider, targets, defaultPrompt, defaultContext, maxConcurrent }) => {
                try {
                    const aiProvider = provider === 'elevenlabs' ? AIProvider.ELEVENLABS : AIProvider.OPENAI;
                    
                    const request: BatchCallRequest = {
                        provider: aiProvider,
                        targets: targets as BatchTarget[],
                        defaultPrompt,
                        defaultContext,
                        maxConcurrent
                    };
                    
                    const batchId = await this.twilioCallService.makeBatchCalls(this.twilioCallbackUrl, request);
                    
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'success',
                                message: 'Batch calls initiated successfully',
                                batchId: batchId,
                                totalTargets: targets.length,
                                sseUrl: `${this.twilioCallbackUrl}/batch/calls/${batchId}/events`,
                                statusUrl: `${this.twilioCallbackUrl}/batch/calls/${batchId}`,
                                transcriptsUrl: `${this.twilioCallbackUrl}/batch/calls/${batchId}/transcripts`,
                                info: 'Use the batchId to track progress and retrieve transcripts'
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
                                message: `Failed to initiate batch calls: ${errorMessage}`
                            })
                        }],
                        isError: true
                    };
                }
            }
        );

        // Batch SMS tool
        this.server.tool(
            'trigger-batch-sms',
            'Send multiple SMS messages via Twilio',
            {
                targets: z.array(z.object({
                    phoneNumber: z.string().describe('Phone number to send SMS to'),
                    message: z.string().describe('SMS message content'),
                    metadata: z.record(z.any()).optional().describe('Additional metadata')
                })).describe('List of SMS messages to send'),
                maxConcurrent: z.number().optional().describe('Maximum concurrent messages (default: 1)')
            },
            async ({ targets, maxConcurrent }) => {
                try {
                    const request: BatchSMSRequest = {
                        targets: targets,
                        maxConcurrent
                    };
                    
                    const batchId = await this.twilioSMSService.sendBatchSMS(request);
                    
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'success',
                                message: 'Batch SMS initiated successfully',
                                batchId: batchId,
                                totalTargets: targets.length,
                                statusUrl: `${this.twilioCallbackUrl}/batch/sms/${batchId}`,
                                conversationsUrl: `${this.twilioCallbackUrl}/batch/sms/${batchId}/conversations`,
                                info: 'Use the batchId to track progress and retrieve conversations'
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
                                message: `Failed to send batch SMS: ${errorMessage}`
                            })
                        }],
                        isError: true
                    };
                }
            }
        );

        // Get batch status tool
        this.server.tool(
            'get-batch-status',
            'Get the status of a batch operation',
            {
                batchId: z.string().describe('The batch operation ID')
            },
            async ({ batchId }) => {
                try {
                    const batchService = BatchOperationService.getInstance();
                    const operation = batchService.getBatchOperation(batchId);
                    
                    if (!operation) {
                        return {
                            content: [{
                                type: 'text',
                                text: JSON.stringify({
                                    status: 'error',
                                    message: 'Batch operation not found'
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
                                operation: {
                                    batchId: operation.batchId,
                                    type: operation.type,
                                    status: operation.status,
                                    totalTargets: operation.totalTargets,
                                    completedTargets: operation.completedTargets,
                                    failedTargets: operation.failedTargets,
                                    createdAt: operation.createdAt,
                                    updatedAt: operation.updatedAt,
                                    progress: `${operation.completedTargets + operation.failedTargets}/${operation.totalTargets}`
                                }
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
                                message: `Failed to get batch status: ${errorMessage}`
                            })
                        }],
                        isError: true
                    };
                }
            }
        );

        // Get batch transcripts tool
        this.server.tool(
            'get-batch-transcripts',
            'Get all transcripts from a batch call operation',
            {
                batchId: z.string().describe('The batch operation ID')
            },
            async ({ batchId }) => {
                try {
                    const transcripts = transcriptStorage.getTranscriptsByBatchId(batchId);
                    const summary = transcriptStorage.getBatchTranscriptSummary(batchId);
                    
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'success',
                                batchId: batchId,
                                summary: summary,
                                transcriptCount: transcripts.length,
                                transcripts: transcripts.map(t => ({
                                    transcriptId: t.transcriptId,
                                    phoneNumber: t.to,
                                    duration: t.duration,
                                    messageCount: t.entries.length,
                                    entries: t.entries
                                }))
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
                                message: `Failed to get batch transcripts: ${errorMessage}`
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
