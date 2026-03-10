// DMR Experimental WebCodecs Worker
// Based on rtsp2browser client

let wsFallbackPort = '8081';

function log(msg, level = 'info') {
    postMessage({ type: 'log', msg, level });
}

function mergeBuffers(bufs) {
    let merged = new Uint8Array(bufs.reduce((acc, buf) => acc + buf.length, 0));
    let offset = 0;
    for (let buf of bufs) {
        merged.set(buf, offset);
        offset += buf.length;
    }
    return merged;
}

class WebTransportAdapter {
    constructor(url) {
        this.transport = new WebTransport(url);
        this.ready = this.transport.ready;
        this.datagrams = this.transport.datagrams;
    }

    async createBidirectionalStream() {
        return this.transport.createBidirectionalStream();
    }

    close() {
        this.transport.close();
    }
}

class WebSocketAdapter {
    constructor(url) {
        const sessionId = Math.random().toString(36).substring(2, 15);

        const createUrl = (type) => {
            const u = new URL(url);
            u.searchParams.set('session_id', sessionId);
            u.searchParams.set('type', type);
            return u.toString();
        };

        const controlUrl = createUrl('control');
        const dataUrl = createUrl('data');

        log(`Connecting WS Control: ${controlUrl}`);
        log(`Connecting WS Data: ${dataUrl}`);

        this.wsControl = new WebSocket(controlUrl);
        this.wsData = new WebSocket(dataUrl);
        this.wsData.binaryType = 'arraybuffer';

        this.ready = Promise.all([
            new Promise((resolve, reject) => {
                this.wsControl.onopen = () => resolve();
                this.wsControl.onerror = (e) => reject(e);
            }),
            new Promise((resolve, reject) => {
                this.wsData.onopen = () => resolve();
                this.wsData.onerror = (e) => reject(e);
            })
        ]);

        let controlController;
        this.controlReadable = new ReadableStream({
            start(controller) { controlController = controller; }
        });

        let datagramController;
        this.datagrams = {
            readable: new ReadableStream({
                start(controller) { datagramController = controller; }
            })
        };

        this.wsControl.onmessage = (event) => {
            if (typeof event.data === 'string') {
                if (controlController) {
                    controlController.enqueue(new TextEncoder().encode(event.data));
                }
            }
        };

        this.wsData.onmessage = (event) => {
            if (typeof event.data !== 'string') {
                if (datagramController) {
                    datagramController.enqueue(new Uint8Array(event.data));
                }
            }
        };

        this.wsControl.onclose = () => log('WS Control closed');
        this.wsData.onclose = () => log('WS Data closed');
    }

    async createBidirectionalStream() {
        const self = this;
        return {
            readable: self.controlReadable,
            writable: new WritableStream({
                write(chunk) {
                    const text = new TextDecoder().decode(chunk);
                    self.wsControl.send(text);
                }
            })
        };
    }

    close() {
        this.wsControl.close();
        this.wsData.close();
    }
}

class H264Depacketizer {
    constructor(onFrame) {
        this.onFrame = onFrame;
        this.fragmentBuffer = null;
        this.fragmentType = null;
        this.fragmentTimestamp = null;
        this.lastSequenceNumber = null;
        this.packetStats = { total: 0, lost: 0, outOfOrder: 0 };
    }

