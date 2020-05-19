import * as util from "./util";
import { WavesurferParams } from "./wavesurfer";

// using constants to prevent someone writing the string wrong
enum States {
    PLAYING = "playing",
    PAUSED = "paused",
    FINISHED = "finished",
}

interface StateBehavior {
    init: () => void;
    getPlayedPercents: () => number;
    getCurrentTime: () => number;
}

interface StateBehaviors {
    [States.PLAYING]: StateBehavior;
    [States.PAUSED]: StateBehavior;
    [States.FINISHED]: StateBehavior;
}

export default class WebAudio extends util.Observer {
    private ac: AudioContext;
    private offlineAc: OfflineAudioContext;
    private params: WavesurferParams;
    private lastPlay: number;
    private startPosition: number;
    private scheduledPause: null | number;
    private states: {
        [States.PLAYING]: {};
        [States.PAUSED]: {};
        [States.FINISHED]: {};
    };
    private buffer;
    private filters: any[];
    private gainNode: GainNode;
    private mergedPeaks: number[];
    private peaks: number[] | null;
    private playbackRate: number;
    private analyser: AnalyserNode;
    private scriptNode: ScriptProcessorNode;
    private source;
    private splitPeaks: number[] | number[][];
    private state;
    private explicitDuration: number;
    private destroyed: boolean;

    /** scriptBufferSize: size of the processing buffer */
    static scriptBufferSize = 256;
    /** audioContext: allows to process audio with WebAudio API */
    private offlineAudioContext = null;

    generateStateBehavior = (state: States) => {
        let init: () => void;
        let getPlayedPercents: () => number;
        let getCurrentTime: () => number;
        switch (state) {
            case States.PLAYING:
                init = () => {
                    this.addOnAudioProcess();
                };
                getPlayedPercents = () => {
                    const duration = this.getDuration();
                    return this.getCurrentTime() / duration || 0;
                };
                getCurrentTime = () => {
                    return this.startPosition + this.getPlayedTime();
                };
                break;
            case States.PAUSED:
                init = () => {
                    this.removeOnAudioProcess();
                };
                getPlayedPercents = () => {
                    const duration = this.getDuration();
                    return this.getCurrentTime() / duration || 0;
                };
                getCurrentTime = () => this.startPosition;
                break;
            case States.FINISHED:
                init = () => {
                    this.removeOnAudioProcess();
                    this.fireEvent("finish");
                };
                getPlayedPercents = () => 1;
                getCurrentTime = () => this.getDuration();
                break;
        }
        return {
            init,
            getPlayedPercents,
            getCurrentTime,
        };
    };

    /**
     * Construct the backend
     */
    constructor(params: WavesurferParams) {
        super();
        this.params = params;
        /** ac: Audio Context instance */
        this.ac = params.audioContext || this.getAudioContext();
        this.lastPlay = this.ac.currentTime;
        this.startPosition = 0;
        this.scheduledPause = null;
        this.states = {
            [States.PLAYING]: Object.create(
                this.generateStateBehavior[States.PLAYING]
            ),
            [States.PAUSED]: Object.create(
                this.generateStateBehavior[States.PAUSED]
            ),
            [States.FINISHED]: Object.create(
                this.generateStateBehavior[States.FINISHED]
            ),
        };
        this.buffer = null;
        this.filters = [];
        /** gainNode: allows to control audio volume */
        this.peaks = null;
        this.playbackRate = 1;
        this.source = null;
        this.splitPeaks = [];
        this.state = null;
        this.explicitDuration = params.duration || 0;
        /**
         * Boolean indicating if the backend was destroyed.
         */
        this.destroyed = false;
    }

    /**
     * Does the browser support this backend
     */
    public supportsWebAudio(): boolean {
        return Boolean(window.AudioContext);
    }

    /**
     * Get the audio context used by this backend or create one
     *
     * @return {AudioContext} Existing audio context, or creates a new one
     */
    public getAudioContext(): AudioContext {
        if (!this.ac) {
            this.ac = new window.AudioContext();
        }
        return this.ac;
    }

    /**
     * Get the offline audio context used by this backend or create one
     *
     * @param {number} sampleRate The sample rate to use
     * @return {OfflineAudioContext} Existing offline audio context, or creates
     * a new one
     */
    public getOfflineAudioContext(sampleRate: number): OfflineAudioContext {
        if (!this.offlineAc) {
            this.offlineAc = new window.OfflineAudioContext(1, 2, sampleRate);
        }
        return this.offlineAc;
    }

