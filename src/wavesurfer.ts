import * as util from "./util";
import Drawer from "./drawer";
import MultiCanvas from "./drawer.multicanvas";
import WebAudio from "./webaudio";
import MediaElement from "./mediaelement";
import PeakCache from "./peakcache";
import MediaElementWebAudio from "./mediaelement-webaudio";

/*
 * This work is licensed under a BSD-3-Clause License.
 */

/** @external {HTMLElement} https://developer.mozilla.org/en/docs/Web/API/HTMLElement */
/** @external {OfflineAudioContext} https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext */
/** @external {File} https://developer.mozilla.org/en-US/docs/Web/API/File */
/** @external {Blob} https://developer.mozilla.org/en-US/docs/Web/API/Blob */
/** @external {CanvasRenderingContext2D} https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D */
/** @external {MediaStreamConstraints} https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamConstraints */
/** @external {AudioNode} https://developer.mozilla.org/de/docs/Web/API/AudioNode */

export interface WavesurferParams {
    audioContext?: AudioContext;
    audioRate: number;
    audioScriptProcessor?: ScriptProcessorNode;
    autoCenter?: boolean;
    autoCenterRate?: number;
    autoCenterImmediately?: boolean;
    backend: "WebAudio" | "MediaElement" | "MediaElementWebAudio";
    backgroundColor?: string;
    barHeight?: number;
    barRadius?: number;
    barGap?: number | null;
    barWidth?: number | null;
    barMinHeight?: number | null;
    closeAudioContext?: boolean;
    container: string | HTMLElement;
    cursorColor?: string;
    cursorWidth?: number;
    dragSelection?: boolean;
    drawingContextAttributes?: {
        desynchronized: boolean;
    };
    duration?: number;
    fillParent?: boolean;
    forceDecode?: boolean;
    height?: number;
    hideScrollbar?: boolean;
    interact?: boolean;
    loopSelection?: boolean;
    maxCanvasWidth?: number;
    mediaContainer?: string | HTMLElement;
    mediaControls?: boolean;
    mediaType?: "audio" | "video";
    minPxPerSec?: number;
    normalize?: boolean;
    partialRender?: boolean;
    pixelRatio?: number;
    plugins?: PluginDefinition[];
    progressColor?: string;
    removeMediaElementOnDestroy?: boolean;
    renderer?: () => Drawer | null;
    responsive?: boolean | number;
    rtl?: boolean;
    scrollParent?: boolean;
    skipLength?: number;
    splitChannels?: boolean;
    splitChannelsOptions?: {
        overlay?: boolean;
        channelColors: {};
        filterChannels: any[];
    };
    waveColor?: string;
    xhr?: {
        cache?: string;
        mode?: string;
        method?: "GET" | "POST";
        credentials?: string;
        redirect?: string;
        referrer?: string;
        headers?: {
            key: string;
            value: string;
        }[];
    };
}

interface PluginDefinition {
    name: string;
    staticProps?: {};
    deferInit?: boolean;
    params?: {};
    instance: PluginClass;
}

class PluginClass {
    protected key?: string;
    constructor(params: {}, ws: WaveSurfer) {}
    create(params: {}) {}
    init() {}
    destroy() {}
}

/**
 * WaveSurfer core library class
 *
 * @extends {Observer}
 * @example
 * const params = {
 *   container: '#waveform',
 *   waveColor: 'violet',
 *   progressColor: 'purple'
 * };
 *
 * // initialise like this
 * const wavesurfer = WaveSurfer.create(params);
 *
 * // or like this ...
 * const wavesurfer = new WaveSurfer(params);
 * wavesurfer.init();
 *
 * // load audio file
 * wavesurfer.load('example/media/demo.wav');
 */
export default class WaveSurfer extends util.Observer {
    private defaultParams: WavesurferParams = {
        audioContext: undefined,
        audioScriptProcessor: undefined,
        audioRate: 1,
        autoCenter: true,
        autoCenterRate: 5,
        autoCenterImmediately: false,
        backend: "WebAudio",
        backgroundColor: "",
        barHeight: 1,
        barRadius: 0,
        barGap: null,
        barMinHeight: null,
        container: "",
        cursorColor: "#333",
        cursorWidth: 1,
        dragSelection: true,
        drawingContextAttributes: {
            // Boolean that hints the user agent to reduce the latency
            // by desynchronizing the canvas paint cycle from the event
            // loop
            desynchronized: false,
        },
        duration: 0,
        fillParent: true,
        forceDecode: false,
        height: 128,
        hideScrollbar: false,
        interact: true,
        loopSelection: true,
        maxCanvasWidth: 4000,
        mediaContainer: "",
        mediaControls: false,
        mediaType: "audio",
        minPxPerSec: 20,
        normalize: false,
        partialRender: false,
        pixelRatio: window.devicePixelRatio,
        plugins: [],
        progressColor: "#555",
        removeMediaElementOnDestroy: true,
        renderer: MultiCanvas,
        responsive: false,
        rtl: false,
        scrollParent: false,
        skipLength: 2,
        splitChannels: false,
        splitChannelsOptions: {
            overlay: false,
            channelColors: {},
            filterChannels: [],
        },
        waveColor: "#999",
        xhr: {},
    };

