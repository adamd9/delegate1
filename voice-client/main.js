import { Device } from '@twilio/voice-sdk';

class VoiceClient {
    constructor() {
        this.device = null;
        this.connection = null;
        this.isConnected = false;
        
        // Get Twilio access token from environment or fallback to hardcoded
        this.accessToken = import.meta.env.VITE_TWILIO_ACCESS_TOKEN || 'YOUR_TWILIO_ACCESS_TOKEN_HERE';
        
        this.initializeElements();
        this.attachEventListeners();
        this.log('Voice client initialized', 'info');
        
        if (import.meta.env.VITE_TWILIO_ACCESS_TOKEN) {
            this.log('✅ Using access token from .env file', 'success');
        } else {
            this.log('⚠️ No .env token found, using hardcoded fallback', 'info');
            this.log('💡 Add VITE_TWILIO_ACCESS_TOKEN to your .env file', 'info');
        }
    }
    
    initializeElements() {
        this.statusEl = document.getElementById('status');
        this.connectBtn = document.getElementById('connectBtn');
        this.callBtn = document.getElementById('callBtn');
        this.hangupBtn = document.getElementById('hangupBtn');
        this.accessTokenInput = document.getElementById('accessToken');
        this.logsEl = document.getElementById('logs');
    }
    
    attachEventListeners() {
        this.connectBtn.addEventListener('click', () => this.initializeDevice());
        this.callBtn.addEventListener('click', () => this.startCall());
        this.hangupBtn.addEventListener('click', () => this.hangUp());
    }
    
