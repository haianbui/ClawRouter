/**
 * Rule-Based Classifier (v2 — Weighted Scoring)
 * Forked from ClawRouter (MIT License). No payment dependencies.
 *
 * Scores a request across 14 weighted dimensions and maps the aggregate
 * score to a tier using configurable boundaries. Confidence is calibrated
 * via sigmoid — low confidence triggers fallback to default tier.
 *
 * Handles 70-80% of requests in < 1ms with zero cost.
 */

import type { Tier, ScoringResult, ScoringConfig } from "./types.js";

type DimensionScore = { name: string; score: number; signal: string | null };

// ─── Dimension Scorers ───

function scoreTokenCount(
  estimatedTokens: number,
  thresholds: { simple: number; complex: number },
): DimensionScore {
  if (estimatedTokens < thresholds.simple) {
    return { name: "tokenCount", score: -1.0, signal: `short (${estimatedTokens} tokens)` };
  }
  if (estimatedTokens > thresholds.complex) {
    return { name: "tokenCount", score: 1.0, signal: `long (${estimatedTokens} tokens)` };
  }
  return { name: "tokenCount", score: 0, signal: null };
}

function scoreKeywordMatch(
  text: string,
  keywords: string[],
  name: string,
  signalLabel: string,
  thresholds: { low: number; high: number },
  scores: { none: number; low: number; high: number },
): DimensionScore {
  const matches = keywords.filter((kw) => text.includes(kw.toLowerCase()));
  if (matches.length >= thresholds.high) {
    return {
      name,
      score: scores.high,
      signal: `${signalLabel} (${matches.slice(0, 3).join(", ")})`,
    };
  }
  if (matches.length >= thresholds.low) {
    return {
      name,
      score: scores.low,
      signal: `${signalLabel} (${matches.slice(0, 3).join(", ")})`,
    };
  }
  return { name, score: scores.none, signal: null };
}

function scoreMultiStep(text: string): DimensionScore {
  const patterns = [/first.*then/i, /step \d/i, /\d\.\s/];
  const hits = patterns.filter((p) => p.test(text));
  if (hits.length > 0) {
    return { name: "multiStepPatterns", score: 0.5, signal: "multi-step" };
  }
  return { name: "multiStepPatterns", score: 0, signal: null };
}

function scoreQuestionComplexity(prompt: string): DimensionScore {
  const count = (prompt.match(/\?/g) || []).length;
  if (count > 3) {
    return { name: "questionComplexity", score: 0.5, signal: `${count} questions` };
  }
  return { name: "questionComplexity", score: 0, signal: null };
}

function scoreAgenticTask(
  text: string,
  keywords: string[],
): { dimensionScore: DimensionScore; agenticScore: number } {
  let matchCount = 0;
  const signals: string[] = [];

  for (const keyword of keywords) {
    if (text.includes(keyword.toLowerCase())) {
      matchCount++;
      if (signals.length < 3) {
        signals.push(keyword);
      }
    }
  }

  if (matchCount >= 4) {
    return {
      dimensionScore: {
        name: "agenticTask",
        score: 1.0,
        signal: `agentic (${signals.join(", ")})`,
      },
      agenticScore: 1.0,
    };
  } else if (matchCount >= 3) {
    return {
      dimensionScore: {
        name: "agenticTask",
        score: 0.6,
        signal: `agentic (${signals.join(", ")})`,
      },
      agenticScore: 0.6,
    };
  } else if (matchCount >= 1) {
    return {
      dimensionScore: {
        name: "agenticTask",
        score: 0.2,
        signal: `agentic-light (${signals.join(", ")})`,
      },
      agenticScore: 0.2,
    };
  }

  return {
    dimensionScore: { name: "agenticTask", score: 0, signal: null },
    agenticScore: 0,
  };
}

// ─── Quick Pattern Matchers (Fast Path) ───

