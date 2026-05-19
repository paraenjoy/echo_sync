/**
 * useAudioStreamer
 *
 * 책임:
 *  - 마이크 권한 요청 및 16kHz 모노 PCM 캡처
 *  - WebSocket(/ws/audio)으로 Int16 PCM 바이너리 스트리밍
 *  - 답변 종료 시 JSON 컨트롤 메시지 송신 → 서버 최종 결과 수신
 *  - 음량(RMS) 계산하여 마이크 버튼 주변 시각화 데이터 노출
 *  - 모든 리소스(AudioContext, Stream, Socket) 안전한 해제
 *
 * 사용처:
 *  - /youtube (스피킹 연습)
 *  - /interview/room (음성 답변)
 *
 * 백엔드 계약 (main.py /ws/audio):
 *  - 쿼리: ?token={JWT}&session_id={n}&question_id={n}
 *  - 송신: ArrayBuffer (Int16 PCM) → 종료 시 JSON {type:"stop", session_id, question_id, question}
 *  - 수신: WsFinalResult JSON (1회)
 *
 * NOTE: ScriptProcessorNode는 deprecated이지만 백엔드 계약(Int16 PCM 16kHz)을
 *       만족하려면 AudioWorklet 마이그레이션 시 별도 작업이 필요하다.
 *       all_in_one_test.html의 원본 로직을 그대로 유지하여 호환성을 우선했다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { WS_BASE_URL, AUDIO_CONFIG } from "@/lib/constants";
import { useAuthStore } from "@/store/authStore";
import type {
  WsFinalResult,
  WsClientMessage,
  WsStatus,
} from "@/types/ws";
import { isFinalResult, isStatusMessage } from "@/types/ws";

// ---------- 공개 타입 ----------

/**
 * 훅의 상태 머신
 * - idle:         초기 상태 / 정리 완료
 * - connecting:   getUserMedia + WS 연결 진행 중
 * - recording:    오디오 스트리밍 중 (서버가 listening)
 * - processing:   stop 송신 후 서버 분석 대기 (서버가 processing)
 * - completed:    최종 결과 수신 완료
 * - error:        예외 발생
 */
export type StreamerStatus =
  | "idle"
  | "connecting"
  | "recording"
  | "processing"
  | "completed"
  | "error";

/**
 * 사용자 친화적 에러 코드
 * - 페이지 컴포넌트에서 모달/메시지 분기에 활용
 */
export type StreamerErrorCode =
  | "PERMISSION_DENIED" // 마이크 권한 거부
  | "DEVICE_NOT_FOUND" // 마이크 미연결
  | "NOT_SUPPORTED" // 브라우저 미지원
  | "NETWORK_ERROR" // WS 연결 실패 / 드롭
  | "AUTH_ERROR" // 토큰 없음 / 무효
  | "UNKNOWN";

export interface StreamerError {
  code: StreamerErrorCode;
  message: string;
}

export interface StartParams {
  sessionId: number;
  questionId: number;
  /** stop 시 함께 보낼 질문 텍스트 (서버의 AI 코칭 프롬프트에 사용) */
  questionText: string;
}

export interface UseAudioStreamerReturn {
  status: StreamerStatus;
  /** 0.0 ~ 1.0 정규화된 RMS 음량 (마이크 시각화용) */
  volume: number;
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

// ---------- 유틸 ----------

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
 * Float32 버퍼의 RMS(평균 제곱근) → 0~1 정규화
 * - 작은 노이즈 임계 미만은 0으로 보정하여 정적 상태 시 미세한 떨림 방지
 */
function calculateVolume(input: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < input.length; i++) {
    sum += input[i] * input[i];
  }
  const rms = Math.sqrt(sum / input.length);
  // RMS는 보통 0.0~0.3 범위. 시각적 가시성을 위해 약 3배 증폭 후 clamp
  const normalized = Math.min(1, rms * 3);
  return normalized < 0.02 ? 0 : normalized;
}

// ---------- 훅 ----------

