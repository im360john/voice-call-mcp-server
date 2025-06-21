#!/usr/bin/env tsx

// Simple test script for batch operations API
// This tests the API endpoints directly without starting the full server

import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const API_URL = 'http://localhost:3004';

// Test data - replace with your test phone numbers
const TEST_NUMBERS = [
    '+1234567890',
    '+0987654321'
];

async function testBatchCallsEndpoint() {
    console.log('Testing POST /batch/calls endpoint...');
    
    const request = {
        provider: 'openai',
        targets: TEST_NUMBERS.map((number, index) => ({
            phoneNumber: number,
            prompt: `Test prompt ${index + 1}`,
            context: `Test context ${index + 1}`
        })),
        defaultPrompt: 'Default test prompt',
        maxConcurrent: 1
    };

    try {
        const response = await axios.post(`${API_URL}/batch/calls`, request);
        console.log('✓ Batch calls endpoint working:', response.data);
        return response.data.batchId;
    } catch (error) {
        console.error('✗ Batch calls endpoint failed:', error.response?.data || error.message);
        return null;
    }
}

async function testBatchSMSEndpoint() {
    console.log('\nTesting POST /batch/sms endpoint...');
    
    const request = {
        targets: TEST_NUMBERS.map((number, index) => ({
            phoneNumber: number,
            message: `Test SMS message ${index + 1}`
        })),
        maxConcurrent: 1
    };

    try {
        const response = await axios.post(`${API_URL}/batch/sms`, request);
        console.log('✓ Batch SMS endpoint working:', response.data);
        return response.data.batchId;
    } catch (error) {
        console.error('✗ Batch SMS endpoint failed:', error.response?.data || error.message);
        return null;
    }
}

async function testBatchStatusEndpoint(batchId: string, type: 'calls' | 'sms') {
    console.log(`\nTesting GET /batch/${type}/${batchId} endpoint...`);
    
    try {
        const response = await axios.get(`${API_URL}/batch/${type}/${batchId}`);
        console.log(`✓ Batch status endpoint working:`, response.data);
        return true;
    } catch (error) {
        console.error(`✗ Batch status endpoint failed:`, error.response?.data || error.message);
        return false;
    }
}

async function testBatchTranscriptsEndpoint(batchId: string) {
    console.log(`\nTesting GET /batch/calls/${batchId}/transcripts endpoint...`);
    
    try {
        const response = await axios.get(`${API_URL}/batch/calls/${batchId}/transcripts`);
        console.log(`✓ Batch transcripts endpoint working:`, response.data);
        return true;
    } catch (error) {
        console.error(`✗ Batch transcripts endpoint failed:`, error.response?.data || error.message);
        return false;
    }
}

async function checkServerHealth() {
    console.log('Checking if server is running...');
    
    try {
        await axios.get(`${API_URL}/events`);
        console.log('✓ Server is running');
        return true;
    } catch (error) {
        console.error('✗ Server is not responding. Please start the server first.');
        console.log('Run: npm run start:http');
        return false;
    }
}

async function main() {
    console.log('Batch Operations API Test');
    console.log('=========================\n');
    
    // Check if server is running
    const isServerRunning = await checkServerHealth();
    if (!isServerRunning) {
        return;
    }
    
    // Test batch calls
    const callBatchId = await testBatchCallsEndpoint();
    if (callBatchId) {
        await testBatchStatusEndpoint(callBatchId, 'calls');
        await testBatchTranscriptsEndpoint(callBatchId);
    }
    
    // Test batch SMS
    const smsBatchId = await testBatchSMSEndpoint();
    if (smsBatchId) {
        await testBatchStatusEndpoint(smsBatchId, 'sms');
    }
    
    console.log('\nTest complete!');
}

main().catch(console.error);