    private backends = {
        MediaElement,
        WebAudio,
        MediaElementWebAudio,
    };

    //#region local variables
    private params: WavesurferParams;
    protected container: HTMLElement | null;
    protected mediaContainer: HTMLElement | null;
    private savedVolume: number;
    private isMuted: boolean;
    private tmpEvents: any[];
    private currentRequest: util.Observer | null;
    private arraybuffer;
    private drawer;
    private backend;
    private peakCache;
    private Drawer: (
        container: HTMLElement | null,
        params: WavesurferParams
    ) => void;
    private Backend: MediaElement | WebAudio | MediaElementWebAudio;
    private initialisedPluginList: {};
    private isDestroyed: boolean;
    private isReady: boolean;
    private _onResize: () => void;
    //#endregion

    static create(params: WavesurferParams): WaveSurfer {
        const wavesurfer = new WaveSurfer(params);
        return wavesurfer.init();
    }

    util: {} = util;
    static util: {} = util;

    /**
     * Initialise wavesurfer instance
     *
     * @param {WavesurferParams} params Instantiation options for wavesurfer
     * @example
     * const wavesurfer = new WaveSurfer(params);
     * @returns {this} Wavesurfer instance
     */
    constructor(params: WavesurferParams) {
        super();
        /**
         * Extract relevant parameters (or defaults)
         * @private
         */
        this.params = Object.assign({}, this.defaultParams, params);

        this.container =
            typeof this.params.container === "string"
                ? document.querySelector(this.params.container)
                : this.params.container;

        if (this.container === null) {
            throw new Error("Container element not found");
        }

        if (this.params.mediaContainer == null) {
            this.mediaContainer = this.container;
        } else if (typeof this.params.mediaContainer == "string") {
            this.mediaContainer = document.querySelector(
                this.params.mediaContainer
            );
        } else {
            this.mediaContainer = this.params.mediaContainer;
        }

        if (!this.mediaContainer) {
            throw new Error("Media Container element not found");
        }

        if (this.params.maxCanvasWidth) {
            if (this.params.maxCanvasWidth <= 1) {
                throw new Error("maxCanvasWidth must be greater than 1");
            } else if (this.params.maxCanvasWidth % 2 === 1) {
                throw new Error("maxCanvasWidth must be an even number");
            }
        }

        if (this.params.rtl === true) {
            util.style(this.container, { transform: "rotateY(180deg)" });
        }

        if (this.params.backgroundColor) {
            this.setBackgroundColor(this.params.backgroundColor);
        }

        this.savedVolume = 0;
        this.isMuted = false;
        this.tmpEvents = [];
        this.currentRequest = null;
        this.arraybuffer = null;
        this.drawer = null;
        this.backend = null;
        this.peakCache = null;
        this.initialisedPluginList = {};
        this.isDestroyed = false;
        this.isReady = false;

        // cache constructor objects
        if (typeof this.params.renderer !== "function") {
            throw new Error("Renderer parameter is invalid");
        }
        this.Drawer = this.params.renderer;

        if (
            (this.params.backend == "WebAudio" ||
                this.params.backend === "MediaElementWebAudio") &&
            !WebAudio.prototype.supportsWebAudio.call(null)
        ) {
            this.params.backend = "MediaElement";
        }
        this.Backend = this.backends[this.params.backend];

        // responsive debounced event listener. If this.params.responsive is not
        // set, this is never called. Use 100ms or this.params.responsive as
        // timeout for the debounce function.
        let prevWidth = 0;
        this._onResize = util.debounce(
            () => {
                if (
                    prevWidth != this.drawer.wrapper.clientWidth &&
                    !this.params.scrollParent
                ) {
                    prevWidth = this.drawer.wrapper.clientWidth;
                    this.drawer.fireEvent("redraw");
                }
            },
            typeof this.params.responsive === "number"
                ? this.params.responsive
                : 100
        );

        return this;
    }

    /**
     * Initialise the wave
     *
     * @example
     * var wavesurfer = new WaveSurfer(params);
     * wavesurfer.init();
     */
    init(): WaveSurfer {
        this.registerPlugins(this.params.plugins);
        this.createDrawer();
        this.createBackend();
        this.createPeakCache();
        return this;
    }

    // #region Plugins

    /**
     * Add and initialise array of plugins (if `plugin.deferInit` is falsey),
     * this function is called in the init function of wavesurfer
     */
    registerPlugins(plugins: PluginDefinition[] | undefined): WaveSurfer {
        // first instantiate all the plugins
        if (plugins && plugins.length) {
            plugins.forEach((plugin) => this.addPlugin(plugin));

            // now run the init functions
            plugins.forEach((plugin) => {
                // call init function of the plugin if deferInit is falsey
                // in that case you would manually use initPlugins()
                if (!plugin.deferInit) {
                    this.initPlugin(plugin.name);
                }
            });
        }
        this.fireEvent("plugins-registered", plugins);
        return this;
    }