const SIMPLE_PATTERNS = [
  // Greetings
  /^(hi|hey|hello|yo|sup|hola|bonjour|hallo|привет|你好|こんにちは)\b/i,
  // Basic questions
  /^what('s| is) (your name|the weather|the time|today|up)/i,
  /^(yes|no|ok|okay|okie|sure|thanks|thank you|thx|ty|cool|nice|got it|sounds good)\s*[.!?]?$/i,
  // Conversational check-ins
  /^(are you (there|here|still there|awake|around|available|online)|you (there|here|ok))\??$/i,
  // Simple queries
  /^(who|what|where|when|how old|how much|how many) (is|are|was|were) /i,
  /^(define|translate|meaning of) /i,
  // Short acknowledgments
  /^.{1,20}$/,  // Very short messages (<=20 chars)
];

const MEDIUM_PATTERNS = [
  /^(write|create|make|build|implement|code|debug|fix|develop|generate) (a |an |the |some )/i,
  /\b(function|class|component|api|endpoint)\b.*\b(write|create|implement|build|code)\b/i,
];

const COMPLEX_PATTERNS = [
  /\b(architect|design system|microservice|distributed|scalab|infrastructure)\b/i,
  /\b(optimize|refactor|migrate|overhaul)\b/i,
];

const REASONING_PATTERNS = [
  /\b(prove|theorem|derive|proof|formally verify|step.by.step.*reason)\b/i,
  /\b(mathematical proof|logical derivation|chain of thought)\b/i,
];

function quickPatternMatch(userText: string): { tier: Tier; confidence: number } | null {
  const trimmed = userText.trim();
  
  // Check SIMPLE first (most common for chat)
  for (const pattern of SIMPLE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { tier: "SIMPLE", confidence: 0.95 };
    }
  }
  
  // Check REASONING (rare but important)
  for (const pattern of REASONING_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { tier: "REASONING", confidence: 0.90 };
    }
  }
  
  // Check COMPLEX
  for (const pattern of COMPLEX_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { tier: "COMPLEX", confidence: 0.85 };
    }
  }
  
  // Check MEDIUM
  for (const pattern of MEDIUM_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { tier: "MEDIUM", confidence: 0.80 };
    }
  }
  
  return null; // Fall through to weighted scoring
}

// ─── Main Classifier ───