    /**
     * Initialise the backend, called in `wavesurfer.createBackend()`
     */
    public init() {
        this.createVolumeNode();
        this.createScriptNode();
        this.createAnalyserNode();

        this.setState(States.PAUSED);
        this.setPlaybackRate(this.params.audioRate);
        this.setLength(0);
    }

    private disconnectFilters() {
        if (this.filters && this.filters.length) {
            this.filters.forEach((filter) => {
                filter && filter.disconnect();
            });
            this.filters = [];
            // Reconnect direct path
            this.analyser.connect(this.gainNode);
        }
    }

    private setState(state: States) {
        if (this.state !== this.states[state]) {
            this.state = this.states[state];
            this.state.init.call(this);
        }
    }

    /**
     * Unpacked `setFilters()`
     */
    public setFilter(...filters: AudioNode[]) {
        this.setFilters(filters);
    }

    /**
     * Insert custom Web Audio nodes into the graph
     *
     * @example
     * const lowpass = wavesurfer.backend.ac.createBiquadFilter();
     * wavesurfer.backend.setFilter(lowpass);
     */
    public setFilters(filters: AudioNode[]) {
        // Remove existing filters
        this.disconnectFilters();

        // Insert filters if filter array not empty
        if (filters && filters.length) {
            this.filters = filters;

            // Disconnect direct path before inserting filters
            this.analyser.disconnect();

            // Connect each filter in turn
            filters
                .reduce((acc, curr) => {
                    acc.connect(curr);
                    return curr;
                }, this.analyser)
                .connect(this.gainNode);
        }
    }
    /** Create ScriptProcessorNode to process audio */
    public createScriptNode() {
        if (this.params.audioScriptProcessor) {
            this.scriptNode = this.params.audioScriptProcessor;
        } else {
            if (this.ac.createScriptProcessor) {
                this.scriptNode = this.ac.createScriptProcessor(
                    WebAudio.scriptBufferSize
                );
            }
        }
        this.scriptNode.connect(this.ac.destination);
    }

    public addOnAudioProcess() {
        this.scriptNode.onaudioprocess = () => {
            const time = this.getCurrentTime();

            if (time >= this.getDuration()) {
                this.setState(States.FINISHED);
                this.fireEvent("pause");
            } else if (time >= (this.scheduledPause ?? 0)) {
                this.pause();
            } else if (this.state === this.states[States.PLAYING]) {
                this.fireEvent("audioprocess", time);
            }
        };
    }

    public removeOnAudioProcess() {
        this.scriptNode.onaudioprocess = () => {};
    }

    /** Create analyser node to perform audio analysis */
    public createAnalyserNode() {
        this.analyser = this.ac.createAnalyser();
        this.analyser.connect(this.gainNode);
    }

    /**
     * Create the gain node needed to control the playback volume.
     *
     */
    public createVolumeNode() {
        // Create gain node using the AudioContext
        if (this.ac.createGain) {
            this.gainNode = this.ac.createGain();
        }
        // Add the gain node to the graph
        this.gainNode.connect(this.ac.destination);
    }

    /**
     * Set the sink id for the media player
     */
    public setSinkId(deviceId: string): Promise<undefined> {
        if (deviceId) {
            /**
             * The webaudio API doesn't currently support setting the device
             * output. Here we create an HTMLAudioElement, connect the
             * webaudio stream to that element and setSinkId there.
             */
            let audio = new window.Audio();
            if (!audio.setSinkId) {
                return Promise.reject(
                    new Error("setSinkId is not supported in your browser")
                );
            }
            audio.autoplay = true;
            var dest = this.ac.createMediaStreamDestination();
            this.gainNode.disconnect();
            this.gainNode.connect(dest);
            audio.srcObject = dest.stream;

            return audio.setSinkId(deviceId);
        } else {
            return Promise.reject(new Error("Invalid deviceId: " + deviceId));
        }
    }

    /**
     * Set the audio volume
     *
     * @param {number} value A floating point value between 0 and 1.
     */
    public setVolume(value: number) {
        this.gainNode.gain.setValueAtTime(value, this.ac.currentTime);
    }

    /**
     * Get the current volume
     */
    public getVolume(): number {
        return this.gainNode.gain.value;
    }

