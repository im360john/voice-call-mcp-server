import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import {
  BatchOperation,
  BatchOperationType,
  BatchOperationStatus,
  BatchResult,
  BatchResultStatus,
  BatchEventData,
  BatchTranscriptSummary,
  BatchSMSSummary
} from '../types/batch.types.js';

export class BatchOperationService extends EventEmitter {
  private static instance: BatchOperationService;
  private operations: Map<string, BatchOperation>;

  private constructor() {
    super();
    this.operations = new Map();
  }

  static getInstance(): BatchOperationService {
    if (!BatchOperationService.instance) {
      BatchOperationService.instance = new BatchOperationService();
    }
    return BatchOperationService.instance;
  }

  createBatchOperation(
    type: BatchOperationType,
    totalTargets: number,
    config?: BatchOperation['config']
  ): string {
    const batchId = uuidv4();
    const operation: BatchOperation = {
      batchId,
      type,
      status: 'pending',
      totalTargets,
      completedTargets: 0,
      failedTargets: 0,
      results: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      config
    };

    this.operations.set(batchId, operation);
    this.emitBatchEvent(batchId, 'progress', {
      currentProgress: 0,
      totalTargets,
      status: 'pending'
    });

    return batchId;
  }

  updateBatchStatus(batchId: string, status: BatchOperationStatus): void {
    const operation = this.operations.get(batchId);
    if (!operation) {
      throw new Error(`Batch operation ${batchId} not found`);
    }

    operation.status = status;
    operation.updatedAt = new Date();
    
    this.emitBatchEvent(batchId, 'progress', {
      currentProgress: operation.completedTargets + operation.failedTargets,
      totalTargets: operation.totalTargets,
      status
    });
  }

  addBatchResult(batchId: string, result: BatchResult): void {
    const operation = this.operations.get(batchId);
    if (!operation) {
      throw new Error(`Batch operation ${batchId} not found`);
    }

    // Update existing result or add new one
    const existingIndex = operation.results.findIndex(
      r => r.phoneNumber === result.phoneNumber
    );

    if (existingIndex >= 0) {
      operation.results[existingIndex] = result;
    } else {
      operation.results.push(result);
    }

    // Update counters
    if (result.status === 'success') {
      operation.completedTargets++;
    } else if (result.status === 'failed') {
      operation.failedTargets++;
    }

    operation.updatedAt = new Date();

    // Check if batch is complete
    const totalProcessed = operation.completedTargets + operation.failedTargets;
    if (totalProcessed >= operation.totalTargets) {
      if (operation.failedTargets === 0) {
        operation.status = 'completed';
      } else if (operation.completedTargets === 0) {
        operation.status = 'failed';
      } else {
        operation.status = 'partial_complete';
      }
      
      this.emitBatchEvent(batchId, 'complete', {
        status: operation.status
      });
    } else {
      this.emitBatchEvent(batchId, 'progress', {
        currentProgress: totalProcessed,
        totalTargets: operation.totalTargets,
        status: operation.status
      });
    }

    // Emit result event
    this.emitBatchEvent(batchId, 'result', { result });
  }

  updateBatchResult(
    batchId: string,
    phoneNumber: string,
    updates: Partial<BatchResult>
  ): void {
    const operation = this.operations.get(batchId);
    if (!operation) {
      throw new Error(`Batch operation ${batchId} not found`);
    }

    const result = operation.results.find(r => r.phoneNumber === phoneNumber);
    if (!result) {
      throw new Error(`Result for ${phoneNumber} not found in batch ${batchId}`);
    }

    // Update result
    Object.assign(result, updates);
    operation.updatedAt = new Date();

    // Recalculate counters if status changed
    if (updates.status) {
      this.recalculateCounters(operation);
    }

    this.emitBatchEvent(batchId, 'result', { result });
  }

  getBatchOperation(batchId: string): BatchOperation | null {
    return this.operations.get(batchId) || null;
  }

  listBatchOperations(
    type?: BatchOperationType,
    status?: BatchOperationStatus
  ): BatchOperation[] {
    const operations = Array.from(this.operations.values());
    
    return operations.filter(op => {
      if (type && op.type !== type) return false;
      if (status && op.status !== status) return false;
      return true;
    }).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  getBatchResults(batchId: string, status?: BatchResultStatus): BatchResult[] {
    const operation = this.operations.get(batchId);
    if (!operation) {
      return [];
    }

    if (status) {
      return operation.results.filter(r => r.status === status);
    }

    return operation.results;
  }

  queueBatchTarget(
    batchId: string,
    phoneNumber: string,
    metadata?: Record<string, any>
  ): void {
    const result: BatchResult = {
      phoneNumber,
      status: 'queued',
      startTime: new Date(),
      metadata
    };

    this.addBatchResult(batchId, result);
  }

  startBatchTarget(
    batchId: string,
    phoneNumber: string,
    callSid?: string,
    messageSid?: string
  ): void {
    this.updateBatchResult(batchId, phoneNumber, {
      status: 'in_progress',
      callSid,
      messageSid,
      startTime: new Date()
    });
  }

  completeBatchTarget(
    batchId: string,
    phoneNumber: string,
    transcriptId?: string,
    conversationId?: string
  ): void {
    this.updateBatchResult(batchId, phoneNumber, {
      status: 'success',
      transcriptId,
      conversationId,
      endTime: new Date()
    });
  }

  failBatchTarget(
    batchId: string,
    phoneNumber: string,
    error: string,
    retryCount?: number
  ): void {
    this.updateBatchResult(batchId, phoneNumber, {
      status: 'failed',
      error,
      retryCount,
      endTime: new Date()
    });
  }

  retryBatchTarget(batchId: string, phoneNumber: string): void {
    const operation = this.operations.get(batchId);
    if (!operation) return;

    const result = operation.results.find(r => r.phoneNumber === phoneNumber);
    if (!result) return;

    const retryCount = (result.retryCount || 0) + 1;
    
    this.updateBatchResult(batchId, phoneNumber, {
      status: 'retrying',
      retryCount,
      startTime: new Date(),
      endTime: undefined,
      error: undefined
    });
  }

  private recalculateCounters(operation: BatchOperation): void {
    operation.completedTargets = operation.results.filter(
      r => r.status === 'success'
    ).length;
    
    operation.failedTargets = operation.results.filter(
      r => r.status === 'failed'
    ).length;
  }

  private emitBatchEvent(
    batchId: string,
    type: BatchEventData['type'],
    data: BatchEventData['data']
  ): void {
    const event: BatchEventData = {
      batchId,
      type,
      data
    };

    this.emit('batch:update', event);
    this.emit(`batch:${batchId}:update`, event);
  }

  // Cleanup old operations (optional, for memory management)
  cleanupOldOperations(olderThanDays: number = 7): number {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
    
    let cleaned = 0;
    for (const [batchId, operation] of this.operations.entries()) {
      if (operation.updatedAt < cutoffDate && 
          (operation.status === 'completed' || operation.status === 'failed')) {
        this.operations.delete(batchId);
        cleaned++;
      }
    }
    
    return cleaned;
  }
}