export function classifyByRules(
  prompt: string,
  systemPrompt: string | undefined,
  estimatedTokens: number,
  config: ScoringConfig,
): ScoringResult {
  const userText = prompt.toLowerCase();
  
  // ═══ FIX #2: Quick pattern matching on USER MESSAGE ONLY ═══
  const quickMatch = quickPatternMatch(userText);
  if (quickMatch) {
    return {
      score: 0,
      tier: quickMatch.tier,
      confidence: quickMatch.confidence,
      signals: [`quick-match: ${quickMatch.tier}`],
      agenticScore: 0,
    };
  }
  
  // ═══ FIX #1: Score based on USER MESSAGE, not system prompt ═══
  // Only use system prompt for agentic detection, not complexity scoring
  const text = userText; // Changed from: `${systemPrompt ?? ""} ${prompt}`.toLowerCase()

  const dimensions: DimensionScore[] = [
    scoreTokenCount(estimatedTokens, config.tokenCountThresholds),
    scoreKeywordMatch(
      text,
      config.codeKeywords,
      "codePresence",
      "code",
      { low: 1, high: 2 },
      { none: 0, low: 0.5, high: 1.0 },
    ),
    scoreKeywordMatch(
      userText,
      config.reasoningKeywords,
      "reasoningMarkers",
      "reasoning",
      { low: 1, high: 2 },
      { none: 0, low: 0.7, high: 1.0 },
    ),
    scoreKeywordMatch(
      text,
      config.technicalKeywords,
      "technicalTerms",
      "technical",
      { low: 2, high: 4 },
      { none: 0, low: 0.5, high: 1.0 },
    ),
    scoreKeywordMatch(
      text,
      config.creativeKeywords,
      "creativeMarkers",
      "creative",
      { low: 1, high: 2 },
      { none: 0, low: 0.5, high: 0.7 },
    ),
    scoreKeywordMatch(
      text,
      config.simpleKeywords,
      "simpleIndicators",
      "simple",
      { low: 1, high: 2 },
      { none: 0, low: -1.0, high: -1.0 },
    ),
    scoreMultiStep(text),
    scoreQuestionComplexity(prompt),

    scoreKeywordMatch(
      text,
      config.imperativeVerbs,
      "imperativeVerbs",
      "imperative",
      { low: 1, high: 2 },
      { none: 0, low: 0.3, high: 0.5 },
    ),
    scoreKeywordMatch(
      text,
      config.constraintIndicators,
      "constraintCount",
      "constraints",
      { low: 1, high: 3 },
      { none: 0, low: 0.3, high: 0.7 },
    ),
    scoreKeywordMatch(
      text,
      config.outputFormatKeywords,
      "outputFormat",
      "format",
      { low: 1, high: 2 },
      { none: 0, low: 0.4, high: 0.7 },
    ),
    scoreKeywordMatch(
      text,
      config.referenceKeywords,
      "referenceComplexity",
      "references",
      { low: 1, high: 2 },
      { none: 0, low: 0.3, high: 0.5 },
    ),
    scoreKeywordMatch(
      text,
      config.negationKeywords,
      "negationComplexity",
      "negation",
      { low: 2, high: 3 },
      { none: 0, low: 0.3, high: 0.5 },
    ),
    scoreKeywordMatch(
      text,
      config.domainSpecificKeywords,
      "domainSpecificity",
      "domain-specific",
      { low: 1, high: 2 },
      { none: 0, low: 0.5, high: 0.8 },
    ),
  ];

  // Agentic detection still uses full text (system + user) since it's about capability
  const fullText = `${systemPrompt ?? ""} ${prompt}`.toLowerCase();
  const agenticResult = scoreAgenticTask(fullText, config.agenticTaskKeywords);
  dimensions.push(agenticResult.dimensionScore);
  const agenticScore = agenticResult.agenticScore;

  const signals = dimensions.filter((d) => d.signal !== null).map((d) => d.signal!);

  const weights = config.dimensionWeights;
  let weightedScore = 0;
  for (const d of dimensions) {
    const w = weights[d.name] ?? 0;
    weightedScore += d.score * w;
  }

  const reasoningMatches = config.reasoningKeywords.filter((kw) =>
    userText.includes(kw.toLowerCase()),
  );

  // Direct reasoning override: 2+ reasoning markers = high confidence REASONING
  if (reasoningMatches.length >= 2) {
    const confidence = calibrateConfidence(
      Math.max(weightedScore, 0.3),
      config.confidenceSteepness,
    );
    return {
      score: weightedScore,
      tier: "REASONING",
      confidence: Math.max(confidence, 0.85),
      signals,
      agenticScore,
    };
  }

  const { simpleMedium, mediumComplex, complexReasoning } = config.tierBoundaries;
  let tier: Tier;
  let distanceFromBoundary: number;

  if (weightedScore < simpleMedium) {
    tier = "SIMPLE";
    distanceFromBoundary = simpleMedium - weightedScore;
  } else if (weightedScore < mediumComplex) {
    tier = "MEDIUM";
    distanceFromBoundary = Math.min(weightedScore - simpleMedium, mediumComplex - weightedScore);
  } else if (weightedScore < complexReasoning) {
    tier = "COMPLEX";
    distanceFromBoundary = Math.min(
      weightedScore - mediumComplex,
      complexReasoning - weightedScore,
    );
  } else {
    tier = "REASONING";
    distanceFromBoundary = weightedScore - complexReasoning;
  }

  const confidence = calibrateConfidence(distanceFromBoundary, config.confidenceSteepness);

  if (confidence < config.confidenceThreshold) {
    return { score: weightedScore, tier: null, confidence, signals, agenticScore };
  }

  return { score: weightedScore, tier, confidence, signals, agenticScore };
}

/**
 * Sigmoid confidence calibration.
 * Maps distance from tier boundary to [0.5, 1.0] confidence range.
 */
function calibrateConfidence(distance: number, steepness: number): number {
  return 1 / (1 + Math.exp(-steepness * distance));
}
