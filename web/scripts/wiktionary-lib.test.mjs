import { test } from "node:test";
import assert from "node:assert/strict";
import { pickExample, pickOrigin, pickPronunciation, pickSense } from "./wiktionary-lib.mjs";

const abate = [{
  word: "abate", pos: "verb",
  sounds: [{ ipa: "/əˈbeɪt/", tags: ["General-American", "Received-Pronunciation"] }, { ipa: "/əˈbeət/" }],
  etymology: "From Middle English abaten, from Anglo-Norman abatre, from Late Latin abbattere, from Latin battere.\nmore",
  etymologyTemplates: [
    { name: "inh", args: { 3: "abaten" }, expansion: "Middle English abaten" },
    { name: "der", args: { 3: "abatre" }, expansion: "Anglo-Norman abatre" },
    { name: "der", args: { 3: "abbatto" }, expansion: "Late Latin abbattere (“to bring down”)" },
    { name: "der", args: { 3: "batto" }, expansion: "Latin battere" },
    { name: "cog", args: { 2: "abatare" }, expansion: "Late Latin abatare" },
  ],
  senses: [
    { glosses: ["To lessen (something) in force or intensity; to moderate."], tags: ["transitive"], attested: "from 14th c.", examples: ["The storm finally abated after midnight."] },
    { glosses: ["To demolish or level to the ground."], tags: ["archaic"] },
  ],
}, {
  word: "abate", pos: "noun", etymology: "From the verb.",
  senses: [{ glosses: ["Abatement; reduction."], tags: ["obsolete"] }],
}];

test("pronunciation prefers British and strips slashes", () => {
  assert.equal(pickPronunciation(abate), "əˈbeɪt");
  const lucky = [{ sounds: [{ ipa: "/ˈlʌki/", tags: ["General-American"] }, { ipa: "/ˈlʌkiː/", tags: ["Received-Pronunciation"] }] }];
  assert.equal(pickPronunciation(lucky), "ˈlʌkiː");
  assert.equal(pickPronunciation([{ sounds: [{ ipa: "/ˈkɹeɪtɚ/", tags: ["US"] }] }]), "ˈkɹeɪtɚ");
});

test("a 'To ...' definition picks the matching verb sense", () => {
  const s = pickSense(abate, "To become less intense; to die down.");
  assert.equal(s.pos, "verb");
  assert.equal(s.confident, true);
  assert.equal(pickExample(s.sense, "abate"), "The storm finally abated after midnight.");
});

test("origin drops Middle English and keeps the nearest and oldest source", () => {
  const s = pickSense(abate, "To become less intense; to die down.");
  assert.equal(pickOrigin(s.record, s.sense), "Anglo-Norman abatre, from Latin battere; in English since the 14th century");
});

test("a real noun/verb split without overlap is left for review", () => {
  const hedge = [
    { word: "hedge", pos: "noun", senses: [{ glosses: ["A thicket of bushes planted in a row."] }] },
    { word: "hedge", pos: "verb", senses: [{ glosses: ["To avoid committing oneself."] }] },
  ];
  assert.equal(pickSense(hedge, "Something that limits a risk.").confident, false);
});

test("reconstructed, hedged and unknown origins are not shown", () => {
  assert.equal(pickOrigin({ etymology: "Unknown." }), undefined);
  assert.equal(pickOrigin({ etymology: "Possibly imitative.", etymologyTemplates: [{ name: "der", args: { 3: "x" }, expansion: "Latin x" }] }), undefined);
  assert.equal(pickOrigin({
    etymology: "From Middle English abak, from Old English onbæc.",
    etymologyTemplates: [
      { name: "inh", args: { 3: "abak" }, expansion: "Middle English abak" },
      { name: "inh", args: { 3: "onbæc" }, expansion: "Old English onbæc" },
      { name: "inh", args: { 3: "*anabak" }, expansion: "Proto-West Germanic *anabak" },
    ],
  }), "Old English onbæc");
});

test("a word formed in English shows its parts", () => {
  assert.equal(pickOrigin({ etymology: "From peak + -y.", etymologyTemplates: [{ name: "suffix", args: {}, expansion: "peak + -y" }] }), "peak + -y");
});

test("examples must be sentences", () => {
  assert.equal(pickExample({ examples: ["a scaly fish a scaly stem"] }, "scaly"), undefined);
});

test("a two-sense definition matches on its first clause", () => {
  const septic = [
    { word: "septic", pos: "adj", senses: [{ glosses: ["Infected with harmful bacteria."] }] },
    { word: "septic", pos: "noun", senses: [{ glosses: ["A septic tank, a buried waste system."] }] },
  ];
  assert.equal(pickSense(septic, "Infected with harmful bacteria; also relating to a buried waste system.").pos, "adjective");
});

test("origin text drops template prefixes and nested glosses", () => {
  assert.equal(pickOrigin({ etymology: "From Latin.", etymologyTemplates: [{ name: "inh+", args: { 3: "pelote" }, expansion: "Inherited from Middle English pelote" }, { name: "der", args: { 3: "inhalo" }, expansion: "Latin inhalāre (“to breathe (in)”)" }] }), "Latin inhalāre");
});

test("a repeated step is collapsed before Middle English is dropped", () => {
  assert.equal(pickOrigin({ etymology: "Inherited from Middle English pelote.", etymologyTemplates: [
    { name: "inh", args: { 3: "pelote" }, expansion: "Middle English pelote" },
    { name: "inh+", args: { 3: "pelote" }, expansion: "Inherited from Middle English pelote" },
    { name: "der", args: { 3: "pelote" }, expansion: "Old French pelote (“small ball”)" },
    { name: "der", args: { 3: "*pilotta" }, expansion: "Vulgar Latin *pilotta" },
    { name: "der", args: { 3: "pila" }, expansion: "Latin pila (“ball”)" },
    { name: "doublet", args: {}, expansion: "Doublet of pelota" },
  ] }), "Old French pelote, from Latin pila");
});

test("only the first spelling of each step is kept", () => {
  assert.equal(pickOrigin({ etymology: "From Anglo-Norman voiz.", etymologyTemplates: [
    { name: "der", args: { 3: "voiz" }, expansion: "Anglo-Norman voiz, voys, voice" },
    { name: "der", args: { 3: "vois" }, expansion: "Old French vois, voiz" },
    { name: "der", args: { 3: "vox" }, expansion: "Latin vōcem" },
  ] }), "Anglo-Norman voiz, from Latin vōcem");
});