    log(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry ${type}`;
        logEntry.textContent = `[${timestamp}] ${message}`;
        
        this.logsEl.appendChild(logEntry);
        this.logsEl.scrollTop = this.logsEl.scrollHeight;
        
        // Keep only last 50 log entries
        while (this.logsEl.children.length > 50) {
            this.logsEl.removeChild(this.logsEl.firstChild);
        }
    }
    
    updateStatus(status, className) {
        this.statusEl.textContent = status;
        this.statusEl.className = `status ${className}`;
    }
    
    async initializeDevice() {
        if (this.isConnected) {
            await this.disconnect();
            return;
        }
        
        try {
            this.updateStatus('Connecting to Backend...', 'connecting');
            this.connectBtn.disabled = true;
            
            // Get backend URL from input or use default
            const backendUrl = this.accessTokenInput.value.trim() || 'http://localhost:8081';
            
            this.log(`Requesting access token from: ${backendUrl}`, 'info');
            
            // Request access token from backend
            const response = await fetch(`${backendUrl}/access-token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    clientName: `voice-client-${Date.now()}`
                })
            });
            
            if (!response.ok) {
                throw new Error(`Backend responded with status: ${response.status}`);
            }
            
            const data = await response.json();
            this.log(`Backend response: ${data.message}`, 'info');
            
            // For now, we'll still need a hardcoded token until backend generates real ones
            const accessToken = this.accessToken;
            
            this.log(`🔍 Debug: Access token length: ${accessToken ? accessToken.length : 0}`, 'info');
            this.log(`🔍 Debug: Token starts with: ${accessToken ? accessToken.substring(0, 20) + '...' : 'null'}`, 'info');
            
            if (!accessToken || accessToken === 'YOUR_TWILIO_ACCESS_TOKEN_HERE') {
                this.log('❌ Backend connected, but still need a real Twilio access token', 'error');
                this.log('💡 Add your Twilio access token to the .env file', 'info');
                this.updateStatus('Token Required', 'disconnected');
                this.connectBtn.disabled = false;
                return;
            }
            
            this.log('✅ Backend connected! Initializing Twilio Device...', 'success');
            await this.initializeTwilioDevice(accessToken);
            
        } catch (error) {
            this.log(`🔍 Debug: Full error object:`, 'error');
            console.error('Full error:', error);
            this.log(`Backend connection failed: ${error?.message || 'Unknown error'}`, 'error');
            this.log('💡 Make sure your backend is running on the specified URL', 'info');
            this.updateStatus('Backend Connection Failed', 'disconnected');
            this.connectBtn.disabled = false;
        }
    }
    
    async initializeTwilioDevice(accessToken) {
        try {
            this.log('Initializing Twilio Device...', 'info');
            
            this.device = new Device(accessToken, {
                logLevel: 1,
                codecPreferences: ['opus', 'pcmu']
            });
            
            this.device.on('registered', () => {
                this.log('Twilio Device registered successfully', 'success');
                this.updateStatus('Connected & Ready', 'connected');
                this.isConnected = true;
                this.connectBtn.textContent = 'Disconnect';
                this.connectBtn.disabled = false;
                this.callBtn.disabled = false;
            });
            
            this.device.on('error', (error) => {
                this.log(`🔍 Debug: Twilio Device error code: ${error.code}`, 'error');
                this.log(`Twilio Device error: ${error.message}`, 'error');
                
                if (error.code === 20101) {
                    this.log('🔍 This is an AccessTokenInvalid error', 'error');
                    this.log('💡 Try generating a new token: node generate-token.js', 'info');
                    this.log('💡 Make sure your Twilio credentials are correct', 'info');
                }
                
                this.updateStatus('Device Error', 'disconnected');
                this.connectBtn.disabled = false;
            });
            
            this.device.on('incoming', (connection) => {
                this.log('Incoming call received', 'info');
                this.handleIncomingCall(connection);
            });
            
            await this.device.register();
            
        } catch (error) {
            this.log(`Failed to initialize Twilio Device: ${error.message}`, 'error');
            this.updateStatus('Device Initialization Failed', 'disconnected');
            this.connectBtn.disabled = false;
        }
    }
    
    async startCall() {
        try {
            if (!this.device) {
                this.log('Device not initialized', 'error');
                return;
            }
            
            this.log('Starting outbound call...', 'info');
            this.callBtn.disabled = true;
            
            // Make a call - for testing, you can call any TwiML app or phone number
            // Replace 'client:test' with your desired destination
            const params = {
                To: 'client:test', // Call another Twilio client or use a phone number like '+1234567890'
                From: 'voice-client'
            };
            
            this.connection = await this.device.connect(params);
            
            this.connection.on('accept', () => {
                this.log('Call connected successfully', 'success');
                this.updateStatus('In Call', 'connected');
                this.hangupBtn.disabled = false;
            });
            
            this.connection.on('disconnect', () => {
                this.log('Call disconnected', 'info');
                this.updateStatus('Connected & Ready', 'connected');
                this.callBtn.disabled = false;
                this.hangupBtn.disabled = true;
                this.connection = null;
            });
            
            this.connection.on('error', (error) => {
                this.log(`Call error: ${error.message}`, 'error');
                this.callBtn.disabled = false;
                this.hangupBtn.disabled = true;
            });
            
        } catch (error) {
            this.log(`Failed to start call: ${error.message}`, 'error');
            this.callBtn.disabled = false;
        }
    }
    
    hangUp() {
        if (this.connection) {
            this.log('Hanging up call...', 'info');
            this.connection.disconnect();
        }
    }
    
    handleIncomingCall(connection) {
        this.log(`Incoming call from: ${connection.parameters.From}`, 'info');
        
        // Auto-accept incoming calls for testing
        connection.accept();
        this.connection = connection;
        
        this.updateStatus('In Call (Incoming)', 'connected');
        this.callBtn.disabled = true;
        this.hangupBtn.disabled = false;
        
        connection.on('disconnect', () => {
            this.log('Incoming call disconnected', 'info');
            this.updateStatus('Connected & Ready', 'connected');
            this.callBtn.disabled = false;
            this.hangupBtn.disabled = true;
            this.connection = null;
        });
    }
    
    async disconnect() {
        try {
            this.log('Disconnecting...', 'info');
            
            if (this.connection) {
                this.connection.disconnect();
                this.connection = null;
            }
            
            if (this.device) {
                this.device.destroy();
                this.device = null;
            }
            
            this.isConnected = false;
            this.updateStatus('Disconnected', 'disconnected');
            this.connectBtn.textContent = 'Initialize Twilio Device';
            this.connectBtn.disabled = false;
            this.callBtn.disabled = true;
            this.hangupBtn.disabled = true;
            
            this.log('Disconnected successfully', 'success');
            
        } catch (error) {
            this.log(`Disconnect error: ${error.message}`, 'error');
        }
    }
}

// Initialize the voice client when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new VoiceClient();
});