    /**
     * Get a map of plugin names that are currently initialised
     *
     * @example wavesurfer.getPlugins();
     */
    getActivePlugins(): {} {
        return this.initialisedPluginList;
    }

    /**
     * Add a plugin object to wavesurfer
     *
     * @example wavesurfer.addPlugin(WaveSurfer.minimap());
     */
    addPlugin(plugin: PluginDefinition): WaveSurfer {
        if (!plugin.name) {
            throw new Error("Plugin does not have a name!");
        }
        if (!plugin.instance) {
            throw new Error(
                `Plugin ${plugin.name} does not have an instance property!`
            );
        }

        // staticProps properties are applied to wavesurfer instance
        if (plugin.staticProps) {
            Object.keys(plugin.staticProps).forEach((pluginStaticProp) => {
                /**
                 * Properties defined in a plugin definition's `staticProps` property are added as
                 * staticProps properties of the WaveSurfer instance
                 */
                if (plugin.staticProps) {
                    this[pluginStaticProp] =
                        plugin.staticProps[pluginStaticProp];
                }
            });
        }

        const Instance = plugin.instance;

        // turn the plugin instance into an observer
        const observerPrototypeKeys = Object.getOwnPropertyNames(
            util.Observer.prototype
        );
        observerPrototypeKeys.forEach((key) => {
            Instance[key] = util.Observer.prototype[key];
        });

        /**
         * Instantiated plugin classes are added as a property of the wavesurfer
         * instance
         * @type {Object}
         */
        this[plugin.name] = new PluginClass(plugin.params || {}, this);
        this.fireEvent("plugin-added", plugin.name);
        return this;
    }

    /**
     * Initialise a plugin
     *
     * @example wavesurfer.initPlugin('minimap');
     */
    initPlugin(name: string): WaveSurfer {
        if (!this[name]) {
            throw new Error(`Plugin ${name} has not been added yet!`);
        }
        if (this.initialisedPluginList[name]) {
            // destroy any already initialised plugins
            this.destroyPlugin(name);
        }
        this[name].init();
        this.initialisedPluginList[name] = true;
        this.fireEvent("plugin-initialised", name);
        return this;
    }

    /**
     * Destroy a plugin
     *
     * @example wavesurfer.destroyPlugin('minimap');
     */
    destroyPlugin(name: string): WaveSurfer {
        if (!this[name]) {
            throw new Error(
                `Plugin ${name} has not been added yet and cannot be destroyed!`
            );
        }
        if (!this.initialisedPluginList[name]) {
            throw new Error(
                `Plugin ${name} is not active and cannot be destroyed!`
            );
        }
        if (typeof this[name].destroy !== "function") {
            throw new Error(`Plugin ${name} does not have a destroy function!`);
        }

        this[name].destroy();
        delete this.initialisedPluginList[name];
        this.fireEvent("plugin-destroyed", name);
        return this;
    }

    private destroyAllPlugins() {
        Object.keys(this.initialisedPluginList).forEach((name) =>
            this.destroyPlugin(name)
        );
    }

    // #endregion Plugins

    private createDrawer() {
        this.drawer = new this.Drawer(this.container, this.params);
        this.drawer.init();
        this.fireEvent("drawer-created", this.drawer);

        if (this.params.responsive !== false) {
            window.addEventListener("resize", this._onResize, true);
            window.addEventListener("orientationchange", this._onResize, true);
        }

        this.drawer.on("redraw", () => {
            this.drawBuffer();
            this.drawer.progress(this.backend.getPlayedPercents());
        });

        // Click-to-seek
        this.drawer.on("click", (e: Event, progress: number) => {
            setTimeout(() => this.seekTo(progress), 0);
        });

        // Relay the scroll event from the drawer
        this.drawer.on("scroll", (e) => {
            if (this.params.partialRender) {
                this.drawBuffer();
            }
            this.fireEvent("scroll", e);
        });
    }

    private createBackend() {
        if (this.backend) {
            this.backend.destroy();
        }

        this.backend = new this.Backend(this.params);
        this.backend.init();
        this.fireEvent("backend-created", this.backend);

        this.backend.on("finish", () => {
            this.drawer.progress(this.backend.getPlayedPercents());
            this.fireEvent("finish");
        });
        this.backend.on("play", () => this.fireEvent("play"));
        this.backend.on("pause", () => this.fireEvent("pause"));

        this.backend.on("audioprocess", (time: number) => {
            this.drawer.progress(this.backend.getPlayedPercents());
            this.fireEvent("audioprocess", time);
        });

        // only needed for MediaElement and MediaElementWebAudio backend
        if (
            this.params.backend === "MediaElement" ||
            this.params.backend === "MediaElementWebAudio"
        ) {
            this.backend.on("seek", () => {
                this.drawer.progress(this.backend.getPlayedPercents());
            });

            this.backend.on("volume", () => {
                const newVolume = this.getVolume();
                this.fireEvent("volume", newVolume);

                if (this.backend.isMuted !== this.isMuted) {
                    this.isMuted = this.backend.isMuted;
                    this.fireEvent("mute", this.isMuted);
                }
            });
        }
    }

