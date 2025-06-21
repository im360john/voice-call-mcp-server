#!/usr/bin/env tsx

import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const API_URL = process.env.API_URL || 'http://localhost:3004';

// Test non-batch ElevenLabs call with context
async function testSingleElevenLabsCall() {
    console.log('Testing single ElevenLabs call with context...');
    
    try {
        const response = await axios.post(`${API_URL}/call`, {
            toNumber: '+17758306667', // Replace with test number
            callContext: 'Ask if they want pizza delivered today. We have a special offer: 2 large pizzas for $20.',
            provider: 'elevenlabs'
        });
        
        console.log('Single call response:', response.data);
    } catch (error: any) {
        console.error('Error making single call:', error.response?.data || error.message);
    }
}

// Test batch ElevenLabs calls with context
async function testBatchElevenLabsCalls() {
    console.log('\nTesting batch ElevenLabs calls with context...');
    
    const request = {
        provider: 'elevenlabs',
        defaultContext: 'Ask if they want pizza delivered today. We have a special offer: 2 large pizzas for $20.',
        targets: [
            { phoneNumber: '+17758306667' },
            { phoneNumber: '+17758306668' }
        ],
        maxConcurrent: 1
    };

    try {
        const response = await axios.post(`${API_URL}/batch/calls`, request);
        console.log('Batch calls response:', response.data);
        
        // Wait a bit and check batch status
        if (response.data.batchId) {
            console.log('\nWaiting 5 seconds before checking status...');
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            const statusResponse = await axios.get(`${API_URL}/batch/calls/${response.data.batchId}`);
            console.log('Batch status:', statusResponse.data);
        }
    } catch (error: any) {
        console.error('Error making batch calls:', error.response?.data || error.message);
    }
}

// Test batch with mixed prompts
async function testBatchWithMixedPrompts() {
    console.log('\nTesting batch ElevenLabs calls with mixed prompts...');
    
    const request = {
        provider: 'elevenlabs',
        defaultContext: 'Call about our general promotion',
        targets: [
            { 
                phoneNumber: '+17758306667',
                context: 'Ask if they want pizza. Special: 2 large for $20.'
            },
            { 
                phoneNumber: '+17758306668',
                prompt: 'You are calling about a pasta special. Ask if they want to order our new pasta dishes.',
                context: 'We have 3 new pasta dishes: Carbonara, Alfredo, and Marinara. All are $12.99 each.'
            }
        ],
        maxConcurrent: 1
    };

    try {
        const response = await axios.post(`${API_URL}/batch/calls`, request);
        console.log('Batch calls response:', response.data);
    } catch (error: any) {
        console.error('Error making batch calls:', error.response?.data || error.message);
    }
}

// Main execution
async function main() {
    console.log('ElevenLabs Context Fix Test');
    console.log('===========================\n');
    
    // Run tests based on command line argument
    const testType = process.argv[2];
    
    switch (testType) {
        case 'single':
            await testSingleElevenLabsCall();
            break;
        case 'batch':
            await testBatchElevenLabsCalls();
            break;
        case 'mixed':
            await testBatchWithMixedPrompts();
            break;
        default:
            console.log('Usage: ./test-elevenlabs-context-fix.ts [single|batch|mixed]');
            console.log('\nRunning all tests...\n');
            await testSingleElevenLabsCall();
            await new Promise(resolve => setTimeout(resolve, 2000));
            await testBatchElevenLabsCalls();
            await new Promise(resolve => setTimeout(resolve, 2000));
            await testBatchWithMixedPrompts();
    }
}

// Run the script
main().catch(console.error);