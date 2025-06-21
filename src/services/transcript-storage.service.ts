import { v4 as uuidv4 } from 'uuid';
import { CallState } from '../types.js';

export interface TranscriptEntry {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface StoredTranscript {
  transcriptId: string;
  callSid: string;
  from: string;
  to: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  entries: TranscriptEntry[];
  metadata?: {
    callContext?: string;
    recordingUrl?: string;
  };
}

export class TranscriptStorageService {
  private transcripts: Map<string, StoredTranscript> = new Map();
  private callToTranscriptMap: Map<string, string> = new Map();

  /**
   * Create a new transcript for a call
   */
  public createTranscript(callState: CallState): string {
    const transcriptId = uuidv4();
    
    const transcript: StoredTranscript = {
      transcriptId,
      callSid: callState.callSid,
      from: callState.fromNumber,
      to: callState.toNumber,
      startTime: new Date(),
      entries: [],
      metadata: {
        callContext: callState.callContext
      }
    };

    this.transcripts.set(transcriptId, transcript);
    this.callToTranscriptMap.set(callState.callSid, transcriptId);
    
    return transcriptId;
  }

  /**
   * Add a transcript entry
   */
  public addEntry(callSid: string, role: 'user' | 'assistant', content: string): void {
    const transcriptId = this.callToTranscriptMap.get(callSid);
    if (!transcriptId) {
      console.log(`[TranscriptStorage] WARNING: No transcript ID found for callSid: ${callSid}`);
      return;
    }

    const transcript = this.transcripts.get(transcriptId);
    if (!transcript) {
      console.log(`[TranscriptStorage] WARNING: No transcript found for ID: ${transcriptId}`);
      return;
    }

    transcript.entries.push({
      role,
      content,
      timestamp: new Date()
    });
    
    console.log(`[TranscriptStorage] Added entry for ${role}: "${content.substring(0, 50)}..." (${transcript.entries.length} total entries)`);
  }

  /**
   * Finalize a transcript when call ends
   */
  public finalizeTranscript(callSid: string, duration?: number, recordingUrl?: string): void {
    const transcriptId = this.callToTranscriptMap.get(callSid);
    if (!transcriptId) return;

    const transcript = this.transcripts.get(transcriptId);
    if (!transcript) return;

    transcript.endTime = new Date();
    transcript.duration = duration;
    if (recordingUrl && transcript.metadata) {
      transcript.metadata.recordingUrl = recordingUrl;
    }
  }

  /**
   * Get a transcript by ID
   */
  public getTranscript(transcriptId: string): StoredTranscript | undefined {
    const transcript = this.transcripts.get(transcriptId);
    console.log(`[TranscriptStorage] Getting transcript by ID: ${transcriptId}, found: ${!!transcript}, entries: ${transcript?.entries.length || 0}`);
    return transcript;
  }

  /**
   * Get transcript ID by call SID
   */
  public getTranscriptIdByCallSid(callSid: string): string | undefined {
    const transcriptId = this.callToTranscriptMap.get(callSid);
    console.log(`[TranscriptStorage] Getting transcript ID by callSid: ${callSid}, found: ${transcriptId}`);
    return transcriptId;
  }

  /**
   * Generate a summary of the transcript
   */
  public generateSummary(transcriptId: string): string | undefined {
    const transcript = this.transcripts.get(transcriptId);
    if (!transcript) return undefined;

    const duration = transcript.duration 
      ? `${Math.floor(transcript.duration / 60)}m ${transcript.duration % 60}s`
      : 'Unknown';

    const conversationText = transcript.entries
      .map(entry => `${entry.role === 'user' ? 'Human' : 'AI'}: ${entry.content}`)
      .join('\n');

    return `Call Summary:
- From: ${transcript.from}
- To: ${transcript.to}
- Duration: ${duration}
- Context: ${transcript.metadata?.callContext || 'None provided'}
- Start Time: ${transcript.startTime.toISOString()}
- End Time: ${transcript.endTime?.toISOString() || 'Ongoing'}

Conversation:
${conversationText}`;
  }

  /**
   * Get all transcript IDs
   */
  public getAllTranscriptIds(): string[] {
    return Array.from(this.transcripts.keys());
  }
}

// Singleton instance
export const transcriptStorage = new TranscriptStorageService();