    private createPeakCache() {
        if (this.params.partialRender) {
            this.peakCache = new PeakCache();
        }
    }

    /**
     * Get the duration of the audio clip
     *
     * @example const duration = wavesurfer.getDuration();
     */
    public getDuration(): number {
        return this.backend.getDuration();
    }

    /**
     * Get the current playback position
     *
     * @example const currentTime = wavesurfer.getCurrentTime();
     */
    public getCurrentTime(): number {
        return this.backend.getCurrentTime();
    }

    public setCurrentTime(seconds: number) {
        if (seconds >= this.getDuration()) {
            this.seekTo(1);
        } else {
            this.seekTo(seconds / this.getDuration());
        }
    }

    /**
     * Starts playback from the current position. Optional start and end
     * measured in seconds can be used to set the range of audio to play.
     *
     * @example
     * // play from second 1 to 5
     * wavesurfer.play(1, 5);
     */
    public play(start?: number, end?: number): Promise<any> {
        this.fireEvent("interaction", () => this.play(start, end));
        return this.backend.play(start, end);
    }

    /**
     * Set a point in seconds for playback to stop at.
     * @version 3.3.0
     */
    public setPlayEnd(position: number) {
        this.backend.setPlayEnd(position);
    }

    /**
     * Stops and pauses playback
     *
     * @example wavesurfer.pause();
     */
    public pause(): Promise<any> {
        if (!this.backend.isPaused()) {
            return this.backend.pause();
        }
        return new Promise((res) => res);
    }

    /**
     * Toggle playback
     *
     * @example wavesurfer.playPause();
     * @return {Promise} Result of the backend play or pause method
     */
    public playPause(): Promise<any> {
        return this.backend.isPaused() ? this.play() : this.pause();
    }

    /**
     * Get the current playback state
     *
     * @example const isPlaying = wavesurfer.isPlaying();
     */
    public isPlaying(): boolean {
        return !this.backend.isPaused();
    }

    /**
     * Skip backward
     *
     * @example wavesurfer.skipBackward();
     */
    public skipBackward(seconds?: number) {
        this.skip(-(seconds || this.params.skipLength || 0));
    }

    /**
     * Skip forward
     *
     * @example wavesurfer.skipForward();
     */
    public skipForward(seconds?: number) {
        this.skip(seconds || this.params.skipLength || 0);
    }

    /**
     * Skip a number of seconds from the current position (use a negative value
     * to go backwards).
     *
     * @example
     * // go back 2 seconds
     * wavesurfer.skip(-2);
     */
    public skip(offset: number) {
        const duration = this.getDuration() || 1;
        let position = this.getCurrentTime() || 0;
        position = Math.max(0, Math.min(duration, position + (offset || 0)));
        this.seekAndCenter(position / duration);
    }

    /**
     * Seeks to a position and centers the view
     *
     * @example
     * // seek and go to the middle of the audio
     * wavesurfer.seekTo(0.5);
     */
    public seekAndCenter(progress: number) {
        this.seekTo(progress);
        this.drawer.recenter(progress);
    }

    /**
     * Seeks to a position
     *
     * @param {number} progress Between 0 (=beginning) and 1 (=end)
     * @emits WaveSurfer#interaction
     * @emits WaveSurfer#seek
     * @example
     * // seek to the middle of the audio
     * wavesurfer.seekTo(0.5);
     */
    public seekTo(progress: number) {
        // return an error if progress is not a number between 0 and 1
        if (!isFinite(progress) || progress < 0 || progress > 1) {
            throw new Error(
                "Error calling wavesurfer.seekTo, parameter must be a number between 0 and 1!"
            );
        }
        this.fireEvent("interaction", () => this.seekTo(progress));

        const paused = this.backend.isPaused();
        // avoid draw wrong position while playing backward seeking
        if (!paused) {
            this.backend.pause();
        }
        // avoid small scrolls while paused seeking
        const oldScrollParent = this.params.scrollParent;
        this.params.scrollParent = false;
        this.backend.seekTo(progress * this.getDuration());
        this.drawer.progress(progress);

        if (!paused) {
            this.backend.play();
        }
        this.params.scrollParent = oldScrollParent;
        this.fireEvent("seek", progress);
    }

    /**
     * Stops and goes to the beginning.
     *
     * @example wavesurfer.stop();
     */
    public stop() {
        this.pause();
        this.seekTo(0);
        this.drawer.progress(0);
    }

