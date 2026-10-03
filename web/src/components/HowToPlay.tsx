"use client";
import { useState } from "react";
import { Dialog } from "./Dialog";
export function HowToPlay() {
  const [open, setOpen] = useState(false);
  return <><button className="text-button home-help" onClick={() => setOpen(true)}>How to play</button>
    {open && <Dialog title="How to play" onClose={() => setOpen(false)}>
      <h2 className="conclusion-title">Five words. One connection.</h2>
      <p>Guess each five-letter word in six tries. Tap Submit or press Enter to check your guess.</p>
      <ul className="help-marks">
        <li><span data-mark="hit">A</span><p><strong>Right spot</strong><br />This letter is exactly where it belongs.</p></li>
        <li><span data-mark="present">B</span><p><strong>Elsewhere</strong><br />This letter is in the word, in another spot.</p></li>
        <li><span data-mark="absent">C</span><p><strong>Absent</strong><br />This letter is not in the word.</p></li>
      </ul>
      <p>After each word, discover its meaning and story. Hints unlock as you make guesses. Finish all five to find their connection.</p>
      <button className="button" onClick={() => setOpen(false)}>Got it</button>
    </Dialog>}</>;
}
