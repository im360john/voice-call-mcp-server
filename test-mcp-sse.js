#!/usr/bin/env node

/**
 * Test MCP SSE endpoint
 */

const EventSource = require('eventsource');

const mcpUrl = process.env.MCP_URL || 'http://localhost:3004/mcp';

console.log(`Connecting to MCP SSE endpoint: ${mcpUrl}`);

const eventSource = new EventSource(mcpUrl);

eventSource.onopen = () => {
    console.log('✅ Connected to MCP SSE endpoint');
};

eventSource.onmessage = (event) => {
    console.log('📨 Message:', JSON.parse(event.data));
};

eventSource.onerror = (error) => {
    console.error('❌ Error:', error);
    if (eventSource.readyState === EventSource.CLOSED) {
        console.log('Connection closed');
    }
};

// Test JSON-RPC request after connection
setTimeout(async () => {
    console.log('\nTesting tools/list request...');
    
    try {
        const response = await fetch(mcpUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'tools/list',
                id: 1
            })
        });
        
        const result = await response.json();
        console.log('Response:', JSON.stringify(result, null, 2));
    } catch (error) {
        console.error('Request failed:', error);
    }
}, 2000);

process.on('SIGINT', () => {
    console.log('\nClosing connection...');
    eventSource.close();
    process.exit(0);
});