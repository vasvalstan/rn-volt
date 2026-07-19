import { setAudioModeAsync } from "expo-audio";
import { ensureRecordingPermissionAsync } from "./audioPermissions";
import type { Id } from "../../convex/_generated/dataModel";
import { VOICE_IDLE_TIMEOUT_MS } from "../../shared/voiceQuota";

export type RealtimeVoiceStatus =
  | "idle"
  | "connecting"
  | "live"
  | "listening"
  | "thinking"
  | "speaking"
  | "closed"
  | "error";

export type RealtimeCreateCallArgs = {
  offerSdp: string;
};

export type RealtimeCreateCallResult = {
  answerSdp: string;
  model?: string;
  voice?: string;
  sessionId: Id<"voiceRealtimeSessions">;
  maxDurationMs: number;
  expiresAt: number;
  quotaRemainingMs: number;
};

export type RealtimeVoiceEndReason =
  | "user"
  | "completed"
  | "client_idle"
  | "client_limit"
  | "remote"
  | "error";

export type RealtimeUsage = {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  inputTextTokens: number;
  inputAudioTokens: number;
  inputImageTokens: number;
  cachedTokens: number;
  cachedTextTokens: number;
  cachedAudioTokens: number;
  cachedImageTokens: number;
  outputTextTokens: number;
  outputAudioTokens: number;
};

export type RealtimeCoachSessionHandle = {
  sendText: (text: string, options?: { replacePending?: boolean }) => void;
  stop: (reason?: RealtimeVoiceEndReason) => Promise<void>;
  sessionId: Id<"voiceRealtimeSessions">;
  maxDurationMs: number;
  expiresAt: number;
  quotaRemainingMs: number;
};

type StartRealtimeCoachSessionArgs = {
  openingPrompt?: string;
  createCall: (args: RealtimeCreateCallArgs) => Promise<RealtimeCreateCallResult>;
  endCall: (args: {
    sessionId: Id<"voiceRealtimeSessions">;
    reason: RealtimeVoiceEndReason;
  }) => Promise<unknown>;
  recordUsage: (args: {
    sessionId: Id<"voiceRealtimeSessions">;
    responseId: string;
    usage: RealtimeUsage;
  }) => Promise<unknown>;
  onStatus: (status: RealtimeVoiceStatus) => void;
  onUserSpeech?: () => void;
  onUserTranscript: (text: string) => void;
  onAssistantTranscript: (text: string) => void;
  onEnded?: (reason: RealtimeVoiceEndReason) => void;
  onError: (error: Error) => void;
};

type NativeWebRTCModule = {
  RTCPeerConnection: new (configuration?: Record<string, unknown>) => NativePeerConnection;
  RTCSessionDescription: new (description: { type: "answer"; sdp: string }) => unknown;
  mediaDevices: {
    getUserMedia: (constraints: {
      audio:
        | boolean
        | {
            echoCancellation?: boolean;
            noiseSuppression?: boolean;
            autoGainControl?: boolean;
          };
      video: boolean;
    }) => Promise<NativeMediaStream>;
  };
  registerGlobals?: () => void;
};

type NativePeerConnection = {
  addTrack: (track: unknown, stream?: NativeMediaStream) => void;
  close: () => void;
  createDataChannel: (label: string) => NativeDataChannel;
  createOffer: () => Promise<{ type: string; sdp?: string }>;
  iceGatheringState?: string;
  localDescription?: { sdp?: string } | null;
  onicegatheringstatechange?: (() => void) | null;
  ontrack?: ((event: { streams?: NativeMediaStream[]; track?: NativeMediaTrack }) => void) | null;
  setLocalDescription: (description: { type: string; sdp?: string }) => Promise<void>;
  setRemoteDescription: (description: unknown) => Promise<void>;
};

type NativeDataChannel = {
  close: () => void;
  onclose?: (() => void) | null;
  onerror?: ((event: unknown) => void) | null;
  onmessage?: ((event: { data?: unknown } | string) => void) | null;
  onopen?: (() => void) | null;
  readyState?: string;
  send: (message: string) => void;
};

