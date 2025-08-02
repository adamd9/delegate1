# Voice Client (Integrated)

> **Note**: The voice client functionality has been integrated into the main webapp at `/voice`. This documentation is preserved for reference.

A lightweight Twilio Voice WebRTC client for testing voice functionality with the Delegate 1 backend without requiring a Twilio phone number.

## Overview

The voice client uses the Twilio Voice JavaScript SDK to establish WebRTC connections directly to your Delegate 1 backend. It's perfect for development and testing scenarios where you want to test voice functionality without setting up phone numbers or webhooks.

## Features

- **WebRTC Voice Calls**: Direct browser-to-backend voice communication
- **Real-time Connection Status**: Visual feedback on connection and call states
- **Live Logging**: Real-time logs of all voice events and backend communication
- **Modern React UI**: Clean, responsive interface built with Next.js and Tailwind CSS
- **Backend Integration**: Seamless integration with Delegate 1's websocket-server

## Access

The voice client is now integrated into the main webapp and accessible at:

```
http://localhost:3000/voice
```

## Usage

1. **Start the webapp**: `npm run dev` from the webapp directory
2. **Navigate to voice client**: Go to `http://localhost:3000/voice`
3. **Configure backend URL**: Enter your backend URL (default: `http://localhost:8081`)
4. **Initialize Device**: Click "Initialize Twilio Device" to connect
5. **Make calls**: Use the "Call" button to test voice functionality

## Backend Requirements

- Running Delegate 1 websocket-server on port 8081 (or configured port)
- Valid Twilio credentials configured in backend
- Backend must provide `/access-token` endpoint for dynamic token generation

## Technical Details

- Built with React and TypeScript
- Uses Twilio Voice SDK v2.11.0
- Integrated with Next.js routing at `/voice`
- Real-time logging and status updates
- Responsive design with Tailwind CSS

## Troubleshooting

- Ensure backend is running and accessible
- Check browser console for WebRTC errors
- Verify Twilio credentials in backend configuration
- For AU1 region accounts, ensure proper region configuration in backend token generation
