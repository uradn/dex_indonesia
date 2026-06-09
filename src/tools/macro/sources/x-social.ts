/**
 * X (Twitter) social feed — real-time political risk signal for Module 12.
 * X API v2 recent search, Bearer Token (app-only) auth.
 * Free tier: 500k tweets/month. No Playwright — pure REST.
 * Requires X_BEARER_TOKEN in env. Gracefully returns null if absent.
 *
 * Value: street-level unrest (protests, PHK, sembako complaints) caught
 * minutes before Exa news articles publish — narrows M12 lead time.
 */

const X_RECENT_SEARCH = 'https://api.twitter.com/2/tweets/search/recent';

import { NEGATIVE_TERMS, POSITIVE_TERMS, HIGH_SEVERITY_TERMS } from './political-risk-terms.js';

const SEARCH_QUERY =
  '(demo OR "unjuk rasa" OR protes OR PHK OR mogok OR "harga sembako" OR ' +
  '"harga beras" OR kerusuhan OR buruh OR "krisis Indonesia" OR Prabowo) ' +
  '(lang:id OR lang:en) -is:retweet';

export interface XSentimentResult {
  signal: 'x_social_unrest';
  stressScore: number;        // 0–100
  tweetCount: number;
  negativeCount: number;
  positiveCount: number;
  highSeverityCount: number;
  topTweets: string[];        // up to 4, truncated to 120 chars
  fetchedAt: string;
}

function scoreTweet(text: string): { negative: number; positive: number; highSeverity: number } {
  const lower = text.toLowerCase();
  return {
    negative: NEGATIVE_TERMS.filter((t) => lower.includes(t)).length,
    positive: POSITIVE_TERMS.filter((t) => lower.includes(t)).length,
    highSeverity: HIGH_SEVERITY_TERMS.filter((t) => lower.includes(t)).length,
  };
}

interface XTweet { id: string; text: string; created_at?: string }
interface XSearchResponse {
  data?: XTweet[];
  meta?: { result_count?: number };
  errors?: Array<{ title: string; detail?: string }>;
}

export async function fetchXSocialSentiment(): Promise<XSentimentResult | null> {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) return null;

  try {
    const url = new URL(X_RECENT_SEARCH);
    url.searchParams.set('query', SEARCH_QUERY);
    url.searchParams.set('max_results', '20');
    url.searchParams.set('tweet.fields', 'created_at,lang');

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) return null;

    const body = await res.json() as XSearchResponse;
    if (body.errors?.length || !body.data?.length) return null;

    const tweets = body.data;
    let totalNegative = 0;
    let totalPositive = 0;
    let totalHighSeverity = 0;

    for (const tweet of tweets) {
      const { negative, positive, highSeverity } = scoreTweet(tweet.text);
      totalNegative += negative + highSeverity;
      totalPositive += positive;
      totalHighSeverity += highSeverity;
    }

    const weighted = totalNegative + totalHighSeverity;
    const net = Math.max(0, weighted - totalPositive);
    const stressScore = Math.min(100, Math.round((net / Math.max(tweets.length, 1)) * 25));

    return {
      signal: 'x_social_unrest',
      stressScore,
      tweetCount: tweets.length,
      negativeCount: totalNegative,
      positiveCount: totalPositive,
      highSeverityCount: totalHighSeverity,
      topTweets: tweets.slice(0, 4).map((t) => t.text.slice(0, 120)),
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