type NativeMediaStream = {
  getTracks: () => NativeMediaTrack[];
};

type NativeMediaTrack = {
  enabled?: boolean;
  stop?: () => void;
};

type RealtimeServerEvent = {
  type?: string;
  event_id?: string;
  delta?: string;
  transcript?: string;
  text?: string;
  message?: string;
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
  item?: {
    role?: string;
    content?: {
      type?: string;
      text?: string;
      transcript?: string;
    }[];
  };
  response?: {
    id?: string;
    usage?: {
      total_tokens?: number;
      input_tokens?: number;
      output_tokens?: number;
      input_token_details?: {
        text_tokens?: number;
        audio_tokens?: number;
        image_tokens?: number;
        cached_tokens?: number;
        cached_tokens_details?: {
          text_tokens?: number;
          audio_tokens?: number;
          image_tokens?: number;
        };
      };
      output_token_details?: {
        text_tokens?: number;
        audio_tokens?: number;
      };
    };
  };
};

function loadNativeWebRTC(): NativeWebRTCModule {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const webRTC = require("react-native-webrtc") as NativeWebRTCModule;
    webRTC.registerGlobals?.();
    return webRTC;
  } catch (error) {
    throw new Error(
      "OpenAI Realtime voice needs a rebuilt development client with react-native-webrtc.",
      { cause: error },
    );
  }
}

function stopStream(stream?: NativeMediaStream) {
  stream?.getTracks().forEach((track) => {
    track.stop?.();
  });
}

async function enableRealtimeSpeakerAudioMode() {
  await setAudioModeAsync({
    allowsRecording: true,
    playsInSilentMode: true,
    shouldRouteThroughEarpiece: false,
    interruptionMode: "doNotMix",
  });
}

async function restorePlaybackAudioMode() {
  await setAudioModeAsync({
    allowsRecording: false,
    playsInSilentMode: true,
    shouldRouteThroughEarpiece: false,
    interruptionMode: "mixWithOthers",
  });
}

function waitForIceGatheringComplete(peerConnection: NativePeerConnection) {
  if (peerConnection.iceGatheringState === "complete") return Promise.resolve();

  return new Promise<void>((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      peerConnection.onicegatheringstatechange = null;
      resolve();
    }, 1600);

    peerConnection.onicegatheringstatechange = () => {
      if (peerConnection.iceGatheringState !== "complete" || settled) return;
      settled = true;
      clearTimeout(timeout);
      peerConnection.onicegatheringstatechange = null;
      resolve();
    };
  });
}

function waitForDataChannelOpen(dataChannel: NativeDataChannel) {
  if (dataChannel.readyState === "open") return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const previousOnOpen = dataChannel.onopen;
    const previousOnClose = dataChannel.onclose;
    const previousOnError = dataChannel.onerror;
    const restoreHandlers = () => {
      dataChannel.onopen = previousOnOpen;
      dataChannel.onclose = previousOnClose;
      dataChannel.onerror = previousOnError;
    };
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      restoreHandlers();
      reject(new Error("OpenAI Realtime data channel did not open."));
    }, 9000);

    dataChannel.onopen = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      restoreHandlers();
      resolve();
    };
    dataChannel.onclose = () => {
      previousOnClose?.();
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      restoreHandlers();
      reject(new Error("OpenAI Realtime data channel closed while connecting."));
    };
    dataChannel.onerror = (event) => {
      previousOnError?.(event);
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      restoreHandlers();
      reject(new Error("OpenAI Realtime data channel failed while connecting."));
    };
  });
}

function eventText(event: RealtimeServerEvent): string {
  const direct = event.transcript?.trim() || event.text?.trim();
  if (direct) return direct;

  return (
    event.item?.content
      ?.map((content) => content.transcript?.trim() || content.text?.trim() || "")
      .filter(Boolean)
      .join(" ")
      .trim() ?? ""
  );
}

