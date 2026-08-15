import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

interface NativeTextToSpeechPlugin {
  isSupported(): Promise<{ readonly supported: boolean }>
  speak(options: { readonly text: string; readonly rate: number }): Promise<void>
  stop(): Promise<void>
  addListener(
    eventName: 'speakingStateChange',
    listener: (state: { readonly speaking: boolean }) => void,
  ): Promise<PluginListenerHandle>
}

export const nativeTextToSpeech = registerPlugin<NativeTextToSpeechPlugin>(
  'NativeTextToSpeech',
)

export function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}
