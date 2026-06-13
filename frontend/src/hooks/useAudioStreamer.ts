/**
 * useAudioStreamer — WebSocket + 마이크 오디오 스트리밍 + 서버 분석 흐름 관리 훅
 *
 * 책임:
 *  - getUserMedia로 마이크 스트림 확보
 *  - AudioContext ScriptProcessor → Float32 → Int16 PCM 변환 → WebSocket 전송
 *  - MediaRecorder로 동시에 로컬 Blob 녹음 (재생용)
 *  - 서버 WS 응답(status/error/final) 파싱 → React 상태로 노출
 *
 * 상태 머신: idle → connecting → recording → processing → completed → (reset) → idle
 *                                                       └→ error → (reset) → idle
 *
 * 디자인 선택:
 *  - ScriptProcessor(deprecated)를 사용하는 이유: AudioWorklet은 모든 브라우저에서
 *    동일하게 동작하지 않으며, 번들 크기 오버헤드가 있다. 16kHz 16bit PCM 변환이라는
 *    단순 작업에 충분하고, all_in_one_test.html과 동일 패턴으로 검증됨.
 *  - rAF 대신 onaudioprocess 이벤트에서 RMS를 계산하는 이유: 별도 루프 없이
 *    오디오 프레임 주기(~128ms @16kHz)에 자연스럽게 동기화.
 *
 * [수정 이력]
 *  - Step 8: AudioPlayer 공용화, pickRecorderMimeType, Blob 타입 일치
 *  - Step 9: WsStatusMessage(type/stage) 연동, isStatusMessage 판별
 *  - Step 11-B: AnalyserNode 노출 (WaveformVisualizer 연동)
 *  - 오디오 버그 수정: Blob URL 경쟁 조건 해결 — recorder.onstop 완료 후에만
 *    status를 "completed"로 전환하여 InterviewRoomPage가 localAudioUrl을 확실히 캡처.
 *    reset()에서 Blob URL을 해제하지 않음 — 호출자(InterviewRoomPage)가 messages에
 *    저장한 URL을 계속 참조할 수 있도록.
 *  - [녹음 꼬리 버그 수정] 기존에는 MediaRecorder.stop()을 "최종 결과 수신 시점"에
 *    호출해, 사용자가 녹음 중지를 눌러도 분석 대기("분석 중") 구간의 마이크 소리가
 *    로컬 Blob에 함께 녹음됐다. (서버 audio_url은 stop 시 processor를 끊으므로 정상)
 *    → MediaRecorder.stop()을 stop() 시점으로 앞당겨 Blob을 중지 지점까지만 캡처.
 *      단, "localAudioUrl이 completed보다 먼저 준비된다"는 보장은 유지하기 위해
 *      recorder flush 완료 플래그(recorderDoneRef)와 대기 큐(pendingFinalRef)로
 *      최종 결과/녹음 종료 두 비동기 이벤트의 순서를 동기화한다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthStore } from "@/store/authStore";
import { isStatusMessage, isFinalResult } from "@/types/ws";
import type {
  WsFinalResult,
  WsStage,
  WsClientMessage,
  WsErrorMessage,
} from "@/types/ws";

// ─────────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────────
const AUDIO_CONFIG = {
  SAMPLE_RATE: 16000,
  CHANNELS: 1,
  BUFFER_SIZE: 2048,
} as const;

const WS_BASE_URL =
  (import.meta.env.VITE_WS_URL as string | undefined) || "ws://localhost:8000";

// ─────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────
export type StreamerErrorCode =
  | "PERMISSION_DENIED"
  | "DEVICE_NOT_FOUND"
  | "NOT_SUPPORTED"
  | "AUTH_ERROR"
  | "NETWORK_ERROR"
  | "UNKNOWN";

export interface StreamerError {
  code: StreamerErrorCode;
  message: string;
}

export type StreamerStatus =
  | "idle"
  | "connecting"
  | "recording"
  | "processing"
  | "completed"
  | "error";

export interface StartParams {
  sessionId: number;
  questionId: number;
  questionText: string;
}

export interface UseAudioStreamerReturn {
  status: StreamerStatus;
  /** 서버 처리 단계 (processing 상태에서만 의미, 없으면 null) */
  stage: WsStage | null;
  /** 0.0 ~ 1.0 정규화된 RMS 음량 (마이크 시각화용) */
  volume: number;
  /** 실시간 파형 시각화용 AnalyserNode. recording 동안 활성, 정리 시 null로 복귀. */
  analyser: AnalyserNode | null;
  /** 서버 최종 분석 결과 (completed 시점에 채워짐) */
  result: WsFinalResult | null;
  error: StreamerError | null;
  /** 사용자가 로컬에서 들을 수 있도록 MediaRecorder가 만든 Blob URL */
  localAudioUrl: string | null;

  start: (params: StartParams) => Promise<void>;
  stop: () => void;
  /** 결과/에러 표시 후 다음 질문으로 넘어갈 때 호출 */
  reset: () => void;
}

