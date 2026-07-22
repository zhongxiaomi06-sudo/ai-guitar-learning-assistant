"""
app/services/voice_service.py
Handles Baidu speech recognition and LLM-based command parsing
for hands-free voice control in the practice workspace.
"""

import base64
import json
import re
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import urlencode

import httpx

from app.config import Settings, get_settings

BAIDU_TOKEN_URL = "https://aip.baidubce.com/oauth/2.0/token"
BAIDU_ASR_URL = "https://vop.baidu.com/server_api"

# Caching the token in memory is sufficient for the MVP. It expires after 30 days.
_baidu_token_cache: dict = {}

# Fallback keyword matching when the LLM is not configured.
_FALLBACK_KEYWORDS = [
    ("play", ["播放", "开始", "继续", "start", "play"], {"action": "toggle-play", "payload": {"play": True}}),
    ("pause", ["暂停", "停", "pause", "stop"], {"action": "toggle-play", "payload": {"play": False}}),
    ("restart", ["重练", "重来", "再来一次", "重播"], {"action": "seek-to-segment-start", "payload": {}}),
    ("slow", ["慢一点", "降速", "慢"], {"action": "adjust-speed", "payload": {"delta": -1}}),
    ("fast", ["快一点", "提速", "快"], {"action": "adjust-speed", "payload": {"delta": 1}}),
    ("normal", ["原速", "恢复速度", "正常速度"], {"action": "set-speed", "payload": {"speed": 1}}),
    ("loop", ["循环"], {"action": "toggle-loop", "payload": {"enabled": True}}),
    ("unloop", ["关闭循环"], {"action": "toggle-loop", "payload": {"enabled": False}}),
    ("mic-on", ["打开麦克风", "开启麦克风", "麦克风"], {"action": "open-mic", "payload": {"enabled": True}}),
    ("mic-off", ["关闭麦克风"], {"action": "open-mic", "payload": {"enabled": False}}),
    ("back", ["返回", "回去", "back"], {"action": "navigate", "payload": {"route": "overview"}}),
    ("next", ["下一片段", "下一个", "下一首"], {"action": "next-segment", "payload": {}}),
    ("prev", ["上一片段", "上一个", "上一首"], {"action": "prev-segment", "payload": {}}),
    ("focus", ["纠错", "攻克难点", "难点"], {"action": "open-focus", "payload": {}}),
    ("help", ["帮助", "有什么命令", "命令"], {"action": "show-voice-help", "payload": {}}),
    ("finish", ["结束", "完成", "finish"], {"action": "finish-practice", "payload": {}}),
]


def _normalize_text(text: str) -> str:
    """Remove punctuation and spaces for robust matching."""
    return re.sub(r"[，。？！\.\,\!\?\s]", "", text).lower()


def _fallback_parse(transcript: str) -> dict:
    text = _normalize_text(transcript)
    for _, keywords, cmd in _FALLBACK_KEYWORDS:
        for kw in keywords:
            if kw.lower() in text:
                return {
                    **cmd,
                    "confidence": 0.8,
                    "raw_text": transcript,
                    "reply": "",
                }
    return {
        "action": "unrecognized",
        "payload": {},
        "confidence": 0.0,
        "raw_text": transcript,
        "reply": "",
    }


