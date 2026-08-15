import { App as NativeApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { useEffect, useRef } from 'react'

/**
 * Registers one Android hardware-back listener. Returning false from the
 * callback means app navigation is already at its root and the app may exit.
 */
export function useAndroidBackButton(onBack: () => boolean | Promise<boolean>) {
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return

    let disposed = false
    let removeListener: (() => Promise<void>) | undefined
    void NativeApp.addListener('backButton', async () => {
      if (!(await onBackRef.current())) await NativeApp.exitApp()
    }).then((handle) => {
      if (disposed) void handle.remove()
      else removeListener = () => handle.remove()
    })

    return () => {
      disposed = true
      if (removeListener) void removeListener()
    }
  }, [])
}
