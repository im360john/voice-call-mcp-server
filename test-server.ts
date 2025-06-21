#!/usr/bin/env tsx

// Simple test server to verify batch operations
import express from 'express';
import dotenv from 'dotenv';
import twilio from 'twilio';
import { VoiceServer } from './src/servers/voice.server.js';
import { CallSessionManager } from './src/handlers/openai.handler.js';
import { TwilioCallService } from './src/services/twilio/call.service.js';
import { TwilioSMSService } from './src/services/twilio/sms.service.js';

dotenv.config();

const PORT = process.env.PORT || 3004;
const CALLBACK_URL = process.env.CALLBACK_URL || `http://localhost:${PORT}`;

// Create Twilio client
const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

// Create services
const twilioCallService = new TwilioCallService(twilioClient);
const twilioSMSService = new TwilioSMSService(twilioClient);

// Create session manager
const sessionManager = new CallSessionManager(twilioClient);

// Create and start voice server
const voiceServer = new VoiceServer(
    CALLBACK_URL,
    sessionManager,
    twilioCallService,
    twilioSMSService
);

console.log(`Starting test server on port ${PORT}...`);
voiceServer.start();
console.log(`Server running at http://localhost:${PORT}`);
console.log('\nAvailable endpoints:');
console.log('- POST /batch/calls');
console.log('- POST /batch/sms');
console.log('- GET /batch/calls/:batchId');
console.log('- GET /batch/sms/:batchId');
console.log('- GET /batch/calls/:batchId/transcripts');
console.log('- GET /batch/calls/:batchId/events');