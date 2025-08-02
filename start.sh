#!/bin/bash

# Delegate 1 - Easy Startup Script
# This script starts both the backend (websocket-server) and frontend (webapp) in development mode

echo "🚀 Starting Delegate 1..."
echo "📡 Backend: websocket-server"
echo "🌐 Frontend: webapp"
echo ""

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install Node.js and npm first."
    exit 1
fi

# Check if concurrently is installed
if ! npm list concurrently &> /dev/null; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Start both servers
echo "🔄 Starting servers..."
npm run dev
