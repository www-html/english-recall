import {
  BarChart3,
  BookOpen,
  Bookmark,
  Home,
  Settings,
} from 'lucide-react'
import type { ReactNode } from 'react'

export type PrimaryAppView = 'home' | 'lessons' | 'saved' | 'progress'

export interface AppNavigationCallbacks {
  readonly onOpenHome: () => void
  readonly onOpenLessons: () => void
  readonly onOpenSaved: () => void
  readonly onOpenProgress: () => void
  readonly onOpenSettings: () => void
}

interface AppFrameProps extends AppNavigationCallbacks {
  readonly activeView?: PrimaryAppView
  readonly storageAvailable: boolean
  readonly notice: string | undefined
  readonly children: ReactNode
}

const NAV_ITEMS = [
  { view: 'home', label: 'Home', icon: Home },
  { view: 'lessons', label: 'Lessons', icon: BookOpen },
  { view: 'saved', label: 'Saved', icon: Bookmark },
  { view: 'progress', label: 'Progress', icon: BarChart3 },
] as const

export function AppFrame({
  activeView,
  storageAvailable,
  notice,
  children,
  onOpenHome,
  onOpenLessons,
  onOpenSaved,
  onOpenProgress,
  onOpenSettings,
}: AppFrameProps) {
  const callbacks: Record<PrimaryAppView, () => void> = {
    home: onOpenHome,
    lessons: onOpenLessons,
    saved: onOpenSaved,
    progress: onOpenProgress,
  }

  return (
    <div className="page-shell app-frame">
      <header className="topbar app-topbar">
        <button className="brand-button" type="button" onClick={onOpenHome}>
          <span className="brand-mark" aria-hidden="true">ER</span>
          <span className="brand-copy">
            <strong>English Recall</strong>
            <small>Learn less. Remember more.</small>
          </span>
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label="Open Settings"
          title="Settings"
          onClick={onOpenSettings}
        >
          <Settings size={19} aria-hidden="true" />
        </button>
      </header>

      {!storageAvailable ? (
        <p className="notice notice-error" role="alert">
          Local storage is unavailable. Learning works, but progress may not be saved.
        </p>
      ) : null}
      {notice ? <p className="notice" role="status">{notice}</p> : null}

      <main className="app-page-content">{children}</main>

      <nav className="bottom-navigation" aria-label="Primary navigation">
        {NAV_ITEMS.map(({ view, label, icon: Icon }) => (
          <button
            key={view}
            type="button"
            aria-current={activeView === view ? 'page' : undefined}
            onClick={callbacks[view]}
          >
            <Icon size={20} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
