import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.englishrecall.app',
  appName: 'English Recall',
  webDir: 'dist',
  backgroundColor: '#070a12',
  android: {
    backgroundColor: '#070a12',
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'css',
      style: 'DARK',
      hidden: false,
    },
  },
}

export default config
