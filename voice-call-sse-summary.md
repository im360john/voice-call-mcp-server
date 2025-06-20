# Voice Call MCP Server - SSE Implementation Summary

## Project Overview

**Repository**: https://github.com/popcornspace/voice-call-mcp-server

**Purpose**: A Model Context Protocol (MCP) server that enables AI assistants (like Claude) to initiate and manage voice calls using Twilio and OpenAI's GPT-4o Realtime model.

## Current Architecture (No SSE)

### How It Currently Works

1. **AI Assistant → MCP Server**: Uses standard MCP protocol (stdio/JSON-RPC)
2. **MCP Server → Twilio**: Initiates calls via Twilio API
3. **Twilio → MCP Server**: Sends webhooks for call events (HTTP POST)
4. **MCP Server ↔ OpenAI**: WebSocket connection for real-time audio processing
5. **ngrok**: Exposes local server to receive Twilio webhooks

### Current Flow Diagram
```
AI Assistant (Claude) --[MCP Protocol]--> MCP Server
                                            |
                                            ├--[HTTP API]--> Twilio
                                            |                   |
                                            |                   v
                                            |               Phone Call
                                            |                   |
                                            ├--[WebSocket]---> OpenAI Realtime
                                            |
                                            └--[ngrok tunnel]-- Webhooks from Twilio
```

### Key Files Structure (Inferred)
```
voice-call-mcp-server/
├── src/
│   ├── start-all.ts       # Main entry point
│   ├── mcp-server.ts      # MCP server implementation
│   ├── twilio-handler.ts  # Twilio webhook handlers
│   └── openai-handler.ts  # OpenAI realtime integration
├── dist/
│   └── start-all.cjs      # Compiled output
└── package.json
```

## SSE Implementation Requirements

### Goal
Add Server-Sent Events (SSE) to provide real-time updates about call status, transcriptions, and events to MCP clients without polling.

### Benefits of Adding SSE
1. **Real-time Updates**: Instant call status changes and transcriptions
2. **No Polling Required**: More efficient than repeated status checks
3. **Better UX**: AI assistants can provide live feedback during calls
4. **Scalability**: SSE is lightweight for one-way server-to-client communication
5. **Simple Integration**: Works alongside existing MCP protocol

## Implementation Plan

### 1. Dependencies to Add
```json
{
  "dependencies": {
    "express": "^4.18.0",
    "cors": "^2.8.5",
    "uuid": "^9.0.0"
  }
}
```

### 2. New Files to Create

#### `src/sse-handler.ts`
```typescript
// Manages SSE connections and event broadcasting
export class SSEManager {
  private clients: Map<string, Response>
  addClient(clientId: string, res: Response): void
  broadcast(event: string, data: any): void
  sendToClient(clientId: string, event: string, data: any): void
}

// Event emitter for call events
export const callEventEmitter: EventEmitter

// Express route handler
export function handleSSE(req: Request, res: Response): void
```

#### `src/express-server.ts`
```typescript
// Express server setup with SSE endpoint
const app = express()
app.get('/events', handleSSE)
app.listen(3000)
```

### 3. Modifications to Existing Files

#### Update `src/start-all.ts`
- Import and start Express server alongside MCP server
- Ensure both servers start correctly

#### Update `src/twilio-handler.ts`
- Add event emissions for call status changes:
```typescript
callEventEmitter.emit('call:status', {
  callSid, status, from, to, timestamp
})
```

#### Update `src/openai-handler.ts`
- Add event emissions for transcriptions:
```typescript
callEventEmitter.emit('call:transcription', {
  callSid, transcription, timestamp
})
```

#### Update MCP Tool Response
- Include SSE URL in call initiation response:
```typescript
return {
  success: true,
  callSid,
  message: `Call initiated to ${number}`,
  sseUrl: `${publicUrl}/events?clientId=${callSid}`,
  status: 'initiating'
}
```

### 4. SSE Event Types

```typescript
// Event types to implement
type SSEEvents = {
  'connected': { clientId: string }
  'call-status': { callSid: string, status: string, from: string, to: string }
  'transcription': { callSid: string, transcription: string, speaker: 'ai' | 'human' }
  'call-ended': { callSid: string, duration: number, recordingUrl?: string }
  'error': { callSid: string, error: string, code: string }
}
```

### 5. Client Usage Example

```javascript
// How MCP clients would use the SSE endpoint
const eventSource = new EventSource(sseUrl);

eventSource.addEventListener('call-status', (event) => {
  const data = JSON.parse(event.data);
  console.log(`Call ${data.callSid} status: ${data.status}`);
});

eventSource.addEventListener('transcription', (event) => {
  const data = JSON.parse(event.data);
  console.log(`${data.speaker}: ${data.transcription}`);
});
```

## Integration Architecture with SSE

