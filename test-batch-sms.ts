#!/usr/bin/env tsx

import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const API_URL = process.env.API_URL || 'http://localhost:3004';

// Example: Batch SMS with different messages
async function testBatchSMS() {
    console.log('Testing batch SMS...');
    
    const request = {
        targets: [
            {
                phoneNumber: '+1234567890', // Replace with test number
                message: 'Hello! This is a test message from the batch SMS system. Your appointment is confirmed for tomorrow at 2 PM.'
            },
            {
                phoneNumber: '+0987654321', // Replace with test number
                message: 'Reminder: Your subscription renewal is due in 3 days. Reply STOP to unsubscribe.'
            },
            {
                phoneNumber: '+1122334455', // Replace with test number
                message: 'Thank you for your recent purchase! How was your experience? Reply with a rating from 1-5.'
            }
        ],
        maxConcurrent: 2
    };

    try {
        const response = await axios.post(`${API_URL}/batch/sms`, request);
        console.log('Batch SMS initiated:', response.data);
        
        // Monitor batch progress
        if (response.data.batchId) {
            await monitorBatchProgress(response.data.batchId);
        }
    } catch (error) {
        console.error('Error initiating batch SMS:', error.response?.data || error.message);
    }
}

// Monitor batch progress
async function monitorBatchProgress(batchId: string) {
    console.log(`\nMonitoring batch SMS progress (${batchId})...`);
    
    let isComplete = false;
    let attempts = 0;
    const maxAttempts = 30; // Monitor for up to 2.5 minutes
    
    while (!isComplete && attempts < maxAttempts) {
        try {
            const response = await axios.get(`${API_URL}/batch/sms/${batchId}`);
            const operation = response.data;
            
            console.log(`Status: ${operation.status} | Progress: ${operation.completedTargets + operation.failedTargets}/${operation.totalTargets}`);
            
            if (operation.status === 'completed' || operation.status === 'failed' || operation.status === 'partial_complete') {
                isComplete = true;
                console.log('\nBatch operation complete!');
                console.log(`Total: ${operation.totalTargets}`);
                console.log(`Completed: ${operation.completedTargets}`);
                console.log(`Failed: ${operation.failedTargets}`);
                
                // Show detailed results
                if (operation.results && operation.results.length > 0) {
                    console.log('\nDetailed Results:');
                    operation.results.forEach((result: any) => {
                        console.log(`- ${result.phoneNumber}: ${result.status}${result.error ? ` (${result.error})` : ''}`);
                        if (result.messageSid) {
                            console.log(`  Message SID: ${result.messageSid}`);
                        }
                    });
                }
                
                // Get conversations
                if (operation.completedTargets > 0) {
                    await getConversations(batchId);
                }
            }
            
            if (!isComplete) {
                await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
            }
        } catch (error) {
            console.error('Error checking batch status:', error.response?.data || error.message);
            break;
        }
        
        attempts++;
    }
    
    if (!isComplete) {
        console.log('Batch monitoring timed out. Check status manually.');
    }
}

// Get conversations for sent messages
async function getConversations(batchId: string) {
    console.log('\nRetrieving conversations...');
    
    try {
        const response = await axios.get(`${API_URL}/batch/sms/${batchId}/conversations`);
        const data = response.data;
        
        console.log(`\nTotal conversations: ${data.totalConversations}`);
        
        if (data.conversations && data.conversations.length > 0) {
            data.conversations.forEach((conv: any, index: number) => {
                console.log(`\n--- Conversation ${index + 1} (${conv.phoneNumber}) ---`);
                console.log(`ID: ${conv.id}`);
                console.log(`Messages: ${conv.messages.length}`);
                
                if (conv.messages.length > 0) {
                    console.log('\nMessages:');
                    conv.messages.forEach((msg: any) => {
                        const direction = msg.direction === 'outbound' ? 'SENT' : 'RECEIVED';
                        console.log(`[${direction}] ${msg.body}`);
                        console.log(`  Time: ${new Date(msg.timestamp).toLocaleString()}`);
                        console.log(`  Status: ${msg.status || 'N/A'}`);
                    });
                }
            });
        }
    } catch (error) {
        console.error('Error retrieving conversations:', error.response?.data || error.message);
    }
}

// Test with metadata
async function testBatchSMSWithMetadata() {
    console.log('\nTesting batch SMS with metadata...');
    
    const request = {
        targets: [
            {
                phoneNumber: '+1234567890',
                message: 'Order #12345 has been shipped! Track your package at example.com/track',
                metadata: {
                    orderId: '12345',
                    customerId: 'CUST-001',
                    type: 'shipping_notification'
                }
            },
            {
                phoneNumber: '+0987654321',
                message: 'Your verification code is: 123456. Valid for 10 minutes.',
                metadata: {
                    userId: 'USER-002',
                    type: 'verification',
                    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
                }
            }
        ],
        maxConcurrent: 1
    };

    try {
        const response = await axios.post(`${API_URL}/batch/sms`, request);
        console.log('Batch SMS with metadata initiated:', response.data);
        
        // Monitor batch progress
        if (response.data.batchId) {
            await monitorBatchProgress(response.data.batchId);
        }
    } catch (error) {
        console.error('Error initiating batch SMS:', error.response?.data || error.message);
    }
}

// Main execution
async function main() {
    console.log('SMS Batch Testing Script');
    console.log('========================\n');
    
    // Uncomment the test you want to run:
    
    await testBatchSMS();
    // await testBatchSMSWithMetadata();
}

// Run the script
main().catch(console.error);