export function useAudioStreamer(): UseAudioStreamerReturn {
  // 토큰은 직접 셀렉터로 구독하여 변경 시 최신값 사용
  const token = useAuthStore((s) => s.token);

  // ---------- 공개 상태 ----------
  const [status, setStatus] = useState<StreamerStatus>("idle");
  const [volume, setVolume] = useState(0);
  const [result, setResult] = useState<WsFinalResult | null>(null);
  const [error, setError] = useState<StreamerError | null>(null);
  const [localAudioUrl, setLocalAudioUrl] = useState<string | null>(null);

  // ---------- 내부 레퍼런스 (렌더 트리거 X) ----------
  const socketRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const localChunksRef = useRef<Blob[]>([]);
  /** stop 시 함께 보낼 메타데이터 보관 */
  const currentParamsRef = useRef<StartParams | null>(null);
  /** unmount 후 setState 호출 방지 */
  const isMountedRef = useRef(true);

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

    // 4) WebSocket: 결과 수신 후 호출되는 cleanup도 안전하게
    if (socketRef.current) {
      const ws = socketRef.current;
      // 이벤트 핸들러를 먼저 분리해 cleanup 중 onclose가 상태를 덮어쓰지 않게 함
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        try {
          ws.close();
        } catch {
          /* noop */
        }
      }
      socketRef.current = null;
    }

    safeSet(setVolume, 0);
  }, [safeSet]);

  // ---------- 언마운트 시 자동 정리 ----------
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      cleanup();
      // Blob URL 누수 방지
      setLocalAudioUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [cleanup]);

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
      currentParamsRef.current = params;
      safeSet(setError, null);
      safeSet(setResult, null);
      safeSet(setLocalAudioUrl, null);
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
          message = "마이크 권한이 거부되었습니다. 브라우저 설정에서 권한을 허용해주세요.";
        } else if (e.name === "NotFoundError" || e.name === "DevicesNotFoundError") {
          code = "DEVICE_NOT_FOUND";
          message = "마이크 장치를 찾을 수 없습니다.";
        }

        safeSet(setError, { code, message });
        safeSet(setStatus, "error");
        return;
      }

      streamRef.current = stream;

      // ---------- 2) MediaRecorder (로컬 재생용) ----------
      // 사용자가 결과 화면에서 자기 목소리를 들을 수 있도록 별도 녹음
      try {
        const recorder = new MediaRecorder(stream);
        localChunksRef.current = [];
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            localChunksRef.current.push(e.data);
          }
        };
        recorder.start();
        mediaRecorderRef.current = recorder;
      } catch {
        // MediaRecorder 미지원은 치명적이지 않으므로 경고만 (LocalAudio가 비활성화될 뿐)
        console.warn("[useAudioStreamer] MediaRecorder unavailable, local playback disabled.");
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

        // 오디오 파이프라인 구성 (소켓이 열린 뒤에 시작해 초기 청크 유실 방지)
        try {
          const ctx = new AudioContext({
            sampleRate: AUDIO_CONFIG.SAMPLE_RATE,
          });
          audioContextRef.current = ctx;

          const source = ctx.createMediaStreamSource(stream);
          sourceRef.current = source;

          const processor = ctx.createScriptProcessor(
            AUDIO_CONFIG.BUFFER_SIZE,
            AUDIO_CONFIG.CHANNELS,
            AUDIO_CONFIG.CHANNELS
          );
          processorRef.current = processor;

          processor.onaudioprocess = (e) => {
            const input = e.inputBuffer.getChannelData(0);

            // 음량 시각화 (RMS)
            const v = calculateVolume(input);
            // 너무 잦은 setState 방지: 직전 값과 0.02 이상 차이날 때만 업데이트
            if (isMountedRef.current) {
              setVolume((prev) => (Math.abs(prev - v) > 0.02 ? v : prev));
            }

            // PCM 송신
            if (socket.readyState === WebSocket.OPEN) {
              const pcm = floatTo16BitPCM(input);
              socket.send(pcm.buffer);
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

          // 1) 미래 호환: 서버가 status flag를 보내는 경우
          // TODO (Backend): Send status flags before final data
          if (isStatusMessage(data)) {
            const s = data.status as WsStatus;
            if (s === "listening") safeSet(setStatus, "recording");
            else if (s === "processing") safeSet(setStatus, "processing");
            // "completed"는 최종 결과와 함께 오므로 별도 처리 불필요
            return;
          }

          // 2) 최종 결과 수신
          if (isFinalResult(data)) {
            // 로컬 녹음 Blob URL 생성
            if (
              mediaRecorderRef.current &&
              mediaRecorderRef.current.state !== "inactive"
            ) {
              mediaRecorderRef.current.onstop = () => {
                const blob = new Blob(localChunksRef.current, {
                  type: "audio/webm",
                });
                const objUrl = URL.createObjectURL(blob);
                safeSet(setLocalAudioUrl, objUrl);
              };
              try {
                mediaRecorderRef.current.stop();
              } catch {
                /* noop */
              }
            }

            safeSet(setResult, data);
            safeSet(setStatus, "completed");

            // 결과 수신 후 소켓/오디오는 정리해도 안전
            cleanup();
          }
        } catch (err) {
          console.error("[useAudioStreamer] message parse error:", err);
        }
      };

      socket.onerror = () => {
        if (!isMountedRef.current) return;
        // onerror는 보통 onclose와 함께 오므로 상태 갱신은 onclose에서 수행
        console.error("[useAudioStreamer] WebSocket error");
      };

      socket.onclose = (event) => {
        if (!isMountedRef.current) return;

        // completed 직후 cleanup으로 인한 정상 close는 무시
        // (cleanup에서 onclose를 null로 설정하므로 이 분기는 비정상 종료만 도달)
        const wasCompleted = status === "completed";
        if (wasCompleted) return;

        // 비정상 종료
        let message = "서버와의 연결이 종료되었습니다.";
        if (event.code === 1006) {
          message = "네트워크 연결이 끊겼습니다. 다시 시도해주세요.";
        } else if (event.code === 1008 || event.code === 4401) {
          // 인증 실패 (관례적 코드)
          message = "인증에 실패했습니다. 다시 로그인해주세요.";
        }

        safeSet(setError, { code: "NETWORK_ERROR", message });
        safeSet(setStatus, "error");
      };
    },
    [token, cleanup, safeSet, status]
  );

  // ---------- stop ----------
  const stop = useCallback(() => {
    const params = currentParamsRef.current;
    const socket = socketRef.current;

    if (!socket || socket.readyState !== WebSocket.OPEN || !params) {
      // 연결이 이미 끊긴 경우 그냥 정리
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
  }, [cleanup, safeSet]);

  // ---------- reset ----------
  const reset = useCallback(() => {
    cleanup();
    if (localAudioUrl) URL.revokeObjectURL(localAudioUrl);
    safeSet(setLocalAudioUrl, null);
    safeSet(setResult, null);
    safeSet(setError, null);
    safeSet(setVolume, 0);
    safeSet(setStatus, "idle");
    currentParamsRef.current = null;
    localChunksRef.current = [];
  }, [cleanup, localAudioUrl, safeSet]);

  return {
    status,
    volume,
    result,
    error,
    localAudioUrl,
    start,
    stop,
    reset,
  };
}