    /**
     * Sets the ID of the audio device to use for output and returns a Promise
     */
    public setSinkId(deviceId: string): Promise<any> {
        return this.backend.setSinkId(deviceId);
    }

    public setVolume(newVolume: number) {
        this.backend.setVolume(newVolume);
        this.fireEvent("volume", newVolume);
    }

    public getVolume(): number {
        return this.backend.getVolume();
    }

    public setPlaybackRate(rate: number) {
        this.backend.setPlaybackRate(rate);
    }

    public getPlaybackRate(): number {
        return this.backend.getPlaybackRate();
    }

    public toggleMute() {
        this.setMute(!this.isMuted);
    }

    /**
     * Enable or disable muted audio
     *
     * @param {boolean} mute Specify `true` to mute audio.
     * @emits WaveSurfer#volume
     * @emits WaveSurfer#mute
     * @example
     * // unmute
     * wavesurfer.setMute(false);
     * console.log(wavesurfer.getMute()) // logs false
     */
    public setMute(mute: boolean) {
        // ignore all muting requests if the audio is already in that state
        if (mute === this.isMuted) {
            this.fireEvent("mute", this.isMuted);
            return;
        }

        if (mute) {
            // If currently not muted then save current volume,
            // turn off the volume and update the mute properties
            this.savedVolume = this.backend.getVolume();
            this.backend.setVolume(0);
            this.isMuted = true;
            this.fireEvent("volume", 0);
        } else {
            // If currently muted then restore to the saved volume
            // and update the mute properties
            this.backend.setVolume(this.savedVolume);
            this.isMuted = false;
            this.fireEvent("volume", this.savedVolume);
        }
        this.fireEvent("mute", this.isMuted);
    }

    /**
     * Get the current mute status.
     *
     * @example const isMuted = wavesurfer.getMute();
     */
    public getMute(): boolean {
        return this.isMuted;
    }

    /**
     * Get the list of current set filters as an array.
     * Filters must be set with setFilters method first
     */
    public getFilters(): any[] {
        return this.backend.filters || [];
    }

    /**
     * Toggles `scrollParent` and redraws
     *
     * @example wavesurfer.toggleScroll();
     */
    public toggleScroll() {
        this.params.scrollParent = !this.params.scrollParent;
        this.drawBuffer();
    }

    /**
     * Toggle mouse interaction
     *
     * @example wavesurfer.toggleInteraction();
     */
    public toggleInteraction() {
        this.params.interact = !this.params.interact;
    }

    /**
     * Get the fill color of the waveform after the cursor.
     */
    public getWaveColor(): string {
        return this.params.waveColor || "";
    }

    /**
     * Set the fill color of the waveform after the cursor.
     *
     * @example wavesurfer.setWaveColor('#ddd');
     */
    public setWaveColor(color: string) {
        this.params.waveColor = color;
        this.drawBuffer();
    }

    /**
     * Get the fill color of the waveform behind the cursor.
     *
     * @return {string} A CSS color string.
     */
    public getProgressColor(): string {
        return this.params.progressColor || "";
    }

    /**
     * Set the fill color of the waveform behind the cursor.
     *
     * @example wavesurfer.setProgressColor('#400');
     */
    public setProgressColor(color: string) {
        this.params.progressColor = color;
        this.drawBuffer();
    }

    /**
     * Get the background color of the waveform container.
     */
    public getBackgroundColor(): string {
        return this.params.backgroundColor || "";
    }

    /**
     * Set the background color of the waveform container.
     *
     * @example wavesurfer.setBackgroundColor('#FF00FF');
     */
    public setBackgroundColor(color: string) {
        this.params.backgroundColor = color;
        if (this.container) {
            util.style(this.container, {
                background: this.params.backgroundColor,
            });
        }
    }

    /**
     * Get the fill color of the cursor indicating the playhead
     * position.
     */
    public getCursorColor(): string {
        return this.params.cursorColor || "";
    }

    /**
     * Set the fill color of the cursor indicating the playhead
     * position.
     *
     * @example wavesurfer.setCursorColor('#222');
     */
    public setCursorColor(color: string) {
        this.params.cursorColor = color;
        this.drawer.updateCursor();
    }

    /**
     * Get the height of the waveform.
     */
    public getHeight(): number {
        return this.params.height || 0;
    }

    /**
     * Set the height of the waveform.
     *
     * @example wavesurfer.setHeight(200);
     */
    public setHeight(height: number) {
        this.params.height = height;
        this.drawer.setHeight(height * (this.params.pixelRatio ?? 1));
        this.drawBuffer();
    }

    /**
     * Hide channels from being drawn on the waveform if splitting channels.
     *
     * @example
     * const wavesurfer = new WaveSurfer.create({...splitChannels: true});
     * wavesurfer.load('stereo_audio.mp3');
     *
     * wavesurfer.setFilteredChannel([0]); <-- hide left channel peaks.
     *
     * @param {array} channelIndices Channels to be filtered out from drawing.
     * @version 4.0.0
     */
    public setFilteredChannels(channelIndices: any[]) {
        if (this.params.splitChannelsOptions) {
            this.params.splitChannelsOptions.filterChannels = channelIndices;
        }
        this.drawBuffer();
    }

