// Create a single AudioContext to be reused. It's initialized in a suspended state by default in modern browsers.
const audioContext = typeof window !== 'undefined' 
  ? new (window.AudioContext || (window as any).webkitAudioContext)() 
  : null;

/**
 * Unlocks the global AudioContext. 
 * This should be called once after the first user interaction (e.g., a click).
 * Modern browsers require user interaction to start or resume an AudioContext.
 */
export const unlockAudioContext = () => {
  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume().catch(e => console.error("AudioContext resume failed:", e));
  }
};

/**
 * Plays a notification sound programmatically using the Web Audio API.
 * This avoids issues with loading external files or corrupted base64 data.
 */
export const playNotificationSound = () => {
  if (!audioContext) {
    console.error("AudioContext not supported by this browser.");
    return;
  }

  // If the context is still suspended, it means the user hasn't interacted with the page yet.
  // We can't play the sound, so we'll just log a warning. The unlockAudioContext function
  // needs to be triggered by a user action.
  if (audioContext.state === 'suspended') {
    console.warn("Cannot play sound: AudioContext is suspended. User must interact with the document first.");
    return;
  }

  try {
    // Create an oscillator (to generate a sound wave) and a gain node (to control volume)
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    // Connect the nodes: oscillator -> gain -> speakers
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // Configure the sound
    oscillator.type = 'sine'; // A smooth, clean tone
    gainNode.gain.setValueAtTime(0.5, audioContext.currentTime); // Start at 50% volume

    // A simple two-tone chime for a pleasant notification
    oscillator.frequency.setValueAtTime(880, audioContext.currentTime); // A5 note
    oscillator.frequency.setValueAtTime(1046.50, audioContext.currentTime + 0.1); // C6 note after 0.1s
    
    // Fade out the sound smoothly over 0.5 seconds
    gainNode.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.5);

    // Start the sound now and stop it after 0.5 seconds
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.5);
  } catch (e) {
    console.error("Error playing sound:", e);
  }
};
