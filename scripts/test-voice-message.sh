#!/usr/bin/env bash
#
# Test the voice-message endpoint with a real audio file.
#
# Usage:
#   ./scripts/test-voice-message.sh [audio_file] [base_url]
#
# Examples:
#   ./scripts/test-voice-message.sh                           # generate a silent WAV, send to localhost
#   ./scripts/test-voice-message.sh recording.opus            # send a real file to localhost
#   ./scripts/test-voice-message.sh recording.opus https://hk.api.mdlg.dev  # send to prod
#
# The script generates a short silent WAV if no file is provided, sends it to
# the voice-message endpoint, and prints the response with timing info.

set -euo pipefail

AUDIO_FILE="${1:-}"
BASE_URL="${2:-http://localhost:8081}"
ENDPOINT="${BASE_URL}/api/voice/message"
GENERATED=""

# Generate a short silent WAV for testing if no file provided
if [ -z "$AUDIO_FILE" ]; then
  AUDIO_FILE="$(mktemp /tmp/test-audio-XXXXXX.wav)"
  GENERATED="$AUDIO_FILE"
  # 1 second of silence: 16-bit PCM, 16kHz, mono
  python3 -c "
import struct, sys
sr, dur, bits = 16000, 1, 16
samples = sr * dur
data_size = samples * (bits // 8)
sys.stdout.buffer.write(b'RIFF')
sys.stdout.buffer.write(struct.pack('<I', 36 + data_size))
sys.stdout.buffer.write(b'WAVEfmt ')
sys.stdout.buffer.write(struct.pack('<IHHIIHH', 16, 1, 1, sr, sr * bits // 8, bits // 8, bits))
sys.stdout.buffer.write(b'data')
sys.stdout.buffer.write(struct.pack('<I', data_size))
sys.stdout.buffer.write(b'\x00' * data_size)
" > "$AUDIO_FILE"
  echo "Generated silent WAV: $AUDIO_FILE ($(wc -c < "$AUDIO_FILE") bytes)"
fi

if [ ! -f "$AUDIO_FILE" ]; then
  echo "Error: file not found: $AUDIO_FILE" >&2
  exit 1
fi

FILE_SIZE=$(wc -c < "$AUDIO_FILE" | tr -d ' ')
echo "Sending $AUDIO_FILE ($FILE_SIZE bytes) to $ENDPOINT"
echo "---"

HTTP_CODE=$(curl -s -o /tmp/voice-msg-response.json -w "%{http_code}" \
  -X POST "$ENDPOINT" \
  -F "audio=@${AUDIO_FILE}" \
  -F "conversation_id=test-$(date +%s)" \
  -F "end_conversation=true" \
  -F 'meta={"client":"test-script","version":"1.0.0"}')

echo "HTTP $HTTP_CODE"

if command -v python3 &>/dev/null; then
  python3 -c "
import json, sys
try:
    data = json.load(open('/tmp/voice-msg-response.json'))
    # Truncate base64 audio for display
    if 'assistant_audio' in data and 'base64' in data.get('assistant_audio', {}):
        b64 = data['assistant_audio']['base64']
        data['assistant_audio']['base64'] = f'{b64[:40]}... ({len(b64)} chars)'
    print(json.dumps(data, indent=2))
except Exception as e:
    print(open('/tmp/voice-msg-response.json').read())
"
else
  cat /tmp/voice-msg-response.json
  echo
fi

# Cleanup
rm -f /tmp/voice-msg-response.json
if [ -n "$GENERATED" ]; then
  rm -f "$GENERATED"
fi
