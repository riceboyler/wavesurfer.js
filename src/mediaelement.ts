import WebAudio from "./webaudio";
import * as util from "./util";
import { WavesurferParams, Peaks } from "wavesurfer";

interface MediaListeners {
    error: () => void;
    canplay: () => void;
    ended: () => void;
    play: () => void;
    pause: () => void;
    seeked: () => void;
    volumechange: () => void;
}

/**
 * MediaElement backend
 */
export default class MediaElement extends WebAudio {
    private media: HTMLMediaElement;
    private mediaType: "audio" | "video";
    private elementPosition: number;
    private volume: number;
    private isMuted: boolean;
    private _onPlayEnd: (time: number) => void;
    private mediaListeners: MediaListeners;

    /**
     * Construct the backend
     *
     * @param {WavesurferParams} params Wavesurfer parameters
     */
    constructor(params: WavesurferParams) {
        super(params);
        this.params = params;
        this.mediaType = params.mediaType || "audio";
        this.elementPosition = params.elementPosition || 0;
        this.peaks = [];
        this.playbackRate = 1;
        this.volume = 1;
        this.isMuted = false;
        this.buffer = null;
    }

    /**
     * Initialise the backend, called in `wavesurfer.createBackend()`
     */
    init() {
        this.setPlaybackRate(this.params.audioRate);
        this.createTimer();
    }

    /**
     * Attach event listeners to media element.
     */
    _setupMediaListeners() {
        this.mediaListeners.error = () => {
            this.fireEvent("error", "Error loading media element");
        };
        this.mediaListeners.canplay = () => {
            this.fireEvent("canplay");
        };
        this.mediaListeners.ended = () => {
            this.fireEvent("finish");
        };
        // listen to and relay play, pause and seeked events to enable
        // playback control from the external media element
        this.mediaListeners.play = () => {
            this.fireEvent("play");
        };
        this.mediaListeners.pause = () => {
            this.fireEvent("pause");
        };
        this.mediaListeners.seeked = () => {
            this.fireEvent("seek");
        };
        this.mediaListeners.volumechange = () => {
            if (this.media != null) {
                this.isMuted = this.media.muted;
                if (this.isMuted) {
                    this.volume = 0;
                } else {
                    this.volume = this.media.volume;
                }
            }
            this.fireEvent("volume");
        };

        // reset event listeners
        Object.keys(this.mediaListeners).forEach((id) => {
            if (this.media != null) {
                this.media.removeEventListener(id, this.mediaListeners[id]);
                this.media.addEventListener(id, this.mediaListeners[id]);
            }
        });
    }

    /**
     * Create a timer to provide a more precise `audioprocess` event.
     */
    createTimer() {
        const onAudioProcess = () => {
            if (this.isPaused()) {
                return;
            }
            this.fireEvent("audioprocess", this.getCurrentTime());

            // Call again in the next frame
            util.frame(onAudioProcess)();
        };

        this.on("play", onAudioProcess);

        // Update the progress one more time to prevent it from being stuck in
        // case of lower framerates
        this.on("pause", () => {
            this.fireEvent("audioprocess", this.getCurrentTime());
        });
    }

    /**
     * Create media element with url as its source,
     * and append to container element.
     *
     * @param {string} url Path to media file
     * @param {HTMLElement} container HTML element
     * @param {number[]|Number.<Array[]>} peaks Array of peak data
     * @param {string} preload HTML 5 preload attribute value
     * @throws Will throw an error if the `url` argument is not a valid media
     * element.
     */
    public loadME(
        url: string,
        container: HTMLElement,
        peaks: number[] | number[][],
        preload: string
    ) {
        const media = document.createElement(this.mediaType);
        media.controls = Boolean(this.params.mediaControls);
        media.autoplay = this.params.autoplay || false;
        media.preload = preload == null ? "auto" : preload;
        media.src = url;
        media.style.width = "100%";

        const prevMedia = container.querySelector(this.mediaType);
        if (prevMedia) {
            container.removeChild(prevMedia);
        }
        container.appendChild(media);

        this._load(media, peaks);
    }

    /**
     * Load existing media element.
     *
     * @param {HTMLMediaElement} elt HTML5 Audio or Video element
     * @param {number[]|Number.<Array[]>} peaks Array of peak data
     */
    public loadElt(elt: HTMLMediaElement, peaks: number[] | number[][]) {
        elt.controls = Boolean(this.params.mediaControls);
        elt.autoplay = this.params.autoplay || false;

        this._load(elt, peaks);
    }

    /**
     * Method called by both `load` (from url)
     * and `loadElt` (existing media element) methods.
     *
     * @param {HTMLMediaElement} media HTML5 Audio or Video element
     * @param {number[]|Number.<Array[]>} peaks Array of peak data
     * @throws Will throw an error if the `media` argument is not a valid media
     * element.
     * @private
     */
    private _load(media: HTMLMediaElement, peaks: Peaks) {
        // verify media element is valid
        if (
            !(media instanceof HTMLMediaElement) ||
            typeof media.addEventListener === "undefined"
        ) {
            throw new Error("media parameter is not a valid media element");
        }

        // load must be called manually on iOS, otherwise peaks won't draw
        // until a user interaction triggers load --> 'ready' event
        if (typeof media.load == "function") {
            // Resets the media element and restarts the media resource. Any
            // pending events are discarded. How much media data is fetched is
            // still affected by the preload attribute.
            media.load();
        }

        this.media = media;
        this._setupMediaListeners();
        this.peaks = peaks;
        this.buffer = null;
        this.isMuted = media.muted;
        this.setPlaybackRate(this.playbackRate);
        this.setVolume(this.volume);
    }

