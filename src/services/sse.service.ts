import { Request, Response } from 'express';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

export interface SSEClient {
  id: string;
  response: Response;
  callSid?: string;
}

export interface SSEEvent {
  type: string;
  data: any;
  id?: string;
}

export type SSEEventTypes = {
  'connected': { clientId: string };
  'call-status': { callSid: string; status: string; from: string; to: string; timestamp: Date };
  'transcription': { callSid: string; transcription: string; speaker: 'ai' | 'human'; timestamp: Date };
  'call-ended': { callSid: string; duration: number; recordingUrl?: string; timestamp: Date };
  'error': { callSid: string; error: string; code: string; timestamp: Date };
  'heartbeat': { timestamp: Date };
};

export class SSEManager {
  private clients: Map<string, SSEClient> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private readonly HEARTBEAT_INTERVAL = 30000; // 30 seconds

  constructor() {
    this.startHeartbeat();
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.broadcast('heartbeat', { timestamp: new Date() });
    }, this.HEARTBEAT_INTERVAL);
  }

  public addClient(clientId: string, res: Response, callSid?: string): void {
    const client: SSEClient = { id: clientId, response: res, callSid };
    this.clients.set(clientId, client);

    res.on('close', () => {
      this.removeClient(clientId);
    });

    this.sendToClient(clientId, 'connected', { clientId });
  }

  public removeClient(clientId: string): void {
    this.clients.delete(clientId);
  }

  public broadcast(event: string, data: any): void {
    const sseEvent = this.formatEvent(event, data);
    
    this.clients.forEach((client) => {
      try {
        client.response.write(sseEvent);
      } catch (error) {
        console.error(`Error broadcasting to client ${client.id}:`, error);
        this.removeClient(client.id);
      }
    });
  }

  public broadcastToCall(callSid: string, event: string, data: any): void {
    const sseEvent = this.formatEvent(event, data);
    
    this.clients.forEach((client) => {
      if (client.callSid === callSid) {
        try {
          client.response.write(sseEvent);
        } catch (error) {
          console.error(`Error broadcasting to client ${client.id}:`, error);
          this.removeClient(client.id);
        }
      }
    });
  }

  public sendToClient(clientId: string, event: string, data: any): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    const sseEvent = this.formatEvent(event, data);
    
    try {
      client.response.write(sseEvent);
    } catch (error) {
      console.error(`Error sending to client ${clientId}:`, error);
      this.removeClient(clientId);
    }
  }

  private formatEvent(event: string, data: any): string {
    const eventId = uuidv4();
    const eventData = JSON.stringify(data);
    return `id: ${eventId}\nevent: ${event}\ndata: ${eventData}\n\n`;
  }

  public getClientCount(): number {
    return this.clients.size;
  }

  public cleanup(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    this.clients.clear();
  }
}

export const sseManager = new SSEManager();

export const callEventEmitter = new EventEmitter();

callEventEmitter.on('call:status', (data: SSEEventTypes['call-status']) => {
  sseManager.broadcastToCall(data.callSid, 'call-status', data);
});

callEventEmitter.on('call:transcription', (data: SSEEventTypes['transcription']) => {
  sseManager.broadcastToCall(data.callSid, 'transcription', data);
});

callEventEmitter.on('call:ended', (data: SSEEventTypes['call-ended']) => {
  sseManager.broadcastToCall(data.callSid, 'call-ended', data);
});

callEventEmitter.on('call:error', (data: SSEEventTypes['error']) => {
  sseManager.broadcastToCall(data.callSid, 'error', data);
});

export function handleSSE(req: Request, res: Response): void {
  const clientId = req.query.clientId as string || uuidv4();
  const callSid = req.query.callSid as string;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'X-Accel-Buffering': 'no',
  });

  sseManager.addClient(clientId, res, callSid);

  req.on('close', () => {
    sseManager.removeClient(clientId);
  });
}