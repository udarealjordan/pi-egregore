import { ELEMENTS, IDENTITY, POSITIONS, STATES, STATE_TEXT, COLORS, safeText, type AppearanceColor } from "./appearance.ts";
import type { Selection, Control, InputRoomEditor } from "./settings-room-types.ts";
export const INFO: Record<Selection, string> = {
  frame: "The border around your input. It is always your color, the theme accent, like your messages and send times.",
  status: "What the assistant is doing. Preview another state to customize its text and colors without starting a run.",
  session: "Your current chat name. Long names shorten to fit.", sentTime: "The latest recorded user-message send time, in your color like your messages. Hidden until you send a message; never a live clock.",
  directory: "The current working directory, in the plain text color like the model name.", vim: "Your native Vim mode, when a Vim editor is installed. It is absent otherwise.",
  model: "The current model's display name, in the assistant's color like its replies.", thinking: "The selected thinking level, in the assistant's color; this setting does not change how the model thinks.",
  context: "Context capacity used, not task progress. Unknown usage shows —. Off means absent from the preview.",
  git: "Local Git state. Hidden outside a repository; never performs a network fetch.",
  branch: "The current Git branch icon and name, without status counts. Hidden outside a repository or when HEAD is detached.",
  hint: "A display-only next step from your active task, before the first message. Hidden when there is no sourced hint.",
};
export const nameOf = (id: Selection) => id === "frame" ? "Input box border" : ELEMENTS[id];

const colorName = (value: AppearanceColor | undefined) => value ? COLORS[value as keyof typeof COLORS] ?? value : "Use normal appearance";
export function inputControls(editor: InputRoomEditor): Control[] {
  const { selected, state, more } = editor, draft = editor.get();
  const design = () => draft.appearance!;
  const changed = editor.change, choose = editor.choose, textEditor = editor.text, colorEditor = editor.color, reorder = editor.reorder;
    const stateControl = (): Control => ({ label: "Preview appearance", value: state ? STATES[state] : "Current state (normal settings)",
      help: "Hover or browse a state to see its appearance. No run starts. Enter keeps the demonstration; Esc restores it.",
      activate: () => choose("Preview an assistant state", [{ label: "Current state (normal settings)", value: "" }, ...Object.entries(STATES).map(([value, label]) => ({ value, label }))], state ?? "", value => {
        editor.preview(value ? value as import('./appearance.ts').AppearanceState : undefined);
      }, { show: value => editor.audition(value ? value as import('./appearance.ts').AppearanceState : undefined), restore: editor.restore }) });
    const propertyControls = (): Control[] => {
      const style = state ? design().states[state] : undefined;
      const setState = () => design().states[state!] ??= {};
      if (selected === "frame") return [stateControl()];
      const id = selected, e = design().elements[id];
      const controls: Control[] = [
        { label: "Show this element", value: e.visible ? "On" : "Off", help: "Hide this part without removing its settings. You can turn it back on here.", activate: () => changed(() => {
          e.visible = !e.visible;
          if (e.visible && id === "context" && draft.context === "off") draft.context = "adaptive";
          if (e.visible && id === "git" && draft.git === "off") draft.git = "detailed";
          if (e.visible && id === "directory" && draft.directory === "off") draft.directory = "path";
        }) },
        { label: "Position", value: POSITIONS[e.position], help: "Hover a position to try it. Input rails and footer rows are separate; native scroll hints keep priority.",
          activate: () => choose("Choose a position", Object.entries(POSITIONS).map(([value, label]) => ({ value, label })), e.position, value => changed(() => { e.position = value as typeof e.position; }), editor.visual((candidate, value) => { candidate.appearance!.elements[id].position = value as typeof e.position; })) },
        ...(IDENTITY[id] ? [] : [{ label: "Text color", value: colorName(id === "status" && state ? style?.color : e.color), help: "Hover a color to try it. A state override can inherit the normal color.",
          activate: () => colorEditor(id === "status" && state ? style?.color : e.color, value => {
            if (id === "status" && state) { if (value) setState().color = value; else delete setState().color; }
            else e.color = value ?? "auto";
          }, id === "status" && !!state, (candidate, value) => {
            if (id === "status" && state) { const style = candidate.appearance!.states[state] ??= {}; if (value) style.color = value; else delete style.color; }
            else candidate.appearance!.elements[id].color = value ?? "auto";
          }) }]),
      ];
      if (id === "status") {
        controls.splice(2, 0, stateControl());
        controls.push({ label: state ? "Text for this state" : "Label before status", value: state ? style?.text ?? STATE_TEXT[state] : e.text.split("{value}")[0],
          help: state ? "Wording for this state only. The real run and duration do not change." : "Add text before the live status. To change your turn, preview Finished first.",
          activate: () => textEditor(state ? "Text for this state" : "Label before status", state ? style?.text ?? STATE_TEXT[state] : e.text.split("{value}")[0], "Enter keeps the edit in your preview. Esc cancels this edit. Save is separate.", value => {
            changed(() => { if (state) setState().text = safeText(value); else e.text = safeText(value) + "{value}"; }); return true;
          }) });
      } else controls.push({ label: "Label before value", value: e.text.split("{value}")[0] || "None", help: "Text before the real value. Names, paths and times still come from Pi.",
        activate: () => textEditor("Label before value", e.text.split("{value}")[0], "Include a trailing space if you want one between your label and the value.", value => { changed(() => { e.text = safeText(value) + "{value}"; }); return true; }) });
      controls.push({ label: "More options", value: more ? "Shown" : "Show…", help: "Bold text, group order, narrow-width priority and complete text formatting.", activate: () => { editor.expand(!more); } });
      if (more) controls.push(
        { label: "Bold text", value: (id === "status" && state ? style?.bold ?? e.bold : e.bold) ? "On" : "Off", help: "Emphasize this label without changing its color.", activate: () => changed(() => { if (id === "status" && state) setState().bold = !(style?.bold ?? e.bold); else e.bold = !e.bold; }) },
        { label: "Move earlier in this position", value: "←", help: "Swap order with the preceding element in the same position.", activate: () => reorder(id, -1) },
        { label: "Move later in this position", value: "→", help: "Swap order with the next element in the same position.", activate: () => reorder(id, 1) },
        { label: "Keep space when narrow", value: e.priority, help: "Higher-priority parts shorten later. This is visible only when space is limited.", activate: () => choose("Narrow-pane priority", ["low", "normal", "high"].map(value => ({ value, label: value })), e.priority, value => changed(() => { e.priority = value as typeof e.priority; }), editor.visual((candidate, value) => { candidate.appearance!.elements[id].priority = value as typeof e.priority; })) },
        { label: "Text format", value: e.text, help: "{value} inserts the real value. Other text is literal, never executed.", activate: () => textEditor("Text format", e.text, "Keep {value} to include the real value. Maximum 120 characters.", value => { changed(() => { e.text = safeText(value); }); return true; }) },
        { label: "Separator between elements", value: design().separator || "None", help: "The text between parts that share a position. Applies to every group.", activate: () => textEditor("Group separator", design().separator, "Maximum 8 characters, including spaces.", value => { changed(() => { design().separator = safeText(value, 8); }); return true; }) },
      );
      return controls;
    };

  return propertyControls();
}
