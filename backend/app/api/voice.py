"""
api/voice.py
Voice control proxy: receives audio from the browser, transcribes it with
Baidu Speech Recognition, and parses the command with a configurable LLM.
"""

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.services.voice_service import recognize_and_parse

router = APIRouter(prefix="/api/v1/voice", tags=["voice"])


@router.post("/recognize")
async def recognize_voice_command(audio: UploadFile = File(...)):
    """Upload an audio snippet and receive a structured voice command."""
    try:
        audio_bytes = await audio.read()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not read audio: {exc}") from exc

    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Audio file is empty")

    suffix = ".webm"
    if audio.filename:
        name = audio.filename.lower()
        if name.endswith(".wav"):
            suffix = ".wav"
        elif name.endswith(".mp3"):
            suffix = ".mp3"
        elif name.endswith(".m4a"):
            suffix = ".m4a"
        elif name.endswith(".ogg"):
            suffix = ".ogg"
        elif name.endswith(".webm"):
            suffix = ".webm"

    try:
        result = await recognize_and_parse(audio_bytes, suffix)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Voice processing failed: {exc}") from exc

    return result
