var _OS = {
    output: {},
    build: 69,
    headroom: 5,
    played: 0,
    stopped: true,
    queue: [],
    context: null,
    _audioEl: new Audio(),
}

var connectUrl = location.protocol + '//connect.orastream.com';

_OS.on = function (event, callback) {
    if (!this.listeners) this.listeners = {}
    if (!this.listeners.hasOwnProperty(event)) this.listeners[event] = [];
    this.listeners[event].push(callback);
}

_OS.emit = function (event, params) {
    if (event in this.listeners) {
        var callbacks = this.listeners[event];
        for (var x in callbacks) callbacks[x](params);
    }
}

_OS.setToken = function (token) {
    _OS.token = token;
}

_OS.remote = {
    level: 1,
    host: '',
    index: 0,
    duration: 0,
    position: 0,
    buffered: 0,
    bandwidth: 0,
    bitrate: 0,
    quality: 0,
    device: {
        type: null,
        index: 0
    }
};

_OS.remote.connect = function (host, type) {
    if(this.socket) this.socket.removeAllListeners();
    this.host = location.protocol + "//" + host;
    this.socket = io.connect(this.host, { transports: ['websocket', 'polling', 'flashsocket']});
    this.listeners();
    this.socket.emit('remote.connect', type);
    this.device.type = type;

    this.socket.on('connect',function() {
        if(this.__disconnected) this.emit('remote.connect', _OS.remote.device.type);
        this.__disconnected = false;
    })

    this.socket.on('disconnect',function() {
        this.__disconnected=true;
    })
}

_OS.remote.listeners = function () {
    this.socket.on('remote.volume',function(level) {
        _OS.remote.level = level;
        _OS.emit('volume',level);
    })

    this.socket.on('remote.connect', function (res) {
        _OS.emit('connect', res);
        this.emit('remote.volume');
    })

    this.socket.on('remote.update',function(update) {
        _OS.remote.index = update.index;
        _OS.remote.duration = update.duration;
        _OS.remote.position = update.position;
        _OS.remote.buffered = update.buffered;
        _OS.remote.bitrate = update.bitrate;
        _OS.remote.quality = update.quality;
        _OS.remote.bandwidth = update.bandwidth;
        _OS.remote.state = update.state;
        _OS.remote.resolution = update.resolution;
        _OS.remote.rate = update.rate;
    })

    this.socket.on('remote.stop', function (res) {
        _OS.emit('stop');
    })
}

_OS.remote.update = function (json) {
    this.socket.emit('remote.update');

    json.samprate = json.bitrate = json.elapsed = json.remaining = '--'
    json.state = "READY" // "LOADING"

    var duration = this.duration;
    if(duration && this.state!='READY') {
        json.state = this.state;
        json.samprate = this.resolution+'b/'+parseInt(this.rate/1000)+'k'
        json.buffered = this.buffered;
        json.bandwidth = this.bandwidth;
        json.position = this.position;
        if (json.position>1) json.position = 1;

        var currentTime = this.position*duration;
        var remainingTime = duration - currentTime;
        var min = parseInt(currentTime/60) %60;
        var sec = parseInt(currentTime %60);
        json.elapsed = (min<10 ? "0"+min : min) + ":" + (sec<10 ? "0"+sec : sec);

        min = parseInt(remainingTime / 60) % 60;
        sec = parseInt(remainingTime % 60);
        json.remaining = (min<10 ? "0"+min : min) + ":" + (sec<10 ? "0"+sec : sec);
        if (this.bitrate) json.bitrate = parseInt(this.bitrate + 0.5);
        if (this.quality) json.quality = this.quality;
    } else
        json.position = this.position;
}

_OS.remote.queue = function (query) {
    this.socket.emit('remote.queue', query);
}

_OS.remote.load = function (index) {
    this.socket.emit('remote.load', index);
}

_OS.remote.play = function (flag) {
    this.socket.emit(flag ? 'remote.play' : 'remote.pause')
}

_OS.remote.seek = function (pos) {
    if (this.duration) {
        var _near = 1 - 10/this.duration;
        if (pos>_near) pos = _near;
    }
    this.socket.emit('remote.seek', pos)
}

_OS.remote.stop = function () {
    this.position = this.buffered = this.duration = 0;
    this.socket.emit('remote.stop')
};

_OS.remote.volume = function (level) {
    if(level<0 || !level) level=1e-10;
    if(level>1) level=1;
    this.level = level;
    this.socket.emit('remote.volume', level)
}

