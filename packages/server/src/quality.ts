import { getProductMetricsOverview, type Storage } from "@personal-ai/core";
import { listBeliefs, listFindings, listInsights, summarizeResearchSources } from "@personal-ai/library";
import { getAverageRating } from "./digest-ratings.js";
import { listLearningRuns } from "./learning.js";

const QUALITY_TARGETS = {
  memoryUtilization: 60,
  memoryReinforcementRate: 30,
  provenanceCoverage: 80,
  invalidationRate: 25,
  learningSuccessRate: 85,
  learningAcceptanceRate: 60,
  learningYieldRate: 70,
  failedSignalRunRate: 10,
  feedbackRate: 20,
  feedbackAverageRating: 80,
  recommendationAcceptanceRate: 20,
  trustedDecisionLoopRate: 35,
  briefActionCompletionRate: 35,
  correctionCarryForwardRate: 95,
  compoundingCoverage: 70,
  compoundingEvidenceCoverage: 80,
  findingSourceCoverage: 70,
  supportedHighConfidenceFindings: 90,
  findingNoveltyCoverage: 60,
  highConfidenceNovelFindings: 75,
  authoritativeFindingCoverage: 60,
  highConfidenceAuthoritativeFindings: 80,
} as const;

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function percentage(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return clampPercent((numerator / denominator) * 100);
}

function scoreAgainstTarget(value: number, target: number): number {
  if (target <= 0) return 100;
  return clampPercent((value / target) * 100);
}