    process(packet) {
        if (packet.length < 12) {
            log(`Packet too short: ${packet.length}`, 'warn');
            return;
        }

        const v_p_x_cc = packet[0];
        const x_bit = (v_p_x_cc & 0x10) >> 4;
        const cc = (v_p_x_cc & 0x0F);
        const sequenceNumber = (packet[2] << 8) | packet[3];
        const timestamp = ((packet[4] << 24) | (packet[5] << 16) | (packet[6] << 8) | packet[7]) >>> 0;

        this.packetStats.total++;

        // Log first few packets for debugging
        if (this.packetStats.total <= 5) {
            log(`RTP packet: seq=${sequenceNumber}, ts=${timestamp}, len=${packet.length}, cc=${cc}, x=${x_bit}`);
        }

        if (this.lastSequenceNumber !== null) {
            const expectedSeq = (this.lastSequenceNumber + 1) & 0xFFFF;
            if (sequenceNumber !== expectedSeq) {
                if (sequenceNumber < this.lastSequenceNumber && (this.lastSequenceNumber - sequenceNumber) < 100) {
                    this.packetStats.outOfOrder++;
                } else {
                    const lost = (sequenceNumber - expectedSeq) & 0xFFFF;
                    this.packetStats.lost += lost;
                }
            }
        }
        this.lastSequenceNumber = sequenceNumber;

        if (this.packetStats.total % 500 === 0) {
            log(`RTP Stats: Total=${this.packetStats.total}, Lost=${this.packetStats.lost}, OutOfOrder=${this.packetStats.outOfOrder}`);
        }

        let payloadOffset = 12 + (cc * 4);

        if (x_bit) {
            if (packet.length < payloadOffset + 4) return;
            const extLen = (packet[payloadOffset + 2] << 8) | packet[payloadOffset + 3];
            payloadOffset += 4 + (extLen * 4);
        }

        if (packet.length < payloadOffset) return;

        let payload = packet.subarray(payloadOffset);
        if (payload.length === 0) return;

        const nalHeader = payload[0];
        const forbidden_zero_bit = (nalHeader & 0x80) >> 7;
        if (forbidden_zero_bit !== 0) return;

        const nal_ref_idc = (nalHeader & 0x60) >> 5;
        const nal_unit_type = nalHeader & 0x1F;

        // Log NAL unit types
        if (this.packetStats.total <= 10) {
            log(`NAL unit type=${nal_unit_type}, payload=${payload.length}b`);
        }

        if (nal_unit_type >= 1 && nal_unit_type <= 23) {
            const data = new Uint8Array(4 + payload.length);
            data.set([0, 0, 0, 1], 0);
            data.set(payload, 4);
            this.onFrame(data, timestamp);
        } else if (nal_unit_type === 28 || nal_unit_type === 29) {
            // FU-A or FU-B fragmentation unit
            if (this.packetStats.total <= 10) {
                const fuHeader = payload[1];
                const s_bit = (fuHeader & 0x80) >> 7;
                const e_bit = (fuHeader & 0x40) >> 6;
                const fuType = fuHeader & 0x1F;
                log(`FU-A: fuType=${fuType}, start=${s_bit}, end=${e_bit}`);
            }
            const fuHeader = payload[1];
            const s_bit = (fuHeader & 0x80) >> 7;
            const e_bit = (fuHeader & 0x40) >> 6;
            const fuType = fuHeader & 0x1F;
            let nal_payload_idx = nal_unit_type === 29 ? 4 : 2;

            if (s_bit) {
                const reconstructedNalHeader = (nal_ref_idc << 5) | fuType;
                this.fragmentBuffer = [new Uint8Array([0, 0, 0, 1, reconstructedNalHeader]), payload.subarray(nal_payload_idx)];
                this.fragmentType = fuType;
                this.fragmentTimestamp = timestamp;
            } else if (this.fragmentBuffer && this.fragmentType === fuType) {
                this.fragmentBuffer.push(payload.subarray(nal_payload_idx));
                if (e_bit) {
                    const data = mergeBuffers(this.fragmentBuffer);
                    this.fragmentBuffer = null;
                    if (data.length >= 20) {
                        this.onFrame(data, this.fragmentTimestamp || timestamp);
                    }
                }
            }
        }
    }
}

class RTSPClient {
    constructor(url, rtspUrl, canvas) {
        this.url = url;
        this.rtspUrl = rtspUrl;
        this.canvas = canvas;
        this.gl = this.canvas.getContext('webgl2') || this.canvas.getContext('webgl');
        if (!this.gl) {
            log('WebGL not supported', 'error');
        } else {
            this.initWebGL();
        }

        this.transport = null;
        this.controlStream = null;
        this.writer = null;
        this.reader = null;
        this.cseq = 1;
        this.decoder = null;
        this.depacketizer = new H264Depacketizer(this.onNalUnit.bind(this));
        this.NALUnitBuffer = [];
        this.hasKeyFrame = false;
        this.hasSeenKeyFrame = false;
        this.videoChannelId = null;
        this.profileLevelId = '42001E';
    }

