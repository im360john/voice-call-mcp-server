// Test to understand the audio format difference

// Twilio expects mulaw 8kHz audio in 20ms chunks
// 8000 Hz * 0.02 seconds = 160 samples
// mulaw is 1 byte per sample = 160 bytes
// Base64 encoded = ~214 characters

// ElevenLabs is sending chunks of 43552 characters
// That's approximately 32664 bytes of raw audio
// At 8kHz mulaw, that's about 4 seconds of audio!

// The issue might be that we're sending too much audio at once
// Twilio might expect smaller chunks

console.log('Expected Twilio chunk size (20ms @ 8kHz mulaw):');
console.log('- Raw bytes:', 160);
console.log('- Base64 characters:', Math.ceil(160 * 4/3));

console.log('\nElevenLabs chunk size:');
console.log('- Base64 characters:', 43552);
console.log('- Raw bytes:', Math.floor(43552 * 3/4));
console.log('- Duration at 8kHz:', Math.floor(43552 * 3/4) / 8000, 'seconds');

console.log('\nElevenLabs might be sending PCM 16-bit audio:');
const pcmBytes = Math.floor(43552 * 3/4);
console.log('- If 16kHz 16-bit mono:', pcmBytes / (16000 * 2), 'seconds');
console.log('- If 24kHz 16-bit mono:', pcmBytes / (24000 * 2), 'seconds');