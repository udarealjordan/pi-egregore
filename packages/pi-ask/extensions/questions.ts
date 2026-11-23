import { questionCall, questionResult } from "./ask-user-question/question-history.ts";
import { registerPostedQuestions } from "./ask-user-question/posted.ts";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { askMultiChoice, askSingleChoice, askText, customWithAbort } from "./ask-user-question/standalone-ui.ts";
import { TabbedQuestions, type BatchUIResult } from "./ask-user-question/batch-ui.ts";
import { savedAskAppearance, type Curiosity } from "./ask-user-question/appearance.ts";
import {
	AskQuestionsParams, AskUserQuestionParams, ConsultParams, type AskUserQuestionMode, type QuestionDef, type TextAnswer,
	batchCancelledResult, batchUnavailableResult, buildBatchClarificationResult, buildBatchResult, buildClarificationResult, buildRegenerateResult,
	buildResult, cancelledResult, skippedResult, normalizeOptions, unavailableResult,
} from "./ask-user-question/domain.ts";

export const CONSULT = "consult";

const DESCRIPTION = "Ask the user one to four questions and wait for their answers. Use it when an answer would change what you do.";
const SNIPPET = "Ask the user when their answer would change what you do";
const GUIDELINES = [
	"Ask before substantial work when the goal, scope or a key choice is unclear; at forks between reasonable approaches; on matters of taste, naming or priority; and before anything hard to undo.",
	"When you plan substantial work, share the plan and ask whether to adjust it.",
	"Look up findable facts yourself first. Recommend an option with a suggestion and a short basis, and say what you would do without an answer.",
	"Put up to four related questions in one call. Give options for decisions; omit them for open-ended answers. Each question stands alone.",
	"Apply the answer and any note. A skipped or unanswered question is not consent. If the user asks back (clarification_requested), answer them, then ask again only if it still matters.",
	"If the result is regenerate, rework the unanswered questions using the answers and notes given, or explain why none remain.",
];
/** One line per curiosity level, appended to consult's guidelines for each run. */
export const CURIOSITY_GUIDANCE: Record<Curiosity, string> = {
	quiet: "The user prefers few interruptions: ask only when you are blocked or before something hard to undo; otherwise state your assumption and continue.",
	balanced: "",
	curious: "The user likes to be involved: also check in at milestones and whenever you notice a choice they may care about, even when a sensible default exists.",
};

let uiLock = Promise.resolve();
function withUILock<T>(fn: () => Promise<T>): Promise<T> {
	const prev = uiLock;
	let release: () => void;
	uiLock = new Promise<void>((r) => { release = r; });
	return prev.then(fn).finally(() => release!());
}

type RawQuestion = { question: string; label?: string; details?: string; options?: Parameters<typeof normalizeOptions>[0]; multiSelect?: boolean };

function questionDefs(raw: RawQuestion[]): QuestionDef[] {
	return raw.map((q, index) => {
		const optionsProvided = q.options !== undefined;
		const options = normalizeOptions(q.options);
		if (optionsProvided && options.length === 0) throw new Error(`Question ${index + 1} needs at least one non-empty option when options are given.`);
		if (!optionsProvided && q.multiSelect) throw new Error(`Question ${index + 1} cannot use multiSelect without options.`);
		const mode: AskUserQuestionMode = !optionsProvided ? "text" : q.multiSelect ? "multi-select" : "single-select";
		return { question: q.question, label: q.label?.trim() || undefined, details: q.details?.trim() || undefined, mode, options };
	});
}

