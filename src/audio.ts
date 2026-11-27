export type Place = "space" | "habitat" | "city";

const FADE_SECONDS = 1.5;

/**
 * Ambient sound, synthesized in the browser: no recordings, no music.
 *
 * Space is close to silent, just a very low two-note drone, since there is
 * nothing out there to carry sound. Inside the station there is air, so a soft
 * band of filtered noise comes in underneath, like distant air handling.
 *
 * Browsers only allow sound after the visitor has clicked or pressed a key, so
 * nothing is created until `start` is called from such an event.
 */
export function createAudio() {
  let context: AudioContext | undefined;
  let master: GainNode | undefined;
  let drone: GainNode | undefined;
  let air: GainNode | undefined;
  let enabled = true;
  let place: Place = "space";

  function levels() {
    if (!context || !master || !drone || !air) return;
    const now = context.currentTime;
    master.gain.setTargetAtTime(enabled ? 1 : 0, now, 0.12);
    drone.gain.setTargetAtTime(place === "space" ? 0.05 : 0.018, now, FADE_SECONDS / 3);
    air.gain.setTargetAtTime(
      place === "space" ? 0 : place === "city" ? 0.026 : 0.02,
      now,
      FADE_SECONDS / 3,
    );
  }

  function awake() {
    if (!context) return;
    if (enabled && !document.hidden) void context.resume();
    else void context.suspend();
  }

  document.addEventListener("visibilitychange", awake);

  return {
    /** Call from a click or key press. Safe to call more than once. */
    start() {
      if (context) {
        awake();
        return;
      }
      const AudioContextClass =
        window.AudioContext ??
        (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      context = new AudioContextClass();
      master = context.createGain();
      master.gain.value = 0;
      master.connect(context.destination);

      drone = context.createGain();
      drone.gain.value = 0;
      const warmth = context.createBiquadFilter();
      warmth.type = "lowpass";
      warmth.frequency.value = 220;
      warmth.connect(drone).connect(master);
      // A low A and the fifth above it, each slightly detuned so they beat.
      for (const [frequency, detune] of [
        [55, -4],
        [55, 5],
        [82.5, 3],
      ]) {
        const tone = context.createOscillator();
        tone.frequency.value = frequency;
        tone.detune.value = detune;
        tone.connect(warmth);
        tone.start();
      }

      air = context.createGain();
      air.gain.value = 0;
      const seconds = 3;
      const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
      const noise = context.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;
      const band = context.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 400;
      band.Q.value = 0.6;
      noise.connect(band).connect(air).connect(master);
      noise.start();

      levels();
      awake();
    },
    setPlace(next: Place) {
      place = next;
      levels();
    },
    setEnabled(on: boolean) {
      enabled = on;
      levels();
      awake();
    },
    /** A short, quiet blip confirming a control was used. */
    tick() {
      if (!context || !master || !enabled) return;
      const now = context.currentTime;
      const blip = context.createOscillator();
      const envelope = context.createGain();
      blip.frequency.value = 1200;
      envelope.gain.setValueAtTime(0.03, now);
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
      blip.connect(envelope).connect(master);
      blip.start(now);
      blip.stop(now + 0.04);
    },
  };
}