function eventErrorMessage(event: RealtimeServerEvent): string {
  return (
    event.error?.message ??
    event.message ??
    event.error?.code ??
    event.error?.type ??
    "OpenAI Realtime returned an error."
  );
}

function tokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : 0;
}

function eventUsage(event: RealtimeServerEvent): RealtimeUsage | undefined {
  const usage = event.response?.usage;
  if (!usage) return undefined;
  const input = usage.input_token_details;
  const cached = input?.cached_tokens_details;
  const output = usage.output_token_details;
  return {
    totalTokens: tokenCount(usage.total_tokens),
    inputTokens: tokenCount(usage.input_tokens),
    outputTokens: tokenCount(usage.output_tokens),
    inputTextTokens: tokenCount(input?.text_tokens),
    inputAudioTokens: tokenCount(input?.audio_tokens),
    inputImageTokens: tokenCount(input?.image_tokens),
    cachedTokens: tokenCount(input?.cached_tokens),
    cachedTextTokens: tokenCount(cached?.text_tokens),
    cachedAudioTokens: tokenCount(cached?.audio_tokens),
    cachedImageTokens: tokenCount(cached?.image_tokens),
    outputTextTokens: tokenCount(output?.text_tokens),
    outputAudioTokens: tokenCount(output?.audio_tokens),
  };
}

function parseServerEvent(raw: unknown): RealtimeServerEvent | undefined {
  const payload = typeof raw === "string" ? raw : raw && typeof raw === "object" && "data" in raw ? raw.data : undefined;
  if (typeof payload !== "string") return undefined;
  try {
    return JSON.parse(payload) as RealtimeServerEvent;
  } catch {
    return undefined;
  }
}

function logRealtimeEvent(message: string, extra?: Record<string, unknown>) {
  if (!__DEV__) return;
  if (extra) {
    console.log(`[VOLT_REALTIME] ${message}`, extra);
    return;
  }
  console.log(`[VOLT_REALTIME] ${message}`);
}

