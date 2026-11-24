import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { matchesKey, Text, SelectList, wrapTextWithAnsi, truncateToWidth } from '@earendil-works/pi-tui';
import { frameRows } from './frame.ts';
import { questionAccent } from './question-surface.ts';
import { TabbedQuestions, type BatchUIResult, type QuestionDraft } from './batch-ui.ts';
import { questionHeight, questionTheme, questionViewport, frameQuestion } from './question-surface.ts';
import { savedAskAppearance } from './appearance.ts';
import { sanitizeDisplayText } from './tui-primitives.ts';
import { questionStatus } from 'pi-agent-contracts/posted';
import type { PostedQuestion } from './posted-state.ts';
import { CopyLines, appendCopyLines, forgetCopyProjection, projectCopyRows, rememberCopyProjection } from './copy.ts';

/** Ask's posted overlays and the frame's own budget read one height cap. */
const OVERLAY_MAX_HEIGHT = 0.85;
const overlayMaxHeight: `${number}%` = `${Math.round(OVERLAY_MAX_HEIGHT * 100)}%`;
const overlayRows = (tui: any) => Math.max(1, Math.floor((tui.terminal?.rows ?? 30) * OVERLAY_MAX_HEIGHT));

/** The inbox shares Ask's frame, appearance and native selection instead of Pi's generic dialog. */
export async function postedInboxUI(ctx: ExtensionContext, questions: () => PostedQuestion[], bindClose: (close?: () => void) => void): Promise<string | undefined> {
  return ctx.ui.custom<string | undefined>((tui, theme, _kb, done) => {
    const palette=questionTheme(theme,savedAskAppearance());
    let list: SelectList | undefined, signature="", selected: string | undefined;
    const refresh=()=> {
      const rows=questions();
      const height=Math.max(1,questionViewport(tui, overlayRows(tui)).terminal.rows-4);
      const next=JSON.stringify([height,rows.map(q=>[q.id,q.revision,q.definition.question,q.state,q.urgency])]);
      if (next===signature && list) return list;
      selected=list?.getSelectedItem()?.value ?? selected;
      signature=next;
      list=new SelectList(rows.map(q=>({value:q.id,label:`${q.id} · ${q.state==='awaiting' ? q.urgency==='blocking' ? 'Needs your input' : 'Can wait' : questionStatus(q)} · ${sanitizeDisplayText(q.definition.question)}`})),height,{
        selectedPrefix:s=>palette.fg('accent',s),selectedText:s=>palette.fg('accent',s),description:s=>palette.fg('muted',s),scrollInfo:s=>palette.fg('dim',s),noMatch:s=>palette.fg('muted',s),
      });
      list.setSelectedIndex(Math.max(0,rows.findIndex(q=>q.id===selected)));
      list.onSelect=item=>done(item.value);list.onCancel=()=>done(undefined);
      return list;
    };
    bindClose(()=>done(undefined));
    const component={
      render(width:number) {
        const lines = new CopyLines();
        lines.push(truncateToWidth(palette.fg('muted','Choose a question to answer or inspect'),width));
        lines.mark(0, 1, 'decoration');
        appendCopyLines(lines, refresh().render(width));
        lines.push(truncateToWidth(palette.fg('muted','↑↓ choose · Enter open · Esc close'),width));
        lines.mark(lines.length - 1, lines.length, 'decoration');
        return lines;
      },
      handleInput(data:string) {refresh().handleInput(data);tui.requestRender();},
      handleMouse(event:any) {const result=refresh().handleMouse({...event,y:event.y-1});if(result)tui.requestRender();return result;},
      invalidate() {signature="";},getHeaderLabel(){return 'Question inbox';},getMoreActions(){return [{label:'Close inbox',run:()=>done(undefined)}];},
    };
    return frameQuestion(component,palette,tui,{raised:true,maxRows:overlayRows(tui)});
  },{overlay:true,overlayOptions:{width:'90%',maxHeight:overlayMaxHeight,anchor:'bottom-center'}}).finally(()=>bindClose(undefined));
}

export interface SheetQuestion {
  question: PostedQuestion;
  /** Linked plan/task titles, resolved by the caller from the Tasks catalogue. */
  links: () => string[];
}

