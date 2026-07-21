"""Strict validation models for uploaded Canonical Score JSON."""

from __future__ import annotations

import math
from typing import Annotated, Any

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StrictInt,
    StrictStr,
    ValidationInfo,
    field_validator,
    model_validator,
)


MAX_SCORE_DURATION_SECONDS = 600.0
MAX_SCORE_BPM = 400.0
MAX_BEATS_PER_BAR = 32
SUPPORTED_BEAT_UNITS = {1, 2, 4, 8, 16}
TIME_TOLERANCE_SECONDS = 1e-4
STRING_OPEN_MIDI = (64, 59, 55, 50, 45, 40)


def _reject_bool(value: Any) -> Any:
    """JSON booleans are integers in Python, but never valid music numbers."""
    if isinstance(value, bool):
        raise ValueError("boolean values are not valid numbers")
    return value


FiniteNumber = Annotated[
    float,
    BeforeValidator(_reject_bool),
    Field(strict=True, allow_inf_nan=False),
]


class CanonicalModel(BaseModel):
    # Imported/front-end scores can contain richer IDs and presentation fields.
    # Keep those JSON fields while validating every canonical field we consume.
    model_config = ConfigDict(extra="allow")


class CanonicalNote(CanonicalModel):
    string: StrictInt = Field(ge=1, le=6)
    fret: StrictInt = Field(ge=0, le=19)
    start_time: FiniteNumber = Field(alias="startTime", ge=0, le=MAX_SCORE_DURATION_SECONDS)
    end_time: FiniteNumber = Field(alias="endTime", gt=0, le=MAX_SCORE_DURATION_SECONDS)
    midi: StrictInt = Field(ge=40, le=83)

    @model_validator(mode="after")
    def validate_time_range(self) -> "CanonicalNote":
        if self.end_time <= self.start_time:
            raise ValueError("note endTime must be greater than startTime")
        expected_midi = STRING_OPEN_MIDI[self.string - 1] + self.fret
        if self.midi != expected_midi:
            raise ValueError("note MIDI does not match its string and fret")
        return self


class CanonicalBeat(CanonicalModel):
    start_time: FiniteNumber = Field(alias="startTime", ge=0)
    end_time: FiniteNumber = Field(alias="endTime", gt=0)
    notes: list[CanonicalNote]

    @model_validator(mode="after")
    def validate_timeline(self) -> "CanonicalBeat":
        if self.end_time <= self.start_time:
            raise ValueError("beat endTime must be greater than startTime")

        previous_start = -math.inf
        for note in self.notes:
            if note.start_time + TIME_TOLERANCE_SECONDS < previous_start:
                raise ValueError("notes must be ordered by non-decreasing startTime")
            if note.start_time + TIME_TOLERANCE_SECONDS < self.start_time:
                raise ValueError("note startTime must be inside its beat")
            if note.start_time > self.end_time + TIME_TOLERANCE_SECONDS:
                raise ValueError("note startTime must be inside its beat")
            previous_start = note.start_time
        return self


class CanonicalBar(CanonicalModel):
    index: StrictInt = Field(ge=1)
    start_time: FiniteNumber = Field(alias="startTime", ge=0)
    end_time: FiniteNumber = Field(alias="endTime", gt=0)
    beats: list[CanonicalBeat] = Field(min_length=1, max_length=MAX_BEATS_PER_BAR)

    @model_validator(mode="after")
    def validate_timeline(self) -> "CanonicalBar":
        if self.end_time <= self.start_time:
            raise ValueError("bar endTime must be greater than startTime")

        previous_end = self.start_time
        for beat in self.beats:
            if beat.start_time + TIME_TOLERANCE_SECONDS < previous_end:
                raise ValueError("beats must be ordered and must not overlap")
            if beat.start_time + TIME_TOLERANCE_SECONDS < self.start_time:
                raise ValueError("beat startTime must be inside its bar")
            if beat.end_time > self.end_time + TIME_TOLERANCE_SECONDS:
                raise ValueError("beat endTime must be inside its bar")
            previous_end = beat.end_time
        return self


class CanonicalScore(CanonicalModel):
    """The minimum score contract emitted by ``services.score_builder``."""

    id: StrictStr = Field(min_length=1, max_length=255)
    title: StrictStr = Field(min_length=1, max_length=255)
    source_video_url: StrictStr = Field(alias="sourceVideoUrl", max_length=4096)
    local_video_path: StrictStr = Field(alias="localVideoPath", max_length=4096)
    duration: FiniteNumber = Field(ge=0, le=MAX_SCORE_DURATION_SECONDS)
    bpm: FiniteNumber = Field(ge=1, le=MAX_SCORE_BPM)
    time_signature: list[StrictInt] = Field(
        alias="timeSignature",
        min_length=2,
        max_length=2,
    )
    key: StrictStr = Field(min_length=1, max_length=32)
    bars: list[CanonicalBar] = Field(min_length=1)
    created_at: StrictInt = Field(alias="createdAt", ge=0)
    updated_at: StrictInt = Field(alias="updatedAt", ge=0)

    @field_validator("time_signature")
    @classmethod
    def validate_time_signature(cls, value: list[int]) -> list[int]:
        numerator, denominator = value
        if not 1 <= numerator <= MAX_BEATS_PER_BAR:
            raise ValueError(f"time-signature numerator must be between 1 and {MAX_BEATS_PER_BAR}")
        if denominator not in SUPPORTED_BEAT_UNITS:
            raise ValueError("unsupported time-signature denominator")
        return value

    @model_validator(mode="after")
    def validate_score_timeline(self, info: ValidationInfo) -> "CanonicalScore":
        numerator, denominator = self.time_signature
        beat_seconds = (60.0 / self.bpm) * (4.0 / denominator)
        bar_seconds = beat_seconds * numerator
        padded_timeline_end = self.duration + bar_seconds + TIME_TOLERANCE_SECONDS

        previous_end = 0.0
        for expected_index, bar in enumerate(self.bars, start=1):
            if bar.index != expected_index:
                raise ValueError("bar indices must be consecutive and start at 1")
            if len(bar.beats) != numerator:
                raise ValueError("each bar must contain the time-signature number of beats")
            if bar.start_time + TIME_TOLERANCE_SECONDS < previous_end:
                raise ValueError("bars must be ordered and must not overlap")
            if bar.start_time > self.duration + TIME_TOLERANCE_SECONDS:
                raise ValueError("bar timeline starts after the score duration")
            # The builder emits a complete final measure, whose structural end
            # may be after the media duration. It can never extend by > 1 bar.
            if bar.end_time > padded_timeline_end:
                raise ValueError("bar timeline exceeds the score duration")
            previous_end = bar.end_time

            for beat in bar.beats:
                if beat.end_time > padded_timeline_end:
                    raise ValueError("beat timeline exceeds the score duration")
                for note in beat.notes:
                    if note.end_time > self.duration + TIME_TOLERANCE_SECONDS:
                        raise ValueError("note timeline exceeds the score duration")

        context = info.context if isinstance(info.context, dict) else {}
        course_duration = context.get("course_duration")
        if course_duration is not None:
            course_duration = float(course_duration)
            if course_duration > 0 and self.duration > course_duration + TIME_TOLERANCE_SECONDS:
                raise ValueError("score duration exceeds the course duration")
        return self
