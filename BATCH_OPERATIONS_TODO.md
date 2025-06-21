# Batch Operations Implementation TODO

## Overview
Implement support for batch calling and SMS operations with custom prompts/contexts per target.

## Phase 1: Core Infrastructure ✅ TODO

### 1.1 Data Models & Types
- [ ] Create `src/types/batch.types.ts`
  - [ ] Define `BatchTarget` interface
  - [ ] Define `BatchCallRequest` interface
  - [ ] Define `BatchSMSRequest` interface
  - [ ] Define `BatchOperation` interface
  - [ ] Define `BatchResult` interface
  - [ ] Define `BatchTranscriptSummary` interface

### 1.2 Batch Operation Service
- [ ] Create `src/services/batch-operation.service.ts`
  - [ ] Implement singleton pattern
  - [ ] Add `createBatchOperation()` method
  - [ ] Add `updateBatchStatus()` method
  - [ ] Add `addBatchResult()` method
  - [ ] Add `getBatchOperation()` method
  - [ ] Add `listBatchOperations()` method
  - [ ] Implement in-memory storage with Map

### 1.3 Enhanced Transcript Storage
- [ ] Update `src/services/transcript-storage.service.ts`
  - [ ] Add `batchId` field to `StoredTranscript`
  - [ ] Add `getTranscriptsByBatchId()` method
  - [ ] Add `getBatchTranscriptSummary()` method
  - [ ] Update `createTranscript()` to accept optional batchId

## Phase 2: Voice Call Integration

### 2.1 Update Call State & Types
- [ ] Update `src/types/call.types.ts`
  - [ ] Add `batchId` to `CallState`
  - [ ] Add `customPrompt` to `CallState`
  - [ ] Add `customContext` to `CallState`

### 2.2 Enhance Prompt Generation
- [ ] Update `src/config/prompts.ts`
  - [ ] Modify `generateOutboundCallContext()` to accept custom prompt/context
  - [ ] Add fallback to default prompt logic
  - [ ] Support context injection in system message

### 2.3 Update Call Service
- [ ] Update `src/services/twilio/call.service.ts`
  - [ ] Modify `makeCall()` to accept batch parameters
  - [ ] Add `makeBatchCalls()` method
  - [ ] Implement rate limiting (1 call/second)
  - [ ] Add queue management for batch calls
  - [ ] Track batch progress

### 2.4 Update OpenAI Handler
- [ ] Update `src/services/calls/openai-call-handler.ts`
  - [ ] Pass custom prompt/context to prompt generator
  - [ ] Include batch ID in events
  - [ ] Update SSE events with batch info

### 2.5 Update ElevenLabs Handler
- [ ] Update `src/services/calls/simple-elevenlabs-handler.ts`
  - [ ] Support dynamic prompt override
  - [ ] Support dynamic first message override
  - [ ] Include batch ID in events
  - [ ] Handle per-call agent selection

## Phase 3: SMS Integration

### 3.1 Enhance SMS Service
- [ ] Update `src/services/twilio/sms.service.ts`
  - [ ] Add `sendBatchSMS()` method
  - [ ] Implement rate limiting
  - [ ] Add batch tracking support
  - [ ] Handle templated messages

### 3.2 Update SMS Storage
- [ ] Update `src/services/sms-storage.service.ts`
  - [ ] Add batch ID support to conversations
  - [ ] Add `getConversationsByBatchId()` method
  - [ ] Track batch SMS operations

## Phase 4: API Endpoints

### 4.1 Batch Call Endpoints
- [ ] Update `src/servers/voice.server.ts`
  - [ ] Add `POST /batch/calls` endpoint
  - [ ] Add `GET /batch/calls/:batchId` endpoint
  - [ ] Add `GET /batch/calls/:batchId/transcripts` endpoint
  - [ ] Add `GET /batch/calls/:batchId/events` SSE endpoint

### 4.2 Batch SMS Endpoints
- [ ] Update `src/servers/voice.server.ts`
  - [ ] Add `POST /batch/sms` endpoint
  - [ ] Add `GET /batch/sms/:batchId` endpoint
  - [ ] Add `GET /batch/sms/:batchId/conversations` endpoint

### 4.3 Request Validation
- [ ] Create validation schemas for batch requests
- [ ] Add input validation middleware
- [ ] Validate phone number formats
- [ ] Validate batch size limits

## Phase 5: MCP Tool Integration

### 5.1 Update MCP Server
- [ ] Update `src/servers/mcp.server.ts`
  - [ ] Add `trigger-batch-calls` tool
  - [ ] Add `trigger-batch-sms` tool
  - [ ] Add `get-batch-status` tool
  - [ ] Add `get-batch-transcripts` tool

### 5.2 Update MCP Types
- [ ] Add batch operation schemas
- [ ] Update tool descriptions
- [ ] Add example usage in tool descriptions

## Phase 6: Error Handling & Recovery

### 6.1 Implement Retry Logic
- [ ] Add exponential backoff for failed calls
- [ ] Implement max retry limits
- [ ] Track retry attempts in BatchResult

### 6.2 Error Reporting
- [ ] Detailed error messages per target
- [ ] Aggregate error statistics
- [ ] SSE events for errors

### 6.3 Partial Completion Handling
- [ ] Support continuing failed batches
- [ ] Mark individual failures vs batch failures
- [ ] Provide detailed failure reports

## Phase 7: Testing & Documentation

### 7.1 Create Test Scripts
- [ ] Create `test-batch-calls.ts`
- [ ] Create `test-batch-sms.ts`
- [ ] Add integration tests
- [ ] Test error scenarios

### 7.2 Update Documentation
- [ ] Update README with batch operations
- [ ] Add API documentation for new endpoints
- [ ] Create example scripts
- [ ] Document rate limits and best practices

## Phase 8: Monitoring & Analytics

### 8.1 Batch Metrics
- [ ] Track success rates
- [ ] Monitor average call duration
- [ ] Calculate costs per batch
- [ ] Performance metrics

### 8.2 Logging
- [ ] Add detailed batch operation logs
- [ ] Include timing information
- [ ] Log rate limit violations

## Implementation Order

1. **Day 1**: Phase 1 (Core Infrastructure)
2. **Day 2**: Phase 2 (Voice Call Integration)
3. **Day 3**: Phase 3 (SMS Integration) + Phase 4 (API Endpoints)
4. **Day 4**: Phase 5 (MCP Integration) + Phase 6 (Error Handling)
5. **Day 5**: Phase 7 (Testing) + Phase 8 (Monitoring)

## Success Criteria

- [ ] Can initiate batch calls with different prompts per number
- [ ] Can send batch SMS with different messages per number
- [ ] Transcripts are properly associated with batch operations
- [ ] Real-time updates via SSE for batch progress
- [ ] Proper error handling and recovery
- [ ] Rate limiting prevents API throttling
- [ ] MCP tools work seamlessly with batch operations
- [ ] All existing functionality remains intact

## Notes

- Maintain backward compatibility with existing single-call APIs
- Use TypeScript strict mode for new code
- Follow existing code patterns and conventions
- Add comprehensive error messages for debugging
- Consider memory usage for large batches
- Test with various batch sizes (1, 10, 100+ targets)