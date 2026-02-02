# CM6 ViewPlugin + WidgetType Patterns for Rich Live Preview

Research Date: 2026-02-02
Plugins Analyzed: Dataview, obsidian-cm6-attributes, Shiki Plugin

---

## 1. DATAVIEW: Inline Field Live Preview (BEST REFERENCE)

**Source:** `obsidian-dataview/src/ui/views/inline-field-live-preview.ts`

### Pattern: Detect Content + Replace with Widget

```typescript
// StateField stores inline field positions as RangeSet
export const inlineFieldsField = StateField.define<RangeSet<InlineFieldValue>>({
    create: buildInlineFields,
    update(oldFields, tr) {
        return buildInlineFields(tr.state);
    },
});

// Build decorations for visible ranges
buildDecorations(view: EditorView): DecorationSet {
    // Disable in source mode - only LP
    if (!view.state.field(editorLivePreviewField)) return Decoration.none;

    const info = view.state.field(inlineFieldsField);
    const builder = new RangeSetBuilder<Decoration>();

    for (const { from, to } of view.visibleRanges) {
        info.between(from, to, (start, end, { field }) => {
            // If NOT overlapping with cursor, replace with widget
            if (!selectionAndRangeOverlap(selection, start, end)) {
                builder.add(
                    start,
                    end,
                    Decoration.replace({
                        widget: new InlineFieldWidget(app, field, file.path, component, settings, view),
                    })
                );
            }
        });
    }
    return builder.finish();
}
```

### WidgetType Implementation

```typescript
class InlineFieldWidget extends WidgetType {
    constructor(
        public app: App,
        public field: InlineField,
        public sourcePath: string,
        public component: Component,
        public settings: DataviewSettings,
        public view: EditorView
    ) {
        super();
    }

    // Equality check for decoration updates
    eq(other: InlineFieldWidget): boolean {
        return this.field.key == other.field.key && this.field.value == other.field.value;
    }

    // Create DOM element to replace markdown
    toDOM() {
        const container = createSpan({ cls: ["dataview", "inline-field"] });

        // Render key and value
        const key = container.createSpan({ cls: ["dataview", "inline-field-key"] });
        renderCompactMarkdown(this.app, this.field.key, key, this.sourcePath, this.component, true);

        const value = container.createSpan({ cls: ["dataview", "inline-field-value"] });
        renderValue(this.app, parseInlineValue(this.field.value), value, ...);

        // Add click handler to return to source
        this.addKeyClickHandler(key, container);
        this.addValueClickHandler(value, container);

        return container;
    }

    // Click handler: navigate back to source position
    addValueClickHandler(value: HTMLElement, container: HTMLElement) {
        value.addEventListener("click", (event) => {
            if (event instanceof MouseEvent) {
                const rect = value.getBoundingClientRect();
                const relativePos = (event.x - rect.x) / rect.width;
                const startPos = this.view.posAtCoords(container.getBoundingClientRect(), false);
                const clickedPos = Math.round(
                    startPos + (this.field.startValue - this.field.start) +
                    (this.field.end - this.field.startValue) * relativePos
                );
                this.view.dispatch({ selection: { anchor: clickedPos } });
            }
        });
    }
}
```

### ViewPlugin Registration

```typescript
export const replaceInlineFieldsInLivePreview = (app: App, settings: DataviewSettings) =>
    ViewPlugin.fromClass(
        class implements PluginValue {
            decorations: DecorationSet;
            component: Component;

            constructor(view: EditorView) {
                this.component = new Component();
                this.component.load();
                this.decorations = this.buildDecorations(view);
            }

            destroy() {
                this.component.unload();
            }

            update(update: ViewUpdate) {
                if (!update.state.field(editorLivePreviewField)) {
                    this.decorations = Decoration.none;
                    return;
                }

                if (update.docChanged) {
                    this.decorations = this.decorations.map(update.changes);
                    this.updateDecorations(update.view);
                } else if (update.selectionSet || update.viewportChanged) {
                    this.decorations = this.buildDecorations(update.view);
                }
            }
        },
        {
            decorations: instance => instance.decorations,
        }
    );
```

---

## 2. OBSIDIAN-CM6-ATTRIBUTES: Fold Widget Pattern

**Source:** `obsidian-cm6-attributes/src/main.ts`

### WidgetType for Fold Icons