_OS.connect = function () {
    var _host = this.host;
    if (/notlive/.test(_host)) return;
    if (this.service=='orastream') _host = connectUrl;
    _OS.socket = io.connect(_host,{ transports: ['websocket', 'polling', 'flashsocket']});
}

_OS.init = function () {
    this.volumeLevel = 1;
    this.max = 9999;
    this.mode = 1;

    if(typeof window.AudioContext != 'undefined' || typeof window.webkitAudioContext != 'undefined') {
        this.context = new (window.AudioContext || window.webkitAudioContext);
        this.gainNode = this.context.createGain();
        this.analyser = this.context.createAnalyser();
        this.gainNode.connect(this.analyser);
        this.analyser.connect(this.context.destination);

        this.analyser.fftSize = 512;
        this.analyser.minDecibels = -130;

        this._audioEl.crossOrigin = 'anonymous';
        this.mediaElementSource = this.context.createMediaElementSource(this._audioEl);
        this.mediaElementSource.connect(this.gainNode);

        this.bufferSources = [];
        this.resampleAudio = true;
        this.bufferSamples = new Float32Array(512*1024);
        this.context.suspend();

        if(/Safari/.test(navigator.userAgent) && /(iPad|iPhone|iPod)/.test(navigator.userAgent) ) {
            var _resume = function() {
                _OS.context.resume();
                //setTimeout((function() {
                    if(_OS.context.state=='running') document.body.removeEventListener('touchend', _resume, false);
                //}), 0);
            };
            setTimeout( function() {
                document.body.addEventListener('touchend', _resume, false);
            }, 0)
        }
    }
    else
        this.max = 320, this.mode = 2;

    if (typeof(window.fetch)==='function' && typeof(window.ReadableStream)==='function' && !/(Firefox|Edge)/.test(navigator.userAgent))
        this.switchToFetch();

    console.log('os.js build:', this.build, 'using:',
        this.switched ? 'http fetch' :'socket_io', 'url:', connectUrl);

    if (!this.host) this.host = connectUrl;
    var loadIO = setInterval(function() {
        if(typeof (io)=="function"){
            if(!_OS.switched) _OS.connect();
            _OS.isLoaded = true;
            _OS.emit('volume', _OS.volumeLevel);
            _OS.testBandwidth();
            clearInterval(loadIO);
        }
    }, 1000);
}

_OS.testBandwidth = function () {
    var total = 0;
    var start = new Date();
    var diff = 0;
    if(this.switched) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', "https://cdn.orastream.com/streaming/test.zip", true);
        xhr.onreadystatechange = function(e) {
            if (this.readyState >= 3 && this.status == 200) {
                total = this.responseText.length;
                diff = (new Date()) - start;
                localStorage.bandwidth = _OS.bandwidth = parseInt(8 * total / diff);
                if(_OS.connection) this.abort();
                //console.log('bw:',_OS.bandwidth, 'bytes:', total, 'ms:', diff);
                if(_OS.stopped) _OS._dropped = true;
            }
        };
        xhr.send();
    }
}

_OS.isTrackChanged = function (index) {
    if (this.cache_queue && this.query && this.query.track_id==this.cache_queue[index]) return false;
    return true
}

_OS.updateCaching = function (product_ids) {
    this.cache_queue = product_ids;
    _OS.worker.postMessage({
        action: 'empty',
        total: product_ids.length
    });
    this._format = new Array(product_ids.length);
}