def _build_command_prompt(transcript: str) -> str:
    """Return a detailed LLM prompt that teaches the available JSON schema."""
    return f"""You are a command parser for a guitar-practice web app called 弦间 (XianJian).
The user is holding a guitar and speaks a short Chinese command to control the app.

Available commands (action names and optional payload fields):
- toggle-play: pause or resume the video. payload: {{ "play": boolean }} (true=play, false=pause).
- seek-to-segment-start: restart the current segment. payload: {{}}.
- adjust-speed: change playback speed by one step. payload: {{ "delta": -1 or 1 }}.
- set-speed: set exact speed. payload: {{ "speed": number }} (e.g. 0.5, 0.6, 0.75, 0.9, 1).
- toggle-loop: turn A/B loop on/off. payload: {{ "enabled": boolean }}.
- open-mic: turn microphone on/off. payload: {{ "enabled": boolean }}.
- navigate: go to a route. payload: {{ "route": "overview" | "player" | "focus" | "results" | "library" | "home" }}.
- next-segment: go to next segment. payload: {{}}.
- prev-segment: go to previous segment. payload: {{}}.
- open-focus: enter focus/drill mode. payload: {{}}.
- finish-practice: end the practice session. payload: {{}}.
- show-voice-help: show the voice command help overlay. payload: {{}}.
- unrecognized: the spoken text does not match any command. payload: {{}}.

Return ONLY a valid JSON object with no Markdown formatting:
{{
  "action": "<action name>",
  "payload": {{ ... }},
  "confidence": 0.0-1.0,
  "raw_text": "<the transcription>",
  "reply": "<a short Chinese phrase to speak back to the user, or empty>"
}}

Examples:
"播放" -> {{"action":"toggle-play","payload":{{"play":true}},"confidence":1.0,"raw_text":"播放","reply":"已播放"}}
"暂停" -> {{"action":"toggle-play","payload":{{"play":false}},"confidence":1.0,"raw_text":"暂停","reply":"已暂停"}}
"慢一点" -> {{"action":"adjust-speed","payload":{{"delta":-1}},"confidence":1.0,"raw_text":"慢一点","reply":"已降速"}}
"快一点" -> {{"action":"adjust-speed","payload":{{"delta":1}},"confidence":1.0,"raw_text":"快一点","reply":"已提速"}}
"原速" -> {{"action":"set-speed","payload":{{"speed":1}},"confidence":1.0,"raw_text":"原速","reply":"已恢复原始速度"}}
"循环" -> {{"action":"toggle-loop","payload":{{"enabled":true}},"confidence":0.9,"raw_text":"循环","reply":"已开启循环"}}
"关闭循环" -> {{"action":"toggle-loop","payload":{{"enabled":false}},"confidence":0.9,"raw_text":"关闭循环","reply":"已关闭循环"}}
"纠错" -> {{"action":"open-focus","payload":{{}},"confidence":1.0,"raw_text":"纠错","reply":"进入纠错模式"}}
"返回" -> {{"action":"navigate","payload":{{"route":"overview"}},"confidence":0.9,"raw_text":"返回","reply":"已返回"}}
"下一首" -> {{"action":"next-segment","payload":{{}},"confidence":0.9,"raw_text":"下一首","reply":"下一片段"}}
"上一首" -> {{"action":"prev-segment","payload":{{}},"confidence":0.9,"raw_text":"上一首","reply":"上一片段"}}
"结束" -> {{"action":"finish-practice","payload":{{}},"confidence":1.0,"raw_text":"结束","reply":"练习已结束"}}
"打开麦克风" -> {{"action":"open-mic","payload":{{"enabled":true}},"confidence":1.0,"raw_text":"打开麦克风","reply":"麦克风已开启"}}
"关闭麦克风" -> {{"action":"open-mic","payload":{{"enabled":false}},"confidence":1.0,"raw_text":"关闭麦克风","reply":"麦克风已关闭"}}
"帮助" -> {{"action":"show-voice-help","payload":{{}},"confidence":1.0,"raw_text":"帮助","reply":""}}
"弦间，播放" -> {{"action":"toggle-play","payload":{{"play":true}},"confidence":1.0,"raw_text":"弦间，播放","reply":"已播放"}}

Now parse the following transcription and return only JSON:
"{transcript}"
""".strip()


def _ensure_wav_16k(input_bytes: bytes, suffix: str) -> bytes:
    """Convert uploaded webm/opus/etc. into 16kHz mono PCM WAV for Baidu ASR."""
    if suffix in {".wav", ".pcm"}:
        return input_bytes

    with tempfile.TemporaryDirectory(prefix="guitar_voice_") as work_dir:
        src_path = Path(work_dir) / f"audio{suffix}"
        dst_path = Path(work_dir) / "audio_16k.wav"
        src_path.write_bytes(input_bytes)
        try:
            subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-i",
                    str(src_path),
                    "-ar",
                    "16000",
                    "-ac",
                    "1",
                    "-sample_fmt",
                    "s16",
                    str(dst_path),
                ],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
        except (subprocess.CalledProcessError, FileNotFoundError) as exc:
            raise RuntimeError(f"Could not convert audio to WAV: {exc}") from exc
        return dst_path.read_bytes()


