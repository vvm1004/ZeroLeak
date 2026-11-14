"""Deterministic paired channel simulations for offline research, not physical recordings."""
import hashlib
import subprocess
import wave
from pathlib import Path

CONDITIONS = ('clean', 'phone8k', 'room_noise15db')


def decode_pcm(path):
    import numpy as np
    raw = subprocess.check_output(['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-i', str(path),
        '-t', '5', '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'], timeout=30)
    return np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768.


def write_pcm(path, values):
    import numpy as np
    values = np.asarray(values)
    if values.ndim != 1 or not 8000 <= len(values) <= 80000 or not np.isfinite(values).all(): raise ValueError('Invalid audio')
    pcm = np.round(np.clip(values, -1, 1) * 32767).astype('<i2').tobytes()
    with wave.open(str(path), 'wb') as out:
        out.setnchannels(1); out.setsampwidth(2); out.setframerate(16000); out.writeframes(pcm)


def transform(values, condition, origin_id, temporary):
    import numpy as np
    if condition not in CONDITIONS: raise ValueError('Unknown condition')
    if condition == 'clean': return values.copy()
    temporary = Path(temporary)
    source = temporary / 'channel-input.wav'
    write_pcm(source, values)
    if condition == 'phone8k':
        encoded = temporary / 'phone-mulaw.wav'
        subprocess.run(['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(source),
            '-af', 'highpass=f=300,lowpass=f=3400', '-ar', '8000', '-c:a', 'pcm_mulaw', str(encoded)], check=True, timeout=30)
        return decode_pcm(encoded)[:len(values)]
    # A fixed small echo train plus band limitation and seeded 15dB white noise.
    echoed = values.copy()
    for delay, gain in [(640, .22), (1440, .12), (3040, .06)]:
        echoed[delay:] += gain * values[:-delay]
    filtered = temporary / 'room-filtered.wav'
    write_pcm(source, echoed)
    subprocess.run(['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(source),
        '-af', 'highpass=f=180,lowpass=f=6000', '-c:a', 'pcm_s16le', str(filtered)], check=True, timeout=30)
    out = decode_pcm(filtered)[:len(values)]
    seed = int(hashlib.sha256(('voice-v3-room:' + origin_id).encode()).hexdigest()[:16], 16)
    noise = np.random.default_rng(seed).normal(size=len(out))
    noise = noise / max(float(np.sqrt(np.mean(noise ** 2))), 1e-9)
    scale = float(np.sqrt(np.mean(out ** 2))) / (10 ** (15 / 20))
    return np.clip(out + noise * scale, -1, 1).astype(np.float32)
