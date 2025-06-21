#!/usr/bin/env tsx

import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const API_URL = process.env.API_URL || 'http://localhost:3004';

// Example: Batch calls with different prompts
async function testBatchCallsWithCustomPrompts() {
    console.log('Testing batch calls with custom prompts...');
    
    const request = {
        provider: 'openai',
        targets: [
            {
                phoneNumber: '+1234567890', // Replace with test number
                prompt: 'You are a friendly customer service agent calling to confirm an appointment.',
                context: 'The appointment is scheduled for tomorrow at 2 PM for a dental cleaning.'
            },
            {
                phoneNumber: '+0987654321', // Replace with test number
                prompt: 'You are a restaurant calling to confirm a reservation.',
                context: 'The reservation is for 4 people this Friday at 7 PM.'
            }
        ],
        maxConcurrent: 2
    };

    try {
        const response = await axios.post(`${API_URL}/batch/calls`, request);
        console.log('Batch calls initiated:', response.data);
        
        // Monitor batch progress
        if (response.data.batchId) {
            await monitorBatchProgress(response.data.batchId, 'call');
        }
    } catch (error) {
        console.error('Error initiating batch calls:', error.response?.data || error.message);
    }
}

// Example: Batch calls with default prompt
async function testBatchCallsWithDefaultPrompt() {
    console.log('\nTesting batch calls with default prompt...');
    
    const request = {
        provider: 'openai',
        defaultPrompt: 'You are a friendly AI assistant making a courtesy call.',
        defaultContext: 'Check in with the customer and ask if they need any assistance.',
        targets: [
            { phoneNumber: '+1234567890' }, // Will use default prompt
            { phoneNumber: '+0987654321' }, // Will use default prompt
            {
                phoneNumber: '+1122334455',
                context: 'This customer recently made a purchase. Ask about their experience.'
            }
        ],
        maxConcurrent: 1
    };

    try {
        const response = await axios.post(`${API_URL}/batch/calls`, request);
        console.log('Batch calls initiated:', response.data);
        
        // Monitor batch progress
        if (response.data.batchId) {
            await monitorBatchProgress(response.data.batchId, 'call');
        }
    } catch (error) {
        console.error('Error initiating batch calls:', error.response?.data || error.message);
    }
}

// Example: ElevenLabs batch calls
async function testElevenLabsBatchCalls() {
    console.log('\nTesting ElevenLabs batch calls...');
    
    const request = {
        provider: 'elevenlabs',
        targets: [
            {
                phoneNumber: '+1234567890',
                prompt: 'You are an energetic sales representative calling about a special offer.',
                context: 'We have a 50% discount on all products this week only.'
            }
        ]
    };

    try {
        const response = await axios.post(`${API_URL}/batch/calls`, request);
        console.log('ElevenLabs batch calls initiated:', response.data);
        
        // Monitor batch progress
        if (response.data.batchId) {
            await monitorBatchProgress(response.data.batchId, 'call');
        }
    } catch (error) {
        console.error('Error initiating ElevenLabs batch calls:', error.response?.data || error.message);
    }
}

// Monitor batch progress
async function monitorBatchProgress(batchId: string, type: 'call' | 'sms') {
    console.log(`\nMonitoring batch ${type} progress (${batchId})...`);
    
    let isComplete = false;
    let attempts = 0;
    const maxAttempts = 60; // Monitor for up to 5 minutes
    
    while (!isComplete && attempts < maxAttempts) {
        try {
            const response = await axios.get(`${API_URL}/batch/${type}s/${batchId}`);
            const operation = response.data;
            
            console.log(`Status: ${operation.status} | Progress: ${operation.completedTargets + operation.failedTargets}/${operation.totalTargets}`);
            
            if (operation.status === 'completed' || operation.status === 'failed' || operation.status === 'partial_complete') {
                isComplete = true;
                console.log('\nBatch operation complete!');
                console.log(`Total: ${operation.totalTargets}`);
                console.log(`Completed: ${operation.completedTargets}`);
                console.log(`Failed: ${operation.failedTargets}`);
                
                // Get transcripts if it's a call batch
                if (type === 'call' && operation.completedTargets > 0) {
                    await getTranscripts(batchId);
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

// Get transcripts for completed calls
async function getTranscripts(batchId: string) {
    console.log('\nRetrieving transcripts...');
    
    try {
        const response = await axios.get(`${API_URL}/batch/calls/${batchId}/transcripts`);
        const data = response.data;
        
        console.log(`\nBatch Summary:`);
        console.log(`- Total calls: ${data.summary.totalCalls}`);
        console.log(`- Completed calls: ${data.summary.completedCalls}`);
        console.log(`- Average duration: ${data.summary.averageDuration} seconds`);
        
        console.log('\nTranscripts:');
        data.transcripts.forEach((transcript: any, index: number) => {
            console.log(`\n--- Call ${index + 1} (${transcript.phoneNumber}) ---`);
            console.log(`Duration: ${transcript.duration} seconds`);
            console.log(`Messages: ${transcript.entryCount}`);
            
            if (transcript.entries && transcript.entries.length > 0) {
                console.log('\nConversation:');
                transcript.entries.forEach((entry: any) => {
                    console.log(`${entry.role.toUpperCase()}: ${entry.content}`);
                });
            }
        });
    } catch (error) {
        console.error('Error retrieving transcripts:', error.response?.data || error.message);
    }
}

// Main execution
async function main() {
    console.log('Voice Call Batch Testing Script');
    console.log('===============================\n');
    
    // Uncomment the test you want to run:
    
    await testBatchCallsWithCustomPrompts();
    // await testBatchCallsWithDefaultPrompt();
    // await testElevenLabsBatchCalls();
}

// Run the script
main().catch(console.error);