/** One quiet line under the question: what it is for and what waits. Full detail is one F2 away. */
export function compactContext(q: PostedQuestion, links: string[]): string {
  const work = links.find(line => line.startsWith('Linked work: '))?.slice('Linked work: '.length).replace(/ · t\d+$/, '');
  const plan = links.find(line => line.startsWith('Linked plan: '))?.slice('Linked plan: '.length);
  const subject = work ? `For ${work}${plan ? ` · ${plan}` : ''}` : plan ? `For ${plan}` : '';
  const waits = q.urgency === 'blocking' ? q.boundary : 'Can wait';
  return [subject, waits].filter(Boolean).join(' — ');
}

export function fullContext(q: PostedQuestion, links: string[]): string {
  return [...links, `Why: ${q.why}`, q.boundary, ...(q.neededNow ? [`Needed now: ${q.neededNow}`] : []),
    q.urgency === 'blocking' ? 'Only the stated boundary waits. Independent authorized work may continue.' : 'Can wait until this boundary needs the answer.'].filter(Boolean).join('\n\n');
}

/** Every waiting question in one sheet. Choosing an option continues; a lone question sends at once;
 * submitting leaves unanswered questions open with their drafts. Reuses Ask's editors and Review. */
export async function postedSheetUI(ctx: ExtensionContext, sheet: SheetQuestion[], current: (index: number) => boolean,
  bindClose: (close?: () => void) => void, initialTab = 0): Promise<{ result: BatchUIResult; drafts: QuestionDraft[]; activeIndex: number }> {
  let drafts: QuestionDraft[] = [], activeIndex = initialTab;
  const expanded = new Set<number>();
  const details = (index: number) => {
    const { question: q, links } = sheet[index]!;
    const own = q.definition.details?.trim();
    const context = expanded.has(index) ? fullContext(q, links()) : compactContext(q, links());
    return [own, context].filter(Boolean).join('\n\n');
  };
  const result = await ctx.ui.custom<BatchUIResult>((tui, theme, kb, done) => {
    let settled = false;
    const finish = (result: BatchUIResult) => { if (settled) return; settled = true; drafts = form.captureDrafts(); activeIndex = form.activeIndex; done(result); };
    const palette = questionTheme(theme, savedAskAppearance());
    const form = new TabbedQuestions(sheet.map((item, index) => ({ ...item.question.definition, details: details(index) })),
      questionViewport(tui, overlayRows(tui)), palette, kb, finish, ctx.cwd, undefined, false,
      { quick: true, keepUnansweredOpen: true, initialTab, drafts: sheet.map(item => item.question.draft) });
    // Closing a sheet is not a submission: every question keeps its draft.
    form.preserveDraftOnDismiss = true;
    bindClose(() => finish(null));
    const refresh = () => sheet.forEach((_, index) => { if (current(index)) form.setContextDetails(details(index), index); });
    const urgency = () => {
      const q = sheet[form.activeIndex]?.question;
      return !q ? '' : q.urgency === 'blocking' ? q.taskIds.length ? 'Blocks linked work' : 'Blocks stated boundary' : 'Can wait';
    };
    const component = {
      get focused() { return form.focused; }, set focused(v: boolean) { form.focused = v; },
      invalidate() { form.invalidate(); }, render(width: number) { refresh(); return form.render(width); },
      handleInput(data: string) {
        if (!sheet.some((_, index) => current(index))) { finish(null); return; }
        refresh();
        // Nested modes and a pending confirmation resolve their own Escape; otherwise
        // the form's own top-level close decides, so a draft asks before closing.
        if (!matchesKey(data, 'escape') || !form.backFromNestedMode()) form.handleInput(data);
      },
      isConfirmingDismiss() { return form.isConfirmingDismiss(); },
      setAdvanceListener(listener: () => void) { form.setAdvanceListener(listener); },
      getHeaderLabel() { return sheet.length > 1 ? `${urgency()} · ${form.getHeaderLabel()}` : urgency(); },
      getMoreActions() {
        const index = form.activeIndex;
        return [
          { label: expanded.has(index) ? 'Hide why this is asked' : 'Why this is asked', run: () => {
            if (expanded.has(index)) expanded.delete(index); else expanded.add(index);
            form.setContextDetails(details(index), index); tui.requestRender();
          } },
          { label: 'Close and keep drafts', run: () => finish(null) }, ...form.getMoreActions(),
        ];
      },
    };
    return frameQuestion(component, palette, tui, { raised: true, maxRows: overlayRows(tui) });
  }, { overlay: true, overlayOptions: { width: '75%', minWidth: 56, maxHeight: overlayMaxHeight, anchor: 'bottom-center' } }).finally(() => bindClose(undefined));
  return { result, drafts, activeIndex };
}
export async function postedOutcomeUI(ctx: ExtensionContext, q: PostedQuestion, bindClose: (close?: () => void) => void) {
  await ctx.ui.custom<void>((tui, theme, _kb, done) => {
    bindClose(done);
    const palette = questionTheme(theme, savedAskAppearance());
    let scroll = 0;
    const values = q.response?.answers.flatMap(a => Array.isArray(a.answer) ? a.answer : a.answer == null ? [] : [a.answer]) ?? [];
    const body = [q.definition.question, '', questionStatus(q), q.boundary,
      ...values.map(a => typeof a === 'string' ? a : a.label),
      ...q.response?.answers.filter(a => a.note).flatMap(a => ['', 'Your note', a.note!]) ?? [],
      ...(q.response?.clarification ? ['', 'Your clarification', q.response.clarification] : []),
      ...(q.consequence ? ['', 'Reported consequence', q.consequence] : []),
      ...(q.replacementId ? [`Replacement: ${q.replacementId}`] : []),
      '', q.state === 'submitted' ? 'Submitted is not delivered. Use /questions retry <id> only if delivery is interrupted.' :
        q.state === 'delivered' ? 'Received by the model context; not yet reported applied.' :
        q.state === 'applied' ? 'Agent report, not independent verification. Tasks have not been changed automatically.' : 'Withdrawal or replacement is not approval.',
      'To correct this response, tell the agent what changed and request a provenance-preserving replacement. Delivered context and completed external effects are not undone.', ''];
    const component = {
      handleInput(data: string) { if (matchesKey(data, 'escape') || matchesKey(data, 'return') || matchesKey(data, 'ctrl+c')) return done();
        if (matchesKey(data, 'up') || matchesKey(data, 'down')) scroll = Math.max(0, scroll + (matchesKey(data, 'up') ? -1 : 1)); tui.requestRender(); },
      render(width: number) {
        const lines = new CopyLines(...body.flatMap(s => s.split('\n').flatMap(line => wrapTextWithAnsi(palette.fg('text', sanitizeDisplayText(line)), Math.max(1, width)))));
        const room = Math.max(1, questionHeight(tui, overlayRows(tui)) - 4); scroll = Math.min(scroll, Math.max(0, lines.length - room));
        const visible = new CopyLines(...lines.slice(scroll, scroll + room).map(line => truncateToWidth(line, Math.max(0, width), '')));
        visible.push(truncateToWidth(palette.fg('muted', '↑↓ scroll · Esc back'), Math.max(0, width), ''));
        visible.mark(visible.length - 1, visible.length, 'decoration');
        return visible;
      }, getHeaderLabel() { return questionStatus(q); }, invalidate() {},
    };
    return frameQuestion(component, palette, tui, { raised: true, maxRows: overlayRows(tui) });
  }, { overlay: true, overlayOptions: { width: '75%', maxHeight: overlayMaxHeight, anchor: 'center' } }).finally(() => bindClose(undefined));
}
export function questionEventCard(details: any, theme: any, expanded = false) {
  let revision = 0;
  const card = { invalidate() {}, render(width: number) {
    const q = details?.question as PostedQuestion | undefined;
    const status = q ? questionStatus(q) : '';
    const rows = [details?.label ?? 'Question event', q?.definition.question ?? '', status,
      ...(q?.neededNow ? [q.neededNow] : []),
      ...(q?.state === 'awaiting' ? [q.urgency === 'blocking' ? q.taskIds.length ? 'Blocks linked work' : 'Blocks stated boundary' : 'Can wait', q.boundary] : []),
      ...(q?.response?.answers ?? []).flatMap(a => [...(Array.isArray(a.answer) ? a.answer : a.answer == null ? [] : [a.answer]).map(v => typeof v === 'string' ? v : v.label), ...(a.note ? ['Your note', a.note] : [])]),
      ...(q?.response?.clarification ? ['Your clarification', q.response.clarification] : []),
      ...(q?.consequence ? [q.consequence] : []), ...(expanded && q ? [`Why: ${q.why}`, q.boundary, `Reference ${q.id} · revision ${q.revision}`, ...(q.taskIds.length ? [`Linked work: ${q.planId} / ${q.taskIds.join(', ')}`] : []),
        ...(q.definition.options.length ? ['Original choices', ...q.definition.options.flatMap(o => [o.label, o.description ?? '', ...(o.suggestion ? [`Assistant suggestion: ${o.suggestion.basis}`, o.suggestion.caveat ?? ''] : [])])] : [])] : [])];
    if (width <= 0) { forgetCopyProjection(card); return []; }
    const framed = width >= 10;
    // An answered question's "Answer" label is accent purple; the status after it stays text.
    const prefix = q?.response?.status === 'answered' ? 'Answer' : undefined;
    const content = new Text(rows.filter(Boolean).flatMap((r, i) => String(r).split('\n').map(line => {
      const text = sanitizeDisplayText(line);
      if (i === 0) return theme.fg(details?.error ? 'error' : 'accent', text);
      if (prefix && r === status && text.startsWith(prefix)) return theme.fg('accent', prefix) + theme.fg('text', text.slice(prefix.length));
      return theme.fg('text', text);
    })).join('\n'), 0, 0)
      .render(Math.max(1, width - (framed ? 4 : 0))).map(line => truncateToWidth(line, Math.max(1, width - (framed ? 4 : 0)), ''));
    if (!framed) { forgetCopyProjection(card); return content; }
    const rendered = frameRows({ theme, width, rows: content, inset: 1, color: questionAccent(theme) });
    const regions = [];
    // The renderer label is chrome; the question, status, answers and notes are content.
    for (let row = details?.label ? 2 : 1; row < rendered.length - 1; row++) regions.push({ row, start: 2, end: width - 2 });
    return rememberCopyProjection(card, width, rendered, projectCopyRows("pi-ask:event-card", width, rendered, ++revision, regions));
  } };
  return card;
}

