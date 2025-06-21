export interface BatchTarget {
  phoneNumber: string;
  prompt?: string;
  context?: string;
  metadata?: Record<string, any>;
}

export interface BatchCallRequest {
  provider: 'openai' | 'elevenlabs';
  targets: BatchTarget[];
  defaultPrompt?: string;
  defaultContext?: string;
  agentId?: string;
  maxConcurrent?: number;
}

export interface BatchSMSRequest {
  targets: Array<{
    phoneNumber: string;
    message: string;
    metadata?: Record<string, any>;
  }>;
  maxConcurrent?: number;
}

export type BatchOperationType = 'call' | 'sms';
export type BatchOperationStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'partial_complete';
export type BatchResultStatus = 'success' | 'failed' | 'in_progress' | 'queued' | 'retrying';

export interface BatchOperation {
  batchId: string;
  type: BatchOperationType;
  status: BatchOperationStatus;
  totalTargets: number;
  completedTargets: number;
  failedTargets: number;
  results: BatchResult[];
  createdAt: Date;
  updatedAt: Date;
  config?: {
    provider?: 'openai' | 'elevenlabs';
    defaultPrompt?: string;
    defaultContext?: string;
    agentId?: string;
    maxConcurrent?: number;
  };
}

export interface BatchResult {
  phoneNumber: string;
  status: BatchResultStatus;
  callSid?: string;
  transcriptId?: string;
  messageSid?: string;
  conversationId?: string;
  error?: string;
  retryCount?: number;
  startTime: Date;
  endTime?: Date;
  metadata?: Record<string, any>;
}

export interface BatchTranscriptSummary {
  batchId: string;
  totalCalls: number;
  completedCalls: number;
  failedCalls: number;
  averageDuration: number;
  transcripts: Array<{
    transcriptId: string;
    phoneNumber: string;
    duration: number;
    messageCount: number;
    summary?: string;
  }>;
}

export interface BatchSMSSummary {
  batchId: string;
  totalMessages: number;
  sentMessages: number;
  failedMessages: number;
  conversations: Array<{
    conversationId: string;
    phoneNumber: string;
    messageCount: number;
  }>;
}

export interface BatchEventData {
  batchId: string;
  type: 'progress' | 'complete' | 'error' | 'result';
  data: {
    currentProgress?: number;
    totalTargets?: number;
    result?: BatchResult;
    error?: string;
    status?: BatchOperationStatus;
  };
}