// ─────────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────────

/**
 * Float32 [-1.0, 1.0] → Int16 PCM 변환
 * (all_in_one_test.html과 동일한 클램핑 로직)
 */
function floatTo16BitPCM(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s * 0x7fff;
  }
  return output;
}

/**
 * 실제 캡처 레이트 → 16kHz 다운샘플 (구간 평균, 간이 anti-alias).
 */
function downsampleTo16k(
  input: Float32Array,
  inputRate: number,
  targetRate: number
): Float32Array {
  if (targetRate >= inputRate) return input;
  const ratio = inputRate / targetRate;
  const newLen = Math.round(input.length / ratio);
  const output = new Float32Array(newLen);
  let oIdx = 0;
  let iIdx = 0;
  while (oIdx < newLen) {
    const nextIdx = Math.round((oIdx + 1) * ratio);
    let sum = 0;
    let count = 0;
    for (let i = iIdx; i < nextIdx && i < input.length; i++) {
      sum += input[i];
      count++;
    }
    output[oIdx] = count > 0 ? sum / count : 0;
    oIdx++;
    iIdx = nextIdx;
  }
  return output;
}

/**
 * Float32 버퍼의 RMS(평균 제곱근) → 0~1 정규화
 */
function calculateVolume(input: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < input.length; i++) {
    sum += input[i] * input[i];
  }
  const rms = Math.sqrt(sum / input.length);
  const normalized = Math.min(1, rms * 3);
  return normalized < 0.02 ? 0 : normalized;
}

/**
 * MediaRecorder 컨테이너 mimeType 선택.
 */
function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported?.(type)) return type;
  }
  return undefined;
}

/**
 * 서버 에러 프레임 판별.
 */
function isErrorMessage(msg: unknown): msg is WsErrorMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    typeof (msg as Record<string, unknown>).error === "string"
  );
}

// ─────────────────────────────────────────────────────────────
// 훅
// ─────────────────────────────────────────────────────────────

