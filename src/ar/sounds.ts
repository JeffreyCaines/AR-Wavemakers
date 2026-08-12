import backButtonUrl from "../audio/Back_button.wav";
import mapPulseUrl from "../audio/Map_pulse_2.wav";
import pinClickUrl from "../audio/Pin_click_2.wav";

export type ArSoundId = "back" | "pin" | "pulse";

const SOUND_URLS: Record<ArSoundId, string> = {
  back: backButtonUrl,
  pin: pinClickUrl,
  pulse: mapPulseUrl,
};

const players = new Map<ArSoundId, HTMLAudioElement>();
let unlocked = false;

function getPlayer(id: ArSoundId): HTMLAudioElement {
  let player = players.get(id);
  if (!player) {
    player = new Audio(SOUND_URLS[id]);
    player.preload = "auto";
    player.loop = false;
    players.set(id, player);
  }
  return player;
}

/** Prefetch clips used by the live map experience. */
export function preloadArSounds(): void {
  (Object.keys(SOUND_URLS) as ArSoundId[]).forEach((id) => {
    getPlayer(id).load();
  });
}

/**
 * Safari/iOS require a user-gesture unlock before audio can play.
 * Call from the first tap/OKAY/start interaction.
 */
export function unlockArSounds(): void {
  if (unlocked) return;
  unlocked = true;
  players.forEach((player) => {
    const wasMuted = player.muted;
    player.muted = true;
    void player
      .play()
      .then(() => {
        player.pause();
        player.currentTime = 0;
        player.muted = wasMuted;
      })
      .catch(() => {
        player.muted = wasMuted;
      });
  });
}

export function playArSound(id: ArSoundId): void {
  const player = getPlayer(id);
  try {
    player.pause();
    player.currentTime = 0;
    void player.play().catch(() => {
      /* Autoplay may still be blocked until unlock. */
    });
  } catch {
    /* ignore */
  }
}

export function stopArSound(id: ArSoundId): void {
  const player = players.get(id);
  if (!player) return;
  player.pause();
  player.currentTime = 0;
}
