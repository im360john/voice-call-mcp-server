# MCP SMS Tools Documentation

## Overview

The MCP server now provides comprehensive tools for handling SMS messages, including sending, receiving, and monitoring SMS conversations.

## Available SMS Tools

### 1. send-sms
Send an SMS message via Twilio.

**Parameters:**
- `toNumber` (string, required): The phone number to send the SMS to
- `message` (string, required): The text message to send

**Returns:**
```json
{
  "status": "success",
  "message": "SMS sent successfully",
  "messageSid": "SM...",
  "conversationId": "uuid",
  "sseUrl": "https://your-domain/sms/events?conversationId=uuid",
  "info": "Use the conversationId to retrieve the conversation history"
}
```

### 2. get-sms-conversation
Retrieve an SMS conversation by its ID.

**Parameters:**
- `conversationId` (string, required): The ID of the conversation to retrieve

**Returns:**
```json
{
  "status": "success",
  "conversation": {
    "id": "uuid",
    "phoneNumber": "+1234567890",
    "messages": [
      {
        "messageSid": "SM...",
        "from": "+1234567890",
        "to": "+0987654321",
        "body": "Message content",
        "timestamp": "2024-01-15T10:30:00Z",
        "direction": "inbound",
        "status": "received"
      }
    ],
    "createdAt": "2024-01-15T10:00:00Z",
    "updatedAt": "2024-01-15T10:30:00Z"
  }
}
```

### 3. list-sms-conversations
List all SMS conversations.

**Parameters:** None

**Returns:**
```json
{
  "status": "success",
  "conversations": [
    {
      "id": "uuid",
      "phoneNumber": "+1234567890",
      "messageCount": 5,
      "lastMessage": "Last message preview...",
      "lastMessageTime": "2024-01-15T10:30:00Z"
    }
  ]
}
```

### 4. get-sms-by-phone
Retrieve SMS conversation by phone number.

**Parameters:**
- `phoneNumber` (string, required): The phone number to look up SMS conversation for

**Returns:**
```json
{
  "status": "success",
  "conversation": {
    "id": "uuid",
    "phoneNumber": "+1234567890",
    "messages": [...],
    "createdAt": "2024-01-15T10:00:00Z",
    "updatedAt": "2024-01-15T10:30:00Z"
  }
}
```

### 5. get-received-sms
Get only received (inbound) SMS messages from a phone number.

**Parameters:**
- `phoneNumber` (string, required): The phone number to get received messages from
- `limit` (number, optional): Maximum number of messages to return (default: all)

**Returns:**
```json
{
  "status": "success",
  "messages": [
    {
      "messageSid": "SM...",
      "from": "+1234567890",
      "to": "+0987654321",
      "body": "Received message",
      "timestamp": "2024-01-15T10:30:00Z",
      "direction": "inbound",
      "status": "received"
    }
  ],
  "count": 3,
  "totalInbound": 10,
  "phoneNumber": "+1234567890",
  "conversationId": "uuid"
}
```

### 6. get-sms-conversation-summary
Get a human-readable summary of an SMS conversation by phone number.

**Parameters:**
- `phoneNumber` (string, required): The phone number to get conversation summary for

**Returns:**
```text
SMS Conversation with +1234567890
Total messages: 15 (8 received, 7 sent)
Started: 1/15/2024, 10:00:00 AM
Last activity: 1/15/2024, 2:30:00 PM

Recent messages:
[2:25:00 PM] From +1234567890: Can you check inventory?
[2:26:00 PM] To +1234567890: Checking now...
[2:30:00 PM] To +1234567890: Low stock on item #123
```

### 7. monitor-sms-realtime
Get SSE URL to monitor SMS messages in real-time.

**Parameters:**
- `phoneNumber` (string, optional): Optional phone number to monitor specific conversation

**Returns:**
```json
{
  "status": "success",
  "sseUrl": "https://your-domain/sms/events?conversationId=uuid",
  "conversationId": "uuid",
  "phoneNumber": "+1234567890",
  "info": "Connect to the SSE URL to receive real-time SMS updates. Events include: sms:received, sms:sent, sms:error"
}
```

## Usage Examples

### Example 1: Send SMS and Monitor Responses
```javascript
// 1. Send an SMS
const result = await mcp.call('send-sms', {
  toNumber: '+1234567890',
  message: 'Your inventory is running low on Widget #123'
});

// 2. Get the SSE URL for monitoring
const monitor = await mcp.call('monitor-sms-realtime', {
  phoneNumber: '+1234567890'
});

// 3. Connect to SSE for real-time updates
const eventSource = new EventSource(monitor.sseUrl);
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'sms:received') {
    console.log('Received SMS:', data.message);
  }
};
```

### Example 2: Check Received Messages
```javascript
// Get all received messages from a customer
const received = await mcp.call('get-received-sms', {
  phoneNumber: '+1234567890',
  limit: 10
});

console.log(`Received ${received.count} messages from customer`);
received.messages.forEach(msg => {
  console.log(`[${msg.timestamp}] ${msg.body}`);
});
```

### Example 3: Get Conversation Summary
```javascript
// Get a readable summary of the conversation
const summary = await mcp.call('get-sms-conversation-summary', {
  phoneNumber: '+1234567890'
});

console.log(summary);
```

## Real-time SMS Events

When connected to the SSE endpoint, you'll receive the following event types:

### sms:received
Fired when an inbound SMS is received.
```json
{
  "type": "sms:received",
  "conversationId": "uuid",
  "message": {
    "messageSid": "SM...",
    "from": "+1234567890",
    "to": "+0987654321",
    "body": "Message content",
    "timestamp": "2024-01-15T10:30:00Z",
    "direction": "inbound"
  }
}
```

### sms:sent
Fired when an SMS is successfully sent.
```json
{
  "type": "sms:sent",
  "conversationId": "uuid",
  "message": {
    "messageSid": "SM...",
    "from": "+0987654321",
    "to": "+1234567890",
    "body": "Message content",
    "timestamp": "2024-01-15T10:31:00Z",
    "direction": "outbound",
    "status": "sent"
  }
}
```

### sms:error
Fired when an SMS fails to send.
```json
{
  "type": "sms:error",
  "error": "Error message",
  "to": "+1234567890",
  "body": "Failed message content"
}
```

## Best Practices

1. **Opt-in Compliance**: Always check opt-in status before sending marketing messages
2. **Message Formatting**: Keep messages concise and relevant
3. **Error Handling**: Implement proper error handling for failed messages
4. **Rate Limiting**: Be aware of Twilio's rate limits for SMS
5. **Monitoring**: Use the real-time monitoring for interactive conversations
6. **Storage**: Messages are stored in memory and will be lost on restart (consider implementing persistent storage for production)