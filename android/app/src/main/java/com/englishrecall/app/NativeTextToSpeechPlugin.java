package com.englishrecall.app;

import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

@CapacitorPlugin(name = "NativeTextToSpeech")
public class NativeTextToSpeechPlugin extends Plugin {
    private TextToSpeech textToSpeech;
    private boolean initializationComplete;
    private boolean supported;
    private PendingSpeech pendingSpeech;
    private final List<PluginCall> pendingStatusCalls = new ArrayList<>();

    private static final class PendingSpeech {
        private final PluginCall call;
        private final String text;
        private final float rate;

        private PendingSpeech(PluginCall call, String text, float rate) {
            this.call = call;
            this.text = text;
            this.rate = rate;
        }
    }

    @Override
    public void load() {
        textToSpeech = new TextToSpeech(getContext(), this::handleInitialization);
        textToSpeech.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override
            public void onStart(String utteranceId) {
                emitSpeaking(true);
            }

            @Override
            public void onDone(String utteranceId) {
                emitSpeaking(false);
            }

            @Override
            public void onError(String utteranceId) {
                emitSpeaking(false);
            }

            @Override
            public void onStop(String utteranceId, boolean interrupted) {
                emitSpeaking(false);
            }
        });
    }

    private void handleInitialization(int status) {
        boolean languageAvailable = false;
        if (status == TextToSpeech.SUCCESS && textToSpeech != null) {
            int languageResult = textToSpeech.setLanguage(Locale.US);
            languageAvailable = languageResult != TextToSpeech.LANG_MISSING_DATA &&
                languageResult != TextToSpeech.LANG_NOT_SUPPORTED;
        }

        initializationComplete = true;
        supported = languageAvailable;
        resolvePendingStatusCalls();

        PendingSpeech speech = pendingSpeech;
        pendingSpeech = null;
        if (speech != null) {
            if (supported) performSpeak(speech.call, speech.text, speech.rate);
            else speech.call.reject("An English Android TTS voice is unavailable", "tts-unavailable");
        }
    }

    @PluginMethod
    public void isSupported(PluginCall call) {
        if (!initializationComplete) {
            pendingStatusCalls.add(call);
            return;
        }
        resolveSupported(call);
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text");
        Float rate = call.getFloat("rate", 1.0f);
        if (text == null || text.trim().isEmpty()) {
            call.reject("Text is required", "invalid-text");
            return;
        }

        if (!initializationComplete) {
            if (pendingSpeech != null) {
                pendingSpeech.call.reject("Speech request was replaced", "speech-replaced");
            }
            pendingSpeech = new PendingSpeech(call, text, rate == null ? 1.0f : rate);
            return;
        }
        if (!supported) {
            call.reject("An English Android TTS voice is unavailable", "tts-unavailable");
            return;
        }

        performSpeak(call, text, rate == null ? 1.0f : rate);
    }

    private void performSpeak(PluginCall call, String text, float rate) {
        getActivity().runOnUiThread(() -> {
            if (textToSpeech == null) {
                call.reject("Android TTS is unavailable", "tts-unavailable");
                return;
            }

            float safeRate = Math.max(0.1f, Math.min(2.0f, rate));
            if (textToSpeech.setSpeechRate(safeRate) == TextToSpeech.ERROR) {
                call.reject("Android rejected the speech rate", "invalid-rate");
                return;
            }

            Bundle parameters = new Bundle();
            String utteranceId = UUID.randomUUID().toString();
            int result = textToSpeech.speak(text, TextToSpeech.QUEUE_FLUSH, parameters, utteranceId);
            if (result == TextToSpeech.ERROR) {
                emitSpeaking(false);
                call.reject("Android could not start speech", "speak-failed");
                return;
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (pendingSpeech != null) {
            pendingSpeech.call.reject("Speech was stopped", "speech-stopped");
            pendingSpeech = null;
        }
        if (textToSpeech != null) textToSpeech.stop();
        emitSpeaking(false);
        call.resolve();
    }

    private void resolvePendingStatusCalls() {
        for (PluginCall call : pendingStatusCalls) resolveSupported(call);
        pendingStatusCalls.clear();
    }

    private void resolveSupported(PluginCall call) {
        JSObject result = new JSObject();
        result.put("supported", supported);
        call.resolve(result);
    }

    private void emitSpeaking(boolean speaking) {
        getActivity().runOnUiThread(() -> {
            JSObject state = new JSObject();
            state.put("speaking", speaking);
            notifyListeners("speakingStateChange", state);
        });
    }

    @Override
    protected void handleOnDestroy() {
        if (textToSpeech != null) {
            textToSpeech.stop();
            textToSpeech.shutdown();
            textToSpeech = null;
        }
        super.handleOnDestroy();
    }
}
