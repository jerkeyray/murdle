"use client";

import type { Mark, Round } from "@/lib/api";

/**
 * Draws the end of a round as a shareable image.
 *
 * Wordle's share is a grid of coloured squares, which says how you did and
 * nothing about what you played. Ours leads with the word and what it means,
 * because that is the part worth sending someone — the grid is the footnote.
 *
 * Drawn on a canvas rather than screenshotting the DOM: it is one dependency
 * fewer, it does not inherit the phone's viewport, and it lets the image be
 * composed for the place it ends up rather than cropped from a page.
 */

const W = 1080;
const PAD = 90;
/** Never shorter than this, so a one-line entry still looks composed. */
const MIN_H = 1080;

/** Where the image sends people. Deliberately not location.host, which is
 *  localhost in development and would ship in the picture. */
const SITE = "wordle.jerkeyray.com";

/** Reads a design token so the image matches the theme on screen. */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * next/font generates its own family names, so the stack is read off a live
 * element rather than hardcoded — hardcoding "Fraunces" would silently fall
 * back to a system serif.
 */
function fontStack(variable: string): string {
  const probe = document.createElement("span");
  probe.style.fontFamily = `var(${variable})`;
  document.body.appendChild(probe);
  const family = getComputedStyle(probe).fontFamily;
  probe.remove();
  return family || "Georgia, serif";
}

/** Wraps text to a width, returning the lines. */
function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    if (lines.length === maxLines) break;
  }

  if (line && lines.length < maxLines) lines.push(line);

  // An ellipsis is honest about having cut something off.
  if (lines.length === maxLines) {
    const last = lines[maxLines - 1];
    if (ctx.measureText(last).width > maxWidth - 24) {
      lines[maxLines - 1] = last.replace(/\s+\S*$/, "") + "…";
    }
  }

  return lines;
}

const MARK_TOKEN: Record<Mark, string> = {
  hit: "--mark-hit",
  present: "--mark-present",
  absent: "--mark-absent",
};

export async function drawShareCard(round: Round): Promise<Blob> {
  // Without this the first draw uses a fallback face and the image ships with
  // the wrong typeface.
  await document.fonts.ready;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");

  const serif = fontStack("--font-serif");
  const sans = fontStack("--font-sans");

  // The name on the image follows the name of the app, rather than a constant
  // that quietly goes stale when the app is renamed.
  const title = (document.title || "Wordle").toUpperCase();

  // Measure first. A fixed height left a void under a short entry, so the
  // canvas is sized to its contents instead.
  ctx.font = `400 42px ${sans}`;
  const defLines = round.entry ? wrap(ctx, round.entry.definition, W - PAD * 2, 2) : [];
  ctx.font = `400 36px ${serif}`;
  const noteLines = round.entry ? wrap(ctx, round.entry.note, W - PAD * 2, 5) : [];

  const gridH = round.rows.length * 33;
  const contentH =
    PAD + 30 + 120 + 70 + defLines.length * 56 + (round.entry ? 86 : 0) +
    noteLines.length * 52 + 70 + gridH + PAD;

  const H = Math.max(MIN_H, Math.round(contentH));
  canvas.width = W;
  canvas.height = H;

  const bg = token("--bg-raised") || "#ffffff";
  const text = token("--text") || "#000000";
  const muted = token("--text-muted") || "#666666";
  const faint = token("--text-faint") || "#999999";
  const rule = token("--rule") || "#dddddd";

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  let y = PAD + 30;

  // Wordmark
  ctx.fillStyle = faint;
  ctx.font = `600 30px ${serif}`;
  ctx.letterSpacing = "10px";
  ctx.fillText(title, PAD, y);
  ctx.letterSpacing = "0px";

  // How it went
  const won = round.state === "won";
  ctx.font = `600 28px ${sans}`;
  ctx.fillStyle = muted;
  const verdict = won ? `Solved in ${round.solvedRow + 1}` : "Out of guesses";
  ctx.fillText(verdict.toUpperCase(), W - PAD - ctx.measureText(verdict.toUpperCase()).width, y);

  y += 120;

  // The word
  ctx.fillStyle = text;
  ctx.font = `600 150px ${serif}`;
  ctx.fillText(round.answer ?? "", PAD, y);

  y += 70;

  // Definition
  if (round.entry) {
    ctx.font = `400 42px ${sans}`;
    ctx.fillStyle = text;
    for (const line of defLines) {
      ctx.fillText(line, PAD, y);
      y += 56;
    }

    y += 26;
    ctx.strokeStyle = rule;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(PAD, y);
    ctx.lineTo(W - PAD, y);
    ctx.stroke();
    y += 60;

    // The note, which is the reason to send this to anyone.
    ctx.font = `400 36px ${serif}`;
    ctx.fillStyle = muted;
    for (const line of noteLines) {
      ctx.fillText(line, PAD, y);
      y += 52;
    }
  }

  // The grid, as a footnote rather than the headline.
  const cell = 26;
  const gap = 7;
  const gridY = H - PAD - round.rows.length * (cell + gap);
  round.rows.forEach((row, r) => {
    row.marks.forEach((mark, c) => {
      ctx.fillStyle = token(MARK_TOKEN[mark]) || "#cccccc";
      const x = PAD + c * (cell + gap);
      const yy = gridY + r * (cell + gap);
      ctx.beginPath();
      ctx.roundRect(x, yy, cell, cell, 5);
      ctx.fill();
    });
  });

  ctx.font = `500 26px ${sans}`;
  ctx.fillStyle = faint;
  ctx.fillText(SITE, W - PAD - ctx.measureText(SITE).width, H - PAD - 4);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("could not encode"))),
      "image/png",
    );
  });
}

/**
 * Shares the image, or downloads it where sharing files is not supported.
 *
 * navigator.share is the good path on a phone — it opens the real share sheet
 * — but it does not exist on most desktops and rejects files on some, so the
 * download is not a fallback for errors so much as the desktop behaviour.
 */
export async function shareRound(round: Round): Promise<"shared" | "downloaded"> {
  const blob = await drawShareCard(round);
  const file = new File([blob], `murdle-${round.answer ?? "word"}.png`, {
    type: "image/png",
  });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return "shared";
    } catch (err) {
      // A cancelled share sheet is the user saying no, not a failure to
      // recover from by downloading something they did not ask for.
      if (err instanceof DOMException && err.name === "AbortError") {
        return "shared";
      }
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(url);
  return "downloaded";
}
