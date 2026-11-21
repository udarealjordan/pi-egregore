import assert from "node:assert/strict";
import { test } from "node:test";
import registerQuestions from "../extensions/questions.ts";
import {
  buildBatchClarificationResult,
  buildBatchResult,
  buildResult,
  skippedResult,
  buildClarificationResult,
  buildRegenerateResult,
  type QuestionDef,
} from "../extensions/ask-user-question/domain.ts";

test("consult asks at real decision points, briefly, and recommends an option", () => {
  const tools = new Map<string, any>();
  registerQuestions({ on() {}, registerTool(tool: any) { tools.set(tool.name, tool); } } as any);
  const consult = tools.get("consult");
  assert.equal(consult.exposure, undefined, "consult is offered to the model");
  const guidance = [consult.description, consult.promptSnippet, ...consult.promptGuidelines].join(" ");
  for (const pattern of [/goal, scope or a key choice is unclear/, /forks between reasonable approaches/, /taste, naming or priority/,
    /hard to undo/, /share the plan and ask whether to adjust it/, /Recommend an option/, /up to four related questions/, /not consent/])
    assert.match(guidance, pattern);
  for (const discouraging of [/no question is a good outcome/i, /unsolicited questionnaire/, /warrant the interruption/])
    assert.doesNotMatch(guidance, discouraging, "guidance no longer talks the model out of asking");
  assert.ok(guidance.length < 1400, `guidance stays short (${guidance.length} characters)`);
  assert.equal(consult.parameters.properties.questions.maxItems, 4);
});

test("earlier tool names stay registered but hidden, so old transcripts still render", () => {
  const tools = new Map<string, any>();
  registerQuestions({ on() {}, registerTool(tool: any) { tools.set(tool.name, tool); } } as any);
  for (const name of ["ask_user_question", "ask_questions"]) {
    assert.equal(tools.get(name).exposure, "hidden", name);
    assert.equal(tools.get(name).renderResult, tools.get("consult").renderResult, name);
  }
});

test("curiosity adds one guideline line per run, and balanced adds none", async () => {
  const { CURIOSITY_GUIDANCE } = await import("../extensions/questions.ts");
  assert.equal(CURIOSITY_GUIDANCE.balanced, "");
  assert.match(CURIOSITY_GUIDANCE.quiet, /only when you are blocked/);
  assert.match(CURIOSITY_GUIDANCE.curious, /check in at milestones/);
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "consult-curiosity-")), previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    const hooks = new Map<string, any>();
    registerQuestions({ on(name: string, fn: any) { hooks.set(name, fn); }, registerTool() {} } as any);
    const run = async () => { const event: any = { systemPromptOptions: { toolGuidelines: { consult: ["base"] } } }; await hooks.get("before_agent_start")(event); return event.systemPromptOptions.toolGuidelines.consult; };
    assert.deepEqual(await run(), ["base"], "no settings file means balanced, which adds nothing");
    writeFileSync(join(dir, "pi-egregore.json"), JSON.stringify({ version: 1, ask: { version: 1, curiosity: "curious" } }));
    assert.deepEqual(await run(), ["base", CURIOSITY_GUIDANCE.curious]);
    writeFileSync(join(dir, "pi-egregore.json"), JSON.stringify({ version: 1, ask: { version: 1, curiosity: "quiet" } }));
    assert.deepEqual(await run(), ["base", CURIOSITY_GUIDANCE.quiet]);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("submitted answers retain caveats and skipped answers remain unknown", () => {
  const single = buildResult("Explore what?", undefined, "text",
    [{ type: "text", label: "A prototype", value: "A prototype" }], "Discuss only; do not build");
  assert.equal(single.details.note, "Discuss only; do not build");
  assert.match(single.content[0].text, /Discuss only; do not build/);
  const questions: QuestionDef[] = [
    { question: "Direction?", mode: "text", options: [] },
    { question: "Deploy?", mode: "text", options: [] },
  ];
  const batch = buildBatchResult(questions, [
    { questionIndex: 0, answer: "Local prototype", note: "No network" },
    { questionIndex: 1, answer: null, skipped: true },
  ]);
  assert.match(batch.content[0].text, /Note: No network/);
  assert.match(batch.content[0].text, /skipped by user/);
  assert.deepEqual(batch.details.skippedQuestionIndexes, [1]);
  assert.equal(batch.details.answers[1].answer, null);
  const skipped = skippedResult("Deploy?", "single-select");
  assert.equal(skipped.details.status, "skipped");
  assert.deepEqual(skipped.details.answers, []);
  assert.match(skipped.content[0].text, /unknown, not agreement or consent/);
  assert.match(skipped.content[0].text, /do not cross an unresolved approval boundary/);
});

test("revision and clarification allow questions to become unnecessary without losing resolved context", () => {
  const questions: QuestionDef[] = [
    { question: "Which direction?", mode: "text", options: [] },
    { question: "Which format?", mode: "text", options: [] },
  ];
  const answers = [{ questionIndex: 0, answer: "Try a prototype", note: "Keep it reversible" }];
  const revision = buildRegenerateResult(questions, answers);
  assert.match(revision.content[0].text, /drop it if resolved or no longer consequential/);
  assert.match(revision.content[0].text, /if none remain, explain why and proceed/);
  assert.match(revision.content[0].text, /Try a prototype/);
  assert.match(revision.content[0].text, /Keep it reversible/);
  assert.deepEqual(revision.details.answers, answers);
  assert.equal(revision.details.unansweredQuestions?.length, 1);

  const single = buildClarificationResult("Which direction?", undefined, "text", [], "Why?");
  assert.match(single.content[0].text, /re-ask it only if needed/);
  assert.equal(single.details.status, "clarification_requested");

  const batch = buildBatchClarificationResult(questions, answers, 1, "Why?");
  assert.match(batch.content[0].text, /Re-ask only the essential revised questions/);
  assert.match(batch.content[0].text, /Try a prototype/);
  assert.equal(batch.details.status, "clarification_requested");
});