export function useAudioStreamer(): UseAudioStreamerReturn {
  const token = useAuthStore((s) => s.token);

  // ---------- 공개 상태 ----------
  const [status, setStatus] = useState<StreamerStatus>("idle");
  const [stage, setStage] = useState<WsStage | null>(null);
  const [volume, setVolume] = useState(0);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [result, setResult] = useState<WsFinalResult | null>(null);
  const [error, setError] = useState<StreamerError | null>(null);
  const [localAudioUrl, setLocalAudioUrl] = useState<string | null>(null);

  // ---------- 내부 레퍼런스 ----------
  const socketRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const localChunksRef = useRef<Blob[]>([]);
  const currentParamsRef = useRef<StartParams | null>(null);
  const isMountedRef = useRef(true);

  // ---------- 녹음 종료 ↔ 최종 결과 순서 동기화용 레퍼런스 ----------
  // recorderDoneRef: MediaRecorder가 onstop으로 Blob flush를 끝냈는지(또는 레코더가
  //   애초에 없어 기다릴 필요가 없는지) 여부.
  // recordedUrlRef: onstop에서 생성된 로컬 Blob URL(없으면 null).
  // pendingFinalRef: 레코더 flush보다 서버 최종 결과가 먼저 도착했을 때 보관해 두는 큐.
  //   onstop이 끝나는 즉시 이 결과로 completed 전환을 마무리한다.
  const recorderDoneRef = useRef(false);
  const recordedUrlRef = useRef<string | null>(null);
  const pendingFinalRef = useRef<WsFinalResult | null>(null);

  // ---------- 안전 setState ----------
  const safeSet = useCallback(
    <T,>(setter: (v: T) => void, value: T) => {
      if (isMountedRef.current) setter(value);
    },
    []
  );

  // ---------- 정리 함수 ----------
  const cleanup = useCallback(() => {
    // 1) MediaRecorder
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        /* noop */
      }
    }
    mediaRecorderRef.current = null;

    // 2) Audio 파이프라인 해제
    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
        processorRef.current.onaudioprocess = null;
      } catch {
        /* noop */
      }
      processorRef.current = null;
    }
    if (sourceRef.current) {
      try {
        sourceRef.current.disconnect();
      } catch {
        /* noop */
      }
      sourceRef.current = null;
    }
    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect();
      } catch {
        /* noop */
      }
      analyserRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => {
        /* noop */
      });
    }
    audioContextRef.current = null;

    // 3) 마이크 트랙 해제 (브라우저 상단 마이크 아이콘 OFF)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    // 4) WebSocket
    if (socketRef.current) {
      const ws = socketRef.current;
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      ) {
        try {
          ws.close();
        } catch {
          /* noop */
        }
      }
      socketRef.current = null;
    }

    safeSet(setVolume, 0);
    safeSet(setAnalyser, null);
  }, [safeSet]);

  // ---------- 언마운트 시 자동 정리 ----------
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      cleanup();
      // 언마운트 시에는 Blob URL 해제 가능 — 컴포넌트 트리도 사라지므로
      setLocalAudioUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [cleanup]);

  // ---------- 완료 처리 (단일 경로) ----------
  // 서버 최종 결과 + 로컬 Blob URL이 모두 준비됐을 때 호출되어 completed로 전환한다.
  // stop()의 recorder.onstop과 onmessage의 isFinalResult 분기 양쪽에서 공유한다.
  const finalize = useCallback(
    (data: WsFinalResult) => {
      if (recordedUrlRef.current) safeSet(setLocalAudioUrl, recordedUrlRef.current);
      safeSet(setResult, data);
      safeSet(setStatus, "completed");
      cleanup();
    },
    [cleanup, safeSet]
  );

  // ---------- start ----------
  const start = useCallback(
    async (params: StartParams) => {
      // 토큰 검증
      if (!token) {
        safeSet(setError, {
          code: "AUTH_ERROR",
          message: "로그인이 필요합니다.",
        });
        safeSet(setStatus, "error");
        return;
      }

      // 브라우저 API 지원 여부
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices?.getUserMedia ||
        typeof window.AudioContext === "undefined"
      ) {
        safeSet(setError, {
          code: "NOT_SUPPORTED",
          message: "이 브라우저는 마이크 스트리밍을 지원하지 않습니다.",
        });
        safeSet(setStatus, "error");
        return;
      }

      // 이전 세션 잔존물 정리
      cleanup();

      // 이전 Blob URL 해제 — reset()에서는 해제하지 않으므로
      // 새 녹음 시작 전에 정리한다. (updater 함수로 최신값 참조)
      setLocalAudioUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });

      // 녹음/최종결과 동기화 ref 초기화 (이전 세션 잔존값 제거)
      recorderDoneRef.current = false;
      recordedUrlRef.current = null;
      pendingFinalRef.current = null;

      currentParamsRef.current = params;
      safeSet(setError, null);
      safeSet(setResult, null);
      safeSet(setStage, null);
      safeSet(setStatus, "connecting");

      // ---------- 1) 마이크 권한 ----------
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        const e = err as DOMException;
        let code: StreamerErrorCode = "UNKNOWN";
        let message = "마이크에 접근할 수 없습니다.";

        if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
          code = "PERMISSION_DENIED";
          message =
            "마이크 권한이 거부되었습니다. 브라우저 설정에서 권한을 허용해주세요.";
        } else if (
          e.name === "NotFoundError" ||
          e.name === "DevicesNotFoundError"
        ) {
          code = "DEVICE_NOT_FOUND";
          message = "마이크 장치를 찾을 수 없습니다.";
        }

        safeSet(setError, { code, message });
        safeSet(setStatus, "error");
        return;
      }

      streamRef.current = stream;

      // ---------- 2) MediaRecorder (로컬 재생용) ----------
      try {
        const mimeType = pickRecorderMimeType();
        const recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);
        localChunksRef.current = [];
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            localChunksRef.current.push(e.data);
          }
        };
        recorder.start();
        mediaRecorderRef.current = recorder;
      } catch {
        console.warn(
          "[useAudioStreamer] MediaRecorder unavailable, local playback disabled."
        );
      }

      // ---------- 3) WebSocket 연결 ----------
      const url =
        `${WS_BASE_URL}/ws/audio` +
        `?token=${encodeURIComponent(token)}` +
        `&session_id=${params.sessionId}` +
        `&question_id=${params.questionId}`;

      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch {
        safeSet(setError, {
          code: "NETWORK_ERROR",
          message: "서버에 연결할 수 없습니다.",
        });
        safeSet(setStatus, "error");
        cleanup();
        return;
      }
      socketRef.current = socket;
      socket.binaryType = "arraybuffer";

      // ---------- 4) WS 이벤트 ----------
      socket.onopen = () => {
        if (!isMountedRef.current) return;

        try {
          const ctx = new AudioContext({
            sampleRate: AUDIO_CONFIG.SAMPLE_RATE,
          });
          audioContextRef.current = ctx;

          const source = ctx.createMediaStreamSource(stream);
          sourceRef.current = source;

          // 파형 시각화용 AnalyserNode
          const analyserNode = ctx.createAnalyser();
          analyserNode.fftSize = 256;
          source.connect(analyserNode);
          analyserRef.current = analyserNode;
          safeSet(setAnalyser, analyserNode);

          const processor = ctx.createScriptProcessor(
            AUDIO_CONFIG.BUFFER_SIZE,
            AUDIO_CONFIG.CHANNELS,
            AUDIO_CONFIG.CHANNELS
          );
          processorRef.current = processor;

          const actualRate = ctx.sampleRate;
          if (actualRate !== AUDIO_CONFIG.SAMPLE_RATE) {
            console.info(
              `[useAudioStreamer] AudioContext가 16kHz 요청을 무시함 ` +
                `(실제 ${actualRate}Hz) → 송신 전 다운샘플 적용`
            );
          }

          processor.onaudioprocess = (e) => {
            const input = e.inputBuffer.getChannelData(0);

            // 음량 시각화
            const v = calculateVolume(input);
            if (isMountedRef.current) {
              setVolume((prev) => (Math.abs(prev - v) > 0.02 ? v : prev));
            }

            // 16kHz로 변환 후 PCM 송신
            if (socket.readyState === WebSocket.OPEN) {
              const mono16k = downsampleTo16k(
                input,
                actualRate,
                AUDIO_CONFIG.SAMPLE_RATE
              );
              const pcm = floatTo16BitPCM(mono16k);
              socket.send(pcm.buffer as ArrayBuffer);
            }
          };

          source.connect(processor);
          processor.connect(ctx.destination);

          safeSet(setStatus, "recording");
        } catch (err) {
          console.error("[useAudioStreamer] AudioContext setup failed:", err);
          safeSet(setError, {
            code: "UNKNOWN",
            message: "오디오 처리 초기화에 실패했습니다.",
          });
          safeSet(setStatus, "error");
          cleanup();
        }
      };

      socket.onmessage = (event) => {
        if (!isMountedRef.current) return;
        try {
          const data: unknown = JSON.parse(event.data as string);

          // 1) 서버 처리 단계 메시지
          if (isStatusMessage(data)) {
            safeSet(setStatus, "processing");
            safeSet(setStage, data.stage);
            return;
          }

          // 2) 서버 처리 에러
          if (isErrorMessage(data)) {
            safeSet(setError, {
              code: "UNKNOWN",
              message:
                data.error || "답변을 처리하지 못했어요. 다시 시도해주세요.",
            });
            safeSet(setStatus, "error");
            cleanup();
            return;
          }

          // 3) 최종 결과 수신
          if (isFinalResult(data)) {
            // 로컬 Blob 녹음은 stop() 시점에 이미 종료를 시작했다.
            // 여기서는 레코더를 건드리지 않고, flush 완료 여부만 보고 분기한다.
            //  - recorderDoneRef === true  → Blob URL 준비 완료(or 레코더 없음) → 즉시 완료
            //  - 아직 flush 전              → pendingFinalRef에 보관 → recorder.onstop이 마무리
            const final = data as WsFinalResult;
            if (recorderDoneRef.current) {
              finalize(final);
            } else {
              pendingFinalRef.current = final;
            }
          }
        } catch (err) {
          console.error("[useAudioStreamer] message parse error:", err);
        }
      };

      socket.onerror = () => {
        if (!isMountedRef.current) return;
        console.error("[useAudioStreamer] WebSocket error");
      };

      socket.onclose = (event) => {
        if (!isMountedRef.current) return;

        const wasCompleted = status === "completed";
        if (wasCompleted) return;

        let message = "서버와의 연결이 종료되었습니다.";
        if (event.code === 1006) {
          message = "네트워크 연결이 끊겼습니다. 다시 시도해주세요.";
        } else if (event.code === 1008 || event.code === 4401) {
          message = "인증에 실패했습니다. 다시 로그인해주세요.";
        }

        safeSet(setError, { code: "NETWORK_ERROR", message });
        safeSet(setStatus, "error");
      };
    },
    [token, cleanup, safeSet, status, finalize]
  );

  // ---------- stop ----------
  const stop = useCallback(() => {
    const params = currentParamsRef.current;
    const socket = socketRef.current;

    if (!socket || socket.readyState !== WebSocket.OPEN || !params) {
      cleanup();
      safeSet(setStatus, "idle");
      return;
    }

    // 1) 오디오 파이프라인은 즉시 끊어 추가 PCM 송신 차단
    if (processorRef.current) {
      processorRef.current.onaudioprocess = null;
      try {
        processorRef.current.disconnect();
      } catch {
        /* noop */
      }
      processorRef.current = null;
    }

    // 1-b) 로컬 녹음(MediaRecorder)도 이 시점에 즉시 종료한다.
    //   → Blob이 "분석 중" 대기 구간을 포함하지 않고 중지 지점까지만 캡처된다.
    //   onstop은 비동기로 한 박자 늦게 발생하므로, Blob URL이 만들어지면
    //   recorderDoneRef를 세우고, 이미 도착해 대기 중인 최종 결과가 있으면 마무리한다.
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      const blobType = recorder.mimeType || "audio/webm";
      recorder.onstop = () => {
        try {
          const blob = new Blob(localChunksRef.current, { type: blobType });
          recordedUrlRef.current = URL.createObjectURL(blob);
          safeSet(setLocalAudioUrl, recordedUrlRef.current);
        } catch {
          recordedUrlRef.current = null;
        }
        recorderDoneRef.current = true;
        // 서버 최종 결과가 먼저 도착해 대기 중이면 지금 완료 처리
        if (pendingFinalRef.current) {
          const pending = pendingFinalRef.current;
          pendingFinalRef.current = null;
          finalize(pending);
        }
      };
      try {
        recorder.stop();
      } catch {
        // stop 실패 시 Blob 없이 진행 — 더 기다리지 않도록 done 처리
        recorderDoneRef.current = true;
        if (pendingFinalRef.current) {
          const pending = pendingFinalRef.current;
          pendingFinalRef.current = null;
          finalize(pending);
        }
      }
    } else {
      // 레코더가 없거나 이미 비활성 → 기다릴 녹음이 없음
      recorderDoneRef.current = true;
    }

    // 2) 서버에 분석 트리거 송신
    const stopMsg: WsClientMessage = {
      type: "stop",
      session_id: params.sessionId,
      question_id: params.questionId,
      question: params.questionText,
    };
    try {
      socket.send(JSON.stringify(stopMsg));
      safeSet(setStatus, "processing");
    } catch {
      safeSet(setError, {
        code: "NETWORK_ERROR",
        message: "분석 요청 전송에 실패했습니다.",
      });
      safeSet(setStatus, "error");
      cleanup();
    }
  }, [cleanup, safeSet, finalize]);

  // ---------- reset ----------
  const reset = useCallback(() => {
    cleanup();
    // ⚠ Blob URL을 해제하지 않는다.
    // InterviewRoomPage는 completed 감지 시 localAudioUrl을 messages[]에 저장하고
    // 직후 reset()을 호출한다. 여기서 해제하면 messages에 저장된 URL이 무효화되어
    // UserVoiceBubble의 "내 음성" 재생이 깨진다.
    // 이전 Blob URL은 다음 start() 호출 시 또는 컴포넌트 언마운트 시 정리된다.
    safeSet(setLocalAudioUrl, null);
    safeSet(setResult, null);
    safeSet(setError, null);
    safeSet(setVolume, 0);
    safeSet(setStatus, "idle");
    safeSet(setStage, null);
    currentParamsRef.current = null;
    localChunksRef.current = [];
    recorderDoneRef.current = false;
    recordedUrlRef.current = null;
    pendingFinalRef.current = null;
  }, [cleanup, safeSet]);

  return {
    status,
    stage,
    volume,
    analyser,
    result,
    error,
    localAudioUrl,
    start,
    stop,
    reset,
  };
}