/** Questions carried by an answer message: a sheet's batch, or one question from older sessions. */
export function answeredQuestions(details: any): PostedQuestion[] {
  return Array.isArray(details?.questions) ? details.questions : details?.question ? [details.question] : [];
}

/** The transcript record of what you sent: each question, then a purple "Answer" label and your answer.
 * Delivery state lives in /questions, so the card never goes stale saying "submitted". */
export function answerCard(details: any, theme: any, expanded = false) {
  let revision = 0;
  const card = { invalidate() {}, render(width: number) {
    if (width <= 0) { forgetCopyProjection(card); return []; }
    const questions = answeredQuestions(details);
    const inner = Math.max(1, width - (width >= 10 ? 4 : 0));
    const out: string[] = [];
    const wrap = (text: string, paint: (line: string) => string) => {
      for (const line of sanitizeDisplayText(text).split('\n')) out.push(...wrapTextWithAnsi(paint(line), inner));
    };
    const labelled = (label: string, role: string, value: string) => {
      const lines = sanitizeDisplayText(value).split('\n');
      out.push(...wrapTextWithAnsi(`${theme.fg(role, label)}  ${theme.fg('text', lines[0] ?? '')}`, inner));
      for (const rest of lines.slice(1)) out.push(...wrapTextWithAnsi(theme.fg('text', rest), inner));
    };
    out.push(theme.fg('accent', questions.length > 1 ? `Your answers · ${questions.length}` : 'Your answer'));
    questions.forEach((q, index) => {
      if (index > 0) out.push('');
      wrap(q.definition.question, line => theme.fg('muted', line));
      const response = q.response;
      const values = (response?.answers ?? []).flatMap(a => Array.isArray(a.answer) ? a.answer : a.answer == null ? [] : [a.answer])
        .map(v => typeof v === 'string' ? v : v.label);
      if (response?.status === 'answered') labelled('Answer', 'accent', values.join(' · '));
      else if (response?.status === 'skipped') out.push(theme.fg('muted', 'Skipped · not approval'));
      if (response?.clarification) labelled('You asked', 'accent', response.clarification);
      for (const a of response?.answers ?? []) if (a.note) labelled('Note', 'muted', a.note);
      if (expanded) {
        wrap(`Why: ${q.why}`, line => theme.fg('dim', line));
        wrap(q.boundary, line => theme.fg('dim', line));
        wrap(`Reference ${q.id} · revision ${q.revision}${q.taskIds.length ? ` · ${q.planId} / ${q.taskIds.join(', ')}` : ''}`, line => theme.fg('dim', line));
      }
    });
    const content = out.map(line => truncateToWidth(line, inner, ''));
    if (width < 10) { forgetCopyProjection(card); return content; }
    const rendered = frameRows({ theme, width, rows: content, inset: 1, color: questionAccent(theme) });
    // The title row is chrome; questions, answers and notes are content.
    const regions = [];
    for (let row = 2; row < rendered.length - 1; row++) regions.push({ row, start: 2, end: width - 2 });
    return rememberCopyProjection(card, width, rendered, projectCopyRows('pi-ask:answer-card', width, rendered, ++revision, regions));
  } };
  return card;
}
