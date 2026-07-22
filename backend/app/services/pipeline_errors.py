"""
services/pipeline_errors.py
Sanitized, user-friendly exceptions for the audio-to-tab pipeline.
"""


class PipelineError(RuntimeError):
    """A pipeline failure that can be shown, in sanitized form, to the user."""

    def __init__(self, user_message: str, error_code: str = "pipeline_error"):
        self.user_message = user_message
        self.error_code = error_code
        super().__init__(user_message)


class InputQualityError(PipelineError):
    """The uploaded media does not meet minimum quality requirements."""

    def __init__(self, user_message: str):
        super().__init__(user_message, error_code="input_quality")


class ScoreQualityError(PipelineError):
    """The generated score is not usable (too few notes, extreme positions, etc.)."""

    def __init__(self, user_message: str):
        super().__init__(user_message, error_code="score_quality")