async def _get_baidu_token(settings: Settings) -> str:
    """Fetch or reuse a Baidu access token."""
    cache = _baidu_token_cache
    if cache.get("token"):
        return cache["token"]

    if not settings.baidu_speech_api_key or not settings.baidu_speech_secret_key:
        raise RuntimeError("Baidu speech API credentials are not configured")

    params = {
        "grant_type": "client_credentials",
        "client_id": settings.baidu_speech_api_key,
        "client_secret": settings.baidu_speech_secret_key,
    }
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(f"{BAIDU_TOKEN_URL}?{urlencode(params)}")
        response.raise_for_status()
        payload = response.json()
        token = payload.get("access_token")
        if not token:
            raise RuntimeError(f"Baidu token response missing token: {payload}")
        cache["token"] = token
        return token


async def _transcribe_with_baidu(audio_bytes: bytes, settings: Settings) -> str:
    """Send 16kHz WAV bytes to Baidu short-speech recognition and return the transcript."""
    token = await _get_baidu_token(settings)
    cuid = settings.baidu_speech_app_id or "xianjian"

    body = {
        "format": "wav",
        "rate": 16000,
        "channel": 1,
        "cuid": cuid,
        "token": token,
        "len": len(audio_bytes),
        "speech": base64.b64encode(audio_bytes).decode("utf-8"),
        "dev_pid": settings.baidu_speech_dev_pid,
    }

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(BAIDU_ASR_URL, json=body)
        response.raise_for_status()
        payload = response.json()

    if payload.get("err_no") != 0:
        raise RuntimeError(f"Baidu ASR error {payload.get('err_no')}: {payload.get('err_msg')}")

    result = payload.get("result", [])
    if not result:
        return ""
    return result[0]


async def _parse_with_llm(transcript: str, settings: Settings) -> dict:
    """Ask the configured LLM to parse a natural-language command into an action."""
    if not settings.llm_api_key:
        return _fallback_parse(transcript)

    system_prompt = "You are a helpful command parser. Return only the requested JSON."
    user_prompt = _build_command_prompt(transcript)

    body = {
        "model": settings.llm_model,
        "temperature": settings.llm_temperature,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            f"{settings.llm_api_base.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {settings.llm_api_key}", "Content-Type": "application/json"},
            json=body,
        )
        response.raise_for_status()
        payload = response.json()

    choices = payload.get("choices", [])
    if not choices:
        return _fallback_parse(transcript)

    content = choices[0].get("message", {}).get("content", "")
    content = content.strip()
    if content.startswith("```"):
        content = content.strip("`")
        if content.lower().startswith("json"):
            content = content[4:].strip()

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        return _fallback_parse(transcript)

    if not isinstance(parsed, dict) or "action" not in parsed:
        return _fallback_parse(transcript)

    return {
        "action": parsed.get("action", "unrecognized"),
        "payload": parsed.get("payload", {}),
        "confidence": parsed.get("confidence", 0.8),
        "raw_text": parsed.get("raw_text", transcript),
        "reply": parsed.get("reply", ""),
    }


async def recognize_and_parse(audio_bytes: bytes, suffix: str = ".webm") -> dict:
    """End-to-end: convert audio, recognize with Baidu, parse with LLM or fallback."""
    settings = get_settings()

    wav_bytes = _ensure_wav_16k(audio_bytes, suffix)
    transcript = await _transcribe_with_baidu(wav_bytes, settings)
    if not transcript:
        return {
            "action": "unrecognized",
            "payload": {},
            "confidence": 0.0,
            "raw_text": "",
            "reply": "",
        }

    return await _parse_with_llm(transcript, settings)