_OS.updatePlayer = function (json) {
    if(!this.cache_queue) return;
    var format=this.format || this._format[this.index];
    json.samprate = json.bitrate = json.samprate = json.elapsed = json.remaining = '--'
    json.state = "LOADING"

    if(this.connection && this.connection.bytesLoaded && !this._error) {
        if(this.buffered<1) _OS.worker.postMessage({action: 'progress', index: this.index});
        if(this._buffered<1) _OS.worker.postMessage({action: 'progress', index: this._index});
    }
    if (this.paused && this.waiting) json.state = "PAUSED";
    else{
        if (this.paused && !this.waiting) this.buffered = this.played;
        if (this.index > this._index) this._index = this.index;
        if (this.index == this._index && this._buffered>0) this.buffered = this._buffered;
        if (this.max!=320 && this.playing && this.buffered < this.played && this.played>0 && this.played<1) {
            console.log('buffering...',this.played, this.buffered, this.bitrate, this.bandwidth);
            this._dropped = true;
            return this.scrub(this.played - 1e-5);
        }
        if(format) {
            if(this.max!=320) {
                if ( this.playing || this.connection.headroom > this.headroom) {
                    if(!this.waiting) json.state = 'LIVEPLAY';
                    if (!this.playing && !this.stopped) this.out();
                }
                var now = this.context.currentTime;
                if(!this.prevTime) this.prevTime = now;
                var offset = now - this.prevTime;
                this.prevTime = now;
                if (this.playing && !this.stopped && !this.waiting)
                    this.played += offset / format.duration;
            } else  {
                if (!this.playing && !this.stopped) this.out();
                this.bandwidth = null;
                var buffered = this._audioEl.buffered;
                var len = buffered.length;
                if(len) {
                    this.buffered  = buffered.end(len-1)/this._audioEl.duration;
                    this.bitrate = 320;
                    this.quality = format.osf>1 ? 1 : 5;
                    json.state = 'LIVEPLAY';
                    if (this._audioEl.ended) this.playing = false;
                    this.played = this._audioEl.currentTime / format.duration;
                }
            }
        }
    }
    if(this.played>1) this.played = 1;
    json.buffered = this.buffered;
    json.bandwidth = this.bandwidth;
    json.position = this.played;

    if(format) {
        var currentTime = this.played * format.duration;
        currentTime = (currentTime+0.02).toFixed(1);
        var remainingTime = format.duration - currentTime;
        var min = parseInt(currentTime / 60) % 60;
        var sec = parseInt(currentTime % 60);
        json.elapsed = (min<10 ? "0"+min : min) + ":" + (sec<10 ? "0"+sec : sec);

        min = parseInt(remainingTime/60)%60;
        sec = parseInt(remainingTime%60);
        json.remaining = (min<10 ? "0"+min : min) + ":" + (sec<10 ? "0"+sec : sec);

        if(json.state != "LOADING") {
            json.samprate = format.bitDepth+'b/'+parseInt(format.sampleRate / 1000)+'k'
            if(this.bitrate) json.bitrate = parseInt(this.bitrate + 0.5);
            if(this.quality) json.quality = this.quality;
        }

        if(this.max!=320) {
            var headroom = parseInt(format.duration * (this.buffered - this.played));
            if(this.playing && this.buffered < 1 && this.bandwidth <1e4 && !this._dropped && headroom < 20 && headroom < this.connection.headroom) {
                this.connection.fillrate --;
                console.log('fillrate:', this.connection.fillrate);
            }
            if(headroom >= 20) this.connection.fillrate = 0;
            this.connection.headroom = headroom;
            // ??? testing fillrate
            if(this.playing && this.connection.fillrate < -4  && !this._dropped) {
                this.dropConnection();
                console.log('dropping connection', this.played, this.buffered, this.bitrate, this.bandwidth);
            }
        }
        if(_OS.debugging)
            console.log('state:',json.state,'bandwidth:',this.bandwidth, 'headroom:',this.connection.headroom, 'frames queued:', this.queue.length, 'byte:',this.connection.bytesLoaded, 'fillrate:', this.connection.fillrate);

        if(format.duration * (1-this.played) < 1) {
            /*
            var _f = this._format[this.index+1];
            if(format) {
                var f44_base = (this.context.sampleRate % 44100) == (_f.sampleRate % 44100);
                var f48_base = (this.context.sampleRate % 48000) == (_f.sampleRate % 48000);
                this.resampleAudio = (f44_base || f48_base) ? false : true;
                if(window.safari && _f.sampleRate > 96000)
                    this.resampleAudio = true;
            }*/
            this.emit('next');
            this.setTimeout(5000);
            console.log('loading next...');
        }
    }

    if (this.buffered == 1 && !this._next && this._buffered == 1 && !this.isTrackChanged(this.index)) {
        if(this.index+1 < this.cache_queue.length && (1-this.played)*format.duration < 30){
            this._next = true;
            console.log('web - preload next track',this._index+1, 'time:', (new Date()).toLocaleTimeString())
            this.preload(this._index+1);
            setTimeout(function() {
                if(_OS.max!=320) {
                    console.log('ready level:',_OS._buffered);
                    if(!_OS._buffered)
                        _OS.setTimeout(500);
                        //_OS.preload(_OS._index);
                }
            },5000)
        }
    }
}

