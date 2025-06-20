# MCP SSE Server Implementation Guide

A comprehensive guide for implementing MCP (Model Context Protocol) servers with SSE (Server-Sent Events) transport that work with LibreChat and other MCP clients.

## Table of Contents
- [Overview](#overview)
- [Key Concepts](#key-concepts)
- [Implementation Tips](#implementation-tips)
- [Common Pitfalls](#common-pitfalls)
- [Testing](#testing)
- [Debugging](#debugging)
- [Example Implementation](#example-implementation)

## Overview

MCP servers can use different transports (stdio, HTTP, SSE). SSE transport is particularly useful for web-based clients like LibreChat because it allows real-time bidirectional communication over HTTP.

## Key Concepts

### 1. Use the Official SDK

**DO:** Always use the official MCP SDK's `SSEServerTransport`
```typescript
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
```

**DON'T:** Try to implement your own SSE protocol
```typescript
// ❌ Wrong - Don't do this
res.write('data: {"jsonrpc":"2.0"...}\n\n');
```

### 2. Transport Architecture

The MCP SSE transport uses two endpoints:
- **GET endpoint** (e.g., `/mcp`) - Establishes the SSE connection
- **POST endpoint** (e.g., `/mcp/messages`) - Receives JSON-RPC messages

```typescript
// ✅ Correct setup
app.get('/mcp', handleSSE);
app.post('/mcp/messages', handleMessage);
```

### 3. Session Management

Each SSE connection has a unique session ID that must be tracked:

```typescript
const activeTransports = new Map<string, SSEServerTransport>();

// Store transport by session ID
activeTransports.set(transport.sessionId, transport);
```

## Implementation Tips

### 1. Server Setup

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

export class MyMcpServer {
    private server: McpServer;

    constructor() {
        this.server = new McpServer({
            name: 'my-mcp-server',
            version: '1.0.0',
            description: 'My MCP Server'
        });
        
        this.registerTools();
    }

    private registerTools(): void {
        this.server.tool(
            'my-tool',
            'Tool description',
            {
                // Zod schema for parameters
            },
            async (params) => {
                // Tool implementation
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(result)
                    }]
                };
            }
        );
    }

    public async connectTransport(transport: Transport): Promise<void> {
        await this.server.connect(transport);
    }
}
```

### 2. Express Integration

```typescript
export class McpSSEHandler {
    private mcpServer: MyMcpServer;
    private activeTransports = new Map<string, SSEServerTransport>();

    constructor() {
        this.mcpServer = new MyMcpServer();
    }

    public async handleSSE(req: Request, res: Response): Promise<void> {
        // Create SSE transport pointing to messages endpoint
        const transport = new SSEServerTransport('/mcp/messages', res);
        
        // Store for message routing
        this.activeTransports.set(transport.sessionId, transport);
        
        // Connect MCP server
        await this.mcpServer.connectTransport(transport);
        
        // Start SSE connection
        await transport.start();
        
        // Cleanup on close
        transport.onclose = () => {
            this.activeTransports.delete(transport.sessionId);
        };
    }

    public async handleMessage(req: Request, res: Response): Promise<void> {
        // Get session ID (from query param or header)
        const sessionId = req.query.sessionId as string;
        
        const transport = this.activeTransports.get(sessionId);
        if (!transport) {
            res.status(404).json({ error: 'Session not found' });
            return;
        }
        
        // Let transport handle the message
        await transport.handlePostMessage(req, res, req.body);
    }
}
```

### 3. CORS Configuration

Always configure CORS properly for web clients:

```typescript
app.use(cors({
    origin: '*', // Or specific origins
    credentials: true
}));
```

### 4. Error Handling

```typescript
try {
    await transport.start();
} catch (error) {
    console.error('[MCP SSE] Error:', error);
    if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to establish SSE connection' });
    }
}
```

## Common Pitfalls

### 1. ❌ Implementing Custom SSE Protocol

**Wrong:**
```typescript
// Don't manually construct SSE messages
res.write('event: message\n');
res.write(`data: ${JSON.stringify(data)}\n\n`);
```

**Right:**
```typescript
// Use the SDK's transport
const transport = new SSEServerTransport('/messages', res);
await transport.start();
```

### 2. ❌ Wrong Endpoint Structure

**Wrong:**
```typescript
// Single endpoint trying to handle both SSE and messages
app.all('/mcp', handleEverything);
```

**Right:**
```typescript
// Separate endpoints
app.get('/mcp', handleSSE);        // SSE connection
app.post('/mcp/messages', handleMessage);  // JSON-RPC messages
```

### 3. ❌ No Session Management

**Wrong:**
```typescript
// Creating new transport for each request
app.post('/mcp/messages', async (req, res) => {
    const transport = new SSEServerTransport(...); // ❌
});
```

**Right:**
```typescript
// Reuse transport by session ID
const transport = activeTransports.get(sessionId); // ✅
```

### 4. ❌ Missing Cleanup

**Wrong:**
```typescript
// No cleanup on disconnect
await transport.start();
// Done? Nope!
```

**Right:**
```typescript
transport.onclose = () => {
    activeTransports.delete(transport.sessionId);
    // Any other cleanup
};
```

## Testing

### 1. Test with curl

Test SSE connection:
```bash
curl -N https://your-server.com/mcp
```

### 2. Test with EventSource

```javascript
const eventSource = new EventSource('https://your-server.com/mcp');

eventSource.onopen = () => {
    console.log('Connected');
};

eventSource.onmessage = (event) => {
    console.log('Message:', event.data);
};
```

### 3. Test Message Endpoint

```bash
curl -X POST https://your-server.com/mcp/messages \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

## Debugging

### 1. Enable Logging

Add comprehensive logging:

```typescript
console.log('[MCP SSE] New connection');
console.log('[MCP SSE] Session ID:', transport.sessionId);
console.log('[MCP SSE] Message received:', method);
```

### 2. Check Headers

Ensure SSE headers are correct:
```typescript
// The SDK handles this, but if debugging:
// Content-Type: text/event-stream
// Cache-Control: no-cache
// Connection: keep-alive
```

### 3. Monitor Network

Use browser DevTools or proxy tools to inspect:
- SSE connection establishment
- Message flow
- Session IDs

### 4. Common Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| "Connection timeout after 20000ms" | SSE not established properly | Check transport.start() is called |
| "Session not found" | Message sent to wrong session | Verify session ID routing |
| "Access token missing" | Client expects auth | Not an issue if server doesn't require auth |

## Example Implementation

Here's a minimal working example:

```typescript
import express from 'express';
import cors from 'cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

const app = express();
app.use(cors());
app.use(express.json());

// Create MCP server
const mcpServer = new McpServer({
    name: 'example-server',
    version: '1.0.0'
});

// Register a simple tool
mcpServer.tool('hello', 'Say hello', {
    name: { type: 'string' }
}, async ({ name }) => ({
    content: [{
        type: 'text',
        text: `Hello, ${name}!`
    }]
}));

// Track active sessions
const sessions = new Map();

// SSE endpoint
app.get('/mcp', async (req, res) => {
    const transport = new SSEServerTransport('/mcp/messages', res);
    sessions.set(transport.sessionId, transport);
    
    await mcpServer.connect(transport);
    await transport.start();
    
    transport.onclose = () => {
        sessions.delete(transport.sessionId);
    };
});

// Messages endpoint
app.post('/mcp/messages', async (req, res) => {
    const sessionId = req.query.sessionId;
    const transport = sessions.get(sessionId);
    
    if (!transport) {
        return res.status(404).json({ error: 'Session not found' });
    }
    
    await transport.handlePostMessage(req, res, req.body);
});

app.listen(3000, () => {
    console.log('MCP SSE server running on http://localhost:3000');
});
```

## Best Practices

1. **Always use the official SDK** - Don't reinvent the wheel
2. **Keep it simple** - Let the SDK handle protocol details
3. **Log everything** during development
4. **Test with real clients** like LibreChat
5. **Handle errors gracefully** - Don't crash on bad input
6. **Clean up resources** - Remove closed sessions
7. **Document your tools** - Use clear descriptions

## Resources

- [MCP Specification](https://modelcontextprotocol.io/specification)
- [MCP SDK Documentation](https://github.com/modelcontextprotocol/sdk)
- [SSE Standard](https://html.spec.whatwg.org/multipage/server-sent-events.html)

## Conclusion

The key to implementing MCP SSE servers is to use the official SDK's `SSEServerTransport` rather than trying to implement the protocol yourself. This ensures compatibility with clients like LibreChat and saves you from dealing with low-level protocol details.

Remember: The SDK does the heavy lifting - your job is to provide the tools and business logic!