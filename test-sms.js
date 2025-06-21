#!/usr/bin/env node

/**
 * Test script for SMS functionality
 * 
 * Usage: node test-sms.js <phone-number> <message>
 * Example: node test-sms.js +1234567890 "Hello from test script!"
 */

const args = process.argv.slice(2);

if (args.length < 2) {
    console.error('Usage: node test-sms.js <phone-number> <message>');
    console.error('Example: node test-sms.js +1234567890 "Hello from test script!"');
    process.exit(1);
}

const phoneNumber = args[0];
const message = args.slice(1).join(' ');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3004';

// Validate phone number format
if (!phoneNumber.match(/^\+[1-9]\d{1,14}$/)) {
    console.error('Error: Phone number must be in E.164 format (e.g., +1234567890)');
    process.exit(1);
}

console.log(`📱 Testing SMS functionality...`);
console.log(`Server URL: ${SERVER_URL}`);
console.log(`To: ${phoneNumber}`);
console.log(`Message: ${message}`);
console.log('---');

// Send SMS
async function sendSMS() {
    try {
        const response = await fetch(`${SERVER_URL}/sms/send`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                to: phoneNumber,
                body: message
            })
        });

        const data = await response.json();
        
        if (response.ok) {
            console.log('✅ SMS sent successfully!');
            console.log(`Message SID: ${data.messageSid}`);
            console.log(`Conversation ID: ${data.conversationId}`);
            console.log('\n📡 Connecting to SSE for real-time updates...');
            
            // Connect to SSE
            connectSSE(data.conversationId);
        } else {
            console.error('❌ Failed to send SMS:', data.error);
            process.exit(1);
        }
    } catch (error) {
        console.error('❌ Error sending SMS:', error.message);
        process.exit(1);
    }
}

// Connect to SSE for real-time updates
function connectSSE(conversationId) {
    const EventSource = require('eventsource');
    const sseUrl = `${SERVER_URL}/sms/events?conversationId=${conversationId}`;
    
    console.log(`SSE URL: ${sseUrl}`);
    
    const eventSource = new EventSource(sseUrl);
    
    eventSource.onopen = () => {
        console.log('✅ Connected to SSE');
    };
    
    eventSource.addEventListener('sms-sent', (event) => {
        const data = JSON.parse(event.data);
        console.log(`\n📤 SMS Sent:`);
        console.log(`  To: ${data.to}`);
        console.log(`  Message: ${data.body}`);
        console.log(`  Status: ${data.status}`);
    });
    
    eventSource.addEventListener('sms-received', (event) => {
        const data = JSON.parse(event.data);
        console.log(`\n📥 SMS Received:`);
        console.log(`  From: ${data.from}`);
        console.log(`  Message: ${data.body}`);
    });
    
    eventSource.addEventListener('heartbeat', () => {
        process.stdout.write('💓');
    });
    
    eventSource.onerror = (error) => {
        console.error('\n❌ SSE Error:', error);
        eventSource.close();
        process.exit(1);
    };
    
    // Handle Ctrl+C
    process.on('SIGINT', () => {
        console.log('\n\n👋 Closing connection...');
        eventSource.close();
        process.exit(0);
    });
}

// Check if eventsource module is installed
try {
    require('eventsource');
} catch (e) {
    console.error('❌ Please install the eventsource module first:');
    console.error('   npm install eventsource');
    process.exit(1);
}

// Run the test
sendSMS();