_OS.getASC = function (d) {
    var m;
    var sampIndex, pcmIndex, frameIndex;
    function getInt32Value(data,_offset){
        return data[3+_offset]<<24|data[2+_offset]<<16|data[1+_offset]<<8|data[0+_offset]
    }
    var aot = getInt32Value(d,0);
    if(aot == 38) {
        m={}
        m.lastFrameSize = getInt32Value(d,4);;
        sampIndex = getInt32Value(d,8);;
        m.numChannels = getInt32Value(d,12);;
        pcmIndex = getInt32Value(d,16);;
        m.numPayloads = getInt32Value(d,24);;
        m.totalFrames = getInt32Value(d,28);;
        frameIndex = getInt32Value(d,32);;
        if(sampIndex==3) m.sampleRate=48000;
        if(sampIndex==4) m.sampleRate=44100;
        m.osf = !frameIndex ? 1 : 2*frameIndex;
        m.bitDepth = pcmIndex ? (4*(pcmIndex-1)+16) : 8;
        m.duration = parseFloat(m.totalFrames*1024/(m.sampleRate));
        m.sampleRate *= m.osf;
    }
    return m;
}

var _fetch = function (url,callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.overrideMimeType('text/plain; charset=x-user-defined');
    xhr._offset=0;
    xhr.onreadystatechange = function(e) {
      if (this.readyState>=3&&this.status==200) {
        var buf=new Uint8Array(this.responseText.length-this._offset);
        for (var i=0;i<buf.length;i++) {
          buf[i]=this.responseText.charCodeAt(this._offset+i)&0xff;
        }
        this._offset+=buf.length;
        return callback(buf);
      }
    };
    xhr.send();
    _OS.xhr = xhr;
}

_OS.setTimeout = function (_delay) {
    if(this.max==320) return;
    if(this.index == -1 || !this.query) return;
    this._bytesLoaded = this.connection.bytesLoaded;
    if(this.timeout) clearTimeout(this.timeout);

    var format = this._format[this._index] || this.format;

    if(format && !_delay) {
        _delay = format.duration/600 * 10000;
        if(_delay<5000) _delay = 5000;
    }

    this.timeout = setTimeout(function(){
        if(_OS._bytesLoaded == _OS.connection.bytesLoaded && _OS._buffered<1 && !_OS.paused  && _OS.index > -1 && !_OS.isPreview()){
            delete _OS._bytesLoaded;
            if(!_OS.switched && _OS.socket.connected) _OS.socket.disconnect();
            if(_OS.reader) {
                _OS.reader.cancel().then(function(){}).catch(function(){});;
                setTimeout( function () {
                    _OS.reader = null;
                },200)
            }
            if(!_OS._buffered && _OS.buffered<1) _OS._buffered = _OS.buffered;
            if(!_OS._buffered)
                return setTimeout(function(){
                    if(_OS._buffered) return;
                    _OS.preload(_OS._index); //0
                    console.log('timeout - buffer zero:', _OS.index, _OS._index, _OS._buffered, _OS.connection);
                }, 5000);

            // do windowing to conserve memory use
            if(_OS.mode == 1 && format)
                if( (_OS.index == _OS._index && format.duration * (_OS.buffered - _OS.played) > _OS.headroom * 6) ||
                    (_OS.index != _OS._index && format.duration * _OS._buffered > _OS.headroom * 6) ) return _OS.setTimeout(5000);

            if(_OS.buffered <= _OS.played) {
                console.log('timeout - buffer underrun:',_OS.buffered, _OS.played);
                return _OS.scrub(_OS.played - 1e-5);
            }
            // last resort - use resume connection
            _OS._resuming = true;
            _OS.worker.postMessage({
                action: 'resume',
                index: _OS._index,
                position: _OS._buffered
            });
        }
    },_delay)
}

_OS.setInterval = function () {
    if(this.stopped || !this.query) return;
    if(this.time_interval) clearInterval(this.time_interval);
    this._played = this.played;
    var _delay = 10000;
    this.time_interval = setInterval( function() {
        if(_OS._played == _OS.played && _OS.played < 1 && !_OS.paused) {
            delete _OS._played;
            console.log('playing position stuck:', _OS.played, _OS.buffered, _OS.bandwidth, _OS.connection)
            _OS.scrub(_OS.played - 1e-5);
        }
       _OS._played = _OS.played;
    },_delay)
}