function scoreBelowTarget(value: number, maxAllowed: number): number {
  if (maxAllowed <= 0) return 100;
  return clampPercent(((maxAllowed - Math.min(value, maxAllowed)) / maxAllowed) * 100);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return clampPercent(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function weightedAverage(values: Array<{ score: number; weight: number }>): number {
  if (values.length === 0) return 0;
  const totalWeight = values.reduce((sum, value) => sum + value.weight, 0);
  if (totalWeight <= 0) return 0;
  return clampPercent(values.reduce((sum, value) => sum + value.score * value.weight, 0) / totalWeight);
}

function geometricMean(values: number[]): number {
  if (values.length === 0) return 0;
  if (values.some((value) => value <= 0)) return 0;
  const product = values.reduce((result, value) => result * value, 1);
  return clampPercent(Math.pow(product, 1 / values.length));
}

export type QualityStatus = "good" | "warning" | "bad" | "insufficient_data";

function scoreToStatus(score: number): Exclude<QualityStatus, "insufficient_data"> {
  if (score >= 80) return "good";
  if (score >= 60) return "warning";
  return "bad";
}

function scoreToStatusWithSample(score: number, sampleSize: number, minSample: number): QualityStatus {
  if (sampleSize < minSample) return "insufficient_data";
  return scoreToStatus(score);
}

export interface QualityMetricScore {
  key: string;
  label: string;
  value: number;
  score: number;
  sampleSize: number;
  minSample: number;
  weight: number;
  status: QualityStatus;
  direction: "higher" | "lower";
  target?: number;
  maxAllowed?: number;
}

export interface QualityDomainScore {
  label: string;
  score: number;
  status: QualityStatus;
  metricCount: number;
  sufficientMetricCount: number;
  minSufficientMetrics: number;
  metrics: QualityMetricScore[];
}

export interface QualityDomains {
  trust: QualityDomainScore;
  loopEfficacy: QualityDomainScore;
  reliability: QualityDomainScore;
  userValue: QualityDomainScore;
}

function hasSufficientSample(sampleSize: number, minSample: number): boolean {
  return sampleSize >= minSample;
}

function buildHigherMetric(input: {
  key: string;
  label: string;
  value: number;
  target: number;
  sampleSize: number;
  minSample: number;
  weight: number;
}): QualityMetricScore {
  const score = scoreAgainstTarget(input.value, input.target);
  return {
    ...input,
    score,
    status: scoreToStatusWithSample(score, input.sampleSize, input.minSample),
    direction: "higher",
  };
}

function buildLowerMetric(input: {
  key: string;
  label: string;
  value: number;
  maxAllowed: number;
  sampleSize: number;
  minSample: number;
  weight: number;
}): QualityMetricScore {
  const score = scoreBelowTarget(input.value, input.maxAllowed);
  return {
    ...input,
    score,
    status: scoreToStatusWithSample(score, input.sampleSize, input.minSample),
    direction: "lower",
  };
}

function buildDomain(label: string, metrics: QualityMetricScore[]): QualityDomainScore {
  const sufficientMetrics = metrics.filter((metric) => hasSufficientSample(metric.sampleSize, metric.minSample));
  const sufficientMetricCount = sufficientMetrics.length;
  const minSufficientMetrics = Math.max(1, Math.ceil(metrics.length * 0.75));
  const score = weightedAverage(sufficientMetrics.map((metric) => ({ score: metric.score, weight: metric.weight })));
  return {
    label,
    score,
    status: scoreToStatusWithSample(score, sufficientMetricCount, minSufficientMetrics),
    metricCount: metrics.length,
    sufficientMetricCount,
    minSufficientMetrics,
    metrics,
  };
}

export interface LearningQuality {
  score: number;
  recentRuns: number;
  signalBearingRuns: number;
  successRate: number;
  acceptanceRate: number;
  yieldRate: number;
}

export interface MemoryQuality {
  score: number;
  total: number;
  neverAccessed: number;
  reinforced: number;
  invalidated: number;
  utilization: number;
  reinforcementRate: number;
  provenanceCoverage: number;
  invalidationRate: number;
}

export interface FeedbackQuality {
  score: number;
  totalDigests: number;
  digestsRated: number;
  corrections: number;
  avgRating: number | null;
  activity: number;
}

export interface KnowledgeQuality {
  score: number;
  insights: number;
  findings: number;
  chainedFindings: number;
  findingsWithSources: number;
  findingSourceCoverage: number;
  authoritativeFindingCoverage: number;
  primaryFindingCoverage: number;
  noveltyCoverage: number;
  highConfidenceFindings: number;
  highConfidenceNovelFindings: number;
  highConfidenceAuthoritativeFindings: number;
  supportedHighConfidenceFindings: number;
  watchesActive: number;
  eligibleWatches: number;
  coveredWatches: number;
  coverage: number;
  evidenceCoverage: number;
  growth: number;
}

export interface SystemQualityScore {
  score: number;
  status: QualityStatus;
  blockingDomains: string[];
  domains: QualityDomains;
  learning: LearningQuality;
  memory: MemoryQuality;
  feedback: FeedbackQuality;
  knowledge: KnowledgeQuality;
}

export function getSystemQualityScore(storage: Storage): SystemQualityScore {
  const activeBeliefs = listBeliefs(storage, "active");
  const allBeliefs = listBeliefs(storage, "all");
  const invalidatedBeliefs = allBeliefs.filter((belief) => belief.status === "invalidated").length;
  const neverAccessed = activeBeliefs.filter((belief) => (belief.access_count ?? 0) === 0).length;
  let reinforcedBeliefIds = new Set<string>();
  try {
    reinforcedBeliefIds = new Set(
      storage.query<{ belief_id: string }>(
        "SELECT DISTINCT belief_id FROM belief_changes WHERE change_type = 'reinforced'",
      ).map((row) => row.belief_id),
    );
  } catch {
    reinforcedBeliefIds = new Set<string>();
  }
  const reinforced = activeBeliefs.filter((belief) =>
    belief.confidence >= 0.7 || reinforcedBeliefIds.has(belief.id),
  ).length;

  let provenanceCovered = 0;
  try {
    provenanceCovered = storage.query<{ count: number }>(
      `SELECT COUNT(DISTINCT belief_id) as count
       FROM belief_provenance
       WHERE belief_id IN (SELECT id FROM beliefs WHERE status = 'active')`,
    )[0]?.count ?? 0;
  } catch {
    provenanceCovered = 0;
  }

  const utilization = percentage(activeBeliefs.length - neverAccessed, activeBeliefs.length);
  const reinforcementRate = percentage(reinforced, activeBeliefs.length);
  const provenanceCoverage = percentage(provenanceCovered, activeBeliefs.length);
  const invalidationRate = percentage(invalidatedBeliefs, allBeliefs.length);
  const memoryScore = average([
    scoreAgainstTarget(utilization, QUALITY_TARGETS.memoryUtilization),
    scoreAgainstTarget(reinforcementRate, QUALITY_TARGETS.memoryReinforcementRate),
    scoreAgainstTarget(provenanceCoverage, QUALITY_TARGETS.provenanceCoverage),
    scoreBelowTarget(invalidationRate, QUALITY_TARGETS.invalidationRate),
  ]);

  const recentRuns = listLearningRuns(storage, 20).filter((run) => run.status !== "running");
  const signalBearingRuns = recentRuns.filter((run) =>
    run.threadsCount > 0 ||
    run.messagesCount > 0 ||
    run.researchCount > 0 ||
    run.tasksCount > 0 ||
    run.knowledgeCount > 0 ||
    run.findingsCount > 0 ||
    run.digestsCount > 0,
  );
  const successfulSignalRuns = signalBearingRuns.filter((run) => run.status === "done");
  const failedSignalRuns = signalBearingRuns.filter((run) => run.status === "error");
  const acceptedFacts = successfulSignalRuns.reduce((sum, run) => sum + run.beliefsCreated + run.beliefsReinforced, 0);
  const extractedFacts = successfulSignalRuns.reduce((sum, run) => sum + run.factsExtracted, 0);
  const runsWithYield = successfulSignalRuns.filter((run) => run.beliefsCreated + run.beliefsReinforced > 0).length;
  const learningSuccessRate = percentage(successfulSignalRuns.length, signalBearingRuns.length);
  const learningAcceptanceRate = percentage(acceptedFacts, extractedFacts);
  const learningYieldRate = percentage(runsWithYield, successfulSignalRuns.length);
  const failedSignalRunRate = percentage(failedSignalRuns.length, signalBearingRuns.length);
  const learningScore = average([
    scoreAgainstTarget(learningSuccessRate, QUALITY_TARGETS.learningSuccessRate),
    scoreAgainstTarget(learningAcceptanceRate, QUALITY_TARGETS.learningAcceptanceRate),
    scoreAgainstTarget(learningYieldRate, QUALITY_TARGETS.learningYieldRate),
  ]);

  let totalDigests = 0;
  try {
    totalDigests = storage.query<{ count: number }>(
      "SELECT COUNT(*) as count FROM briefings WHERE status = 'ready'",
    )[0]?.count ?? 0;
  } catch {
    totalDigests = 0;
  }

  let digestsRated = 0;
  try {
    digestsRated = storage.query<{ count: number }>(
      "SELECT COUNT(DISTINCT digest_id) as count FROM digest_ratings",
    )[0]?.count ?? 0;
  } catch {
    digestsRated = 0;
  }

  let corrections = 0;
  try {
    corrections = storage.query<{ count: number }>(
      "SELECT COUNT(DISTINCT brief_id) as count FROM product_events WHERE event_type = 'belief_corrected' AND brief_id IS NOT NULL",
    )[0]?.count ?? 0;
  } catch {
    corrections = 0;
  }

  let avgRating: number | null = null;
  try {
    avgRating = getAverageRating(storage, 20);
  } catch {
    avgRating = null;
  }
  const feedbackDigests = new Set<string>();
  try {
    for (const row of storage.query<{ id: string }>("SELECT DISTINCT digest_id as id FROM digest_ratings")) {
      feedbackDigests.add(row.id);
    }
  } catch {
    // ignore missing ratings table
  }
  try {
    for (const row of storage.query<{ id: string }>(
      "SELECT DISTINCT brief_id as id FROM product_events WHERE event_type = 'belief_corrected' AND brief_id IS NOT NULL",
    )) {
      feedbackDigests.add(row.id);
    }
  } catch {
    // ignore missing events table
  }

  const feedbackRate = percentage(feedbackDigests.size, totalDigests);
  const feedbackRatingScore = avgRating != null
    ? scoreAgainstTarget(avgRating * 20, QUALITY_TARGETS.feedbackAverageRating)
    : scoreAgainstTarget(feedbackRate, QUALITY_TARGETS.feedbackRate);
  const feedbackScore = average([
    scoreAgainstTarget(feedbackRate, QUALITY_TARGETS.feedbackRate),
    feedbackRatingScore,
  ]);

  let openedDailyDigests = 0;
  let acceptedDailyDigests = 0;
  let recommendationAcceptanceRate = 0;
  try {
    openedDailyDigests = storage.query<{ count: number }>(
      `SELECT COUNT(DISTINCT pe.brief_id) as count
       FROM product_events pe
       JOIN briefings b ON b.id = pe.brief_id
       WHERE pe.event_type = 'brief_opened'
         AND b.type = 'daily'`,
    )[0]?.count ?? 0;
    acceptedDailyDigests = storage.query<{ count: number }>(
      `SELECT COUNT(DISTINCT pe.brief_id) as count
       FROM product_events pe
       JOIN briefings b ON b.id = pe.brief_id
       WHERE pe.event_type = 'recommendation_accepted'
         AND b.type = 'daily'`,
    )[0]?.count ?? 0;
    recommendationAcceptanceRate = percentage(acceptedDailyDigests, openedDailyDigests);
  } catch {
    openedDailyDigests = 0;
    acceptedDailyDigests = 0;
    recommendationAcceptanceRate = 0;
  }

  let openedBriefs = 0;
  let trustedDecisionLoops = 0;
  let trustedDecisionLoopRate = 0;
  try {
    const overview = getProductMetricsOverview(storage, 30);
    openedBriefs = overview.openedBriefs;
    trustedDecisionLoops = overview.trustedDecisionLoops;
    trustedDecisionLoopRate = percentage(trustedDecisionLoops, openedBriefs);
  } catch {
    openedBriefs = 0;
    trustedDecisionLoops = 0;
    trustedDecisionLoopRate = 0;
  }

  let briefActionCreatedCount = 0;
  let briefActionCompletedCount = 0;
  try {
    const actionCounts = storage.query<{ created: number; completed: number }>(
      `SELECT
         SUM(CASE WHEN source_type = 'briefing' THEN 1 ELSE 0 END) as created,
         SUM(CASE WHEN source_type = 'briefing' AND status = 'done' AND completed_at IS NOT NULL THEN 1 ELSE 0 END) as completed
       FROM tasks`,
    )[0];
    briefActionCreatedCount = actionCounts?.created ?? 0;
    briefActionCompletedCount = actionCounts?.completed ?? 0;
  } catch {
    briefActionCreatedCount = 0;
    briefActionCompletedCount = 0;
  }
  const briefActionCompletionRate = percentage(briefActionCompletedCount, briefActionCreatedCount);

  let correctionsWithNextDigest = 0;
  let carriedForwardCorrections = 0;
  try {
    const dailyBriefs = storage.query<{ id: string; generated_at: string }>(
      "SELECT id, generated_at FROM briefings WHERE status = 'ready' AND type = 'daily' ORDER BY generated_at ASC",
    );
    const briefBeliefRows = storage.query<{ brief_id: string; belief_id: string }>(
      `SELECT brief_id, belief_id
       FROM brief_beliefs
       WHERE brief_id IN (
         SELECT id FROM briefings WHERE status = 'ready' AND type = 'daily'
       )`,
    );
    const briefBeliefsByBrief = new Map<string, Set<string>>();
    for (const row of briefBeliefRows) {
      const existing = briefBeliefsByBrief.get(row.brief_id) ?? new Set<string>();
      existing.add(row.belief_id);
      briefBeliefsByBrief.set(row.brief_id, existing);
    }

    const correctionRows = storage.query<{
      event_belief_id: string;
      status: string | null;
      supersedes: string | null;
      superseded_by: string | null;
      corrected_at: string;
      origin_brief_id: string;
    }>(
      `SELECT
         pe.belief_id as event_belief_id,
         b.status as status,
         b.supersedes as supersedes,
         b.superseded_by as superseded_by,
         pe.occurred_at as corrected_at,
         pe.brief_id as origin_brief_id
       FROM product_events pe
       LEFT JOIN beliefs b ON b.id = pe.belief_id
       WHERE pe.event_type = 'belief_corrected'
         AND pe.brief_id IS NOT NULL
         AND pe.belief_id IS NOT NULL
       ORDER BY pe.occurred_at ASC`,
    );

    for (const row of correctionRows) {
      const replacementBeliefId = row.supersedes
        ? row.event_belief_id
        : row.superseded_by ?? row.event_belief_id;
      const invalidatedBeliefId = row.supersedes
        ? row.supersedes
        : row.superseded_by
          ? row.event_belief_id
          : null;
      const nextDigest = dailyBriefs.find((brief) =>
        brief.generated_at > row.corrected_at && brief.id !== row.origin_brief_id
      );
      if (!nextDigest) continue;
      correctionsWithNextDigest += 1;
      const beliefIds = briefBeliefsByBrief.get(nextDigest.id) ?? new Set<string>();
      const hasReplacement = beliefIds.has(replacementBeliefId);
      const stillUsesInvalidated = invalidatedBeliefId ? beliefIds.has(invalidatedBeliefId) : false;
      if (hasReplacement && !stillUsesInvalidated) {
        carriedForwardCorrections += 1;
      }
    }
  } catch {
    correctionsWithNextDigest = 0;
    carriedForwardCorrections = 0;
  }
  const correctionCarryForwardRate = percentage(carriedForwardCorrections, correctionsWithNextDigest);

  let findings = [] as Array<{
    confidence: number;
    sources: Array<{ url: string }>;
    previousFindingId?: string;
    delta?: { significance: number };
  }>;
  try {
    findings = listFindings(storage).map((finding) => ({
      confidence: finding.confidence,
      sources: finding.sources,
      previousFindingId: finding.previousFindingId,
      delta: finding.delta,
    }));
  } catch {
    findings = [];
  }

  let insights = [] as Array<{ watchId: string | null; sources: string[] }>;
  try {
    insights = listInsights(storage).map((insight) => ({
      watchId: insight.watchId,
      sources: insight.sources,
    }));
  } catch {
    insights = [];
  }

  let watchesActive = 0;
  try {
    watchesActive = storage.query<{ count: number }>(
      "SELECT COUNT(*) as count FROM scheduled_jobs WHERE status = 'active' AND type = 'research'",
    )[0]?.count ?? 0;
  } catch {
    watchesActive = 0;
  }

  const eligibleRows = (() => {
    try {
      return storage.query<{ watch_id: string; count: number }>(
        `SELECT watch_id, COUNT(*) as count
         FROM research_findings
         WHERE watch_id IS NOT NULL
           AND confidence >= 0.55
           AND watch_id IN (
             SELECT id FROM scheduled_jobs
             WHERE status = 'active' AND type = 'research'
           )
         GROUP BY watch_id`,
      );
    } catch {
      return [] as Array<{ watch_id: string; count: number }>;
    }
  })();
  const eligibleWatches = new Set(eligibleRows.filter((row) => row.count >= 3).map((row) => row.watch_id));
  const coveredWatches = new Set(
    insights
      .map((insight) => insight.watchId)
      .filter((watchId): watchId is string => typeof watchId === "string" && eligibleWatches.has(watchId)),
  ).size;
  const coverage = percentage(coveredWatches, eligibleWatches.size);
  const evidenceBackedInsights = insights.filter((insight) => new Set(insight.sources).size >= 2).length;
  const evidenceCoverage = percentage(evidenceBackedInsights, insights.length);
  const findingSummaries = findings.map((finding) => summarizeResearchSources(finding.sources));
  const findingsWithSources = findingSummaries.filter((summary) => summary.distinctUrls >= 1).length;
  const findingSourceCoverage = percentage(findingsWithSources, findings.length);
  const authoritativeFindings = findingSummaries.filter((summary) => summary.authoritativeSources >= 1).length;
  const primaryFindings = findingSummaries.filter((summary) => summary.primarySources >= 1).length;
  const authoritativeFindingCoverage = percentage(authoritativeFindings, findings.length);
  const primaryFindingCoverage = percentage(primaryFindings, findings.length);
  const chainedFindings = findings.filter((finding) => typeof finding.previousFindingId === "string").length;
  const chainedFindingsWithNovelty = findings.filter((finding) =>
    typeof finding.previousFindingId === "string" && (finding.delta?.significance ?? 0) >= 0.25,
  ).length;
  const noveltyCoverage = chainedFindings > 0
    ? percentage(chainedFindingsWithNovelty, chainedFindings)
    : 100;
  const highConfidenceFindings = findings.filter((finding) => finding.confidence >= 0.75).length;
  const highConfidenceNovelFindings = findings.filter((finding) =>
    finding.confidence >= 0.75 &&
    (!finding.previousFindingId || (finding.delta?.significance ?? 0) >= 0.25),
  ).length;
  const highConfidenceAuthoritativeFindings = findings.filter((finding, index) =>
    finding.confidence >= 0.75 && (findingSummaries[index]?.authoritativeSources ?? 0) >= 1,
  ).length;
  const supportedHighConfidenceFindings = findings.filter((finding) =>
    finding.confidence >= 0.75 &&
    new Set(
      finding.sources
        .map((source) => typeof source.url === "string" ? source.url.trim().toLowerCase() : "")
        .filter((url) => url.length > 0),
    ).size >= 2,
  ).length;
  const supportedHighConfidenceRate = percentage(supportedHighConfidenceFindings, highConfidenceFindings);
  const highConfidenceNoveltyRate = highConfidenceFindings > 0
    ? percentage(highConfidenceNovelFindings, highConfidenceFindings)
    : 0;
  const highConfidenceAuthoritativeRate = highConfidenceFindings > 0
    ? percentage(highConfidenceAuthoritativeFindings, highConfidenceFindings)
    : 0;
  const knowledgeScore = average([
    scoreAgainstTarget(coverage, QUALITY_TARGETS.compoundingCoverage),
    scoreAgainstTarget(evidenceCoverage, QUALITY_TARGETS.compoundingEvidenceCoverage),
    scoreAgainstTarget(findingSourceCoverage, QUALITY_TARGETS.findingSourceCoverage),
    scoreAgainstTarget(authoritativeFindingCoverage, QUALITY_TARGETS.authoritativeFindingCoverage),
    scoreAgainstTarget(supportedHighConfidenceRate, QUALITY_TARGETS.supportedHighConfidenceFindings),
    scoreAgainstTarget(noveltyCoverage, QUALITY_TARGETS.findingNoveltyCoverage),
    scoreAgainstTarget(highConfidenceNoveltyRate, QUALITY_TARGETS.highConfidenceNovelFindings),
    scoreAgainstTarget(highConfidenceAuthoritativeRate, QUALITY_TARGETS.highConfidenceAuthoritativeFindings),
  ]);

  const trust = buildDomain("Trust", [
    buildHigherMetric({
      key: "provenanceCoverage",
      label: "Belief provenance coverage",
      value: provenanceCoverage,
      target: QUALITY_TARGETS.provenanceCoverage,
      sampleSize: activeBeliefs.length,
      minSample: 5,
      weight: 1.2,
    }),
    buildHigherMetric({
      key: "authoritativeFindingCoverage",
      label: "Authoritative finding coverage",
      value: authoritativeFindingCoverage,
      target: QUALITY_TARGETS.authoritativeFindingCoverage,
      sampleSize: findings.length,
      minSample: 3,
      weight: 1.1,
    }),
    buildHigherMetric({
      key: "supportedHighConfidenceRate",
      label: "Supported high-confidence findings",
      value: supportedHighConfidenceRate,
      target: QUALITY_TARGETS.supportedHighConfidenceFindings,
      sampleSize: highConfidenceFindings,
      minSample: 2,
      weight: 1.2,
    }),
    buildHigherMetric({
      key: "compoundingEvidenceCoverage",
      label: "Evidence-backed insight coverage",
      value: evidenceCoverage,
      target: QUALITY_TARGETS.compoundingEvidenceCoverage,
      sampleSize: insights.length,
      minSample: 1,
      weight: 0.8,
    }),
  ]);

  const loopEfficacy = buildDomain("Loop Efficacy", [
    buildHigherMetric({
      key: "learningSuccessRate",
      label: "Learning success rate",
      value: learningSuccessRate,
      target: QUALITY_TARGETS.learningSuccessRate,
      sampleSize: signalBearingRuns.length,
      minSample: 3,
      weight: 1.1,
    }),
    buildHigherMetric({
      key: "learningAcceptanceRate",
      label: "Learning acceptance rate",
      value: learningAcceptanceRate,
      target: QUALITY_TARGETS.learningAcceptanceRate,
      sampleSize: extractedFacts,
      minSample: 3,
      weight: 1.1,
    }),
    buildHigherMetric({
      key: "learningYieldRate",
      label: "Learning yield rate",
      value: learningYieldRate,
      target: QUALITY_TARGETS.learningYieldRate,
      sampleSize: successfulSignalRuns.length,
      minSample: 3,
      weight: 1,
    }),
    buildHigherMetric({
      key: "eligibleWatchCoverage",
      label: "Eligible watch insight coverage",
      value: coverage,
      target: QUALITY_TARGETS.compoundingCoverage,
      sampleSize: eligibleWatches.size,
      minSample: 1,
      weight: 1.1,
    }),
    buildHigherMetric({
      key: "noveltyCoverage",
      label: "Novel finding coverage",
      value: noveltyCoverage,
      target: QUALITY_TARGETS.findingNoveltyCoverage,
      sampleSize: chainedFindings,
      minSample: 2,
      weight: 0.8,
    }),
  ]);

  const reliability = buildDomain("Reliability", [
    buildLowerMetric({
      key: "failedSignalRunRate",
      label: "Failed signal-bearing run rate",
      value: failedSignalRunRate,
      maxAllowed: QUALITY_TARGETS.failedSignalRunRate,
      sampleSize: signalBearingRuns.length,
      minSample: 3,
      weight: 1.2,
    }),
    buildHigherMetric({
      key: "findingSourceCoverage",
      label: "Finding source coverage",
      value: findingSourceCoverage,
      target: QUALITY_TARGETS.findingSourceCoverage,
      sampleSize: findings.length,
      minSample: 3,
      weight: 1,
    }),
    buildLowerMetric({
      key: "invalidationRate",
      label: "Belief invalidation rate",
      value: invalidationRate,
      maxAllowed: QUALITY_TARGETS.invalidationRate,
      sampleSize: allBeliefs.length,
      minSample: 5,
      weight: 0.9,
    }),
    buildHigherMetric({
      key: "memoryUtilization",
      label: "Memory utilization",
      value: utilization,
      target: QUALITY_TARGETS.memoryUtilization,
      sampleSize: activeBeliefs.length,
      minSample: 5,
      weight: 0.7,
    }),
  ]);

  const userValue = buildDomain("User Value", [
    buildHigherMetric({
      key: "feedbackActivity",
      label: "Digest feedback activity",
      value: feedbackRate,
      target: QUALITY_TARGETS.feedbackRate,
      sampleSize: totalDigests,
      minSample: 3,
      weight: 1.1,
    }),
    buildHigherMetric({
      key: "averageDigestRating",
      label: "Average digest rating",
      value: avgRating != null ? clampPercent(avgRating * 20) : 0,
      target: QUALITY_TARGETS.feedbackAverageRating,
      sampleSize: digestsRated,
      minSample: 1,
      weight: 1.2,
    }),
    buildHigherMetric({
      key: "recommendationAcceptanceRate",
      label: "Recommendation acceptance rate",
      value: recommendationAcceptanceRate,
      target: QUALITY_TARGETS.recommendationAcceptanceRate,
      sampleSize: openedDailyDigests,
      minSample: 2,
      weight: 1.1,
    }),
    buildHigherMetric({
      key: "briefActionCompletionRate",
      label: "Digest-linked action completion",
      value: briefActionCompletionRate,
      target: QUALITY_TARGETS.briefActionCompletionRate,
      sampleSize: briefActionCreatedCount,
      minSample: 2,
      weight: 1,
    }),
    buildHigherMetric({
      key: "correctionCarryForwardRate",
      label: "Correction carry-forward rate",
      value: correctionCarryForwardRate,
      target: QUALITY_TARGETS.correctionCarryForwardRate,
      sampleSize: correctionsWithNextDigest,
      minSample: 1,
      weight: 1.1,
    }),
    buildHigherMetric({
      key: "trustedDecisionLoopRate",
      label: "Trusted decision loop rate",
      value: trustedDecisionLoopRate,
      target: QUALITY_TARGETS.trustedDecisionLoopRate,
      sampleSize: openedBriefs,
      minSample: 2,
      weight: 1,
    }),
  ]);

  const domains: QualityDomains = {
    trust,
    loopEfficacy,
    reliability,
    userValue,
  };
  const domainEntries = Object.entries(domains) as Array<[keyof QualityDomains, QualityDomainScore]>;
  const scoredDomains = domainEntries.filter(([, domain]) => domain.status !== "insufficient_data");
  const domainScores = scoredDomains.map(([, domain]) => domain.score);
  const minDomainScore = domainScores.length > 0 ? Math.min(...domainScores) : 0;
  const blockingDomains = domainEntries
    .filter(([, domain]) => domain.status !== "insufficient_data" && domain.score < 50)
    .map(([key]) => key);

  let overallScore = geometricMean(domainScores);
  overallScore = Math.min(overallScore, clampPercent(minDomainScore + 15));
  if (blockingDomains.length > 0) {
    overallScore = Math.min(overallScore, 60);
  }

  const overallStatus = blockingDomains.length > 0
    ? "bad"
    : scoredDomains.length === 0 || domainEntries.some(([, domain]) => domain.status === "insufficient_data")
      ? "insufficient_data"
      : scoreToStatus(overallScore);

  return {
    score: overallScore,
    status: overallStatus,
    blockingDomains,
    domains,
    learning: {
      score: learningScore,
      recentRuns: recentRuns.length,
      signalBearingRuns: signalBearingRuns.length,
      successRate: learningSuccessRate,
      acceptanceRate: learningAcceptanceRate,
      yieldRate: learningYieldRate,
    },
    memory: {
      score: memoryScore,
      total: activeBeliefs.length,
      neverAccessed,
      reinforced,
      invalidated: invalidatedBeliefs,
      utilization,
      reinforcementRate,
      provenanceCoverage,
      invalidationRate,
    },
    feedback: {
      score: feedbackScore,
      totalDigests,
      digestsRated,
      corrections,
      avgRating,
      activity: feedbackRate,
    },
    knowledge: {
      score: knowledgeScore,
      insights: insights.length,
      findings: findings.length,
      chainedFindings,
      findingsWithSources,
      findingSourceCoverage,
      authoritativeFindingCoverage,
      primaryFindingCoverage,
      noveltyCoverage,
      highConfidenceFindings,
      highConfidenceNovelFindings,
      highConfidenceAuthoritativeFindings,
      supportedHighConfidenceFindings,
      watchesActive,
      eligibleWatches: eligibleWatches.size,
      coveredWatches,
      coverage,
      evidenceCoverage,
      growth: knowledgeScore,
    },
  };
}
