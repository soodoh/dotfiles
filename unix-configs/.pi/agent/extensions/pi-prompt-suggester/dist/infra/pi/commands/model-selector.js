import { Container, Key, matchesKey, SelectList, Spacer, Text } from "@mariozechner/pi-tui";
function isCurrentModel(model, currentValue) {
    if (!currentValue)
        return false;
    return currentValue === `${model.provider}/${model.id}` || currentValue === model.id;
}
export function buildModelSelectionItems(models, currentValue, specialOptions = []) {
    const specialItems = specialOptions.map((option) => ({
        value: option.value,
        label: option.value,
        description: option.description,
    }));
    const modelItems = [...models]
        .sort((a, b) => {
        const aCurrent = isCurrentModel(a, currentValue);
        const bCurrent = isCurrentModel(b, currentValue);
        if (aCurrent !== bCurrent)
            return aCurrent ? -1 : 1;
        return `${a.provider}/${a.id}`.localeCompare(`${b.provider}/${b.id}`);
    })
        .map((model) => ({
        value: `${model.provider}/${model.id}`,
        label: `${model.provider}/${model.id}`,
        description: [model.name, isCurrentModel(model, currentValue) ? "current setting" : undefined].filter(Boolean).join(" • ") || undefined,
    }));
    return [...specialItems, ...modelItems];
}
export async function showModelSelector(ctx, options) {
    const items = buildModelSelectionItems(await ctx.modelRegistry.getAvailable(), options.currentValue, options.specialOptions);
    if (items.length === 0) {
        ctx.ui.notify("No selectable models available.", "error");
        return undefined;
    }
    const result = await ctx.ui.custom((tui, theme, _kb, done) => {
        const container = new Container();
        const titleText = new Text(theme.fg("accent", theme.bold(options.title)), 1, 0);
        const currentText = new Text(theme.fg("dim", `Current: ${options.currentValue ?? "(none)"}`), 1, 0);
        const filterText = new Text("", 1, 0);
        const hintText = new Text(theme.fg("dim", "Type to filter • Backspace delete • ↑↓ navigate • Enter select • Esc cancel"), 1, 0);
        const selectList = new SelectList(items, Math.min(Math.max(items.length, 1), 10), {
            selectedPrefix: (text) => theme.fg("accent", text),
            selectedText: (text) => theme.fg("accent", text),
            description: (text) => theme.fg("muted", text),
            scrollInfo: (text) => theme.fg("dim", text),
            noMatch: (text) => theme.fg("warning", text),
        });
        let filter = "";
        const syncFilter = () => {
            selectList.setFilter(filter);
            filterText.setText(theme.fg("muted", `Filter: ${filter || "(type to search)"}`));
        };
        selectList.onSelect = (item) => done(String(item.value));
        selectList.onCancel = () => done(null);
        container.addChild(titleText);
        container.addChild(currentText);
        container.addChild(new Spacer(1));
        container.addChild(filterText);
        container.addChild(selectList);
        container.addChild(new Spacer(1));
        container.addChild(hintText);
        syncFilter();
        return {
            render(width) {
                return container.render(width);
            },
            invalidate() {
                container.invalidate();
            },
            handleInput(data) {
                if (matchesKey(data, Key.ctrl("c")) || matchesKey(data, Key.escape)) {
                    done(null);
                    return;
                }
                if (matchesKey(data, Key.backspace)) {
                    if (filter.length > 0) {
                        filter = filter.slice(0, -1);
                        syncFilter();
                        tui.requestRender();
                        return;
                    }
                }
                else if (matchesKey(data, Key.ctrl("u"))) {
                    if (filter.length > 0) {
                        filter = "";
                        syncFilter();
                        tui.requestRender();
                        return;
                    }
                }
                else if (data.length === 1 && data.charCodeAt(0) >= 32) {
                    filter += data;
                    syncFilter();
                    tui.requestRender();
                    return;
                }
                selectList.handleInput(data);
                tui.requestRender();
            },
        };
    }, { overlay: true });
    return result ?? undefined;
}