export async function startRealtimeCoachSession({
  openingPrompt,
  createCall,
  endCall,
  recordUsage,
  onStatus,
  onUserSpeech,
  onUserTranscript,
  onAssistantTranscript,
  onEnded,
  onError,
}: StartRealtimeCoachSessionArgs): Promise<RealtimeCoachSessionHandle> {
  onStatus("connecting");
  const webRTC = loadNativeWebRTC();
  await ensureRecordingPermissionAsync();

  const peerConnection = new webRTC.RTCPeerConnection();
  const dataChannel = peerConnection.createDataChannel("oai-events");
  let localStream: NativeMediaStream | undefined;
  const remoteStreams: NativeMediaStream[] = [];
  let assistantTranscriptDraft = "";
  let assistantSpeaking = false;
  let userSpeechInProgress = false;
  let responseInProgress = false;
  let assistantAudioCooldownUntil = 0;
  let pendingTexts: string[] = [];
  let activeCall: RealtimeCreateCallResult | undefined;
  let idleTimer: ReturnType<typeof setInterval> | undefined;
  let hardTimer: ReturnType<typeof setTimeout> | undefined;
  let lastActivityAt = Date.now();
  const reportedResponseIds = new Set<string>();
  let realtimeAudioModeActive = false;
  let stopped = false;
  let stopPromise: Promise<void> | null = null;

  const touchActivity = () => {
    lastActivityAt = Date.now();
  };

  const stop = (reason: RealtimeVoiceEndReason = "user"): Promise<void> => {
    if (stopPromise) return stopPromise;
    stopped = true;
    if (idleTimer) clearInterval(idleTimer);
    if (hardTimer) clearTimeout(hardTimer);
    pendingTexts = [];
    try {
      dataChannel.close();
    } catch {
      // Already closed.
    }
    stopStream(localStream);
    remoteStreams.forEach(stopStream);
    try {
      peerConnection.close();
    } catch {
      // Already closed.
    }
    if (realtimeAudioModeActive) {
      realtimeAudioModeActive = false;
      void restorePlaybackAudioMode().catch((error) => {
        logRealtimeEvent("audio mode restore failed", {
          message: error instanceof Error ? error.message : String(error),
        });
      });
    }
    onStatus("closed");

    const sessionId = activeCall?.sessionId;
    stopPromise = (async () => {
      if (!sessionId) return;
      try {
        await endCall({ sessionId, reason });
      } catch (error) {
        logRealtimeEvent("server end call failed", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
      onEnded?.(reason);
    })();
    return stopPromise;
  };

  const sendEvent = (event: Record<string, unknown>) => {
    if (stopped || dataChannel.readyState !== "open") return;
    dataChannel.send(JSON.stringify(event));
  };

  const requestOpeningResponse = () => {
    if (!openingPrompt?.trim()) return;
    touchActivity();
    responseInProgress = true;
    sendEvent({
      type: "response.create",
      response: {
        output_modalities: ["audio"],
        instructions: `Start the live coaching session by saying this naturally: ${openingPrompt.trim()}`,
      },
    });
  };

  const requestConversationResponse = () => {
    touchActivity();
    responseInProgress = true;
    sendEvent({ type: "response.create", response: { output_modalities: ["audio"] } });
  };

  const sendTextNow = (text: string) => {
    touchActivity();
    sendEvent({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    });
    requestConversationResponse();
  };

  const flushPendingText = () => {
    const nextText = pendingTexts.shift();
    if (!nextText) return false;
    sendTextNow(nextText);
    return true;
  };

  const clearInputBuffer = () => {
    sendEvent({ type: "input_audio_buffer.clear" });
  };

  const commitAssistantTranscript = (text: string) => {
    const cleanText = text.trim();
    if (!cleanText) return;
    onAssistantTranscript(cleanText);
  };

  dataChannel.onmessage = (message) => {
    const event = parseServerEvent(message);
    if (!event?.type) return;
    if (
      event.type.startsWith("input_audio_buffer.") ||
      event.type.startsWith("conversation.item.") ||
      event.type.startsWith("response.")
    ) {
      touchActivity();
    }

    if (event.type === "error") {
      responseInProgress = false;
      onStatus("error");
      const error = new Error(eventErrorMessage(event));
      onError(error);
      void stop("error");
      return;
    }

    if (event.type === "input_audio_buffer.speech_started") {
      if (assistantSpeaking || Date.now() < assistantAudioCooldownUntil) {
        logRealtimeEvent("ignored speech_started during assistant audio");
        clearInputBuffer();
        return;
      }
      logRealtimeEvent("user speech_started");
      userSpeechInProgress = true;
      onStatus("listening");
      onUserSpeech?.();
      return;
    }

    if (event.type === "input_audio_buffer.speech_stopped") {
      if (assistantSpeaking || responseInProgress || !userSpeechInProgress) {
        logRealtimeEvent("ignored speech_stopped", {
          assistantSpeaking,
          responseInProgress,
          userSpeechInProgress,
        });
        clearInputBuffer();
        return;
      }
      userSpeechInProgress = false;
      logRealtimeEvent("user speech_stopped; creating response");
      onStatus("thinking");
      requestConversationResponse();
      return;
    }

    if (
      event.type === "conversation.item.input_audio_transcription.completed" ||
      event.type === "conversation.item.done"
    ) {
      if (event.item?.role === "user" || event.type.includes("input_audio_transcription")) {
        const userText = eventText(event);
        if (userText) onUserTranscript(userText);
      }
      return;
    }

    if (event.type === "response.output_audio.delta") {
      assistantSpeaking = true;
      onStatus("speaking");
      return;
    }

    if (event.type === "response.output_audio_transcript.delta") {
      assistantTranscriptDraft += event.delta ?? "";
      assistantSpeaking = true;
      onStatus("speaking");
      return;
    }

    if (event.type === "response.output_audio_transcript.done") {
      commitAssistantTranscript(event.transcript ?? assistantTranscriptDraft);
      assistantTranscriptDraft = "";
      return;
    }

    if (event.type === "response.created") {
      responseInProgress = true;
      assistantSpeaking = true;
      onStatus("thinking");
      return;
    }

    if (event.type === "response.done") {
      const responseId = event.response?.id?.trim();
      const usage = eventUsage(event);
      if (
        activeCall &&
        responseId &&
        responseId.length <= 120 &&
        usage &&
        !reportedResponseIds.has(responseId)
      ) {
        reportedResponseIds.add(responseId);
        void recordUsage({
          sessionId: activeCall.sessionId,
          responseId,
          usage,
        }).catch((error) => {
          logRealtimeEvent("client usage fallback failed", {
            message: error instanceof Error ? error.message : String(error),
          });
        });
      }
      if (assistantTranscriptDraft) {
        commitAssistantTranscript(assistantTranscriptDraft);
        assistantTranscriptDraft = "";
      }
      responseInProgress = false;
      assistantSpeaking = false;
      userSpeechInProgress = false;
      assistantAudioCooldownUntil = Date.now() + 600;
      logRealtimeEvent("response.done; clearing input buffer");
      clearInputBuffer();
      onStatus(flushPendingText() ? "thinking" : "live");
    }
  };

  dataChannel.onclose = () => {
    if (!stopped) void stop("remote");
  };

  dataChannel.onerror = () => {
    onStatus("error");
    const error = new Error("OpenAI Realtime data channel failed.");
    onError(error);
    void stop("error");
  };

  peerConnection.ontrack = (event) => {
    if (realtimeAudioModeActive && !stopped) {
      void enableRealtimeSpeakerAudioMode().catch((error) => {
        logRealtimeEvent("speaker route refresh failed", {
          message: error instanceof Error ? error.message : String(error),
        });
      });
    }
    const stream = event.streams?.[0];
    if (stream) {
      remoteStreams.push(stream);
      stream.getTracks().forEach((track) => {
        track.enabled = true;
      });
      return;
    }
    event.track?.stop?.();
  };

  try {
    await enableRealtimeSpeakerAudioMode();
    realtimeAudioModeActive = true;
    localStream = await webRTC.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    await enableRealtimeSpeakerAudioMode();
    localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream);
    });

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    await waitForIceGatheringComplete(peerConnection);

    const offerSdp = peerConnection.localDescription?.sdp ?? offer.sdp;
    if (!offerSdp) throw new Error("Could not create a WebRTC offer for OpenAI Realtime.");

    const call = await createCall({ offerSdp });
    activeCall = call;
    touchActivity();
    idleTimer = setInterval(() => {
      if (Date.now() - lastActivityAt >= VOICE_IDLE_TIMEOUT_MS) {
        void stop("client_idle");
      }
    }, 5_000);
    hardTimer = setTimeout(() => {
      void stop("client_limit");
    }, Math.max(0, call.expiresAt - Date.now()));

    await peerConnection.setRemoteDescription(
      new webRTC.RTCSessionDescription({ type: "answer", sdp: call.answerSdp }),
    );
    await waitForDataChannelOpen(dataChannel);
    onStatus("live");
    requestOpeningResponse();

    return {
      sendText: (text: string, options?: { replacePending?: boolean }) => {
        const cleanText = text.trim();
        if (!cleanText) return;
        if (responseInProgress || assistantSpeaking || userSpeechInProgress) {
          pendingTexts = options?.replacePending
            ? [cleanText]
            : [...pendingTexts.slice(-7), cleanText];
          return;
        }
        sendTextNow(cleanText);
      },
      stop,
      sessionId: call.sessionId,
      maxDurationMs: call.maxDurationMs,
      expiresAt: call.expiresAt,
      quotaRemainingMs: call.quotaRemainingMs,
    };
  } catch (error) {
    await stop("error");
    const realtimeError = error instanceof Error ? error : new Error("OpenAI Realtime voice failed.");
    onError(realtimeError);
    throw realtimeError;
  }
}
