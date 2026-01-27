const startRecordingBtn = document.getElementById("startRecording");
const stopRecordingBtn = document.getElementById("stopRecording");
const sendButton = document.getElementById("sendButton");
const audioFileInput = document.getElementById("audioFile");
const recordStatus = document.getElementById("recordStatus");
const sendStatus = document.getElementById("sendStatus");
const transcriptEl = document.getElementById("transcript");
const assistantTextEl = document.getElementById("assistantText");
const assistantAudioEl = document.getElementById("assistantAudio");
const playRecordingBtn = document.getElementById("playRecording");
const recordingPreview = document.getElementById("recordingPreview");
const conversationIdInput = document.getElementById("conversationId");
const endConversationInput = document.getElementById("endConversation");
const newConversationBtn = document.getElementById("newConversation");
const apiBaseInput = document.getElementById("apiBase");

let recorder;
let recordedChunks = [];
let recordedBlob = null;
let recorderMimeType = "";
let recordingPreviewUrl = "";

function pickOpusMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus"];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return "";
}

function setRecordingState(isRecording) {
  startRecordingBtn.disabled = isRecording;
  stopRecordingBtn.disabled = !isRecording;
  recordStatus.textContent = isRecording ? "Recording..." : "Idle";
}

function updateSendButtonState() {
  sendButton.disabled = !(recordedBlob || audioFileInput.files.length > 0);
  playRecordingBtn.disabled = !recordedBlob;
}

startRecordingBtn.addEventListener("click", async () => {
  recordedChunks = [];
  recordedBlob = null;
  if (recordingPreviewUrl) {
    URL.revokeObjectURL(recordingPreviewUrl);
    recordingPreviewUrl = "";
  }
  recordingPreview.removeAttribute("src");
  audioFileInput.value = "";
  updateSendButtonState();

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  recorderMimeType = pickOpusMimeType();
  recorder = recorderMimeType ? new MediaRecorder(stream, { mimeType: recorderMimeType }) : new MediaRecorder(stream);
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) recordedChunks.push(event.data);
  });
  recorder.addEventListener("stop", () => {
    recordedBlob = new Blob(recordedChunks, { type: recorder.mimeType || recorderMimeType || "audio/webm" });
    recordingPreviewUrl = URL.createObjectURL(recordedBlob);
    recordingPreview.src = recordingPreviewUrl;
    updateSendButtonState();
    stream.getTracks().forEach((track) => track.stop());
  });

  recorder.start();
  setRecordingState(true);
});

stopRecordingBtn.addEventListener("click", () => {
  if (recorder && recorder.state !== "inactive") {
    recorder.stop();
  }
  setRecordingState(false);
});

audioFileInput.addEventListener("change", () => {
  recordedBlob = null;
  if (recordingPreviewUrl) {
    URL.revokeObjectURL(recordingPreviewUrl);
    recordingPreviewUrl = "";
  }
  recordingPreview.removeAttribute("src");
  updateSendButtonState();
});

newConversationBtn.addEventListener("click", () => {
  conversationIdInput.value = "";
});

playRecordingBtn.addEventListener("click", () => {
  if (!recordedBlob || !recordingPreviewUrl) return;
  recordingPreview.play();
});

sendButton.addEventListener("click", async () => {
  sendStatus.textContent = "Sending...";
  transcriptEl.textContent = "";
  assistantTextEl.textContent = "";
  assistantAudioEl.removeAttribute("src");

  const apiBase = apiBaseInput.value.replace(/\/$/, "");
  const apiUrl = `${apiBase}/api/voice/message`;
  const formData = new FormData();

  let audioFile;
  if (recordedBlob) {
    const extension = (recordedBlob.type || "").includes("ogg") ? "ogg" : "webm";
    audioFile = new File([recordedBlob], `recording.${extension}`, { type: recordedBlob.type || "audio/webm" });
  } else {
    audioFile = audioFileInput.files[0];
  }
  formData.append("audio", audioFile);

  if (conversationIdInput.value) {
    formData.append("conversation_id", conversationIdInput.value.trim());
  }
  formData.append("end_conversation", endConversationInput.checked ? "true" : "false");
  formData.append("meta", JSON.stringify({ client: "voice-message-tester", version: "1.0.0" }));

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      body: formData,
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.message || payload?.error || "Request failed");
    }
    conversationIdInput.value = payload.conversation_id || conversationIdInput.value;
    transcriptEl.textContent = payload.user_text || "";
    assistantTextEl.textContent = payload.assistant_text || "";
    if (payload.assistant_audio?.base64) {
      assistantAudioEl.src = `data:audio/mp3;base64,${payload.assistant_audio.base64}`;
    }
    sendStatus.textContent = "Done";
  } catch (err) {
    console.error(err);
    sendStatus.textContent = `Error: ${err.message}`;
  }
});

updateSendButtonState();
