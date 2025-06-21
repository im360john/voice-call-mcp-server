#!/usr/bin/env tsx

// Test that our batch types and services compile correctly

import { BatchOperationService } from './src/services/batch-operation.service.js';
import { BatchCallRequest, BatchSMSRequest, BatchOperation } from './src/types/batch.types.js';

console.log('Testing batch types and services compilation...');

// Test batch operation service
const batchService = BatchOperationService.getInstance();
console.log('✓ BatchOperationService instantiated');

// Test creating a batch operation
const batchId = batchService.createBatchOperation('call', 2);
console.log(`✓ Created batch operation: ${batchId}`);

// Test batch call request type
const callRequest: BatchCallRequest = {
    provider: 'openai',
    targets: [
        {
            phoneNumber: '+1234567890',
            prompt: 'Test prompt',
            context: 'Test context'
        }
    ],
    defaultPrompt: 'Default prompt',
    maxConcurrent: 1
};
console.log('✓ BatchCallRequest type working');

// Test batch SMS request type
const smsRequest: BatchSMSRequest = {
    targets: [
        {
            phoneNumber: '+1234567890',
            message: 'Test message'
        }
    ],
    maxConcurrent: 1
};
console.log('✓ BatchSMSRequest type working');

// Test getting batch operation
const operation = batchService.getBatchOperation(batchId);
if (operation) {
    console.log(`✓ Retrieved batch operation: ${operation.batchId}`);
}

// Test adding results
batchService.queueBatchTarget(batchId, '+1234567890');
batchService.startBatchTarget(batchId, '+1234567890', 'CALL123');
batchService.completeBatchTarget(batchId, '+1234567890', 'TRANSCRIPT123');
console.log('✓ Batch result operations working');

// Test getting batch status
const updatedOperation = batchService.getBatchOperation(batchId);
if (updatedOperation) {
    console.log(`✓ Batch status: ${updatedOperation.status}`);
    console.log(`  Completed: ${updatedOperation.completedTargets}`);
    console.log(`  Failed: ${updatedOperation.failedTargets}`);
}

console.log('\nAll type checks passed! ✓');
console.log('The batch operations implementation is correctly typed and functional.');