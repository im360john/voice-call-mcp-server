import express from "express";
import WebSocket from "ws";
import dotenv from "dotenv";
import expressWs from "express-ws";
import twilio from "twilio";
import ngrok from "@ngrok/ngrok";
import axios from "axios";

dotenv.config({ path: '.env' });

const {
  ELEVENLABS_API_KEY,
  ELEVENLABS_AGENT_ID,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
  TEST_PHONE_NUMBER
} = process.env;

const app = express();
expressWs(app);

const PORT = 3006;

// Helper function to get signed URL
async function getSignedUrl() {
  try {
    const response = await axios.get(
      `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${ELEVENLABS_AGENT_ID}`,
      {
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
        },
      }
    );
    return response.data.signed_url;
  } catch (error) {
    console.error("Error getting signed URL:", error);
    throw error;
  }
}

// TwiML endpoint
app.post("/twiml", (req, res) => {
  const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Connect>
          <Stream url="wss://${req.headers.host}/media-stream">
            <Parameter name="prompt" value="You are a helpful assistant" />
            <Parameter name="first_message" value="Hello! How can I help you today?" />
          </Stream>
        </Connect>
      </Response>`;

  res.type("text/xml").send(twimlResponse);
});

// WebSocket route - EXACT COPY of working example
(app as any).ws("/media-stream", (ws: any, req: any) => {
  console.info("[Server] Twilio connected to media stream");

  let streamSid: string | null = null;
  let callSid: string | null = null;
  let elevenLabsWs: WebSocket | null = null;
  let customParameters: any = null;

  ws.on("error", console.error);

  // Set up ElevenLabs connection
  const setupElevenLabs = async () => {
    try {
      const signedUrl = await getSignedUrl();
      elevenLabsWs = new WebSocket(signedUrl);

      elevenLabsWs.on("open", () => {
        console.log("[ElevenLabs] Connected to Conversational AI");

        const initialConfig = {
          type: "conversation_initiation_client_data",
          conversation_config_override: {
            agent: {
              prompt: {
                prompt: customParameters?.prompt || "you are a helpful assistant",
              },
              first_message: customParameters?.first_message || "Hello! How can I help you today?",
            },
          },
        };

        console.log("[ElevenLabs] Sending initial config");
        elevenLabsWs.send(JSON.stringify(initialConfig));
      });

      elevenLabsWs.on("message", (data) => {
        try {
          const message = JSON.parse(data.toString());

          switch (message.type) {
            case "conversation_initiation_metadata":
              console.log("[ElevenLabs] Received initiation metadata");
              break;

            case "audio":
              if (streamSid) {
                if (message.audio?.chunk) {
                  const audioData = {
                    event: "media",
                    streamSid,
                    media: {
                      payload: message.audio.chunk,
                    },
                  };
                  ws.send(JSON.stringify(audioData));
                } else if (message.audio_event?.audio_base_64) {
                  const audioData = {
                    event: "media",
                    streamSid,
                    media: {
                      payload: message.audio_event.audio_base_64,
                    },
                  };
                  ws.send(JSON.stringify(audioData));
                }
              }
              break;

            case "interruption":
              if (streamSid) {
                ws.send(JSON.stringify({
                  event: "clear",
                  streamSid,
                }));
              }
              break;

            case "ping":
              if (message.ping_event?.event_id) {
                elevenLabsWs.send(JSON.stringify({
                  type: "pong",
                  event_id: message.ping_event.event_id,
                }));
              }
              break;

            case "agent_response":
              console.log(`[ElevenLabs] Agent: ${message.agent_response_event?.agent_response}`);
              break;

            case "user_transcript":
              console.log(`[ElevenLabs] User: ${message.user_transcription_event?.user_transcript}`);
              break;
          }
        } catch (error) {
          console.error("[ElevenLabs] Error processing message:", error);
        }
      });

      elevenLabsWs.on("error", (error) => {
        console.error("[ElevenLabs] WebSocket error:", error);
      });

      elevenLabsWs.on("close", () => {
        console.log("[ElevenLabs] Disconnected");
      });
    } catch (error) {
      console.error("[ElevenLabs] Setup error:", error);
    }
  };

  // Set up ElevenLabs immediately
  setupElevenLabs();

  // Handle Twilio messages
  ws.on("message", (message: string) => {
    try {
      const msg = JSON.parse(message);
      
      if (msg.event !== "media") {
        console.log(`[Twilio] Received event: ${msg.event}`);
      }

      switch (msg.event) {
        case "start":
          streamSid = msg.start.streamSid;
          callSid = msg.start.callSid;
          customParameters = msg.start.customParameters;
          console.log(`[Twilio] Stream started - StreamSid: ${streamSid}, CallSid: ${callSid}`);
          break;

        case "media":
          if (elevenLabsWs?.readyState === WebSocket.OPEN) {
            const audioMessage = {
              user_audio_chunk: Buffer.from(msg.media.payload, "base64").toString("base64"),
            };
            elevenLabsWs.send(JSON.stringify(audioMessage));
          }
          break;

        case "stop":
          console.log(`[Twilio] Stream ${streamSid} ended`);
          if (elevenLabsWs?.readyState === WebSocket.OPEN) {
            elevenLabsWs.close();
          }
          break;
      }
    } catch (error) {
      console.error("[Twilio] Error processing message:", error);
    }
  });

  ws.on("close", () => {
    console.log("[Twilio] Client disconnected");
    if (elevenLabsWs?.readyState === WebSocket.OPEN) {
      elevenLabsWs.close();
    }
  });
});

async function startTest() {
  try {
    app.listen(PORT, () => {
      console.log(`Test server on port ${PORT}`);
    });

    const listener = await ngrok.forward({
      addr: PORT,
      authtoken_from_env: true
    });
    const publicUrl = listener.url();
    console.log("Public URL:", publicUrl);

    const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    
    const call = await twilioClient.calls.create({
      from: TWILIO_PHONE_NUMBER!,
      to: TEST_PHONE_NUMBER!,
      url: `${publicUrl}/twiml`
    });

    console.log("Call initiated:", call.sid);
    console.log("This should work exactly like the example");

    setTimeout(async () => {
      console.log("Test complete");
      await ngrok.disconnect();
      process.exit(0);
    }, 120000);

  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

startTest();