# SMS Opt-In/Out Feature Documentation

## Overview

This feature provides a compliant SMS opt-in/opt-out system with 10DLC (10-Digit Long Code) compliance for inventory notification messages.

## Features

### 1. Static Opt-In/Out Page
- **URL**: `/sms-preferences`
- **Purpose**: Allows customers to manage their SMS notification preferences
- **Features**:
  - Clean, mobile-responsive design
  - Clear 10DLC compliance messaging
  - Real-time phone number formatting
  - Instant opt-in/opt-out functionality
  - Confirmation messages sent upon preference changes

### 2. SMS Preferences API

#### POST `/sms/preferences`
Manages opt-in/opt-out requests.

**Request Body**:
```json
{
  "phoneNumber": "+15551234567",
  "action": "opt-in" // or "opt-out"
}
```

**Response**:
```json
{
  "success": true,
  "preference": {
    "phoneNumber": "+15551234567",
    "optedIn": true,
    "optInDate": "2024-01-15T10:30:00Z",
    "lastModified": "2024-01-15T10:30:00Z"
  }
}
```

#### GET `/sms/preferences/:phoneNumber`
Retrieves current preference status for a phone number.

**Response**:
```json
{
  "phoneNumber": "+15551234567",
  "optedIn": true,
  "optInDate": "2024-01-15T10:30:00Z",
  "optOutDate": null,
  "lastModified": "2024-01-15T10:30:00Z"
}
```

### 3. Opt-In Enforcement
- All SMS messages (except system confirmations) require opt-in
- Batch SMS operations respect opt-in status
- Failed attempts due to opt-out are logged and reported

## Multiple NGROK Domain Support

### Configuration
Set multiple comma-separated domains in the `NGROK_DOMAIN` environment variable:

```bash
NGROK_DOMAIN=domain1.ngrok-free.app,domain2.ngrok-free.app,domain3.ngrok-free.app
```

### Failover Behavior
1. Attempts each domain in order
2. If a domain is already in use, tries to disconnect and reconnect
3. Falls back to the next domain on failure
4. If all domains fail, attempts to use a random ngrok domain
5. Provides detailed error logging for troubleshooting

### Benefits
- Increased reliability
- Automatic failover when domains are unavailable
- Better handling of "endpoint already online" errors
- Comprehensive error reporting

## Usage Examples

### Customer Opt-In Flow
1. Customer visits `/sms-preferences`
2. Enters phone number
3. Clicks "Opt In to Notifications"
4. Receives confirmation SMS
5. Now eligible to receive inventory notifications

### Sending SMS with Opt-In Check
```typescript
// Regular SMS (requires opt-in)
await smsService.sendSMS(phoneNumber, message);

// System message (bypasses opt-in check)
await smsService.sendSMS(phoneNumber, message, undefined, true);
```

### Batch SMS
Batch SMS operations automatically check opt-in status for each recipient:
```typescript
const batchId = await smsService.sendBatchSMS({
  targets: [
    { phoneNumber: '+15551234567', message: 'Low stock alert' },
    { phoneNumber: '+15551234568', message: 'Reorder reminder' }
  ],
  maxConcurrent: 5
});
```

## Compliance Notes

1. **10DLC Registration**: Ensure your messaging use case is registered with carriers
2. **Message Content**: Keep messages transactional and relevant to inventory management
3. **Opt-Out Handling**: Always honor opt-out requests immediately
4. **Record Keeping**: The system maintains opt-in/out timestamps for compliance
5. **Confirmation Messages**: System sends confirmations for both opt-in and opt-out actions

## Best Practices

1. **Clear Messaging**: Always explain what types of messages customers will receive
2. **Easy Opt-Out**: Provide clear instructions for opting out (e.g., "Reply STOP")
3. **Regular Audits**: Periodically review opt-in lists and message logs
4. **Testing**: Test with multiple phone numbers to ensure proper functionality
5. **Documentation**: Keep records of opt-in/out requests for compliance purposes