    /**
     * Get the correct peaks for current wave view-port and render wave
     */
    private drawBuffer() {
        const nominalWidth = Math.round(
            this.getDuration() *
                (this.params.minPxPerSec ?? 1) *
                (this.params.pixelRatio ?? 1)
        );
        const parentWidth = this.drawer.getWidth();
        let width = nominalWidth;
        // always start at 0 after zooming for scrolling : issue redraw left part
        let start = 0;
        let end = Math.max(start + parentWidth, width);
        // Fill container
        if (
            this.params.fillParent &&
            (!this.params.scrollParent || nominalWidth < parentWidth)
        ) {
            width = parentWidth;
            start = 0;
            end = width;
        }

        let peaks;
        if (this.params.partialRender) {
            const newRanges = this.peakCache.addRangeToPeakCache(
                width,
                start,
                end
            );
            for (let i = 0; i < newRanges.length; i++) {
                peaks = this.backend.getPeaks(
                    width,
                    newRanges[i][0],
                    newRanges[i][1]
                );
                this.drawer.drawPeaks(
                    peaks,
                    width,
                    newRanges[i][0],
                    newRanges[i][1]
                );
            }
        } else {
            peaks = this.backend.getPeaks(width, start, end);
            this.drawer.drawPeaks(peaks, width, start, end);
        }
        this.fireEvent("redraw", peaks, width);
    }

    /**
     * Horizontally zooms the waveform in and out. It also changes the parameter
     * `minPxPerSec` and enables the `scrollParent` option. Calling the function
     * with a falsey parameter will reset the zoom state.
     *
     * @param {?number} pxPerSec Number of horizontal pixels per second of
     * audio, if none is set the waveform returns to unzoomed state
     * @example wavesurfer.zoom(20);
     */
    public zoom(pxPerSec?: number) {
        if (!pxPerSec) {
            this.params.minPxPerSec = this.defaultParams.minPxPerSec;
            this.params.scrollParent = false;
        } else {
            this.params.minPxPerSec = pxPerSec;
            this.params.scrollParent = true;
        }

        this.drawBuffer();
        this.drawer.progress(this.backend.getPlayedPercents());

        this.drawer.recenter(this.getCurrentTime() / this.getDuration());
        this.fireEvent("zoom", pxPerSec);
    }

    /**
     * Decode buffer and load
     */
    private loadArrayBuffer(arraybuffer: ArrayBuffer) {
        this.decodeArrayBuffer(arraybuffer, (data: AudioBuffer) => {
            if (!this.isDestroyed) {
                this.loadDecodedBuffer(data);
            }
        });
    }

    /**
     * Directly load an externally decoded AudioBuffer
     */
    private loadDecodedBuffer(buffer: AudioBuffer) {
        this.backend.load(buffer);
        this.drawBuffer();
        this.isReady = true;
        this.fireEvent("ready");
    }

    /**
     * Loads audio data from a Blob or File object
     */
    public loadBlob(blob: Blob | File) {
        // Create file reader
        const reader = new FileReader();
        reader.addEventListener("progress", (e: ProgressEvent<FileReader>) =>
            this.onProgress(e)
        );
        reader.addEventListener("load", (e: ProgressEvent<FileReader>) => {
            if (e.target && e.target.result != null) {
                this.loadArrayBuffer(e.target.result as ArrayBuffer);
            }
        });
        reader.addEventListener("error", () =>
            this.fireEvent("error", "Error reading file")
        );
        reader.readAsArrayBuffer(blob);
        this.empty();
    }