    /**
     * Decode an array buffer and pass data to a callback
     */
    public decodeArrayBuffer(
        arraybuffer: ArrayBuffer,
        callback: (data: AudioBuffer) => void,
        errback: () => void
    ) {
        if (!this.offlineAc) {
            this.offlineAc = this.getOfflineAudioContext(
                this.ac && this.ac.sampleRate ? this.ac.sampleRate : 44100
            );
        }
        this.offlineAc.decodeAudioData(
            arraybuffer,
            (data) => callback(data),
            errback
        );
    }

    /**
     * Set pre-decoded peaks
     */
    public setPeaks(peaks: number[], duration?: number) {
        if (duration != null) {
            this.explicitDuration = duration;
        }
        this.peaks = peaks;
    }

    /**
     * Set the rendered length (different from the length of the audio)
     *
     * @param {number} length The rendered length
     */
    public setLength(length: number) {
        // No resize, we can preserve the cached peaks.
        if (this.mergedPeaks && length == 2 * this.mergedPeaks.length - 1 + 2) {
            return;
        }

        this.splitPeaks = [];
        this.mergedPeaks = [];
        // Set the last element of the sparse array so the peak arrays are
        // appropriately sized for other calculations.
        const channels = this.buffer ? this.buffer.numberOfChannels : 1;
        for (let c = 0; c < channels; c++) {
            this.splitPeaks[c] = [];
            this.splitPeaks[c][2 * (length - 1)] = 0;
            this.splitPeaks[c][2 * (length - 1) + 1] = 0;
        }
        this.mergedPeaks[2 * (length - 1)] = 0;
        this.mergedPeaks[2 * (length - 1) + 1] = 0;
    }

    /**
     * Compute the max and min value of the waveform when broken into <length> subranges.
     *
     * @param {number} length How many subranges to break the waveform into.
     * @param {number} first First sample in the required range.
     * @param {number} last Last sample in the required range.
     * @return {number[]|Number.<Array[]>} Array of 2*<length> peaks or array of arrays of
     * peaks consisting of (max, min) values for each subrange.
     */
    public getPeaks(
        length: number,
        first: number,
        last: number
    ): number[] | number[][] {
        if (this.peaks) {
            return this.peaks;
        }
        if (!this.buffer) {
            return [];
        }

        first = first || 0;
        last = last || length - 1;

        this.setLength(length);

        if (!this.buffer) {
            return this.params.splitChannels
                ? this.splitPeaks
                : this.mergedPeaks;
        }

        const sampleSize = this.buffer.length / length;
        const sampleStep = ~~(sampleSize / 10) || 1;
        const channels = this.buffer.numberOfChannels;

        for (let c = 0; c < channels; c++) {
            const peaks = this.splitPeaks[c];
            const chan = this.buffer.getChannelData(c);

            for (let i = first; i <= last; i++) {
                const start = ~~(i * sampleSize);
                const end = ~~(start + sampleSize);
                /**
                 * Initialize the max and min to the first sample of this
                 * subrange, so that even if the samples are entirely
                 * on one side of zero, we still return the true max and
                 * min values in the subrange.
                 */
                let min = chan[start];
                let max = min;

                for (let j = start; j < end; j += sampleStep) {
                    const value = chan[j];

                    if (value > max) {
                        max = value;
                    }

                    if (value < min) {
                        min = value;
                    }
                }

                peaks[2 * i] = max;
                peaks[2 * i + 1] = min;

                if (c == 0 || max > this.mergedPeaks[2 * i]) {
                    this.mergedPeaks[2 * i] = max;
                }

                if (c == 0 || min < this.mergedPeaks[2 * i + 1]) {
                    this.mergedPeaks[2 * i + 1] = min;
                }
            }
        }

        return this.params.splitChannels ? this.splitPeaks : this.mergedPeaks;
    }

    /**
     * Get the position from 0 to 1
     */
    public getPlayedPercents(): number {
        return this.state.getPlayedPercents.call(this);
    }