    /**
     * Used by `wavesurfer.isPlaying()` and `wavesurfer.playPause()`
     *
     * @return {boolean} Media paused or not
     */
    isPaused(): boolean {
        return !this.media || this.media.paused;
    }

    /**
     * Used by `wavesurfer.getDuration()`
     *
     * @return {number} Duration
     */
    getDuration(): number {
        if (this.explicitDuration) {
            return this.explicitDuration;
        }
        if (this.media) {
            let duration = (this.buffer || this.media).duration;
            if (duration >= Infinity) {
                // streaming audio
                duration = this.media.seekable.end(0);
            }
            return duration;
        }
        return 0;
    }

    /**
     * Returns the current time in seconds relative to the audio-clip's
     * duration.
     *
     * @return {number} Current time
     */
    getCurrentTime(): number {
        return this.media?.currentTime ?? 0;
    }

    /**
     * Get the position from 0 to 1
     *
     * @return {number} Current position
     */
    getPlayedPercents() {
        return this.getCurrentTime() / this.getDuration() || 0;
    }

    /**
     * Get the audio source playback rate.
     *
     * @return {number} Playback rate
     */
    getPlaybackRate(): number {
        return this.playbackRate || (this.media?.playbackRate ?? 1);
    }

    /**
     * Set the audio source playback rate.
     *
     * @param {number} value Playback rate
     */
    setPlaybackRate(value: number) {
        this.playbackRate = value || 1;
        this.media.playbackRate = this.playbackRate;
    }

    /**
     * Used by `wavesurfer.seekTo()`
     *
     * @param {number} start Position to start at in seconds
     */
    seekTo(start?: number, end?: number) {
        if (start == null) {
            start = 0;
        }
        if (end == null) {
            end = 0;
        }

        this.media.currentTime = start ?? 0;
        this.clearPlayEnd();
        return { start, end };
    }

    /**
     * Plays the loaded audio region.
     *
     * @param {number} start Start offset in seconds, relative to the beginning
     * of a clip.
     * @param {number} end When to stop, relative to the beginning of a clip.
     * @emits MediaElement#play
     * @return {Promise} Result
     */
    play(start: number, end?: number): Promise<void> {
        this.seekTo(start);
        const promise = this.media.play();
        end && this.setPlayEnd(end);

        return promise;
    }

    /**
     * Pauses the loaded audio.
     *
     * @emits MediaElement#pause
     */
    pause() {
        if (this.media) {
            this.media.pause();
        }
        this.clearPlayEnd();
    }

    /**
     * Set the play end
     *
     * @param {number} end Where to end
     */
    setPlayEnd(end: number) {
        this.clearPlayEnd();

        this._onPlayEnd = (time) => {
            if (time >= end) {
                this.pause();
                this.seekTo(end);
            }
        };
        this.on("audioprocess", this._onPlayEnd);
    }

    private clearPlayEnd() {
        if (this._onPlayEnd) {
            this.un("audioprocess", this._onPlayEnd);
        }
    }

    /**
     * Compute the max and min value of the waveform when broken into
     * <length> subranges.
     *
     * @param {number} length How many subranges to break the waveform into.
     * @param {number} first First sample in the required range.
     * @param {number} last Last sample in the required range.
     * @return {number[]|Number.<Array[]>} Array of 2*<length> peaks or array of
     * arrays of peaks consisting of (max, min) values for each subrange.
     */
    getPeaks(length: number, first: number, last: number): Peaks {
        if (this.buffer) {
            return super.getPeaks(length, first, last);
        }
        return this.peaks || [];
    }

    /**
     * Set the sink id for the media player
     *
     * @param {string} deviceId String value representing audio device id.
     * @returns {Promise} A Promise that resolves to `undefined` when there
     * are no errors.
     */
    setSinkId(deviceId: string): Promise<undefined> {
        if (deviceId) {
            if (!this.media.setSinkId) {
                return Promise.reject(
                    new Error("setSinkId is not supported in your browser")
                );
            }
            return this.media.setSinkId(deviceId);
        }

        return Promise.reject(new Error("Invalid deviceId: " + deviceId));
    }

    /**
     * Get the current volume
     */
    getVolume(): number {
        return this.volume;
    }

    /**
     * Set the audio volume
     *
     * @param {number} value A floating point value between 0 and 1.
     */
    setVolume(value: number) {
        this.volume = value;
        // no need to change when it's already at that volume
        if (this.media.volume !== this.volume) {
            this.media.volume = this.volume;
        }
    }

    /**
     * This is called when wavesurfer is destroyed
     *
     */
    destroy() {
        this.pause();
        this.unAll();
        this.destroyed = true;

        // cleanup media event listeners
        Object.keys(this.mediaListeners).forEach((id) => {
            if (this.media) {
                this.media.removeEventListener(id, this.mediaListeners[id]);
            }
        });

        if (
            this.params.removeMediaElementOnDestroy &&
            this.media &&
            this.media.parentNode
        ) {
            this.media.parentNode.removeChild(this.media);
        }
    }
}
