# LibreChat Integration Guide for Voice Call MCP Server

## Overview

This guide explains how to integrate the Voice Call MCP Server with LibreChat.

## Important Note

The Voice Call MCP Server uses **stdio transport** (standard input/output), not HTTP transport. This means it needs to be run locally on the same machine as LibreChat, not accessed via a web URL.

## Setup Instructions

### 1. Clone and Build Locally

First, clone the repository and build it on your LibreChat server:

```bash
git clone https://github.com/im360john/voice-call-mcp-server.git
cd voice-call-mcp-server
npm install
npm run build
```

### 2. Configure LibreChat

Add the following to your LibreChat configuration file (usually `librechat.yaml` or in the admin panel):

```yaml
mcp:
  - name: voice-call
    type: stdio
    command: node
    args:
      - /path/to/voice-call-mcp-server/dist/start-all.cjs
    env:
      TWILIO_ACCOUNT_SID: "your_twilio_account_sid"
      TWILIO_AUTH_TOKEN: "your_twilio_auth_token"
      TWILIO_NUMBER: "+1234567890"
      OPENAI_API_KEY: "your_openai_api_key"
      NGROK_AUTHTOKEN: "your_ngrok_authtoken"
    auth: none
    transport: stdio
```

Or if using JSON configuration:

```json
{
  "mcp": [
    {
      "name": "voice-call",
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/voice-call-mcp-server/dist/start-all.cjs"],
      "env": {
        "TWILIO_ACCOUNT_SID": "your_twilio_account_sid",
        "TWILIO_AUTH_TOKEN": "your_twilio_auth_token",
        "TWILIO_NUMBER": "+1234567890",
        "OPENAI_API_KEY": "your_openai_api_key",
        "NGROK_AUTHTOKEN": "your_ngrok_authtoken"
      },
      "auth": "none",
      "transport": "stdio"
    }
  ]
}
```

### 3. Alternative: Use npx (if published to npm)

If the package is published to npm, you can use:

```yaml
mcp:
  - name: voice-call
    type: stdio
    command: npx
    args:
      - voice-call-mcp-server
    env:
      # ... environment variables as above
```

## Common Issues

### "Access token missing" Error

This error occurs when LibreChat tries to connect to the MCP server via HTTP instead of stdio. Make sure:

1. You're using `type: stdio` and `transport: stdio` in your configuration
2. The `command` points to a local executable, not a web URL
3. You've set `auth: none` to disable authentication

### Server Not Found

If LibreChat can't find the server:

1. Use the absolute path to the built file
2. Ensure the file has execute permissions: `chmod +x dist/start-all.cjs`
3. Test the server manually: `node /path/to/dist/start-all.cjs`

## Testing the Integration

Once configured, you should be able to:

1. See "Voice Call" in your available tools/functions in LibreChat
2. Use the `trigger-call` tool to make phone calls
3. Receive the SSE URL in the response for real-time monitoring

## Environment Variables

Make sure all required environment variables are set:

- `TWILIO_ACCOUNT_SID`: Your Twilio account SID
- `TWILIO_AUTH_TOKEN`: Your Twilio auth token  
- `TWILIO_NUMBER`: Your Twilio phone number (E.164 format)
- `OPENAI_API_KEY`: Your OpenAI API key
- `NGROK_AUTHTOKEN`: Your ngrok authtoken

## Need Help?

If you continue to have issues:

1. Check LibreChat logs for more detailed error messages
2. Verify the MCP server runs correctly standalone
3. Ensure all dependencies are installed
4. Check that ngrok can establish tunnels from your server