    private disconnectSource() {
        if (this.source) {
            this.source.disconnect();
        }
    }
    /**
     * Destroy all references with WebAudio, disconnecting audio nodes and closing Audio Context
     */
    public async destroyWebAudio() {
        this.disconnectFilters();
        this.disconnectSource();
        this.gainNode.disconnect();
        this.scriptNode.disconnect();
        this.analyser.disconnect();

        // close the audioContext if closeAudioContext option is set to true
        if (this.params.closeAudioContext) {
            // check if browser supports AudioContext.close()
            if (
                typeof this.ac.close === "function" &&
                this.ac.state != "closed"
            ) {
                this.ac.close();
            }
            // clear the reference to the audiocontext
            await this.ac.close();
            // clear the actual audiocontext, either passed as param or the
            // global singleton

            await this.params.audioContext?.close();
        }
    }
    /**
     * This is called when wavesurfer is destroyed
     */
    public destroy() {
        if (!this.isPaused()) {
            this.pause();
        }
        this.unAll();
        this.buffer = null;
        this.destroyed = true;

        this.destroyWebAudio();
    }

    /**
     * Loaded a decoded audio buffer
     */
    public load(buffer: AudioBuffer) {
        this.startPosition = 0;
        this.lastPlay = this.ac.currentTime;
        this.buffer = buffer;
        this.createSource();
    }

    private createSource() {
        this.disconnectSource();
        this.source = this.ac.createBufferSource();

        // adjust for old browsers
        this.source.start = this.source.start || this.source.noteGrainOn;
        this.source.stop = this.source.stop || this.source.noteOff;

        this.source.playbackRate.setValueAtTime(
            this.playbackRate,
            this.ac.currentTime
        );
        this.source.buffer = this.buffer;
        this.source.connect(this.analyser);
    }

    /**
     * Used by `wavesurfer.isPlaying()` and `wavesurfer.playPause()`
     */
    public isPaused(): boolean {
        return this.state !== this.states[States.PLAYING];
    }

    /**
     * Used by `wavesurfer.getDuration()`
     */
    public getDuration(): number {
        if (this.explicitDuration) {
            return this.explicitDuration;
        }
        if (!this.buffer) {
            return 0;
        }
        return this.buffer.duration;
    }

    /**
     * Used by `wavesurfer.seekTo()`
     *
     */
    public seekTo(
        start?: number,
        end?: number
    ): { start: number; end: number } {
        if (!this.buffer) {
            return { start: 0, end: 0 };
        }

        let innerStart = start || 0;
        if (start === null || start === undefined) {
            innerStart =
                this.getCurrentTime() >= this.getDuration()
                    ? 0
                    : this.getCurrentTime();
        }

        this.scheduledPause = null;

        if (end == null) {
            end = this.getDuration();
        }

        this.startPosition = innerStart;
        this.lastPlay = this.ac.currentTime;

        if (this.state === this.states[States.FINISHED]) {
            this.setState(States.PAUSED);
        }

        return {
            start: innerStart,
            end,
        };
    }

    /**
     * Get the playback position in seconds
     */
    public getPlayedTime(): number {
        return (this.ac.currentTime - this.lastPlay) * this.playbackRate;
    }

    /**
     * Plays the loaded audio region.
     *
     * @param {number} start Start offset in seconds, relative to the beginning
     * of a clip.
     * @param {number} end When to stop relative to the beginning of a clip.
     */
    public play(start?: number, end?: number) {
        if (!this.buffer) {
            return;
        }

        // need to re-create source on each playback
        this.createSource();

        const adjustedTime = this.seekTo(start, end);

        start = adjustedTime.start;
        end = adjustedTime.end;

        this.scheduledPause = end;

        this.source.start(0, start);

        if (this.ac.state == "suspended") {
            this.ac.resume && this.ac.resume();
        }

        this.setState(States.PLAYING);

        this.fireEvent("play");
    }

    /**
     * Pauses the loaded audio.
     */
    public pause() {
        this.scheduledPause = null;

        this.startPosition += this.getPlayedTime();
        this.source && this.source.stop(0);

        this.setState(States.PAUSED);

        this.fireEvent("pause");
    }

    /**
     * Returns the current time in seconds relative to the audio-clip's
     * duration.
     */
    public getCurrentTime(): number {
        return this.state.getCurrentTime.call(this);
    }

    /**
     * Returns the current playback rate. (0=no playback, 1=normal playback)
     */
    public getPlaybackRate(): number {
        return this.playbackRate;
    }

    /**
     * Set the audio source playback rate.
     */
    public setPlaybackRate(value: number) {
        value = value || 1;
        if (this.isPaused()) {
            this.playbackRate = value;
        } else {
            this.pause();
            this.playbackRate = value;
            this.play();
        }
    }

    /**
     * Set a point in seconds for playback to stop at.
     * @version 3.3.0
     */
    public setPlayEnd(end: number) {
        this.scheduledPause = end;
    }
}