_OS.postData = function (data, retry) {
    if(!_OS.connection) return;
    var buffer = new Uint8Array(data);
    var start = !_OS.connection.bytesLoaded ? true : false;
    var format;
    if (start) {
        format = _OS._format[_OS._index] = _OS.getASC(buffer);
        if (retry) setTimeout( function () { _OS.load(_OS._index, _OS._start);}, 100);
        delete _OS._resuming;
        delete _OS._next;

        if(_OS.max==320) {
            _OS._dropped = true;
            return;
        }
        _OS.worker.postMessage({
            action: 'progress',
            index: _OS._index
        });
        _OS.connection._bytesLoaded = 0;
    }
    _OS.connection.bytesLoaded += buffer.length;
    var interval = 1e6;
    var delta = _OS.connection.bytesLoaded - _OS.connection._bytesLoaded;
    var diff = new Date() - _OS.connection.startTime;
    localStorage.bandwidth = _OS.bandwidth = parseInt(8 * _OS.connection.bytesLoaded / diff);

    if (delta>interval) {
        _OS.connection._bytesLoaded = _OS.connection.bytesLoaded;
        if (!_OS.switched) _OS.socket.emit('bandwidth', _OS.bandwidth);
    }

    format = _OS._format[_OS._index];
    if(!format) return _OS.setTimeout(500);

/*
    // do windowing to conserve memory use
    if(_OS.mode == 1) {
        if( (_OS.index == _OS._index && format.duration * (_OS.buffered - _OS.played) > _OS.headroom * 12) ||
            (_OS.index != _OS._index && format.duration * _OS._buffered > _OS.headroom * 12) )
            _OS.dropConnection();
    }
*/
    var track;
     if(start) {
        track = {
            totalFrames: format.totalFrames,
            osf: format.osf,
            ratio: _OS.resampleAudio ? format.sampleRate / _OS.context.sampleRate : 1
        };
    }

    _OS.worker.postMessage({
        action: 'buffer',
        data: buffer,
        index: _OS._index,
        start: start,
        track: track,
        bytes: _OS.connection.bytesLoaded,
    }, [buffer.buffer]);

    _OS.setTimeout();
}

_OS.prefetch = function (index, pos, retry) {
    if(!index) index = 0;
    if(!pos) pos = 0;

    this.query = {
        token: this.token,
        track_id: this.cache_queue[index],
        pos: this.max==320 ? -1 : pos.toFixed(6),
        mode: this.mode,
        min: 160,
        max: this.max,
        chunked: true
    }

    if(localStorage.bandwidth) this.bandwidth = parseInt(localStorage.bandwidth);
    if(!this.bandwidth) this.bandwidth = 320;
    if( this._dropped || this.bandwidth<1e4) this.bandwidth *= 0.7;
    delete this._dropped;

    this.query.bandwidth = parseInt(this.bandwidth);

    this.connection = {
        bytesLoaded: 0,
        startTime: new Date(),
        headroom: 0,
        fillrate: 0
    };

    this._index = index;
    this._buffered = 0;

    if (!this._resuming) {
        this._start = pos;
        this._format[index] = null;
    }

    var url, _u;
    _u = this.host +'/songs/';
    if (this.service) _u = connectUrl + '/songs/'
    //url = _u + this.query.track_id + '?version=6&max=' + this.max
    url = _u + this.query.track_id + '?version=6'
    url += '&max=' + this.query.bandwidth + '&mode=' + (this.token=='123456789' ? '1' : '2');
    url += '&min=' + this.query.min;
    url += '&pos=' + this.query.pos;
    //url += '&mode=' + this.query.mode;
    //url += '&bandwidth=' + this.query.bandwidth;
    if (this.token) url += '&token=' + this.token
    if (this.app) url += '&app=' + this.app;
    url += '&chunked=1';

    // supported on Chrome, Safari, Opera,
    //  (for FF, no support for streaming response body, need to turn on settings in prefs)
    // Edge performance ???

    if (typeof(window.fetch)==='function' && typeof(window.ReadableStream)==='function' && !/(Firefox|Edge)/.test(navigator.userAgent)) {
        if (this.reader) {
            this.reader.cancel().then(function(){}).catch(function(){});
            setTimeout(function(){
                delete _OS.reader;
                _OS.prefetch(index,pos,retry);
            },200)
            return;
        }
        fetch(url).then(function(response) {
            _OS.reader = response.body.getReader();
            var pump = function (result) {
                if (result.done || !_OS.reader) {
                    _OS.reader = null;
                    return
                }
                _OS.postData(result.value, retry);
                _OS.reader.read().then(pump).catch(function(err) {});
            }
            _OS.reader.read().then(pump);
        }).catch(function(err) {
            console.log('err:', err);
            _OS.reader = null;
        });
    } else {
        if (this.xhr) this.xhr.abort();
        _fetch(url,function(buffer) {
            if (buffer) _OS.postData(buffer, retry);
        })
    }
    _OS.setTimeout();
}