    async connect() {
        log(`Connecting to ${this.url}...`);

        const connectionUrl = `${this.url}?rtsp=${encodeURIComponent(this.rtspUrl)}`;

        try {
            if (typeof WebTransport !== 'undefined') {
                log(`Attempting WebTransport connection...`);
                this.transport = new WebTransportAdapter(connectionUrl);
                await this.transport.ready;
                log('WebTransport connected');
            } else {
                throw new Error("WebTransport not supported");
            }
        } catch (e) {
            log(`WebTransport failed: ${e}. Fallback to WebSocket...`, 'warn');

            try {
                const u = new URL(connectionUrl);
                u.port = wsFallbackPort;
                u.protocol = 'ws:';

                const wsUrl = u.toString();
                this.transport = new WebSocketAdapter(wsUrl);
                await this.transport.ready;
                log(`WebSocket connected to ${wsUrl}`);
            } catch (wsErr) {
                log(`WebSocket connection failed: ${wsErr}`, 'error');
                return;
            }
        }

        this._renderedFrames = 0;
        this.decoder = new VideoDecoder({
            output: (frame) => {
                this._renderedFrames++;
                if (this._renderedFrames <= 5 || this._renderedFrames % 100 === 0) {
                    log(`Rendered frame #${this._renderedFrames}, ${frame.codedWidth}x${frame.codedHeight}`);
                }
                if (this.gl) {
                    this.renderFrame(frame);
                } else {
                    // Fallback to 2D canvas if WebGL not available
                    if (!this._ctx2d) {
                        this._ctx2d = this.canvas.getContext('2d');
                    }
                    if (this._ctx2d) {
                        this._ctx2d.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);
                    }
                }
                frame.close();
            },
            error: (e) => log(`Decoder error: ${e}`, 'error')
        });

        this.controlStream = await this.transport.createBidirectionalStream();
        this.writer = this.controlStream.writable.getWriter();
        this.reader = this.controlStream.readable.getReader();

        this.readControl();
        this.readDatagrams();