```typescript
class FoldWidget extends WidgetType {
    isFolded: boolean;
    isHeader: boolean;

    constructor(isFolded: boolean, isHeader: boolean = false) {
        super();
        this.isFolded = isFolded;
        this.isHeader = isHeader;
    }

    eq(other: FoldWidget) {
        return other.isFolded == this.isFolded;
    }

    toDOM() {
        let el = document.createElement("div");
        el.className = "cm-fold-widget collapse-indicator collapse-icon";
        if (this.isFolded) el.addClass("is-collapsed");
        this.isHeader
            ? el.addClass("heading-collapse-indicator")
            : el.addClass("list-collapse-indicator");
        setIcon(el, "right-triangle", 8);
        return el;
    }

    // CRITICAL: Return false to allow event propagation to handlers
    ignoreEvent() {
        return false;
    }
}
```

### Event Handlers in ViewPlugin

```typescript
const viewPlugin = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
            this.decorations = this.buildDecorations(view);
        }

        update(update: ViewUpdate) {
            if (update.docChanged || update.viewportChanged) {
                this.decorations = this.buildDecorations(update.view);
            }
        }
    },
    {
        decorations: v => v.decorations,

        // Event handlers for widget interactions
        eventHandlers: {
            mousedown: (e, view) => {
                let target = (e.target as HTMLElement).closest(".cm-fold-widget");
                if (target) {
                    const foldMarkerPos = view.posAtDOM(target);
                    const line = view.state.doc.lineAt(foldMarkerPos);
                    let range = foldable(view.state, line.from, line.to);
                    if (range) {
                        // Toggle fold
                        let effect = foldExists(view.state, range.from, range.to)
                            ? unfoldEffect
                            : foldEffect;
                        view.dispatch({ effects: [effect.of(range)] });
                        return true;
                    }
                }
            },
        },
    }
);
```

---

## 3. SHIKI PLUGIN: Syntax Highlighting Decorations

**Source:** `obsidian-shiki-plugin/src/codemirror/Cm6_ViewPlugin.ts`

### Decoration with Conditional Hiding

```typescript
interface InsertDecoration {
    type: DecorationUpdateType.Insert;
    from: number;
    to: number;
    lang: string;
    content: string;
    hideLang?: boolean;
    hideTo?: number;
}

// Build decorations with widget replacement
async buildDecorations(from: number, to: number, lang: string, content: string) {
    const highlight = await plugin.highlighter.getHighlightTokens(content, lang.toLowerCase());
    if (!highlight) return [];

    const decorations: Range<Decoration>[] = [];

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const nextToken = tokens[i + 1];
        const tokenStyle = plugin.highlighter.getTokenStyle(token);

        decorations.push(
            Decoration.mark({
                attributes: {
                    style: tokenStyle.style,
                    class: tokenStyle.classes.join(" "),
                },
            }).range(from + token.offset, nextToken ? from + nextToken.offset : to)
        );
    }

    return decorations;
}

// Usage: hide language tag in Live Preview
if (node.hideLang) {
    decorations.unshift(
        Decoration.replace({}).range(node.from, node.hideTo)
    );
}
```

---

## KEY PATTERNS SUMMARY

### 1. Detection
```typescript
// Use StateField to track positions
export const myFieldsField = StateField.define<RangeSet<MyValue>>({
    create: buildFields,
    update(fields, tr) { return buildFields(tr.state); },
});

// Check Live Preview mode
if (!view.state.field(editorLivePreviewField)) return Decoration.none;
```

### 2. Building Decorations
```typescript
const builder = new RangeSetBuilder<Decoration>();
for (const { from, to } of view.visibleRanges) {
    info.between(from, to, (start, end, value) => {
        if (!selectionOverlap) {
            builder.add(
                start,
                end,
                Decoration.replace({ widget: new MyWidget(...) })
            );
        }
    });
}
return builder.finish();
```

### 3. WidgetType
```typescript
class MyWidget extends WidgetType {
    eq(other) { return this.data === other.data; }

    toDOM() {
        const el = createSpan({ cls: ["my-widget"] });
        // Render content
        return el;
    }

    ignoreEvent() { return true; } // or false for custom handlers
}
```

### 4. Click to Return to Source
```typescript
widget.addEventListener("click", (event) => {
    const rect = widget.getBoundingClientRect();
    const pos = view.posAtCoords(rect, false);
    view.dispatch({ selection: { anchor: pos + offset } });
});
```

---

## FILES REFERENCED

1. Dataview: `src/ui/views/inline-field-live-preview.ts`
2. obsidian-cm6-attributes: `src/main.ts`
3. obsidian-shiki-plugin: `src/codemirror/Cm6_ViewPlugin.ts`
