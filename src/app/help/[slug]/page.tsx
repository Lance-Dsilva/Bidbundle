import Link from "next/link";
import { notFound } from "next/navigation";

import { HELP_ARTICLES } from "@/content/help/articles";

export function generateStaticParams() {
  return HELP_ARTICLES.map((article) => ({ slug: article.slug }));
}

export default async function HelpArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = HELP_ARTICLES.find((entry) => entry.slug === slug);
  if (!article) notFound();

  return (
    <main className="min-h-screen bg-[#f8f5ef] px-5 py-10 text-[#17243a] sm:px-8 sm:py-16">
      <div className="mx-auto max-w-3xl">
        <Link className="inline-flex items-center gap-2 text-sm font-semibold text-[#236e6b] hover:underline" href="/help">
          ← Back to help
        </Link>
        <article className="mt-8 rounded-[28px] border border-[#ded8ce] bg-white p-7 shadow-[0_20px_60px_rgba(23,36,58,0.08)] sm:p-12">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#d06f3f]">Bundleen Help</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">{article.title}</h1>
          <p className="mt-6 text-lg leading-8 text-[#526071]">{article.body}</p>
        </article>
      </div>
    </main>
  );
}
