import type { Storage } from "@personal-ai/core";
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
  feedbackRate: 20,
  feedbackAverageRating: 80,
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
  const acceptedFacts = successfulSignalRuns.reduce((sum, run) => sum + run.beliefsCreated + run.beliefsReinforced, 0);
  const extractedFacts = successfulSignalRuns.reduce((sum, run) => sum + run.factsExtracted, 0);
  const runsWithYield = successfulSignalRuns.filter((run) => run.beliefsCreated + run.beliefsReinforced > 0).length;
  const learningSuccessRate = percentage(successfulSignalRuns.length, signalBearingRuns.length);
  const learningAcceptanceRate = percentage(acceptedFacts, extractedFacts);
  const learningYieldRate = percentage(runsWithYield, successfulSignalRuns.length);
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

  return {
    score: average([learningScore, memoryScore, feedbackScore, knowledgeScore]),
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
