/**
 * useAudioStreamer
 *
 * 책임:
 *  - 마이크 권한 요청 및 16kHz 모노 PCM 캡처
 *  - WebSocket(/ws/audio)으로 Int16 PCM 바이너리 스트리밍
 *  - 답변 종료 시 JSON 컨트롤 메시지 송신 → 서버 처리 단계(status) 및 최종 결과 수신
 *  - 음량(RMS) 계산하여 마이크 버튼 주변 시각화 데이터 노출
 *  - 모든 리소스(AudioContext, Stream, Socket) 안전한 해제
 *
 * 사용처:
 *  - /youtube (스피킹 연습)
 *  - /interview/room (음성 답변)
 *
 * 백엔드 계약 (main.py /ws/audio, BACKEND_PR.md TODO #4):
 *  - 쿼리: ?token={JWT}&session_id={n}&question_id={n}
 *  - 송신: ArrayBuffer (Int16 PCM, 16kHz) → 종료 시 JSON {type:"stop", session_id, question_id, question}
 *  - 수신: { type:"status", stage:"asr"|"scoring"|"coaching" } (처리 단계)
 *          → { type:"final", ... } (최종 1회) 또는 { "error": "..." } (인식 실패/내부 오류 1회)
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
  WsStage,
  WsErrorMessage,
} from "@/types/ws";
import { isFinalResult, isStatusMessage } from "@/types/ws";

// ---------- 공개 타입 ----------

/**
 * 훅의 상태 머신
 * - idle:         초기 상태 / 정리 완료
 * - connecting:   getUserMedia + WS 연결 진행 중
 * - recording:    오디오 스트리밍 중
 * - processing:   stop 송신 후 서버 분석 대기 (서버 stage: asr → scoring → coaching)
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
  /** 서버 처리 단계 (status==="processing" 동안 asr→scoring→coaching). 없으면 null */
  stage: WsStage | null;
  /** 0.0 ~ 1.0 정규화된 RMS 음량 (마이크 시각화용) */
  volume: number;
  /** 실시간 파형 시각화용 AnalyserNode. recording 동안 활성, 정리 시 null로 복귀.
   *  WaveformVisualizer에 그대로 prop으로 넘기면 된다. */
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
 * 실제 캡처 레이트 → 16kHz 다운샘플 (구간 평균, 간이 anti-alias).
 * 브라우저가 new AudioContext({sampleRate:16000}) 요청을 무시하고
 * 하드웨어 레이트(44100/48000 등)로 컨텍스트를 만드는 경우가 있어,
 * ctx.sampleRate를 신뢰하지 않고 송신 직전 16kHz로 변환한다.
 * (백엔드 AudioStreamFormat은 16kHz 고정 → 레이트 불일치 시 인식 실패)
 */
function downsampleTo16k(
  input: Float32Array,
  inputRate: number,
  targetRate: number
): Float32Array {
  if (targetRate >= inputRate) return input; // 이미 16kHz 이하면 그대로 (no-op)
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

/**
 * [작업 3 추가] MediaRecorder 컨테이너 mimeType 선택.
 *
 * - 명시하지 않으면 브라우저 기본값에 의존해 컨테이너 헤더 일관성이 떨어진다.
 * - 우선순위대로 isTypeSupported로 검사하여 첫 지원 타입을 사용.
 * - Safari는 webm 미지원 → audio/mp4 폴백. 모두 미지원이면 undefined(기본값 위임).
 * - 로컬 재생 Blob 타입을 이 값과 일치시켜야 Safari 등에서 재생 실패를 막는다.
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
 * 백엔드 main.py /ws/audio는 STT 인식 실패(NoMatch)/내부 예외 시
 * { "error": "..." } (type 태그 없는 레거시 형태)를 1회 보낸 뒤 소켓을 닫는다.
 * status/final과 달리 type 키가 없으므로 error 키(string) 존재 여부로 판별한다.
 *
 * NOTE: isStatusMessage / isFinalResult는 types/ws.ts에 있으나, 이 가드는
 *       현재 본 훅 전용이라 여기 둔다. 다른 곳에서도 쓰게 되면 ws.ts로 승격할 것.
 */
function isErrorMessage(msg: unknown): msg is WsErrorMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    typeof (msg as Record<string, unknown>).error === "string"
  );
}

// ---------- 훅 ----------