    /**
     * Loads audio and re-renders the waveform.
     *
     * @param {string|HTMLMediaElement} url The url of the audio file or the
     * audio element with the audio
     * @param {number[]|Number.<Array[]>} peaks Wavesurfer does not have to decode
     * the audio to render the waveform if this is specified
     * @param {?string} preload (Use with backend `MediaElement` and `MediaElementWebAudio`)
     * `'none'|'metadata'|'auto'` Preload attribute for the media element
     * @param {?number} duration The duration of the audio. This is used to
     * render the peaks data in the correct size for the audio duration (as
     * befits the current `minPxPerSec` and zoom value) without having to decode
     * the audio.
     * @example
     * // uses fetch or media element to load file (depending on backend)
     * wavesurfer.load('http://example.com/demo.wav');
     *
     * // setting preload attribute with media element backend and supplying
     * // peaks
     * wavesurfer.load(
     *   'http://example.com/demo.wav',
     *   [0.0218, 0.0183, 0.0165, 0.0198, 0.2137, 0.2888],
     *   true
     * );
     */
    public load(
        url: string | HTMLMediaElement,
        peaks?: number[],
        preload?: string,
        duration?: number
    ) {
        if (url === "") {
            throw new Error("url parameter cannot be empty");
        }
        this.empty();
        if (preload && preload !== "") {
            // check whether the preload attribute will be usable and if not log
            // a warning listing the reasons why not and nullify the variable
            const preloadIgnoreReasons = {
                "Preload is not 'auto', 'none' or 'metadata'":
                    ["auto", "metadata", "none"].indexOf(preload) === -1,
                "Peaks are not provided": !peaks,
                "Backend is not of type 'MediaElement' or 'MediaElementWebAudio'":
                    ["MediaElement", "MediaElementWebAudio"].indexOf(
                        this.params.backend
                    ) === -1,
                "Url is not of type string": typeof url !== "string",
            };
            const activeReasons = Object.keys(preloadIgnoreReasons).filter(
                (reason) => preloadIgnoreReasons[reason]
            );
            if (activeReasons.length) {
                // eslint-disable-next-line no-console
                console.warn(
                    `Preload parameter of wavesurfer.load will be ignored because:\n\t-
                        ${activeReasons.join("\n\t- ")}`
                );
                // stop invalid values from being used
                preload = "";
            }
        }

        switch (this.params.backend) {
            case "WebAudio":
                return this.loadBuffer(url, peaks, duration);
            case "MediaElement":
            case "MediaElementWebAudio":
                return this.loadMediaElement(url, peaks, preload, duration);
        }
    }

    /**
     * Loads audio using Web Audio buffer backend.
     */
    private loadBuffer(
        url: string | HTMLElement,
        peaks?: number[],
        duration?: number
    ) {
        const load = (action?: () => void) => {
            if (action) {
                this.tmpEvents.push(this.once("ready", action));
            }
            return this.getArrayBuffer(url, (data: ArrayBuffer) =>
                this.loadArrayBuffer(data)
            );
        };

        if (peaks && peaks.length) {
            this.backend.setPeaks(peaks, duration);
            this.drawBuffer();
            this.tmpEvents.push(this.once("interaction", load));
        } else {
            return load();
        }
    }

    /**
     * Either create a media element, or load an existing media element.
     *
     * @param {string|HTMLMediaElement} urlOrElt Either a path to a media file, or an
     * existing HTML5 Audio/Video Element
     * @param {number[]|Number.<Array[]>} peaks Array of peaks. Required to bypass web audio
     * dependency
     * @param {?boolean} preload Set to true if the preload attribute of the
     * audio element should be enabled
     * @param {?number} duration Optional duration of audio file
     */
    private loadMediaElement(
        urlOrElt: string | HTMLMediaElement,
        peaks?: number[],
        preload?: string,
        duration?: number
    ) {
        let url: string;

        if (typeof urlOrElt === "string") {
            url = urlOrElt;
            this.backend.load(url, this.mediaContainer, peaks, preload);
        } else {
            const elt = urlOrElt;
            this.backend.loadElt(elt, peaks);

            // If peaks are not provided,
            // url = element.src so we can get peaks with web audio
            url = elt.src;
        }

        this.tmpEvents.push(
            this.backend.once("canplay", () => {
                // ignore when backend was already destroyed
                if (!this.backend.destroyed) {
                    this.drawBuffer();
                    this.isReady = true;
                    this.fireEvent("ready");
                }
            }),
            this.backend.once("error", (err: Error) =>
                this.fireEvent("error", err)
            )
        );

        // If no pre-decoded peaks provided or pre-decoded peaks are
        // provided with forceDecode flag, attempt to download the
        // audio file and decode it with Web Audio.
        if (peaks) {
            this.backend.setPeaks(peaks, duration);
        }

        if (
            (!peaks || this.params.forceDecode) &&
            this.backend.supportsWebAudio()
        ) {
            this.getArrayBuffer(url, (arraybuffer) => {
                this.decodeArrayBuffer(arraybuffer, (buffer) => {
                    this.backend.buffer = buffer;
                    this.backend.setPeaks(null);
                    this.drawBuffer();
                    this.fireEvent("waveform-ready");
                });
            });
        }
    }

    /**
     * Decode an array buffer and pass data to a callback
     *
     * @param {Object} arraybuffer The array buffer to decode
     * @param {function} callback The function to call on complete
     */
    private decodeArrayBuffer(
        arraybuffer: ArrayBuffer,
        callback: (data?: any) => void
    ) {
        this.arraybuffer = arraybuffer;
        this.backend.decodeArrayBuffer(
            arraybuffer,
            // TODO: Determine type for data returned
            (data) => {
                // Only use the decoded data if we haven't been destroyed or
                // another decode started in the meantime
                if (!this.isDestroyed && this.arraybuffer === arraybuffer) {
                    callback(data);
                    this.arraybuffer = null;
                }
            },
            () => this.fireEvent("error", "Error decoding audiobuffer")
        );
    }

