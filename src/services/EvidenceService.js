import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';

class EvidenceServiceClass {
  recording = null;
  locations = [];
  startedAt = null;
  chunkStartedAt = null;
  sessionId = null;
  chunkIndex = 0;
  operation = Promise.resolve();

  async start() {
    return this._queue(async () => {
      if (this.recording) return;
      const permission = await Audio.requestPermissionsAsync();
      if (permission.status !== 'granted') throw new Error('Microphone permission not granted');
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      this.sessionId = this.sessionId || String(Date.now());
      this.startedAt = this.startedAt || new Date().toISOString();
      this.locations = this.locations || [];
      await this._startChunk();
    });
  }

  addLocation(location) {
    if (!this.startedAt || !location) return;
    this.locations.push({ ...location, timestamp: new Date().toISOString() });
    this.locations = this.locations.slice(-100);
  }

  async _startChunk() {
    const result = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.LOW_QUALITY);
    this.recording = result.recording;
    this.chunkStartedAt = new Date().toISOString();
  }

  async _finishChunk(endSession) {
    if (!this.recording || !this.sessionId) return null;
    let audioUri = '';
    await this.recording.stopAndUnloadAsync().catch(() => {});
    const source = this.recording.getURI();
    if (source) {
      const folder = `${FileSystem.documentDirectory}evidence/`;
      await FileSystem.makeDirectoryAsync(folder, { intermediates: true });
      audioUri = `${folder}sos-${this.sessionId}-${this.chunkIndex}.m4a`;
      await FileSystem.copyAsync({ from: source, to: audioUri });
      const files = (await FileSystem.readDirectoryAsync(folder)).sort().reverse();
      await Promise.all(files.slice(360).map(file => FileSystem.deleteAsync(`${folder}${file}`, { idempotent: true })));
    }
    const endedAt = new Date().toISOString();
    const evidence = { id: `${this.sessionId}-${this.chunkIndex}`, sessionId: this.sessionId, chunkIndex: this.chunkIndex,
      startedAt: this.chunkStartedAt, sessionStartedAt: this.startedAt, endedAt, audioUri, locations: [...this.locations] };
    this.recording = null;
    this.chunkIndex += 1;
    if (endSession) {
      this.locations = []; this.startedAt = null; this.chunkStartedAt = null; this.sessionId = null; this.chunkIndex = 0;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
    } else {
      await this._startChunk();
    }
    return evidence;
  }

  async rotate() {
    return this._queue(() => this._finishChunk(false));
  }

  async stop() {
    return this._queue(() => this._finishChunk(true));
  }

  _queue(task) {
    const next = this.operation.then(task, task);
    this.operation = next.catch(() => {});
    return next;
  }

  async clear() {
    await this.stop().catch(() => null);
    await FileSystem.deleteAsync(`${FileSystem.documentDirectory}evidence/`, { idempotent: true });
  }
}

export const EvidenceService = new EvidenceServiceClass();
