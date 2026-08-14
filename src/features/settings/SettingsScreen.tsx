import {
  BookOpen,
  Database,
  Download,
  FileJson,
  FileSpreadsheet,
  Gauge,
  Headphones,
  Trash2,
  Upload,
} from 'lucide-react'
import { useRef, useState } from 'react'
import {
  AppFrame,
  type AppNavigationCallbacks,
} from '../navigation/AppFrame.tsx'
import {
  LearningModeMenu,
  type HomeLearningMode,
} from '../home/LearningModeMenu.tsx'

interface SettingsScreenProps extends AppNavigationCallbacks {
  readonly learningMode: HomeLearningMode
  readonly autoAdvance: boolean
  readonly audioEnabled: boolean
  readonly speechRate: number
  readonly slowerSpeechRate: number
  readonly storageAvailable: boolean
  readonly notice: string | undefined
  readonly onLearningModeChange: (mode: HomeLearningMode) => void
  readonly onAutoAdvanceChange: (enabled: boolean) => void
  readonly onAudioEnabledChange: (enabled: boolean) => void
  readonly onSpeechRateChange: (rate: number) => void
  readonly onSlowerSpeechRateChange: (rate: number) => void
  readonly onImportExcel: (file: File) => void
  readonly onDownloadExcelTemplate: () => void
  readonly onImportJson: (file: File) => void
  readonly onExportBackup: () => void
  readonly onRestoreBackup: (file: File) => void
  readonly onExportDiagnostics: () => void
  readonly onClearDiagnostics: () => void
}