    /**
     * Load an array buffer using fetch and pass the result to a callback
     *
     * @param {string} url The URL of the file object
     * @param {function} callback The function to call on complete
     */
    private getArrayBuffer(
        url: string | HTMLElement,
        callback: (data?: any) => void
    ): util.Observer {
        const options = Object.assign(
            {
                url: url,
                responseType: "arraybuffer",
            },
            this.params.xhr
        );
        const request = util.fetchFile(options);

        this.currentRequest = request;

        this.tmpEvents.push(
            request.on("progress", (e: ProgressEvent) => {
                this.onProgress(e);
            }),
            // TODO: Determine type of data
            request.on("success", (data) => {
                callback(data);
                this.currentRequest = null;
            }),
            request.on("error", (e: ErrorEvent) => {
                this.fireEvent("error", e);
                this.currentRequest = null;
            })
        );

        return request;
    }

    /**
     * Called while the audio file is loading
     *
     */
    private onProgress(e: ProgressEvent<any>) {
        let percentComplete;
        if (e.lengthComputable) {
            percentComplete = e.loaded / e.total;
        } else {
            // Approximate progress with an asymptotic
            // function, and assume downloads in the 1-3 MB range.
            percentComplete = e.loaded / (e.loaded + 1000000);
        }
        this.fireEvent("loading", Math.round(percentComplete * 100), e.target);
    }

    /**
     * Exports PCM data into a JSON array and opens in a new window.
     *
     * @param {number} length=1024 The scale in which to export the peaks
     * @param {number} accuracy=10000
     * @param {?boolean} noWindow Set to true to disable opening a new
     * window with the JSON
     * @param {number} start Start index
     * @param {number} end End index
     */
    public exportPCM(
        length: number,
        accuracy: number,
        noWindow?: boolean,
        start?: number,
        end?: number
    ): Promise<string> {
        length = length || 1024;
        start = start || 0;
        accuracy = accuracy || 10000;
        noWindow = noWindow || false;
        const peaks = this.backend.getPeaks(length, start, end);
        const arr = [].map.call(
            peaks,
            (val) => Math.round(val * accuracy) / accuracy
        );
        return new Promise((resolve, reject) => {
            const json = JSON.stringify(arr);

            if (!noWindow) {
                window.open(
                    "data:application/json;charset=utf-8," +
                        encodeURIComponent(json)
                );
            }
            resolve(json);
        });
    }

    /**
     * Save waveform image as data URI.
     *
     * The default format is `'image/png'`. Other supported types are
     * `'image/jpeg'` and `'image/webp'`.
     *
     * @param {string} format='image/png' A string indicating the image format.
     * The default format type is `'image/png'`.
     * @param {number} quality=1 A number between 0 and 1 indicating the image
     * quality to use for image formats that use lossy compression such as
     * `'image/jpeg'`` and `'image/webp'`.
     * @param {string} type Image data type to return. Either 'dataURL' (default)
     * or 'blob'.
     * @return {string|string[]|Promise} When using `'dataURL'` type this returns
     * a single data URL or an array of data URLs, one for each canvas. When using
     * `'blob'` type this returns a `Promise` resolving with an array of `Blob`
     * instances, one for each canvas.
     */
    public exportImage(
        format: string,
        quality: number,
        type: "dataURL" | "blob"
    ): string | string[] | Promise<string | string[]> {
        if (!format) {
            format = "image/png";
        }
        if (!quality) {
            quality = 1;
        }
        if (!type) {
            type = "dataURL";
        }

        return this.drawer.getImage(format, quality, type);
    }

    /**
     * Cancel any fetch request currently in progress
     */
    public cancelAjax() {
        if (this.currentRequest && this.currentRequest.controller) {
            this.currentRequest.controller.abort();
            this.currentRequest = null;
        }
    }

    private clearTmpEvents() {
        this.tmpEvents.forEach((e) => e.un());
    }

    /**
     * Display empty waveform.
     */
    public empty() {
        if (!this.backend.isPaused()) {
            this.stop();
            this.backend.disconnectSource();
        }
        this.isReady = false;
        this.cancelAjax();
        this.clearTmpEvents();

        // empty drawer
        this.drawer.progress(0);
        this.drawer.setWidth(0);
        this.drawer.drawPeaks({ length: this.drawer.getWidth() }, 0);
    }

    /**
     * Remove events, elements and disconnect WebAudio nodes.
     *
     * @emits WaveSurfer#destroy
     */
    public destroy() {
        this.destroyAllPlugins();
        this.fireEvent("destroy");
        this.cancelAjax();
        this.clearTmpEvents();
        this.unAll();
        if (this.params.responsive !== false) {
            window.removeEventListener("resize", this._onResize, true);
            window.removeEventListener(
                "orientationchange",
                this._onResize,
                true
            );
        }
        if (this.backend) {
            this.backend.destroy();
        }
        if (this.drawer) {
            this.drawer.destroy();
        }
        this.isDestroyed = true;
        this.isReady = false;
        this.arraybuffer = null;
    }
}