/** One question: the focused standalone form. Its result keeps the single-question shape. */
async function askOne(q: QuestionDef, signal: AbortSignal | undefined, ctx: ExtensionContext) {
	const { question, details: context, mode, options } = q;
	if (signal?.aborted) return cancelledResult(question, mode, context);
	if (!ctx.hasUI || ctx.mode !== "tui") return unavailableResult(question, mode, `${CONSULT} requires interactive TUI mode`, context);
	return withUILock(async () => {
		if (signal?.aborted) return cancelledResult(question, mode, context);
		const result = mode === "text" ? await askText(ctx, question, context, signal)
			: mode === "single-select" ? await askSingleChoice(ctx, question, context, options, signal)
			: await askMultiChoice(ctx, question, context, options, signal);
		if (!result) return cancelledResult(question, mode, context);
		if ("action" in result) return result.action === "skip" ? skippedResult(question, mode, context)
			: result.action === "regenerate"
				? buildRegenerateResult([{ question, details: context, mode, options }], [{ questionIndex: 0, answer: null, note: result.note }])
				: buildClarificationResult(question, context, mode, options, result.clarification);
		if (mode === "text") {
			const answer: TextAnswer = { type: "text", label: result.answer as string, value: result.answer as string };
			return buildResult(question, context, mode, [answer], result.note);
		}
		const answers = (Array.isArray(result.answer) ? result.answer : [result.answer]) as Parameters<typeof buildResult>[3];
		return buildResult(question, context, mode, answers, result.note);
	});
}

/** Several related questions: one sequential form with Review. */
async function askMany(questions: QuestionDef[], signal: AbortSignal | undefined, ctx: ExtensionContext) {
	if (signal?.aborted) return batchCancelledResult(questions);
	if (!ctx.hasUI || ctx.mode !== "tui") return batchUnavailableResult(questions);
	return withUILock(async () => {
		if (signal?.aborted) return batchCancelledResult(questions);
		const result: BatchUIResult = await customWithAbort<any>(ctx, signal,
			(tui: any, theme: any, kb: any, done: (r: any) => void) => new TabbedQuestions(questions, tui, theme, kb, done, ctx.cwd));
		if (!result) return batchCancelledResult(questions);
		if (!Array.isArray(result)) {
			if (result.action === "clarification") return buildBatchClarificationResult(questions, result.answers, result.activeQuestionIndex, result.clarification);
			return buildRegenerateResult(questions, result.answers);
		}
		return buildBatchResult(questions, result);
	});
}

export default function consult(pi: ExtensionAPI) {
	registerPostedQuestions(pi, withUILock);
	pi.registerTool({
		name: CONSULT, label: "Consult", renderShell: "self",
		description: DESCRIPTION, promptSnippet: SNIPPET, promptGuidelines: GUIDELINES,
		parameters: ConsultParams,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const questions = questionDefs(params.questions as RawQuestion[]);
			return questions.length === 1 ? askOne(questions[0], signal, ctx) : askMany(questions, signal, ctx);
		},
		renderCall: questionCall,
		renderResult: questionResult,
	});
	// Earlier sessions recorded these tool names. Keep them hidden from the model
	// but registered, so their transcript entries still render as question rows.
	for (const [name, parameters] of [["ask_user_question", AskUserQuestionParams], ["ask_questions", AskQuestionsParams]] as const) {
		pi.registerTool({
			name, label: "Question", renderShell: "self", exposure: "hidden", description: `Replaced by ${CONSULT}.`, parameters,
			async execute(_toolCallId, params: any, signal, _onUpdate, ctx) {
				const questions = questionDefs(params.questions ?? [params]);
				return questions.length === 1 && !params.questions ? askOne(questions[0], signal, ctx) : askMany(questions, signal, ctx);
			},
			renderCall: questionCall,
			renderResult: questionResult,
		});
	}
	// The user's curiosity setting adds one line to consult's guidance for each run.
	pi.on("before_agent_start", async (event) => {
		const line = CURIOSITY_GUIDANCE[savedAskAppearance().curiosity];
		const options = (event as any).systemPromptOptions;
		if (!line || !options?.toolGuidelines) return;
		const current: string[] = options.toolGuidelines[CONSULT] ?? [];
		if (!current.includes(line)) options.toolGuidelines[CONSULT] = [...current, line];
	});
}
