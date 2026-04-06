import React from "react";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: "2rem",
          background: "var(--surface, #1a1a2e)",
          border: "1px solid rgba(255,51,102,.3)",
          borderRadius: 6,
          textAlign: "center",
          color: "var(--text-secondary, #aaa)",
        }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>⚠️</div>
          <p style={{ fontWeight: 700, color: "var(--danger, #ff3366)", marginBottom: 4 }}>
            {this.props.label || "Une erreur est survenue"}
          </p>
          <p style={{ fontSize: 12, marginBottom: 12 }}>
            {this.state.error?.message || "Erreur inconnue"}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              background: "rgba(255,51,102,.15)",
              border: "1px solid rgba(255,51,102,.3)",
              color: "var(--danger, #ff3366)",
              padding: "6px 16px", borderRadius: 4,
              cursor: "pointer", fontSize: 12,
            }}
          >
            Réessayer
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
