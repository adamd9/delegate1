import assert from "assert";
import { getAgent } from "../agentConfigs";
import { getChatVoiceConfig } from "./voiceConfig";
import { requireAudioFile, VoiceMessageError } from "./voicePipeline";

function expectVoiceMessageError(fn: () => void, status: number) {
  try {
    fn();
    assert.fail("Expected VoiceMessageError");
  } catch (err: any) {
    assert.ok(err instanceof VoiceMessageError, "Expected VoiceMessageError instance");
    assert.strictEqual(err.status, status);
  }
}

function testRequestValidation() {
  expectVoiceMessageError(() => requireAudioFile(undefined), 400);
}

function testAudioSizeLimit() {
  const prev = process.env.DELEGATE_MAX_AUDIO_BYTES;
  process.env.DELEGATE_MAX_AUDIO_BYTES = "10";
  try {
    expectVoiceMessageError(() => requireAudioFile({ size: 11 }), 413);
  } finally {
    if (prev === undefined) {
      delete process.env.DELEGATE_MAX_AUDIO_BYTES;
    } else {
      process.env.DELEGATE_MAX_AUDIO_BYTES = prev;
    }
  }
}

function testVoiceConfigResolution() {
  const cfg = getChatVoiceConfig();
  const base = getAgent("base");
  assert.strictEqual(cfg.voice, base.voice);
}

testRequestValidation();
testAudioSizeLimit();
testVoiceConfigResolution();

console.log("voicePipeline tests passed");