_OS.preload = function (index,pos,retry) {
    if(!this.switched && (!this.socket || !this.isLoaded) ) return setTimeout(function () {
        _OS.preload(index, pos, retry);
    },1000)

    if(index < 0) return;
    // use http fetch streaming instead of socket.io for web audio
    if (this.switched) return this.prefetch(index,pos,retry);

    if (!index) index = 0;
    if (!pos) pos = 0;

    if (index >= this.cache_queue.length) return;
    this.query = {
        token: this.token,
        track_id: this.cache_queue[index],
        pos: this.max==320 ? -1 : pos.toFixed(6),
        mode: this.mode,
        min: 160,
        max: this.max,
        chunked: true
    }

    if (localStorage.bandwidth) this.bandwidth = parseInt(localStorage.bandwidth);
    if( this._dropped || this.bandwidth<1e4) this.bandwidth *= 0.7;
    delete this._dropped;

    if (this.service) {
        this.query.service = this.service;
        this.socket.io.uri = connectUrl;
    } else
        this.socket.io.uri = this.host;

    if (!this.bandwidth) this.bandwidth = 320;
    this.query.bandwidth = parseInt(this.bandwidth);
    if (this.app) this.query.app = this.app;

    this.connection = {
        bytesLoaded: 0,
        startTime: new Date(),
        headroom: 0,
        fillrate: 0
    };

    this._index = index;
    this._buffered = 0;

    if (!this._resuming) {
        this._start = pos;
        this._format[index] = null;
    }

    this.socket.removeAllListeners();

    this.socket.on('stream', function (data) {
        _OS.postData(data.buffer, retry);
    });

    this.socket.on('connect', function () {
        //console.log('connect')
        this.emit('start',_OS.query);
        this.off('connect');
    })

    this.socket.on('connect_error', function (err) {
        _OS.setTimeout(500);
    });

    if (this.socket.disconnected) this.socket.connect();
    else
        if (this.socket.connected) {
            this.socket.on('disconnect', function () {
                this.connect();
                this.off('disconnect');
            })
            this.socket.disconnect();
        }
    _OS.setTimeout();
}

_OS.load = function (index, pos, retry) {

    if(this.max==320 && !this._audioEl._started) {
        this._audioEl._started = true;
        var promise = this._audioEl.play();
        if (promise) promise.then(function(){}).catch(function(){});
    }

    if(!index) index = 0;
    if(!pos) pos = 0;
    this.index = index;
    this.buffered = this.played = pos;
    this.format = this._format[this.index] || this.format;

    if(this.format) {
        this.sampleRate = this.format.sampleRate;
        this.channels = this.format.numChannels;
    }

    if (!this._next) {
        if (this.timeout) clearTimeout(this.timeout);
        if (this.isTrackChanged(this.index) || retry) {
            if (!this.waiting) {
                console.log( (this.switched ? 'http fetch' : 'socket_io load') +' track:',index);
                this.waiting = true;
                this.preload(index, pos, true);
                return;
            }
        }
        if(this.format && !retry && this.max!=320) {
            var ratio = this.resampleAudio ? this.format.sampleRate / this.context.sampleRate : 1;

            this.worker.postMessage({
                action: 'change',
                index: index,
                total: this.format.totalFrames,
                start: pos,
                last: parseInt(this.format.lastFrameSize / (this.format.bitDepth/8)),
                channels: this.channels,
                osf: this.format.osf,
                duration: this.format.duration,
                ratio: ratio,
            })
        }
    }

    this.stopped = this.paused = false; //??
    delete this._next;
    delete this.quality;
    delete this.bitrate;
    delete this.bandwidth;

    console.log('loaded track:',index, 'time:', new Date().toLocaleTimeString());
}

_OS.play = function (flag) {
    if (this.playing==flag || this.stopped || (flag && this._start == this.played) ) return;

    if(this.max==320)
        this._audioEl[ flag ? 'play': 'pause']();
    else
        this.context[flag ? 'resume' : 'suspend']();

    this.playing = flag;
    this.waiting = this.paused =! flag;
    if(flag && this.buffered < 1) return this.setTimeout(500);
}

