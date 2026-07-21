"""
services/weak_spots.py
Aggregate practice results into actionable weak spots by measure and segment.
"""

from collections import defaultdict
from typing import Any, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.practice_result import PracticeResult as PracticeResultModel


class PracticeResultAggregator:
    """Summarize practice results into weak spots and per-measure statistics."""

    def __init__(self, db: Session, course_id: str, session_id: Optional[str] = None):
        self.db = db
        self.course_id = course_id
        self.session_id = session_id

    def _base_query(self):
        query = self.db.query(PracticeResultModel).filter(
            PracticeResultModel.course_id == self.course_id
        )
        if self.session_id:
            query = query.filter(PracticeResultModel.session_id == self.session_id)
        return query

    def by_measure(self) -> Dict[int, Dict[str, Any]]:
        """Return per-measure stats keyed by measure index (1-based)."""
        # target_event_id is in the form evt_courseid_NNNN, and the measure index
        # is embedded in the timeline event. For MVP we aggregate by the stored
        # target_event_id only when the event_id is not available; otherwise the
        # frontend is expected to send measure_index alongside results.
        rows = (
            self._base_query()
            .with_entities(
                PracticeResultModel.target_event_id,
                PracticeResultModel.result_type,
                func.count(PracticeResultModel.id),
            )
            .group_by(
                PracticeResultModel.target_event_id,
                PracticeResultModel.result_type,
            )
            .all()
        )

        by_event: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
        for event_id, result_type, count in rows:
            by_event[event_id][result_type] = count

        return dict(by_event)

    def summary(self) -> Dict[str, Any]:
        """Return a high-level summary of the weakest areas."""
        total = self._base_query().count()
        if total == 0:
            return {
                "total": 0,
                "accuracy": 0.0,
                "weak_events": [],
                "top_error_types": [],
            }

        correct = (
            self._base_query()
            .filter(PracticeResultModel.result_type == "correct")
            .count()
        )
        accuracy = correct / total if total else 0.0

        # Top error types across all results.
        error_counts = (
            self._base_query()
            .filter(PracticeResultModel.result_type != "correct")
            .with_entities(
                PracticeResultModel.result_type,
                func.count(PracticeResultModel.id),
            )
            .group_by(PracticeResultModel.result_type)
            .order_by(func.count(PracticeResultModel.id).desc())
            .all()
        )

        # Events with the most errors (excluding correct).
        weak_events = (
            self._base_query()
            .filter(PracticeResultModel.result_type != "correct")
            .with_entities(
                PracticeResultModel.target_event_id,
                func.count(PracticeResultModel.id),
            )
            .group_by(PracticeResultModel.target_event_id)
            .order_by(func.count(PracticeResultModel.id).desc())
            .limit(10)
            .all()
        )

        return {
            "total": total,
            "accuracy": round(accuracy, 4),
            "top_error_types": [
                {"type": error_type, "count": count}
                for error_type, count in error_counts
            ],
            "weak_events": [
                {"event_id": event_id, "error_count": count}
                for event_id, count in weak_events
                if event_id
            ],
        }
