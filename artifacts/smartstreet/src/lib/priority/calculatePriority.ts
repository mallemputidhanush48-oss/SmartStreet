export type PriorityLevel = 'low' | 'medium' | 'high' | 'critical';

export type PriorityFactors = {
  location_importance: number;
  traffic_importance: number;
  repeated_reports: number;
  failure_hours: number;
};

export type PriorityResult = {
  score: number;
  level: PriorityLevel;
};

const BASE_SEVERITY: Record<string, number> = {
  exposed_wiring: 74,
  'exposed wires': 74,
  electrical_hazard: 74,
  complete_outage: 52,
  light_out: 52,
  light_outage: 52,
  not_working: 52,
  damaged_fixture: 44,
  broken_fixture: 44,
  damaged: 44,
  damaged_pole: 48,
  flickering: 29,
  light_always_on: 12,
  daytime_on: 12,
};

export function calculatePriority(
  issueType: string,
  factors: PriorityFactors,
): PriorityResult {
  const base = BASE_SEVERITY[issueType.trim().toLowerCase()] ?? 24;
  const location = clamp(factors.location_importance, 0, 20);
  const traffic = clamp(factors.traffic_importance, 0, 20);
  const repeatReports = Math.min(16, Math.max(0, factors.repeated_reports) * 4);
  const failureDuration = Math.min(
    16,
    Math.max(0, Math.floor(factors.failure_hours / 24)) * 4,
  );
  const score = Math.min(100, base + location + traffic + repeatReports + failureDuration);

  return {
    score,
    level:
      score >= 80 ? 'critical' :
      score >= 60 ? 'high' :
      score >= 40 ? 'medium' : 'low',
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
