import { Component, type ErrorInfo, type ReactNode } from 'react'

interface AppErrorBoundaryProps {
  readonly children: ReactNode
  readonly onReload?: () => void
}

interface AppErrorBoundaryState {
  readonly failed: boolean
}

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV) console.error('Application render failed', error, info)
  }

  render() {
    if (!this.state.failed) return this.props.children

    return (
      <main className="centered-page boot-screen" role="alert">
        <strong>English Recall needs to reload</strong>
        <span>Your saved learning data remains on this device.</span>
        <button
          className="button primary compact"
          type="button"
          onClick={() =>
            this.props.onReload ? this.props.onReload() : window.location.reload()
          }
        >
          Reload application
        </button>
      </main>
    )
  }
}
