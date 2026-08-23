import "server-only";

import { HELP_ARTICLES, type HelpArticle } from "@/content/help/articles";

export type HelpMatch = {
  slug: string;
  title: string;
  excerpt: string;
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2);
}

const STOP_WORDS = new Set([
  "the", "and", "for", "are", "with", "what", "how", "does", "when", "who",
  "can", "you", "your", "bundleen", "get", "our",
]);

function queryTerms(query: string): string[] {
  return Array.from(new Set(tokenize(query).filter((term) => !STOP_WORDS.has(term))));
}

function scoreArticle(article: HelpArticle, terms: string[]): number {
  if (terms.length === 0) return 0;
  const titleTokens = new Set(tokenize(article.title));
  const bodyTokens = tokenize(article.body);
  const bodyCounts = new Map<string, number>();
  for (const token of bodyTokens) bodyCounts.set(token, (bodyCounts.get(token) ?? 0) + 1);

  let score = 0;
  for (const term of terms) {
    if (titleTokens.has(term)) score += 5;
    score += Math.min(bodyCounts.get(term) ?? 0, 3);
  }
  return score;
}

function excerpt(article: HelpArticle, terms: string[]): string {
  const sentences = article.body.split(/(?<=[.!?])\s+/);
  const hit = sentences.find((sentence) => {
    const lower = sentence.toLowerCase();
    return terms.some((term) => lower.includes(term));
  });
  return (hit ?? sentences[0] ?? article.body).slice(0, 280);
}

/**
 * In-memory keyword search over the bundled help corpus — no vector store or
 * external retrieval infra, appropriate for a few short, static articles.
 * Returns nothing rather than a weak guess when no term matches.
 */
export function searchHelp(query: string, limit = 3): HelpMatch[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];

  return HELP_ARTICLES.map((article) => ({ article, score: scoreArticle(article, terms) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ article }) => ({
      slug: article.slug,
      title: article.title,
      excerpt: excerpt(article, terms),
    }));
}
