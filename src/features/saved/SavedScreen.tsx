import { Bookmark, BookOpen, Brain, RefreshCw, Repeat2, Trash2, Volume2 } from 'lucide-react'
import { useState } from 'react'
import {
  AppFrame,
  type AppNavigationCallbacks,
} from '../navigation/AppFrame.tsx'

export interface SavedSentenceViewModel {
  readonly key: string
  readonly packId: string
  readonly sentenceId: string
  readonly packTitle: string
  readonly lessonTitle: string
  readonly topic: string
  readonly sentenceText: string
  readonly translationVi: string
}

export type SavedSentencesState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | {
      readonly status: 'ready'
      readonly items: readonly SavedSentenceViewModel[]
    }

export interface SavedScreenProps extends AppNavigationCallbacks {
  readonly state: SavedSentencesState
  readonly storageAvailable: boolean
  readonly notice: string | undefined
  readonly onRetry: () => void
  readonly onRemove: (
    sentence: SavedSentenceViewModel,
  ) => void | Promise<void>
  readonly onListen: (sentence: SavedSentenceViewModel) => void
  readonly onPracticeRecall: (sentence: SavedSentenceViewModel) => void
  readonly onShadow: (sentence: SavedSentenceViewModel) => void
}

export function SavedScreen({
  state,
  storageAvailable,
  notice,
  onRetry,
  onRemove,
  onListen,
  onPracticeRecall,
  onShadow,
  ...navigation
}: SavedScreenProps) {
  const [removingKey, setRemovingKey] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const remove = async (sentence: SavedSentenceViewModel) => {
    if (removingKey) return
    setRemovingKey(sentence.key)
    setActionError(null)
    try {
      await onRemove(sentence)
    } catch {
      setActionError('Could not remove that sentence. Please try again.')
    } finally {
      setRemovingKey(null)
    }
  }

  return (
    <AppFrame
      {...navigation}
      activeView="saved"
      storageAvailable={storageAvailable}
      notice={notice}
    >
      <header className="view-heading saved-heading">
        <p className="eyebrow">Your collection</p>
        <h1>Saved sentences</h1>
        <p>Keep useful sentence contexts close for focused practice.</p>
      </header>

      {actionError ? <p className="saved-action-error" role="alert">{actionError}</p> : null}

      {state.status === 'loading' ? (
        <div className="saved-loading" role="status" aria-live="polite">
          <RefreshCw className="is-spinning" size={22} aria-hidden="true" />
          <span>Loading saved sentences…</span>
        </div>
      ) : null}

      {state.status === 'error' ? (
        <section className="saved-error" role="alert">
          <Bookmark size={24} aria-hidden="true" />
          <div>
            <h2>Saved sentences are unavailable</h2>
            <p>{state.message}</p>
          </div>
          <button className="button secondary compact" type="button" onClick={onRetry}>
            <RefreshCw size={15} aria-hidden="true" /> Retry
          </button>
        </section>
      ) : null}

      {state.status === 'ready' && state.items.length === 0 ? (
        <div className="empty-state saved-empty">
          <Bookmark size={29} aria-hidden="true" />
          <h2>No saved sentences yet</h2>
          <p>Use Save beside a sentence while learning to add it here.</p>
          <button className="button secondary compact" type="button" onClick={navigation.onOpenLessons}>
            <BookOpen size={15} aria-hidden="true" /> Browse lessons
          </button>
        </div>
      ) : null}

      {state.status === 'ready' && state.items.length > 0 ? (
        <ul className="saved-sentence-list" aria-label="Saved sentences">
          {state.items.map((sentence) => {
            const isRemoving = removingKey === sentence.key
            return (
              <li className="saved-sentence-card" key={sentence.key}>
                <div className="saved-sentence-context">
                  <span>{sentence.packTitle}</span>
                  <span aria-hidden="true">/</span>
                  <span>{sentence.lessonTitle}</span>
                  <span className="saved-topic">{sentence.topic}</span>
                </div>
                <blockquote>{sentence.sentenceText}</blockquote>
                <p lang="vi">{sentence.translationVi}</p>
                <div className="saved-sentence-actions">
                  <button
                    className="button secondary compact"
                    type="button"
                    disabled={isRemoving}
                    onClick={() => onListen(sentence)}
                  >
                    <Volume2 size={15} aria-hidden="true" /> Listen
                  </button>
                  <button
                    className="button primary compact"
                    type="button"
                    disabled={isRemoving}
                    onClick={() => onPracticeRecall(sentence)}
                  >
                    <Brain size={15} aria-hidden="true" /> Practice Recall
                  </button>
                  <button
                    className="button secondary compact"
                    type="button"
                    disabled={isRemoving}
                    onClick={() => onShadow(sentence)}
                  >
                    <Repeat2 size={15} aria-hidden="true" /> Shadow
                  </button>
                  <button
                    className="button secondary compact saved-remove-button"
                    type="button"
                    disabled={isRemoving}
                    onClick={() => void remove(sentence)}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                    {isRemoving ? 'Removing…' : 'Remove'}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      ) : null}
    </AppFrame>
  )
}
