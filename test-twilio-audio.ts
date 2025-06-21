import express from 'express';
import expressWs from 'express-ws';
import twilio from 'twilio';
import ngrok from '@ngrok/ngrok';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const app = express();
expressWs(app);

const PORT = 3005;

// Generate 20ms of silence (8kHz, 16-bit PCM, mono = 320 bytes, base64 encoded)
function generateSilence(): string {
    // 8000 Hz * 0.02 seconds * 2 bytes per sample = 320 bytes
    const silenceBuffer = Buffer.alloc(320, 0);
    return silenceBuffer.toString('base64');
}

app.post('/twiml', (req, res) => {
    const twiml = new twilio.twiml.VoiceResponse();
    const connect = twiml.connect();
    connect.stream({
        url: `wss://${req.headers.host}/stream`
    });
    
    res.type('text/xml');
    res.send(twiml.toString());
});

(app as any).ws('/stream', (ws: any, req: any) => {
    console.log('Twilio connected');
    
    let streamSid: string | null = null;
    let interval: NodeJS.Timeout | null = null;
    
    ws.on('message', (msg: string) => {
        const data = JSON.parse(msg);
        
        if (data.event === 'start') {
            streamSid = data.start.streamSid;
            console.log('Stream started:', streamSid);
            
            // Start sending silence every 20ms
            interval = setInterval(() => {
                if (streamSid) {
                    ws.send(JSON.stringify({
                        event: 'media',
                        streamSid: streamSid,
                        media: {
                            payload: generateSilence()
                        }
                    }));
                }
            }, 20);
            
        } else if (data.event === 'stop') {
            console.log('Stream stopped');
            if (interval) {
                clearInterval(interval);
            }
        }
    });
    
    ws.on('close', () => {
        console.log('Connection closed');
        if (interval) {
            clearInterval(interval);
        }
    });
});

async function startTest() {
    try {
        // Start server
        app.listen(PORT, () => {
            console.log(`Test server running on port ${PORT}`);
        });
        
        // Setup ngrok
        const listener = await ngrok.forward({
            addr: PORT,
            authtoken_from_env: true
        });
        const publicUrl = listener.url();
        console.log('Ngrok URL:', publicUrl);
        
        // Make test call
        const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        
        const call = await twilioClient.calls.create({
            from: process.env.TWILIO_PHONE_NUMBER!,
            to: process.env.TEST_PHONE_NUMBER!,
            url: `${publicUrl}/twiml`
        });
        
        console.log('Call initiated:', call.sid);
        console.log('You should hear silence (no static) if audio format is correct');
        
        // Run for 1 minute
        setTimeout(async () => {
            console.log('Test complete');
            await ngrok.disconnect();
            process.exit(0);
        }, 60000);
        
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

startTest();