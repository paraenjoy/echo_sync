/**
 * ErrorModal — useAudioStreamer 에러를 사용자 친화적으로 안내
 *
 * 분기:
 *  - PERMISSION_DENIED  → 설정으로 이동 가이드
 *  - DEVICE_NOT_FOUND   → 마이크 연결 확인
 *  - NOT_SUPPORTED      → 브라우저 권장
 *  - NETWORK_ERROR      → 재시도 버튼
 *  - AUTH_ERROR         → 로그인 페이지 이동
 *  - UNKNOWN            → 일반 안내
 *
 * 사용처:
 *  - /youtube, /interview/room 등 useAudioStreamer를 쓰는 모든 페이지
 */
import { Button } from "@/components/ui/button";
import type { StreamerError } from "@/hooks/useAudioStreamer";

interface ErrorModalProps {
  error: StreamerError;
  /** 모달 닫기 (useAudioStreamer.reset 호출) */
  onDismiss: () => void;
  /** 재시도 가능한 에러일 때만 노출. 없으면 재시도 버튼 숨김 */
  onRetry?: () => void;
}

interface ErrorContent {
  title: string;
  description: string;
  primaryLabel: string;
  primaryAction: "retry" | "dismiss" | "settings" | "login";
}

function getContent(error: StreamerError): ErrorContent {
  switch (error.code) {
    case "PERMISSION_DENIED":
      return {
        title: "마이크 권한이 필요해요",
        description:
          "주소창 왼쪽 자물쇠 아이콘 또는 브라우저 설정에서 마이크 권한을 허용해주세요. 권한 변경 후 페이지를 새로고침하면 다시 시도할 수 있습니다.",
        primaryLabel: "확인",
        primaryAction: "dismiss",
      };
    case "DEVICE_NOT_FOUND":
      return {
        title: "마이크를 찾을 수 없어요",
        description:
          "기기에 마이크가 연결되어 있는지 확인해주세요. 외장 마이크 사용 시 케이블 연결 상태를 점검해보세요.",
        primaryLabel: "다시 시도",
        primaryAction: "retry",
      };
    case "NOT_SUPPORTED":
      return {
        title: "이 브라우저는 지원되지 않아요",
        description:
          "최신 Chrome, Edge, 또는 Safari를 사용해주세요. 일부 구형 브라우저는 실시간 음성 스트리밍 기능을 지원하지 않습니다.",
        primaryLabel: "확인",
        primaryAction: "dismiss",
      };
    case "NETWORK_ERROR":
      return {
        title: "연결이 끊겼어요",
        description:
          "네트워크 상태를 확인하고 다시 시도해주세요. 분석 도중 끊긴 경우 답변을 처음부터 다시 녹음해야 합니다.",
        primaryLabel: "다시 시도",
        primaryAction: "retry",
      };
    case "AUTH_ERROR":
      return {
        title: "다시 로그인이 필요해요",
        description: "세션이 만료되었습니다. 로그인 페이지로 이동합니다.",
        primaryLabel: "로그인하러 가기",
        primaryAction: "login",
      };
    default:
      return {
        title: "문제가 발생했어요",
        description: error.message || "잠시 후 다시 시도해주세요.",
        primaryLabel: "확인",
        primaryAction: "dismiss",
      };
  }
}

export function ErrorModal({ error, onDismiss, onRetry }: ErrorModalProps) {
  const content = getContent(error);

  const handlePrimary = () => {
    switch (content.primaryAction) {
      case "retry":
        if (onRetry) onRetry();
        else onDismiss();
        break;
      case "login":
        window.location.href = "/auth";
        break;
      case "settings":
      case "dismiss":
      default:
        onDismiss();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="error-modal-title"
      className="fixed inset-0 z-50 grid place-items-center p-4"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-bg/80 backdrop-blur-sm"
        onClick={onDismiss}
      />

      {/* Dialog */}
      <div
        className="relative max-w-md w-full bg-bg-elevated border border-border-strong rounded-xl p-6 animate-fade-up shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          <span className="grid place-items-center w-9 h-9 rounded-full bg-score-low/15 text-score-low shrink-0">
            <IconAlert />
          </span>
          <h2 id="error-modal-title" className="font-display text-xl pt-1">
            {content.title}
          </h2>
        </div>

        <p className="text-sm text-fg-muted leading-relaxed mb-6">
          {content.description}
        </p>

        <div className="flex gap-2 justify-end">
          {content.primaryAction === "retry" && (
            <Button variant="ghost" onClick={onDismiss}>
              취소
            </Button>
          )}
          <Button variant="primary" onClick={handlePrimary}>
            {content.primaryLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function IconAlert() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
