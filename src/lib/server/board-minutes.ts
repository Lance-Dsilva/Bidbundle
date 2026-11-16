import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import PDFDocument from "pdfkit";
import { create, type Font } from "fontkit";
import type { BoardReviewView, BoardRoundSummary } from "@/lib/board-types";
import { POOL_TIER_LABELS, POOL_TIERS } from "@/lib/pool-bid-template";
import { HoaWorkflowError } from "@/lib/server/hoa";

const FONT_FILES = ["NotoSans-Regular.ttf", "NotoSansCJKsc-Regular.otf"] as const;
const MAX_PAGES = 100;
type EmbeddedFont = { name: string; bytes: Buffer; font: Font };
let fontPromise: Promise<EmbeddedFont[]> | undefined;
function loadFonts() {
  // Explicit repository assets, also included by Next's output-file tracing.
  // Never depend on an operating-system font or a network fetch at request time.
  return fontPromise ??= Promise.all(FONT_FILES.map(async (file, i) => {
    const bytes = await readFile(path.join(process.cwd(), "src/assets/fonts/board-minutes", file));
    return { name: `minutes-${i}`, bytes, font: create(bytes) as Font };
  })).catch(error => { fontPromise = undefined; throw error; });
}

const ruleName: Record<BoardRoundSummary["rule"], string> = {
  manager_only: "Manager approval", board_majority: "Board majority",
  board_quorum_n: "Board quorum", board_unanimous: "Unanimous board approval",
};
function date(value: string | null) {
  if (!value) return "Not supplied";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().replace("T", " ").replace(".000Z", " UTC") : "Not supplied";
}
function money(cents: number, currency: string) {
  // Use an explicit currency code so a symbol cannot imply a different currency.
  return `${currency.toUpperCase()} ${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The caller must authorize this exact request before passing its view. */
export async function renderBoardMinutes(view: BoardReviewView, roundId: string): Promise<Uint8Array> {
  const round = view.rounds.find(item => item.id === roundId);
  if (!round) throw new HoaWorkflowError("That board review round does not exist.", 404);
  let comments = round.comments;
  if (round.commentsTruncated || round.commentCount > comments.length) {
    // The interactive view is bounded; official minutes must never silently
    // present its first page of discussion as the complete record.
    const [{ db }, { requireBoardViewer }] = await Promise.all([
      import("@/lib/server/db"), import("@/lib/server/board-review"),
    ]);
    await requireBoardViewer(view.viewerUserId, view.request.communityId);
    const complete = await db.boardDiscussionMessage.findMany({
      where: { roundId, round: { requestId: view.request.id, communityId: view.request.communityId } },
      include: { author: { select: { fullName: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 1001,
    });
    if (complete.length > 1000 || complete.length < round.commentCount) {
      throw new HoaWorkflowError("The complete discussion could not fit in this export. Contact support for a full record; no partial minutes were produced.", 413);
    }
    comments = complete.map(item => ({ id: item.id, authorUserId: item.authorUserId,
      authorName: item.author.fullName, body: item.body, createdAt: item.createdAt.toISOString() }));
  }
  const fonts = await loadFonts();
  const doc = new PDFDocument({ size: "LETTER", margins: { top: 64, bottom: 58, left: 48, right: 48 },
    bufferPages: true, autoFirstPage: false, info: { Title: "Board proposal review minutes", Author: "Bundleen", Creator: "Bundleen" } });
  for (const font of fonts) doc.registerFont(font.name, font.bytes);
  const chunks: Buffer[] = [];
  const output = new Promise<Uint8Array>((resolve, reject) => {
    doc.on("data", chunk => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  // Install a handler immediately: validation errors can occur before awaiting output.
  void output.catch(() => {});
  let pages = 0;
  doc.on("pageAdded", () => {
    if (++pages > MAX_PAGES) throw new HoaWorkflowError("This minutes export is too large. Export a smaller review round.", 413);
  });
  const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
  const runs = (raw: string) => {
    // Normalize canonical accents; remove nonprinting controls, not Unicode names.
    const text = raw.normalize("NFC").replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").replace(/\t/g, "    ");
    const result: Array<{ text: string; font: string }> = [];
    for (const { segment } of segmenter.segment(text)) {
      const font = fonts.find(item => [...segment].every(character => character === "\n" || item.font.hasGlyphForCodePoint(character.codePointAt(0)!)));
      if (!font) throw new HoaWorkflowError("A character in this review cannot be rendered by the bundled PDF fonts. Contact support for an additional font; no names were replaced.", 422);
      const previous = result[result.length - 1];
      if (previous?.font === font.name) previous.text += segment;
      else result.push({ text: segment, font: font.name });
    }
    return result;
  };
  const paragraph = (text: string, size = 10, color = "#253343") => {
    const parts = runs(text);
    if (!parts.length) return;
    doc.fillColor(color).fontSize(size);
    parts.forEach((part, index) => doc.font(part.font).text(part.text, {
      width: 516, lineGap: 4, continued: index < parts.length - 1,
    }));
    doc.moveDown(0.5);
  };
  const section = (label: string) => {
    if (doc.y > doc.page.height - 115) doc.addPage();
    doc.moveDown(0.5);
    paragraph(label, 13, "#087f73");
  };
  try {
    doc.addPage();
    paragraph("Board proposal review minutes", 23, "#0c3838");
    paragraph(view.request.communityName, 15);
    paragraph(view.request.title, 12);
    paragraph(`Round: ${round.id}\nRequest: ${view.request.id}\nCreated: ${date(round.createdAt)}\nVoting deadline: ${date(round.deadline)}`);
    paragraph(`Status: ${round.status}. Approval rule: ${ruleName[round.rule]}. Required approvals: ${round.threshold} of ${round.electorate.length} eligible board members.`);
    if (round.rule === "manager_only") paragraph("Manager confirmation is required; board votes do not replace the manager's award decision.");
    if (round.stale) paragraph(`Review requires renewal: ${round.staleReason || "The proposal or voting conditions changed."}`, 10, "#9a3412");
    const winner = round.proposals.find(proposal => proposal.bidId === round.awardedBidId);
    paragraph(round.awardedBidId ? `Recorded award: ${winner?.providerName ?? "Proposal"} (${round.awardedBidId}).` : "No award is recorded for this round. Votes alone do not prove an award.");
    paragraph("Private board record. Times are UTC. Credential files and unrelated account data are not included.", 9, "#546575");

    section("Eligible board members");
    if (!round.electorate.length) paragraph("No board electorate recorded.");
    round.electorate.forEach((member, index) => paragraph(`${index + 1}. ${member.name}`));

    section("Proposal comparison");
    if (!round.proposals.length) paragraph("No shortlisted proposals recorded.");
    round.proposals.forEach((proposal, index) => {
      section(`${index + 1}. ${proposal.providerName}`);
      paragraph(`Proposal ${proposal.bidId} / version ${proposal.version}\nWhole-job total: ${money(proposal.amountCents, proposal.currency)}`);
      if (proposal.poolQuote) {
        for (const tier of POOL_TIERS) {
          const cents = proposal.poolQuote.monthlyCents[tier];
          if (cents !== undefined) paragraph(`${POOL_TIER_LABELS[tier]}: ${money(cents, proposal.currency)} per home per month`);
        }
        paragraph(`Chemicals ${proposal.poolQuote.chemicalsIncluded ? "included" : "not included"}. Equipment repairs excluded. Route: ${proposal.poolQuote.routeDay}. Cancellation notice: ${proposal.poolQuote.cancellationNoticeDays} days.`);
      }
      paragraph(`Scope: ${proposal.scope || "Not supplied"}\nExclusions: ${proposal.exclusions || "None supplied"}`);
      paragraph(`Start: ${date(proposal.startDate)}\nQuote valid until: ${date(proposal.validUntil)}`);
      paragraph(`Verified: ${proposal.verified ? "Yes" : "No"}. Rating: ${proposal.rating === null ? "Not rated" : proposal.rating.toFixed(1)} (${proposal.reviewCount} reviews).`);
      paragraph(`Insurance coverage: ${proposal.insuranceCoverageCents === null ? "Not supplied" : money(proposal.insuranceCoverageCents, "USD")}. Insurance expiry: ${date(proposal.insuranceExpiresAt)}.`);
      paragraph(`License document: ${proposal.licenseDocumentId ? "Available in the authorized review" : "Not supplied"}. Insurance document: ${proposal.insuranceDocumentId ? "Available in the authorized review" : "Not supplied"}.`);
      const votes = round.votes.filter(vote => vote.bidId === proposal.bidId);
      paragraph(`Votes recorded: ${votes.filter(vote => vote.decision === "approve").length} approve; ${votes.filter(vote => vote.decision === "reject").length} reject. Threshold: ${round.threshold}.`);
      if (!votes.length) paragraph("No votes recorded for this proposal.");
      votes.forEach(vote => paragraph(`${vote.voterName}: ${vote.decision.toUpperCase()} at ${date(vote.createdAt)}${vote.comment ? `\nComment: ${vote.comment}` : ""}`));
    });
    section("Board discussion record");
    if (!comments.length) paragraph("No discussion recorded.");
    comments.forEach(comment => paragraph(`${comment.authorName} - ${date(comment.createdAt)}\n${comment.body}`));
    section("Record notes");
    paragraph("This export records the selected review round as currently held by Bundleen. Proposal terms, votes and discussion above belong only to that round. Check the live review for later amendments and current eligibility before making a new award.", 9);

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      doc.font(fonts[0].name).fontSize(8).fillColor("#546575");
      doc.text("BUNDLEEN  /  PRIVATE BOARD RECORD", 48, 30, { lineBreak: false });
      doc.text(`Page ${i + 1} of ${range.count}`, 48, 758, { lineBreak: false });
    }
    doc.end();
    return await output;
  } catch (error) {
    doc.destroy();
    throw error;
  }
}