_OS.scrub = function (pos) {
    if (!this.format || this.played == pos) return;
    if(pos<0) pos = 0;
    pos += 1e-6;
    var _margin = this.headroom*2 /this.format.duration; //
    var _near = 1 - _margin;
    if (pos>_near) pos = _near;

    this.queue = [];

    if (pos + _margin > this.buffered || pos < this.played || (!this.paused && this.waiting) ) {
        this.stop(true);
        return setTimeout(function() {
            _OS.load(_OS.index, pos, true);
        }, 500);
    }

    this.played = pos;
    delete this.prevTime;

    if(this.max==320) {
        this._audioEl.currentTime = pos * this.format.duration;
        if(this.paused) this.play(true);
    } else {
        this.worker.postMessage({
            action: 'seek',
            position: pos
        });
        if(this.buffered < 1) _OS.setTimeout(500);
        this._seeking = true;
        if(this.paused) this.play(true);
        this._out(true);
    }
}

_OS.stop = function (transition) {
    this._audioEl.pause();

    if (!transition && this.stopped) return;
    if (this.timeout) clearTimeout(this.timeout);
    if (this.time_interval) clearInterval(this.time_interval);
    delete this._resuming;
    delete this._next;
    delete this.query;
    delete this._error;
    delete this.prevTime;
    delete this._seeking;

    this.stopped = true;
    this.playing = this.waiting = false;
    this.buffered = this._buffered = 0;
    this.queue = [];
    this._format = [];
    this._index = -1;

    if (!transition) {
        this.index = -1;
        this.played = 0;
    }

    if(this.worker) this.worker.postMessage({
        action: 'empty',
        total: this.cache_queue.length
    });

    if(this.context) this.context.suspend();
}

_OS.updateVolume = function (level) {
    if (level>=0 && level<=1) {
        this.volumeLevel = level;
        if (this.gainNode) this.gainNode.gain.setTargetAtTime(level, this.context.currentTime, 0.00001);
        this._audioEl.volume = level;
        this.emit('volume', level);
    }
}

_OS.pull = function (frames) {
    if (!frames) frames = 1;
    if (this.queue.length > 256) return;
    for (var i=0; i<frames; i++) {
        setTimeout(function() {
            if(_OS.stopped || !_OS.playing) return;
            _OS.worker.postMessage({action: 'decode'});
        }, i);
    }
}

_OS._out = function (refresh) {
    if(!this.playing || !this.format || this.max==320) return;

    var qsize = 16;

    if(refresh) {
        this.bufferSources.forEach(function(src) {
            src.stop();
            src.disconnect();
        })
        this.bufferSources = [];
        this.waiting = true;
        this.queue = [];

        this.context.suspend();

        setTimeout(function() {
            _OS.pull(64);
        }, 10);

        var _wait = setInterval(function() {
            if(_OS.queue.length > qsize*2) {
                clearInterval(_wait);
                _OS.bufferSources = [];
                _OS.waiting = false;
                _OS.nextTime = _OS.context.currentTime + 0.2;
                _OS.context.resume();
                _OS._out();
            }
        }, 200);
        return;
    }

    if(this.waiting || this.queue.length < qsize) {
        if(this.queue.length < qsize) this.pull();
        return setTimeout(function() {
            _OS._out();
        } , 1000);
    }

    if(this.nextTime + 1 < this.context.currentTime) {
        console.log('next time overrun - bw:', this.bandwidth);
        return _OS._out(true);
    }

    var c, i, l, _total = 0;
    var len = this.queue.length;
    if(len > qsize) len = qsize;
    this.pull(qsize);

    for(q = 0; q < len; q++) {
        var _frame = this.queue.shift();
        this.bufferSamples.set(_frame, _total);
        _total += _frame.length;
    }

    var rate = this.resampleAudio ? this.context.sampleRate : this.sampleRate;

    var buffer = this.context.createBuffer(this.channels, _total/this.channels, rate);
    var channels = new Array(this.channels);

    for (c = 0; c< this.channels; c++)
        channels[c] = buffer.getChannelData(c);

    for (i = l = 0; l < _total; l++) {
        for (c = 0; c < this.channels; c++)
            channels[c][l] = this.bufferSamples[i + c];
        i += this.channels;
    }

    var src = this.context.createBufferSource();
    src.buffer = buffer;
    src.connect(this.gainNode);
    src.start(this.nextTime);
    this.nextTime += buffer.duration;

    src.onended = function() {
        _OS.bufferSources.shift();
        _OS._out();
    }
    this.bufferSources.push(src);
    if(this.bufferSources.length<15) setTimeout (function() {
        _OS._out();
    }, 200);
}

