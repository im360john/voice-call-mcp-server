#!/usr/bin/env node

/**
 * Simple SSE test client for voice-call-mcp-server
 * 
 * Usage: node test-sse.js [callSid]
 * 
 * This script connects to the SSE endpoint and logs all events
 */

const EventSource = require('eventsource');

// Get the SSE URL from command line or use default
const callSid = process.argv[2] || 'test-call-sid';
const sseUrl = `http://localhost:3004/events?callSid=${callSid}`;

console.log(`Connecting to SSE endpoint: ${sseUrl}`);
console.log('Press Ctrl+C to stop\n');

// Create EventSource connection
const eventSource = new EventSource(sseUrl);

// Handle connection open
eventSource.onopen = () => {
    console.log('✅ Connected to SSE endpoint');
};

// Handle errors
eventSource.onerror = (error) => {
    console.error('❌ SSE Error:', error);
    if (eventSource.readyState === EventSource.CLOSED) {
        console.log('Connection closed');
    }
};

// Handle specific event types
eventSource.addEventListener('connected', (event) => {
    const data = JSON.parse(event.data);
    console.log('🔗 Connected:', data);
});

eventSource.addEventListener('call-status', (event) => {
    const data = JSON.parse(event.data);
    console.log('📞 Call Status:', data);
});

eventSource.addEventListener('transcription', (event) => {
    const data = JSON.parse(event.data);
    console.log(`💬 ${data.speaker.toUpperCase()}:`, data.transcription);
});

eventSource.addEventListener('call-ended', (event) => {
    const data = JSON.parse(event.data);
    console.log('📴 Call Ended:', data);
});

eventSource.addEventListener('error', (event) => {
    const data = JSON.parse(event.data);
    console.log('⚠️  Error:', data);
});

eventSource.addEventListener('heartbeat', (event) => {
    const data = JSON.parse(event.data);
    console.log('💓 Heartbeat:', new Date(data.timestamp).toLocaleTimeString());
});

// Handle Ctrl+C
process.on('SIGINT', () => {
    console.log('\nClosing SSE connection...');
    eventSource.close();
    process.exit(0);
});