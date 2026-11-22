// Test support: lets a harness keep stubbing `ui.input/select/confirm` while the code
// under test opens Egregore's framed dialogs through `ui.custom`.
// Returns a `custom` implementation that answers dialogs from those stubs and hands
// any other component to `other`.
export function routeDialogs(ui, other = async () => undefined) {
  return async (factory, options) => {
    let result;
    const panel = factory(ui.__tui ?? { terminal: { rows: 40 }, requestRender() {} }, ui.theme, undefined, value => { result = value; });
    switch (panel?.constructor?.name) {
      case "TextDialog": return ui.input(panel.title, panel.input?.getValue?.() ?? "");
      case "ConfirmDialog": return !!(await ui.confirm(panel.title, panel.message));
      case "ChoiceDialog": return ui.select(panel.title, panel.choices);
      default: return other(factory, options, panel, () => result);
    }
  };
}
