import { Component, type ErrorInfo, type ReactNode } from "react";
import { loadLanguage } from "./i18n/languageStorage";
import { translations, type Language } from "./i18n/translations";

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
};

/** Translate an error UI key in the stored/browser language (no context). */
function errorText(lang: Language, key: "error.title" | "error.retry"): string {
  const dict = translations[lang] as Record<string, unknown>;
  const value = dict[key] ?? (translations.en as Record<string, unknown>)[key];
  return (value as string) ?? key;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Uncaught render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      const lang = loadLanguage();
      return (
        <div
          style={{
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            padding: 32,
            fontFamily: "system-ui, sans-serif",
            background: "var(--bg, #1e1e1e)",
            color: "var(--fg, #e0e0e0)",
          }}
        >
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
            {errorText(lang, "error.title")}
          </h1>
          <pre
            style={{
              maxWidth: 560,
              padding: 16,
              borderRadius: 8,
              background: "var(--code-bg, #2d2d2d)",
              fontSize: 13,
              lineHeight: 1.5,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            style={{
              border: "1px solid var(--border, #3c3c3c)",
              borderRadius: 6,
              padding: "8px 18px",
              background: "var(--bg, #1e1e1e)",
              color: "var(--fg, #e0e0e0)",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            {errorText(lang, "error.retry")}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
