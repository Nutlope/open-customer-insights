"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export default class ChatErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="border border-border rounded-xl overflow-hidden flex flex-col h-[50vh] md:h-[min(75vh,700px)] md:flex-1 items-center justify-center gap-3">
          <p className="text-sm text-muted-foreground">Something went wrong.</p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="px-3 py-1.5 rounded-md bg-black text-white hover:opacity-80 transition-opacity cursor-pointer text-xs font-mono"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}