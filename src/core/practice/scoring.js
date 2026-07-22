const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number(value) || 0));

export function pitchScoreFor(result) {
  if (!result || result.resultType === 'miss' && !Number.isFinite(result.detectedPitch)) return 0;
  const cents = Math.abs(Number(result.pitchDeviation) || 0);
  if (cents <= 25) return 100;
  if (cents <= 50) return Math.round(100 - (cents - 25) * 0.8);
  return Math.round(clamp(80 - (cents - 50) * 0.8));
}

export function timingScoreFor(result) {
  if (!result || result.resultType === 'miss' && !Number.isFinite(result.detectedPitch)) return 0;
  const offset = Math.abs(Number(result.timingOffsetMs) || 0);
  if (offset <= 50) return 100;
  if (offset <= 100) return Math.round(100 - (offset - 50) * 0.6);
  return Math.round(clamp(70 - (offset - 100) * (70 / 150)));
}

export function completenessScoreFor(result) {
  if (!result) return 0;
  if (result.resultType === 'correct') return result.score === 'perfect' ? 100 : 85;
  if (result.resultType === 'wrong-pitch') return 35;
  if (result.resultType === 'miss' && Number.isFinite(result.detectedPitch)) return 55;
  return 0;
}

export function scorePracticeResults(results = []) {
  const judged = results.filter((result) => result && result.resultType !== 'extra');
  if (!judged.length) {
    return {
      total: 0,
      noteAccuracy: 0,
      completeness: 0,
      timing: 0,
      correct: 0,
      missed: 0,
      grade: '--',
    };
  }

  const average = (values) => Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  const noteAccuracy = average(judged.map(pitchScoreFor));
  const chordResults = judged.filter((result) => result.targetType === 'chord');
  const completenessBase = chordResults.length ? chordResults : judged;
  const completeness = average(completenessBase.map(completenessScoreFor));
  const timing = average(judged.map(timingScoreFor));
  const total = Math.round(noteAccuracy * 0.5 + completeness * 0.3 + timing * 0.2);

  return {
    total,
    noteAccuracy,
    completeness,
    timing,
    correct: judged.filter((result) => result.resultType === 'correct').length,
    missed: judged.filter((result) => result.resultType === 'miss' && !Number.isFinite(result.detectedPitch)).length,
    grade: total >= 95 ? 'S' : total >= 85 ? 'A' : total >= 70 ? 'B' : total >= 60 ? 'C' : '继续练',
  };
}

