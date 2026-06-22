import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.openchamber.app',
  appName: 'OpenChamber',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    Keyboard: {
      // 'none' leaves the WebView at full height; the UI follows the keyboard
      // itself via the --oc-keyboard-inset CSS variable driven by keyboardWillShow
      // (see useNativeMobileChrome). The built-in 'native' resize lands only after
      // the keyboard animation finishes, which looked like a ~1.5s lag.
      resize: 'none',
      resizeOnFullScreen: true,
      autoBackdropColor: 'dom',
    },
    StatusBar: {
      overlaysWebView: true,
      style: 'DEFAULT',
    },
  },
};

export default config;