        await this.sendRTSP('OPTIONS', this.rtspUrl);
        await this.sendRTSP('DESCRIBE', this.rtspUrl);
    }

    initWebGL() {
        const gl = this.gl;

        const vsSource = `
            attribute vec2 a_position;
            attribute vec2 a_texCoord;
            varying vec2 v_texCoord;
            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
                v_texCoord = a_texCoord;
            }
        `;

        const fsSource = `
            precision mediump float;
            varying vec2 v_texCoord;
            uniform sampler2D u_image;
            void main() {
                gl_FragColor = texture2D(u_image, v_texCoord);
            }
        `;

        const vs = this.compileShader(gl, gl.VERTEX_SHADER, vsSource);
        const fs = this.compileShader(gl, gl.FRAGMENT_SHADER, fsSource);

        this.program = gl.createProgram();
        gl.attachShader(this.program, vs);
        gl.attachShader(this.program, fs);
        gl.linkProgram(this.program);

        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            log('WebGL program link failed', 'error');
            return;
        }

        gl.useProgram(this.program);

        this.positionLocation = gl.getAttribLocation(this.program, "a_position");
        this.texCoordLocation = gl.getAttribLocation(this.program, "a_texCoord");
        this.imageLocation = gl.getUniformLocation(this.program, "u_image");

        this.texCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            0.0, 1.0, 1.0, 1.0, 0.0, 0.0, 1.0, 0.0,
        ]), gl.STATIC_DRAW);

        this.positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1.0, -1.0, 1.0, -1.0, -1.0, 1.0, 1.0, 1.0,
        ]), gl.STATIC_DRAW);

        this.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }

    compileShader(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            log('Shader compile failed', 'error');
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    renderFrame(frame) {
        const gl = this.gl;
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(this.program);

        gl.enableVertexAttribArray(this.positionLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);

        gl.enableVertexAttribArray(this.texCoordLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.vertexAttribPointer(this.texCoordLocation, 2, gl.FLOAT, false, 0, 0);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    async sendRTSP(method, url, headers = {}) {
        let msg = `${method} ${url} RTSP/1.0\r\n`;
        msg += `CSeq: ${this.cseq++}\r\n`;
        msg += `User-Agent: DMR-WebCodecs\r\n`;
        for (const [k, v] of Object.entries(headers)) {
            msg += `${k}: ${v}\r\n`;
        }
        msg += `\r\n`;

        log(`Sending ${method}`);
        await this.writer.write(new TextEncoder().encode(msg));
    }

    async readControl() {
        const decoder = new TextDecoder();
        try {
            while (true) {
                const { value, done } = await this.reader.read();
                if (done) break;
                const text = decoder.decode(value);
                log(`RTSP Response: ${text.substring(0, 200)}...`);

                if (text.includes('RTSP/1.0 200 OK')) {
                    if (text.includes('Content-Type: application/sdp')) {
                        this.parseSDP(text);

                        // Build initial config - we'll configure just before PLAY
                        // to ensure the decoder is ready when frames arrive
                        this.pendingConfig = {
                            profileLevelId: this.profileLevelId,
                            spropParameterSets: this.spropParameterSets
                        };
                        log(`Pending decoder config with profile: ${this.profileLevelId}`);

                        // Use parsed track control or fallback
                        const trackUrl = this.trackControl
                            ? `${this.rtspUrl}/${this.trackControl}`
                            : `${this.rtspUrl}/trackID=0`;
                        log(`SETUP URL: ${trackUrl}`);
                        await this.sendRTSP('SETUP', trackUrl, {
                            'Transport': 'RTP/AVP;unicast;client_port=0-0'
                        });
                    } else if (text.includes('Transport:')) {
                        const match = text.match(/Session:\s*(\S+)/);
                        if (match) {
                            this.sessionId = match[1].split(';')[0];
                        }

                        const channelMatch = text.match(/x-wt-channel-id=(\d+)-(\d+)/);
                        if (channelMatch) {
                            this.videoChannelId = parseInt(channelMatch[1], 10);
                            log(`Assigned Video Channel ID: ${this.videoChannelId}`);
                        } else {
                            this.videoChannelId = 0;
                        }

                        if (this.sessionId) {
                            // Configure decoder just before play
                            await this.configureDecoder();
                            await this.sendRTSP('PLAY', this.rtspUrl, { Session: this.sessionId });
                            postMessage({ type: 'connected' });
                        }
                    }
                }
            }
        } catch (e) {
            log(`Control stream error: ${e}`, 'error');
        }
    }

    async readDatagrams() {
        log('Starting datagram reader...');
        const reader = this.transport.datagrams.readable.getReader();
        let packetCount = 0;
        // Fragment reassembly buffer: Map<fragId, { fragments: Uint8Array[], totalFrags: number, received: number }>
        const fragBuffers = new Map();

        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) {
                    log('Datagram stream ended');
                    break;
                }

                packetCount++;
                const channelByte = value[0];
                const isFragmented = (channelByte & 0x80) !== 0;
                const channelId = channelByte & 0x7F;

                if (packetCount <= 5 || packetCount % 100 === 0) {
                    log(`Datagram #${packetCount}: ${value.length} bytes, channel=${channelId}, frag=${isFragmented}`);
                }

                let payload;
                if (isFragmented) {
                    // Fragmented packet: [channel|0x80, frag_flags, frag_id, frag_index, data...]
                    const fragFlags = value[1];
                    const fragId = value[2];
                    const fragIndex = value[3];
                    const totalFrags = fragFlags & 0x7F;
                    const moreFrags = (fragFlags & 0x80) !== 0;
                    const fragData = value.subarray(4);

                    if (!fragBuffers.has(fragId)) {
                        fragBuffers.set(fragId, {
                            fragments: new Array(totalFrags).fill(null),
                            totalFrags,
                            received: 0
                        });
                    }

                    const buf = fragBuffers.get(fragId);
                    if (buf.fragments[fragIndex] === null) {
                        buf.fragments[fragIndex] = fragData;
                        buf.received++;
                    }

                    if (buf.received === buf.totalFrags) {
                        // All fragments received - reassemble
                        const totalLen = buf.fragments.reduce((sum, f) => sum + f.length, 0);
                        payload = new Uint8Array(totalLen);
                        let offset = 0;
                        for (const frag of buf.fragments) {
                            payload.set(frag, offset);
                            offset += frag.length;
                        }
                        fragBuffers.delete(fragId);

                        if (packetCount <= 20) {
                            log(`Reassembled fragmented packet: ${totalLen} bytes from ${totalFrags} fragments`);
                        }
                    } else {
                        continue; // Wait for more fragments
                    }

                    // Clean up old fragment buffers (prevent memory leaks)
                    if (fragBuffers.size > 100) {
                        const oldest = fragBuffers.keys().next().value;
                        fragBuffers.delete(oldest);
                    }
                } else {
                    // Non-fragmented packet
                    payload = value.subarray(1);
                }

                if (this.videoChannelId !== null && channelId === this.videoChannelId) {
                    this.depacketizer.process(payload);
                }
            }
        } catch (e) {
            log(`Datagram error after ${packetCount} packets: ${e}`, 'error');
        }
    }

    async configureDecoder() {
        if (!this.pendingConfig) {
            log('No pending config', 'error');
            return;
        }

        const { profileLevelId, spropParameterSets } = this.pendingConfig;

        // Build avcC description from SPS/PPS
        let description = null;
        if (spropParameterSets) {
            description = this.buildAvcDescription(spropParameterSets);
        }

        // Try several codec configurations in order of preference
        const codecs = [
            `avc1.${profileLevelId}`,
            'avc1.42E01E',   // Constrained Baseline Level 3.0 (widely supported)
            'avc1.42001E',   // Baseline Level 3.0
            'avc1.4D401E',   // Main Profile Level 3.0
            'avc1.64001E',   // High Profile Level 3.0
        ];

        // Also try different hardware acceleration modes
        const hwModes = ['prefer-hardware', 'prefer-software', 'no-preference'];

        // Try WITH description first (avcC format)
        if (description) {
            for (const hwAccel of hwModes) {
                for (const codec of codecs) {
                    const config = {
                        codec,
                        hardwareAcceleration: hwAccel,
                        optimizeForLatency: true,
                        codedWidth: 640,
                        codedHeight: 480,
                        description: description,
                    };

                    try {
                        const support = await VideoDecoder.isConfigSupported(config);
                        if (support.supported) {
                            log(`Using codec ${codec}, hwAccel=${hwAccel}, with avcC description`);
                            this.decoder.configure(config);
                            this._useAvcC = true;  // Flag to indicate we're using avcC format
                            return;
                        }
                    } catch (e) {
                        // Continue trying
                    }
                }
            }
        }

        // Fallback: try without description (Annex-B)
        for (const hwAccel of hwModes) {
            for (const codec of codecs) {
                const config = {
                    codec,
                    hardwareAcceleration: hwAccel,
                    optimizeForLatency: true,
                    codedWidth: 640,
                    codedHeight: 480,
                };

                try {
                    const support = await VideoDecoder.isConfigSupported(config);
                    if (support.supported) {
                        log(`Using codec ${codec}, hwAccel=${hwAccel}, Annex-B format`);
                        this.decoder.configure(config);
                        this._useAvcC = false;
                        return;
                    }
                } catch (e) {
                    log(`Config check failed for ${codec}: ${e}`, 'warn');
                }
            }
        }

        log('No supported codec configuration found!', 'error');
    }

    // Build AVC decoder configuration record (avcC) from SPS/PPS base64 strings
    buildAvcDescription(spropParameterSets) {
        try {
            const parts = spropParameterSets.split(',');
            if (parts.length < 2) return null;

            const sps = Uint8Array.from(atob(parts[0]), c => c.charCodeAt(0));
            const pps = Uint8Array.from(atob(parts[1]), c => c.charCodeAt(0));

            if (sps.length < 4) return null;

            // Build avcC box
            const avcC = new Uint8Array(11 + sps.length + pps.length);
            let offset = 0;

            avcC[offset++] = 1;                   // configurationVersion
            avcC[offset++] = sps[1];              // AVCProfileIndication
            avcC[offset++] = sps[2];              // profile_compatibility
            avcC[offset++] = sps[3];              // AVCLevelIndication
            avcC[offset++] = 0xFF;                // 6 bits reserved (111111) + 2 bits NAL unit length - 1 (11 = 4 bytes)
            avcC[offset++] = 0xE1;                // 3 bits reserved (111) + 5 bits number of SPS (00001)

            // SPS length (2 bytes big-endian)
            avcC[offset++] = (sps.length >> 8) & 0xFF;
            avcC[offset++] = sps.length & 0xFF;
            avcC.set(sps, offset);
            offset += sps.length;

            avcC[offset++] = 1;                   // number of PPS

            // PPS length (2 bytes big-endian)
            avcC[offset++] = (pps.length >> 8) & 0xFF;
            avcC[offset++] = pps.length & 0xFF;
            avcC.set(pps, offset);

            log(`Built avcC description: ${avcC.length} bytes`);
            return avcC;
        } catch (e) {
            log(`Failed to build avcC: ${e}`, 'warn');
            return null;
        }
    }

    parseSDP(sdpText) {
        const profileMatch = sdpText.match(/profile-level-id=([0-9a-fA-F]+)/);
        if (profileMatch) {
            this.profileLevelId = profileMatch[1].toUpperCase();
            log(`Parsed profile-level-id: ${this.profileLevelId}`);
        }

        // Try to extract SPS/PPS from sprop-parameter-sets
        const spropMatch = sdpText.match(/sprop-parameter-sets=([^;\s\r\n]+)/);
        if (spropMatch) {
            this.spropParameterSets = spropMatch[1];
            log(`Parsed sprop-parameter-sets: ${this.spropParameterSets}`);
        }

        // Extract track control URL (e.g., "a=control:trackID=0" or "a=control:stream=0")
        const controlMatch = sdpText.match(/a=control:(\S+)/g);
        if (controlMatch) {
            // Find the video track control (typically the one after m=video)
            for (const ctrl of controlMatch) {
                const url = ctrl.replace('a=control:', '');
                // Skip wildcard/base URL markers
                if (url !== '*' && !url.startsWith('rtsp://')) {
                    this.trackControl = url;
                    log(`Parsed track control: ${this.trackControl}`);
                    break;
                }
            }
        }
    }

    onNalUnit(data, timestamp) {
        if (!this.decoder || this.decoder.state !== 'configured') {
            if (!this._warnedNotConfigured) {
                log(`Decoder not configured, state=${this.decoder?.state}`, 'warn');
                this._warnedNotConfigured = true;
            }
            return;
        }
        if (data.length < 5) return;

        const nalHeader = data[4];
        const nalType = nalHeader & 0x1F;

        // Log NAL types for debugging
        if (!this._nalTypeCounts) this._nalTypeCounts = {};
        this._nalTypeCounts[nalType] = (this._nalTypeCounts[nalType] || 0) + 1;
        if (this._nalTypeCounts[nalType] <= 3) {
            log(`NAL type ${nalType}, size=${data.length}`);
        }

        // Skip SPS/PPS - we get these from SDP/avcC description
        if (nalType === 7 || nalType === 8) {
            return;
        }

        // Check if timestamp changed - means new frame
        const timestampChanged = this._lastTimestamp !== undefined && this._lastTimestamp !== timestamp;

        // Push pending frame if timestamp changed and we have data
        if (timestampChanged && this.NALUnitBuffer.length > 0 && this.hasSeenKeyFrame) {
            this._pushFrame(this._lastTimestamp);
        }

        // Handle keyframe detection
        if (nalType === 5) {
            // IDR frame - this is a keyframe
            // If we have pending non-keyframe data, discard it (shouldn't happen normally)
            if (this.NALUnitBuffer.length > 0 && !this.hasKeyFrame) {
                this.NALUnitBuffer = [];
            }
            this.hasKeyFrame = true;
            this.hasSeenKeyFrame = true;
        }

        // Only buffer data after we've seen a keyframe
        if (!this.hasSeenKeyFrame) {
            if (!this._warnedWaitingKeyframe) {
                log(`Waiting for keyframe...`);
                this._warnedWaitingKeyframe = true;
            }
            return;
        }

        this._lastTimestamp = timestamp;
        this.NALUnitBuffer.push(data);
    }

    _pushFrame(timestamp) {
        if (this.NALUnitBuffer.length === 0) return;

        const frameType = this.hasKeyFrame ? 'key' : 'delta';
        let frameData;

        if (this._useAvcC) {
            // Convert to avcC format: 4-byte length prefix instead of start codes
            // Each NAL unit in buffer already has [0,0,0,1] prefix, replace with length
            const parts = [];
            for (const nal of this.NALUnitBuffer) {
                // Skip the 4-byte start code, get the actual NAL data
                const nalData = nal.subarray(4);
                const len = nalData.length;
                const lenPrefixed = new Uint8Array(4 + len);
                lenPrefixed[0] = (len >> 24) & 0xFF;
                lenPrefixed[1] = (len >> 16) & 0xFF;
                lenPrefixed[2] = (len >> 8) & 0xFF;
                lenPrefixed[3] = len & 0xFF;
                lenPrefixed.set(nalData, 4);
                parts.push(lenPrefixed);
            }
            frameData = mergeBuffers(parts);
        } else {
            // Annex-B format - merge as-is
            frameData = mergeBuffers(this.NALUnitBuffer);

            // For keyframes with Annex-B, prepend SPS and PPS
            if (frameType === 'key' && this.spropParameterSets) {
                const spsPps = this._buildSpsPpsNals();
                if (spsPps) {
                    const combined = new Uint8Array(spsPps.length + frameData.length);
                    combined.set(spsPps, 0);
                    combined.set(frameData, spsPps.length);
                    frameData = combined;
                }
            }
        }

        this.NALUnitBuffer = [];
        this.hasKeyFrame = false;

        if (!this._frameCount) this._frameCount = 0;
        this._frameCount++;
        if (this._frameCount <= 5 || this._frameCount % 100 === 0) {
            log(`Decoding frame #${this._frameCount}, type=${frameType}, size=${frameData.length}, avcC=${this._useAvcC}`);
        }

        const timestampUs = (timestamp / 90000) * 1_000_000;

        const chunk = new EncodedVideoChunk({
            type: frameType,
            timestamp: timestampUs,
            data: frameData,
        });

        try {
            this.decoder.decode(chunk);
        } catch (e) {
            log(`Decode error: ${e}`, 'error');
        }
    }

    _buildSpsPpsNals() {
        if (!this.spropParameterSets) return null;
        try {
            const parts = this.spropParameterSets.split(',');
            if (parts.length < 2) return null;

            const sps = Uint8Array.from(atob(parts[0]), c => c.charCodeAt(0));
            const pps = Uint8Array.from(atob(parts[1]), c => c.charCodeAt(0));

            // Build Annex-B format: [0,0,0,1,SPS,0,0,0,1,PPS]
            const result = new Uint8Array(4 + sps.length + 4 + pps.length);
            result.set([0, 0, 0, 1], 0);
            result.set(sps, 4);
            result.set([0, 0, 0, 1], 4 + sps.length);
            result.set(pps, 8 + sps.length);
            return result;
        } catch (e) {
            log(`Failed to build SPS/PPS: ${e}`, 'warn');
            return null;
        }
    }
}

self.onmessage = async (e) => {
    const { type, url, rtspUrl, canvas, wsFallbackPort: port } = e.data;
    if (type === 'init') {
        if (port) wsFallbackPort = port;

        // Test WebCodecs H264 support
        log('Testing WebCodecs H264 support...');
        const testConfig = {
            codec: 'avc1.42001E',
            codedWidth: 640,
            codedHeight: 480,
        };
        try {
            const support = await VideoDecoder.isConfigSupported(testConfig);
            log(`H264 support test: ${JSON.stringify(support)}`);
        } catch (e) {
            log(`H264 support test error: ${e}`, 'error');
        }

        self.client = new RTSPClient(url, rtspUrl, canvas);
        self.client.connect();
    }
};