export function SettingsScreen({
  learningMode,
  autoAdvance,
  audioEnabled,
  speechRate,
  slowerSpeechRate,
  storageAvailable,
  notice,
  onLearningModeChange,
  onAutoAdvanceChange,
  onAudioEnabledChange,
  onSpeechRateChange,
  onSlowerSpeechRateChange,
  onImportExcel,
  onDownloadExcelTemplate,
  onImportJson,
  onExportBackup,
  onRestoreBackup,
  onExportDiagnostics,
  onClearDiagnostics,
  ...navigation
}: SettingsScreenProps) {
  const excelInputRef = useRef<HTMLInputElement>(null)
  const jsonInputRef = useRef<HTMLInputElement>(null)
  const backupInputRef = useRef<HTMLInputElement>(null)
  const [confirmDiagnosticsClear, setConfirmDiagnosticsClear] = useState(false)

  return (
    <AppFrame
      {...navigation}
      storageAvailable={storageAvailable}
      notice={notice}
    >
      <header className="view-heading settings-heading">
        <p className="eyebrow">Preferences and data</p>
        <h1>Settings</h1>
        <p>Keep daily learning simple. Manage occasional tools here.</p>
      </header>

      <div className="settings-sections">
        <section className="settings-section" aria-labelledby="learning-settings-title">
          <div className="settings-section-heading">
            <span><Gauge size={18} aria-hidden="true" /></span>
            <div><h2 id="learning-settings-title">Learning</h2><p>Choose how sessions behave.</p></div>
          </div>
          <div className="settings-fields">
            <LearningModeMenu value={learningMode} onChange={onLearningModeChange} />
            <ToggleSetting
              label="Auto Advance"
              description="Move on automatically after sentence feedback."
              checked={autoAdvance}
              onChange={onAutoAdvanceChange}
            />
          </div>
        </section>

        <section className="settings-section" aria-labelledby="audio-settings-title">
          <div className="settings-section-heading">
            <span><Headphones size={18} aria-hidden="true" /></span>
            <div><h2 id="audio-settings-title">Audio</h2><p>Control session-wide playback.</p></div>
          </div>
          <div className="settings-fields">
            <ToggleSetting
              label="Automatic audio"
              description="Play the sentence when a new question appears."
              checked={audioEnabled}
              onChange={onAudioEnabledChange}
            />
            <label className="settings-range">
              <span><strong>Speech rate</strong><output>{speechRate.toFixed(2)}×</output></span>
              <input
                type="range"
                aria-label="Speech rate"
                min="0.6"
                max="1.2"
                step="0.05"
                value={speechRate}
                onChange={(event) => onSpeechRateChange(Number(event.target.value))}
              />
            </label>
            <label className="settings-range">
              <span><strong>Slower replay rate</strong><output>{slowerSpeechRate.toFixed(2)}×</output></span>
              <input
                type="range"
                aria-label="Slower replay rate"
                min="0.5"
                max={Math.max(0.5, Number((speechRate - 0.05).toFixed(2)))}
                step="0.05"
                value={slowerSpeechRate}
                onChange={(event) => onSlowerSpeechRateChange(Number(event.target.value))}
              />
            </label>
          </div>
        </section>

        <section className="settings-section" aria-labelledby="content-settings-title">
          <div className="settings-section-heading">
            <span><BookOpen size={18} aria-hidden="true" /></span>
            <div><h2 id="content-settings-title">Content</h2><p>Import lesson packs without editing the app.</p></div>
          </div>
          <div className="settings-action-list">
            <input
              ref={excelInputRef}
              className="visually-hidden"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) onImportExcel(file)
                event.target.value = ''
              }}
            />
            <button className="settings-action" type="button" onClick={() => excelInputRef.current?.click()}>
              <FileSpreadsheet size={19} aria-hidden="true" />
              <span><strong>Import Excel</strong><small>Use the friendly content-authoring format.</small></span>
              <Upload size={16} aria-hidden="true" />
            </button>
            <button className="settings-action" type="button" onClick={onDownloadExcelTemplate}>
              <FileSpreadsheet size={19} aria-hidden="true" />
              <span><strong>Download Excel template</strong><small>Start with the supported columns and examples.</small></span>
              <Download size={16} aria-hidden="true" />
            </button>
            <details className="advanced-import">
              <summary>Advanced JSON import</summary>
              <input
                ref={jsonInputRef}
                className="visually-hidden"
                type="file"
                accept="application/json,.json"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) onImportJson(file)
                  event.target.value = ''
                }}
              />
              <button className="settings-action" type="button" onClick={() => jsonInputRef.current?.click()}>
                <FileJson size={19} aria-hidden="true" />
                <span><strong>Import schemaVersion 3 JSON</strong><small>For validated English Recall lesson packs.</small></span>
                <Upload size={16} aria-hidden="true" />
              </button>
            </details>
          </div>
        </section>

        <section className="settings-section" aria-labelledby="data-settings-title">
          <div className="settings-section-heading">
            <span><Database size={18} aria-hidden="true" /></span>
            <div><h2 id="data-settings-title">Data</h2><p>Move learner data between browser profiles.</p></div>
          </div>
          <div className="settings-inline-actions">
            <input
              ref={backupInputRef}
              className="visually-hidden"
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) onRestoreBackup(file)
                event.target.value = ''
              }}
            />
            <button className="button secondary compact" type="button" onClick={onExportBackup}>Export backup</button>
            <button className="button secondary compact" type="button" onClick={() => backupInputRef.current?.click()}>Restore backup</button>
          </div>
        </section>

        <section className="settings-section" aria-labelledby="diagnostics-settings-title">
          <div className="settings-section-heading">
            <span><Database size={18} aria-hidden="true" /></span>
            <div><h2 id="diagnostics-settings-title">Diagnostics</h2><p>Local-only technical events, separate from learner backup.</p></div>
          </div>
          <div className="settings-inline-actions">
            <button className="button secondary compact" type="button" onClick={onExportDiagnostics}>
              <Download size={15} aria-hidden="true" /> Export Diagnostics JSON
            </button>
            <button
              className="button secondary compact"
              type="button"
              aria-expanded={confirmDiagnosticsClear}
              aria-controls="diagnostic-clear-confirmation"
              onClick={() => setConfirmDiagnosticsClear(true)}
            >
              <Trash2 size={15} aria-hidden="true" /> Clear Diagnostics
            </button>
            {confirmDiagnosticsClear ? (
              <div className="diagnostic-clear-confirmation" id="diagnostic-clear-confirmation" role="alert">
                <span>Clear local diagnostics?</span>
                <button className="button secondary compact" type="button" onClick={() => setConfirmDiagnosticsClear(false)}>Cancel</button>
                <button
                  className="button danger compact"
                  type="button"
                  onClick={() => {
                    onClearDiagnostics()
                    setConfirmDiagnosticsClear(false)
                  }}
                >
                  Clear
                </button>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </AppFrame>
  )
}

function ToggleSetting({
  label,
  description,
  checked,
  onChange,
}: {
  readonly label: string
  readonly description: string
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
}) {
  return (
    <button
      className="settings-toggle"
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span><strong>{label}</strong><small>{description}</small></span>
      <span className="switch-track" aria-hidden="true"><span /></span>
    </button>
  )
}
