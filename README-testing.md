# Testing ElevenLabs Integration

## Prerequisites

Make sure you have the following environment variables set in your `.env` file:

```bash
# Twilio Configuration
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+1234567890  # Your Twilio phone number

# ElevenLabs Configuration
ELEVENLABS_API_KEY=your_elevenlabs_api_key
ELEVENLABS_AGENT_ID=your_elevenlabs_agent_id

# Testing
TEST_PHONE_NUMBER=+1234567890  # Phone number to receive test calls
MCP_SERVER_URL=http://localhost:3000  # Optional, defaults to localhost:3000
```

## Running the Tests

### 1. Direct ElevenLabs WebSocket Test

This test verifies the ElevenLabs WebSocket connection without going through Twilio:

```bash
npm run tsx test-elevenlabs.ts
```

This test will:
- Connect directly to ElevenLabs WebSocket
- Test ping/pong messages
- Send a test audio chunk
- Display all received messages

### 2. Full MCP Integration Test (Recommended)

This test triggers a real phone call through the MCP endpoint, using Twilio and ElevenLabs:

```bash
# First, start the MCP server
npm run start:http

# In another terminal, run the test
npm run tsx test-elevenlabs-mcp.ts
```

This test will:
- Connect to the MCP server's SSE endpoint for real-time updates
- Trigger a phone call to your TEST_PHONE_NUMBER
- Use ElevenLabs for the AI voice
- Display real-time transcriptions and call status
- Show the full conversation flow

**Important**: Answer the phone when it rings to test the full integration!

## What to Expect

When the test call is placed:
1. Your phone will ring from your Twilio number
2. When you answer, you'll hear the ElevenLabs AI agent
3. The console will show real-time transcriptions
4. You can have a conversation with the AI
5. Say "goodbye" to end the call

## Troubleshooting

If you see "Cannot send audio: WebSocket is not open" errors:
- This has been fixed with audio buffering
- Audio chunks are now buffered until the ElevenLabs connection is ready

If the call doesn't connect:
- Verify your Twilio credentials and phone numbers
- Ensure your Twilio number can make outbound calls
- Check that the TEST_PHONE_NUMBER is valid and can receive calls

If you don't hear any audio:
- Verify your ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID
- Check the console for any ElevenLabs-specific errors
- Ensure your ElevenLabs agent is properly configured