export function useAudioStreamer(): UseAudioStreamerReturn {
  // 토큰은 직접 셀렉터로 구독하여 변경 시 최신값 사용
  const token = useAuthStore((s) => s.token);

  // ---------- 공개 상태 ----------
  const [status, setStatus] = useState<StreamerStatus>("idle");
  const [stage, setStage] = useState<WsStage | null>(null);
  const [volume, setVolume] = useState(0);
  // ▼ 추가 — WaveformVisualizer가 받을 AnalyserNode 핸들 (state로 노출 + ref로 정리)
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [result, setResult] = useState<WsFinalResult | null>(null);
  const [error, setError] = useState<StreamerError | null>(null);
  const [localAudioUrl, setLocalAudioUrl] = useState<string | null>(null);

  // ---------- 내부 레퍼런스 (렌더 트리거 X) ----------
  const socketRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
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

    // 4) WebSocket: 결과 수신 후 호출되는 cleanup도 안전하게
    if (socketRef.current) {
      const ws = socketRef.current;
      // 이벤트 핸들러를 먼저 분리해 cleanup 중 onclose가 상태를 덮어쓰지 않게 함
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
    // ▼ 추가 — 컴포넌트 trees가 다음 세션 시작 시 새 analyser를 받게 한다
    safeSet(setAnalyser, null);
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
      // 사용자가 결과 화면에서 자기 목소리를 들을 수 있도록 별도 녹음.
      // [작업 3] mimeType을 명시해 컨테이너 헤더 일관성을 높이고 Safari 호환성 확보.
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
        // MediaRecorder 미지원은 치명적이지 않으므로 경고만 (LocalAudio가 비활성화될 뿐)
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

        // 오디오 파이프라인 구성 (소켓이 열린 뒤에 시작해 초기 청크 유실 방지)
        try {
          const ctx = new AudioContext({
            sampleRate: AUDIO_CONFIG.SAMPLE_RATE,
          });
          audioContextRef.current = ctx;

          const source = ctx.createMediaStreamSource(stream);
          sourceRef.current = source;

          // ── 파형 시각화용 분기 (Step 11-B) ─────────────────────
          // source에서 갈라져 나가는 별도 노선이라 PCM 송신 경로에 영향이 없다.
          // fftSize=256 → frequencyBinCount=128, 막대 32개 표현에 충분.
          // smoothingTimeConstant는 기본값(0.8) 그대로 — 막대가 너무 튀지 않게.
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

          // [A-2] 실제 캡처 레이트 확인. 브라우저가 16kHz 요청을 무시하고
          // 44100/48000 등으로 컨텍스트를 만들면, 송신 직전 downsampleTo16k로
          // 맞춰 백엔드 Azure 포맷(16kHz 고정)과 일치시킨다. (인식 실패 방지)
          // 한 번만 로깅 — 콘솔에 실제 레이트가 찍히면 레이트 불일치가 확정된다.
          const actualRate = ctx.sampleRate;
          if (actualRate !== AUDIO_CONFIG.SAMPLE_RATE) {
            console.info(
              `[useAudioStreamer] AudioContext가 16kHz 요청을 무시함 ` +
                `(실제 ${actualRate}Hz) → 송신 전 다운샘플 적용`
            );
          }

          processor.onaudioprocess = (e) => {
            const input = e.inputBuffer.getChannelData(0);

            // 음량 시각화 (RMS) — 원본 버퍼 기준 (레이트 무관)
            const v = calculateVolume(input);
            // 너무 잦은 setState 방지: 직전 값과 0.02 이상 차이날 때만 업데이트
            if (isMountedRef.current) {
              setVolume((prev) => (Math.abs(prev - v) > 0.02 ? v : prev));
            }

            // 16kHz로 변환 후 PCM 송신 (백엔드 Azure 포맷과 일치 보장)
            if (socket.readyState === WebSocket.OPEN) {
              const mono16k = downsampleTo16k(
                input,
                actualRate,
                AUDIO_CONFIG.SAMPLE_RATE
              );
              const pcm = floatTo16BitPCM(mono16k);
              // pcm은 new Int16Array(len)로 생성 → buffer는 항상 ArrayBuffer.
              // 일부 lib.dom 타입에서 buffer가 ArrayBufferLike(SharedArrayBuffer 포함)로
              // 추론되어 send() 시그니처와 충돌하므로 명시적으로 좁힌다. (TS2345 해소)
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

          // 1) 서버 처리 단계 메시지 (BACKEND_PR.md TODO #4 ✅)
          //    { type: "status", stage: "asr" | "scoring" | "coaching" }
          //    어떤 stage든 분석이 시작된 것이므로 processing 상태로 두고 stage만 갱신한다.
          if (isStatusMessage(data)) {
            safeSet(setStatus, "processing");
            safeSet(setStage, data.stage);
            return;
          }

          // 2) 서버 처리 에러 (STT 인식 실패 / 내부 예외)
          //    백엔드는 { "error": "..." }를 1회 보낸 뒤 소켓을 닫는다.
          //    이 프레임을 처리하지 않으면 직후의 close가 "연결이 끊겼어요"로
          //    오진되므로, 실제 사유를 노출하고 onclose 전에 정리한다.
          if (isErrorMessage(data)) {
            safeSet(setError, {
              code: "UNKNOWN",
              message:
                data.error || "답변을 처리하지 못했어요. 다시 시도해주세요.",
            });
            safeSet(setStatus, "error");
            // cleanup()이 socket.onclose를 분리하므로, 곧이은 소켓 close가
            // NETWORK_ERROR 팝업으로 덮어쓰지 못한다. (핵심 수정점)
            cleanup();
            return;
          }

          // 3) 최종 결과 수신
          if (isFinalResult(data)) {
            // 로컬 녹음 Blob URL 생성
            // [작업 3] recorder를 로컬로 캡처 — 직후 cleanup()이 ref를 null로 만들어도
            //          onstop 클로저는 안전. Blob 타입을 recorder.mimeType과 일치시켜
            //          Safari(audio/mp4) 등에서의 재생 실패를 방지한다.
            const recorder = mediaRecorderRef.current;
            if (recorder && recorder.state !== "inactive") {
              const blobType = recorder.mimeType || "audio/webm";
              recorder.onstop = () => {
                const blob = new Blob(localChunksRef.current, {
                  type: blobType,
                });
                const objUrl = URL.createObjectURL(blob);
                safeSet(setLocalAudioUrl, objUrl);
              };
              try {
                recorder.stop();
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
    safeSet(setStage, null);
    currentParamsRef.current = null;
    localChunksRef.current = [];
  }, [cleanup, localAudioUrl, safeSet]);

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