_OS.out = function () {
    if(this.max==320) {
        var track_id = this.cache_queue[this.index] + '.mp3'
        var url = connectUrl + '/mp3/' + track_id + '?client_id=neilyoungarchives'
        if(this.token)  url += '&token=' + this.token;
        this._audioEl.src = url;
        var promise = this._audioEl.play();
        if (promise) promise.then(function(){}).catch(function(){});

        this._audioEl.volume = _OS.volumeLevel;
        this.playing = true;
        return this._audioEl.oncanplay = function() {
            _OS.bufferSources.forEach(function(src) {
                src.stop();
                src.disconnect();
            })
            _OS.bufferSources = [];
            var duration = _OS._audioEl.duration;
            if(_OS.waiting) _OS._audioEl.currentTime = _OS.played * duration;
            var buffered = _OS._audioEl.buffered;
            var len = buffered.length;
            if(len) _OS.buffered  = buffered.end(len-1)/duration;
            _OS.waiting = false;
            _OS.context.resume();
        }
    }
    if(!this._audioEl.paused) return;
    this.queue = [];
    this.playing = true;
    this.setInterval();
    this._out(true);
}

_OS.updateProgress = function (data) {
    if (data.index == _OS._index && _OS._format[_OS._index]){
        var _start = parseInt(_OS._start * _OS._format[_OS._index].totalFrames + 0.5);
        if (data.frames) _OS._buffered = (_start + data.frames) / _OS._format[_OS._index].totalFrames;
        if (data.position) _OS._buffered = data.position;
        if (_OS._buffered > 1) _OS._buffered = 1;
    }
    if (data.index == _OS.index && _OS.format) {
        var _start = parseInt(_OS._start * _OS.format.totalFrames + 0.5);
        if (data.frames) _OS.buffered = (_start + data.frames) / _OS.format.totalFrames;
        if (data.position) _OS.buffered = data.position;
        if (_OS.buffered > 1 || _OS._next || _OS.index < _OS._index) _OS.buffered = 1;
    }
}

_OS.switchToFetch = function () {
    this.switched = true;
}

_OS.dropConnection = function () {
    delete this._resuming;
    if(this._dropped) return;
    if (!this.switched) this.socket.disconnect();
    if (this.reader) {
        this.reader.cancel().then(function(){}).catch(function(){});;
        setTimeout(function(){
            delete _OS.reader;
        },200)
    }
    this._dropped = true;
}

_OS.isPreview = function () {
    return _OS.format && _OS.format.lastFrameSize==99999
}

_OS.worker = new Worker("js/worker.js"); // /player/worker.js

_OS.worker.onmessage = function (event) {
    var action = event.data.action
    var data = event.data
    switch (action) {
        case "decode":
            if(_OS._seeking && data.position && data.position < _OS.played) break;

            if (data.data ) {
                var a = data.data.buffer ? data.data : null;
                if (a) _OS.queue.push(a);
            }
            if(data.quality) _OS.quality = data.quality;
            if (data.frameSize && _OS.format) _OS.bitrate = 8 * data.frameSize * _OS.sampleRate/ (_OS.format.osf*1024*1024);
            if (data.next) {
                if (_OS.index+1<_OS.cache_queue.length) {
                    if (_OS.connection.bytesLoaded>36) {
                        //console.log('loading next...');
                        //_OS._next = true;
                    }else{
                        console.log('retry loading next...');
                        _OS._next = false;
                        _OS.load(_OS.index+1, 0, true)
                    }
                }
            }
            break;

        case "reconnect":
            if(_OS.isPreview()) break;
            if (data.position<1) {
                data.position += _OS._start;
                console.log('reconnecting at:', data.position.toFixed(6));
                _OS.preload(data.index, data.position);
            }
            _OS.updateProgress(data);
            break;

        case "progress":
            if (data.frames<0) {
                _OS._error = true;
                console.log('progress error:', data.frames);
                break;
            }
            _OS.updateProgress(data);
            break;

        case "seeking":
            delete _OS._seeking;
            break;

        case "error":
            _OS.scrub(_OS.played - 1e-5);
            break;

        default:
            break;
    }
}