```
AI Assistant (Claude) --[MCP Protocol]--> MCP Server --[SSE]--> Client Browser/App
                                            |
                                            ├--[HTTP API]--> Twilio
                                            |                   |
                                            |                   v
                                            |               Phone Call
                                            |                   |
                                            ├--[WebSocket]---> OpenAI Realtime
                                            |
                                            ├--[Express + SSE]--> Real-time Events
                                            |
                                            └--[ngrok tunnel]-- Webhooks + SSE
```

## Implementation Steps for Claude-Code

1. **Clone the repository**
   ```bash
   git clone https://github.com/popcornspace/voice-call-mcp-server.git
   cd voice-call-mcp-server
   ```

2. **Create a new branch**
   ```bash
   git checkout -b feature/add-sse-support
   ```

3. **Install new dependencies**
   ```bash
   npm install express cors uuid @types/express @types/cors
   ```

4. **Create the SSE handler module** (`src/sse-handler.ts`)
   - Implement SSEManager class
   - Set up event emitter
   - Create Express route handler

5. **Create Express server** (`src/express-server.ts`)
   - Set up Express with CORS
   - Add SSE endpoint
   - Start server on port 3000 (or configurable)

6. **Update main entry point** (`src/start-all.ts`)
   - Import and start Express server
   - Ensure it runs alongside MCP server

7. **Add event emissions** throughout the codebase:
   - In Twilio webhook handlers
   - In OpenAI transcription handlers
   - In error handlers

8. **Update MCP tool responses**
   - Include SSE URL in response
   - Document the new response field

9. **Update ngrok configuration**
   - Ensure Express port is exposed through ngrok

10. **Test the implementation**
    - Use curl or browser to test SSE endpoint
    - Verify events are emitted during calls
    - Test with multiple concurrent calls

## Testing Strategy

### Unit Tests
```typescript
// Test SSE connection management
describe('SSEManager', () => {
  it('should add and remove clients')
  it('should broadcast to all clients')
  it('should handle client disconnection')
})
```

### Integration Tests
```bash
# Test SSE endpoint
curl -N http://localhost:3000/events

# Test with call simulation
npm run test:integration
```

### Manual Testing
1. Start the server with SSE enabled
2. Initiate a call through Claude
3. Open browser to SSE endpoint
4. Verify real-time events appear

## Configuration Updates

### Environment Variables
```bash
# Existing
TWILIO_ACCOUNT_SID=xxx
TWILIO_AUTH_TOKEN=xxx
TWILIO_NUMBER=xxx
OPENAI_API_KEY=xxx
NGROK_AUTHTOKEN=xxx

# New (optional)
SSE_PORT=3000
SSE_CORS_ORIGIN=*
SSE_HEARTBEAT_INTERVAL=30000
```

### Claude Desktop Config Update
```json
{
  "mcpServers": {
    "voice-call": {
      "command": "node",
      "args": ["/path/to/dist/start-all.cjs"],
      "env": {
        // ... existing env vars
        "SSE_PORT": "3000"
      }
    }
  }
}
```

## Security Considerations

1. **Authentication**: Consider adding token-based auth for SSE endpoints
2. **CORS**: Configure appropriate CORS headers
3. **Rate Limiting**: Implement connection limits per client
4. **Input Validation**: Validate clientId parameters
5. **HTTPS**: Ensure SSE works over HTTPS in production

## Performance Considerations

1. **Connection Limits**: Set maximum SSE connections
2. **Heartbeat**: Implement keepalive to detect stale connections
3. **Event Buffer**: Consider buffering events for reconnecting clients
4. **Memory Management**: Clean up event listeners properly

## Documentation to Update

1. **README.md**: Add SSE feature description and usage
2. **API Documentation**: Document SSE endpoint and events
3. **Examples**: Add client-side SSE consumption examples
4. **Troubleshooting**: Add SSE-specific debugging tips

## Potential Challenges

1. **ngrok Compatibility**: Ensure SSE works through ngrok tunnel
2. **Client Reconnection**: Handle SSE reconnection gracefully
3. **Event Ordering**: Ensure events arrive in correct order
4. **Backwards Compatibility**: Maintain support for non-SSE clients
5. **Error Propagation**: Properly handle and emit error events

## Success Criteria

- [ ] SSE endpoint successfully streams events
- [ ] All call events are emitted in real-time
- [ ] Multiple clients can connect simultaneously
- [ ] Events continue streaming throughout entire call duration
- [ ] Graceful handling of disconnections and reconnections
- [ ] No impact on existing MCP functionality
- [ ] Documentation is complete and clear

## Next Steps After Implementation

1. **Create PR** with detailed description of changes
2. **Add examples** of client-side SSE consumption
3. **Consider WebSocket** support for bidirectional communication
4. **Add metrics** for monitoring SSE connections
5. **Implement event replay** for reconnecting clients

---

This summary provides a complete roadmap for implementing SSE support in the voice-call-mcp-server. The implementation maintains backward compatibility while adding powerful real-time capabilities that enhance the AI assistant's ability to provide live updates during voice calls.