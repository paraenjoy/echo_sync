import yt_dlp
import whisper
import os
import re
import fitz

def extract_text_from_pdf(file_path):
    try:
        doc = fitz.open(file_path)
        text = ""
        for page in doc:
            text += page.get_text()
        doc.close()
        return text.strip()
    except Exception as e:
        print(f"PDF 추출 중 에러 발생: {e}")
        return ""


print("⏳ Whisper 모델을 로드 중입니다... (최초 실행 시 시간이 소요될 수 있음)")
model = whisper.load_model("base")


def extract_video_id(url):
    pattern = r'(?:v=|\/)([0-9A-Za-z_-]{11}).*'
    match = re.search(pattern, url)
    return match.group(1) if match else None


def get_transcript_via_whisper(url):
    video_id = extract_video_id(url)
    if not video_id:
        print("❌ 유효하지 않은 유튜브 URL입니다.")
        return None

    audio_filename = f"temp_{video_id}.mp3"

    ydl_opts = {
        'format': 'bestaudio/best',
        'ffmpeg_location': './',
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192',
        }],
        'outtmpl': f"temp_{video_id}",
        'quiet': True,
    }

    try:
        print(f"🎵 오디오 데이터 추출 중... (ID: {video_id})")
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])

        if not os.path.exists(audio_filename):
            if os.path.exists(f"temp_{video_id}"):
                os.rename(f"temp_{video_id}", audio_filename)

        print("🧠 AI가 영상을 분석하여 텍스트로 변환 중입니다...")
        result = model.transcribe(audio_filename)
        full_text = result['text']

        if os.path.exists(audio_filename):
            os.remove(audio_filename)

        print("✅ 전사 완료!")
        return full_text

    except Exception as e:
        print(f"❌ Whisper 처리 중 에러 발생: {e}")
        if os.path.exists(audio_filename):
            os.remove(audio_filename)
        return None